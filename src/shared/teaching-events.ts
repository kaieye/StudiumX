/**
 * Canonical Teaching Event Protocol (schemaVersion = 1).
 *
 * Domain events are a closed, versioned tagged union. Runtime parsers reject
 * malformed or unrecognized new-author payloads without leaking raw input.
 * Legacy/unknown agent stream shapes are only accepted through explicit adapters.
 */


import type { OpenLearningSessionInput } from './teaching-types/learning-session'
import type { LearningOutcomeKind } from './teaching-types/learning-session'
import type { LessonInteraction } from './teaching-types/lesson-interaction'
import type { LearningOutcomeCommitRequest } from './teaching-types/learning-outcome'
import type { NextTeachingStepFacts } from './teaching-types/next-teaching-step'
import type { TrustedTeachingResourceDescriptor } from './teaching-types/grounding'
import { normalizeLessonInteraction } from './teaching-types/lesson-interaction'
export const TEACHING_EVENT_SCHEMA_VERSION = 1 as const

export type TeachingEventSchemaVersion = typeof TEACHING_EVENT_SCHEMA_VERSION

/** Durable events may be rebuilt from filesystem truth; ephemeral ones may not. */
export type TeachingEventDurability = 'durable' | 'ephemeral'

/**
 * Learner-safe terminal outcomes for a teaching turn.
 * These are presentation/coordination terminals, not durable mastery claims.
 */
export type TeachingTurnTerminalOutcome =
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'canceled'
  | 'declined'
  | 'conflict'

/**
 * Closed set of terminal reason codes. Free-form strings are rejected by the parser.
 * These are coordination diagnostics, not durable mastery claims.
 */
export type TeachingTurnTerminalReasonCode =
  | 'committed'
  | 'already_committed'
  | 'insufficient_evidence'
  | 'conflict'
  | 'non_retryable_failure'
  | 'canceled'
  | 'declined'
  | 'interrupted'
  | 'session_not_found'
  | 'planner_unavailable'
  | 'port_failed'
  | 'port_interrupted'
  | 'user_cancel'

export type TeachingEventPayloadType =
  | 'session_opened'
  | 'session_resumed'
  | 'evidence_recorded'
  | 'outcome_committed'
  | 'outcome_already_committed'
  | 'outcome_insufficient_evidence'
  | 'loop_snapshot'
  | 'next_step'
  | 'turn_progress'
  | 'turn_terminal'
  | 'replay_gap'
  | 'legacy_adapted'
  | 'unknown_rejected'
  | 'command_accepted'
  | 'command_duplicate'
  | 'recover_reconciled'

const PAYLOAD_TYPES = new Set<TeachingEventPayloadType>([
  'session_opened',
  'session_resumed',
  'evidence_recorded',
  'outcome_committed',
  'outcome_already_committed',
  'outcome_insufficient_evidence',
  'loop_snapshot',
  'next_step',
  'turn_progress',
  'turn_terminal',
  'replay_gap',
  'legacy_adapted',
  'unknown_rejected',
  'command_accepted',
  'command_duplicate',
  'recover_reconciled'
])

const TERMINAL_OUTCOMES = new Set<TeachingTurnTerminalOutcome>([
  'completed',
  'interrupted',
  'failed',
  'canceled',
  'declined',
  'conflict'
])

export const TEACHING_TURN_TERMINAL_REASON_CODES: readonly TeachingTurnTerminalReasonCode[] = [
  'committed',
  'already_committed',
  'insufficient_evidence',
  'conflict',
  'non_retryable_failure',
  'canceled',
  'declined',
  'interrupted',
  'session_not_found',
  'planner_unavailable',
  'port_failed',
  'port_interrupted',
  'user_cancel'
] as const

const TERMINAL_REASON_CODES = new Set<string>(TEACHING_TURN_TERMINAL_REASON_CODES)

/** Payload types that must always be durable. */
const DURABILITY_MUST_DURABLE = new Set<TeachingEventPayloadType>([
  'session_opened',
  'session_resumed',
  'evidence_recorded',
  'outcome_committed',
  'outcome_already_committed'
])

/** Payload types that must always be ephemeral. */
const DURABILITY_MUST_EPHEMERAL = new Set<TeachingEventPayloadType>([
  'loop_snapshot',
  'next_step',
  'turn_progress',
  'turn_terminal',
  'replay_gap',
  'legacy_adapted',
  'unknown_rejected',
  'command_accepted',
  'command_duplicate'
])

/** Payload types that may be either durable or ephemeral depending on persistence. */
const DURABILITY_EITHER = new Set<TeachingEventPayloadType>([
  'outcome_insufficient_evidence',
  'recover_reconciled'
])

const DURABILITIES = new Set<TeachingEventDurability>(['durable', 'ephemeral'])

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

export type TeachingEventIdentity = {
  workspaceId: string
  sessionId: string
  turnId: string
  eventId: string
  itemId?: string
  operationId?: string
}

export type TeachingSessionOpenedPayload = {
  type: 'session_opened'
  sessionId: string
  courseId: string
  status: 'active' | 'completed'
  source: 'canonical' | 'legacy_lesson'
}

export type TeachingSessionResumedPayload = {
  type: 'session_resumed'
  sessionId: string
  status: 'active' | 'completed' | 'legacy_read_only'
  eventCount: number
}

export type TeachingEvidenceRecordedPayload = {
  type: 'evidence_recorded'
  sessionId: string
  evidenceEventId: string
  sequence: number
  duplicate: boolean
  kind: string
}

export type TeachingOutcomeCommittedPayload = {
  type: 'outcome_committed'
  sessionId: string
  outcomeKind: string
  recordSaved: boolean
}

export type TeachingOutcomeAlreadyCommittedPayload = {
  type: 'outcome_already_committed'
  sessionId: string
  outcomeKind: string
  recordSaved: boolean
}

export type TeachingOutcomeInsufficientEvidencePayload = {
  type: 'outcome_insufficient_evidence'
  sessionId: string
  reason: 'not_evidenced'
}

export type TeachingLoopSnapshotPayload = {
  type: 'loop_snapshot'
  identity: string
  displayState: string
  sessionId: string | null
  outcomeStatus: string
  integrityCodes: readonly string[]
}

export type TeachingNextStepPayload = {
  type: 'next_step'
  action: string
  reason: string
}

export type TeachingTurnProgressPayload = {
  type: 'turn_progress'
  stage: string
  message?: string
}

export type TeachingTurnTerminalPayload = {
  type: 'turn_terminal'
  outcome: TeachingTurnTerminalOutcome
  reasonCode?: TeachingTurnTerminalReasonCode
  message?: string
}

export type TeachingReplayGapPayload = {
  type: 'replay_gap'
  droppedEvents: number
  retainedFromSequence: number
}

export type TeachingLegacyAdaptedPayload = {
  type: 'legacy_adapted'
  originalKind: string
  summary: string
}

export type TeachingUnknownRejectedPayload = {
  type: 'unknown_rejected'
  reasonCode: TeachingEventParseErrorCode
}

