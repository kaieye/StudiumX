import { describe, expect, it } from 'vitest'
import type {
  AnalyticsDateRange,
  AnalyticsHourBuckets,
  LearningAnalyticsQuery,
  PersonalStudyAnalyticsSnapshot,
  StudySessionFact
} from '@shared/teaching-types/analytics'
import {
  buildFocusActiveRanges,
  buildPersonalStudyAnalytics,
  validatePersonalStudySnapshot
} from '@shared/learning-analytics/personal-study-source'
import type { TokenAnalytics } from '@shared/teaching-types/analytics'
import type { AnalyticsSectionResult } from '@shared/teaching-types/analytics'

const clientId = 'study-client-active-range'
const now = new Date('2026-07-13T12:00:00.000Z')

const hours = (...entries: Array<[number, number]>): AnalyticsHourBuckets => {
  const values = Array.from({ length: 24 }, () => 0)
  for (const [hour, seconds] of entries) values[hour] = seconds
  return values as unknown as AnalyticsHourBuckets
}

function range(from: string, to = from): AnalyticsDateRange {
  return {
    from,
    to,
    preset: from === to ? 'today' : 'week',
    fromInclusive: true,
    toInclusive: true,
    calendar: 'local_gregorian',
    weekStartsOn: 1
  }
}

function query(from: string, to = from): LearningAnalyticsQuery {
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

function session(overrides: Partial<StudySessionFact> = {}): StudySessionFact {
  return {
    factVersion: 1,
    factKind: 'study_session',
    id: 'session-1',
    clientId,
    timerMode: 'focus',
    outcome: 'completed',
    startedAt: '2026-07-13T01:10:00.000Z',
    endedAt: '2026-07-13T01:40:00.000Z',
    recordedAt: '2026-07-13T01:40:00.000Z',
    plannedSeconds: 1800,
    activeSeconds: 1800,
    pausedSeconds: 0,
    completedFocusSessions: 1,
    xpEarned: 30,
    context: { modeId: 'deepwork', roomId: 'deep', signalId: 'writing' },
    taskAttribution: { kind: 'unattributed', reason: 'no_task_selected' },
    daySegments: [{
      localDate: '2026-07-13',
      // Asia/Shanghai: UTC+8 => getTimezoneOffset = -480
      timezoneOffsetMinutes: -480,
      startedAt: '2026-07-13T01:10:00.000Z',
      endedAt: '2026-07-13T01:40:00.000Z',
      activeSeconds: 1800,
      pausedSeconds: 0,
      hourBuckets: hours([9, 1800])
    }],
    ...overrides
  }
}

function unavailableTokens(): AnalyticsSectionResult<TokenAnalytics> {
  return {
    state: 'unavailable',
    reason: 'history_not_recorded',
    temporal: { kind: 'range', range: range('2026-07-13') },
    coverage: {
      rangeApplied: true,
      requestedRange: range('2026-07-13'),
      effectiveRange: null,
      trackingStartedOn: null,
      dataStartDate: null,
      dataEndDate: null,
      retention: { policy: 'rolling_local_days', days: 400, includesToday: true, cutoffDate: '2025-06-09' },
      complete: false,
      sources: []
    },
    warnings: []
  }
}

describe('focus active ranges', () => {
  it('maps a single-day focus window onto hour × minute capsules', () => {
    // 01:10–01:40 UTC with offset -480 => 09:10–09:40 local
    const series = buildFocusActiveRanges([session()], range('2026-07-13'), ['2026-07-13'])
    expect(series.mode).toBe('hour_of_day')
    expect(series.yMax).toBe(60)
    expect(series.yUnit).toBe('minute')
    expect(series.categories).toHaveLength(24)
    expect(series.ranges).toEqual([
      expect.objectContaining({
        category: '9',
        start: 10,
        end: 40,
        activeSeconds: 1800
      })
    ])
  })

  it('maps multi-day focus windows onto date × hour capsules', () => {
    const dayA = session({
      id: 'session-a',
      daySegments: [{
        localDate: '2026-07-12',
        timezoneOffsetMinutes: -480,
        startedAt: '2026-07-12T02:00:00.000Z',
        endedAt: '2026-07-12T03:30:00.000Z',
        activeSeconds: 5400,
        pausedSeconds: 0,
        hourBuckets: hours([10, 3600], [11, 1800])
      }]
    })
    const dayB = session({
      id: 'session-b',
      daySegments: [{
        localDate: '2026-07-13',
        timezoneOffsetMinutes: -480,
        startedAt: '2026-07-13T10:00:00.000Z',
        endedAt: '2026-07-13T11:00:00.000Z',
        activeSeconds: 3600,
        pausedSeconds: 0,
        hourBuckets: hours([18, 3600])
      }]
    })
    const series = buildFocusActiveRanges(
      [dayA, dayB],
      range('2026-07-12', '2026-07-13'),
      ['2026-07-12', '2026-07-13']
    )
    expect(series.mode).toBe('day_of_range')
    expect(series.yMax).toBe(24)
    expect(series.yUnit).toBe('hour')
    expect(series.ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: '2026-07-12', start: 10, end: 11.5 }),
        expect.objectContaining({ category: '2026-07-13', start: 18, end: 19 })
      ])
    )
  })

  it('exposes activeRanges on FocusAnalytics for today and week presets', () => {
    const snapshot: PersonalStudyAnalyticsSnapshot = {
      version: 1,
      identity: 'snapshot-active-range',
      capturedAt: now.toISOString(),
      clientId,
      trackingStartedOn: '2026-07-12',
      facts: [session()],
      current: { xp: 120, streakDays: 2, tasks: [] }
    }
    const validation = validatePersonalStudySnapshot(snapshot, {
      clientId,
      localToday: '2026-07-13',
      now
    })
    expect(validation.state).toBe('valid')
    if (validation.state !== 'valid') throw new Error('validation failed')

    const today = buildPersonalStudyAnalytics({
      query: query('2026-07-13'),
      validation,
      generatedAt: now.toISOString(),
      tokens: unavailableTokens()
    })
    expect(today.focus.state === 'available' || today.focus.state === 'partial').toBe(true)
    if (!('data' in today.focus)) throw new Error('focus missing data')
    expect(today.focus.data.activeRanges.mode).toBe('hour_of_day')
    expect(today.focus.data.activeRanges.ranges.length).toBeGreaterThan(0)

    const week = buildPersonalStudyAnalytics({
      query: query('2026-07-07', '2026-07-13'),
      validation,
      generatedAt: now.toISOString(),
      tokens: unavailableTokens()
    })
    if (!('data' in week.focus)) throw new Error('week focus missing data')
    expect(week.focus.data.activeRanges.mode).toBe('day_of_range')
    expect(week.focus.data.activeRanges.yMax).toBe(24)
    expect(week.focus.data.activeRanges.categories).toEqual([
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
      '2026-07-13'
    ])

    // Rolling week query ends at localToday; categories match the requested window only.
    const lastSeven = buildPersonalStudyAnalytics({
      query: {
        ...query('2026-07-19', '2026-07-25'),
        calendarContext: { localToday: '2026-07-25', timeZone: 'Asia/Shanghai', weekStartsOn: 1 }
      },
      validation,
      generatedAt: now.toISOString(),
      tokens: unavailableTokens()
    })
    if (!('data' in lastSeven.focus)) throw new Error('last-seven focus missing data')
    expect(lastSeven.focus.data.activeRanges.mode).toBe('day_of_range')
    expect(lastSeven.focus.data.activeRanges.categories).toEqual([
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
      '2026-07-25'
    ])
  })
})
