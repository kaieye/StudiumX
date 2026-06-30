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

export function classifyProviderError(value: unknown): ProviderErrorInfo | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const status = extractStatus(raw)
  const providerMessage = extractProviderMessage(raw)
  const haystack = `${raw}\n${providerMessage ?? ''}`.toLowerCase()

  if (
    status === 402 ||
    /payment required/.test(haystack) ||
    /insufficient[_\s-]*(balance|quota|credit|credits|funds)/.test(haystack) ||
    /out of (credit|credits|funds)/.test(haystack) ||
    /余额不足|额度不足/.test(raw)
  ) {
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
    /rate limit|too many requests|quota exceeded/.test(haystack)
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
      return 'Provider 余额不足'
    case 'authentication':
      return 'Provider 认证失败'
    case 'rate_limit':
      return 'Provider 速率限制'
    case 'http':
      return info.status ? `Provider HTTP ${info.status}` : 'Provider 错误'
  }
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
