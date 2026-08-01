import { describe, expect, it } from 'vitest'
import type { LearningAnalyticsBundle } from '../../src/shared/teaching-types/analytics'
import { buildAnalyticsVisualizationSummary } from '../../src/renderer/src/sync/analytics-visualization-sync'
import {
  hydratedSyncedTasks,
  parseSyncedAnalyticsVisualizations
} from '../../web/src/adapter/features/analytics-payload'

const focus = {
  daily: [{
    projectionVersion: 1,
    date: '2026-08-01',
    focusSeconds: 1800,
    breakSeconds: 300,
    completedFocusSessions: 1,
    interruptedFocusSessions: 0,
    xpEarned: 10,
    hourBuckets: Array.from({ length: 24 }, (_, index) => index === 9 ? 1800 : 0),
    tasksCreated: 1,
    tasksCompleted: 1,
    tasksReopened: 0,
    tasksDeleted: 0,
    reviewAnswered: 0,
    reviewCorrect: 0,
    sourceFactCount: 2,
    rebuiltAt: '2026-08-01T10:00:00.000Z'
  }],
  heatmap: [{ date: '2026-08-01', focusSeconds: 1800, completedFocusSessions: 1, tasksCompleted: 1, isCovered: true }],
  trend: [{ date: '2026-08-01', focusSeconds: 1800, completedFocusSessions: 1 }],
  hourBuckets: Array.from({ length: 24 }, (_, index) => index === 9 ? 1800 : 0),
  activeRanges: {
    mode: 'hour_of_day',
    categories: ['9'],
    ranges: [{ id: 'aggregate-9', category: '9', start: 0, end: 30, activeSeconds: 1800 }],
    yMax: 60,
    yUnit: 'minute'
  },
  sessionStructure: {
    focusSeconds: 1800,
    breakSeconds: 300,
    completed: 1,
    interrupted: 0,
    canceled: 0,
    averageCompletedFocusSeconds: 1800,
    completionRate: 1
  },
  currentGrowth: {
    xp: 100,
    level: { level: 2, xpAtLevelStart: 50, xpAtNextLevel: 150, currentXp: 100, progress: 0.5 },
    streakDays: 3,
    badges: [{ id: 'first-focus', label: '首次专注', unlocked: true }],
    plantStage: 'sprout',
    dailyXp: { date: '2026-08-01', earnedXp: 10, capXp: 100, remainingXp: 90 }
  }
}

const tasks = {
  current: { asOf: '2026-08-01T10:00:00.000Z', total: 2, open: 1, completed: 1, overdue: 0, completionRate: 0.5 },
  flow: { created: 1, completed: 1, reopened: 0, deleted: 0, byDay: [{ date: '2026-08-01', created: 1, completed: 1, reopened: 0, deleted: 0 }] },
  plan: { plannedSeconds: 1800, scheduledOccurrences: 1, attributedFocusSeconds: 1800, executionRate: 1 },
  unattributedFocusSeconds: 0,
  // These label-bearing fields must not cross the consented analytics seam.
  topByAttributedFocus: [{ title: 'private task title' }],
  byCategoryFocus: [{ label: 'private category' }]
}

const bundle = {
  query: {
    range: { preset: 'week', from: '2026-07-26', to: '2026-08-01' }
  },
  hero: { state: 'available', data: { focusSeconds: 1800, completedFocusSessions: 1 } },
  focus: { state: 'available', data: focus },
  tasks: { state: 'available', data: tasks }
} as unknown as LearningAnalyticsBundle

describe('analytics visualization sync payload', () => {
  it('uploads chart aggregates but excludes labels and other per-task facts', () => {
    const summary = buildAnalyticsVisualizationSummary(bundle)

    expect(summary).toMatchObject({
      rangeKey: 'sevenDays',
      focusSeconds: 1800,
      plannedFocusSeconds: 1800,
      completedFocusSessions: 1,
      periodStartDate: '2026-07-26',
      periodEndDate: '2026-08-01',
      payload: { version: 1, focus: { trend: focus.trend } }
    })
    expect(summary?.payload?.tasks).toEqual({
      current: tasks.current,
      flow: tasks.flow,
      plan: tasks.plan,
      unattributedFocusSeconds: 0
    })
    expect(JSON.stringify(summary)).not.toContain('private task title')
    expect(JSON.stringify(summary)).not.toContain('private category')
    expect(summary?.payload?.focus.currentGrowth).not.toHaveProperty('dailyXp')
  })

  it('validates the v1 payload before a web chart receives it', () => {
    const summary = buildAnalyticsVisualizationSummary(bundle)
    const parsed = parseSyncedAnalyticsVisualizations(summary?.payload)

    expect(parsed?.focus.daily).toHaveLength(1)
    expect(hydratedSyncedTasks(parsed!.tasks!).topByAttributedFocus).toEqual([])
    expect(parseSyncedAnalyticsVisualizations({ version: 1, focus: { hourBuckets: [] } })).toBeNull()
  })
})