export type TeachingCommandAcceptedPayload = {
  type: 'command_accepted'
  commandType: string
}

export type TeachingCommandDuplicatePayload = {
  type: 'command_duplicate'
  commandType: string
  originalEventId: string
}

export type TeachingRecoverReconciledPayload = {
  type: 'recover_reconciled'
  sessionId: string
  state: string
}

export type TeachingEventPayload =
  | TeachingSessionOpenedPayload
  | TeachingSessionResumedPayload
  | TeachingEvidenceRecordedPayload
  | TeachingOutcomeCommittedPayload
  | TeachingOutcomeAlreadyCommittedPayload
  | TeachingOutcomeInsufficientEvidencePayload
  | TeachingLoopSnapshotPayload
  | TeachingNextStepPayload
  | TeachingTurnProgressPayload
  | TeachingTurnTerminalPayload
  | TeachingReplayGapPayload
  | TeachingLegacyAdaptedPayload
  | TeachingUnknownRejectedPayload
  | TeachingCommandAcceptedPayload
  | TeachingCommandDuplicatePayload
  | TeachingRecoverReconciledPayload

/**
 * Canonical envelope. sequence is assigned by the turn event bus (ephemeral
 * stream ordering) and is not a durable ledger authority.
 */
export type TeachingEventEnvelope = TeachingEventIdentity & {
  schemaVersion: TeachingEventSchemaVersion
  durability: TeachingEventDurability
  occurredAt: string
  payload: TeachingEventPayload
  sequence?: number
}

export type TeachingEventParseErrorCode =
  | 'not_object'
  | 'unsupported_schema_version'
  | 'missing_required_field'
  | 'invalid_id'
  | 'invalid_timestamp'
  | 'invalid_durability'
  | 'invalid_payload'
  | 'unrecognized_payload_type'
  | 'invalid_terminal_outcome'
  | 'invalid_terminal_reason'
  | 'invalid_sequence'

/** Closed set of parse error codes accepted on unknown_rejected payloads. */
export const TEACHING_EVENT_PARSE_ERROR_CODES: readonly TeachingEventParseErrorCode[] = [
  'not_object',
  'unsupported_schema_version',
  'missing_required_field',
  'invalid_id',
  'invalid_timestamp',
  'invalid_durability',
  'invalid_payload',
  'unrecognized_payload_type',
  'invalid_terminal_outcome',
  'invalid_terminal_reason',
  'invalid_sequence'
] as const

const PARSE_ERROR_CODE_SET = new Set<string>(TEACHING_EVENT_PARSE_ERROR_CODES)

export function isTeachingEventParseErrorCode(value: unknown): value is TeachingEventParseErrorCode {
  return typeof value === 'string' && PARSE_ERROR_CODE_SET.has(value)
}

export class TeachingEventParseError extends Error {
  readonly code: TeachingEventParseErrorCode
  readonly field?: string

  constructor(code: TeachingEventParseErrorCode, message: string, field?: string) {
    super(message)
    this.name = 'TeachingEventParseError'
    this.code = code
    this.field = field
  }
}

export type TeachingEventParseFailure = {
  ok: false
  code: TeachingEventParseErrorCode
  field?: string
  /** Safe, non-leaking diagnostic only. Never includes raw payload bytes. */
  message: string
}

export type TeachingEventParseSuccess = {
  ok: true
  event: TeachingEventEnvelope
}

export type TeachingEventParseResult = TeachingEventParseSuccess | TeachingEventParseFailure

export type TeachingEventAuthoringInput = {
  durability: TeachingEventDurability
  occurredAt: string
  workspaceId: string
  sessionId: string
  turnId: string
  eventId: string
  itemId?: string
  operationId?: string
  payload: TeachingEventPayload
  sequence?: number
}

/** Build a validated envelope; throws TeachingEventParseError on invalid input. */
export function createTeachingEvent(input: TeachingEventAuthoringInput): TeachingEventEnvelope {
  const result = parseTeachingEvent({
    schemaVersion: TEACHING_EVENT_SCHEMA_VERSION,
    ...input
  })
  if (!result.ok) {
    throw new TeachingEventParseError(result.code, result.message, result.field)
  }
  return result.event
}

/**
 * Runtime parser for untrusted/new-author input. Rejects malformed or unknown
 * shapes without echoing raw payload content.
 */
export function parseTeachingEvent(value: unknown): TeachingEventParseResult {
  if (!isPlainObject(value)) {
    return fail('not_object', 'Teaching event must be a plain object.')
  }

  if (value.schemaVersion !== TEACHING_EVENT_SCHEMA_VERSION) {
    return fail('unsupported_schema_version', 'Unsupported teaching event schema version.', 'schemaVersion')
  }

  const durability = value.durability
  if (typeof durability !== 'string' || !DURABILITIES.has(durability as TeachingEventDurability)) {
    return fail('invalid_durability', 'Teaching event durability must be durable or ephemeral.', 'durability')
  }

  const occurredAt = requireIsoTimestamp(value.occurredAt, 'occurredAt')
  if (!occurredAt.ok) return occurredAt

  const workspaceId = requireId(value.workspaceId, 'workspaceId')
  if (!workspaceId.ok) return workspaceId
  const sessionId = requireId(value.sessionId, 'sessionId')
  if (!sessionId.ok) return sessionId
  const turnId = requireId(value.turnId, 'turnId')
  if (!turnId.ok) return turnId
  const eventId = requireId(value.eventId, 'eventId')
  if (!eventId.ok) return eventId

  let itemId: string | undefined
  if (value.itemId !== undefined) {
    const parsed = requireId(value.itemId, 'itemId')
    if (!parsed.ok) return parsed
    itemId = parsed.value
  }

  let operationId: string | undefined
  if (value.operationId !== undefined) {
    const parsed = requireId(value.operationId, 'operationId')
    if (!parsed.ok) return parsed
    operationId = parsed.value
  }

  let sequence: number | undefined
  if (value.sequence !== undefined) {
    if (!Number.isInteger(value.sequence) || (value.sequence as number) < 1) {
      return fail('invalid_sequence', 'Teaching event sequence must be a positive integer.', 'sequence')
    }
    sequence = value.sequence as number
  }

  const payloadResult = parsePayload(value.payload)
  if (!payloadResult.ok) return payloadResult

  const durabilityCheck = validateDurabilityPolicy(
    durability as TeachingEventDurability,
    payloadResult.value.type
  )
  if (!durabilityCheck.ok) return durabilityCheck

  // Fail-closed: payload-embedded session identity must match envelope sessionId.
  const identityCheck = validatePayloadIdentityBinding(sessionId.value, payloadResult.value)
  if (!identityCheck.ok) return identityCheck

  const event: TeachingEventEnvelope = {
    schemaVersion: TEACHING_EVENT_SCHEMA_VERSION,
    durability: durability as TeachingEventDurability,
    occurredAt: occurredAt.value,
    workspaceId: workspaceId.value,
    sessionId: sessionId.value,
    turnId: turnId.value,
    eventId: eventId.value,
    payload: payloadResult.value
  }
  if (itemId !== undefined) event.itemId = itemId
  if (operationId !== undefined) event.operationId = operationId
  if (sequence !== undefined) event.sequence = sequence
  return { ok: true, event }
}

