import type {
  LearningOutcomeKind,
  LearningSessionDiagnostic,
  LearningSessionDiagnosticCode,
  LearningSessionSnapshot,
  LearningSessionSource,
  LearningSessionStatus
} from './learning-session'

export const SESSION_RESUME_PICKER_SCHEMA_VERSION = 1 as const

export type SessionResumePickerSchemaVersion = typeof SESSION_RESUME_PICKER_SCHEMA_VERSION

/**
 * Resume eligibility ladder for long-session picker candidates.
 * Higher ranks prefer ready/active sessions; demoted tiers are still visible
 * for diagnosis but never presented as writable resume targets.
 */
export type ResumeEligibility =
  | 'ready'
  | 'completed_read_only'
  | 'legacy_read_only'
  | 'quarantined'
  | 'corrupt'

/**
 * Privacy-safe resume candidate. Never carries raw event payloads, learner
 * answers, assessment bodies, or provider responses — only durable identity
 * and course/lesson title metadata from the ledger scan projection.
 */
export type ResumeCandidate = {
  sessionId: string
  workspaceId: string | null
  status: LearningSessionStatus
  source: LearningSessionSource
  courseId: string
  courseName: string
  lessonTitle: string | null
  eventCount: number
  updatedAt: string
  completedAt: string | null
  outcomeKind: LearningOutcomeKind | null
  resumeEligibility: ResumeEligibility
  reason: string
  rankScore: number
}

/**
 * Query over an already-scanned ledger projection.
 * `queryText` matches courseName / lessonTitle only — never learner content.
 */
export type ResumePickerQuery = {
  limit?: number
  courseId?: string
  statusFilter?: LearningSessionStatus | readonly LearningSessionStatus[]
  queryText?: string
}

/** Counts-only diagnostics — no paths, payloads, or free-form dumps. */
export type ResumePickerDiagnostics = {
  activeCount: number
  completedCount: number
  legacyCount: number
  quarantinedCount: number
  corruptCount: number
  readyCount: number
  completedReadOnlyCount: number
  matchedCount: number
  returnedCount: number
  filteredOutCount: number
}

export type ResumePickerReport = {
  schemaVersion: SessionResumePickerSchemaVersion
  candidates: ResumeCandidate[]
  totalScanned: number
  generatedAt: string
  diagnostics: ResumePickerDiagnostics
}

/** Re-export diagnostic codes used when classifying quarantine eligibility. */
export type ResumePickerCorruptDiagnosticCode = Extract<
  LearningSessionDiagnosticCode,
  | 'invalid_session_manifest'
  | 'invalid_session_event'
  | 'invalid_session_outcome'
  | 'unknown_session_schema'
  | 'event_sequence_conflict'
>

export type ResumePickerQuarantineInput = {
  sessionId: string
  diagnostic: LearningSessionDiagnostic
}

export type ResumePickerSessionInput = LearningSessionSnapshot
