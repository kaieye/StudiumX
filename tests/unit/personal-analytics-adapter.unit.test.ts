import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AnalyticsDateRange,
  AnalyticsHourBuckets,
  AnalyticsSectionResult,
  LearningAnalyticsQuery,
  PersonalStudyAnalyticsSnapshot,
  StudyAnalyticsFact,
  StudySessionFact,
  StudyTaskActivityFact,
  TokenAnalytics
} from '@shared/teaching-types/analytics'
import {
  PERSONAL_STUDY_SNAPSHOT_MAX_FACTS,
  buildPersonalStudyAnalytics,
  validatePersonalStudySnapshot
} from '@shared/learning-analytics/personal-study-source'
import {
  appendStudyAnalyticsFacts,
  clearStudyAnalyticsStore,
  createPersonalStudyAnalyticsSnapshot,
  readStudyAnalyticsStore,
  subscribeStudyAnalyticsStore
} from '@renderer/views/workbench/analytics/domain/activityLedger'

const clientId = 'study-client-adapter'
const now = new Date('2026-07-13T12:00:00.000Z')
const capturedAt = now.toISOString()

const hours = (...entries: Array<[number, number]>): AnalyticsHourBuckets => {
  const values = Array.from({ length: 24 }, () => 0)
  for (const [hour, seconds] of entries) values[hour] = seconds
  return values as unknown as AnalyticsHourBuckets
}

function range(from: string, to = from): AnalyticsDateRange {
  return {
    from,
    to,
    preset: 'custom',
    fromInclusive: true,
    toInclusive: true,
    calendar: 'local_gregorian',
    weekStartsOn: 1
  }
}

function query(from = '2026-07-12', to = from): LearningAnalyticsQuery {
  return {
    range: range(from, to),
    scope: {
      personalFocus: { kind: 'personal', clientId },
      teaching: { kind: 'none' },
      presence: { kind: 'none' }
    },
    calendarContext: { localToday: '2026-07-13', timeZone: 'Asia/Shanghai', weekStartsOn: 1 }
  }
}

function sessionFact(overrides: Partial<StudySessionFact> = {}): StudySessionFact {
  return {
    factVersion: 1,
    factKind: 'study_session',
    id: 'session-1',
    clientId,
    timerMode: 'focus',
    outcome: 'completed',
    startedAt: '2026-07-12T01:00:00.000Z',
    endedAt: '2026-07-12T01:25:00.000Z',
    recordedAt: '2026-07-12T01:25:00.000Z',
    plannedSeconds: 1500,
    activeSeconds: 1500,
    pausedSeconds: 0,
    completedFocusSessions: 1,
    xpEarned: 25,
    context: { modeId: 'deepwork', roomId: 'deep', signalId: 'writing' },
    taskAttribution: {
      kind: 'explicit',
      capturedAt: 'session_start',
      taskId: 'task-1',
      taskTitleSnapshot: 'Cross-day task'
    },
    daySegments: [{
      localDate: '2026-07-12',
      timezoneOffsetMinutes: -480,
      startedAt: '2026-07-12T01:00:00.000Z',
      endedAt: '2026-07-12T01:25:00.000Z',
      activeSeconds: 1500,
      pausedSeconds: 0,
      hourBuckets: hours([9, 1500])
    }],
    ...overrides
  }
}

function taskCompletedFact(): StudyTaskActivityFact {
  const before = { taskId: 'task-1', title: 'Cross-day task', done: false }
  return {
    factVersion: 1,
    factKind: 'study_activity',
    id: 'task-completed',
    clientId,
    occurredAt: '2026-07-12T01:25:00.000Z',
    recordedAt: '2026-07-12T01:25:00.000Z',
    localDate: '2026-07-12',
    timezoneOffsetMinutes: -480,
    activity: { kind: 'task_completed', before, after: { ...before, done: true } }
  }
}

