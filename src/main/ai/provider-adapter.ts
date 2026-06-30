import type {
  ModelEndpointFormat,
  TeachingModelProviderProfile,
  TeachingSettingsV1
} from '../../shared/teaching-types'
import {
  upstreamAnthropicMessagesUrl,
  upstreamOpenAiChatCompletionsUrl,
  upstreamOpenAiCustomEndpointUrl,
  upstreamOpenAiResponsesUrl
} from '../../shared/openai-compat-url'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import { providerProbeHeaders } from '../provider-connection'

export type AdapterRequest = {
  systemPrompt: string
  userPrompt: string
  /** Hint the provider to return strict JSON (where supported). */
  jsonMode: boolean
}

export type AdapterResult = { text: string }

export type AdapterStep = 'calling' | 'streaming' | 'validating' | 'rendering'

export type AdapterCallbacks = {
  onToken?: (delta: string) => void
  onStatus?: (step: AdapterStep) => void
}

export class ProviderAdapterError extends Error {
  readonly kind: AdapterErrorKind
  constructor(kind: AdapterErrorKind, message: string) {
    super(message)
    this.name = 'ProviderAdapterError'
    this.kind = kind
  }
}

export type AdapterErrorKind = 'no_api_key' | 'network' | 'http' | 'parse' | 'timeout' | 'unsupported'

const CONTENT_TYPE_JSON = 'application/json'

export function resolveActiveProvider(
  settings: TeachingSettingsV1
): TeachingModelProviderProfile | null {
  const provider =
    settings.provider.providers.find((item) => item.id === settings.generator.providerId) ??
    settings.provider.providers.find((item) => item.id === settings.provider.activeProviderId) ??
    null
  return provider
}

function resolveProxyUrl(settings: TeachingSettingsV1): string {
  return settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
}

function buildRequest(
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
            stream
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
            ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {})
          })
        }
      }
  }
}

function isAnthropicClaudeProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  return provider.id === 'anthropic' || /^claude-(opus|sonnet|haiku|fable|mythos)/i.test(model)
}

function anthropicGenerationOptions(
  provider: TeachingModelProviderProfile,
  generator: TeachingSettingsV1['generator']
): Record<string, unknown> {
  if (isAnthropicClaudeProvider(provider, generator.model)) {
    return {
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' }
    }
  }
  return { temperature: generator.temperature }
}

export function adapterAuthHeaders(
  endpointFormat: ModelEndpointFormat,
  apiKey: string
): Record<string, string> {
  const base = providerProbeHeaders(endpointFormat, apiKey)
  base['Content-Type'] = CONTENT_TYPE_JSON
  return base
}

function extractText(format: ModelEndpointFormat, body: unknown): string {
  if (format === 'messages') {
    const content = (body as { content?: unknown })?.content
    if (Array.isArray(content)) {
      return content
        .map((block) => (block as { text?: string })?.text ?? '')
        .filter(Boolean)
        .join('')
    }
    return typeof content === 'string' ? content : ''
  }
  if (format === 'responses') {
    const out = (body as { output_text?: string })?.output_text
    if (typeof out === 'string') return out
    // fallback: walk output[].content[].text
    const output = (body as { output?: unknown })?.output
    if (Array.isArray(output)) {
      return output
        .flatMap((item) => {
          const content = (item as { content?: unknown })?.content
          return Array.isArray(content)
            ? content.map((block) => (block as { text?: string })?.text ?? '')
            : []
        })
        .filter(Boolean)
        .join('')
    }
    return ''
  }
  // chat_completions + custom_endpoint
  const choices = (body as { choices?: unknown })?.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as { message?: { content?: unknown } })?.message
    const content = message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map((block) => (block as { text?: string })?.text ?? '').join('')
    }
  }
  return ''
}

