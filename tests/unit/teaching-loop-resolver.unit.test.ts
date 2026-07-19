import { describe, expect, it } from 'vitest'
import {
  createTeachingLoopResolver,
  deriveTeachingLoopDisplayState,
  planTeachingLoopNextStep,
  resolveTeachingLoop
} from '../../src/main/teaching-loop-resolver'
import type { TeachingLoopFacts } from '../../src/shared/teaching-types/teaching-loop'

function facts(overrides: Partial<TeachingLoopFacts> = {}): TeachingLoopFacts {
  return {
    mission: { id: 'mission-foundations', nextGoal: 'available' },
    course: { id: 'course-foundations' },
    latestSession: {
      id: 'session-1',
      source: 'canonical',
      readOnly: false,
      status: 'active',
      eventCount: 0
    },
    durableOutcome: { status: 'absent' },
    evidence: { status: 'unavailable' },
    resources: {
      readiness: 'ready',
      availableCount: 2,
      provenanceIds: ['resource-b', 'resource-a']
    },
    integrity: { codes: [] },
    ...overrides
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}

describe('TeachingLoopResolver', () => {
  it('marks completed only for verified established/misconception_corrected on completed sessions', () => {
    for (const kind of ['established', 'misconception_corrected'] as const) {
      const snapshot = resolveTeachingLoop(
        facts({
          latestSession: {
            id: 'session-1',
            source: 'canonical',
            readOnly: false,
            status: 'completed',
            eventCount: 2
          },
          durableOutcome: {
            status: 'trusted',
            id: `outcome-${kind}`,
            kind,
            evidenceEventIds: ['event-2', 'event-1']
          },
          evidence: { status: 'verified' }
        })
      )

      expect(snapshot.displayState).toBe('completed')
      expect(snapshot.nextStep).toMatchObject({
        action: 'continue_next_session'
      })
      expect(snapshot.safeProjection.outcome.kind).toBe(kind)
      expect(snapshot.safeProjection.provenance.outcomeEvidenceEventIds).toEqual(['event-1', 'event-2'])
    }
  })

  it('never treats trusted not_evidenced as completed', () => {
    const snapshot = resolveTeachingLoop(
      facts({
        latestSession: {
          id: 'session-1',
          source: 'canonical',
          readOnly: false,
          status: 'completed',
          eventCount: 1
        },
        durableOutcome: {
          status: 'trusted',
          id: 'outcome-not-evidenced',
          kind: 'not_evidenced',
          evidenceEventIds: ['event-1']
        },
        evidence: { status: 'verified' }
      })
    )

    expect(snapshot.displayState).toBe('needs_review')
    expect(snapshot.nextStep).toBeNull()
  })

  it('projects needs_review for integrity diagnostics and does not invent a next step', () => {
    const snapshot = createTeachingLoopResolver().resolve(
      facts({
        integrity: { codes: ['session_quarantined', 'session_scan_diagnostics'] }
      })
    )

    expect(snapshot.displayState).toBe('needs_review')
    expect(snapshot.nextStep).toBeNull()
    expect(snapshot.safeProjection.integrityCodes).toEqual([
      'session_quarantined',
      'session_scan_diagnostics'
    ])
  })

  it('projects blocked when resources are not ready before learner waiting states', () => {
    expect(
      deriveTeachingLoopDisplayState(
        facts({
          resources: { readiness: 'not_ready', availableCount: 0, provenanceIds: [] }
        })
      )
    ).toBe('blocked')

    const snapshot = resolveTeachingLoop(
      facts({
        latestSession: {
          id: 'session-1',
          source: 'canonical',
          readOnly: false,
          status: 'active',
          eventCount: 3
        },
        durableOutcome: {
          status: 'trusted',
          id: 'outcome-practice',
          kind: 'needs_practice',
          evidenceEventIds: ['event-1']
        },
        evidence: { status: 'verified' },
        resources: { readiness: 'unknown', availableCount: 0, provenanceIds: [] }
      })
    )

    expect(snapshot.displayState).toBe('blocked')
    expect(snapshot.nextStep).toMatchObject({
      action: 'wait_for_resources',
      reason: 'resources_not_ready'
    })
  })

  it('projects waiting_for_learner for active sessions without settleable evidence', () => {
    expect(deriveTeachingLoopDisplayState(facts())).toBe('waiting_for_learner')

    const needsPractice = resolveTeachingLoop(
      facts({
        latestSession: {
          id: 'session-1',
          source: 'canonical',
          readOnly: false,
          status: 'active',
          eventCount: 2
        },
        durableOutcome: {
          status: 'trusted',
          id: 'outcome-practice',
          kind: 'needs_practice',
          evidenceEventIds: ['event-1']
        },
        evidence: { status: 'verified' }
      })
    )
    expect(needsPractice.displayState).toBe('waiting_for_learner')
    expect(needsPractice.nextStep).toMatchObject({
      action: 'contrast_and_retry',
      reason: 'needs_practice'
    })
  })

  it('projects in_progress for active sessions with interaction that is not yet settled', () => {
    const snapshot = resolveTeachingLoop(
      facts({
        latestSession: {
          id: 'session-1',
          source: 'canonical',
          readOnly: false,
          status: 'active',
          eventCount: 2
        },
        durableOutcome: { status: 'absent' },
        evidence: { status: 'unavailable' }
      })
    )

    expect(snapshot.displayState).toBe('in_progress')
    expect(snapshot.nextStep).toMatchObject({
      action: 'request_goal_clarification',
      reason: 'insufficient_evidence'
    })
  })

  it('keeps legacy/read-only sessions on a clarification-safe waiting path', () => {
    const snapshot = resolveTeachingLoop(
      facts({
        latestSession: {
          id: 'legacy-1',
          source: 'legacy_lesson',
          readOnly: true,
          status: 'legacy_read_only',
          eventCount: 0
        }
      })
    )

    expect(snapshot.displayState).toBe('waiting_for_learner')
    expect(snapshot.nextStep).toMatchObject({
      action: 'request_goal_clarification',
      reason: 'legacy_read_only'
    })
  })

  it('returns null next step when no session exists and waits for learner', () => {
    const snapshot = resolveTeachingLoop(
      facts({
        latestSession: null
      })
    )

    expect(snapshot.displayState).toBe('waiting_for_learner')
    expect(snapshot.nextStep).toBeNull()
    expect(planTeachingLoopNextStep(facts({ latestSession: null }))).toBeNull()
  })

  it('prefer needs_review over blocked when integrity codes are present', () => {
    expect(
      deriveTeachingLoopDisplayState(
        facts({
          integrity: { codes: ['outcome_review_required'] },
          resources: { readiness: 'not_ready', availableCount: 0, provenanceIds: [] }
        })
      )
    ).toBe('needs_review')
  })

  it('marks completed sessions without verified terminal outcomes as needs_review', () => {
    expect(
      deriveTeachingLoopDisplayState(
        facts({
          latestSession: {
            id: 'session-1',
            source: 'canonical',
            readOnly: false,
            status: 'completed',
            eventCount: 1
          },
          durableOutcome: { status: 'absent' },
          evidence: { status: 'unavailable' }
        })
      )
    ).toBe('needs_review')

    expect(
      deriveTeachingLoopDisplayState(
        facts({
          latestSession: {
            id: 'session-1',
            source: 'canonical',
            readOnly: false,
            status: 'completed',
            eventCount: 1
          },
          durableOutcome: {
            status: 'trusted',
            id: 'outcome-practice',
            kind: 'needs_practice',
            evidenceEventIds: ['event-1']
          },
          evidence: { status: 'verified' }
        })
      )
    ).toBe('needs_review')
  })

  it('returns exact stable JSON for repeated semantically identical facts', () => {
    const first = resolveTeachingLoop(
      facts({
        resources: {
          readiness: 'ready',
          availableCount: 2,
          provenanceIds: ['resource-b', 'resource-a', 'resource-a']
        },
        integrity: { codes: ['session_scan_diagnostics', 'session_scan_diagnostics'] }
      })
    )
    const second = resolveTeachingLoop(
      facts({
        resources: {
          readiness: 'ready',
          availableCount: 2,
          provenanceIds: ['resource-a', 'resource-b']
        },
        integrity: { codes: ['session_scan_diagnostics'] }
      })
    )

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.identity).toBe(second.identity)
    expect(first.identity).toMatch(/^[a-f0-9]{64}$/)
  })

  it('allow-lists only safe identifiers, kinds, counts, and provenance', () => {
    const snapshot = resolveTeachingLoop(
      facts({
        latestSession: {
          id: 'session-1',
          source: 'canonical',
          readOnly: false,
          status: 'active',
          eventCount: 1
        },
        durableOutcome: {
          status: 'trusted',
          id: 'outcome-1',
          kind: 'needs_practice',
          evidenceEventIds: ['event-2', 'event-1']
        },
        evidence: { status: 'verified' }
      })
    )

    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(/private|prompt|answer|provider|secret|MISSION\.md|learning-sessions\//i)
    expect(snapshot.safeProjection).toEqual({
      missionId: 'mission-foundations',
      courseId: 'course-foundations',
      session: {
        id: 'session-1',
        source: 'canonical',
        readOnly: false,
        status: 'active',
        eventCount: 1
      },
      outcome: {
        status: 'trusted',
        id: 'outcome-1',
        kind: 'needs_practice'
      },
      evidence: { status: 'verified' },
      resources: {
        readiness: 'ready',
        availableCount: 2
      },
      integrityCodes: [],
      provenance: {
        outcomeEvidenceEventIds: ['event-1', 'event-2'],
        resourceIds: ['resource-a', 'resource-b']
      }
    })
  })

  it('does not mutate deeply frozen facts', () => {
    const input = deepFreeze(
      facts({
        durableOutcome: {
          status: 'trusted',
          id: 'outcome-1',
          kind: 'needs_practice',
          evidenceEventIds: ['event-1']
        },
        evidence: { status: 'verified' },
        latestSession: {
          id: 'session-1',
          source: 'canonical',
          readOnly: false,
          status: 'active',
          eventCount: 1
        }
      })
    )

    expect(() => resolveTeachingLoop(input)).not.toThrow()
    expect(input.resources.provenanceIds).toEqual(['resource-b', 'resource-a'])
  })

  it('does not treat active terminal-looking outcomes as completed', () => {
    const snapshot = resolveTeachingLoop(
      facts({
        latestSession: {
          id: 'session-1',
          source: 'canonical',
          readOnly: false,
          status: 'active',
          eventCount: 2
        },
        durableOutcome: {
          status: 'trusted',
          id: 'outcome-established',
          kind: 'established',
          evidenceEventIds: ['event-1']
        },
        evidence: { status: 'verified' }
      })
    )

    expect(snapshot.displayState).toBe('in_progress')
    expect(snapshot.displayState).not.toBe('completed')
  })
})
