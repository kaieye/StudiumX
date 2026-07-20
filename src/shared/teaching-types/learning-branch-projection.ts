import type { LearningOutcomeKind, LearningSessionStatus } from './learning-session'
import type {
  NextGoalReadiness,
  NextTeachingStepAction,
  NextTeachingStepDurableOutcome,
  NextTeachingStepEvidenceStatus,
  NextTeachingStepReason,
  NextTeachingStepResourceReadiness
} from './next-teaching-step'

/**
 * Learning Branch Projection (P2-1).
 *
 * Read-only branch / alternative-path views derived from durable session +
 * planner facts. Never mutates canonical outcome, session, or ledger history.
 * Alternate paths are counterfactual projections only — not truth.
 */
export const LEARNING_BRANCH_PROJECTION_SCHEMA_VERSION = 1 as const

export type LearningBranchProjectionSchemaVersion = typeof LEARNING_BRANCH_PROJECTION_SCHEMA_VERSION

export type LearningBranchNodeKind =
  | 'primary'
  | 'retry'
  | 'clarification'
  | 'resource_wait'
  | 'historical'

/**
 * Optional sibling / history session summaries. Identity, status, and outcome
 * kind only — no learner content, assessment payloads, or absolute paths.
 */
export type LearningBranchHistorySessionSummary = {
  id: string
  status: LearningSessionStatus
  outcomeKind: LearningOutcomeKind | null
}

/**
 * Normalized, non-content-bearing inputs for the pure projector.
 * Adapters own filesystem reads, outcome verification, and resource inspection.
 */
export type LearningBranchProjectionFacts = {
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
  /** Optional sibling/history sessions (id/status/outcomeKind only). */
  historySessions?: readonly LearningBranchHistorySessionSummary[]
}

/**
 * Fixed reason codes used by branch nodes that are not direct planner reasons.
 */
export type LearningBranchNodeReason =
  | NextTeachingStepReason
  | 'session_anchor'
  | 'historical_session'
  | 'alternate_needs_practice'
  | 'alternate_not_evidenced'
  | 'alternate_resources_not_ready'

export type LearningBranchNode = {
  id: string
  kind: LearningBranchNodeKind
  /**
   * Planner action when this node is a next-step projection.
   * Null for session anchors and historical summaries that do not carry a plan.
   */
  action: NextTeachingStepAction | null
  reason: LearningBranchNodeReason
  parentNodeId: string | null
  sessionId: string | null
  /**
   * true only on the canonical primary path. Alternate / historical nodes are
   * always non-canonical projections and must never be treated as durable truth.
   */
  canonical: boolean
}

/**
 * Read-only branch projection. Same facts always yield the same fingerprint
 * (generatedAt is excluded from the digest when present).
 */
export type LearningBranchProjection = {
  schemaVersion: LearningBranchProjectionSchemaVersion
  nodes: readonly LearningBranchNode[]
  /** Ordered node ids of the canonical primary path. */
  primaryPath: readonly string[]
  /** Each entry is an ordered node-id sequence for a non-canonical alternate path. */
  alternatePaths: readonly (readonly string[])[]
  generatedAt?: string
  fingerprint: string
}