/**
 * Map a durable commit/result status into a learner-safe turn terminal.
 * Does not invent mastery; only maps coordination outcomes.
 *
 * Returns null for retryable_failure so the turn stays open for same-turn retry.
 * Only truly unrecoverable / final statuses produce a sticky terminal outcome.
 */
export function mapCommitStatusToTerminal(
  status:
    | 'committed'
    | 'already_committed'
    | 'insufficient_evidence'
    | 'conflict'
    | 'retryable_failure'
    | 'non_retryable_failure'
    | 'canceled'
    | 'declined'
    | 'interrupted'
): TeachingTurnTerminalOutcome | null {
  switch (status) {
    case 'committed':
    case 'already_committed':
      return 'completed'
    case 'insufficient_evidence':
      return 'failed'
    case 'conflict':
      return 'conflict'
    case 'canceled':
      return 'canceled'
    case 'interrupted':
      return 'interrupted'
    case 'declined':
      return 'declined'
    case 'non_retryable_failure':
      return 'failed'
    case 'retryable_failure':
      return null
  }
}

/** True when a commit status must sticky-close the turn. */
export function isTerminalCommitStatus(
  status: Parameters<typeof mapCommitStatusToTerminal>[0]
): boolean {
  return mapCommitStatusToTerminal(status) !== null
}

export function isTeachingTurnTerminalReasonCode(
  value: unknown
): value is TeachingTurnTerminalReasonCode {
  return typeof value === 'string' && TERMINAL_REASON_CODES.has(value)
}

export function teachingTurnTerminalReasonCodes(): readonly TeachingTurnTerminalReasonCode[] {
  return [...TEACHING_TURN_TERMINAL_REASON_CODES]
}

/**
 * Schema durability policy for a payload type.
 * - durable: must use durability='durable'
 * - ephemeral: must use durability='ephemeral'
 * - either: may be durable or ephemeral based on whether a durable receipt exists
 */
export function teachingEventDurabilityPolicy(
  payloadType: TeachingEventPayloadType
): 'durable' | 'ephemeral' | 'either' {
  if (DURABILITY_MUST_DURABLE.has(payloadType)) return 'durable'
  if (DURABILITY_MUST_EPHEMERAL.has(payloadType)) return 'ephemeral'
  if (DURABILITY_EITHER.has(payloadType)) return 'either'
  return 'ephemeral'
}

/**
 * Explicit adapter for legacy/unknown agent stream kinds. Never accepts free-form
 * payloads as first-class teaching events; emits a safe summary only.
 */
export function adaptLegacyAgentStreamEvent(input: {
  kind: string
  summary?: string
  workspaceId: string
  sessionId: string
  turnId: string
  eventId: string
  occurredAt: string
  operationId?: string
}): TeachingEventEnvelope {
  const kind = typeof input.kind === 'string' && input.kind.trim() ? input.kind.trim().slice(0, 64) : 'unknown'
  const summary =
    typeof input.summary === 'string' && input.summary.trim()
      ? input.summary.trim().slice(0, 160)
      : `legacy:${kind}`

  return createTeachingEvent({
    durability: 'ephemeral',
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    eventId: input.eventId,
    operationId: input.operationId,
    payload: {
      type: 'legacy_adapted',
      originalKind: kind,
      summary
    }
  })
}

/**
 * Build a safe rejection envelope when an untrusted author produces unknown input.
 * The original raw value is intentionally discarded.
 */
export function createUnknownRejectedEvent(input: {
  workspaceId: string
  sessionId: string
  turnId: string
  eventId: string
  occurredAt: string
  reasonCode: TeachingEventParseErrorCode
  operationId?: string
}): TeachingEventEnvelope {
  return createTeachingEvent({
    durability: 'ephemeral',
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    eventId: input.eventId,
    operationId: input.operationId,
    payload: {
      type: 'unknown_rejected',
      reasonCode: input.reasonCode
    }
  })
}

export function isTeachingTurnTerminalPayload(
  payload: TeachingEventPayload
): payload is TeachingTurnTerminalPayload {
  return payload.type === 'turn_terminal'
}

export function isDurableTeachingEvent(event: TeachingEventEnvelope): boolean {
  return event.durability === 'durable'
}

export function teachingEventPayloadTypes(): readonly TeachingEventPayloadType[] {
  return [...PAYLOAD_TYPES]
}

/**
 * Envelope sessionId is authoritative. When a payload embeds sessionId, it must
 * match (null snapshot session is allowed only for loop_snapshot empty projection).
 */
function validatePayloadIdentityBinding(
  envelopeSessionId: string,
  payload: TeachingEventPayload
): TeachingEventParseResult | { ok: true } {
  const embedded = payloadSessionId(payload)
  if (embedded === undefined) return { ok: true }
  if (embedded === null) return { ok: true }
  if (embedded !== envelopeSessionId) {
    return fail(
      'invalid_payload',
      'Payload sessionId must match envelope sessionId.',
      'payload.sessionId'
    )
  }
  return { ok: true }
}

function payloadSessionId(payload: TeachingEventPayload): string | null | undefined {
  switch (payload.type) {
    case 'session_opened':
    case 'session_resumed':
    case 'evidence_recorded':
    case 'outcome_committed':
    case 'outcome_already_committed':
    case 'outcome_insufficient_evidence':
    case 'recover_reconciled':
      return payload.sessionId
    case 'loop_snapshot':
      return payload.sessionId
    default:
      return undefined
  }
}

