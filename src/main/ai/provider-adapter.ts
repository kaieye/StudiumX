import type {
  TeachingModelProviderProfile,
  TeachingSettingsV1
} from '../../shared/teaching-types'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import { toolsSupportedForFormat } from './provider-adapter/formats'
import { buildChatRequest, buildRequest } from './provider-adapter/request-builder'
import { extractText, extractToolCalls, extractUsage, type ProviderUsage } from './provider-adapter/response-parser'
import { readChatSseStream, readSseStream } from './provider-adapter/sse-parser'
import { redactProviderErrorText } from '../../shared/provider-error'
import { assertProviderRequestUrl } from '../../shared/provider-url-policy'

export { toolsSupportedForFormat } from './provider-adapter/formats'
export { adapterAuthHeaders } from './provider-adapter/request-builder'

export type AdapterRequest = {
  systemPrompt: string
  userPrompt: string
  /** Hint the provider to return strict JSON (where supported). */
  jsonMode: boolean
}

export type AdapterResult = { text: string; usage?: ProviderUsage }

// ---- Tool-calling (chat) types ----

export type ToolFunctionSchema = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ToolDefinition = {
  type: 'function'
  function: ToolFunctionSchema
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } }

export type ChatAdapterRequest = {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  toolChoice?: ToolChoice
  jsonMode?: boolean
}

export type ChatAdapterResult = {
  text: string
  toolCalls: ToolCall[]
  toolsSupported: boolean
  degradedReason?: string
  usage?: ProviderUsage
}

export type ChatAdapterCallbacks = {
  onToken?: (delta: string) => void
  onToolCalls?: (calls: ToolCall[]) => void
  onStatus?: (step: AdapterStep) => void
}

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

/** Non-streaming provider call. Returns the full text response. */
export async function callProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: AdapterRequest
  callbacks?: AdapterCallbacks
  signal?: AbortSignal
}): Promise<AdapterResult> {
  const { settings, provider, request, callbacks, signal } = opts
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
  assertProviderRequestUrl(url)
  callbacks?.onStatus?.('calling')
  let res: Response
  try {
    res = await fetchWithOptionalProxy(
      url,
      { ...init, signal: composeAbortSignal(settings.generator.requestTimeoutMs, signal) },
      resolveProxyUrl(settings)
    )
  } catch (e) {
    throw new ProviderAdapterError('network', networkMessage(e))
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ProviderAdapterError('http', providerHttpErrorMessage(res, body))
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
  return { text, usage: extractUsage(format, parsed) }
}

/** Streaming provider call (SSE). Accumulates text, invoking onToken per delta. */
export async function streamProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: AdapterRequest
  callbacks: AdapterCallbacks
  signal?: AbortSignal
}): Promise<AdapterResult> {
  const { settings, provider, request, callbacks, signal } = opts
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
  assertProviderRequestUrl(url)

  callbacks.onStatus?.('calling')
  let res: Response
  try {
    // First-token timeout: the absolute timeout guards time-to-first-byte;
    // once streaming starts we rely on the stream's own liveness.
    res = await fetchWithOptionalProxy(
      url,
      { ...init, signal: composeAbortSignal(settings.generator.requestTimeoutMs, signal) },
      resolveProxyUrl(settings)
    )
  } catch (e) {
    // Some providers/endpoints don't actually support SSE; fall back to a
    // single-shot non-streaming call and emit the whole text as one token.
    if (!signal?.aborted && isAbortTimeout(e)) {
      return callProvider({ settings, provider, request, callbacks, signal }).then((result) => {
        callbacks.onStatus?.('streaming')
        callbacks.onToken?.(result.text)
        return result
      })
    }
    throw new ProviderAdapterError('network', networkMessage(e))
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new ProviderAdapterError('http', providerHttpErrorMessage(res, body))
  }

  callbacks.onStatus?.('streaming')
  const full = await readSseStream(res.body, format, (delta) => callbacks.onToken?.(delta))
  if (!full) {
    throw new ProviderAdapterError('parse', '流式响应未产生任何内容。')
  }
  return { text: full }
}

function isAbortTimeout(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error)
  return /aborted|timeout/i.test(raw)
}

function composeAbortSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeoutSignal
  return AbortSignal.any([signal, timeoutSignal])
}

function networkMessage(error: unknown): string {
  const raw = redactProviderErrorText(error instanceof Error ? error.message : String(error))
  if (/aborted|timeout/i.test(raw)) return '请求超时。'
  return `网络错误：${raw}`
}

function providerHttpErrorMessage(res: Response, body: string): string {
  const redactedBody = redactProviderErrorText(body).trim().slice(0, 240)
  return redactProviderErrorText(`Provider 返回 ${res.status} ${res.statusText}${redactedBody ? `：${redactedBody}` : ''}`)
}

