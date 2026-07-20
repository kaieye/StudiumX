/**
 * Teaching-scoped audit correlation and provider-privacy hardening (P1-11).
 *
 * Seam: `AuditCorrelation { sessionId, turnId, eventId?, operationId?, effectId? }`.
 * Logs and exports accept only allowlisted safe metadata. Provider payloads,
 * secrets, full learner answers, and raw reasoning are never projected by
 * default. SessionLedger and Agent run state stay separate and correlate by IDs only.
 *
 * Hook points:
 * - `buildTeachingAuditMetadataFromCommand` — teaching-turn command / envelope IDs
 * - `buildTeachingAuditMetadataForToolOperation` — tool/operation effect metadata
 * - `redactTeachingAuditForExport` — support/diagnostic export boundary
 */

import { redactAgentSecretText } from '../shared/agent-secret-redaction'

export const TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION = 1 as const

/** Opaque teaching correlation IDs only — no payloads, paths, or free text. */
export type AuditCorrelation = {
  sessionId: string
  turnId: string
  eventId?: string
  operationId?: string
  effectId?: string
}

/** Effect class for correlation; mirrors planned tool effect vocabulary without executing policy. */
export type TeachingAuditEffectClass =
  | 'read'
  | 'workspace_write'
  | 'external_write'
  | 'privileged'

/**
 * Allowlisted safe audit metadata for logs and support diagnostics.
 * Free-form text, provider bodies, secrets, and full learner answers are excluded.
 */
export type TeachingAuditSafeMetadata = {
  schemaVersion: typeof TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION
  kind: 'teaching_audit'
  correlation: AuditCorrelation
  commandType?: string
  toolName?: string
  effectClass?: TeachingAuditEffectClass
  evidenceEventId?: string
  outcomeKind?: string
  disposition?: string
  resultBytes?: number
  isError?: boolean
}

export type TeachingAuditCorrelationInput = {
  sessionId: unknown
  turnId: unknown
  eventId?: unknown
  operationId?: unknown
  effectId?: unknown
}

export type TeachingAuditCommandHookInput = TeachingAuditCorrelationInput & {
  commandType?: unknown
  evidenceEventId?: unknown
  outcomeKind?: unknown
}

