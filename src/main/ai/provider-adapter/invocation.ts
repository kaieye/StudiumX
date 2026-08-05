import type {
  TeachingModelProviderProfile,
  TeachingSettingsV1
} from '../../../shared/teaching-types'
import { redactProviderErrorText } from '../../../shared/provider-error'
import { assertProviderRequestUrl } from '../../../shared/provider-url-policy'
import { fetchWithOptionalProxy } from '../../proxy-fetch'
import type {
  AdapterCallbacks,
  AdapterRequest,
  AdapterResult,
  ChatAdapterCallbacks,
  ChatAdapterRequest,
  ChatAdapterResult,
  ToolCall
} from '../provider-adapter'
import { toolsSupportedForFormat } from './formats'
import { buildChatRequest, buildRequest } from './request-builder'
import { extractFinishReason, extractText, extractToolCalls, extractUsage } from './response-parser'
import { readChatSseStream, readSseStream } from './sse-parser'

export type AdapterErrorKind = 'no_api_key' | 'network' | 'http' | 'parse' | 'timeout' | 'unsupported'

export type ProviderTransportDispatchHook = () => void | Promise<void>

export class ProviderAdapterError extends Error {
  readonly kind: AdapterErrorKind

  constructor(kind: AdapterErrorKind, message: string) {
    super(message)
    this.name = 'ProviderAdapterError'
    this.kind = kind
  }
}

type InvocationBase = {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  signal?: AbortSignal
  /** Host-owned preflight invoked once immediately before each network dispatch. */
  beforeTransportDispatch?: ProviderTransportDispatchHook
}

type JsonRequest = {
  url: string
  init: RequestInit
}

type ChatJsonResult = {
  result: ChatAdapterResult
  degradedReason?: string
}

/**
 * Deep provider invocation module. Its interface is the four stable caller
 * shapes; request builders, response parsers and endpoint formats remain the
 * concrete adapters behind this seam.
 */
export async function callTextInvocation(opts: InvocationBase & {
  request: AdapterRequest
  callbacks?: AdapterCallbacks
}): Promise<AdapterResult> {
  ensureApiKey(opts.provider)
  opts.callbacks?.onStatus?.('calling')
  const format = opts.settings.generator.endpointFormat
  const parsed = await requestJson(opts, () => buildRequest(format, {
    provider: opts.provider,
    generator: opts.settings.generator,
    request: opts.request,
    stream: false
  }))
  const text = extractText(format, parsed)
  if (!text) throw new ProviderAdapterError('parse', 'Provider 响应未包含可用的文本内容。')
  return { text, usage: extractUsage(format, parsed) }
}

export async function streamTextInvocation(opts: InvocationBase & {
  request: AdapterRequest
  callbacks: AdapterCallbacks
}): Promise<AdapterResult> {
  ensureApiKey(opts.provider)
  opts.callbacks.onStatus?.('calling')
  const format = opts.settings.generator.endpointFormat
  const build = (): JsonRequest => buildRequest(format, {
    provider: opts.provider,
    generator: opts.settings.generator,
    request: opts.request,
    stream: true
  })

  let response: Response
  try {
    response = await requestResponse(opts, build)
  } catch (error) {
    if (!shouldFallbackAfterFirstTokenTimeout(error, opts.signal)) throw error
    const fallback = await requestTextWithoutCallbacks(opts)
    emitStreamingText(opts.callbacks, fallback.text)
    return fallback
  }

  if (!response.ok || !response.body) throw await toHttpError(response)
  if (response.headers.get('content-type')?.includes('application/json')) {
    const parsed = await response.json()
    const text = extractText(format, parsed)
    if (!text) throw new ProviderAdapterError('parse', 'Provider 响应未包含可用的文本内容。')
    emitStreamingText(opts.callbacks, text)
    return { text, usage: extractUsage(format, parsed) }
  }
  const body = response.body
  opts.callbacks.onStatus?.('streaming')
  const { text, usage } = await readSseStream(
    body,
    format,
    (delta) => opts.callbacks.onToken?.(delta),
    (delta) => opts.callbacks.onReasoning?.(delta)
  )
  if (!text) throw new ProviderAdapterError('parse', '流式响应未产生任何内容。')
  return {
    text,
    ...(usage ? { usage } : {})
  }
}

