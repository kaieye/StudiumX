import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsHourBuckets,
  AnalyticsSectionResult,
  LearningAnalyticsBundle,
  LearningAnalyticsQuery,
  StudySessionFact,
  StudyTaskActivityFact
} from '@shared/teaching-types/analytics'
import {
  STUDY_SPACE_SESSION_CLIENT_KEY,
  STUDY_SPACE_STORAGE_KEY,
  defaultStudySnapshot
} from '@renderer/study-space/constants'
import {
  appendStudyAnalyticsFacts,
  clearStudyAnalyticsStore,
  readStudyAnalyticsStore,
  subscribeStudyAnalyticsStore
} from '@renderer/views/workbench/analytics/domain/activityLedger'
import { mergePersonalActivityIntoAnalyticsBundle } from '@renderer/views/workbench/analytics/domain/personalAnalyticsAdapter'
import { buildLearningAnalyticsQuery } from '@renderer/views/workbench/analytics/useStudyAnalytics'

const clientId = 'study-client-adapter'
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

function query(from: string, to = from): LearningAnalyticsQuery {
  return buildLearningAnalyticsQuery({
    range: range(from, to),
    localToday: '2026-07-13',
    timeZone: 'Asia/Shanghai',
    personalClientId: clientId,
    teaching: { kind: 'none' },
    presenceSpaceCode: 'SPACE-TEST'
  })
}

function coverage(requestedRange: AnalyticsDateRange): AnalyticsCoverage {
  return {
    rangeApplied: true,
    requestedRange,
    effectiveRange: requestedRange,
    trackingStartedOn: requestedRange.from,
    dataStartDate: null,
    dataEndDate: null,
    retention: {
      policy: 'rolling_local_days',
      days: 400,
      includesToday: true,
      cutoffDate: '2025-06-09'
    },
    complete: false,
    sources: []
  }
}

function unavailable<T>(requestedRange: AnalyticsDateRange): AnalyticsSectionResult<T> {
  return {
    state: 'unavailable',
    reason: 'history_not_recorded',
    temporal: { kind: 'range', range: requestedRange },
    coverage: coverage(requestedRange),
    warnings: []
  }
}

function mainBundle(requestQuery: LearningAnalyticsQuery): LearningAnalyticsBundle {
  const missing = unavailable<never>(requestQuery.range)
  return {
    contractVersion: 1,
    generatedAt: '2026-07-13T12:00:00.000Z',
    query: requestQuery,
    hero: missing,
    focus: missing,
    tasks: missing,
    tokens: missing,
    workspaceAssets: missing,
    review: missing,
    memory: missing,
    platform: missing,
    presence: missing,
    insights: missing
  } as unknown as LearningAnalyticsBundle
}

function sessionFact(attribution: StudySessionFact['taskAttribution']): StudySessionFact {
  return {
    factVersion: 1,
    factKind: 'study_session',
    id: `session-${attribution.kind}`,
    clientId,
    timerMode: 'focus',
    outcome: 'completed',
    startedAt: '2026-07-12T15:50:00.000Z',
    endedAt: '2026-07-12T16:15:00.000Z',
    recordedAt: '2026-07-12T16:15:00.000Z',
    plannedSeconds: 1500,
    activeSeconds: 1500,
    pausedSeconds: 0,
    completedFocusSessions: 1,
    xpEarned: 25,
    context: { modeId: 'deepwork', roomId: 'deep', signalId: 'writing', spaceCode: 'SPACE-TEST' },
    taskAttribution: attribution,
    daySegments: [
      {
        localDate: '2026-07-12',
        timezoneOffsetMinutes: -480,
        startedAt: '2026-07-12T15:50:00.000Z',
        endedAt: '2026-07-12T16:00:00.000Z',
        activeSeconds: 600,
        pausedSeconds: 0,
        hourBuckets: hours([23, 600])
      },
      {
        localDate: '2026-07-13',
        timezoneOffsetMinutes: -480,
        startedAt: '2026-07-12T16:00:00.000Z',
        endedAt: '2026-07-12T16:15:00.000Z',
        activeSeconds: 900,
        pausedSeconds: 0,
        hourBuckets: hours([0, 900])
      }
    ]
  }
}

function taskCompletedFact(): StudyTaskActivityFact {
  const before = { taskId: 'task-1', title: 'Cross-day task', done: false }
  const after = { ...before, done: true }
  return {
    factVersion: 1,
    factKind: 'study_activity',
    id: 'task-completed',
    clientId,
    occurredAt: '2026-07-12T16:15:00.000Z',
    recordedAt: '2026-07-12T16:15:00.000Z',
    localDate: '2026-07-13',
    timezoneOffsetMinutes: -480,
    activity: { kind: 'task_completed', before, after }
  }
}

function dataOf<T>(result: AnalyticsSectionResult<T>): T {
  if (result.state !== 'available' && result.state !== 'partial' && result.state !== 'empty') {
    throw new Error(`Expected data-bearing analytics result, received ${result.state}`)
  }
  return result.data
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  sessionStorage.setItem(STUDY_SPACE_SESSION_CLIENT_KEY, clientId)
  localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify({
    ...defaultStudySnapshot,
    clientId,
    xp: 375,
    streakDays: 4,
    tasks: [{ id: 'task-1', title: 'Cross-day task', done: true }]
  }))
  vi.useRealTimers()
})

