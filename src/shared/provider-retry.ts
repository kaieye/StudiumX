/**
 * Bounded jittered provider retry policy (A-05 / ADR-0057).
 *
 * Pure planning lives in `planProviderRetry`. The small async helper
 * `withProviderRetry` only sleeps and re-invokes; call sites must still
 * record each attempt in request-local observability; retry bounds never impose a run-wide quota.
 *
 * Retry is gated **only** by `classifyProviderRecovery(error).retryable`.
 * Never auto-retries billing / auth / context_overflow / max_tokens.
 * No credential rotation. No circuit-breaker in this slice.
 */

import {
  classifyProviderRecovery,
  type ProviderRecoveryDecision
} from './provider-recovery'

export type ProviderRetryBudget = {
  /** Total tries including the first attempt (default 3 => 1 original + 2 retries). */
  maxAttempts: number
  /** Attempts already started (including the failed one when planning after failure). */
  attemptsUsed: number
  /** Optional remaining wall-clock budget for sleeps + later attempts. */
  remainingMs?: number
}

export type ProviderRetryPlan =
  | { action: 'fail'; reasonCode: string; decision: ProviderRecoveryDecision }
  | {
      action: 'retry'
      /** 1-based next attempt index after the failure that triggered planning. */
      attempt: number
      delayMs: number
      reasonCode: string
      decision: ProviderRecoveryDecision
    }

export const DEFAULT_PROVIDER_RETRY_MAX_ATTEMPTS = 3

/** Base backoff for attempt index 1 (first retry after the original). */
export const PROVIDER_RETRY_BASE_DELAY_MS = 250
export const PROVIDER_RETRY_MAX_DELAY_MS = 8_000

export function planProviderRetry(input: {
  error: unknown
  budget: ProviderRetryBudget
  /** Optional Retry-After already normalized to milliseconds. */
  retryAfterMs?: number
  now?: () => number
  /** Inject for tests; range [0, 1). */
  random?: () => number
}): ProviderRetryPlan {
  const decision = classifyProviderRecovery(input.error)
  const reasonCode = decision.reasonCode
  const maxAttempts = normalizeMaxAttempts(input.budget.maxAttempts)
  const attemptsUsed = Math.max(0, Math.floor(input.budget.attemptsUsed))

  if (!decision.retryable) {
    return { action: 'fail', reasonCode, decision }
  }

  if (attemptsUsed >= maxAttempts) {
    return {
      action: 'fail',
      reasonCode: 'auto_retry_exhausted',
      decision
    }
  }

  // Next attempt index after the failure (1-based for the upcoming call).
  // attemptsUsed counts finished starts; after first failure attemptsUsed=1
  // and next attempt is 2.
  const nextAttempt = attemptsUsed + 1
  if (nextAttempt > maxAttempts) {
    return {
      action: 'fail',
      reasonCode: 'auto_retry_exhausted',
      decision
    }
  }

  const random = input.random ?? Math.random
  const retryIndex = Math.max(0, attemptsUsed - 1) // 0 for first retry, 1 for second, ...
  let delayMs = computeFullJitterBackoffMs(retryIndex, random)

  const retryAfterMs = normalizePositiveMs(input.retryAfterMs)
  if (retryAfterMs !== undefined) {
    // Honor Retry-After as a floor, then add a small jitter so many clients
    // do not stampede at the same instant.
    const jitter = Math.floor(random() * Math.min(250, Math.max(1, Math.floor(retryAfterMs * 0.1) || 1)))
    delayMs = Math.max(delayMs, retryAfterMs) + jitter
  }

  delayMs = Math.min(PROVIDER_RETRY_MAX_DELAY_MS, Math.max(0, Math.floor(delayMs)))

  const remainingMs = input.budget.remainingMs
  if (remainingMs !== undefined && Number.isFinite(remainingMs)) {
    if (remainingMs <= 0) {
      return {
        action: 'fail',
        reasonCode: 'auto_retry_budget_time_exhausted',
        decision
      }
    }
    // Leave a tiny floor so the next attempt can still start.
    if (delayMs >= remainingMs) {
      delayMs = Math.max(0, Math.floor(remainingMs * 0.5))
      if (delayMs <= 0 && remainingMs < 5) {
        return {
          action: 'fail',
          reasonCode: 'auto_retry_budget_time_exhausted',
          decision
        }
      }
    }
  }

  return {
    action: 'retry',
    attempt: nextAttempt,
    delayMs,
    reasonCode,
    decision
  }
}

/**
 * Run `opts.run(attempt)` with bounded retries on retryable provider failures.
 * `attempt` is 1-based. The caller records attempt usage inside `run`
 * (or around each attempt); this retry bound is local to one provider request.
 */
