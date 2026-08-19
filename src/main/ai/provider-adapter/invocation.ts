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
import {
  extractFinishReason,
  extractText,
  extractToolCalls,
  extractUsage,
  hasReasoningContent,
  type ProviderUsage
} from './response-parser'
import { readChatSseStream, readSseStream } from './sse-parser'
import type { StructuredOutputReasoningPolicy } from './capabilities'

export type AdapterErrorKind = 'no_api_key' | 'network' | 'http' | 'parse' | 'timeout' | 'unsupported'

export type ProviderAdapterErrorCode = 'reasoning_only' | 'empty_output'

export type ProviderTransportDispatchHook = () => void | Promise<void>

export class ProviderAdapterError extends Error {
  readonly kind: AdapterErrorKind
  readonly code?: ProviderAdapterErrorCode
  readonly usage?: ProviderUsage

  constructor(
    kind: AdapterErrorKind,
    message: string,
    code?: ProviderAdapterErrorCode,
    usage?: ProviderUsage
  ) {
    super(message)
    this.name = 'ProviderAdapterError'
    this.kind = kind
    this.code = code
    this.usage = usage
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
  const fallbackState = createStructuredOutputFallbackState()
  return withStructuredOutputFallback(opts.request.jsonMode, async (reasoningPolicy) => {
    const parsed = await requestJson(opts, () => buildRequest(format, {
      provider: opts.provider,
      generator: opts.settings.generator,
      request: opts.request,
      stream: false,
      reasoningPolicy
    }))
    const text = extractText(format, parsed)
    if (!text) {
      throw emptyProviderOutputError(format, parsed, 'Provider 响应未包含可用的文本内容。', opts.request.jsonMode)
    }
    return { text, usage: extractUsage(format, parsed) }
  }, fallbackState)
}

export async function streamTextInvocation(opts: InvocationBase & {
  request: AdapterRequest
  callbacks: AdapterCallbacks
}): Promise<AdapterResult> {
  ensureApiKey(opts.provider)
  opts.callbacks.onStatus?.('calling')
  const format = opts.settings.generator.endpointFormat
  const fallbackState = createStructuredOutputFallbackState()
  const run = async (reasoningPolicy?: StructuredOutputReasoningPolicy): Promise<AdapterResult> => {
    const response = await requestResponse(opts, () => buildRequest(format, {
      provider: opts.provider,
      generator: opts.settings.generator,
      request: opts.request,
      stream: true,
      reasoningPolicy
    }))

    if (!response.ok || !response.body) throw await toHttpError(response)
    if (response.headers.get('content-type')?.includes('application/json')) {
      const parsed = await response.json()
      const text = extractText(format, parsed)
      if (!text) {
        throw emptyProviderOutputError(format, parsed, 'Provider 响应未包含可用的文本内容。', opts.request.jsonMode)
      }
      emitStreamingText(opts.callbacks, text)
      return { text, usage: extractUsage(format, parsed) }
    }
    opts.callbacks.onStatus?.('streaming')
    const result = await readSseStream(
      response.body,
      format,
      (delta) => opts.callbacks.onToken?.(delta),
      (delta) => opts.callbacks.onReasoning?.(delta)
    )
    if (!result.text) {
      throw emptyProviderOutputError(
        format,
        result,
        '流式响应未产生任何内容。',
        opts.request.jsonMode,
        result.hadReasoning === true,
        result.usage
      )
    }
    return {
      text: result.text,
      ...(result.usage ? { usage: result.usage } : {})
    }
  }

  try {
    return await withStructuredOutputFallback(opts.request.jsonMode, run, fallbackState)
  } catch (error) {
    if (!shouldFallbackAfterFirstTokenTimeout(error, opts.signal)) throw error
    const fallback = await withStructuredOutputFallback(
      opts.request.jsonMode,
      (reasoningPolicy) => requestTextWithoutCallbacks(opts, reasoningPolicy),
      fallbackState
    )
    emitStreamingText(opts.callbacks, fallback.text)
    return fallback
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
  const fallbackState = createStructuredOutputFallbackState()

  type StreamRun = { result: ChatAdapterResult; streamed: boolean }
  const run = async (
    withTools: boolean,
    reasoningPolicy?: StructuredOutputReasoningPolicy
  ): Promise<StreamRun> => {
    const response = await requestResponse(opts, () => buildChatRequest(format, {
      provider: opts.provider,
      generator: opts.settings.generator,
      request: opts.request,
      stream: true,
      includeTools: withTools,
      reasoningPolicy
    }))

    if (!response.ok || !response.body) throw await toHttpError(response)

    if (response.headers.get('content-type')?.includes('application/json')) {
      const parsed = await response.json()
      const text = extractText(format, parsed)
      const toolCalls = extractToolCalls(format, parsed)
      if (!text && toolCalls.length === 0) {
        throw emptyProviderOutputError(
          format,
          parsed,
          'Provider 响应未包含可用的文本内容或工具调用。',
          opts.request.jsonMode === true
        )
      }
      const finishReason = extractFinishReason(format, parsed)
      return {
        streamed: false,
        result: {
          text,
          toolCalls,
          toolsSupported,
          ...(finishReason ? { finishReason } : {}),
          usage: extractUsage(format, parsed)
        }
      }
    }

    opts.callbacks.onStatus?.('streaming')
    const streamed = await readChatSseStream(
      response.body,
      format,
      (delta) => opts.callbacks.onToken?.(delta),
      (delta) => opts.callbacks.onReasoning?.(delta)
    )
    if (!streamed.text && streamed.toolCalls.length === 0) {
      throw emptyProviderOutputError(
        format,
        streamed,
        '流式响应未返回任何内容或工具调用。',
        opts.request.jsonMode === true,
        streamed.hadReasoning === true,
        streamed.usage
      )
    }
    return {
      streamed: true,
      result: {
        text: streamed.text,
        toolCalls: streamed.toolCalls,
        toolsSupported,
        ...(streamed.finishReason ? { finishReason: streamed.finishReason } : {}),
        ...(streamed.usage ? { usage: streamed.usage } : {})
      }
    }
  }

  const emitOutcome = (outcome: StreamRun, result: ChatAdapterResult = outcome.result): void => {
    if (outcome.streamed) emitToolCalls(opts.callbacks, result.toolCalls)
    else emitStreamingChat(opts.callbacks, result)
  }

  try {
    const outcome = await withStructuredOutputFallback(
      opts.request.jsonMode === true,
      (reasoningPolicy) => run(includeTools, reasoningPolicy),
      fallbackState
    )
    emitOutcome(outcome)
    return outcome.result
  } catch (error) {
    if (includeTools && isToolRejection(error)) {
      const fallback = await withStructuredOutputFallback(
        opts.request.jsonMode === true,
        (reasoningPolicy) => run(false, reasoningPolicy),
        fallbackState
      )
      const result = { ...fallback.result, degradedReason: 'provider_rejected_tools' as const }
      emitOutcome(fallback, result)
      return result
    }
    // Preserve the historical non-stream recovery for ordinary chat streams,
    // but do not turn a strict-JSON empty response into an unbounded retry.
    if (error instanceof ProviderAdapterError && error.code === 'empty_output' && opts.request.jsonMode !== true) {
      if (!opts.signal?.aborted) {
        try {
          const fallback = await requestChatJson(opts, undefined, fallbackState)
          emitStreamingChat(opts.callbacks, fallback.result)
          return fallback.result
        } catch {
          // Keep the original empty-stream diagnosis when the retry also fails.
        }
      }
    }
    if (!shouldFallbackAfterFirstTokenTimeout(error, opts.signal)) throw error
    const fallback = await requestChatJson(opts, undefined, fallbackState)
    emitStreamingChat(opts.callbacks, fallback.result)
    return fallback.result
  }
}

async function requestTextWithoutCallbacks(
  opts: InvocationBase & { request: AdapterRequest },
  reasoningPolicy?: StructuredOutputReasoningPolicy
): Promise<AdapterResult> {
  const format = opts.settings.generator.endpointFormat
  const parsed = await requestJson(opts, () => buildRequest(format, {
    provider: opts.provider,
    generator: opts.settings.generator,
    request: opts.request,
    stream: false,
    reasoningPolicy
  }))
  const text = extractText(format, parsed)
  if (!text) {
    throw emptyProviderOutputError(format, parsed, 'Provider 响应未包含可用的文本内容。', opts.request.jsonMode)
  }
  return { text, usage: extractUsage(format, parsed) }
}

async function requestChatJson(
  opts: InvocationBase & { request: ChatAdapterRequest },
  forceIncludeTools?: boolean,
  fallbackState = createStructuredOutputFallbackState()
): Promise<ChatJsonResult> {
  const format = opts.settings.generator.endpointFormat
  const toolsSupported = toolsSupportedForFormat(format)
  const initialTools = forceIncludeTools ?? (toolsSupported && Boolean(opts.request.tools?.length))
  const run = async (
    includeTools: boolean,
    reasoningPolicy?: StructuredOutputReasoningPolicy
  ): Promise<ChatAdapterResult> => {
    const parsed = await requestJson(opts, () => buildChatRequest(format, {
      provider: opts.provider,
      generator: opts.settings.generator,
      request: opts.request,
      stream: false,
      includeTools,
      reasoningPolicy
    }))
    const text = extractText(format, parsed)
    const toolCalls = extractToolCalls(format, parsed)
    if (!text && toolCalls.length === 0) {
      throw emptyProviderOutputError(
        format,
        parsed,
        'Provider 响应未包含可用的文本内容或工具调用。',
        opts.request.jsonMode === true
      )
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
    return {
      result: await withStructuredOutputFallback(
        opts.request.jsonMode === true,
        (reasoningPolicy) => run(initialTools, reasoningPolicy),
        fallbackState
      )
    }
  } catch (error) {
    if (!initialTools || !isToolRejection(error)) throw error
    const result = await withStructuredOutputFallback(
      opts.request.jsonMode === true,
      (reasoningPolicy) => run(false, reasoningPolicy),
      fallbackState
    )
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

type StructuredOutputFallbackResult =
  | { usage?: ProviderUsage }
  | { result: { usage?: ProviderUsage } }

type StructuredOutputFallbackState = {
  retryUsed: boolean
  reasoningPolicy?: StructuredOutputReasoningPolicy
  usage?: ProviderUsage
}

function createStructuredOutputFallbackState(): StructuredOutputFallbackState {
  return { retryUsed: false }
}

async function withStructuredOutputFallback<T extends StructuredOutputFallbackResult>(
  jsonMode: boolean,
  run: (reasoningPolicy?: StructuredOutputReasoningPolicy) => Promise<T>,
  state: StructuredOutputFallbackState
): Promise<T> {
  try {
    return mergeStructuredOutputAttemptUsage(await run(state.reasoningPolicy), state.usage)
  } catch (error) {
    if (!jsonMode || state.retryUsed || !shouldRetryStructuredOutputCompatibility(error)) {
      throw mergeProviderAdapterErrorUsage(error, state.usage)
    }
    // Exactly one compatibility retry across the whole logical invocation,
    // including stream→non-stream and tools→no-tools recovery transports.
    // All later transports retain policy='omit' instead of reintroducing a
    // guessed provider-specific reasoning control.
    state.retryUsed = true
    state.reasoningPolicy = 'omit'
    if (error instanceof ProviderAdapterError) {
      state.usage = mergeProviderUsage(state.usage, error.usage)
    }
    try {
      return mergeStructuredOutputAttemptUsage(await run(state.reasoningPolicy), state.usage)
    } catch (retryError) {
      throw mergeProviderAdapterErrorUsage(retryError, state.usage)
    }
  }
}

function mergeStructuredOutputAttemptUsage<T extends StructuredOutputFallbackResult>(
  result: T,
  firstUsage: ProviderUsage | undefined
): T {
  if (!firstUsage) return result
  if ('result' in result) {
    return {
      ...result,
      result: {
        ...result.result,
        usage: mergeProviderUsage(firstUsage, result.result.usage)
      }
    } as T
  }
  return {
    ...result,
    usage: mergeProviderUsage(firstUsage, result.usage)
  } as T
}

function mergeProviderAdapterErrorUsage(
  error: unknown,
  firstUsage: ProviderUsage | undefined
): unknown {
  if (!(error instanceof ProviderAdapterError) || !firstUsage) return error
  const merged = new ProviderAdapterError(
    error.kind,
    error.message,
    error.code,
    mergeProviderUsage(firstUsage, error.usage)
  )
  merged.stack = error.stack
  return merged
}

function mergeProviderUsage(
  first: ProviderUsage | undefined,
  second: ProviderUsage | undefined
): ProviderUsage | undefined {
  if (!first) return second
  if (!second) return first
  const promptTokens = sumDefined(first.promptTokens, second.promptTokens)
  const completionTokens = sumDefined(first.completionTokens, second.completionTokens)
  const totalTokens = sumDefined(first.totalTokens, second.totalTokens)
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  }
}

function sumDefined(first: number | undefined, second: number | undefined): number | undefined {
  if (first === undefined && second === undefined) return undefined
  return (first ?? 0) + (second ?? 0)
}

function shouldRetryStructuredOutputCompatibility(error: unknown): boolean {
  if (!(error instanceof ProviderAdapterError)) return false
  if (error.code === 'reasoning_only') return true
  return isReasoningParameterRejection(error)
}

function isReasoningParameterRejection(error: ProviderAdapterError): boolean {
  if (error.kind !== 'http' || !/\b(?:400|422)\b/.test(error.message)) return false
  const message = error.message.toLowerCase()
  const mentionsReasoning = /reasoning|thinking/.test(message)
  const mentionsUnsupportedParameter = /unsupported|unknown|unrecognized|invalid|not allowed|not support/.test(message)
  const mentionsStructuredConflict = /response[_ -]?format/.test(message) && mentionsReasoning
  return mentionsReasoning && (mentionsUnsupportedParameter || mentionsStructuredConflict)
}

function emptyProviderOutputError(
  format: Parameters<typeof hasReasoningContent>[0],
  body: unknown,
  message: string,
  jsonMode: boolean,
  hadReasoningOverride?: boolean,
  usageOverride?: ProviderUsage
): ProviderAdapterError {
  const hadReasoning = hadReasoningOverride ?? hasReasoningContent(format, body)
  return new ProviderAdapterError(
    'parse',
    message,
    jsonMode && hadReasoning ? 'reasoning_only' : 'empty_output',
    usageOverride ?? extractUsage(format, body)
  )
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