function snapshot(overrides: Partial<PersonalStudyAnalyticsSnapshot> = {}): PersonalStudyAnalyticsSnapshot {
  const current = overrides.current ?? { xp: 375, streakDays: 4, tasks: [{ taskId: 'task-1', title: 'Cross-day task', done: true }] }
  return {
    version: 1,
    identity: 'snapshot-1',
    capturedAt,
    clientId,
    trackingStartedOn: '2026-07-12',
    facts: [],
    current,
    diagnostics: { invalidFactRows: 0, retentionPruned: false },
    ...overrides
  }
}

function tokenSection(totalTokens = 42): AnalyticsSectionResult<TokenAnalytics> {
  return {
    state: 'available',
    data: { totals: { totalTokens } }
  } as AnalyticsSectionResult<TokenAnalytics>
}

function dataOf<T>(result: AnalyticsSectionResult<T>): T {
  if (result.state !== 'available' && result.state !== 'partial' && result.state !== 'empty') {
    throw new Error(`Expected data-bearing analytics result, received ${result.state}`)
  }
  return result.data
}

function calculate(requestQuery: LearningAnalyticsQuery, rawSnapshot: unknown) {
  const validation = validatePersonalStudySnapshot(rawSnapshot, {
    clientId,
    localToday: requestQuery.calendarContext.localToday,
    now
  })
  return {
    validation,
    sections: buildPersonalStudyAnalytics({
      query: requestQuery,
      validation,
      generatedAt: capturedAt,
      tokens: tokenSection()
    })
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('personal Study analytics snapshot seam', () => {
  it('adapts the renderer ledger into an identity-stable source snapshot and retains renderer-only clear behavior', () => {
    appendStudyAnalyticsFacts(clientId, [sessionFact()], {
      localToday: '2026-07-13',
      updatedAt: capturedAt
    })

    const first = createPersonalStudyAnalyticsSnapshot(clientId, {
      xp: 375,
      streakDays: 4,
      tasks: [{ taskId: 'task-1', title: 'Cross-day task', done: true }]
    }, { localToday: '2026-07-13', capturedAt })
    const later = createPersonalStudyAnalyticsSnapshot(clientId, first.current, {
      localToday: '2026-07-13',
      capturedAt: '2026-07-13T12:01:00.000Z'
    })
    expect(first.identity).toBe(later.identity)
    expect(first).toMatchObject({ facts: [expect.objectContaining({ id: 'session-1' })] })
    expect(first).not.toHaveProperty('dailyProjections')

    const listener = vi.fn()
    const unsubscribe = subscribeStudyAnalyticsStore(clientId, listener)
    expect(clearStudyAnalyticsStore(clientId, { localToday: '2026-07-13' })).toBe(true)
    unsubscribe()
    expect(listener).toHaveBeenCalledOnce()
    expect(readStudyAnalyticsStore(clientId, { localToday: '2026-07-13' }).facts).toEqual([])
  })

  it('returns a complete focus, task, and hero bundle from one valid snapshot', () => {
    const { validation, sections } = calculate(query(), snapshot({ facts: [sessionFact(), taskCompletedFact()] }))
    expect(validation.state).toBe('valid')
    expect(sections.focus.state).toBe('available')
    expect(sections.tasks.state).toBe('available')
    expect(sections.hero.state).toBe('available')

    expect(dataOf(sections.focus).sessionStructure).toMatchObject({ focusSeconds: 1500, completed: 1 })
    expect(dataOf(sections.tasks)).toMatchObject({
      current: { total: 1, completed: 1, completionRate: 1 },
      flow: { completed: 1 },
      plan: { attributedFocusSeconds: 1500 }
    })
    expect(dataOf(sections.tasks).topByAttributedFocus).toEqual([
      expect.objectContaining({ taskId: 'task-1', focusSeconds: 1500, completedInRange: true, currentlyDone: true })
    ])
    expect(dataOf(sections.hero)).toMatchObject({
      focusSeconds: 1500,
      completedFocusSessions: 1,
      currentXp: 375,
      currentStreakDays: 4,
      totalTokens: 42,
      currentTaskCompletionRate: 1
    })
  })

  it('keeps an empty covered day distinct from a day before tracking began', () => {
    const empty = snapshot({ trackingStartedOn: '2026-07-13' })
    const covered = calculate(query('2026-07-13'), empty).sections.focus
    expect(covered.state).toBe('empty')
    expect(dataOf(covered).heatmap).toEqual([expect.objectContaining({ date: '2026-07-13', focusSeconds: 0, isCovered: true })])

    const beforeTracking = calculate(query('2026-07-12'), empty).sections.focus
    expect(beforeTracking.state).toBe('unavailable')
    expect(beforeTracking.warnings.map((item) => item.code)).toContain('range_before_tracking_started')
  })

  it('ignores malformed and foreign-client fact rows instead of allowing them to change analytics', () => {
    const malformed = { ...sessionFact({ id: 'malformed', activeSeconds: 999_999 }), daySegments: [] } as unknown as StudyAnalyticsFact
    const foreign = sessionFact({ id: 'foreign', clientId: 'another-client' })
    const { validation, sections } = calculate(query(), snapshot({ facts: [sessionFact(), malformed, foreign] }))
    expect(validation).toMatchObject({ state: 'valid', rejectedFacts: 2 })
    expect(sections.focus.state).toBe('partial')
    expect(dataOf(sections.focus).sessionStructure.focusSeconds).toBe(1500)
    expect(sections.focus.warnings.map((item) => item.code)).toContain('facts_recovered_with_invalid_rows')
  })

  it('rejects stale and oversized snapshots before aggregation', () => {
    const stale = calculate(query(), snapshot({ capturedAt: '2026-07-13T11:49:59.000Z' }))
    expect(stale.validation.state).toBe('invalid')
    expect(stale.sections.focus.state).toBe('unavailable')

    const oversized = calculate(query(), snapshot({
      facts: Array.from({ length: PERSONAL_STUDY_SNAPSHOT_MAX_FACTS + 1 }, (_, index) => sessionFact({ id: `session-${index}` }))
    }))
    expect(oversized.validation.state).toBe('invalid')
    expect(oversized.sections.hero.state).toBe('unavailable')
  })

  it('prunes facts outside the 400-day window and ignores a personal payload for non-personal scopes', () => {
    const old = sessionFact({
      id: 'old-session',
      startedAt: '2025-06-08T01:00:00.000Z',
      endedAt: '2025-06-08T01:25:00.000Z',
      recordedAt: '2025-06-08T01:25:00.000Z',
      daySegments: [{
        localDate: '2025-06-08',
        timezoneOffsetMinutes: -480,
        startedAt: '2025-06-08T01:00:00.000Z',
        endedAt: '2025-06-08T01:25:00.000Z',
        activeSeconds: 1500,
        pausedSeconds: 0,
        hourBuckets: hours([9, 1500])
      }]
    })
    const retained = calculate(query(), snapshot({ trackingStartedOn: '2025-06-08', facts: [old] }))
    expect(retained.validation).toMatchObject({ state: 'valid', retentionPruned: true })
    if (retained.validation.state === 'valid') expect(retained.validation.snapshot.facts).toEqual([])
    expect(retained.sections.focus.coverage.retention).toMatchObject({ days: 400, cutoffDate: '2025-06-09' })
    expect(retained.sections.focus.warnings.map((item) => item.code)).toContain('retention_pruned')

    const nonPersonal = query()
    nonPersonal.scope.personalFocus = { kind: 'none' }
    const ignored = calculate(nonPersonal, snapshot({ facts: [sessionFact()] })).sections
    expect(ignored).toMatchObject({
      hero: { state: 'unavailable', reason: 'not_applicable' },
      focus: { state: 'unavailable', reason: 'not_applicable' },
      tasks: { state: 'unavailable', reason: 'not_applicable' }
    })
  })
})
