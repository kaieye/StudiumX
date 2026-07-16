import { describe, expect, it } from 'vitest'
import { createNextTeachingStepPlanner, planNextTeachingStep } from '../../src/main/next-teaching-step-planner'
import type { NextTeachingStepFacts } from '../../src/shared/teaching-types/next-teaching-step'

function facts(): NextTeachingStepFacts {
  return {
    mission: { id: 'mission-foundations', nextGoal: 'available' },
    course: { id: 'course-foundations' },
    latestSession: { id: 'session-1', source: 'canonical', readOnly: false },
    durableOutcome: {
      status: 'trusted',
      id: 'outcome-1',
      kind: 'needs_practice',
      evidenceEventIds: ['event-1']
    },
    evidence: { status: 'verified' },
    resources: { readiness: 'ready', availableCount: 2, provenanceIds: ['resource-1'] }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

describe('NextTeachingStepPlanner', () => {
  it('recommends contrast_and_retry for a trusted needs_practice outcome', () => {
    const decision = createNextTeachingStepPlanner().plan(facts())

    expect(decision.action).toBe('contrast_and_retry')
    expect(decision.reason).toBe('needs_practice')
  })

  it('downgrades needs_practice to waiting when further resources are not ready', () => {
    const input = facts()
    input.resources.readiness = 'not_ready'

    expect(planNextTeachingStep(input)).toMatchObject({
      action: 'wait_for_resources',
      reason: 'resources_not_ready'
    })
  })

  it('continues after a corrected misconception only when a genuine next goal is available', () => {
    const input = facts()
    input.durableOutcome = {
      status: 'trusted',
      id: 'outcome-corrected',
      kind: 'misconception_corrected',
      evidenceEventIds: ['event-wrong', 'event-corrected']
    }

    expect(planNextTeachingStep(input)).toMatchObject({
      action: 'continue_next_session',
      reason: 'misconception_corrected_with_next_goal'
    })
  })

  it.each(['absent', 'unknown'] as const)(
    'requests goal clarification after a corrected misconception with next goal %s',
    (nextGoal) => {
      const input = facts()
      input.mission.nextGoal = nextGoal
      input.durableOutcome = {
        status: 'trusted',
        id: 'outcome-corrected',
        kind: 'misconception_corrected',
        evidenceEventIds: ['event-wrong', 'event-corrected']
      }

      expect(planNextTeachingStep(input)).toMatchObject({
        action: 'request_goal_clarification',
        reason: 'no_next_goal'
      })
    }
  )

  it('continues a trusted established outcome only as a next-session recommendation', () => {
    const input = facts()
    input.durableOutcome = {
      status: 'trusted',
      id: 'outcome-established',
      kind: 'established',
      evidenceEventIds: ['event-correct']
    }

    expect(planNextTeachingStep(input)).toMatchObject({
      action: 'continue_next_session',
      reason: 'established_with_next_goal'
    })
  })

  it.each([
    ['not_evidenced', 'insufficient_evidence'],
    ['review_required', 'outcome_review_required'],
    ['unknown_schema', 'outcome_unknown_schema'],
    ['unavailable', 'insufficient_evidence']
  ] as const)('does not continue when evidence is %s', (status, reason) => {
    const input = facts()
    input.durableOutcome = {
      status: 'trusted',
      id: 'outcome-corrected',
      kind: 'misconception_corrected',
      evidenceEventIds: ['event-corrected']
    }
    input.evidence.status = status

    expect(planNextTeachingStep(input)).toMatchObject({
      action: 'request_goal_clarification',
      reason
    })
  })

  it.each([
    ['absent', 'outcome_unavailable'],
    ['review_required', 'outcome_review_required'],
    ['unknown_schema', 'outcome_unknown_schema']
  ] as const)('does not continue when the durable outcome is %s', (status, reason) => {
    const input = facts()
    input.durableOutcome = { status }

    expect(planNextTeachingStep(input)).toMatchObject({
      action: 'request_goal_clarification',
      reason
    })
  })

  it('treats a trusted not_evidenced outcome as insufficient evidence', () => {
    const input = facts()
    input.durableOutcome = {
      status: 'trusted',
      id: 'outcome-not-evidenced',
      kind: 'not_evidenced',
      evidenceEventIds: []
    }

    expect(planNextTeachingStep(input)).toMatchObject({
      action: 'request_goal_clarification',
      reason: 'insufficient_evidence'
    })
  })

  it.each(['not_ready', 'unknown'] as const)('waits conservatively when resources are %s', (readiness) => {
    const input = facts()
    input.durableOutcome = {
      status: 'trusted',
      id: 'outcome-corrected',
      kind: 'misconception_corrected',
      evidenceEventIds: ['event-corrected']
    }
    input.resources.readiness = readiness

    expect(planNextTeachingStep(input)).toMatchObject({
      action: 'wait_for_resources',
      reason: 'resources_not_ready'
    })
  })

  it('keeps legacy/read-only sessions to a read-only-safe clarification recommendation', () => {
    const input = facts()
    input.latestSession = { id: 'legacy-session', source: 'legacy_lesson', readOnly: true }

    expect(planNextTeachingStep(input)).toMatchObject({
      action: 'request_goal_clarification',
      reason: 'legacy_read_only'
    })
  })

  it('returns exact stable JSON for repeated semantically identical facts', () => {
    const first = facts()
    first.durableOutcome = {
      status: 'trusted',
      id: 'outcome-corrected',
      kind: 'misconception_corrected',
      evidenceEventIds: ['event-z', 'event-a', 'event-z']
    }
    first.resources.provenanceIds = ['resource-z', 'resource-a', 'resource-z']

    const second = facts()
    second.durableOutcome = {
      status: 'trusted',
      id: 'outcome-corrected',
      kind: 'misconception_corrected',
      evidenceEventIds: ['event-a', 'event-z']
    }
    second.resources.provenanceIds = ['resource-a', 'resource-z']

    const firstJson = JSON.stringify(planNextTeachingStep(first))
    const secondJson = JSON.stringify(planNextTeachingStep(second))

    expect(firstJson).toBe(secondJson)
    expect(firstJson).toBe(JSON.stringify(planNextTeachingStep(first)))
  })

  it('allow-lists only safe identifiers, kinds, counts, and provenance in the decision', () => {
    const input = Object.assign(facts(), {
      learnerAnswer: 'private answer that must never escape',
      rawEvidenceText: 'private evidence that must never escape',
      assessmentPayload: { selectedOptionIds: ['secret-choice'] },
      providerResponse: { completion: 'private provider data' }
    }) as NextTeachingStepFacts

    const json = JSON.stringify(planNextTeachingStep(input))

    expect(json).not.toContain('learnerAnswer')
    expect(json).not.toContain('private answer that must never escape')
    expect(json).not.toContain('rawEvidenceText')
    expect(json).not.toContain('private evidence that must never escape')
    expect(json).not.toContain('assessmentPayload')
    expect(json).not.toContain('secret-choice')
    expect(json).not.toContain('providerResponse')
    expect(json).not.toContain('private provider data')
  })

  it('does not mutate deeply frozen facts', () => {
    const input = deepFreeze(facts())
    const before = structuredClone(input)

    expect(() => planNextTeachingStep(input)).not.toThrow()
    expect(input).toEqual(before)
    expect(Object.isFrozen(input.durableOutcome)).toBe(true)
    expect(Object.isFrozen(input.resources.provenanceIds)).toBe(true)
  })
})