/** Non-streaming provider call. Returns the full text response. */
export async function callProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: AdapterRequest
  callbacks?: AdapterCallbacks
}): Promise<AdapterResult> {
  const { settings, provider, request, callbacks } = opts
  if (!provider.apiKey.trim()) {
    throw new ProviderAdapterError('no_api_key', '未配置 API Key。')
  }
  const format = settings.generator.endpointFormat
  const { url, init } = buildRequest(format, {
    provider,
    generator: settings.generator,
    request,
    stream: false
  })
  callbacks?.onStatus?.('calling')
  let res: Response
  try {
    res = await fetchWithOptionalProxy(
      url,
      { ...init, signal: AbortSignal.timeout(settings.generator.requestTimeoutMs) },
      resolveProxyUrl(settings)
    )
  } catch (e) {
    throw new ProviderAdapterError('network', networkMessage(e))
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ProviderAdapterError('http', `Provider 返回 ${res.status} ${res.statusText}${body ? `：${body.slice(0, 240)}` : ''}`)
  }
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    throw new ProviderAdapterError('parse', 'Provider 响应不是有效 JSON。')
  }
  const text = extractText(format, parsed)
  if (!text) {
    throw new ProviderAdapterError('parse', 'Provider 响应未包含可用的文本内容。')
  }
  return { text }
}

/** Streaming provider call (SSE). Accumulates text, invoking onToken per delta. */
export async function streamProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: AdapterRequest
  callbacks: AdapterCallbacks
}): Promise<AdapterResult> {
  const { settings, provider, request, callbacks } = opts
  if (!provider.apiKey.trim()) {
    throw new ProviderAdapterError('no_api_key', '未配置 API Key。')
  }
  const format = settings.generator.endpointFormat
  const { url, init } = buildRequest(format, {
    provider,
    generator: settings.generator,
    request,
    stream: true
  })

  callbacks.onStatus?.('calling')
  let res: Response
  try {
    // First-token timeout: the absolute timeout guards time-to-first-byte;
    // once streaming starts we rely on the stream's own liveness.
    res = await fetchWithOptionalProxy(
      url,
      { ...init, signal: AbortSignal.timeout(settings.generator.requestTimeoutMs) },
      resolveProxyUrl(settings)
    )
  } catch (e) {
    // Some providers/endpoints don't actually support SSE; fall back to a
    // single-shot non-streaming call and emit the whole text as one token.
    if (isAbortTimeout(e)) {
      return callProvider({ settings, provider, request, callbacks }).then((result) => {
        callbacks.onStatus?.('streaming')
        callbacks.onToken?.(result.text)
        return result
      })
    }
    throw new ProviderAdapterError('network', networkMessage(e))
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new ProviderAdapterError('http', `Provider 返回 ${res.status} ${res.statusText}${body ? `：${body.slice(0, 240)}` : ''}`)
  }

  callbacks.onStatus?.('streaming')
  const full = await readSseStream(res.body, format, (delta) => callbacks.onToken?.(delta))
  if (!full) {
    throw new ProviderAdapterError('parse', '流式响应未产生任何内容。')
  }
  return { text: full }
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  format: ModelEndpointFormat,
  onToken: (delta: string) => void
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let acc = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return acc
      if (!data) continue
      const delta = extractDelta(format, safeJsonParse(data))
      if (delta) {
        acc += delta
        onToken(delta)
      }
    }
  }
  return acc
}

function extractDelta(format: ModelEndpointFormat, event: unknown): string {
  if (!event || typeof event !== 'object') return ''
  if (format === 'messages') {
    const type = (event as { type?: string }).type
    if (type === 'content_block_delta') {
      const delta = (event as { delta?: { text?: string } }).delta
      return delta?.text ?? ''
    }
    return ''
  }
  if (format === 'responses') {
    const type = (event as { type?: string }).type
    if (type === 'response.output_text.delta') {
      return (event as { delta?: string }).delta ?? ''
    }
    return ''
  }
  // chat_completions + custom_endpoint
  const choices = (event as { choices?: unknown }).choices
  if (Array.isArray(choices) && choices.length > 0) {
    const delta = (choices[0] as { delta?: { content?: string } })?.delta
    return delta?.content ?? ''
  }
  return ''
}

function safeJsonParse(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

function isAbortTimeout(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error)
  return /aborted|timeout/i.test(raw)
}

function networkMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/aborted|timeout/i.test(raw)) return '请求超时。'
  return `网络错误：${raw}`
}