export async function callChatInvocation(opts: InvocationBase & {
  request: ChatAdapterRequest
  callbacks?: ChatAdapterCallbacks
}): Promise<ChatAdapterResult> {
  ensureApiKey(opts.provider)
  opts.callbacks?.onStatus?.('calling')
  const resolved = await requestChatJson(opts)
  emitToolCalls(opts.callbacks, resolved.result.toolCalls)
  return resolved.result
}

export async function streamChatInvocation(opts: InvocationBase & {
  request: ChatAdapterRequest
  callbacks: ChatAdapterCallbacks
}): Promise<ChatAdapterResult> {
  ensureApiKey(opts.provider)
  opts.callbacks.onStatus?.('calling')
  const format = opts.settings.generator.endpointFormat
  const toolsSupported = toolsSupportedForFormat(format)
  const includeTools = toolsSupported && Boolean(opts.request.tools?.length)
  const build = (withTools: boolean): JsonRequest => buildChatRequest(format, {
    provider: opts.provider,
    generator: opts.settings.generator,
    request: opts.request,
    stream: true,
    includeTools: withTools
  })

  let response: Response
  try {
    response = await requestResponse(opts, () => build(includeTools))
  } catch (error) {
    if (includeTools && isToolRejection(error)) {
      const fallback = await requestChatJson(opts, false)
      const result = { ...fallback.result, degradedReason: 'provider_rejected_tools' as const }
      emitStreamingChat(opts.callbacks, result)
      return result
    }
    if (!shouldFallbackAfterFirstTokenTimeout(error, opts.signal)) throw error
    const fallback = await requestChatJson(opts)
    emitStreamingChat(opts.callbacks, fallback.result)
    return fallback.result
  }

  if (!response.ok || !response.body) {
    const error = await toHttpError(response)
    if (includeTools && isToolRejection(error)) {
      const fallback = await requestChatJson(opts, false)
      const result = { ...fallback.result, degradedReason: 'provider_rejected_tools' as const }
      emitStreamingChat(opts.callbacks, result)
      return result
    }
    throw error
  }

  if (response.headers.get('content-type')?.includes('application/json')) {
    const parsed = await response.json()
    const text = extractText(format, parsed)
    const toolCalls = extractToolCalls(format, parsed)
    if (!text && toolCalls.length === 0) {
      throw new ProviderAdapterError('parse', 'Provider 响应未包含可用的文本内容或工具调用。')
    }
    const finishReason = extractFinishReason(format, parsed)
    const result: ChatAdapterResult = {
      text,
      toolCalls,
      toolsSupported,
      ...(finishReason ? { finishReason } : {}),
      usage: extractUsage(format, parsed)
    }
    emitStreamingChat(opts.callbacks, result)
    return result
  }

  opts.callbacks.onStatus?.('streaming')
  const { text, toolCalls, finishReason, usage } = await readChatSseStream(
    response.body,
    format,
    (delta) => opts.callbacks.onToken?.(delta),
    (delta) => opts.callbacks.onReasoning?.(delta)
  )
  if (!text && toolCalls.length === 0) {
    // Successful HTTP + empty SSE is a common OpenAI-compatible host quirk
    // (reasoning-only chunks, partial tool fragments, content part arrays).
    // One non-stream retry recovers usable output without masking hard HTTP errors.
    if (!opts.signal?.aborted) {
      try {
        const fallback = await requestChatJson(opts)
        emitStreamingChat(opts.callbacks, fallback.result)
        return fallback.result
      } catch {
        // Keep the original empty-stream diagnosis when the retry also fails.
      }
    }
    throw new ProviderAdapterError('parse', '流式响应未返回任何内容或工具调用。')
  }
  const result: ChatAdapterResult = {
    text,
    toolCalls,
    toolsSupported,
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {})
  }
  emitToolCalls(opts.callbacks, toolCalls)
  return result
}

async function requestTextWithoutCallbacks(opts: InvocationBase & { request: AdapterRequest }): Promise<AdapterResult> {
  const format = opts.settings.generator.endpointFormat
  const parsed = await requestJson(opts, () => buildRequest(format, {
    provider: opts.provider,
    generator: opts.settings.generator,
    request: opts.request,
    stream: false
  }))
  const text = extractText(format, parsed)
  if (!text) throw new ProviderAdapterError('parse', 'Provider 响应未包含可用的文本内容。')
  return { text, usage: extractUsage(format, parsed) }
}

