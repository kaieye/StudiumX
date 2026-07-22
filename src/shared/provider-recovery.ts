import {
  classifyProviderError,
  type ProviderErrorInfo,
  type ProviderErrorKind
} from './provider-error'
import {
  isSilentContextOverflow,
  matchOverflowErrorText,
  type OverflowUsageSnapshot
} from './provider-overflow-patterns'

/**
 * Recovery taxonomy for provider failures (A-04).
 *
 * Dual-axis design:
 * - UX kind stays in `provider-error.ts` (`ProviderErrorKind`)
 * - Recovery flags live here and are intentionally not wired into retry loops yet (A-05)
 *
 * Never sets retryable for billing/quota, permanent auth, context overflow,
 * or max-tokens / length truncation. Credential rotation is intentionally absent.
 */

export type ProviderRecoveryClass =
  | 'billing'
  | 'authentication'
  | 'rate_limit'
  | 'overloaded'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'empty_stream'
  | 'context_overflow'
  | 'max_tokens'
  | 'payload_too_large'
  | 'format_error'
  | 'content_policy'
  | 'http'
  | 'unknown'

export type ProviderRecoveryDecision = {
  /** Recovery class used by future retry / compress / fallback policy. */
  class: ProviderRecoveryClass
  /** Whether a transport-level auto-retry may be considered (flags only; no loop here). */
  retryable: boolean
  /** Whether context compression is the preferred recovery path. */
  shouldCompress: boolean
  /** Whether falling back to another configured model/path may help. */
  shouldFallback: boolean
  /** Stable machine code for logging / wire events (A-05 will consume). */
  reasonCode: string
  /** UX kind when the error is also classifiable by `classifyProviderError`. */
  uxKind?: ProviderErrorKind
  status?: number
  providerMessage?: string
}

export function classifyProviderRecovery(error: unknown): ProviderRecoveryDecision {
  const raw = stringifyError(error)
  const ux = classifyProviderError(error)
  const status = ux?.status ?? extractStatus(raw)
  const providerMessage = ux?.providerMessage ?? extractProviderMessage(raw)
  const haystack = `${raw}\n${providerMessage ?? ''}`.toLowerCase()

  // Platform capability gaps (ADR-0126) are not provider transport errors.
  // Keep them off the empty_stream / retry axes.
  if (
    haystack.includes('unsupported_platform') ||
    haystack.includes('descriptor-relative contained directory') ||
    haystack.includes('windows_direct_path') ||
    haystack.includes('platform capability') ||
    (haystack.includes('native_unavailable') && haystack.includes('contained directory'))
  ) {
    return decision({
      class: 'unknown',
      retryable: false,
      shouldCompress: false,
      shouldFallback: false,
      reasonCode: 'platform_capability',
      uxKind: ux?.kind,
      status,
      providerMessage
    })
  }

  // --- Permanent / never-retryable classes first ---

  if (ux?.kind === 'insufficient_balance' || isBillingOrQuotaText(haystack, raw, status)) {
    return decision({
      class: 'billing',
      retryable: false,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'billing_or_quota',
      uxKind: 'insufficient_balance',
      status,
      providerMessage
    })
  }

  if (isPermanentAuth(haystack, raw, status) || ux?.kind === 'authentication') {
    return decision({
      class: 'authentication',
      retryable: false,
      shouldCompress: false,
      shouldFallback: false,
      reasonCode: 'authentication',
      uxKind: 'authentication',
      status,
      providerMessage
    })
  }

  if (isContextOverflow(haystack, error)) {
    return decision({
      class: 'context_overflow',
      retryable: false,
      shouldCompress: true,
      shouldFallback: false,
      reasonCode: 'context_overflow',
      uxKind: ux?.kind,
      status,
      providerMessage
    })
  }

  if (isMaxTokensOrLength(haystack, error)) {
    return decision({
      class: 'max_tokens',
      retryable: false,
      shouldCompress: false,
      shouldFallback: false,
      reasonCode: 'max_tokens_or_length',
      uxKind: ux?.kind,
      status,
      providerMessage
    })
  }

  if (isPayloadTooLarge(haystack, status)) {
    return decision({
      class: 'payload_too_large',
      retryable: false,
      shouldCompress: true,
      shouldFallback: false,
      reasonCode: 'payload_too_large',
      uxKind: ux?.kind ?? (status === 413 ? 'http' : undefined),
      status,
      providerMessage
    })
  }

  if (isContentPolicy(haystack)) {
    return decision({
      class: 'content_policy',
      retryable: false,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'content_policy',
      uxKind: ux?.kind,
      status,
      providerMessage
    })
  }

  if (isFormatError(haystack)) {
    return decision({
      class: 'format_error',
      retryable: false,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'format_error',
      uxKind: ux?.kind,
      status,
      providerMessage
    })
  }

  if (isEmptyStream(haystack, error)) {
    return decision({
      class: 'empty_stream',
      retryable: true,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'empty_stream',
      uxKind: ux?.kind,
      status,
      providerMessage
    })
  }

  // --- Transient / may-retry classes ---

  if (ux?.kind === 'rate_limit' || isRateLimit(haystack, status)) {
    return decision({
      class: 'rate_limit',
      retryable: true,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'rate_limit',
      uxKind: 'rate_limit',
      status,
      providerMessage
    })
  }

  if (isOverloaded(haystack, status)) {
    return decision({
      class: 'overloaded',
      retryable: true,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'overloaded',
      uxKind: ux?.kind ?? (status && status >= 500 ? 'http' : undefined),
      status,
      providerMessage
    })
  }

  if (isTimeout(haystack, error)) {
    return decision({
      class: 'timeout',
      retryable: true,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'timeout',
      uxKind: ux?.kind,
      status,
      providerMessage
    })
  }

  if (isNetwork(haystack, error)) {
    return decision({
      class: 'network',
      retryable: true,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'network',
      uxKind: ux?.kind,
      status,
      providerMessage
    })
  }

  if (isServerError(haystack, status)) {
    return decision({
      class: 'server_error',
      retryable: true,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: 'server_error',
      uxKind: ux?.kind ?? 'http',
      status,
      providerMessage
    })
  }

  if (ux?.kind === 'http' || status) {
    return decision({
      class: 'http',
      retryable: false,
      shouldCompress: false,
      shouldFallback: true,
      reasonCode: status ? `http_${status}` : 'http',
      uxKind: 'http',
      status,
      providerMessage
    })
  }

  return decision({
    class: 'unknown',
    retryable: false,
    shouldCompress: false,
    shouldFallback: false,
    reasonCode: 'unknown',
    uxKind: ux?.kind,
    status,
    providerMessage
  })
}

