export const LEARNING_SESSION_SCHEMA_VERSION = 1 as const

export type LearningSessionSchemaVersion = typeof LEARNING_SESSION_SCHEMA_VERSION
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
  | 'event_sequence_conflict'
  | 'unsafe_session_storage'

export type LearningSessionDiagnostic = {
  code: LearningSessionDiagnosticCode
  sessionId: string
  relativePath: string
  message: string
}
