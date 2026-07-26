import { createHash } from 'node:crypto'

import { planNextTeachingStep } from './next-teaching-step-planner'
import type { NextTeachingStepDecision, NextTeachingStepFacts } from '../shared/teaching-types/next-teaching-step'
import {
  TEACHING_LOOP_SNAPSHOT_SCHEMA_VERSION,
  type TeachingLoopDisplayState,
  type TeachingLoopFacts,
  type TeachingLoopIntegrityCode,
  type TeachingLoopNextStepProjection,
  type TeachingLoopSafeProjection,
  type TeachingLoopSnapshot
} from '../shared/teaching-types/teaching-loop'

/**
 * Pure, zero-write composition root for the teaching loop.
 *
 * Responsibilities:
 * - project normalized durable facts into a learner-safe display state
 * - invoke the existing NextTeachingStepPlanner when a session is present
 * - never perform filesystem I/O, never write status, never own scheduling
 *
 * Local session/outcome/mission files remain the sole source of truth.
 * Outcome commit remains the sole writer via LearningOutcomeCommitter.
 */
export interface TeachingLoopResolver {
  resolve(facts: TeachingLoopFacts): TeachingLoopSnapshot
}

export function createTeachingLoopResolver(): TeachingLoopResolver {
  return { resolve: resolveTeachingLoop }
}

export function resolveTeachingLoop(facts: TeachingLoopFacts): TeachingLoopSnapshot {
  const integrityCodes = stableIntegrityCodes(facts.integrity.codes)
  const safeProjection = projectSafe(facts, integrityCodes)
  const displayState = deriveDisplayState(facts, integrityCodes)
  const nextStep = deriveNextStep(facts, displayState)
  const identityBody = {
    schemaVersion: TEACHING_LOOP_SNAPSHOT_SCHEMA_VERSION,
    displayState,
    nextStep,
    safeProjection
  }

  return {
    schemaVersion: TEACHING_LOOP_SNAPSHOT_SCHEMA_VERSION,
    identity: sha256(JSON.stringify(identityBody)),
    displayState,
    nextStep,
    safeProjection
  }
}

/**
 * Decision table (derived only; never written back):
 *
 * needs_review         integrity codes present, or completed session without a
 *                      verified terminal established|misconception_corrected envelope
 * blocked              required resources not ready (and not already needs_review)
 * completed            completed session + verified established|misconception_corrected
 *                      (not_evidenced is NEVER completed)
 * waiting_for_learner  active session with no settleable verified evidence, or
 *                      needs_practice / not_evidenced settlement, or legacy/read-only
 * in_progress          active session with interaction that is not yet settled
 *
 * System interruption is intentionally not modeled here; run recovery remains a
 * separate agent-run concern and must not be projected as learner failure.
 */
export function deriveTeachingLoopDisplayState(facts: TeachingLoopFacts): TeachingLoopDisplayState {
  return deriveDisplayState(facts, stableIntegrityCodes(facts.integrity.codes))
}

function deriveDisplayState(
  facts: TeachingLoopFacts,
  integrityCodes: readonly TeachingLoopIntegrityCode[]
): TeachingLoopDisplayState {
  if (integrityCodes.length > 0) return 'needs_review'
  if (facts.resources.readiness !== 'ready') return 'blocked'

  const session = facts.latestSession
  if (!session) return 'waiting_for_learner'

  if (session.readOnly || session.source === 'legacy_lesson' || session.status === 'legacy_read_only') {
    return 'waiting_for_learner'
  }

  if (session.status === 'completed') {
    if (
      facts.durableOutcome.status === 'trusted' &&
      facts.evidence.status === 'verified' &&
      (facts.durableOutcome.kind === 'established' || facts.durableOutcome.kind === 'misconception_corrected')
    ) {
      return 'completed'
    }
    // not_evidenced / needs_practice / absent / unverified on a completed session
    // is an integrity problem, not a successful completion.
    return 'needs_review'
  }

  // active canonical session
  if (facts.durableOutcome.status === 'trusted') {
    if (facts.durableOutcome.kind === 'needs_practice' && facts.evidence.status === 'verified') {
      return 'waiting_for_learner'
    }
    if (facts.durableOutcome.kind === 'not_evidenced') {
      return 'waiting_for_learner'
    }
    if (
      facts.evidence.status === 'verified' &&
      (facts.durableOutcome.kind === 'established' || facts.durableOutcome.kind === 'misconception_corrected')
    ) {
      // Settled terminal outcomes should be committed + completed; if still active,
      // treat as in-flight rather than completed.
      return 'in_progress'
    }
  }

  if (session.eventCount > 0) return 'in_progress'
  return 'waiting_for_learner'
}