export async function withProviderRetry<T>(opts: {
  run: (attempt: number) => Promise<T>
  budget: ProviderRetryBudget
  extractRetryAfterMs?: (error: unknown) => number | undefined
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  onRetry?: (info: {
    attempt: number
    delayMs: number
    reasonCode: string
    error: unknown
    decision: ProviderRecoveryDecision
  }) => void
  onExhausted?: (info: {
    attemptsUsed: number
    reasonCode: string
    error: unknown
    decision: ProviderRecoveryDecision
  }) => void
  signal?: AbortSignal
  now?: () => number
  random?: () => number
}): Promise<T> {
  const maxAttempts = normalizeMaxAttempts(opts.budget.maxAttempts)
  const sleep = opts.sleep ?? defaultSleep
  const startedAt = (opts.now ?? Date.now)()
  let lastError: unknown
  let lastDecision: ProviderRecoveryDecision | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(opts.signal)
    try {
      return await opts.run(attempt)
    } catch (error) {
      lastError = error
      throwIfAborted(opts.signal)

      const remainingMs =
        opts.budget.remainingMs === undefined
          ? undefined
          : Math.max(0, opts.budget.remainingMs - ((opts.now ?? Date.now)() - startedAt))

      const plan = planProviderRetry({
        error,
        budget: {
          maxAttempts,
          attemptsUsed: attempt,
          remainingMs
        },
        retryAfterMs: opts.extractRetryAfterMs?.(error),
        now: opts.now,
        random: opts.random
      })
      lastDecision = plan.decision

      if (plan.action === 'fail') {
        opts.onExhausted?.({
          attemptsUsed: attempt,
          reasonCode: plan.reasonCode,
          error,
          decision: plan.decision
        })
        throw error
      }

      opts.onRetry?.({
        attempt: plan.attempt,
        delayMs: plan.delayMs,
        reasonCode: plan.reasonCode,
        error,
        decision: plan.decision
      })

      if (plan.delayMs > 0) {
        await sleep(plan.delayMs, opts.signal)
      }
      throwIfAborted(opts.signal)
    }
  }

  if (lastError !== undefined && lastDecision) {
    opts.onExhausted?.({
      attemptsUsed: maxAttempts,
      reasonCode: 'auto_retry_exhausted',
      error: lastError,
      decision: lastDecision
    })
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'provider retry exhausted'))
}

/** Best-effort Retry-After extraction from Error-like objects and message text. */
export function extractRetryAfterMsFromError(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const record = error as {
      retryAfterMs?: unknown
      retryAfter?: unknown
      headers?: unknown
      response?: { headers?: unknown }
    }
    const fromMsField = normalizePositiveMs(record.retryAfterMs)
    if (fromMsField !== undefined) return fromMsField

    // Bare `retryAfter` may be seconds (HTTP convention) or already-ms.
    if (record.retryAfter != null) {
      const asHeader = normalizeRetryAfterHeaderValue(record.retryAfter)
      if (asHeader !== undefined) return asHeader
    }

    const headerMs = retryAfterFromHeaders(record.headers) ?? retryAfterFromHeaders(record.response?.headers)
    if (headerMs !== undefined) return headerMs
  }

  const text = error instanceof Error ? error.message : String(error ?? '')
  // "retry-after: 2" / "Retry-After=1.5s" / "retry after 1200ms"
  const headerish = /retry[-_\s]?after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds)?/i.exec(text)
  if (headerish) {
    const value = Number.parseFloat(headerish[1]!)
    if (!Number.isFinite(value) || value < 0) return undefined
    const unit = (headerish[2] ?? '').toLowerCase()
    if (unit === 'ms') return Math.floor(value)
    // Bare numbers and second units are HTTP-style seconds.
    return Math.floor(value * 1000)
  }
  return undefined
}

function computeFullJitterBackoffMs(retryIndex: number, random: () => number): number {
  // Full jitter: delay = random * min(cap, base * 2^retryIndex)
  const exp = Math.min(PROVIDER_RETRY_MAX_DELAY_MS, PROVIDER_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryIndex))
  const r = clamp01(random())
  return Math.floor(r * exp)
}

function normalizeMaxAttempts(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PROVIDER_RETRY_MAX_ATTEMPTS
  return Math.max(1, Math.floor(value))
}

function normalizePositiveMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function retryAfterFromHeaders(headers: unknown): number | undefined {
  if (!headers) return undefined
  if (typeof (headers as { get?: unknown }).get === 'function') {
    try {
      const raw = (headers as { get: (name: string) => string | null }).get('retry-after')
      return normalizeRetryAfterHeaderValue(raw)
    } catch {
      return undefined
    }
  }
  if (typeof headers === 'object') {
    const record = headers as Record<string, unknown>
    const raw = record['retry-after'] ?? record['Retry-After'] ?? record.retryAfter
    return normalizeRetryAfterHeaderValue(raw)
  }
  return undefined
}

function normalizeRetryAfterHeaderValue(raw: unknown): number | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return undefined
    // Header / bare retryAfter numbers are treated as seconds when small,
    // and as milliseconds when clearly already-ms (>= 1000 and not integer seconds
    // only — keep simple: values >= 1000 are ms).
    if (raw >= 1000) return Math.floor(raw)
    return Math.floor(raw * 1000)
  }
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed)
    if (!Number.isFinite(seconds) || seconds < 0) return undefined
    return Math.floor(seconds * 1000)
  }
  // HTTP-date: Date.parse returns ms.
  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  const delta = parsed - Date.now()
  return delta > 0 ? Math.floor(delta) : 0
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value >= 1) return 0.999999999999
  return value
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw abortError(signal)
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = (): void => {
      cleanup()
      reject(abortError(signal))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const err = new Error(typeof reason === 'string' && reason ? reason : 'aborted')
  err.name = 'AbortError'
  return err
}