function parsePayload(value: unknown): { ok: true; value: TeachingEventPayload } | TeachingEventParseFailure {
  if (!isPlainObject(value)) {
    return fail('invalid_payload', 'Teaching event payload must be a plain object.', 'payload')
  }
  const type = value.type
  if (typeof type !== 'string' || !PAYLOAD_TYPES.has(type as TeachingEventPayloadType)) {
    return fail('unrecognized_payload_type', 'Unrecognized teaching event payload type.', 'payload.type')
  }

  switch (type as TeachingEventPayloadType) {
    case 'session_opened': {
      const sessionId = requireId(value.sessionId, 'payload.sessionId')
      if (!sessionId.ok) return sessionId
      const courseId = requireId(value.courseId, 'payload.courseId')
      if (!courseId.ok) return courseId
      if (value.status !== 'active' && value.status !== 'completed') {
        return fail('invalid_payload', 'session_opened status is invalid.', 'payload.status')
      }
      if (value.source !== 'canonical' && value.source !== 'legacy_lesson') {
        return fail('invalid_payload', 'session_opened source is invalid.', 'payload.source')
      }
      return {
        ok: true,
        value: {
          type: 'session_opened',
          sessionId: sessionId.value,
          courseId: courseId.value,
          status: value.status,
          source: value.source
        }
      }
    }
    case 'session_resumed': {
      const sessionId = requireId(value.sessionId, 'payload.sessionId')
      if (!sessionId.ok) return sessionId
      if (
        value.status !== 'active' &&
        value.status !== 'completed' &&
        value.status !== 'legacy_read_only'
      ) {
        return fail('invalid_payload', 'session_resumed status is invalid.', 'payload.status')
      }
      if (!Number.isInteger(value.eventCount) || (value.eventCount as number) < 0) {
        return fail('invalid_payload', 'session_resumed eventCount is invalid.', 'payload.eventCount')
      }
      return {
        ok: true,
        value: {
          type: 'session_resumed',
          sessionId: sessionId.value,
          status: value.status,
          eventCount: value.eventCount as number
        }
      }
    }
    case 'evidence_recorded': {
      const sessionId = requireId(value.sessionId, 'payload.sessionId')
      if (!sessionId.ok) return sessionId
      const evidenceEventId = requireId(value.evidenceEventId, 'payload.evidenceEventId')
      if (!evidenceEventId.ok) return evidenceEventId
      if (!Number.isInteger(value.sequence) || (value.sequence as number) < 1) {
        return fail('invalid_payload', 'evidence_recorded sequence is invalid.', 'payload.sequence')
      }
      if (typeof value.duplicate !== 'boolean') {
        return fail('invalid_payload', 'evidence_recorded duplicate must be boolean.', 'payload.duplicate')
      }
      if (typeof value.kind !== 'string' || !value.kind.trim() || value.kind.length > 64) {
        return fail('invalid_payload', 'evidence_recorded kind is invalid.', 'payload.kind')
      }
      return {
        ok: true,
        value: {
          type: 'evidence_recorded',
          sessionId: sessionId.value,
          evidenceEventId: evidenceEventId.value,
          sequence: value.sequence as number,
          duplicate: value.duplicate,
          kind: value.kind
        }
      }
    }
    case 'outcome_committed':
    case 'outcome_already_committed': {
      const sessionId = requireId(value.sessionId, 'payload.sessionId')
      if (!sessionId.ok) return sessionId
      if (typeof value.outcomeKind !== 'string' || !value.outcomeKind.trim() || value.outcomeKind.length > 64) {
        return fail('invalid_payload', `${type} outcomeKind is invalid.`, 'payload.outcomeKind')
      }
      if (typeof value.recordSaved !== 'boolean') {
        return fail('invalid_payload', `${type} recordSaved must be boolean.`, 'payload.recordSaved')
      }
      return {
        ok: true,
        value: {
          type,
          sessionId: sessionId.value,
          outcomeKind: value.outcomeKind,
          recordSaved: value.recordSaved
        } as TeachingOutcomeCommittedPayload | TeachingOutcomeAlreadyCommittedPayload
      }
    }
    case 'outcome_insufficient_evidence': {
      const sessionId = requireId(value.sessionId, 'payload.sessionId')
      if (!sessionId.ok) return sessionId
      if (value.reason !== 'not_evidenced') {
        return fail('invalid_payload', 'outcome_insufficient_evidence reason is invalid.', 'payload.reason')
      }
      return {
        ok: true,
        value: {
          type: 'outcome_insufficient_evidence',
          sessionId: sessionId.value,
          reason: 'not_evidenced'
        }
      }
    }
    case 'loop_snapshot': {
      if (typeof value.identity !== 'string' || !/^[a-f0-9]{64}$/.test(value.identity)) {
        return fail('invalid_payload', 'loop_snapshot identity must be sha256 hex.', 'payload.identity')
      }
      if (typeof value.displayState !== 'string' || !value.displayState.trim() || value.displayState.length > 64) {
        return fail('invalid_payload', 'loop_snapshot displayState is invalid.', 'payload.displayState')
      }
      if (value.sessionId !== null) {
        const sessionId = requireId(value.sessionId, 'payload.sessionId')
        if (!sessionId.ok) return sessionId
      }
      if (typeof value.outcomeStatus !== 'string' || !value.outcomeStatus.trim() || value.outcomeStatus.length > 64) {
        return fail('invalid_payload', 'loop_snapshot outcomeStatus is invalid.', 'payload.outcomeStatus')
      }
      if (!Array.isArray(value.integrityCodes) || !value.integrityCodes.every((code) => typeof code === 'string' && code.length <= 64)) {
        return fail('invalid_payload', 'loop_snapshot integrityCodes is invalid.', 'payload.integrityCodes')
      }
      return {
        ok: true,
        value: {
          type: 'loop_snapshot',
          identity: value.identity,
          displayState: value.displayState,
          sessionId: value.sessionId as string | null,
          outcomeStatus: value.outcomeStatus,
          integrityCodes: [...(value.integrityCodes as string[])]
        }
      }
    }
    case 'next_step': {
      if (typeof value.action !== 'string' || !value.action.trim() || value.action.length > 64) {
        return fail('invalid_payload', 'next_step action is invalid.', 'payload.action')
      }
      if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 64) {
        return fail('invalid_payload', 'next_step reason is invalid.', 'payload.reason')
      }
      return {
        ok: true,
        value: {
          type: 'next_step',
          action: value.action,
          reason: value.reason
        }
      }
    }
    case 'turn_progress': {
      if (typeof value.stage !== 'string' || !value.stage.trim() || value.stage.length > 64) {
        return fail('invalid_payload', 'turn_progress stage is invalid.', 'payload.stage')
      }
      let message: string | undefined
      if (value.message !== undefined) {
        if (typeof value.message !== 'string' || value.message.length > 240) {
          return fail('invalid_payload', 'turn_progress message is invalid.', 'payload.message')
        }
        message = value.message
      }
      return {
        ok: true,
        value: message === undefined
          ? { type: 'turn_progress', stage: value.stage }
          : { type: 'turn_progress', stage: value.stage, message }
      }
    }
    case 'turn_terminal': {
      if (typeof value.outcome !== 'string' || !TERMINAL_OUTCOMES.has(value.outcome as TeachingTurnTerminalOutcome)) {
        return fail('invalid_terminal_outcome', 'turn_terminal outcome is not learner-safe.', 'payload.outcome')
      }
      let reasonCode: TeachingTurnTerminalReasonCode | undefined
      if (value.reasonCode !== undefined) {
        if (!isTeachingTurnTerminalReasonCode(value.reasonCode)) {
          return fail(
            'invalid_terminal_reason',
            'turn_terminal reasonCode is not in the closed reason set.',
            'payload.reasonCode'
          )
        }
        reasonCode = value.reasonCode
      }
      let message: string | undefined
      if (value.message !== undefined) {
        if (typeof value.message !== 'string' || value.message.length > 240) {
          return fail('invalid_payload', 'turn_terminal message is invalid.', 'payload.message')
        }
        message = value.message
      }
      return {
        ok: true,
        value: {
          type: 'turn_terminal',
          outcome: value.outcome as TeachingTurnTerminalOutcome,
          ...(reasonCode !== undefined ? { reasonCode } : {}),
          ...(message !== undefined ? { message } : {})
        }
      }
    }
    case 'replay_gap': {
      if (!Number.isInteger(value.droppedEvents) || (value.droppedEvents as number) < 0) {
        return fail('invalid_payload', 'replay_gap droppedEvents is invalid.', 'payload.droppedEvents')
      }
      if (!Number.isInteger(value.retainedFromSequence) || (value.retainedFromSequence as number) < 1) {
        return fail('invalid_payload', 'replay_gap retainedFromSequence is invalid.', 'payload.retainedFromSequence')
      }
      return {
        ok: true,
        value: {
          type: 'replay_gap',
          droppedEvents: value.droppedEvents as number,
          retainedFromSequence: value.retainedFromSequence as number
        }
      }
    }
    case 'legacy_adapted': {
      if (typeof value.originalKind !== 'string' || !value.originalKind.trim() || value.originalKind.length > 64) {
        return fail('invalid_payload', 'legacy_adapted originalKind is invalid.', 'payload.originalKind')
      }
      if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 160) {
        return fail('invalid_payload', 'legacy_adapted summary is invalid.', 'payload.summary')
      }
      return {
        ok: true,
        value: {
          type: 'legacy_adapted',
          originalKind: value.originalKind,
          summary: value.summary
        }
      }
    }
    case 'unknown_rejected': {
      if (!isTeachingEventParseErrorCode(value.reasonCode)) {
        return fail(
          'invalid_payload',
          'unknown_rejected reasonCode must be a closed TeachingEventParseErrorCode.',
          'payload.reasonCode'
        )
      }
      return {
        ok: true,
        value: {
          type: 'unknown_rejected',
          reasonCode: value.reasonCode
        }
      }
    }
    case 'command_accepted': {
      if (typeof value.commandType !== 'string' || !value.commandType.trim() || value.commandType.length > 64) {
        return fail('invalid_payload', 'command_accepted commandType is invalid.', 'payload.commandType')
      }
      return {
        ok: true,
        value: {
          type: 'command_accepted',
          commandType: value.commandType
        }
      }
    }
    case 'command_duplicate': {
      if (typeof value.commandType !== 'string' || !value.commandType.trim() || value.commandType.length > 64) {
        return fail('invalid_payload', 'command_duplicate commandType is invalid.', 'payload.commandType')
      }
      const originalEventId = requireId(value.originalEventId, 'payload.originalEventId')
      if (!originalEventId.ok) return originalEventId
      return {
        ok: true,
        value: {
          type: 'command_duplicate',
          commandType: value.commandType,
          originalEventId: originalEventId.value
        }
      }
    }
    case 'recover_reconciled': {
      const sessionId = requireId(value.sessionId, 'payload.sessionId')
      if (!sessionId.ok) return sessionId
      if (typeof value.state !== 'string' || !value.state.trim() || value.state.length > 64) {
        return fail('invalid_payload', 'recover_reconciled state is invalid.', 'payload.state')
      }
      return {
        ok: true,
        value: {
          type: 'recover_reconciled',
          sessionId: sessionId.value,
          state: value.state
        }
      }
    }
  }
}

