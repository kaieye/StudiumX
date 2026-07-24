/**
 * Provider custom HTTP headers (ADR-0149 / liveagent-worth-learning §3.5).
 *
 * Ordered user-configured name/value pairs may be merged into outbound provider
 * requests. Reserved auth and identity keys are never overridden (case-insensitive).
 * User-Agent is product-owned (honest StudiumX identity only — no CLI spoof).
 */

export type ProviderCustomHeader = {
  name: string
  value: string
}

/** Honest product identity; never spoof third-party CLI / SDK agents. */
export const PROVIDER_PRODUCT_USER_AGENT = 'StudiumX/0.1.0'

/**
 * Headers that custom configuration must not set or override (case-insensitive).
 * Auth is owned by adapterAuthHeaders; identity / hop-by-hop by the product runtime.
 */
export const PROVIDER_RESERVED_HEADER_NAMES = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'api_key',
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'user-agent',
  'www-authenticate',
  'proxy-authenticate'
] as const

const RESERVED_SET = new Set<string>(PROVIDER_RESERVED_HEADER_NAMES)

/**
 * Header names commonly used by CLI/SDK identity spoof packages.
 * Dropped even when not on the reserved auth list.
 */
const CLI_SPOOF_HEADER_NAMES = new Set([
  'x-client-name',
  'x-client-version',
  'x-client-title',
  'x-app-name',
  'x-app-version',
  'x-stainless-lang',
  'x-stainless-package-version',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
  'x-stainless-os',
  'x-stainless-arch',
  'openai-organization',
  'openai-project',
  'x-request-client',
  'x-cli-version'
])

/** Values that mark a header package as CLI / third-party agent spoof. */
const CLI_SPOOF_VALUE_RE =
  /\b(?:claude[-_ ]?cli|anthropic[-_ ]?cli|openai[-_ ]?(?:python|node|cli)|cursor[-_ ]?(?:agent|cli)?|codex[-_ ]?cli|aider|continue\.dev|litellm|langchain|llamaindex|openclaw|goose[-_ ]?cli)\b/i

const SECRETISH_HEADER_NAME_RE =
  /(?:authorization|api[_-]?key|secret|token|password|passphrase|credential|bearer)/i

const SECRETISH_VALUE_RE =
  /^(?:Bearer\s+\S+|Basic\s+\S+|sk-[A-Za-z0-9][A-Za-z0-9._-]{8,}|[A-Za-z0-9_-]{24,})$/i

const MAX_CUSTOM_HEADERS = 32
const MAX_HEADER_NAME_LEN = 128
const MAX_HEADER_VALUE_LEN = 2048

export function isReservedProviderHeaderName(name: string): boolean {
  return RESERVED_SET.has(normalizeHeaderNameKey(name))
}

export function isCliSpoofProviderHeader(name: string, value: string): boolean {
  const key = normalizeHeaderNameKey(name)
  if (CLI_SPOOF_HEADER_NAMES.has(key)) return true
  // Strong third-party CLI / SDK identity strings are never allowed as header values.
  if (CLI_SPOOF_VALUE_RE.test(value)) return true
  return false
}

/**
 * Normalize an ordered custom-header list from settings / untrusted input.
 * Drops empty names, reserved keys, CLI spoof packages, and oversize entries.
 * Later entries with the same name (case-insensitive) win within the list.
 */
export function normalizeProviderCustomHeaders(input: unknown): ProviderCustomHeader[] {
  if (!Array.isArray(input)) return []
  const byKey = new Map<string, ProviderCustomHeader>()
  for (const item of input) {
    if (byKey.size >= MAX_CUSTOM_HEADERS) break
    const entry = coerceHeaderEntry(item)
    if (!entry) continue
    if (isReservedProviderHeaderName(entry.name)) continue
    if (isCliSpoofProviderHeader(entry.name, entry.value)) continue
    byKey.set(normalizeHeaderNameKey(entry.name), entry)
  }
  return [...byKey.values()]
}

/**
 * Merge order: base (auth / format) → allowed custom → honest User-Agent last.
 * Custom never overrides reserved keys present on base; User-Agent always product.
 */
export function mergeProviderRequestHeaders(
  base: Record<string, string>,
  custom: readonly ProviderCustomHeader[] | undefined
): Record<string, string> {
  const merged: Record<string, string> = { ...base }
  const baseKeys = new Set(Object.keys(merged).map(normalizeHeaderNameKey))

  for (const entry of custom ?? []) {
    const name = entry.name.trim()
    const value = entry.value
    if (!name) continue
    const key = normalizeHeaderNameKey(name)
    if (isReservedProviderHeaderName(name)) continue
    if (isCliSpoofProviderHeader(name, value)) continue
    if (baseKeys.has(key)) continue
    // Prefer canonical casing from first write; replace prior custom with same key.
    const existingCustomKey = Object.keys(merged).find((k) => normalizeHeaderNameKey(k) === key)
    if (existingCustomKey) delete merged[existingCustomKey]
    merged[name] = value
  }

  // Product-owned identity — always win over any residual UA.
  for (const key of Object.keys(merged)) {
    if (normalizeHeaderNameKey(key) === 'user-agent') delete merged[key]
  }
  merged['User-Agent'] = PROVIDER_PRODUCT_USER_AGENT
  return merged
}

/** Log / doctor-safe view of custom headers (secret-looking values redacted). */
export function redactProviderCustomHeadersForLog(
  headers: readonly ProviderCustomHeader[] | undefined
): ProviderCustomHeader[] {
  if (!headers?.length) return []
  return headers.map((h) => ({
    name: h.name,
    value: shouldRedactHeaderValue(h.name, h.value) ? '[redacted]' : h.value
  }))
}

/** Redact secret-looking values on a flat header map (e.g. merged request headers). */
export function redactProviderHeaderMapForLog(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = shouldRedactHeaderValue(name, value) ? '[redacted]' : value
  }
  return out
}

export function shouldRedactHeaderValue(name: string, value: string): boolean {
  if (SECRETISH_HEADER_NAME_RE.test(name)) return true
  if (SECRETISH_VALUE_RE.test(value.trim())) return true
  return false
}

function coerceHeaderEntry(item: unknown): ProviderCustomHeader | null {
  if (!item || typeof item !== 'object') return null
  const rec = item as { name?: unknown; value?: unknown; key?: unknown }
  const rawName = typeof rec.name === 'string' ? rec.name : typeof rec.key === 'string' ? rec.key : ''
  const name = rawName.trim()
  if (!name || name.length > MAX_HEADER_NAME_LEN) return null
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return null
  const value = typeof rec.value === 'string' ? rec.value : ''
  if (value.length > MAX_HEADER_VALUE_LEN) return null
  // Disallow CR/LF injection
  if (/[\r\n]/.test(value)) return null
  return { name, value }
}

function normalizeHeaderNameKey(name: string): string {
  return name.trim().toLowerCase()
}
