/** Runtime validation for the consented, aggregate-only analytics chart payload. */

import type {
  AnalyticsHourBuckets,
  AnalyticsLocalDate,
  FocusActiveRangeSeries,
  FocusAnalytics,
  SyncedAnalyticsVisualizationsV1,
  TaskAnalytics
} from '@shared/teaching-types/analytics'

const MAX_POINTS = 500
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type JsonRecord = Record<string, unknown>

function record(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function number(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
}

function date(value: unknown): value is AnalyticsLocalDate {
  return typeof value === 'string' && DATE_RE.test(value)
}

function boundedArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_POINTS
}

function hourBuckets(value: unknown): AnalyticsHourBuckets | null {
  if (!Array.isArray(value) || value.length !== 24 || !value.every((entry) => number(entry))) return null
  return value as unknown as AnalyticsHourBuckets
}

function daily(value: unknown): FocusAnalytics['daily'] | null {
  if (!boundedArray(value)) return null
  const valid = value.every((entry) => record(entry)
    && entry.projectionVersion === 1
    && date(entry.date)
    && number(entry.focusSeconds)
    && number(entry.breakSeconds)
    && number(entry.completedFocusSessions)
    && number(entry.interruptedFocusSessions)
    && number(entry.xpEarned)
    && hourBuckets(entry.hourBuckets) !== null
    && number(entry.tasksCreated)
    && number(entry.tasksCompleted)
    && number(entry.tasksReopened)
    && number(entry.tasksDeleted)
    && number(entry.reviewAnswered)
    && number(entry.reviewCorrect)
    && number(entry.sourceFactCount)
    && typeof entry.rebuiltAt === 'string')
  return valid ? value as FocusAnalytics['daily'] : null
}

function heatmap(value: unknown): FocusAnalytics['heatmap'] | null {
  if (!boundedArray(value)) return null
  return value.every((entry) => record(entry)
    && date(entry.date)
    && number(entry.focusSeconds)
    && number(entry.completedFocusSessions)
    && number(entry.tasksCompleted)
    && typeof entry.isCovered === 'boolean')
    ? value as FocusAnalytics['heatmap']
    : null
}

function trend(value: unknown): FocusAnalytics['trend'] | null {
  if (!boundedArray(value)) return null
  return value.every((entry) => record(entry)
    && date(entry.date)
    && number(entry.focusSeconds)
    && number(entry.completedFocusSessions))
    ? value as FocusAnalytics['trend']
    : null
}

function activeRanges(value: unknown): FocusActiveRangeSeries | null {
  if (!record(value) || (value.mode !== 'hour_of_day' && value.mode !== 'day_of_range')) return null
  if (!Array.isArray(value.categories) || value.categories.length > MAX_POINTS || !value.categories.every((entry) => typeof entry === 'string')) return null
  if (!boundedArray(value.ranges) || !value.ranges.every((entry) => record(entry)
    && typeof entry.id === 'string'
    && typeof entry.category === 'string'
    && number(entry.start)
    && number(entry.end)
    && entry.end > entry.start
    && number(entry.activeSeconds))) return null
  if ((value.yMax !== 60 && value.yMax !== 24) || (value.yUnit !== 'minute' && value.yUnit !== 'hour')) return null
  return value as FocusActiveRangeSeries
}

function sessionStructure(value: unknown): FocusAnalytics['sessionStructure'] | null {
  if (!record(value)
    || !number(value.focusSeconds)
    || !number(value.breakSeconds)
    || !number(value.completed)
    || !number(value.interrupted)
    || !number(value.canceled)
    || (value.averageCompletedFocusSeconds !== null && !number(value.averageCompletedFocusSeconds))
    || (value.completionRate !== null && !number(value.completionRate))) return null
  return value as FocusAnalytics['sessionStructure']
}