describe('renderer personal analytics adapter', () => {
  it('keeps an empty covered day distinct from an untracked day', () => {
    const coveredQuery = query('2026-07-13')
    const covered = mergePersonalActivityIntoAnalyticsBundle(mainBundle(coveredQuery), coveredQuery)
    expect(covered.focus.state).toBe('empty')
    expect(dataOf(covered.focus).heatmap).toEqual([
      expect.objectContaining({ date: '2026-07-13', focusSeconds: 0, isCovered: true })
    ])

    const untrackedQuery = query('2026-07-12')
    const untracked = mergePersonalActivityIntoAnalyticsBundle(mainBundle(untrackedQuery), untrackedQuery)
    expect(untracked.focus.state).toBe('unavailable')
    expect(untracked.focus.coverage.complete).toBe(false)
    expect(untracked.focus.warnings.map((warning) => warning.code)).toContain('range_before_tracking_started')
  })

  it('splits cross-midnight seconds by local date and owns completion on the ending date', () => {
    appendStudyAnalyticsFacts(clientId, [
      sessionFact({
        kind: 'explicit',
        capturedAt: 'session_start',
        taskId: 'task-1',
        taskTitleSnapshot: 'Cross-day task'
      }),
      taskCompletedFact()
    ], { localToday: '2026-07-13', updatedAt: '2026-07-13T12:00:00.000Z' })

    const firstDayQuery = query('2026-07-12')
    const firstDay = mergePersonalActivityIntoAnalyticsBundle(mainBundle(firstDayQuery), firstDayQuery)
    const firstFocus = dataOf(firstDay.focus)
    const firstTasks = dataOf(firstDay.tasks)
    expect(firstFocus.sessionStructure).toMatchObject({ focusSeconds: 600, completed: 0 })
    expect(firstFocus.hourBuckets[23]).toBe(600)
    expect(firstTasks.topByAttributedFocus[0]).toMatchObject({ focusSeconds: 600, completedInRange: false })

    const endingDayQuery = query('2026-07-13')
    const endingDay = mergePersonalActivityIntoAnalyticsBundle(mainBundle(endingDayQuery), endingDayQuery)
    const endingFocus = dataOf(endingDay.focus)
    const endingTasks = dataOf(endingDay.tasks)
    expect(endingFocus.sessionStructure).toMatchObject({
      focusSeconds: 900,
      completed: 1,
      averageCompletedFocusSeconds: 1500
    })
    expect(endingFocus.hourBuckets[0]).toBe(900)
    expect(endingTasks.topByAttributedFocus[0]).toMatchObject({ focusSeconds: 900, completedInRange: true })
    expect(endingTasks.flow.completed).toBe(1)
  })

  it('preserves unattributed range seconds and keeps current inventory, growth, and Presence range-invariant', () => {
    appendStudyAnalyticsFacts(clientId, [sessionFact({ kind: 'unattributed', reason: 'no_task_selected' })], {
      localToday: '2026-07-13'
    })
    const firstQuery = query('2026-07-12')
    const secondQuery = query('2026-07-13')
    const presence = unavailable<never>(firstQuery.range)
    const firstMain = { ...mainBundle(firstQuery), presence } as LearningAnalyticsBundle
    const secondMain = { ...mainBundle(secondQuery), presence } as LearningAnalyticsBundle
    const first = mergePersonalActivityIntoAnalyticsBundle(firstMain, firstQuery)
    const second = mergePersonalActivityIntoAnalyticsBundle(secondMain, secondQuery)

    expect(dataOf(first.tasks).unattributedFocusSeconds).toBe(600)
    expect(dataOf(second.tasks).unattributedFocusSeconds).toBe(900)
    expect(dataOf(first.tasks).current).toMatchObject({ total: 1, completed: 1 })
    expect(dataOf(second.tasks).current).toMatchObject({ total: 1, completed: 1 })
    expect(dataOf(first.focus).currentGrowth).toEqual(dataOf(second.focus).currentGrowth)
    expect(first.presence).toBe(presence)
    expect(second.presence).toBe(presence)
  })

  it('clears only the renderer-owned ledger and notifies stable subscribers', () => {
    appendStudyAnalyticsFacts(clientId, [sessionFact({ kind: 'unattributed', reason: 'no_task_selected' })], {
      localToday: '2026-07-13'
    })
    const listener = vi.fn()
    const unsubscribe = subscribeStudyAnalyticsStore(clientId, listener)

    expect(clearStudyAnalyticsStore(clientId, { localToday: '2026-07-13' })).toBe(true)
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(readStudyAnalyticsStore(clientId, { localToday: '2026-07-13' }).facts).toEqual([])
    expect(localStorage.getItem(STUDY_SPACE_STORAGE_KEY)).not.toBeNull()
  })
})
