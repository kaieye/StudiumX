/**
 * Event density policy (DB-P1-3).
 *
 * Closed classification of durable teaching JSONL / session events vs
 * operational debug streams. Canonical ledgers must never accept debug
 * kinds (especially token/stream dumps) that balloon volume like the
 * Marvis anti-pattern (≈3 sessions / 17k events).
 *
 * This module is the file-truth allowlist for:
 * - LearningSessionLedger event kinds (per-session evidence)
 * - learning-work.jsonl row types (compact conversation snapshots)
 * - TeachingEventEnvelope durability tiers (runtime bus; not a file ledger)
 *
 * Budgets below are enforcement targets for writers and unit guards.
 */

export type EventLedgerClass =
  | 'canonical_learning_session'
  | 'canonical_learning_work'
  | 'runtime_teaching_event'
  | 'operational_debug'

/** Closed LearningSessionLedger event kinds (ADR-0001). */
export const CANONICAL_LEARNING_SESSION_EVENT_KINDS = [
  'lesson_opened',
  'lesson_completed',
  'retrieval_attempted',
  'quiz_attempted',
  'flashcard_reviewed',
  'learner_response_recorded'
] as const

export type CanonicalLearningSessionEventKind =
  (typeof CANONICAL_LEARNING_SESSION_EVENT_KINDS)[number]

const CANONICAL_LEARNING_SESSION_EVENT_KIND_SET = new Set<string>(
  CANONICAL_LEARNING_SESSION_EVENT_KINDS
)

/**
 * learning-work.jsonl only stores compact conversation snapshots.
 * Token streams, tool arg dumps, and free-form process events are debug.
 */
export const CANONICAL_LEARNING_WORK_ENTRY_TYPES = [
  'conversation_snapshot'
] as const

export type CanonicalLearningWorkEntryType =
  (typeof CANONICAL_LEARNING_WORK_ENTRY_TYPES)[number]

const CANONICAL_LEARNING_WORK_ENTRY_TYPE_SET = new Set<string>(
  CANONICAL_LEARNING_WORK_ENTRY_TYPES
)

/**
 * Explicit debug / operational kinds that must never be written to
 * learning-work.jsonl or LearningSessionLedger as first-class rows.
 * Matching is case-insensitive on the kind / type string.
 */
export const DEBUG_EVENT_KINDS = [
  'token_stream',
  'token_delta',
  'token_chunk',
  'stream_delta',
  'agent_stream',
  'agent_delta',
  'model_raw',
  'raw_completion',
  'debug',
  'debug_event',
  'diagnostic',
  'trace_dump',
  'process_event',
  'tool_result_dump',
  'prompt_dump',
  'heartbeat',
  'metrics_tick'
] as const

export type DebugEventKind = (typeof DEBUG_EVENT_KINDS)[number]

const DEBUG_EVENT_KIND_SET = new Set(
  DEBUG_EVENT_KINDS.map((kind) => kind.toLowerCase())
)

/**
 * Payload / rate budgets for canonical durable writers.
 * Values mirror existing hard limits in ledger / durable-jsonl modules.
 */
export const EVENT_DENSITY_BUDGETS = {
  learningSession: {
    /** Max bytes for a single persisted session event file. */
    maxEventBytes: 1024 * 1024,
    /** Max UTF-8 bytes for the JSON-encoded payload object alone. */
    maxPayloadBytes: 512 * 1024,
    /** Max JSON nesting depth for event payload. */
    maxJsonDepth: 64,
    /**
     * Soft max durable evidence events per active session before operators
     * should investigate runaway writers (not a hard cut-off).
     */
    softMaxEventsPerSession: 500,
    /**
     * Recommended max append rate for a single session (events / minute).
     * Above this is treated as density anomaly for diagnostics.
     */
    softMaxAppendsPerMinute: 30
  },
  learningWork: {
    /** Only one compact snapshot type is allowed. */
    allowedEntryTypes: CANONICAL_LEARNING_WORK_ENTRY_TYPES,
    /** Max evidence array items per category inside a snapshot. */
    maxEvidenceItemsPerCategory: 40,
    /** Max characters for any single string field after redaction. */
    maxTextFieldChars: 500,
    /** Active JSONL segment rotation threshold (ADR-0012). */
    maxActiveSegmentBytes: 50 * 1024 * 1024,
    /**
     * Soft max snapshots per conversation per hour (idempotent entryId
     * still collapses exact duplicates).
     */
    softMaxSnapshotsPerConversationPerHour: 60,
    /** Never store full token streams or turn content. */
    forbidTokenStream: true,
    forbidTurnContent: true,
    forbidToolArguments: true
  },
  teachingEventBus: {
    /** Runtime bus only; ephemeral kinds must not be promoted to ledgers. */
    durablePayloadTypes: [
      'session_opened',
      'session_resumed',
      'evidence_recorded',
      'outcome_committed',
      'outcome_already_committed'
    ] as const,
    ephemeralPayloadTypes: [
      'loop_snapshot',
      'next_step',
      'turn_progress',
      'turn_terminal',
      'replay_gap',
      'legacy_adapted',
      'unknown_rejected',
      'command_accepted',
      'command_duplicate'
    ] as const,
    eitherPayloadTypes: [
      'outcome_insufficient_evidence',
      'recover_reconciled'
    ] as const,
    /** Max chars for legacy_adapted summary. */
    maxLegacySummaryChars: 160,
    maxLegacyKindChars: 64
  },
  operationalDebug: {
    /** Debug streams go to diagnostic logs only; mtime purge allowed. */
    storage: 'diagnostic_logs' as const,
    purgeable: true,
    /** Never write to learning-work or learning-session ledgers. */
    forbiddenLedgers: [
      'learning-work.jsonl',
      'learning-sessions/*/events'
    ] as const
  }
} as const

