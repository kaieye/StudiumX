import type { LearningOutcomeKind } from './learning-session'

export const NEXT_TEACHING_STEP_SCHEMA_VERSION = 1 as const

export type NextGoalReadiness = 'available' | 'absent' | 'unknown'
export type NextTeachingStepResourceReadiness = 'ready' | 'not_ready' | 'unknown'
export type NextTeachingStepEvidenceStatus =
  | 'verified'
  | 'not_evidenced'
  | 'review_required'
  | 'unknown_schema'
  | 'unavailable'

/** Normalized durable outcome facts only; no assessment payloads or learner content. */
export type NextTeachingStepDurableOutcome =
  | {
      status: 'trusted'
      id: string
      kind: LearningOutcomeKind
      evidenceEventIds: readonly string[]
    }
  | {
      status: 'absent' | 'review_required' | 'unknown_schema'
    }

/**
 * The planner accepts only normalized, non-content-bearing facts. Adapters own
 * any filesystem reads, outcome verification, and resource inspection.
 */
export type NextTeachingStepFacts = {
  mission: {
    id: string
    nextGoal: NextGoalReadiness
  }
  course: {
    id: string
  }
  latestSession: {
    id: string
    source: 'canonical' | 'legacy_lesson'
    readOnly: boolean
  }
  durableOutcome: NextTeachingStepDurableOutcome
  evidence: {
    status: NextTeachingStepEvidenceStatus
  }
  resources: {
    readiness: NextTeachingStepResourceReadiness
    availableCount: number
    provenanceIds: readonly string[]
  }
  /**
   * Optional spaced-review facts (ADR-0154). Count only — never item payloads.
   * When omitted, planner behavior is byte-identical to the pre-review contract,
   * so existing callers see no change until an adapter supplies the fact.
   */
  review?: {
    dueCount: number
  }
}

export type NextTeachingStepAction =
  | 'contrast_and_retry'
  | 'continue_next_session'
  | 'review_due'
  | 'request_goal_clarification'
  | 'wait_for_resources'

export type NextTeachingStepReason =
  | 'needs_practice'
  | 'misconception_corrected_with_next_goal'
  | 'established_with_next_goal'
  | 'spaced_review_due'
  | 'legacy_read_only'
  | 'no_next_goal'
  | 'insufficient_evidence'
  | 'outcome_review_required'
  | 'outcome_unknown_schema'
  | 'outcome_unavailable'
  | 'resources_not_ready'

/** An allow-listed projection of inputs that callers may persist or display. */
export type NextTeachingStepSafeInputSummary = {
  missionId: string
  courseId: string
  latestSession: {
    id: string
    source: 'canonical' | 'legacy_lesson'
    readOnly: boolean
  }
  durableOutcome: {
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
  /** Present only when review facts were supplied (ADR-0154); count only. */
  review?: {
    dueCount: number
  }
  provenance: {
    outcomeEvidenceEventIds: string[]
    resourceIds: string[]
  }
}

export type NextTeachingStepDecision = {
  schemaVersion: typeof NEXT_TEACHING_STEP_SCHEMA_VERSION
  action: NextTeachingStepAction
  reason: NextTeachingStepReason
  safeInputSummary: NextTeachingStepSafeInputSummary
}
