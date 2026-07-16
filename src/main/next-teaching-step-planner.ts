import {
  NEXT_TEACHING_STEP_SCHEMA_VERSION,
  type NextTeachingStepAction,
  type NextTeachingStepDecision,
  type NextTeachingStepFacts,
  type NextTeachingStepReason,
  type NextTeachingStepSafeInputSummary
} from '../shared/teaching-types/next-teaching-step'

/**
 * Read-only, deterministic policy seam for choosing a learner's next teaching
 * step. It deliberately consumes pre-normalized facts and never performs I/O.
 */
export interface NextTeachingStepPlanner {
  plan(facts: NextTeachingStepFacts): NextTeachingStepDecision
}

export function createNextTeachingStepPlanner(): NextTeachingStepPlanner {
  return { plan: planNextTeachingStep }
}

export function planNextTeachingStep(facts: NextTeachingStepFacts): NextTeachingStepDecision {
  const safeInputSummary = summarizeFacts(facts)

  if (facts.latestSession.readOnly || facts.latestSession.source === 'legacy_lesson') {
    return decision('request_goal_clarification', 'legacy_read_only', safeInputSummary)
  }

  if (facts.resources.readiness !== 'ready') {
    return decision('wait_for_resources', 'resources_not_ready', safeInputSummary)
  }

  if (facts.durableOutcome.status === 'trusted' && facts.durableOutcome.kind === 'needs_practice' && facts.evidence.status === 'verified') {
    return decision('contrast_and_retry', 'needs_practice', safeInputSummary)
  }

  const evidenceReason = reasonForEvidence(facts.evidence.status)
  if (evidenceReason) return decision('request_goal_clarification', evidenceReason, safeInputSummary)

  if (facts.durableOutcome.status !== 'trusted') {
    return decision('request_goal_clarification', reasonForUnavailableOutcome(facts.durableOutcome.status), safeInputSummary)
  }

  const outcome = facts.durableOutcome
  if (outcome.kind === 'not_evidenced') {
    return decision('request_goal_clarification', 'insufficient_evidence', safeInputSummary)
  }

  if (facts.mission.nextGoal !== 'available') {
    return decision('request_goal_clarification', 'no_next_goal', safeInputSummary)
  }

  if (outcome.kind === 'misconception_corrected') {
    return decision('continue_next_session', 'misconception_corrected_with_next_goal', safeInputSummary)
  }

  if (outcome.kind === 'established') {
    return decision('continue_next_session', 'established_with_next_goal', safeInputSummary)
  }

  return decision('request_goal_clarification', 'insufficient_evidence', safeInputSummary)
}

function reasonForEvidence(status: NextTeachingStepFacts['evidence']['status']): NextTeachingStepReason | null {
  switch (status) {
    case 'verified':
      return null
    case 'review_required':
      return 'outcome_review_required'
    case 'unknown_schema':
      return 'outcome_unknown_schema'
    case 'not_evidenced':
    case 'unavailable':
      return 'insufficient_evidence'
  }
}

function reasonForUnavailableOutcome(
  status: Exclude<NextTeachingStepFacts['durableOutcome']['status'], 'trusted'>
): NextTeachingStepReason {
  switch (status) {
    case 'review_required':
      return 'outcome_review_required'
    case 'unknown_schema':
      return 'outcome_unknown_schema'
    case 'absent':
      return 'outcome_unavailable'
  }
}

function summarizeFacts(facts: NextTeachingStepFacts): NextTeachingStepSafeInputSummary {
  const outcome = facts.durableOutcome
  return {
    missionId: facts.mission.id,
    courseId: facts.course.id,
    latestSession: {
      id: facts.latestSession.id,
      source: facts.latestSession.source,
      readOnly: facts.latestSession.readOnly
    },
    durableOutcome: {
      status: outcome.status,
      id: outcome.status === 'trusted' ? outcome.id : null,
      kind: outcome.status === 'trusted' ? outcome.kind : null
    },
    evidence: { status: facts.evidence.status },
    resources: {
      readiness: facts.resources.readiness,
      availableCount: facts.resources.availableCount
    },
    provenance: {
      outcomeEvidenceEventIds: outcome.status === 'trusted' ? stableIds(outcome.evidenceEventIds) : [],
      resourceIds: stableIds(facts.resources.provenanceIds)
    }
  }
}

function stableIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort()
}

function decision(
  action: NextTeachingStepAction,
  reason: NextTeachingStepReason,
  safeInputSummary: NextTeachingStepSafeInputSummary
): NextTeachingStepDecision {
  return {
    schemaVersion: NEXT_TEACHING_STEP_SCHEMA_VERSION,
    action,
    reason,
    safeInputSummary
  }
}
