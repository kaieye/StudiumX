import type { AgentRunUsageProvenance } from '../../shared/teaching-types'
import { redactProviderErrorText } from '../../shared/provider-error'

/**
 * Normalized SDK/provider run hooks.
 *
 * The agent loop and UI depend only on this stable contract; concrete SDK
 * clients translate their private event shapes into {@link ProviderHookEvent}
 * values. The {@link ProviderHookLedger} is the single idempotent sink: the
 * same event arriving twice (or out of order) never double-counts a call,
 * double-ends a run, or corrupts the aggregated usage snapshot.
 */

/** How a token usage figure was obtained. `unknown` means no figure at all. */
export type ProviderUsageSource = 'provider_reported' | 'local_estimate'

/** Normalized provider stop reasons; free-text values fold into `other`. */
export type ProviderStopReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'canceled' | 'error' | 'other'

export type ProviderTokenUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * A provider metadata bag after normalization: string keys mapped to bounded
 * primitive values. Never carries SDK private objects into persistence.
 */
export type ProviderMetadata = Record<string, string | number | boolean>

export type ProviderHookEvent =
  | { kind: 'request_started'; callId: string; attempt?: number; at?: number; metadata?: ProviderMetadata }
  | { kind: 'first_token'; callId: string; at?: number }
  | { kind: 'usage'; callId: string; usage: ProviderTokenUsage; source?: ProviderUsageSource }
  | { kind: 'retry'; callId: string; attempt: number; reason?: string; delayMs?: number }
  | { kind: 'rate_limit'; callId: string; attempt?: number; retryAfterMs?: number }
  | { kind: 'stop'; callId: string; reason?: string; at?: number }
  | { kind: 'canceled'; callId: string; at?: number }
  | { kind: 'error'; callId: string; message?: string; at?: number }

export type ProviderHookSink = (event: ProviderHookEvent) => void

export type ProviderHookSnapshot = {
  /** Distinct call ids that emitted a request_started event. */
  calls: number
  /** Calls whose terminal event was a normal stop. */
  completed: number
  /** Calls whose terminal event was a cancel. */
  canceled: number
  /** Calls whose terminal event was an error. */
  errored: number
  /** Total retry attempts observed (deduped per call+attempt). */
  retries: number
  /** Distinct rate-limit signals observed (deduped per call+attempt). */
  rateLimited: number
  /** Earliest first-token latency across calls, if any call reported one. */
  firstTokenAtMs?: number
  usage: ProviderTokenUsage
  /** Provenance of the aggregated usage; `unknown` when no usage was reported. */
  usageProvenance: AgentRunUsageProvenance
  /** True when at least one completed call reported no usage at all. */
  hasUnknownUsage: boolean
  /** Normalized terminal stop reasons keyed by call, most recent per call. */
  stopReasons: ProviderStopReason[]
  /** Last redacted error text, if any error was recorded. */
  lastError?: string
}

const MAX_METADATA_KEYS = 24
const MAX_METADATA_KEY_LENGTH = 64
const MAX_METADATA_VALUE_LENGTH = 512
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|access[_-]?token|secret|password|bearer|cookie|session)/i

type CallState = {
  started: boolean
  firstTokenAtMs?: number
  usage?: ProviderTokenUsage
  usageSource?: ProviderUsageSource
  /** Attempts (>=1) already counted, so duplicate retry callbacks are free. */
  retries: Set<number>
  rateLimits: Set<number>
  terminal?: 'stop' | 'canceled' | 'error'
  stopReason?: ProviderStopReason
  errorText?: string
}

/**
 * Idempotent accumulator for one run's provider events. Records are keyed by
 * call id; terminal outcomes use first-wins so a duplicate or racing terminal
 * callback cannot flip a settled call. Usage within a call uses last-wins so a
 * streaming provider can report a partial figure then a final total.
 */
export class ProviderHookLedger {
  private readonly calls = new Map<string, CallState>()

  record(event: ProviderHookEvent): void {
    const state = this.ensure(event.callId)
    switch (event.kind) {
      case 'request_started':
        state.started = true
        return
      case 'first_token':
        // Earliest wins; ignore later or duplicate first-token signals.
        if (event.at !== undefined && (state.firstTokenAtMs === undefined || event.at < state.firstTokenAtMs)) {
          state.firstTokenAtMs = event.at
        }
        return
      case 'usage':
        state.usage = mergeUsage(state.usage, event.usage)
        // A local estimate anywhere downgrades the call's provenance.
        if (event.source === 'local_estimate' || state.usageSource === 'local_estimate') {
          state.usageSource = 'local_estimate'
        } else {
          state.usageSource = 'provider_reported'
        }
        return
      case 'retry':
        if (event.attempt >= 1) state.retries.add(event.attempt)
        return
      case 'rate_limit':
        state.rateLimits.add(event.attempt ?? 0)
        return
      case 'stop':
        if (!state.terminal) {
          state.terminal = 'stop'
          state.stopReason = normalizeStopReason(event.reason)
        }
        return
      case 'canceled':
        if (!state.terminal) {
          state.terminal = 'canceled'
          state.stopReason = 'canceled'
        }
        return
      case 'error':
        if (!state.terminal) {
          state.terminal = 'error'
          state.stopReason = 'error'
        }
        // Keep the latest error text for surfacing; always redacted.
        if (event.message) state.errorText = redactProviderErrorText(event.message).slice(0, MAX_METADATA_VALUE_LENGTH)
        return
    }
  }

