import type {
  ModelEndpointFormat,
  ModelReasoningEffort,
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
import { parseDsmlToolCalls, stripDsmlToolCallBlocks } from './provider-adapter/dsml-tool-calls'

export type AdapterRequest = {
  systemPrompt: string
  userPrompt: string
  /** Hint the provider to return strict JSON (where supported). */
  jsonMode: boolean
}

export type AdapterResult = { text: string }

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

function lowerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return baseUrl.toLowerCase()
  }
}

function isDeepSeekReasoningProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  const host = lowerHost(provider.baseUrl)
  return provider.id === 'deepseek' || host.includes('deepseek.com') || /^deepseek[-_.]/i.test(model)
}

function isMiniMaxOpenAiProvider(provider: TeachingModelProviderProfile): boolean {
  const host = lowerHost(provider.baseUrl)
  return host.includes('minimaxi.com') && !provider.baseUrl.toLowerCase().includes('/anthropic')
}

function supportsOpenAiReasoningEffort(provider: TeachingModelProviderProfile, model: string): boolean {
  const host = lowerHost(provider.baseUrl)
  return (
    provider.id === 'custom' ||
    provider.id === 'xiaomi' ||
    host.includes('openai.com') ||
    host.includes('xiaomimimo.com') ||
    /^mimo[-_.]/i.test(model) ||
    /^o\d/i.test(model) ||
    /^gpt-\d/i.test(model)
  )
}

function normalizeDeepSeekReasoningEffort(effort: ModelReasoningEffort): 'high' | 'max' {
  return effort === 'max' || effort === 'xhigh' ? 'max' : 'high'
}

function normalizeOpenAiReasoningEffort(effort: ModelReasoningEffort): 'low' | 'medium' | 'high' | '' {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
      return effort
    case 'xhigh':
    case 'max':
      return 'high'
    default:
      return ''
  }
}

function normalizeAnthropicReasoningEffort(effort: ModelReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | '' {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effort
    case 'auto':
      return 'high'
    default:
      return ''
  }
}

function normalizeMiniMaxThinkingType(effort: ModelReasoningEffort): 'adaptive' | 'disabled' {
  switch (effort) {
    case 'off':
    case 'xhigh':
    case 'max':
      return 'disabled'
    default:
      return 'adaptive'
  }
}

function reasoningRequestOptions(
  format: ModelEndpointFormat,
  provider: TeachingModelProviderProfile,
  generator: TeachingSettingsV1['generator']
): Record<string, unknown> {
  const effort = generator.reasoningEffort ?? 'auto'
  if (format === 'messages') return anthropicGenerationOptions(provider, generator)
  if (format === 'responses') {
    const openAiEffort = normalizeOpenAiReasoningEffort(effort)
    return openAiEffort ? { reasoning: { effort: openAiEffort } } : {}
  }
  if (isDeepSeekReasoningProvider(provider, generator.model)) {
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: normalizeDeepSeekReasoningEffort(effort)
    }
  }
  if (isMiniMaxOpenAiProvider(provider)) {
    return { thinking: { type: normalizeMiniMaxThinkingType(effort) } }
  }
  if (!supportsOpenAiReasoningEffort(provider, generator.model)) return {}
  const openAiEffort = normalizeOpenAiReasoningEffort(effort)
  return openAiEffort ? { reasoning_effort: openAiEffort } : {}
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

function isAnthropicClaudeProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  return provider.id === 'anthropic' || /^claude-(opus|sonnet|haiku|fable|mythos)/i.test(model)
}

