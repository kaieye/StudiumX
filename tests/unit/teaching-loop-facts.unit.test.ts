import { describe, expect, it } from 'vitest'
import { buildTeachingLoopFacts } from '../../src/main/teaching-loop-facts'
import { resolveTeachingLoop } from '../../src/main/teaching-loop-resolver'
import type {
  CanonicalLearningSessionSnapshot,
  LearningSessionScanResult,
  LegacyLearningSessionSnapshot
} from '../../src/shared/teaching-types/learning-session'

function emptyScan(overrides: Partial<LearningSessionScanResult> = {}): LearningSessionScanResult {
  return {
    sessions: [],
    canonicalSessions: [],
    legacySessions: [],
    diagnostics: [],
    quarantined: [],
    stages: [],
    recoveries: [],
    settlement: { fileSync: 'supported', directorySync: 'supported' },
    ...overrides
  }
}

function canonical(
  overrides: Partial<CanonicalLearningSessionSnapshot> = {}
): CanonicalLearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-newer',
    workspaceId: 'workspace-1',
    source: 'canonical',
    readOnly: false,
    status: 'active',
    version: 1,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T01:00:00.000Z',
    completedAt: null,
    courseRef: {
      courseId: 'course-1',
      courseName: 'Course 1',
      relativePath: 'courses/course-1'
    },
    lessonRef: null,
    conversationRefs: [],
    eventCount: 0,
    outcomeRef: null,
    events: [],
    ...overrides
  }
}

function legacy(overrides: Partial<LegacyLearningSessionSnapshot> = {}): LegacyLearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'legacy-1',
    workspaceId: 'workspace-1',
    source: 'legacy_lesson',
    readOnly: true,
    status: 'legacy_read_only',
    version: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    completedAt: null,
    courseRef: {
      courseId: 'course-1',
      courseName: 'Course 1',
      relativePath: 'courses/course-1'
    },
    lessonRef: {
      lessonId: 'lesson-1',
      title: 'Legacy lesson',
      relativePath: 'lessons/legacy.html'
    },
    conversationRefs: [],
    eventCount: 0,
    outcomeRef: null,
    events: [],
    ...overrides
  }
}