function deriveNextStep(
  facts: TeachingLoopFacts,
  displayState: TeachingLoopDisplayState
): TeachingLoopNextStepProjection | null {
  if (!facts.latestSession) return null
  // Integrity-first: do not invent a planner recommendation when review is required.
  if (displayState === 'needs_review') return null

  const decision = planNextTeachingStep(toPlannerFacts(facts))
  return { action: decision.action, reason: decision.reason }
}

function toPlannerFacts(facts: TeachingLoopFacts): NextTeachingStepFacts {
  const session = facts.latestSession
  if (!session) {
    throw new Error('Teaching loop planner facts require a latest session.')
  }
  return {
    mission: {
      id: facts.mission.id,
      nextGoal: facts.mission.nextGoal
    },
    course: {
      id: facts.course.id
    },
    latestSession: {
      id: session.id,
      source: session.source,
      readOnly: session.readOnly
    },
    durableOutcome: facts.durableOutcome,
    evidence: {
      status: facts.evidence.status
    },
    resources: {
      readiness: facts.resources.readiness,
      availableCount: facts.resources.availableCount,
      provenanceIds: facts.resources.provenanceIds
    },
    ...(facts.review ? { review: { dueCount: facts.review.dueCount } } : {})
  }
}

function projectSafe(
  facts: TeachingLoopFacts,
  integrityCodes: readonly TeachingLoopIntegrityCode[]
): TeachingLoopSafeProjection {
  const outcome = facts.durableOutcome
  return {
    missionId: facts.mission.id,
    courseId: facts.course.id,
    session: facts.latestSession
      ? {
          id: facts.latestSession.id,
          source: facts.latestSession.source,
          readOnly: facts.latestSession.readOnly,
          status: facts.latestSession.status,
          eventCount: facts.latestSession.eventCount
        }
      : null,
    outcome: {
      status: outcome.status,
      id: outcome.status === 'trusted' ? outcome.id : null,
      kind: outcome.status === 'trusted' ? outcome.kind : null
    },
    evidence: {
      status: facts.evidence.status
    },
    resources: {
      readiness: facts.resources.readiness,
      availableCount: facts.resources.availableCount
    },
    integrityCodes: [...integrityCodes],
    provenance: {
      outcomeEvidenceEventIds:
        outcome.status === 'trusted' ? stableIds(outcome.evidenceEventIds) : [],
      resourceIds: stableIds(facts.resources.provenanceIds)
    }
  }
}

function stableIntegrityCodes(codes: readonly TeachingLoopIntegrityCode[]): TeachingLoopIntegrityCode[] {
  return [...new Set(codes)].sort()
}

function stableIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort()
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Test/helper: expose planner decision when callers need the full object. */
export function planTeachingLoopNextStep(facts: TeachingLoopFacts): NextTeachingStepDecision | null {
  if (!facts.latestSession) return null
  const displayState = deriveDisplayState(facts, stableIntegrityCodes(facts.integrity.codes))
  if (displayState === 'needs_review') return null
  return planNextTeachingStep(toPlannerFacts(facts))
}
