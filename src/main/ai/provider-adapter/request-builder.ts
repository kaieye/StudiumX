import type {
  ModelEndpointFormat,
  TeachingModelProviderProfile,
  TeachingSettingsV1
} from '../../../shared/teaching-types'
import {
  upstreamAnthropicMessagesUrl,
  upstreamOpenAiChatCompletionsUrl,
  upstreamOpenAiCustomEndpointUrl,
  upstreamOpenAiResponsesUrl
} from '../../../shared/openai-compat-url'
import {
  effectiveMaxOutputTokens
} from '../../../shared/model-provider-catalog'
import type {
  AdapterRequest,
  ChatAdapterRequest,
  ChatMessage,
  ToolChoice,
  ToolDefinition
} from '../provider-adapter'
import type { AgentChatImageAttachment } from '../../../shared/agent-chat-images'
import { mergeProviderRequestHeaders } from '../../../shared/provider-custom-headers'
import {
  anthropicGenerationOptions,
  reasoningRequestOptions,
  type StructuredOutputReasoningPolicy
} from './capabilities'
import { adapterAuthHeaders } from './formats'

export { adapterAuthHeaders } from './formats'

function providerRequestHeaders(
  format: ModelEndpointFormat,
  provider: TeachingModelProviderProfile
): Record<string, string> {
  return mergeProviderRequestHeaders(
    adapterAuthHeaders(format, provider.apiKey),
    provider.customHeaders
  )
}

/**
 * Single source of truth for serializing a user turn (text + optional image
 * attachments) into each provider's wire format. The chat request builder and
 * the simple text request builder both delegate here, so image support stays
 * identical across the main AI conversation and structured generation lanes.
 */
export function buildOpenAiUserContent(
  content: string,
  imageAttachments: AgentChatImageAttachment[] | undefined
): string | unknown[] {
  if (!imageAttachments?.length) return content
  return [
    ...(content ? [{ type: 'text', text: content }] : []),
    ...imageAttachments.map((attachment) => ({
      type: 'image_url',
      image_url: { url: `data:${attachment.mimeType};base64,${attachment.dataBase64}` }
    }))
  ]
}