async function requestChatJson(
  opts: InvocationBase & { request: ChatAdapterRequest },
  forceIncludeTools?: boolean
): Promise<ChatJsonResult> {
  const format = opts.settings.generator.endpointFormat
  const toolsSupported = toolsSupportedForFormat(format)
  const initialTools = forceIncludeTools ?? (toolsSupported && Boolean(opts.request.tools?.length))
  const run = async (includeTools: boolean): Promise<ChatAdapterResult> => {
    const parsed = await requestJson(opts, () => buildChatRequest(format, {
      provider: opts.provider,
      generator: opts.settings.generator,
      request: opts.request,
      stream: false,
      includeTools
    }))
    const text = extractText(format, parsed)
    const toolCalls = extractToolCalls(format, parsed)
    if (!text && toolCalls.length === 0) {
      throw new ProviderAdapterError('parse', 'Provider 响应未包含可用的文本内容或工具调用。')
    }
    const finishReason = extractFinishReason(format, parsed)
    return {
      text,
      toolCalls,
      toolsSupported,
      ...(finishReason ? { finishReason } : {}),
      usage: extractUsage(format, parsed)
    }
  }

  try {
    return { result: await run(initialTools) }
  } catch (error) {
    if (!initialTools || !isToolRejection(error)) throw error
    const result = await run(false)
    return { result: { ...result, degradedReason: 'provider_rejected_tools' }, degradedReason: 'provider_rejected_tools' }
  }
}

async function requestJson(base: InvocationBase, build: () => JsonRequest): Promise<unknown> {
  const response = await requestResponse(base, build)
  if (!response.ok) throw await toHttpError(response)
  try {
    return await response.json()
  } catch {
    throw new ProviderAdapterError('parse', 'Provider 响应不是有效 JSON。')
  }
}

async function requestResponse(base: InvocationBase, build: () => JsonRequest): Promise<Response> {
  const { url, init } = build()
  assertProviderRequestUrl(url)
  // Fallbacks inside this adapter can issue additional requests. Keep the
  // resource preflight outside the network-error wrapper so a host boundary
  // stays distinguishable from provider connectivity failures.
  await base.beforeTransportDispatch?.()
  try {
    return await fetchWithOptionalProxy(
      url,
      { ...init, signal: composeAbortSignal(base.settings.generator.requestTimeoutMs, base.signal) },
      resolveProxyUrl(base.settings)
    )
  } catch (error) {
    throw new ProviderAdapterError('network', networkMessage(error))
  }
}


async function toHttpError(response: Response): Promise<ProviderAdapterError> {
  const body = await response.text().catch(() => '')
  return new ProviderAdapterError('http', providerHttpErrorMessage(response, body))
}

function ensureApiKey(provider: TeachingModelProviderProfile): void {
  if (!provider.apiKey.trim()) throw new ProviderAdapterError('no_api_key', '未配置 API Key。')
}

function resolveProxyUrl(settings: TeachingSettingsV1): string {
  return settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
}

function composeAbortSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function shouldFallbackAfterFirstTokenTimeout(error: unknown, callerSignal?: AbortSignal): boolean {
  if (callerSignal?.aborted) return false
  if (!(error instanceof ProviderAdapterError) || error.kind !== 'network') return false
  return /请求超时|timeout/i.test(error.message)
}

function networkMessage(error: unknown): string {
  const raw = redactProviderErrorText(error instanceof Error ? error.message : String(error))
  if (/aborted|timeout/i.test(raw)) return '请求超时。'
  return `网络错误：${raw}`
}

function providerHttpErrorMessage(response: Response, body: string): string {
  const redactedBody = redactProviderErrorText(body).trim().slice(0, 240)
  return redactProviderErrorText(
    `Provider 返回 ${response.status} ${response.statusText}${redactedBody ? `：${redactedBody}` : ''}`
  )
}

function isToolRejection(error: unknown): boolean {
  return error instanceof ProviderAdapterError &&
    error.kind === 'http' &&
    /\b4\d\d\b/.test(error.message) &&
    /tool|function/i.test(error.message)
}

function emitStreamingText(callbacks: AdapterCallbacks, text: string): void {
  callbacks.onStatus?.('streaming')
  callbacks.onToken?.(text)
}

function emitStreamingChat(callbacks: ChatAdapterCallbacks, result: ChatAdapterResult): void {
  callbacks.onStatus?.('streaming')
  if (result.text) callbacks.onToken?.(result.text)
  emitToolCalls(callbacks, result.toolCalls)
}

function emitToolCalls(callbacks: ChatAdapterCallbacks | undefined, toolCalls: ToolCall[]): void {
  if (toolCalls.length > 0) callbacks?.onToolCalls?.(toolCalls)
}