function anthropicGenerationOptions(
  provider: TeachingModelProviderProfile,
  generator: TeachingSettingsV1['generator']
): Record<string, unknown> {
  if (isAnthropicClaudeProvider(provider, generator.model)) {
    const effort = generator.reasoningEffort ?? 'auto'
    if (effort === 'off') return {}
    const normalizedEffort = normalizeAnthropicReasoningEffort(effort)
    return {
      thinking: { type: 'adaptive' },
      ...(normalizedEffort ? { output_config: { effort: normalizedEffort } } : {})
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
    if (typeof content === 'string') return stripDsmlToolCallBlocks(content)
    if (Array.isArray(content)) {
      return stripDsmlToolCallBlocks(content.map((block) => (block as { text?: string })?.text ?? '').join(''))
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

function composeAbortSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeoutSignal
  return AbortSignal.any([signal, timeoutSignal])
}

function networkMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/aborted|timeout/i.test(raw)) return '请求超时。'
  return `网络错误：${raw}`
}

// ================================================================
// Tool-calling (chat) path — additive; legacy single-shot functions above
// are intentionally left untouched to avoid regressing the messages/responses
// branches. Tool calls are only carried on chat_completions / custom_endpoint.
// ================================================================

export function toolsSupportedForFormat(format: ModelEndpointFormat): boolean {
  return format === 'chat_completions' || format === 'custom_endpoint'
}

function buildChatRequest(
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
  // Only called for chat_completions / custom_endpoint (see toolsSupportedForFormat).
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

function extractToolCalls(format: ModelEndpointFormat, body: unknown): ToolCall[] {
  if (!toolsSupportedForFormat(format)) return []
  const choices = (body as { choices?: unknown })?.choices
  if (!Array.isArray(choices) || choices.length === 0) return []
  const msg = (choices[0] as { message?: { content?: unknown; tool_calls?: unknown } })?.message
  const calls = msg?.tool_calls
  const nativeCalls = Array.isArray(calls)
    ? calls
        .map((c): ToolCall | null => {
          const fn = (c as { function?: { name?: string; arguments?: string } })?.function
          const id = (c as { id?: string })?.id
          if (!fn || !fn.name || !id) return null
          return { id, type: 'function', function: { name: fn.name, arguments: fn.arguments ?? '{}' } }
        })
        .filter((c): c is ToolCall => c !== null)
    : []
  const content = msg?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((block) => (block as { text?: string })?.text ?? '').join('')
      : ''
  return [...nativeCalls, ...parseDsmlToolCalls(text)]
}

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
      throw new ProviderAdapterError('http', `Provider 返回 ${res.status} ${res.statusText}${body ? `：${body.slice(0, 240)}` : ''}`)
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
  return { text, toolCalls, toolsSupported: supported, degradedReason }
}

type ToolCallFragment = {
  index: number
  id?: string
  name?: string
  arguments?: string
}

function extractChatDelta(format: ModelEndpointFormat, event: unknown): {
  content?: string
  toolCalls?: ToolCallFragment[]
} {
  if (!event || typeof event !== 'object') return {}
  if (!toolsSupportedForFormat(format)) {
    const content = extractDelta(format, event)
    return content ? { content } : {}
  }
  const choices = (event as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return {}
  const delta = (choices[0] as { delta?: { content?: string; tool_calls?: unknown } })?.delta
  if (!delta) return {}
  const out: { content?: string; toolCalls?: ToolCallFragment[] } = {}
  if (typeof delta.content === 'string') out.content = delta.content
  if (Array.isArray(delta.tool_calls)) {
    out.toolCalls = delta.tool_calls.map((f) => {
      const fn = (f as { function?: { name?: string; arguments?: string } }).function ?? {}
      return {
        index: typeof (f as { index?: number }).index === 'number' ? (f as { index: number }).index : 0,
        id: (f as { id?: string }).id,
        name: fn.name,
        arguments: fn.arguments
      }
    })
  }
  return out
}

function assembleStream(
  textAcc: string,
  toolAcc: Map<number, { index: number; id?: string; name?: string; arguments: string }>
): { text: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = []
  for (const slot of toolAcc.values()) {
    if (!slot.id || !slot.name) continue
    toolCalls.push({
      id: slot.id,
      type: 'function',
      function: { name: slot.name, arguments: slot.arguments || '{}' }
    })
  }
  return { text: textAcc, toolCalls }
}

async function readChatSseStream(
  body: ReadableStream<Uint8Array>,
  format: ModelEndpointFormat,
  onToken?: (delta: string) => void
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let textAcc = ''
  const toolAcc = new Map<number, { index: number; id?: string; name?: string; arguments: string }>()
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
      if (data === '[DONE]') return assembleStream(textAcc, toolAcc)
      if (!data) continue
      const delta = extractChatDelta(format, safeJsonParse(data))
      if (delta.content) {
        textAcc += delta.content
        onToken?.(delta.content)
      }
      if (delta.toolCalls) {
        for (const f of delta.toolCalls) {
          const slot = toolAcc.get(f.index) ?? { index: f.index, arguments: '' }
          if (f.id) slot.id = f.id
          if (f.name) slot.name = f.name
          if (typeof f.arguments === 'string') slot.arguments += f.arguments
          toolAcc.set(f.index, slot)
        }
      }
    }
  }
  return assembleStream(textAcc, toolAcc)
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
    throw new ProviderAdapterError('http', `Provider 返回 ${res.status} ${res.statusText}${body ? `：${body.slice(0, 240)}` : ''}`)
  }
  callbacks.onStatus?.('streaming')
  const { text, toolCalls } = await readChatSseStream(res.body, format, (d) => callbacks.onToken?.(d))
  if (toolCalls.length > 0) callbacks.onToolCalls?.(toolCalls)
  return { text, toolCalls, toolsSupported: supported }
}