export type EventDensityBudgets = typeof EVENT_DENSITY_BUDGETS

export function isCanonicalLearningSessionEventKind(
  kind: unknown
): kind is CanonicalLearningSessionEventKind {
  return typeof kind === 'string' && CANONICAL_LEARNING_SESSION_EVENT_KIND_SET.has(kind)
}

export function isCanonicalLearningWorkEntryType(
  type: unknown
): type is CanonicalLearningWorkEntryType {
  return typeof type === 'string' && CANONICAL_LEARNING_WORK_ENTRY_TYPE_SET.has(type)
}

export function isDebugEventKind(kind: unknown): boolean {
  if (typeof kind !== 'string' || !kind.trim()) return false
  return DEBUG_EVENT_KIND_SET.has(kind.trim().toLowerCase())
}

export type LearningWorkCanonicalGuardFailure = {
  ok: false
  code:
    | 'not_object'
    | 'debug_kind_forbidden'
    | 'unsupported_entry_type'
    | 'missing_entry_id'
    | 'payload_budget_exceeded'
  message: string
}

export type LearningWorkCanonicalGuardSuccess = { ok: true }

export type LearningWorkCanonicalGuardResult =
  | LearningWorkCanonicalGuardSuccess
  | LearningWorkCanonicalGuardFailure

/**
 * Guard for rows about to be appended to `.studiumx/learning-work.jsonl`.
 * Rejects debug / stream kinds and any type other than conversation_snapshot.
 */
export function validateLearningWorkCanonicalEntry(
  value: unknown
): LearningWorkCanonicalGuardResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      code: 'not_object',
      message: 'Learning-work ledger entry must be a JSON object.'
    }
  }

  const record = value as Record<string, unknown>
  const type = record.type
  const kind = record.kind

  if (isDebugEventKind(type) || isDebugEventKind(kind)) {
    return {
      ok: false,
      code: 'debug_kind_forbidden',
      message:
        'Debug / stream event kinds must not be written to the learning-work canonical ledger.'
    }
  }

  if (!isCanonicalLearningWorkEntryType(type)) {
    return {
      ok: false,
      code: 'unsupported_entry_type',
      message:
        'Learning-work ledger only accepts type=\"conversation_snapshot\"; token streams and free-form debug rows are forbidden.'
    }
  }

  if (typeof record.entryId !== 'string' || !record.entryId.trim()) {
    return {
      ok: false,
      code: 'missing_entry_id',
      message: 'Learning-work ledger entry requires a non-empty entryId.'
    }
  }

  // Hard budget: serialized entry must stay well under segment size and
  // far below any full transcript dump.
  let encoded: string
  try {
    encoded = JSON.stringify(record)
  } catch {
    return {
      ok: false,
      code: 'payload_budget_exceeded',
      message: 'Learning-work ledger entry could not be serialized for budget check.'
    }
  }
  // 256 KiB hard cap for a single snapshot row (compact evidence only).
  const maxRowBytes = 256 * 1024
  if (Buffer.byteLength(encoded, 'utf8') > maxRowBytes) {
    return {
      ok: false,
      code: 'payload_budget_exceeded',
      message: `Learning-work ledger entry exceeds the ${maxRowBytes} byte payload budget.`
    }
  }

  // Explicit structural forbid: conversation content / tool args must not appear.
  if (hasForbiddenContentKeys(record)) {
    return {
      ok: false,
      code: 'payload_budget_exceeded',
      message:
        'Learning-work ledger entry must not embed turn content, token streams, or tool arguments.'
    }
  }

  return { ok: true }
}

export function assertLearningWorkCanonicalEntry(value: unknown): void {
  const result = validateLearningWorkCanonicalEntry(value)
  if (!result.ok) {
    throw new Error(result.message)
  }
}

export function assertNotDebugEventForCanonicalLedger(
  kind: unknown,
  ledger: 'learning-work' | 'learning-session' = 'learning-work'
): void {
  if (isDebugEventKind(kind)) {
    throw new Error(
      `Debug event kind "${String(kind)}" must not be written to the ${ledger} canonical ledger.`
    )
  }
}

const FORBIDDEN_CONTENT_KEYS = new Set([
  'content',
  'turns',
  'messages',
  'tokenStream',
  'token_stream',
  'delta',
  'deltas',
  'rawPrompt',
  'prompt',
  'completion',
  'toolArguments',
  'tool_arguments',
  'arguments'
])

function hasForbiddenContentKeys(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenContentKeys(item, depth + 1))
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CONTENT_KEYS.has(key)) {
      // Pointer-style fields under conversation.* are allowed (title/paths),
      // but top-level or nested full content dumps are not.
      if (key === 'content' || key === 'turns' || key === 'messages') return true
      if (
        key === 'tokenStream' ||
        key === 'token_stream' ||
        key === 'rawPrompt' ||
        key === 'prompt' ||
        key === 'completion' ||
        key === 'toolArguments' ||
        key === 'tool_arguments' ||
        key === 'arguments' ||
        key === 'delta' ||
        key === 'deltas'
      ) {
        return true
      }
    }
    if (hasForbiddenContentKeys(item, depth + 1)) return true
  }
  return false
}

export function classifyEventKind(kind: unknown): EventLedgerClass | 'unknown' {
  if (isDebugEventKind(kind)) return 'operational_debug'
  if (isCanonicalLearningSessionEventKind(kind)) return 'canonical_learning_session'
  if (isCanonicalLearningWorkEntryType(kind)) return 'canonical_learning_work'
  return 'unknown'
}