describe('buildTeachingLoopFacts', () => {
  it('selects the most recently updated canonical session over older and legacy sessions', () => {
    const older = canonical({
      id: 'session-older',
      updatedAt: '2026-07-16T00:30:00.000Z',
      eventCount: 1
    })
    const newer = canonical({
      id: 'session-newer',
      updatedAt: '2026-07-16T02:00:00.000Z',
      eventCount: 3
    })
    const legacySession = legacy()

    const facts = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [legacySession, older, newer],
        canonicalSessions: [older, newer],
        legacySessions: [legacySession]
      }),
      resources: {
        readiness: 'ready',
        availableCount: 1,
        provenanceIds: ['resource-1']
      }
    })

    expect(facts.latestSession).toEqual({
      id: 'session-newer',
      source: 'canonical',
      readOnly: false,
      status: 'active',
      eventCount: 3
    })
  })

  it('falls back to legacy only when no canonical session exists', () => {
    const facts = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'absent' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [legacy()],
        legacySessions: [legacy()]
      }),
      resources: {
        readiness: 'ready',
        availableCount: 0,
        provenanceIds: []
      }
    })

    expect(facts.latestSession).toMatchObject({
      id: 'legacy-1',
      source: 'legacy_lesson',
      readOnly: true,
      status: 'legacy_read_only'
    })
    expect(facts.durableOutcome).toEqual({ status: 'absent' })
  })

  it('projects trusted verified outcomes from surviving outcomeRef', () => {
    const completed = canonical({
      id: 'session-done',
      status: 'completed',
      updatedAt: '2026-07-16T03:00:00.000Z',
      completedAt: '2026-07-16T03:00:00.000Z',
      eventCount: 2,
      outcomeRef: {
        outcomeId: 'outcome-1',
        kind: 'misconception_corrected',
        relativePath: 'learning-sessions/session-done/outcome.json',
        evidenceEventIds: ['event-b', 'event-a'],
        contentSha256: 'a'.repeat(64)
      }
    })

    const facts = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [completed],
        canonicalSessions: [completed]
      }),
      resources: {
        readiness: 'ready',
        availableCount: 2,
        provenanceIds: ['resource-2', 'resource-1']
      }
    })

    expect(facts.durableOutcome).toEqual({
      status: 'trusted',
      id: 'outcome-1',
      kind: 'misconception_corrected',
      evidenceEventIds: ['event-b', 'event-a']
    })
    expect(facts.evidence).toEqual({ status: 'verified' })

    const snapshot = resolveTeachingLoop(facts)
    expect(snapshot.displayState).toBe('completed')
    expect(snapshot.nextStep).toMatchObject({
      action: 'continue_next_session',
      reason: 'misconception_corrected_with_next_goal'
    })
  })

  it('projects active needs_practice settlement markers without completing the loop', () => {
    const active = canonical({
      id: 'session-practice',
      status: 'active',
      eventCount: 2,
      outcomeRef: null
    })

    const facts = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [active],
        canonicalSessions: [active]
      }),
      resources: {
        readiness: 'ready',
        availableCount: 1,
        provenanceIds: ['resource-1']
      },
      settlement: {
        sessionId: 'session-practice',
        outcomeId: 'outcome-practice',
        kind: 'needs_practice',
        evidenceEventIds: ['event-1']
      }
    })

    expect(facts.latestSession?.status).toBe('active')
    expect(facts.durableOutcome).toEqual({
      status: 'trusted',
      id: 'outcome-practice',
      kind: 'needs_practice',
      evidenceEventIds: ['event-1']
    })

    const snapshot = resolveTeachingLoop(facts)
    expect(snapshot.displayState).toBe('waiting_for_learner')
    expect(snapshot.nextStep).toMatchObject({
      action: 'contrast_and_retry',
      reason: 'needs_practice'
    })
  })

  it('does not treat not_evidenced settlement as completed', () => {
    const active = canonical({
      id: 'session-open',
      status: 'active',
      eventCount: 1
    })

    const facts = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [active],
        canonicalSessions: [active]
      }),
      resources: {
        readiness: 'ready',
        availableCount: 1,
        provenanceIds: ['resource-1']
      },
      settlement: {
        sessionId: 'session-open',
        outcomeId: 'outcome-none',
        kind: 'not_evidenced',
        evidenceEventIds: []
      }
    })

    const snapshot = resolveTeachingLoop(facts)
    expect(snapshot.displayState).toBe('waiting_for_learner')
    expect(snapshot.displayState).not.toBe('completed')
    expect(snapshot.nextStep).toMatchObject({
      action: 'request_goal_clarification',
      reason: 'insufficient_evidence'
    })
  })

  it('flags completed sessions missing outcomeRef as integrity failures', () => {
    const completed = canonical({
      id: 'session-broken',
      status: 'completed',
      completedAt: '2026-07-16T03:00:00.000Z',
      outcomeRef: null,
      eventCount: 1
    })

    const facts = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [completed],
        canonicalSessions: [completed]
      }),
      resources: {
        readiness: 'ready',
        availableCount: 1,
        provenanceIds: ['resource-1']
      }
    })

    expect(facts.integrity.codes).toEqual(['missing_completed_outcome'])
    expect(resolveTeachingLoop(facts).displayState).toBe('needs_review')
  })

  it('maps scan diagnostics and quarantines into integrity codes', () => {
    const facts = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        diagnostics: [
          {
            code: 'invalid_session_outcome',
            sessionId: 'session-1',
            relativePath: 'learning-sessions/session-1/outcome.json',
            message: 'digest mismatch'
          },
          {
            code: 'unknown_session_schema',
            sessionId: 'session-2',
            relativePath: 'learning-sessions/session-2/session.json',
            message: 'unknown schema'
          }
        ],
        quarantined: [
          {
            sessionId: 'session-2',
            diagnostic: {
              code: 'unknown_session_schema',
              sessionId: 'session-2',
              relativePath: 'learning-sessions/session-2/session.json',
              message: 'unknown schema'
            }
          }
        ]
      }),
      resources: {
        readiness: 'ready',
        availableCount: 0,
        provenanceIds: []
      }
    })

    expect(facts.integrity.codes).toEqual([
      'outcome_review_required',
      'outcome_unknown_schema',
      'session_quarantined',
      'session_scan_diagnostics'
    ])
    expect(resolveTeachingLoop(facts).displayState).toBe('needs_review')
  })

  it('is deterministic for the same durable scan inputs', () => {
    const session = canonical({
      id: 'session-1',
      eventCount: 2,
      outcomeRef: {
        outcomeId: 'outcome-1',
        kind: 'needs_practice',
        relativePath: 'learning-sessions/session-1/outcome.json',
        evidenceEventIds: ['event-1'],
        contentSha256: 'b'.repeat(64)
      }
    })
    const source = {
      mission: { id: 'mission-1' as const, nextGoal: 'available' as const },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [session],
        canonicalSessions: [session]
      }),
      resources: {
        readiness: 'ready' as const,
        availableCount: 1,
        provenanceIds: ['resource-1']
      }
    }

    expect(JSON.stringify(buildTeachingLoopFacts(source))).toBe(
      JSON.stringify(buildTeachingLoopFacts(source))
    )
  })

  it('selectedSessionId binds explicit session even when a newer session exists', () => {
    const older = canonical({
      id: 'session-A',
      updatedAt: '2026-07-16T00:30:00.000Z',
      eventCount: 2,
      status: 'completed',
      outcomeRef: {
        outcomeId: 'out-a',
        kind: 'needs_practice',
        relativePath: 'outcomes/a.json',
        evidenceEventIds: ['ev-a'],
        contentSha256: 'a'.repeat(64)
      }
    })
    const newer = canonical({
      id: 'session-B',
      updatedAt: '2026-07-16T03:00:00.000Z',
      eventCount: 9,
      status: 'active'
    })
    const factsLatest = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [older, newer],
        canonicalSessions: [older, newer]
      }),
      resources: {
        readiness: 'ready' as const,
        availableCount: 0,
        provenanceIds: [] as string[]
      }
    })
    expect(factsLatest.latestSession?.id).toBe('session-B')

    const factsScoped = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [older, newer],
        canonicalSessions: [older, newer]
      }),
      resources: {
        readiness: 'ready' as const,
        availableCount: 1,
        provenanceIds: ['resource-a']
      },
      selectedSessionId: 'session-A',
      settlement: {
        sessionId: 'session-A',
        outcomeId: 'out-a',
        kind: 'needs_practice',
        evidenceEventIds: ['ev-a']
      }
    })
    expect(factsScoped.latestSession?.id).toBe('session-A')
    expect(factsScoped.latestSession?.eventCount).toBe(2)
    expect(factsScoped.durableOutcome).toMatchObject({ status: 'trusted', kind: 'needs_practice', id: 'out-a' })

    const missing = buildTeachingLoopFacts({
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [newer],
        canonicalSessions: [newer]
      }),
      resources: {
        readiness: 'ready' as const,
        availableCount: 0,
        provenanceIds: [] as string[]
      },
      selectedSessionId: 'session-A'
    })
    expect(missing.latestSession).toBeNull()
  })

})