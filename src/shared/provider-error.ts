export type ProviderErrorKind =
  | 'insufficient_balance'
  | 'authentication'
  | 'rate_limit'
  | 'http'

export type ProviderErrorInfo = {
  kind: ProviderErrorKind
  status?: number
  providerMessage?: string
}

export function redactProviderErrorText(value: string): string {
  return value
    .replace(/\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;{}"']+/gi, '$1[redacted]')
    .replace(/\b((?:x-api-key|api-key|apikey|api_key)\s*[:=]\s*)["']?[^"'\s,;&}]+["']?/gi, '$1[redacted]')
    .replace(/(["'](?:api[_-]?key|authorization|x-api-key|access_token|secret|token)["']\s*:\s*["'])[^"']+(["'])/gi, '$1[redacted]$2')
    .replace(/\b((?:api[_-]?key|access_token|token|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)([^\/\s:@]+):([^\/\s@]+)@/gi, '$1[redacted]@')
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9._-]{12,}\b/g, '[redacted]')
}

/**
 * UX-facing provider error kind. Keep this axis separate from recovery flags
 * in `provider-recovery.ts` (A-04). Billing / quota exhaustion must never map
 * to `rate_limit` — only true throttle signals (429 / too many requests).
 */
export function classifyProviderError(value: unknown): ProviderErrorInfo | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const status = extractStatus(raw)
  const providerMessage = extractProviderMessage(raw)
  const haystack = `${raw}\n${providerMessage ?? ''}`.toLowerCase()

  // Billing / quota first — before rate_limit — so "quota exceeded" never
  // lands in the throttle bucket (A-03).
  if (isBillingOrQuota(haystack, raw, status)) {
    return { kind: 'insufficient_balance', status, providerMessage }
  }

  if (
    status === 401 ||
    status === 403 ||
    /invalid api key|unauthorized|forbidden|authentication/.test(haystack) ||
    /api key.*invalid/i.test(raw)
  ) {
    return { kind: 'authentication', status, providerMessage }
  }

  if (
    status === 429 ||
    /rate[_\s-]*limit|too many requests|请求过于频繁|速率限制/.test(haystack)
  ) {
    return { kind: 'rate_limit', status, providerMessage }
  }

  if (status || /provider\s*(返回|returned)|provider error/i.test(raw)) {
    return { kind: 'http', status, providerMessage }
  }

  return null
}

export function providerErrorReason(info: ProviderErrorInfo): string {
  switch (info.kind) {
    case 'insufficient_balance':
      // Covers both cash-balance (402) and quota/billing exhaustion so users
      // never confuse them with rate_limit throttling.
      return 'Provider 余额或配额不足'
    case 'authentication':
      return 'Provider 认证失败'
    case 'rate_limit':
      return 'Provider 速率限制'
    case 'http':
      return info.status ? `Provider HTTP ${info.status}` : 'Provider 错误'
  }
}

function isBillingOrQuota(haystack: string, raw: string, status: number | undefined): boolean {
  if (status === 402) return true
  if (/payment required/.test(haystack)) return true
  if (/insufficient[_\s-]*(balance|quota|credit|credits|funds)/.test(haystack)) return true
  if (/out of (credit|credits|funds)/.test(haystack)) return true
  // Standalone quota / billing exhaustion (must NOT be rate_limit).
  if (/\bquota[_\s-]*exceeded\b/.test(haystack)) return true
  if (/\binsufficient[_\s-]*quota\b/.test(haystack)) return true
  if (/\bbilling\b/.test(haystack) && /(exceed|limit|required|error|hard)/.test(haystack)) return true
  if (/exceeded.*(quota|budget|credit|credits)|(quota|budget|credit|credits).*exceeded/.test(haystack)) return true
  if (/(free|go|trial)\s+(tier|plan|limit|quota)/.test(haystack)) return true
  if (/余额不足|额度不足|配额不足|配额已用完|额度已用尽/.test(raw)) return true
  return false
}

function extractStatus(raw: string): number | undefined {
  const explicit = /Provider\s*(?:返回|returned)?\s*(\d{3})/i.exec(raw)?.[1]
  const fallback = /\b(4\d\d|5\d\d)\b/.exec(raw)?.[1]
  const parsed = Number.parseInt(explicit ?? fallback ?? '', 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function extractProviderMessage(raw: string): string | undefined {
  const jsonText = extractJsonObject(raw)
  if (!jsonText) return undefined
  try {
    const parsed = JSON.parse(jsonText) as { error?: { message?: unknown; code?: unknown; type?: unknown } }
    const message = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
    const code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    const type = typeof parsed.error?.type === 'string' ? parsed.error.type : ''
    return [message, code, type].filter(Boolean).join(' · ') || undefined
  } catch {
    return undefined
  }
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end > start ? raw.slice(start, end + 1) : ''
}
