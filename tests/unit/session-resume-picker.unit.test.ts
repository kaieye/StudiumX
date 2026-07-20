import { describe, expect, it } from 'vitest'

import {
  buildSessionResumeCandidates,
  DEFAULT_RESUME_PICKER_LIMIT,
  listSessionResumeCandidates,
  MAX_RESUME_PICKER_LIMIT
} from '../../src/main/session-resume-picker'
import type {
  CanonicalLearningSessionSnapshot,
  LearningSessionScanResult,
  LegacyLearningSessionSnapshot
} from '../../src/shared/teaching-types/learning-session'
import type { ResumeCandidate, ResumePickerReport } from '../../src/shared/teaching-types/session-resume-picker'

const NOW = '2026-07-20T12:00:00.000Z'

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

function activeSession(overrides: Partial<CanonicalLearningSessionSnapshot> = {}): CanonicalLearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-active-1',
    workspaceId: 'workspace-1',
    source: 'canonical',
    readOnly: false,
    status: 'active',
    version: 2,
    createdAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-19T10:00:00.000Z',
    completedAt: null,
    courseRef: {
      courseId: 'course-foundations',
      courseName: 'Foundations',
      relativePath: 'courses/foundations'
    },
    lessonRef: {
      lessonId: '0001',
      title: 'Durable Sessions',
      relativePath: 'courses/foundations/lesson/0001-durable-sessions.html'
    },
    conversationRefs: [],
    eventCount: 3,
    outcomeRef: null,
    events: [
      {
        schemaVersion: 1,
        eventId: 'event-1',
        sessionId: 'session-active-1',
        kind: 'lesson_opened',
        occurredAt: '2026-07-18T10:00:00.000Z',
        sequence: 1,
        recordedAt: '2026-07-18T10:00:00.000Z',
        payload: { learnerAnswer: 'SECRET_ANSWER', selectedOptionIds: ['a'] }
      }
    ],
    ...overrides
  }
}

function completedSession(
  overrides: Partial<CanonicalLearningSessionSnapshot> = {}
): CanonicalLearningSessionSnapshot {
  return activeSession({
    id: 'session-completed-1',
    status: 'completed',
    updatedAt: '2026-07-17T10:00:00.000Z',
    completedAt: '2026-07-17T10:00:00.000Z',
    eventCount: 5,
    outcomeRef: {
      outcomeId: 'outcome-1',
      kind: 'established',
      relativePath: 'learning-sessions/session-completed-1/outcome.json',
      evidenceEventIds: ['event-1'],
      contentSha256: 'a'.repeat(64)
    },
    events: [],
    ...overrides
  })
}

function legacySession(overrides: Partial<LegacyLearningSessionSnapshot> = {}): LegacyLearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-legacy-1',
    workspaceId: 'workspace-1',
    source: 'legacy_lesson',
    readOnly: true,
    status: 'legacy_read_only',
    version: 0,
    createdAt: '2026-07-10T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    completedAt: null,
    courseRef: {
      courseId: 'course-foundations',
      courseName: 'Foundations',
      relativePath: 'courses/foundations'
    },
    lessonRef: {
      lessonId: 'legacy-1',
      title: 'Legacy Lesson Title',
      relativePath: 'lessons/legacy-1.html'
    },
    conversationRefs: [],
    eventCount: 0,
    outcomeRef: null,
    events: [],
    ...overrides
  }
}

function withSessions(...sessions: LearningSessionScanResult['sessions']): LearningSessionScanResult {
  const canonical = sessions.filter((s): s is CanonicalLearningSessionSnapshot => s.source === 'canonical')
  const legacy = sessions.filter((s): s is LegacyLearningSessionSnapshot => s.source === 'legacy_lesson')
  return emptyScan({
    sessions: [...sessions],
    canonicalSessions: canonical,
    legacySessions: legacy
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value as object)) deepFreeze(nested)
  }
  return value
}

