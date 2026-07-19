/**
 * Opaque trace correlation identifiers are accepted only as canonical UUIDs.
 * Invalid values are intentionally omitted rather than redacted: a trace ID
 * must never become a carrier for user-controlled diagnostic text.
 */
const TRACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeTraceId(value: unknown): string | undefined {
  return typeof value === 'string' && TRACE_ID_RE.test(value) ? value.toLowerCase() : undefined
}

/**
 * Compares persisted trace metadata without treating malformed values as a
 * missing legacy trace. Missing on both sides remains compatible with legacy
 * records; any malformed or mismatched present value is a conflict.
 */
export function traceIdsMatchForIdempotency(existing: unknown, expected: unknown): boolean {
  if (existing === undefined && expected === undefined) return true
  const normalizedExisting = normalizeTraceId(existing)
  const normalizedExpected = normalizeTraceId(expected)
  return normalizedExisting !== undefined && normalizedExpected !== undefined && normalizedExisting === normalizedExpected
}
