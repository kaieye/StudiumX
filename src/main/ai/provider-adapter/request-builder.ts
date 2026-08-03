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
import type { AdapterRequest, ChatAdapterRequest } from '../provider-adapter'
import { mergeProviderRequestHeaders } from '../../../shared/provider-custom-headers'
import { anthropicGenerationOptions, reasoningRequestOptions } from './capabilities'
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

export function buildRequest(
  format: ModelEndpointFormat,
  opts: {
    provider: TeachingModelProviderProfile
    generator: TeachingSettingsV1['generator']
    request: AdapterRequest
    stream: boolean
  }
): { url: string; init: RequestInit } {
  const { provider, generator, request, stream } = opts
  const maxOutputTokens = effectiveMaxOutputTokens(provider, generator.model, generator.maxOutputTokens)
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
              { role: 'user', content: request.userPrompt }
            ],
            temperature: generator.temperature,
            max_tokens: maxOutputTokens,
            stream,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
            ...reasoningRequestOptions(format, provider, generator, { jsonMode: request.jsonMode }),
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
            input: request.userPrompt,
            temperature: generator.temperature,
            max_output_tokens: maxOutputTokens,
            stream,
            ...reasoningRequestOptions(format, provider, generator)
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
            messages: [{ role: 'user', content: request.userPrompt }],
            ...anthropicGenerationOptions(provider, generator),
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
              { role: 'user', content: request.userPrompt }
            ],
            temperature: generator.temperature,
            max_tokens: maxOutputTokens,
            stream,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
            ...reasoningRequestOptions(format, provider, generator, { jsonMode: request.jsonMode }),
            ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {})
          })
        }
      }
  }
}

export function buildChatRequest(
  format: ModelEndpointFormat,
  opts: {
    provider: TeachingModelProviderProfile
    generator: TeachingSettingsV1['generator']
    request: ChatAdapterRequest
    stream: boolean
    includeTools: boolean
  }
): { url: string; init: RequestInit } {
  const { provider, generator, request, stream, includeTools } = opts
  const maxOutputTokens = effectiveMaxOutputTokens(provider, generator.model, generator.maxOutputTokens)
  const url =
    format === 'custom_endpoint'
      ? upstreamOpenAiCustomEndpointUrl(provider.baseUrl)
      : upstreamOpenAiChatCompletionsUrl(provider.baseUrl)
  const messages = request.messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return { role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls }
    }
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
    ...reasoningRequestOptions(format, provider, generator, { jsonMode: request.jsonMode }),
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