  snapshot(): ProviderHookSnapshot {
    let completed = 0
    let canceled = 0
    let errored = 0
    let retries = 0
    let rateLimited = 0
    let firstTokenAtMs: number | undefined
    let hasUnknownUsage = false
    let anyProviderReported = false
    let anyLocalEstimate = false
    let lastError: string | undefined
    const usage: ProviderTokenUsage = {}
    const stopReasons: ProviderStopReason[] = []

    for (const state of this.calls.values()) {
      if (state.terminal === 'stop') completed += 1
      else if (state.terminal === 'canceled') canceled += 1
      else if (state.terminal === 'error') errored += 1
      retries += state.retries.size
      rateLimited += state.rateLimits.size
      if (state.firstTokenAtMs !== undefined) {
        firstTokenAtMs = firstTokenAtMs === undefined ? state.firstTokenAtMs : Math.min(firstTokenAtMs, state.firstTokenAtMs)
      }
      if (state.stopReason) stopReasons.push(state.stopReason)
      if (state.errorText) lastError = state.errorText
      if (state.usage) {
        addUsage(usage, state.usage)
        if (state.usageSource === 'local_estimate') anyLocalEstimate = true
        else anyProviderReported = true
      } else if (state.terminal === 'stop') {
        hasUnknownUsage = true
      }
    }

    const usageProvenance: AgentRunUsageProvenance = anyLocalEstimate
      ? 'local_estimate'
      : anyProviderReported
        ? 'provider_reported'
        : 'unknown'

    return {
      calls: countStartedCalls(this.calls),
      completed,
      canceled,
      errored,
      retries,
      rateLimited,
      ...(firstTokenAtMs !== undefined ? { firstTokenAtMs } : {}),
      usage: pruneUsage(usage),
      usageProvenance,
      hasUnknownUsage,
      stopReasons,
      ...(lastError ? { lastError } : {})
    }
  }

  private ensure(callId: string): CallState {
    if (!callId.trim()) throw new Error('provider hook event requires a callId.')
    let state = this.calls.get(callId)
    if (!state) {
      state = { started: false, retries: new Set(), rateLimits: new Set() }
      this.calls.set(callId, state)
    }
    return state
  }
}

/**
 * Normalize a raw provider metadata bag: drop secret-looking keys, cap the key
 * count and value sizes, coerce to bounded primitives. Structured/private SDK
 * objects are rejected rather than serialized.
 */
export function normalizeProviderMetadata(raw: unknown): ProviderMetadata | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: ProviderMetadata = {}
  let count = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_METADATA_KEYS) break
    if (!key || key.length > MAX_METADATA_KEY_LENGTH) continue
    if (SECRET_KEY_PATTERN.test(key)) continue
    const normalized = normalizeMetadataValue(value)
    if (normalized === undefined) continue
    out[key] = normalized
    count += 1
  }
  return count > 0 ? out : undefined
}

export function normalizeStopReason(reason: string | undefined): ProviderStopReason {
  if (!reason) return 'other'
  const value = reason.trim().toLowerCase()
  if (value === 'stop' || value === 'end_turn' || value === 'stop_sequence' || value === 'completed') return 'stop'
  if (value === 'length' || value === 'max_tokens' || value === 'max_output_tokens') return 'length'
  if (value === 'tool_calls' || value === 'tool_use' || value === 'function_call') return 'tool_calls'
  if (value === 'content_filter' || value === 'safety' || value === 'refusal') return 'content_filter'
  if (value === 'canceled' || value === 'cancelled' || value === 'aborted') return 'canceled'
  if (value === 'error') return 'error'
  return 'other'
}

function normalizeMetadataValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const redacted = redactProviderErrorText(value)
    return redacted.slice(0, MAX_METADATA_VALUE_LENGTH)
  }
  return undefined
}

function mergeUsage(existing: ProviderTokenUsage | undefined, incoming: ProviderTokenUsage): ProviderTokenUsage {
  // Last-wins per field so a final total supersedes an earlier partial report.
  return {
    ...(existing ?? {}),
    ...(incoming.promptTokens !== undefined ? { promptTokens: nonNegative(incoming.promptTokens) } : {}),
    ...(incoming.completionTokens !== undefined ? { completionTokens: nonNegative(incoming.completionTokens) } : {}),
    ...(incoming.totalTokens !== undefined ? { totalTokens: nonNegative(incoming.totalTokens) } : {})
  }
}

function addUsage(target: ProviderTokenUsage, source: ProviderTokenUsage): void {
  if (source.promptTokens !== undefined) target.promptTokens = (target.promptTokens ?? 0) + source.promptTokens
  if (source.completionTokens !== undefined) target.completionTokens = (target.completionTokens ?? 0) + source.completionTokens
  if (source.totalTokens !== undefined) target.totalTokens = (target.totalTokens ?? 0) + source.totalTokens
}

function pruneUsage(usage: ProviderTokenUsage): ProviderTokenUsage {
  return {
    ...(usage.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {})
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function countStartedCalls(calls: Map<string, CallState>): number {
  let count = 0
  for (const state of calls.values()) if (state.started) count += 1
  return count
}
