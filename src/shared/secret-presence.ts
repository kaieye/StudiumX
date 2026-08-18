/**
 * Presence-only secret boundary helpers (ADR-0006; MCP projections also follow ADR-0013).
 *
 * Public surfaces (IPC DTOs, Doctor facts, support-bundle, MCP/provider public
 * views) must only communicate that a secret **is configured** (boolean /
 * presence). Never copy raw keys, tokens, refs, or secret-shaped values into
 * those views.
 *
 * Non-claims:
 * - no remote telemetry / phone-home
 * - support-bundle remains consent-gated (ADR-0007)
 * - does not replace agent-secret text redaction for free-form prose
 */

/**
 * Field-name detector for secret-bearing keys (env/headers/settings/smuggled JSON).
 * Shared by MCP parse/export and support-bundle deny lists.
 */
export const SECRET_FIELD_KEY_RE =
  /api[_-]?key|token|secret|password|authorization|bearer|credential|client[_-]?secret|refresh[_-]?token|access[_-]?token/i

/** True when a record key looks secret-bearing (case-insensitive). */
export function isSecretFieldKey(name: string): boolean {
  if (typeof name !== 'string' || !name.trim()) return false
  return SECRET_FIELD_KEY_RE.test(name)
}

/**
 * Presence check only: non-empty string / true / non-zero finite number.
 * Never returns or retains the raw value.
 */
export function isSecretConfigured(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'boolean') return value === true
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  return false
}

/**
 * Project secret ref / value maps to presence-only booleans (sorted keys).
 * Used by MCP public DTOs (`envSecretConfigured` / `headersSecretConfigured`).
 */
export function projectSecretPresenceMap(
  refs: Readonly<Record<string, unknown>> | null | undefined
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!refs || typeof refs !== 'object') return out
  for (const key of Object.keys(refs).sort()) {
    out[key] = isSecretConfigured(refs[key])
  }
  return out
}

/** True when any candidate value is configured (presence OR). */
export function hasAnySecretConfigured(values: readonly unknown[]): boolean {
  for (const value of values) {
    if (isSecretConfigured(value)) return true
  }
  return false
}