function currentGrowth(value: unknown): FocusAnalytics['currentGrowth'] | null {
  if (!record(value) || !record(value.level) || !number(value.xp) || !number(value.streakDays)
    || typeof value.plantStage !== 'string' || !boundedArray(value.badges)) return null
  const level = value.level
  if (!number(level.level) || !number(level.xpAtLevelStart) || !number(level.xpAtNextLevel)
    || !number(level.currentXp) || !number(level.progress)) return null
  if (!value.badges.every((entry) => record(entry)
    && typeof entry.id === 'string' && typeof entry.label === 'string' && typeof entry.unlocked === 'boolean')) return null
  // `dailyXp` is intentionally absent from the remote aggregate. It is local
  // bookkeeping, not required to render the portable level visualization.
  return {
    xp: value.xp,
    level: value.level as FocusAnalytics['currentGrowth']['level'],
    streakDays: value.streakDays,
    badges: value.badges as FocusAnalytics['currentGrowth']['badges'],
    plantStage: value.plantStage
  }
}

function tasks(value: unknown): SyncedAnalyticsVisualizationsV1['tasks'] | undefined | null {
  if (value === undefined) return undefined
  if (!record(value) || !record(value.current) || !record(value.flow) || !record(value.plan)
    || !number(value.unattributedFocusSeconds)) return null
  const current = value.current
  const flow = value.flow
  const plan = value.plan
  const flowRows = flow.byDay
  if (typeof current.asOf !== 'string' || !number(current.total) || !number(current.open)
    || !number(current.completed) || !number(current.overdue)
    || (current.completionRate !== null && !number(current.completionRate))) return null
  if (!number(flow.created) || !number(flow.completed) || !number(flow.reopened) || !number(flow.deleted)
    || !boundedArray(flowRows) || !flowRows.every((entry) => record(entry)
      && date(entry.date) && number(entry.created) && number(entry.completed)
      && number(entry.reopened) && number(entry.deleted))) return null
  if (!number(plan.plannedSeconds) || !number(plan.scheduledOccurrences)
    || !number(plan.attributedFocusSeconds)
    || (plan.executionRate !== null && !number(plan.executionRate))) return null
  return value as SyncedAnalyticsVisualizationsV1['tasks']
}

/**
 * Reject malformed or non-v1 payloads instead of passing server JSON into
 * chart components. Missing payload remains supported for older desktop apps.
 */
export function parseSyncedAnalyticsVisualizations(value: unknown): SyncedAnalyticsVisualizationsV1 | null {
  if (!record(value) || value.version !== 1 || !record(value.focus)) return null
  const focus = value.focus
  const parsedDaily = daily(focus.daily)
  const parsedHeatmap = heatmap(focus.heatmap)
  const parsedTrend = trend(focus.trend)
  const parsedHours = hourBuckets(focus.hourBuckets)
  const parsedRanges = activeRanges(focus.activeRanges)
  const parsedSessions = sessionStructure(focus.sessionStructure)
  const parsedGrowth = currentGrowth(focus.currentGrowth)
  const parsedTasks = tasks(value.tasks)
  if (!parsedDaily || !parsedHeatmap || !parsedTrend || !parsedHours || !parsedRanges || !parsedSessions || !parsedGrowth || parsedTasks === null) return null
  return {
    version: 1,
    focus: {
      daily: parsedDaily,
      heatmap: parsedHeatmap,
      trend: parsedTrend,
      hourBuckets: parsedHours,
      activeRanges: parsedRanges,
      sessionStructure: parsedSessions,
      currentGrowth: parsedGrowth
    },
    ...(parsedTasks ? { tasks: parsedTasks } : {})
  }
}

/** Restore the full UI task shape while keeping labels/per-task facts local. */
export function hydratedSyncedTasks(tasks: NonNullable<SyncedAnalyticsVisualizationsV1['tasks']>): TaskAnalytics {
  return {
    ...tasks,
    topByAttributedFocus: [],
    byCategoryFocus: [],
    topByCompletion: [],
    byCategoryCompletion: []
  }
}
