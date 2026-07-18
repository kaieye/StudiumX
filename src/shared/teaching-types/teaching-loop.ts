import type { LearningOutcomeKind, LearningSessionSource, LearningSessionStatus } from './learning-session'
import type {
  NextTeachingStepAction,
  NextTeachingStepDurableOutcome,
  NextTeachingStepEvidenceStatus,
  NextTeachingStepReason,
  NextTeachingStepResourceReadiness
} from './next-teaching-step'

export const TEACHING_LOOP_SNAPSHOT_SCHEMA_VERSION = 1 as const

/**
 * Derived display projection only. Never persisted as a durable writer status.
 * Local filesystem session/outcome/mission facts remain the source of truth.
 */
export type TeachingLoopDisplayState =
  | 'completed'
  | 'needs_review'
  | 'blocked'
  | 'waiting_for_learner'
  | 'in_progress'

export type TeachingLoopIntegrityCode =
  | 'session_scan_diagnostics'
  | 'session_quarantined'
  | 'outcome_review_required'
  | 'outcome_unknown_schema'
  | 'outcome_digest_mismatch'
  | 'missing_completed_outcome'

/**
 * Normalized durable facts only. Callers/adapters own filesystem reads.
 * The pure resolver never performs I/O and never mutates these inputs.
 */
export type TeachingLoopFacts = {
  mission: {
    id: string
    nextGoal: 'available' | 'absent' | 'unknown'
  }
  course: {
    id: string
  }
  latestSession: {
    id: string
    source: LearningSessionSource
    readOnly: boolean
    status: LearningSessionStatus
    /** Durable event count; used only to distinguish empty vs interacted active sessions. */
    eventCount: number
  } | null
  durableOutcome: NextTeachingStepDurableOutcome
  evidence: {
    status: NextTeachingStepEvidenceStatus
  }
  resources: {
    readiness: NextTeachingStepResourceReadiness
    availableCount: number
    provenanceIds: readonly string[]
  }
  integrity: {
    codes: readonly TeachingLoopIntegrityCode[]
  }
}

export type TeachingLoopSafeProjection = {
  missionId: string
  courseId: string
  session: {
    id: string
    source: LearningSessionSource
    readOnly: boolean
    status: LearningSessionStatus
    eventCount: number
  } | null
  outcome: {
    status: NextTeachingStepDurableOutcome['status']
    id: string | null
    kind: LearningOutcomeKind | null
  }
  evidence: {
    status: NextTeachingStepEvidenceStatus
  }
  resources: {
    readiness: NextTeachingStepResourceReadiness
    availableCount: number
  }
  integrityCodes: TeachingLoopIntegrityCode[]
  provenance: {
    outcomeEvidenceEventIds: string[]
    resourceIds: string[]
  }
}

export type TeachingLoopNextStepProjection = {
  action: NextTeachingStepAction
  reason: NextTeachingStepReason
}

/**
 * Read-only teaching-loop snapshot. Same durable facts must yield the same
 * identity and display projection after restart.
 */
export type TeachingLoopSnapshot = {
  schemaVersion: typeof TEACHING_LOOP_SNAPSHOT_SCHEMA_VERSION
  /** Stable SHA-256 over the allow-listed safe projection + display/next-step fields. */
  identity: string
  displayState: TeachingLoopDisplayState
  nextStep: TeachingLoopNextStepProjection | null
  safeProjection: TeachingLoopSafeProjection
}