export function buildResponsesUserContent(
  content: string,
  imageAttachments: AgentChatImageAttachment[] | undefined
): unknown[] {
  return [
    ...(content ? [{ type: 'input_text', text: content }] : []),
    ...(imageAttachments ?? []).map((attachment) => ({
      type: 'input_image',
      image_url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`
    }))
  ]
}

export function buildAnthropicUserContent(
  content: string,
  imageAttachments: AgentChatImageAttachment[] | undefined
): unknown[] {
  return [
    ...(content ? [{ type: 'text', text: content }] : []),
    ...(imageAttachments ?? []).map((attachment) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mimeType,
        data: attachment.dataBase64
      }
    }))
  ]
}

export function buildRequest(
  format: ModelEndpointFormat,
  opts: {
    provider: TeachingModelProviderProfile
    generator: TeachingSettingsV1['generator']
    request: AdapterRequest
    stream: boolean
    reasoningPolicy?: StructuredOutputReasoningPolicy
  }
): { url: string; init: RequestInit } {
  const { provider, generator, request, stream, reasoningPolicy } = opts
  const maxOutputTokens = effectiveMaxOutputTokens(provider, generator.model, generator.maxOutputTokens)
  const hasImages = Boolean(request.imageAttachments?.length)
  switch (format) {
    case 'chat_completions':
      return {
        url: upstreamOpenAiChatCompletionsUrl(provider.baseUrl),
        init: {
          method: 'POST',
          headers: providerRequestHeaders(format, provider),
          body: JSON.stringify({
            model: generator.model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              {
                role: 'user',
                content: hasImages
                  ? buildOpenAiUserContent(request.userPrompt, request.imageAttachments)
                  : request.userPrompt
              }
            ],
            temperature: generator.temperature,
            max_tokens: maxOutputTokens,
            stream,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
            ...reasoningRequestOptions(format, provider, generator, {
              jsonMode: request.jsonMode,
              reasoningPolicy
            }),
            ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {})
          })
        }
      }
    case 'responses':
      return {
        url: upstreamOpenAiResponsesUrl(provider.baseUrl),
        init: {
          method: 'POST',
          headers: providerRequestHeaders(format, provider),
          body: JSON.stringify({
            model: generator.model,
            instructions: request.systemPrompt,
            input: hasImages
              ? [{ role: 'user', content: buildResponsesUserContent(request.userPrompt, request.imageAttachments) }]
              : request.userPrompt,
            temperature: generator.temperature,
            max_output_tokens: maxOutputTokens,
            stream,
            ...reasoningRequestOptions(format, provider, generator, {
              jsonMode: request.jsonMode,
              reasoningPolicy
            })
          })
        }
      }
    case 'messages':
      return {
        url: upstreamAnthropicMessagesUrl(provider.baseUrl),
        init: {
          method: 'POST',
          headers: providerRequestHeaders(format, provider),
          body: JSON.stringify({
            model: generator.model,
            max_tokens: maxOutputTokens,
            system: request.systemPrompt,
            messages: [{
              role: 'user',
              content: hasImages
                ? buildAnthropicUserContent(request.userPrompt, request.imageAttachments)
                : request.userPrompt
            }],
            ...anthropicGenerationOptions(provider, generator, { reasoningPolicy }),
            stream
          })
        }
      }
    case 'custom_endpoint':
      return {
        url: upstreamOpenAiCustomEndpointUrl(provider.baseUrl),
        init: {
          method: 'POST',
          headers: providerRequestHeaders('chat_completions', provider),
          body: JSON.stringify({
            model: generator.model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              {
                role: 'user',
                content: hasImages
                  ? buildOpenAiUserContent(request.userPrompt, request.imageAttachments)
                  : request.userPrompt
              }
            ],
            temperature: generator.temperature,
            max_tokens: maxOutputTokens,
            stream,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
            ...reasoningRequestOptions(format, provider, generator, {
              jsonMode: request.jsonMode,
              reasoningPolicy
            }),
            ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {})
          })
        }
      }
  }
}

// ---- Native tool-calling wire formats (Responses / Anthropic Messages) ----

type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown[] }

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

/** Convert OpenAI-shaped chat history into the Responses API `input` array. */
function toResponsesInput(messages: ChatMessage[]): { instructions: string; input: unknown[] } {
  const instructions: string[] = []
  const input: unknown[] = []
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        instructions.push(m.content)
        break
      case 'user':
        input.push({ role: 'user', content: responsesUserContent(m) })
        break
      case 'assistant': {
        if (m.tool_calls && m.tool_calls.length > 0) {
          if (m.content) {
            input.push({ role: 'assistant', content: [{ type: 'output_text', text: m.content }] })
          }
          for (const tc of m.tool_calls) {
            input.push({
              type: 'function_call',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments
            })
          }
        } else {
          input.push({ role: 'assistant', content: m.content ? [{ type: 'output_text', text: m.content }] : [] })
        }
        break
      }
      case 'tool':
        input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content })
        break
    }
  }
  return { instructions: instructions.join('\n\n'), input }
}

/** Convert OpenAI-shaped chat history into the Anthropic Messages API shape. */
function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = []
  const raw: AnthropicMessage[] = []
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        system.push(m.content)
        break
      case 'user':
        raw.push({ role: 'user', content: anthropicUserContent(m) })
        break
      case 'assistant': {
        const content: unknown[] = []
        if (m.content) content.push({ type: 'text', text: m.content })
        if (m.tool_calls && m.tool_calls.length > 0) {
          for (const tc of m.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: parseJsonObject(tc.function.arguments)
            })
          }
        }
        raw.push({ role: 'assistant', content })
        break
      }
      case 'tool':
        raw.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] })
        break
    }
  }
  // Anthropic requires alternating roles; merge consecutive same-role turns.
  const merged: AnthropicMessage[] = []
  for (const msg of raw) {
    const last = merged[merged.length - 1]
    if (last && last.role === msg.role) {
      last.content = [...last.content, ...msg.content]
    } else {
      merged.push({ role: msg.role, content: [...msg.content] })
    }
  }
  return { system: system.join('\n\n'), messages: merged }
}

function responsesUserContent(message: Extract<ChatMessage, { role: 'user' }>): unknown[] {
  return buildResponsesUserContent(message.content, message.imageAttachments)
}

function anthropicUserContent(message: Extract<ChatMessage, { role: 'user' }>): unknown[] {
  return buildAnthropicUserContent(message.content, message.imageAttachments)
}

function openAiUserContent(message: Extract<ChatMessage, { role: 'user' }>): unknown {
  return buildOpenAiUserContent(message.content, message.imageAttachments)
}

function toResponsesTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters
  }))
}

function toResponsesToolChoice(choice: ToolChoice | undefined): unknown {
  if (choice && typeof choice === 'object' && choice.type === 'function') {
    return { type: 'function', name: choice.function.name }
  }
  return 'auto'
}

function toAnthropicTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }))
}

function toAnthropicToolChoice(choice: ToolChoice | undefined): unknown {
  if (choice && typeof choice === 'object' && choice.type === 'function') {
    return { type: 'tool', name: choice.function.name }
  }
  return { type: 'auto' }
}

function buildResponsesChatBody(
  opts: {
    provider: TeachingModelProviderProfile
    generator: TeachingSettingsV1['generator']
    request: ChatAdapterRequest
    stream: boolean
    includeTools: boolean
    maxOutputTokens: number
    reasoningPolicy?: StructuredOutputReasoningPolicy
  }
): Record<string, unknown> {
  const { provider, generator, request, stream, includeTools, maxOutputTokens, reasoningPolicy } = opts
  const { instructions, input } = toResponsesInput(request.messages)
  const body: Record<string, unknown> = {
    model: generator.model,
    instructions,
    input,
    temperature: generator.temperature,
    max_output_tokens: maxOutputTokens,
    stream,
    ...reasoningRequestOptions('responses', provider, generator, {
      jsonMode: request.jsonMode,
      reasoningPolicy
    })
  }
  if (includeTools && request.tools && request.tools.length > 0) {
    body.tools = toResponsesTools(request.tools)
    body.tool_choice = toResponsesToolChoice(request.toolChoice)
  }
  return body
}

function buildAnthropicChatBody(
  opts: {
    provider: TeachingModelProviderProfile
    generator: TeachingSettingsV1['generator']
    request: ChatAdapterRequest
    stream: boolean
    includeTools: boolean
    maxOutputTokens: number
    reasoningPolicy?: StructuredOutputReasoningPolicy
  }
): Record<string, unknown> {
  const { provider, generator, request, stream, includeTools, maxOutputTokens, reasoningPolicy } = opts
  const { system, messages } = toAnthropicMessages(request.messages)
  const body: Record<string, unknown> = {
    model: generator.model,
    max_tokens: maxOutputTokens,
    system,
    messages,
    ...anthropicGenerationOptions(provider, generator, { reasoningPolicy }),
    stream
  }
  if (includeTools && request.tools && request.tools.length > 0) {
    body.tools = toAnthropicTools(request.tools)
    body.tool_choice = toAnthropicToolChoice(request.toolChoice)
  }
  return body
}

export function buildChatRequest(
  format: ModelEndpointFormat,
  opts: {
    provider: TeachingModelProviderProfile
    generator: TeachingSettingsV1['generator']
    request: ChatAdapterRequest
    stream: boolean
    includeTools: boolean
    reasoningPolicy?: StructuredOutputReasoningPolicy
  }
): { url: string; init: RequestInit } {
  const { provider, generator, request, stream, includeTools, reasoningPolicy } = opts
  const maxOutputTokens = effectiveMaxOutputTokens(provider, generator.model, generator.maxOutputTokens)

  if (format === 'responses') {
    return {
      url: upstreamOpenAiResponsesUrl(provider.baseUrl),
      init: {
        method: 'POST',
        headers: providerRequestHeaders('responses', provider),
        body: JSON.stringify(buildResponsesChatBody({
          provider, generator, request, stream, includeTools, maxOutputTokens, reasoningPolicy
        }))
      }
    }
  }
  if (format === 'messages') {
    return {
      url: upstreamAnthropicMessagesUrl(provider.baseUrl),
      init: {
        method: 'POST',
        headers: providerRequestHeaders('messages', provider),
        body: JSON.stringify(buildAnthropicChatBody({
          provider, generator, request, stream, includeTools, maxOutputTokens, reasoningPolicy
        }))
      }
    }
  }

  const url =
    format === 'custom_endpoint'
      ? upstreamOpenAiCustomEndpointUrl(provider.baseUrl)
      : upstreamOpenAiChatCompletionsUrl(provider.baseUrl)
  const messages = request.messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return { role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls }
    }
    if (m.role === 'user') return { role: 'user', content: openAiUserContent(m) }
    return m
  })
  const body: Record<string, unknown> = {
    model: generator.model,
    messages,
    temperature: generator.temperature,
    max_tokens: maxOutputTokens,
    stream,
    // OpenAI-compatible hosts only emit usage on the final SSE chunk when this is set.
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...reasoningRequestOptions(format, provider, generator, {
      jsonMode: request.jsonMode,
      reasoningPolicy
    }),
    ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {})
  }
  if (includeTools && request.tools && request.tools.length > 0) {
    body.tools = request.tools
    body.tool_choice = request.toolChoice ?? 'auto'
  }
  return {
    url,
    init: {
      method: 'POST',
      headers: providerRequestHeaders('chat_completions', provider),
      body: JSON.stringify(body)
    }
  }
}
