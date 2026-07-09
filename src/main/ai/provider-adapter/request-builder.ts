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
import type { AdapterRequest, ChatAdapterRequest } from '../provider-adapter'
import { anthropicGenerationOptions, reasoningRequestOptions } from './capabilities'
import { adapterAuthHeaders } from './formats'

export { adapterAuthHeaders } from './formats'

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
  switch (format) {
    case 'chat_completions':
      return {
        url: upstreamOpenAiChatCompletionsUrl(provider.baseUrl),
        init: {
          method: 'POST',
          headers: adapterAuthHeaders(format, provider.apiKey),
          body: JSON.stringify({
            model: generator.model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userPrompt }
            ],
            temperature: generator.temperature,
            max_tokens: generator.maxOutputTokens,
            stream,
            ...reasoningRequestOptions(format, provider, generator),
            ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {})
          })
        }
      }
    case 'responses':
      return {
        url: upstreamOpenAiResponsesUrl(provider.baseUrl),
        init: {
          method: 'POST',
          headers: adapterAuthHeaders(format, provider.apiKey),
          body: JSON.stringify({
            model: generator.model,
            instructions: request.systemPrompt,
            input: request.userPrompt,
            temperature: generator.temperature,
            max_output_tokens: generator.maxOutputTokens,
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
          headers: adapterAuthHeaders(format, provider.apiKey),
          body: JSON.stringify({
            model: generator.model,
            max_tokens: generator.maxOutputTokens,
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
          headers: adapterAuthHeaders('chat_completions', provider.apiKey),
          body: JSON.stringify({
            model: generator.model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userPrompt }
            ],
            temperature: generator.temperature,
            max_tokens: generator.maxOutputTokens,
            stream,
            ...reasoningRequestOptions(format, provider, generator),
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
    max_tokens: generator.maxOutputTokens,
    stream,
    ...reasoningRequestOptions(format, provider, generator),
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
      headers: adapterAuthHeaders('chat_completions', provider.apiKey),
      body: JSON.stringify(body)
    }
  }
}