function candidateIds(report: ResumePickerReport): string[] {
  return report.candidates.map((c) => c.sessionId)
}

describe('SessionResumePicker', () => {
  it('ranks active recent sessions before completed, legacy, and quarantined', () => {
    const olderActive = activeSession({
      id: 'session-active-old',
      updatedAt: '2026-07-15T10:00:00.000Z'
    })
    const newerActive = activeSession({
      id: 'session-active-new',
      updatedAt: '2026-07-19T12:00:00.000Z'
    })
    const completed = completedSession({ id: 'session-completed' })
    const legacy = legacySession({ id: 'session-legacy' })
    const scan = withSessions(legacy, completed, olderActive, newerActive)
    scan.quarantined = [
      {
        sessionId: 'session-quarantine',
        diagnostic: {
          code: 'canonical_identity_conflict',
          sessionId: 'session-quarantine',
          relativePath: 'learning-sessions',
          message: 'Multiple case aliases claim canonical Session.'
        }
      }
    ]

    const report = buildSessionResumeCandidates(scan, {}, { now: () => NOW })

    expect(report.schemaVersion).toBe(1)
    expect(report.generatedAt).toBe(NOW)
    expect(candidateIds(report)).toEqual([
      'session-active-new',
      'session-active-old',
      'session-completed',
      'session-legacy',
      'session-quarantine'
    ])
    expect(report.candidates[0]?.resumeEligibility).toBe('ready')
    expect(report.candidates[2]?.resumeEligibility).toBe('completed_read_only')
    expect(report.candidates[3]?.resumeEligibility).toBe('legacy_read_only')
    expect(report.candidates[4]?.resumeEligibility).toBe('quarantined')
    expect(report.diagnostics.readyCount).toBe(2)
    expect(report.diagnostics.completedReadOnlyCount).toBe(1)
    expect(report.diagnostics.legacyCount).toBe(1)
    expect(report.diagnostics.quarantinedCount).toBe(1)
  })

  it('prefers completed sessions that carry a trusted outcome over completed without outcome', () => {
    const trusted = completedSession({
      id: 'session-completed-trusted',
      updatedAt: '2026-07-16T10:00:00.000Z',
      completedAt: '2026-07-16T10:00:00.000Z',
      outcomeRef: {
        outcomeId: 'outcome-trusted',
        kind: 'needs_practice',
        relativePath: 'learning-sessions/session-completed-trusted/outcome.json',
        evidenceEventIds: ['event-1'],
        contentSha256: 'b'.repeat(64)
      }
    })
    const untrusted = completedSession({
      id: 'session-completed-untrusted',
      updatedAt: '2026-07-16T11:00:00.000Z',
      completedAt: '2026-07-16T11:00:00.000Z',
      outcomeRef: null
    })

    const report = buildSessionResumeCandidates(withSessions(untrusted, trusted), {}, { now: () => NOW })
    expect(candidateIds(report)).toEqual(['session-completed-trusted', 'session-completed-untrusted'])
    expect(report.candidates[0]?.outcomeKind).toBe('needs_practice')
    expect(report.candidates[1]?.outcomeKind).toBeNull()
  })

  it('classifies corrupt diagnostics separately from general quarantine', () => {
    const scan = emptyScan({
      quarantined: [
        {
          sessionId: 'session-corrupt',
          diagnostic: {
            code: 'invalid_session_manifest',
            sessionId: 'session-corrupt',
            relativePath: 'learning-sessions/session-corrupt/session.json',
            message: 'Session manifest is not valid JSON.'
          }
        },
        {
          sessionId: 'session-quarantine',
          diagnostic: {
            code: 'unsafe_session_storage',
            sessionId: 'session-quarantine',
            relativePath: 'learning-sessions',
            message: 'Learning Session root contains an unknown entry.'
          }
        }
      ]
    })

    const report = buildSessionResumeCandidates(scan, {}, { now: () => NOW })
    expect(report.candidates).toHaveLength(2)
    const byId = Object.fromEntries(report.candidates.map((c) => [c.sessionId, c])) as Record<string, ResumeCandidate>
    expect(byId['session-corrupt']?.resumeEligibility).toBe('corrupt')
    expect(byId['session-quarantine']?.resumeEligibility).toBe('quarantined')
    expect(report.diagnostics.corruptCount).toBe(1)
    expect(report.diagnostics.quarantinedCount).toBe(1)
    // corrupt demoted after quarantined only if same recency; both empty timestamps — sort by eligibility then id
    expect(candidateIds(report)[0]).toBe('session-quarantine')
    expect(candidateIds(report)[1]).toBe('session-corrupt')
  })

  it('filters by courseId, statusFilter, and queryText over course/lesson titles only', () => {
    const a = activeSession({
      id: 'session-a',
      courseRef: {
        courseId: 'course-a',
        courseName: 'Algebra Basics',
        relativePath: 'courses/a'
      },
      lessonRef: {
        lessonId: '1',
        title: 'Linear Equations',
        relativePath: 'courses/a/lesson/1.html'
      }
    })
    const b = activeSession({
      id: 'session-b',
      status: 'active',
      courseRef: {
        courseId: 'course-b',
        courseName: 'Geometry',
        relativePath: 'courses/b'
      },
      lessonRef: {
        lessonId: '2',
        title: 'Triangles',
        relativePath: 'courses/b/lesson/2.html'
      }
    })
    const completed = completedSession({
      id: 'session-c',
      courseRef: {
        courseId: 'course-a',
        courseName: 'Algebra Basics',
        relativePath: 'courses/a'
      },
      lessonRef: {
        lessonId: '3',
        title: 'Quadratic Forms',
        relativePath: 'courses/a/lesson/3.html'
      }
    })
    const scan = withSessions(a, b, completed)

    expect(
      candidateIds(
        buildSessionResumeCandidates(scan, { courseId: 'course-a' }, { now: () => NOW })
      )
    ).toEqual(['session-a', 'session-c'])

    expect(
      candidateIds(
        buildSessionResumeCandidates(scan, { statusFilter: 'completed' }, { now: () => NOW })
      )
    ).toEqual(['session-c'])

    expect(
      candidateIds(
        buildSessionResumeCandidates(scan, { queryText: 'triangle' }, { now: () => NOW })
      )
    ).toEqual(['session-b'])

    expect(
      candidateIds(
        buildSessionResumeCandidates(scan, { queryText: 'algebra' }, { now: () => NOW })
      )
    ).toEqual(['session-a', 'session-c'])

    // queryText must not match learner content hidden inside event payloads
    const withPayload = activeSession({
      id: 'session-payload',
      courseRef: {
        courseId: 'course-z',
        courseName: 'Other',
        relativePath: 'courses/z'
      },
      lessonRef: {
        lessonId: 'z',
        title: 'Other Lesson',
        relativePath: 'courses/z/lesson/z.html'
      },
      events: [
        {
          schemaVersion: 1,
          eventId: 'event-secret',
          sessionId: 'session-payload',
          kind: 'learner_response_recorded',
          occurredAt: '2026-07-18T10:00:00.000Z',
          sequence: 1,
          recordedAt: '2026-07-18T10:00:00.000Z',
          payload: { learnerAnswer: 'triangle secret answer' }
        }
      ]
    })
    expect(
      candidateIds(
        buildSessionResumeCandidates(withSessions(withPayload), { queryText: 'triangle' }, { now: () => NOW })
      )
    ).toEqual([])
  })

  it('caps limit to default 20 and hard max 100', () => {
    const sessions = Array.from({ length: 120 }, (_, index) =>
      activeSession({
        id: `session-${String(index).padStart(3, '0')}`,
        updatedAt: new Date(Date.parse('2026-07-01T00:00:00.000Z') + index * 60_000).toISOString()
      })
    )
    const scan = withSessions(...sessions)

    const defaulted = buildSessionResumeCandidates(scan, {}, { now: () => NOW })
    expect(defaulted.candidates).toHaveLength(DEFAULT_RESUME_PICKER_LIMIT)
    expect(defaulted.diagnostics.returnedCount).toBe(DEFAULT_RESUME_PICKER_LIMIT)
    expect(defaulted.diagnostics.matchedCount).toBe(120)
    expect(defaulted.totalScanned).toBe(120)

    const capped = buildSessionResumeCandidates(scan, { limit: 500 }, { now: () => NOW })
    expect(capped.candidates).toHaveLength(MAX_RESUME_PICKER_LIMIT)

    const custom = buildSessionResumeCandidates(scan, { limit: 5 }, { now: () => NOW })
    expect(custom.candidates).toHaveLength(5)
    // Most recent first
    expect(custom.candidates[0]?.sessionId).toBe('session-119')
  })

  it('never projects raw event payloads or learner answers onto candidates', () => {
    const session = activeSession({
      events: [
        {
          schemaVersion: 1,
          eventId: 'event-answer',
          sessionId: 'session-active-1',
          kind: 'quiz_attempted',
          occurredAt: '2026-07-18T10:00:00.000Z',
          sequence: 1,
          recordedAt: '2026-07-18T10:00:00.000Z',
          payload: {
            learnerAnswer: 'raw-secret-answer',
            selectedOptionIds: ['opt-1'],
            assessmentPayload: { prompt: 'hidden' },
            providerResponse: { text: 'hidden' }
          }
        }
      ]
    })
    const report = buildSessionResumeCandidates(withSessions(session), {}, { now: () => NOW })
    const json = JSON.stringify(report)
    expect(json).not.toMatch(/raw-secret-answer|selectedOptionIds|assessmentPayload|providerResponse|learnerAnswer/)
    expect(report.candidates[0]).toMatchObject({
      sessionId: 'session-active-1',
      courseId: 'course-foundations',
      courseName: 'Foundations',
      lessonTitle: 'Durable Sessions',
      eventCount: 3,
      resumeEligibility: 'ready'
    })
    expect(report.candidates[0]).not.toHaveProperty('events')
    expect(report.candidates[0]).not.toHaveProperty('payload')
  })

  it('does not mutate deeply frozen scan inputs', () => {
    const scan = deepFreeze(
      withSessions(
        activeSession({ id: 'session-frozen' }),
        legacySession({ id: 'session-legacy-frozen' })
      )
    )
    expect(() => buildSessionResumeCandidates(scan, { limit: 10 }, { now: () => NOW })).not.toThrow()
    const report = buildSessionResumeCandidates(scan, { limit: 10 }, { now: () => NOW })
    expect(report.candidates).toHaveLength(2)
  })

  it('returns stable ranking for identical scans', () => {
    const scan = withSessions(
      activeSession({ id: 'session-b', updatedAt: '2026-07-19T10:00:00.000Z' }),
      activeSession({ id: 'session-a', updatedAt: '2026-07-19T10:00:00.000Z' }),
      completedSession({ id: 'session-c' })
    )
    const first = buildSessionResumeCandidates(scan, {}, { now: () => NOW })
    const second = buildSessionResumeCandidates(scan, {}, { now: () => NOW })
    expect(JSON.stringify(first.candidates)).toBe(JSON.stringify(second.candidates))
    expect(candidateIds(first)).toEqual(['session-a', 'session-b', 'session-c'])
  })

  it('listSessionResumeCandidates scans then builds via the thin adapter', async () => {
    const session = activeSession({ id: 'session-adapter' })
    const scan = withSessions(session)
    const ledger = {
      scan: async () => scan
    }

    const report = await listSessionResumeCandidates(ledger, { limit: 5 }, {}, { now: () => NOW })
    expect(report.generatedAt).toBe(NOW)
    expect(candidateIds(report)).toEqual(['session-adapter'])
    expect(report.diagnostics.returnedCount).toBe(1)
  })
})