export type TeachingAuditToolOperationHookInput = TeachingAuditCorrelationInput & {
  toolName?: unknown
  effectClass?: unknown
  disposition?: unknown
  resultBytes?: unknown
  isError?: unknown
  /** Rejected by default — never projected into safe metadata. */
  providerPayload?: unknown
  learnerAnswer?: unknown
  reasoning?: unknown
  secret?: unknown
  prompt?: unknown
  content?: unknown
  raw?: unknown
  transcript?: unknown
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const EFFECT_CLASSES = new Set<TeachingAuditEffectClass>([
  'read',
  'workspace_write',
  'external_write',
  'privileged'
])
const SAFE_METADATA_KEYS = new Set([
  'schemaVersion',
  'kind',
  'correlation',
  'commandType',
  'toolName',
  'effectClass',
  'evidenceEventId',
  'outcomeKind',
  'disposition',
  'resultBytes',
  'isError'
])
const CORRELATION_KEYS = new Set([
  'sessionId',
  'turnId',
  'eventId',
  'operationId',
  'effectId'
])

/**
 * Keys that must never appear in teaching audit logs or export by default.
 * Allowlist is authoritative; this set documents the privacy hardening intent.
 */
export const TEACHING_AUDIT_DENIED_FIELD_NAMES = [
  'prompt',
  'reasoning',
  'answer',
  'learnerAnswer',
  'fullAnswer',
  'selectedOptionIds',
  'assessment',
  'assessmentPayload',
  'providerPayload',
  'providerResponse',
  'providerRequest',
  'messages',
  'content',
  'body',
  'raw',
  'transcript',
  'apiKey',
  'secret',
  'token',
  'password',
  'authorization',
  'accessToken',
  'refreshToken',
  'clientSecret'
] as const

const DENIED_FIELD_SET = new Set<string>(
  TEACHING_AUDIT_DENIED_FIELD_NAMES.map((name) => name.toLowerCase())
)

const MAX_SAFE_STRING_LENGTH = 128
const MAX_EXPORT_STRING_LENGTH = 240
const MAX_EXPORT_DEPTH = 6
const MAX_EXPORT_KEYS = 40

/**
 * Builds a normalized `AuditCorrelation` from opaque IDs.
 * Invalid or missing required IDs yield null (fail closed, no silent fixups).
 */
export function createAuditCorrelation(
  input: TeachingAuditCorrelationInput
): AuditCorrelation | null {
  const sessionId = normalizeAuditId(input.sessionId)
  const turnId = normalizeAuditId(input.turnId)
  if (!sessionId || !turnId) return null

  const correlation: AuditCorrelation = { sessionId, turnId }
  const eventId = normalizeAuditId(input.eventId)
  const operationId = normalizeAuditId(input.operationId)
  const effectId = normalizeAuditId(input.effectId)
  if (eventId) correlation.eventId = eventId
  if (operationId) correlation.operationId = operationId
  if (effectId) correlation.effectId = effectId
  return correlation
}

/** Type guard for allowlisted safe metadata records. */
export function isTeachingAuditSafeMetadata(
  value: unknown
): value is TeachingAuditSafeMetadata {
  return projectSafeTeachingAuditMetadata(value) !== null
}

/**
 * Projects unknown input onto the allowlist schema.
 * Extra / denied fields are dropped; invalid required correlation yields null.
 */
export function projectSafeTeachingAuditMetadata(
  value: unknown
): TeachingAuditSafeMetadata | null {
  if (!isPlainObject(value)) return null
  if (value.schemaVersion !== TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION) return null
  if (value.kind !== 'teaching_audit') return null

  const correlation = createAuditCorrelation(
    isPlainObject(value.correlation)
      ? (value.correlation as TeachingAuditCorrelationInput)
      : ({} as TeachingAuditCorrelationInput)
  )
  if (!correlation) return null

  const safe: TeachingAuditSafeMetadata = {
    schemaVersion: TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION,
    kind: 'teaching_audit',
    correlation
  }

  const commandType = normalizeSafeToken(value.commandType)
  const toolName = normalizeSafeToken(value.toolName)
  const effectClass = normalizeEffectClass(value.effectClass)
  const evidenceEventId = normalizeAuditId(value.evidenceEventId)
  const outcomeKind = normalizeSafeToken(value.outcomeKind)
  const disposition = normalizeSafeToken(value.disposition)
  const resultBytes = normalizeNonNegativeInteger(value.resultBytes)
  const isError = value.isError === true ? true : value.isError === false ? false : undefined

  if (commandType) safe.commandType = commandType
  if (toolName) safe.toolName = toolName
  if (effectClass) safe.effectClass = effectClass
  if (evidenceEventId) safe.evidenceEventId = evidenceEventId
  if (outcomeKind) safe.outcomeKind = outcomeKind
  if (disposition) safe.disposition = disposition
  if (resultBytes !== undefined) safe.resultBytes = resultBytes
  if (isError !== undefined) safe.isError = isError

  return safe
}

/**
 * Hook: teaching-turn command / event envelope → safe audit metadata.
 * Intended for coordinator / event-bus correlation without storing payloads.
 */
export function buildTeachingAuditMetadataFromCommand(
  input: TeachingAuditCommandHookInput
): TeachingAuditSafeMetadata | null {
  const correlation = createAuditCorrelation(input)
  if (!correlation) return null
  return projectSafeTeachingAuditMetadata({
    schemaVersion: TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION,
    kind: 'teaching_audit',
    correlation,
    commandType: input.commandType,
    evidenceEventId: input.evidenceEventId,
    outcomeKind: input.outcomeKind
  })
}

/**
 * Hook: tool / operation execution → safe audit metadata.
 * Provider payloads, learner answers, secrets, and reasoning are ignored even if supplied.
 */
export function buildTeachingAuditMetadataForToolOperation(
  input: TeachingAuditToolOperationHookInput
): TeachingAuditSafeMetadata | null {
  // Explicitly discard privacy-sensitive hook inputs so call sites cannot smuggle them.
  void input.providerPayload
  void input.learnerAnswer
  void input.reasoning
  void input.secret
  void input.prompt
  void input.content
  void input.raw
  void input.transcript

  const correlation = createAuditCorrelation(input)
  if (!correlation) return null
  return projectSafeTeachingAuditMetadata({
    schemaVersion: TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION,
    kind: 'teaching_audit',
    correlation,
    toolName: input.toolName,
    effectClass: input.effectClass,
    disposition: input.disposition,
    resultBytes: input.resultBytes,
    isError: input.isError
  })
}

/**
 * Export / support-bundle redaction boundary.
 * Walks unknown records, keeps allowlisted audit shapes, redacts secrets, and
 * strips denied field names. Non-audit free-form objects become safe stubs.
 */
export function redactTeachingAuditForExport(value: unknown): unknown {
  return redactExportValue(value, 0)
}

/** Redacts a single diagnostic string before it may enter logs or export. */
export function redactTeachingAuditText(value: string): string {
  return compactExportText(redactAgentSecretText(value), MAX_EXPORT_STRING_LENGTH)
}

/**
 * Serializes safe metadata for tagged logs. Returns null when projection fails
 * so callers never log partially trusted free-form objects.
 */
export function formatTeachingAuditSafeLogLine(
  value: TeachingAuditSafeMetadata | null | undefined
): string | null {
  const safe = projectSafeTeachingAuditMetadata(value)
  if (!safe) return null
  return JSON.stringify(safe)
}

export function teachingAuditDeniedFieldName(name: string): boolean {
  return DENIED_FIELD_SET.has(name.toLowerCase())
}

function redactExportValue(value: unknown, depth: number): unknown {
  if (depth > MAX_EXPORT_DEPTH) return '[truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value) ? value : '[invalid-number]'
  }
  if (typeof value === 'string') {
    return redactTeachingAuditText(value)
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_EXPORT_KEYS).map((item) => redactExportValue(item, depth + 1))
  }
  if (!isPlainObject(value)) return '[omitted]'

  // Prefer projecting known audit metadata onto the allowlist, then surface
  // denied keys as explicit [redacted] markers and walk remaining free-form
  // diagnostic fields (so export never silently drops privacy denials).
  const projected = projectSafeTeachingAuditMetadata(value)
  if (projected) {
    return mergeProjectedExport(projected, value, depth)
  }

  // Pure correlation fragment (only ID keys) stays ID-only.
  if (looksLikeCorrelation(value)) {
    const keys = Object.keys(value)
    const onlyCorrelationKeys = keys.every((key) => CORRELATION_KEYS.has(key))
    if (onlyCorrelationKeys) {
      const correlation = createAuditCorrelation(value as TeachingAuditCorrelationInput)
      return correlation ?? { omitted: true, reason: 'invalid_correlation' }
    }
  }

  return walkFreeFormExport(value, depth)
}