// ================================================================
// Tool-calling (chat) path.
// ================================================================

function isToolRejection(error: unknown): boolean {
  if (!(error instanceof ProviderAdapterError) || error.kind !== 'http') return false
  // Message shape: "Provider 返回 400 ...：..." — match a 4xx status + tool/function mention.
  return /\b4\d\d\b/.test(error.message) && /tool|function/i.test(error.message)
}

/** Non-streaming chat call. Returns text + assembled tool_calls. If the provider
 *  rejects the `tools` field with a 4xx, retries once without tools (degraded). */
export async function callChatProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: ChatAdapterRequest
  callbacks?: ChatAdapterCallbacks
  signal?: AbortSignal
}): Promise<ChatAdapterResult> {
  const { settings, provider, request, callbacks, signal } = opts
  if (!provider.apiKey.trim()) {
    throw new ProviderAdapterError('no_api_key', '未配置 API Key。')
  }
  const format = settings.generator.endpointFormat
  const supported = toolsSupportedForFormat(format)
  const includeTools = supported && Boolean(request.tools && request.tools.length > 0)
  callbacks?.onStatus?.('calling')

  const doFetch = async (withTools: boolean): Promise<unknown> => {
    const { url, init } = buildChatRequest(format, {
      provider,
      generator: settings.generator,
      request,
      stream: false,
      includeTools: withTools
    })
    assertProviderRequestUrl(url)
    let res: Response
    try {
      res = await fetchWithOptionalProxy(
        url,
        { ...init, signal: composeAbortSignal(settings.generator.requestTimeoutMs, signal) },
        resolveProxyUrl(settings)
      )
    } catch (e) {
      throw new ProviderAdapterError('network', networkMessage(e))
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderAdapterError('http', providerHttpErrorMessage(res, body))
    }
    try {
      return await res.json()
    } catch {
      throw new ProviderAdapterError('parse', 'Provider 响应不是有效 JSON。')
    }
  }

  let parsed: unknown
  let degradedReason: string | undefined
  try {
    parsed = await doFetch(includeTools)
  } catch (e) {
    if (includeTools && isToolRejection(e)) {
      degradedReason = 'provider_rejected_tools'
      parsed = await doFetch(false)
    } else {
      throw e
    }
  }

  const text = extractText(format, parsed)
  const toolCalls = extractToolCalls(format, parsed)
  if (!text && toolCalls.length === 0) {
    throw new ProviderAdapterError('parse', 'Provider 响应未包含可用的文本内容或工具调用。')
  }
  if (toolCalls.length > 0) callbacks?.onToolCalls?.(toolCalls)
  return { text, toolCalls, toolsSupported: supported, degradedReason, usage: extractUsage(format, parsed) }
}

/** Streaming chat call. Accumulates text deltas AND tool_call fragments. Falls
 *  back to non-streaming on first-token timeout (mirrors streamProvider). */
export async function streamChatProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: ChatAdapterRequest
  callbacks: ChatAdapterCallbacks
  signal?: AbortSignal
}): Promise<ChatAdapterResult> {
  const { settings, provider, request, callbacks, signal } = opts
  if (!provider.apiKey.trim()) {
    throw new ProviderAdapterError('no_api_key', '未配置 API Key。')
  }
  const format = settings.generator.endpointFormat
  const supported = toolsSupportedForFormat(format)
  const includeTools = supported && Boolean(request.tools && request.tools.length > 0)
  callbacks.onStatus?.('calling')
  const { url, init } = buildChatRequest(format, {
    provider,
    generator: settings.generator,
    request,
    stream: true,
    includeTools
  })
  assertProviderRequestUrl(url)
  let res: Response
  try {
    res = await fetchWithOptionalProxy(
      url,
      { ...init, signal: composeAbortSignal(settings.generator.requestTimeoutMs, signal) },
      resolveProxyUrl(settings)
    )
  } catch (e) {
    if (!signal?.aborted && isAbortTimeout(e)) {
      const result = await callChatProvider({ settings, provider, request, callbacks, signal })
      callbacks.onStatus?.('streaming')
      if (result.text) callbacks.onToken?.(result.text)
      if (result.toolCalls.length > 0) callbacks.onToolCalls?.(result.toolCalls)
      return result
    }
    throw new ProviderAdapterError('network', networkMessage(e))
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new ProviderAdapterError('http', providerHttpErrorMessage(res, body))
  }
  callbacks.onStatus?.('streaming')
  const { text, toolCalls } = await readChatSseStream(res.body, format, (d) => callbacks.onToken?.(d))
  if (toolCalls.length > 0) callbacks.onToolCalls?.(toolCalls)
  return { text, toolCalls, toolsSupported: supported }
}