function decision(partial: ProviderRecoveryDecision): ProviderRecoveryDecision {
  return partial
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name && error.name !== 'Error' ? error.name : ''
    return `${name} ${error.message}`.trim()
  }
  if (error && typeof error === 'object') {
    const record = error as { kind?: unknown; message?: unknown; code?: unknown }
    return [record.kind, record.code, record.message].filter((part) => part != null && part !== '').join(' ')
  }
  return String(error ?? '').trim()
}

function isBillingOrQuotaText(haystack: string, raw: string, status: number | undefined): boolean {
  if (status === 402) return true
  if (/payment required/.test(haystack)) return true
  if (/insufficient[_\s-]*(balance|quota|credit|credits|funds)/.test(haystack)) return true
  if (/out of (credit|credits|funds)/.test(haystack)) return true
  if (/\bquota[_\s-]*exceeded\b/.test(haystack)) return true
  if (/\binsufficient[_\s-]*quota\b/.test(haystack)) return true
  if (/\bbilling\b/.test(haystack) && /(exceed|limit|required|error|hard)/.test(haystack)) return true
  if (/exceeded.*(quota|budget|credit|credits)|(quota|budget|credit|credits).*exceeded/.test(haystack)) return true
  if (/(free|go|trial)\s+(tier|plan|limit|quota)/.test(haystack)) return true
  if (/余额不足|额度不足|配额不足|配额已用完|额度已用尽/.test(raw)) return true
  return false
}

function isPermanentAuth(haystack: string, raw: string, status: number | undefined): boolean {
  if (status === 401 || status === 403) return true
  if (/invalid api key|unauthorized|forbidden|authentication failed|auth.?error/.test(haystack)) return true
  if (/api key.*invalid/i.test(raw)) return true
  return false
}

function isContextOverflow(haystack: string, error: unknown): boolean {
  // Text patterns (provider-specific library + NON_OVERFLOW exclusion)
  if (matchOverflowErrorText(haystack) || matchOverflowErrorText(stringifyError(error))) {
    return true
  }

  // Silent / length-stop heuristics when the error object carries usage + stop + window
  if (error && typeof error === 'object') {
    const record = error as {
      usage?: Partial<OverflowUsageSnapshot> | null
      stopReason?: unknown
      finish_reason?: unknown
      contextWindow?: unknown
      context_window?: unknown
    }
    const usageRaw = record.usage
    const contextWindowRaw = record.contextWindow ?? record.context_window
    const stopRaw = record.stopReason ?? record.finish_reason
    if (usageRaw && typeof usageRaw === 'object' && contextWindowRaw != null) {
      const usage: OverflowUsageSnapshot = {
        input: Number(usageRaw.input ?? 0),
        output: Number(usageRaw.output ?? 0),
        cacheRead:
          usageRaw.cacheRead != null && Number.isFinite(Number(usageRaw.cacheRead))
            ? Number(usageRaw.cacheRead)
            : undefined
      }
      const contextWindow = Number(contextWindowRaw)
      const stopReason = stopRaw != null ? String(stopRaw) : undefined
      if (isSilentContextOverflow(usage, stopReason, contextWindow)) {
        return true
      }
    }
  }

  return false
}