function requireId(
  value: unknown,
  field: string
): { ok: true; value: string } | TeachingEventParseFailure {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return fail(value === undefined || value === null ? 'missing_required_field' : 'invalid_id', `Invalid teaching event id at ${field}.`, field)
  }
  return { ok: true, value }
}

function requireIsoTimestamp(
  value: unknown,
  field: string
): { ok: true; value: string } | TeachingEventParseFailure {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return fail(
      value === undefined || value === null ? 'missing_required_field' : 'invalid_timestamp',
      `Invalid teaching event timestamp at ${field}.`,
      field
    )
  }
  return { ok: true, value }
}

function validateDurabilityPolicy(
  durability: TeachingEventDurability,
  payloadType: TeachingEventPayloadType
): { ok: true } | TeachingEventParseFailure {
  const policy = teachingEventDurabilityPolicy(payloadType)
  if (policy === 'durable' && durability !== 'durable') {
    return fail(
      'invalid_durability',
      `Payload type ${payloadType} requires durable durability.`,
      'durability'
    )
  }
  if (policy === 'ephemeral' && durability !== 'ephemeral') {
    return fail(
      'invalid_durability',
      `Payload type ${payloadType} requires ephemeral durability.`,
      'durability'
    )
  }
  return { ok: true }
}

function fail(code: TeachingEventParseErrorCode, message: string, field?: string): TeachingEventParseFailure {
  return field === undefined ? { ok: false, code, message } : { ok: false, code, field, message }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


/* -------------------------------------------------------------------------- */
/* Teaching turn command runtime schema (closed discriminants + identity bind) */
/* -------------------------------------------------------------------------- */

export type TeachingTurnCommandType =
  | 'open_session'
  | 'resume_session'
  | 'record_evidence'
  | 'commit_outcome'
  | 'plan_next_step'
  | 'project_snapshot'
  | 'recover_session'
  | 'cancel_turn'

const TEACHING_TURN_COMMAND_TYPES = new Set<TeachingTurnCommandType>([
  'open_session',
  'resume_session',
  'record_evidence',
  'commit_outcome',
  'plan_next_step',
  'project_snapshot',
  'recover_session',
  'cancel_turn'
])

export type TeachingTurnCommandEnvelope = {
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
}

export type TeachingTurnProjectFactInput = {
  mission: { id: string; nextGoal: 'available' | 'absent' | 'unknown' }
  course: { id: string }
  resources: {
    readiness: 'ready' | 'not_ready' | 'unknown'
    availableCount: number
    provenanceIds: readonly string[]
  }
  /** Explicit real session id — never derived from course.id. */
  sessionId: string
}

export type TeachingTurnOpenSessionCommand = TeachingTurnCommandEnvelope & {
  type: 'open_session'
  open: OpenLearningSessionInput
}

export type TeachingTurnResumeSessionCommand = TeachingTurnCommandEnvelope & {
  type: 'resume_session'
  sessionId: string
}

export type TeachingTurnRecordEvidenceCommand = TeachingTurnCommandEnvelope & {
  type: 'record_evidence'
  evidence: LessonInteraction
}

export type TeachingTurnCommitOutcomeCommand = TeachingTurnCommandEnvelope & {
  type: 'commit_outcome'
  request: LearningOutcomeCommitRequest
}

export type TeachingTurnPlanNextStepCommand = TeachingTurnCommandEnvelope & {
  type: 'plan_next_step'
  sessionId: string
  facts: NextTeachingStepFacts
}

export type TeachingTurnProjectSnapshotCommand = TeachingTurnCommandEnvelope & {
  type: 'project_snapshot'
  factInput: TeachingTurnProjectFactInput
  readyResources?: readonly TrustedTeachingResourceDescriptor[]
}

export type TeachingTurnRecoverSessionCommand = TeachingTurnCommandEnvelope & {
  type: 'recover_session'
  sessionId: string
}

export type TeachingTurnCancelCommand = TeachingTurnCommandEnvelope & {
  type: 'cancel_turn'
  sessionId: string
  reasonCode?: TeachingTurnTerminalReasonCode
}

export type TeachingTurnCommand =
  | TeachingTurnOpenSessionCommand
  | TeachingTurnResumeSessionCommand
  | TeachingTurnRecordEvidenceCommand
  | TeachingTurnCommitOutcomeCommand
  | TeachingTurnPlanNextStepCommand
  | TeachingTurnProjectSnapshotCommand
  | TeachingTurnRecoverSessionCommand
  | TeachingTurnCancelCommand

export type TeachingTurnCommandParseSuccess = {
  ok: true
  value: TeachingTurnCommand
}

export type TeachingTurnCommandParseFailure = {
  ok: false
  code: TeachingEventParseErrorCode
  field?: string
  message: string
}

export type TeachingTurnCommandParseResult =
  | TeachingTurnCommandParseSuccess
  | TeachingTurnCommandParseFailure

/**
 * Runtime parser for teaching turn commands.
 * Fail-closed: unknown shapes, missing envelope ids, and nested identity mismatches
 * never produce a typed command.
 */
export function parseTeachingTurnCommand(value: unknown): TeachingTurnCommandParseResult {
  if (!isPlainObject(value)) {
    return failCommand('invalid_payload', 'Teaching turn command must be a plain object.')
  }

  const type = value.type
  if (typeof type !== 'string' || !TEACHING_TURN_COMMAND_TYPES.has(type as TeachingTurnCommandType)) {
    return failCommand('unrecognized_payload_type', 'Unrecognized teaching turn command type.', 'type')
  }

  const turnId = requireId(value.turnId, 'turnId')
  if (!turnId.ok) return toCommandFailure(turnId)
  const eventId = requireId(value.eventId, 'eventId')
  if (!eventId.ok) return toCommandFailure(eventId)
  const operationId = requireId(value.operationId, 'operationId')
  if (!operationId.ok) return toCommandFailure(operationId)
  const workspaceId = requireId(value.workspaceId, 'workspaceId')
  if (!workspaceId.ok) return toCommandFailure(workspaceId)

  const envelope = {
    turnId: turnId.value,
    eventId: eventId.value,
    operationId: operationId.value,
    workspaceId: workspaceId.value
  }

  switch (type as TeachingTurnCommandType) {
    case 'open_session':
      return parseOpenSessionCommand(envelope, value)
    case 'resume_session':
      return parseSessionScopedCommand(envelope, value, 'resume_session')
    case 'recover_session':
      return parseSessionScopedCommand(envelope, value, 'recover_session')
    case 'cancel_turn':
      return parseCancelCommand(envelope, value)
    case 'record_evidence':
      return parseRecordEvidenceCommand(envelope, value)
    case 'commit_outcome':
      return parseCommitOutcomeCommand(envelope, value)
    case 'plan_next_step':
      return parsePlanNextStepCommand(envelope, value)
    case 'project_snapshot':
      return parseProjectSnapshotCommand(envelope, value)
  }
}

/** Create a command or throw TeachingEventParseError (runtime, not TS-only). */
export function createTeachingTurnCommand(value: unknown): TeachingTurnCommand {
  const result = parseTeachingTurnCommand(value)
  if (!result.ok) {
    throw new TeachingEventParseError(result.code, result.message, result.field)
  }
  return result.value
}

export function teachingTurnCommandTypes(): readonly TeachingTurnCommandType[] {
  return [...TEACHING_TURN_COMMAND_TYPES]
}

function parseOpenSessionCommand(
  envelope: TeachingTurnCommandEnvelope,
  value: Record<string, unknown>
): TeachingTurnCommandParseResult {
  if (!isPlainObject(value.open)) {
    return failCommand('invalid_payload', 'open_session.open must be a plain object.', 'open')
  }
  const openWorkspaceId = requireId(value.open.workspaceId, 'open.workspaceId')
  if (!openWorkspaceId.ok) return toCommandFailure(openWorkspaceId)
  if (openWorkspaceId.value !== envelope.workspaceId) {
    return failCommand(
      'invalid_payload',
      'open.workspaceId must match command.workspaceId.',
      'open.workspaceId'
    )
  }

  let sessionId: string | undefined
  if (value.open.sessionId !== undefined && value.open.sessionId !== null && value.open.sessionId !== '') {
    const parsed = requireId(value.open.sessionId, 'open.sessionId')
    if (!parsed.ok) return toCommandFailure(parsed)
    sessionId = parsed.value
  }

  if (!isPlainObject(value.open.courseRef)) {
    return failCommand('invalid_payload', 'open.courseRef must be a plain object.', 'open.courseRef')
  }
  const courseId = requireId(value.open.courseRef.courseId, 'open.courseRef.courseId')
  if (!courseId.ok) return toCommandFailure(courseId)
  if (typeof value.open.courseRef.courseName !== 'string' || !value.open.courseRef.courseName.trim()) {
    return failCommand('invalid_payload', 'open.courseRef.courseName is invalid.', 'open.courseRef.courseName')
  }
  if (typeof value.open.courseRef.relativePath !== 'string' || !value.open.courseRef.relativePath.trim()) {
    return failCommand('invalid_payload', 'open.courseRef.relativePath is invalid.', 'open.courseRef.relativePath')
  }

  const open: OpenLearningSessionInput = {
    workspaceId: openWorkspaceId.value,
    courseRef: {
      courseId: courseId.value,
      courseName: value.open.courseRef.courseName,
      relativePath: value.open.courseRef.relativePath
    }
  }
  if (sessionId !== undefined) open.sessionId = sessionId

  if (value.open.lessonRef !== undefined && value.open.lessonRef !== null) {
    if (!isPlainObject(value.open.lessonRef)) {
      return failCommand('invalid_payload', 'open.lessonRef must be a plain object.', 'open.lessonRef')
    }
    const lessonId = requireId(value.open.lessonRef.lessonId, 'open.lessonRef.lessonId')
    if (!lessonId.ok) return toCommandFailure(lessonId)
    if (typeof value.open.lessonRef.title !== 'string' || !value.open.lessonRef.title.trim()) {
      return failCommand('invalid_payload', 'open.lessonRef.title is invalid.', 'open.lessonRef.title')
    }
    if (typeof value.open.lessonRef.relativePath !== 'string' || !value.open.lessonRef.relativePath.trim()) {
      return failCommand('invalid_payload', 'open.lessonRef.relativePath is invalid.', 'open.lessonRef.relativePath')
    }
    open.lessonRef = {
      lessonId: lessonId.value,
      title: value.open.lessonRef.title,
      relativePath: value.open.lessonRef.relativePath
    }
  }

  if (value.open.conversationRefs !== undefined) {
    if (!Array.isArray(value.open.conversationRefs)) {
      return failCommand('invalid_payload', 'open.conversationRefs must be an array.', 'open.conversationRefs')
    }
    const refs: NonNullable<OpenLearningSessionInput['conversationRefs']> = []
    for (let i = 0; i < value.open.conversationRefs.length; i += 1) {
      const ref = value.open.conversationRefs[i]
      if (!isPlainObject(ref)) {
        return failCommand('invalid_payload', 'open.conversationRefs entry must be an object.', `open.conversationRefs[${i}]`)
      }
      const conversationId = requireId(ref.conversationId, `open.conversationRefs[${i}].conversationId`)
      if (!conversationId.ok) return toCommandFailure(conversationId)
      if (typeof ref.relativePath !== 'string' || !ref.relativePath.trim()) {
        return failCommand(
          'invalid_payload',
          'open.conversationRefs relativePath is invalid.',
          `open.conversationRefs[${i}].relativePath`
        )
      }
      refs.push({ conversationId: conversationId.value, relativePath: ref.relativePath })
    }
    open.conversationRefs = refs
  }

  return { ok: true, value: { type: 'open_session', ...envelope, open } }
}

function parseSessionScopedCommand(
  envelope: TeachingTurnCommandEnvelope,
  value: Record<string, unknown>,
  type: 'resume_session' | 'recover_session'
): TeachingTurnCommandParseResult {
  const sessionId = requireId(value.sessionId, 'sessionId')
  if (!sessionId.ok) return toCommandFailure(sessionId)
  return { ok: true, value: { type, ...envelope, sessionId: sessionId.value } }
}

function parseCancelCommand(
  envelope: TeachingTurnCommandEnvelope,
  value: Record<string, unknown>
): TeachingTurnCommandParseResult {
  const sessionId = requireId(value.sessionId, 'sessionId')
  if (!sessionId.ok) return toCommandFailure(sessionId)
  let reasonCode: TeachingTurnTerminalReasonCode | undefined
  if (value.reasonCode !== undefined) {
    if (!isTeachingTurnTerminalReasonCode(value.reasonCode)) {
      return failCommand(
        'invalid_terminal_reason',
        'cancel_turn reasonCode is not in the closed reason set.',
        'reasonCode'
      )
    }
    reasonCode = value.reasonCode
  }
  return {
    ok: true,
    value: {
      type: 'cancel_turn',
      ...envelope,
      sessionId: sessionId.value,
      ...(reasonCode !== undefined ? { reasonCode } : {})
    }
  }
}

function parseRecordEvidenceCommand(
  envelope: TeachingTurnCommandEnvelope,
  value: Record<string, unknown>
): TeachingTurnCommandParseResult {
  let evidence: LessonInteraction
  try {
    evidence = normalizeLessonInteraction(value.evidence)
  } catch {
    return failCommand('invalid_payload', 'record_evidence.evidence failed runtime validation.', 'evidence')
  }
  if (evidence.workspaceId !== envelope.workspaceId) {
    return failCommand(
      'invalid_payload',
      'evidence.workspaceId must match command.workspaceId.',
      'evidence.workspaceId'
    )
  }
  if (!evidence.sessionId || !ID_PATTERN.test(evidence.sessionId)) {
    return failCommand('invalid_id', 'evidence.sessionId is invalid.', 'evidence.sessionId')
  }
  return { ok: true, value: { type: 'record_evidence', ...envelope, evidence } }
}

function parseCommitOutcomeCommand(
  envelope: TeachingTurnCommandEnvelope,
  value: Record<string, unknown>
): TeachingTurnCommandParseResult {
  if (!isPlainObject(value.request)) {
    return failCommand('invalid_payload', 'commit_outcome.request must be a plain object.', 'request')
  }
  const sessionId = requireId(value.request.sessionId, 'request.sessionId')
  if (!sessionId.ok) return toCommandFailure(sessionId)
  const requestOperationId = requireId(value.request.operationId, 'request.operationId')
  if (!requestOperationId.ok) return toCommandFailure(requestOperationId)
  if (requestOperationId.value !== envelope.operationId) {
    return failCommand(
      'invalid_payload',
      'request.operationId must match command.operationId.',
      'request.operationId'
    )
  }
  const request: LearningOutcomeCommitRequest = {
    sessionId: sessionId.value,
    operationId: requestOperationId.value
  }
  return { ok: true, value: { type: 'commit_outcome', ...envelope, request } }
}

function parsePlanNextStepCommand(
  envelope: TeachingTurnCommandEnvelope,
  value: Record<string, unknown>
): TeachingTurnCommandParseResult {
  const sessionId = requireId(value.sessionId, 'sessionId')
  if (!sessionId.ok) return toCommandFailure(sessionId)
  const factsResult = parseNextTeachingStepFacts(value.facts)
  if (!factsResult.ok) return factsResult
  if (factsResult.value.latestSession.id !== sessionId.value) {
    return failCommand(
      'invalid_payload',
      'facts.latestSession.id must match command.sessionId.',
      'facts.latestSession.id'
    )
  }
  return {
    ok: true,
    value: {
      type: 'plan_next_step',
      ...envelope,
      sessionId: sessionId.value,
      facts: factsResult.value
    }
  }
}

function parseProjectSnapshotCommand(
  envelope: TeachingTurnCommandEnvelope,
  value: Record<string, unknown>
): TeachingTurnCommandParseResult {
  if (!isPlainObject(value.factInput)) {
    return failCommand('invalid_payload', 'project_snapshot.factInput must be a plain object.', 'factInput')
  }
  // Explicit real sessionId required — never fall back to course.id.
  const sessionId = requireId(value.factInput.sessionId, 'factInput.sessionId')
  if (!sessionId.ok) return toCommandFailure(sessionId)

  if (!isPlainObject(value.factInput.mission)) {
    return failCommand('invalid_payload', 'factInput.mission must be a plain object.', 'factInput.mission')
  }
  const missionId = requireId(value.factInput.mission.id, 'factInput.mission.id')
  if (!missionId.ok) return toCommandFailure(missionId)
  const nextGoal = value.factInput.mission.nextGoal
  if (nextGoal !== 'available' && nextGoal !== 'absent' && nextGoal !== 'unknown') {
    return failCommand('invalid_payload', 'factInput.mission.nextGoal is invalid.', 'factInput.mission.nextGoal')
  }

  if (!isPlainObject(value.factInput.course)) {
    return failCommand('invalid_payload', 'factInput.course must be a plain object.', 'factInput.course')
  }
  const courseId = requireId(value.factInput.course.id, 'factInput.course.id')
  if (!courseId.ok) return toCommandFailure(courseId)

  if (!isPlainObject(value.factInput.resources)) {
    return failCommand('invalid_payload', 'factInput.resources must be a plain object.', 'factInput.resources')
  }
  const readiness = value.factInput.resources.readiness
  if (readiness !== 'ready' && readiness !== 'not_ready' && readiness !== 'unknown') {
    return failCommand('invalid_payload', 'factInput.resources.readiness is invalid.', 'factInput.resources.readiness')
  }
  if (
    typeof value.factInput.resources.availableCount !== 'number' ||
    !Number.isInteger(value.factInput.resources.availableCount) ||
    value.factInput.resources.availableCount < 0
  ) {
    return failCommand(
      'invalid_payload',
      'factInput.resources.availableCount is invalid.',
      'factInput.resources.availableCount'
    )
  }
  if (!Array.isArray(value.factInput.resources.provenanceIds)) {
    return failCommand(
      'invalid_payload',
      'factInput.resources.provenanceIds must be an array.',
      'factInput.resources.provenanceIds'
    )
  }
  const provenanceIds: string[] = []
  for (let i = 0; i < value.factInput.resources.provenanceIds.length; i += 1) {
    const id = requireId(value.factInput.resources.provenanceIds[i], `factInput.resources.provenanceIds[${i}]`)
    if (!id.ok) return toCommandFailure(id)
    provenanceIds.push(id.value)
  }

  let readyResources: TrustedTeachingResourceDescriptor[] | undefined
  if (value.readyResources !== undefined) {
    if (!Array.isArray(value.readyResources)) {
      return failCommand('invalid_payload', 'readyResources must be an array.', 'readyResources')
    }
    readyResources = []
    for (let i = 0; i < value.readyResources.length; i += 1) {
      const item = value.readyResources[i]
      if (!isPlainObject(item)) {
        return failCommand('invalid_payload', 'readyResources entry must be an object.', `readyResources[${i}]`)
      }
      const sourceId = requireId(item.sourceId, `readyResources[${i}].sourceId`)
      if (!sourceId.ok) return toCommandFailure(sourceId)
      // Structural identity only — grounder validates full descriptor at use time.
      readyResources.push(item as unknown as TrustedTeachingResourceDescriptor)
    }
  }

  const command: TeachingTurnProjectSnapshotCommand = {
    type: 'project_snapshot',
    ...envelope,
    factInput: {
      mission: { id: missionId.value, nextGoal },
      course: { id: courseId.value },
      resources: {
        readiness,
        availableCount: value.factInput.resources.availableCount,
        provenanceIds
      },
      sessionId: sessionId.value
    }
  }
  if (readyResources !== undefined) command.readyResources = readyResources
  return { ok: true, value: command }
}

function parseNextTeachingStepFacts(
  value: unknown
): { ok: true; value: NextTeachingStepFacts } | TeachingTurnCommandParseFailure {
  if (!isPlainObject(value)) {
    return failCommand('invalid_payload', 'plan_next_step.facts must be a plain object.', 'facts')
  }
  if (!isPlainObject(value.mission)) {
    return failCommand('invalid_payload', 'facts.mission must be a plain object.', 'facts.mission')
  }
  const missionId = requireId(value.mission.id, 'facts.mission.id')
  if (!missionId.ok) return toCommandFailure(missionId)
  const nextGoal = value.mission.nextGoal
  if (nextGoal !== 'available' && nextGoal !== 'absent' && nextGoal !== 'unknown') {
    return failCommand('invalid_payload', 'facts.mission.nextGoal is invalid.', 'facts.mission.nextGoal')
  }
  if (!isPlainObject(value.course)) {
    return failCommand('invalid_payload', 'facts.course must be a plain object.', 'facts.course')
  }
  const courseId = requireId(value.course.id, 'facts.course.id')
  if (!courseId.ok) return toCommandFailure(courseId)
  if (!isPlainObject(value.latestSession)) {
    return failCommand('invalid_payload', 'facts.latestSession must be a plain object.', 'facts.latestSession')
  }
  const latestSessionId = requireId(value.latestSession.id, 'facts.latestSession.id')
  if (!latestSessionId.ok) return toCommandFailure(latestSessionId)
  if (value.latestSession.source !== 'canonical' && value.latestSession.source !== 'legacy_lesson') {
    return failCommand('invalid_payload', 'facts.latestSession.source is invalid.', 'facts.latestSession.source')
  }
  if (typeof value.latestSession.readOnly !== 'boolean') {
    return failCommand('invalid_payload', 'facts.latestSession.readOnly must be boolean.', 'facts.latestSession.readOnly')
  }
  if (!isPlainObject(value.durableOutcome)) {
    return failCommand('invalid_payload', 'facts.durableOutcome must be a plain object.', 'facts.durableOutcome')
  }
  const outcomeStatus = value.durableOutcome.status
  let durableOutcome: NextTeachingStepFacts['durableOutcome']
  if (outcomeStatus === 'trusted') {
    const id = requireId(value.durableOutcome.id, 'facts.durableOutcome.id')
    if (!id.ok) return toCommandFailure(id)
    if (typeof value.durableOutcome.kind !== 'string' || !value.durableOutcome.kind.trim()) {
      return failCommand('invalid_payload', 'facts.durableOutcome.kind is invalid.', 'facts.durableOutcome.kind')
    }
    if (!Array.isArray(value.durableOutcome.evidenceEventIds)) {
      return failCommand(
        'invalid_payload',
        'facts.durableOutcome.evidenceEventIds must be an array.',
        'facts.durableOutcome.evidenceEventIds'
      )
    }
    durableOutcome = {
      status: 'trusted',
      id: id.value,
      kind: value.durableOutcome.kind as LearningOutcomeKind,
      evidenceEventIds: value.durableOutcome.evidenceEventIds as readonly string[]
    }
  } else if (
    outcomeStatus === 'absent' ||
    outcomeStatus === 'review_required' ||
    outcomeStatus === 'unknown_schema'
  ) {
    durableOutcome = { status: outcomeStatus }
  } else {
    return failCommand('invalid_payload', 'facts.durableOutcome.status is invalid.', 'facts.durableOutcome.status')
  }

  if (!isPlainObject(value.evidence) || typeof value.evidence.status !== 'string') {
    return failCommand('invalid_payload', 'facts.evidence is invalid.', 'facts.evidence')
  }
  if (!isPlainObject(value.resources)) {
    return failCommand('invalid_payload', 'facts.resources must be a plain object.', 'facts.resources')
  }
  const readiness = value.resources.readiness
  if (readiness !== 'ready' && readiness !== 'not_ready' && readiness !== 'unknown') {
    return failCommand('invalid_payload', 'facts.resources.readiness is invalid.', 'facts.resources.readiness')
  }
  if (
    typeof value.resources.availableCount !== 'number' ||
    !Number.isInteger(value.resources.availableCount) ||
    value.resources.availableCount < 0
  ) {
    return failCommand('invalid_payload', 'facts.resources.availableCount is invalid.', 'facts.resources.availableCount')
  }
  if (!Array.isArray(value.resources.provenanceIds)) {
    return failCommand('invalid_payload', 'facts.resources.provenanceIds must be an array.', 'facts.resources.provenanceIds')
  }

  return {
    ok: true,
    value: {
      mission: { id: missionId.value, nextGoal },
      course: { id: courseId.value },
      latestSession: {
        id: latestSessionId.value,
        source: value.latestSession.source,
        readOnly: value.latestSession.readOnly
      },
      durableOutcome,
      evidence: { status: value.evidence.status as NextTeachingStepFacts['evidence']['status'] },
      resources: {
        readiness,
        availableCount: value.resources.availableCount,
        provenanceIds: value.resources.provenanceIds as readonly string[]
      }
    }
  }
}

function failCommand(
  code: TeachingEventParseErrorCode,
  message: string,
  field?: string
): TeachingTurnCommandParseFailure {
  return field === undefined ? { ok: false, code, message } : { ok: false, code, field, message }
}

function toCommandFailure(
  failure: TeachingEventParseFailure
): TeachingTurnCommandParseFailure {
  return failCommand(failure.code, failure.message, failure.field)
}

