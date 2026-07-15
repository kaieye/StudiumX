export const LEARNING_SESSION_SCHEMA_VERSION = 1 as const
export const LEARNING_SESSION_OUTCOME_SCHEMA_VERSION = 1 as const

export type LearningSessionSchemaVersion = typeof LEARNING_SESSION_SCHEMA_VERSION
export type LearningSessionOutcomeSchemaVersion = typeof LEARNING_SESSION_OUTCOME_SCHEMA_VERSION
export type LearningSessionSource = 'canonical' | 'legacy_lesson'
export type LearningSessionStatus = 'active' | 'completed' | 'legacy_read_only'
export type LearningOutcomeKind =
  | 'established'
  | 'misconception_corrected'
  | 'needs_practice'
  | 'not_evidenced'

export type LearningSessionCourseRef = {
  courseId: string
  courseName: string
  relativePath: string
}

export type LearningSessionLessonRef = {
  lessonId: string
  title: string
  relativePath: string
}

export type LearningSessionConversationRef = {
  conversationId: string
  relativePath: string
}

export type LearningOutcomeRef = {
  outcomeId: string
  kind: LearningOutcomeKind
  relativePath: string
  evidenceEventIds: string[]
  /** SHA-256 of the exact committed outcome envelope bytes. */
  contentSha256: string
}

/**
 * Ledger-owned settlement envelope. P0-3 owns rubric/evaluation content, but
 * must commit this minimal identity/provenance record before completing a Session.
 */
export type CommittedLearningSessionOutcome = {
  schemaVersion: LearningSessionOutcomeSchemaVersion
  sessionId: string
  outcomeId: string
  kind: LearningOutcomeKind
  relativePath: string
  evidenceEventIds: string[]
}

/**
 * P0-1 owns the durable envelope. P0-2 may narrow payloads per kind, but must
 * preserve these stable identity, ordering, and provenance fields.
 */
export type LearningSessionEventKind =
  | 'lesson_opened'
  | 'lesson_completed'
  | 'retrieval_attempted'
  | 'quiz_attempted'
  | 'flashcard_reviewed'
  | 'learner_response_recorded'

export type LearningSessionEventPayload = Record<string, unknown>

export type AppendLearningSessionEventInput = {
  schemaVersion: LearningSessionSchemaVersion
  eventId: string
  sessionId: string
  kind: LearningSessionEventKind
  occurredAt: string
  turnId?: string
  payload: LearningSessionEventPayload
}

export type LearningSessionEvent = AppendLearningSessionEventInput & {
  sequence: number
  recordedAt: string
}

export type OpenLearningSessionInput = {
  sessionId?: string
  workspaceId: string
  courseRef: LearningSessionCourseRef
  lessonRef?: LearningSessionLessonRef | null
  /** Reopening an active canonical Session adds these refs without removing existing bindings. */
  conversationRefs?: LearningSessionConversationRef[]
}

export type CanonicalLearningSessionSnapshot = {
  schemaVersion: LearningSessionSchemaVersion
  id: string
  workspaceId: string
  source: 'canonical'
  readOnly: false
  status: 'active' | 'completed'
  version: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  courseRef: LearningSessionCourseRef
  lessonRef: LearningSessionLessonRef | null
  conversationRefs: LearningSessionConversationRef[]
  eventCount: number
  outcomeRef: LearningOutcomeRef | null
  events: LearningSessionEvent[]
}

export type LegacyLearningSessionSnapshot = {
  schemaVersion: LearningSessionSchemaVersion
  id: string
  workspaceId: string | null
  source: 'legacy_lesson'
  readOnly: true
  status: 'legacy_read_only'
  version: 0
  createdAt: string
  updatedAt: string
  completedAt: null
  courseRef: LearningSessionCourseRef
  lessonRef: LearningSessionLessonRef
  conversationRefs: []
  eventCount: 0
  outcomeRef: null
  events: []
}

export type LearningSessionSnapshot = CanonicalLearningSessionSnapshot | LegacyLearningSessionSnapshot

export type LearningSessionDiagnosticCode =
  | 'invalid_session_manifest'
  | 'invalid_session_event'
  | 'invalid_session_outcome'
  | 'unknown_session_schema'
  | 'event_sequence_conflict'
  | 'unsafe_session_storage'
  | 'canonical_legacy_conflict'
  | 'canonical_identity_conflict'
  | 'stale_session_stage'
  | 'unsafe_session_stage'
  | 'writer_recovery'

export type LearningSessionDiagnostic = {
  code: LearningSessionDiagnosticCode
  sessionId: string
  relativePath: string
  message: string
}


export type LearningSessionDurabilitySettlement = {
  fileSync: 'supported'
  directorySync: 'supported' | 'unsupported'
}

export type LearningSessionStageState = 'pending' | 'cleaned' | 'unsafe'

export type LearningSessionStageInfo = {
  relativePath: string
  kind: 'session' | 'event' | 'manifest'
  state: LearningSessionStageState
  modifiedAt: string
}

export type LearningSessionRecoveryInfo = {
  relativePath: string
  state: 'preserved'
  owner: {
    operation: 'open' | 'append' | 'complete' | 'load' | 'scan' | 'repair'
    sessionId: string | null
    pid: number
    hostname: string
    acquiredAt: string
  } | null
}

export type LearningSessionQuarantine = {
  sessionId: string
  diagnostic: LearningSessionDiagnostic
}

export type LearningSessionLegacyScanInput = {
  lesson: import('./workspace').LessonSummary
  workspaceId?: string | null
}

/** Explicit read-only legacy inputs keep catalog ownership outside the ledger. */
export type LearningSessionScanInput = {
  legacyLessons?: LearningSessionLegacyScanInput[]
}

/** Filesystem-owned discovery result; catalog integrations must not parse ledger files. */
export type LearningSessionScanResult = {
  sessions: LearningSessionSnapshot[]
  canonicalSessions: CanonicalLearningSessionSnapshot[]
  legacySessions: LegacyLearningSessionSnapshot[]
  diagnostics: LearningSessionDiagnostic[]
  quarantined: LearningSessionQuarantine[]
  stages: LearningSessionStageInfo[]
  recoveries: LearningSessionRecoveryInfo[]
  settlement: LearningSessionDurabilitySettlement
}
