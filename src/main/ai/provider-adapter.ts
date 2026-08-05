import type {
  TeachingModelProviderProfile,
  TeachingSettingsV1
} from '../../shared/teaching-types'
import {
  callChatInvocation,
  callTextInvocation,
  streamChatInvocation,
  streamTextInvocation,
  type ProviderTransportDispatchHook
} from './provider-adapter/invocation'
import type { ProviderUsage } from './provider-adapter/response-parser'
import type { ProviderStopReason } from './provider-hooks'

export { toolsSupportedForFormat } from './provider-adapter/formats'
export { adapterAuthHeaders } from './provider-adapter/request-builder'
export { ProviderAdapterError, type AdapterErrorKind, type ProviderTransportDispatchHook } from './provider-adapter/invocation'

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
  /**
   * Normalized provider finish/stop reason when the adapter observed one.
   * Absent means the response body/stream did not carry a usable signal —
   * callers must not forge `stop` into the provider hook ledger.
   */
  finishReason?: ProviderStopReason
  degradedReason?: string
  usage?: ProviderUsage
}

export type ChatAdapterCallbacks = {
  onToken?: (delta: string) => void
  onReasoning?: (delta: string) => void
  onToolCalls?: (calls: ToolCall[]) => void
  onStatus?: (step: AdapterStep) => void
}

export type AdapterStep = 'calling' | 'streaming' | 'validating' | 'rendering'

export type AdapterCallbacks = {
  onToken?: (delta: string) => void
  onReasoning?: (delta: string) => void
  onStatus?: (step: AdapterStep) => void
}

export function resolveActiveProvider(
  settings: TeachingSettingsV1
): TeachingModelProviderProfile | null {
  return settings.provider.providers.find((item) => item.id === settings.generator.providerId) ??
    settings.provider.providers.find((item) => item.id === settings.provider.activeProviderId) ??
    null
}

/** Non-streaming provider call. Returns the full text response. */
export async function callProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: AdapterRequest
  callbacks?: AdapterCallbacks
  signal?: AbortSignal
  beforeTransportDispatch?: ProviderTransportDispatchHook
}): Promise<AdapterResult> {
  return callTextInvocation(opts)
}

/** Streaming provider call (SSE). Accumulates text, invoking onToken per delta. */
export async function streamProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: AdapterRequest
  callbacks: AdapterCallbacks
  signal?: AbortSignal
  beforeTransportDispatch?: ProviderTransportDispatchHook
}): Promise<AdapterResult> {
  return streamTextInvocation(opts)
}

/** Non-streaming chat call. Returns text + assembled tool_calls. */
export async function callChatProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: ChatAdapterRequest
  callbacks?: ChatAdapterCallbacks
  signal?: AbortSignal
  beforeTransportDispatch?: ProviderTransportDispatchHook
}): Promise<ChatAdapterResult> {
  return callChatInvocation(opts)
}

/** Streaming chat call. Accumulates text deltas and assembled tool calls. */
export async function streamChatProvider(opts: {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  request: ChatAdapterRequest
  callbacks: ChatAdapterCallbacks
  signal?: AbortSignal
  beforeTransportDispatch?: ProviderTransportDispatchHook
}): Promise<ChatAdapterResult> {
  return streamChatInvocation(opts)
}
