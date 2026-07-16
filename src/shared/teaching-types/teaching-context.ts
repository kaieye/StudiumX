import type { LearningOutcomeKind, LearningSessionSource } from './learning-session'
import type { NextTeachingStepDecision } from './next-teaching-step'

export const TEACHING_CONTEXT_SCHEMA_VERSION = 1 as const

export type TeachingContextConsumer = 'lesson' | 'conversation'

/**
 * Only normalized, non-content-bearing teaching facts are allowed into the
 * assembler. File content is handled separately by the ResourceGrounder.
 */
export type NormalizedTeachingMission = {
  id: string
  goalStatus: 'available' | 'absent' | 'unknown'
}

export type NormalizedTeachingCourse = {
  id: string
}

export type NormalizedTeachingSession = {
  id: string
  source: LearningSessionSource
  readOnly: boolean
}

export type NormalizedTeachingOutcome =
  | {
      status: 'trusted'
      id: string
      kind: LearningOutcomeKind
    }
  | {
      status: 'absent' | 'review_required' | 'unknown_schema'
    }

export type TeachingContext = {
  schemaVersion: typeof TEACHING_CONTEXT_SCHEMA_VERSION
  /** Stable SHA-256 identity over this allow-listed context projection. */
  identity: string
  mission: NormalizedTeachingMission
  course: NormalizedTeachingCourse
  currentSession: NormalizedTeachingSession
  outcome: NormalizedTeachingOutcome
  nextStep: Pick<NextTeachingStepDecision, 'action' | 'reason'>
  grounding: {
    identity: string
    status: 'ready' | 'degraded' | 'unavailable'
    sourceIds: readonly string[]
    exclusionCount: number
  }
}