function isMaxTokensOrLength(haystack: string, error: unknown): boolean {
  if (error && typeof error === 'object') {
    const stop = String((error as { stopReason?: unknown; finish_reason?: unknown }).stopReason
      ?? (error as { finish_reason?: unknown }).finish_reason
      ?? '').toLowerCase()
    if (stop === 'length' || stop === 'max_tokens' || stop === 'max_output_tokens') return true
  }
  return (
    /finish[_\s-]*reason[_\s-]*(=|:)?\s*(length|max_tokens|max_output_tokens)/.test(haystack) ||
    /max[_\s-]*tokens?\s*(reached|exceeded|limit)/.test(haystack) ||
    /output[_\s-]*(truncated|length limit|token limit)/.test(haystack) ||
    /response truncated|length truncation/.test(haystack)
  )
}

function isPayloadTooLarge(haystack: string, status: number | undefined): boolean {
  return status === 413 || /payload too large|request entity too large|body too large/.test(haystack)
}

function isContentPolicy(haystack: string): boolean {
  return /content[_\s-]*policy|safety|moderation|blocked by policy|responsible ai|violat(es|ion).*(policy|safety)/.test(
    haystack
  )
}

function isFormatError(haystack: string): boolean {
  return /invalid[_\s-]*request|schema|json[_\s-]*schema|tool[_\s-]*schema|malformed|format error|unsupported.*format/.test(
    haystack
  )
}

function isEmptyStream(haystack: string, error: unknown): boolean {
  if (error && typeof error === 'object') {
    const name = String((error as { name?: unknown }).name ?? '')
    if (/EmptyStream/i.test(name)) return true
    const kind = String((error as { kind?: unknown }).kind ?? '')
    if (kind === 'empty_stream' || kind === 'empty-stream') return true
  }
  return (
    /empty[_\s-]*stream|stream.*(empty|no content|no chunks|zero chunks)|no content in (stream|response)|premature (close|end) of stream/.test(
      haystack
    )
  )
}

function isRateLimit(haystack: string, status: number | undefined): boolean {
  return status === 429 || /rate[_\s-]*limit|too many requests|请求过于频繁|速率限制/.test(haystack)
}

function isOverloaded(haystack: string, status: number | undefined): boolean {
  return status === 503 || /overloaded|capacity|service unavailable|upstream.*busy|server busy/.test(haystack)
}

function isTimeout(haystack: string, error: unknown): boolean {
  if (error && typeof error === 'object') {
    const kind = String((error as { kind?: unknown }).kind ?? '')
    if (kind === 'timeout') return true
    const name = String((error as { name?: unknown }).name ?? '')
    if (/Timeout/i.test(name)) return true
  }
  return /timeout|timed out|deadline exceeded|etimedout|aborted due to timeout/.test(haystack)
}

function isNetwork(haystack: string, error: unknown): boolean {
  if (error && typeof error === 'object') {
    const kind = String((error as { kind?: unknown }).kind ?? '')
    if (kind === 'network') return true
  }
  return (
    /network|econnreset|econnrefused|enotfound|fetch failed|socket hang up|dns|connection reset|connection refused/.test(
      haystack
    )
  )
}

function isServerError(haystack: string, status: number | undefined): boolean {
  if (status != null && status >= 500 && status <= 599) return true
  return /internal server error|bad gateway|gateway timeout|upstream error|server error/.test(haystack)
}

function extractStatus(raw: string): number | undefined {
  const explicit = /Provider\s*(?:返回|returned)?\s*(\d{3})/i.exec(raw)?.[1]
  const fallback = /\b(4\d\d|5\d\d)\b/.exec(raw)?.[1]
  const parsed = Number.parseInt(explicit ?? fallback ?? '', 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function extractProviderMessage(raw: string): string | undefined {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      error?: { message?: unknown; code?: unknown; type?: unknown }
    }
    const message = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
    const code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    const type = typeof parsed.error?.type === 'string' ? parsed.error.type : ''
    return [message, code, type].filter(Boolean).join(' · ') || undefined
  } catch {
    return undefined
  }
}

// Re-export for tests that want the UX kind alongside recovery.
export type { ProviderErrorInfo, ProviderErrorKind }
// Pure overflow helpers (ADAPT-P1 / ADR-0125)
export {
  isSilentContextOverflow,
  matchOverflowErrorText,
  type OverflowUsageSnapshot
} from './provider-overflow-patterns'