function mergeProjectedExport(
  projected: TeachingAuditSafeMetadata,
  original: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...projected }
  let count = Object.keys(out).length
  for (const [key, nested] of Object.entries(original)) {
    if (Object.prototype.hasOwnProperty.call(out, key)) continue
    if (count >= MAX_EXPORT_KEYS) {
      out._truncated = true
      break
    }
    if (teachingAuditDeniedFieldName(key)) {
      out[key] = '[redacted]'
      count += 1
      continue
    }
    if (isOpaqueExportKey(key) || isPlainObject(nested) || Array.isArray(nested)) {
      out[key] = redactExportValue(nested, depth + 1)
      count += 1
      continue
    }
    if (typeof nested === 'string' || typeof nested === 'number' || typeof nested === 'boolean') {
      out[key] = redactExportValue(nested, depth + 1)
      count += 1
    }
  }
  return out
}

function walkFreeFormExport(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [key, nested] of Object.entries(value)) {
    if (count >= MAX_EXPORT_KEYS) {
      out._truncated = true
      break
    }
    if (teachingAuditDeniedFieldName(key)) {
      out[key] = '[redacted]'
      count += 1
      continue
    }
    // Only carry opaque id-like keys and nested safe structures for free-form export.
    if (isOpaqueExportKey(key) || isPlainObject(nested) || Array.isArray(nested)) {
      out[key] = redactExportValue(nested, depth + 1)
      count += 1
      continue
    }
    if (typeof nested === 'string' || typeof nested === 'number' || typeof nested === 'boolean') {
      out[key] = redactExportValue(nested, depth + 1)
      count += 1
    }
  }
  return out
}

function looksLikeCorrelation(value: Record<string, unknown>): boolean {
  return typeof value.sessionId === 'string' && typeof value.turnId === 'string'
}

function isOpaqueExportKey(key: string): boolean {
  return (
    CORRELATION_KEYS.has(key) ||
    SAFE_METADATA_KEYS.has(key) ||
    /Id$|ids?$/i.test(key) ||
    key === 'kind' ||
    key === 'schemaVersion' ||
    key === 'status' ||
    key === 'disposition' ||
    key === 'effectClass' ||
    key === 'commandType' ||
    key === 'toolName' ||
    key === 'resultBytes' ||
    key === 'isError'
  )
}

function normalizeAuditId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!ID_PATTERN.test(trimmed)) return undefined
  return trimmed
}

function normalizeSafeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact || compact.length > MAX_SAFE_STRING_LENGTH) return undefined
  // Tokens must not smuggle secrets or free-form learner text into the allowlist.
  if (teachingAuditDeniedFieldName(compact)) return undefined
  if (/[\\/\n\r]/.test(compact)) return undefined
  try {
    const redacted = redactAgentSecretText(compact)
    if (redacted !== compact) return undefined
  } catch {
    return undefined
  }
  return compact
}

function normalizeEffectClass(value: unknown): TeachingAuditEffectClass | undefined {
  return typeof value === 'string' && EFFECT_CLASSES.has(value as TeachingAuditEffectClass)
    ? (value as TeachingAuditEffectClass)
    : undefined
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : undefined
}

function compactExportText(value: string, maxLength: number): string {
  const singleLine = value.replace(/[\r\n]+/g, ' ').trim() || '[empty]'
  return singleLine.length <= maxLength
    ? singleLine
    : `${singleLine.slice(0, Math.max(0, maxLength - 1))}…`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
