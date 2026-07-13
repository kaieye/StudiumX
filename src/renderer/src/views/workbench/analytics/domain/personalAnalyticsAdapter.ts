import type {
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsHourBuckets,
  AnalyticsSectionResult,
  AnalyticsWarning,
  FocusAnalytics,
  LearningAnalyticsBundle,
  LearningAnalyticsHero,
  LearningAnalyticsQuery,
  StudyAnalyticsFact,
  StudyDailyProjection,
  StudySessionFact,
  StudyTaskActivityFact,
  TaskAnalytics
} from '../../../../../../shared/teaching-types/analytics'
import { readStudySnapshot, studyLevel, studyPlantStage } from '../../../../study-space/domain'
import {
  addLocalDays,
  countInclusiveLocalDays,
  isLocalDateInRange
} from './dateRange'
import {
  readStudyAnalyticsStoreWithDiagnostics,
  type StudyAnalyticsStoreReadDiagnostics
} from './activityLedger'

const EMPTY_HOURS = () => Array.from({ length: 24 }, () => 0)

type RangeProjection = StudyDailyProjection & { covered: boolean }

function retentionCutoff(localToday: string, days: number): string {
  return addLocalDays(localToday, -(days - 1))
}

function rangeCoverage(
  query: LearningAnalyticsQuery,
  store: ReturnType<typeof readStudyAnalyticsStoreWithDiagnostics>['store'],
  diagnostics: StudyAnalyticsStoreReadDiagnostics,
  sourceState: 'complete' | 'partial'
): AnalyticsCoverage {
  const cutoff = retentionCutoff(query.calendarContext.localToday, store.retention.days)
  const effectiveFrom = query.range.from < store.trackingStartedOn ? store.trackingStartedOn : query.range.from
  const effectiveTo = query.range.to > query.calendarContext.localToday ? query.calendarContext.localToday : query.range.to
  const effectiveRange = effectiveFrom <= effectiveTo
    ? { ...query.range, from: effectiveFrom, to: effectiveTo }
    : null
  const knownDates = store.dailyProjections.map((item) => item.date).sort()
  const coversRequestedRange = effectiveRange?.from === query.range.from && effectiveRange.to === query.range.to
  return {
    rangeApplied: true,
    requestedRange: query.range,
    effectiveRange,
    trackingStartedOn: store.trackingStartedOn,
    dataStartDate: knownDates[0] ?? null,
    dataEndDate: knownDates.at(-1) ?? null,
    retention: { policy: 'rolling_local_days', days: 400, includesToday: true, cutoffDate: cutoff },
    complete: sourceState === 'complete' && coversRequestedRange && diagnostics.invalidFactRows === 0 && !diagnostics.retentionPruned,
    sources: [{
      source: 'study_fact_store',
      state: sourceState === 'complete' && coversRequestedRange ? 'complete' : 'partial',
      scanned: store.facts.length + diagnostics.invalidFactRows,
      included: store.facts.length,
      missing: 0,
      rejected: diagnostics.invalidFactRows,
      earliestLocalDate: knownDates[0],
      latestLocalDate: knownDates.at(-1)
    }]
  }
}

function projectionsForRange(
  query: LearningAnalyticsQuery,
  store: ReturnType<typeof readStudyAnalyticsStoreWithDiagnostics>['store']
): RangeProjection[] {
  const byDate = new Map(store.dailyProjections.map((item) => [item.date, item]))
  const result: RangeProjection[] = []
  const count = countInclusiveLocalDays(query.range.from, query.range.to)
  for (let index = 0; index < count; index += 1) {
    const date = addLocalDays(query.range.from, index)
    const projection = byDate.get(date)
    const covered = date >= store.trackingStartedOn && date <= query.calendarContext.localToday
    result.push({
      ...(projection ?? {
        projectionVersion: 1,
        date,
        focusSeconds: 0,
        breakSeconds: 0,
        completedFocusSessions: 0,
        interruptedFocusSessions: 0,
        xpEarned: 0,
        modeSeconds: {},
        roomSeconds: {},
        signalSeconds: {},
        hourBuckets: EMPTY_HOURS() as unknown as AnalyticsHourBuckets,
        tasksCreated: 0,
        tasksCompleted: 0,
        tasksReopened: 0,
        tasksDeleted: 0,
        reviewAnswered: 0,
        reviewCorrect: 0,
        sourceFactCount: 0,
        rebuiltAt: store.updatedAt
      }),
      covered
    })
  }
  return result
}

function sumBy<T extends string>(rows: RangeProjection[], field: 'modeSeconds' | 'roomSeconds' | 'signalSeconds'): Array<{ id: T; seconds: number; share: number }> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    for (const [id, seconds] of Object.entries(row[field])) totals.set(id, (totals.get(id) ?? 0) + (seconds ?? 0))
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0)
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([id, seconds]) => ({ id: id as T, seconds, share: total > 0 ? seconds / total : 0 }))
}

function sessionsForClient(store: ReturnType<typeof readStudyAnalyticsStoreWithDiagnostics>['store'], query: LearningAnalyticsQuery): StudySessionFact[] {
  return store.facts.filter((fact): fact is StudySessionFact => fact.factKind === 'study_session' && fact.clientId === query.scope.personalFocus.clientId)
}

function factsInRange(facts: StudyAnalyticsFact[], query: LearningAnalyticsQuery): StudyAnalyticsFact[] {
  return facts.filter((fact) => fact.factKind === 'study_session'
    ? fact.daySegments.some((segment) => isLocalDateInRange(segment.localDate, query.range))
    : isLocalDateInRange(fact.localDate, query.range))
}

function sessionSecondsInRange(fact: StudySessionFact, range: AnalyticsDateRange): number {
  return fact.daySegments
    .filter((segment) => isLocalDateInRange(segment.localDate, range))
    .reduce((sum, segment) => sum + segment.activeSeconds, 0)
}

function sessionEndsInRange(fact: StudySessionFact, range: AnalyticsDateRange): boolean {
  const completedOn = fact.daySegments.at(-1)?.localDate
  return Boolean(completedOn && isLocalDateInRange(completedOn, range))
}

function buildFocus(query: LearningAnalyticsQuery, store: ReturnType<typeof readStudyAnalyticsStoreWithDiagnostics>['store'], diagnostics: StudyAnalyticsStoreReadDiagnostics): AnalyticsSectionResult<FocusAnalytics> {
  const rows = projectionsForRange(query, store)
  const sessions = sessionsForClient(store, query)
  const rangedSessions = sessions.filter((fact) => fact.daySegments.some((segment) => isLocalDateInRange(segment.localDate, query.range)))
  const focusSeconds = rows.reduce((sum, row) => sum + row.focusSeconds, 0)
  const breakSeconds = rows.reduce((sum, row) => sum + row.breakSeconds, 0)
  const terminalFocusSessions = rangedSessions.filter((fact) => fact.timerMode === 'focus' && sessionEndsInRange(fact, query.range))
  const completedFacts = terminalFocusSessions.filter((fact) => fact.outcome === 'completed')
  const completed = completedFacts.length
  const interrupted = terminalFocusSessions.filter((fact) => fact.outcome === 'interrupted').length
  const canceled = terminalFocusSessions.filter((fact) => fact.outcome === 'canceled').length
  const completedFocusSeconds = completedFacts.reduce((sum, fact) => sum + fact.activeSeconds, 0)
  const completeCoverage = rows.every((row) => row.covered) && diagnostics.invalidFactRows === 0 && !diagnostics.retentionPruned
  const coverage = rangeCoverage(query, store, diagnostics, completeCoverage ? 'complete' : 'partial')
  const warnings: AnalyticsWarning[] = [...diagnostics.warnings]
  if (!completeCoverage) warnings.push({ code: 'range_before_tracking_started', severity: 'info', message: '部分所选日期早于专注事实开始记录时间，未覆盖日期不会被视为零。', source: 'study_fact_store' })
  const data: FocusAnalytics = {
    daily: rows.map(({ covered, ...row }) => row),
    heatmap: rows.map((row) => ({ date: row.date, focusSeconds: row.focusSeconds, completedFocusSessions: row.completedFocusSessions, tasksCompleted: row.tasksCompleted, isCovered: row.covered })),
    trend: rows.map((row) => ({ date: row.date, focusSeconds: row.focusSeconds, completedFocusSessions: row.completedFocusSessions })),
    hourBuckets: rows.reduce((hours, row) => hours.map((value, index) => value + (row.hourBuckets[index] ?? 0)) as unknown as AnalyticsHourBuckets, EMPTY_HOURS() as unknown as AnalyticsHourBuckets),
    modeBreakdown: sumBy<'free' | 'sync' | 'deepwork' | 'exam' | `custom:${string}`>(rows, 'modeSeconds'),
    roomBreakdown: sumBy<'silent' | 'sprint' | 'deep' | 'exam' | `custom:${string}`>(rows, 'roomSeconds'),
    signalBreakdown: sumBy<'reading' | 'writing' | 'practice' | 'review' | 'exam' | `custom:${string}`>(rows, 'signalSeconds'),
    sessionStructure: {
      focusSeconds,
      breakSeconds,
      completed,
      interrupted,
      canceled,
      averageCompletedFocusSeconds: completed > 0 ? completedFocusSeconds / completed : null,
      completionRate: completed + interrupted + canceled > 0 ? completed / (completed + interrupted + canceled) : null
    },
    currentGrowth: (() => {
      const snapshot = readStudySnapshot()
      const level = studyLevel(snapshot.xp)
      return {
        xp: snapshot.xp,
        level: { level: level.level, xpAtLevelStart: snapshot.xp - level.current, xpAtNextLevel: level.next, currentXp: snapshot.xp, progress: level.progress / 100 },
        streakDays: snapshot.streakDays,
        badges: [],
        plantStage: studyPlantStage(snapshot.xp)
      }
    })()
  }
  if (rangedSessions.length === 0 && rows.some((row) => row.covered)) return { state: 'empty', data, reason: 'no_activity', temporal: { kind: 'range', range: query.range }, coverage, warnings }
  if (rangedSessions.length === 0 && !rows.some((row) => row.covered)) return { state: 'unavailable', reason: 'history_not_recorded', temporal: { kind: 'range', range: query.range }, coverage, warnings }
  return { state: completeCoverage ? 'available' : 'partial', data, temporal: { kind: 'range', range: query.range }, coverage, warnings }
}

function buildTasks(query: LearningAnalyticsQuery, store: ReturnType<typeof readStudyAnalyticsStoreWithDiagnostics>['store'], diagnostics: StudyAnalyticsStoreReadDiagnostics): AnalyticsSectionResult<TaskAnalytics> {
  const snapshot = readStudySnapshot()
  const rows = projectionsForRange(query, store)
  const activities = factsInRange(store.facts, query).filter((fact): fact is StudyTaskActivityFact => fact.factKind === 'study_activity' && fact.activity.kind.startsWith('task_'))
  const completed = activities.filter((fact) => fact.activity.kind === 'task_completed').length
  const created = activities.filter((fact) => fact.activity.kind === 'task_created').length
  const reopened = activities.filter((fact) => fact.activity.kind === 'task_reopened').length
  const deleted = activities.filter((fact) => fact.activity.kind === 'task_deleted').length
  const taskFocus = new Map<string, { title: string; seconds: number; completedInRange: boolean; currentlyDone: boolean | null }>()
  for (const fact of sessionsForClient(store, query)) {
    if (!fact.daySegments.some((segment) => isLocalDateInRange(segment.localDate, query.range)) || fact.timerMode !== 'focus') continue
    if (fact.taskAttribution.kind !== 'explicit') continue
    const attribution = fact.taskAttribution
    const current = taskFocus.get(attribution.taskId) ?? { title: attribution.taskTitleSnapshot, seconds: 0, completedInRange: false, currentlyDone: null }
    current.seconds += sessionSecondsInRange(fact, query.range)
    current.completedInRange ||= fact.outcome === 'completed' && sessionEndsInRange(fact, query.range)
    current.currentlyDone = snapshot.tasks.find((task) => task.id === attribution.taskId)?.done ?? null
    taskFocus.set(attribution.taskId, current)
  }
  const data: TaskAnalytics = {
    current: { asOf: new Date().toISOString(), total: snapshot.tasks.length, open: snapshot.tasks.filter((task) => !task.done).length, completed: snapshot.tasks.filter((task) => task.done).length, overdue: 0, completionRate: snapshot.tasks.length ? snapshot.tasks.filter((task) => task.done).length / snapshot.tasks.length : null },
    flow: { created, completed, reopened, deleted, byDay: rows.map((row) => ({ date: row.date, created: row.tasksCreated, completed: row.tasksCompleted, reopened: row.tasksReopened, deleted: row.tasksDeleted })) },
    plan: { plannedSeconds: 0, scheduledOccurrences: 0, attributedFocusSeconds: [...taskFocus.values()].reduce((sum, item) => sum + item.seconds, 0), executionRate: null },
    topByAttributedFocus: [...taskFocus.entries()].sort((left, right) => right[1].seconds - left[1].seconds).slice(0, 10).map(([taskId, item]) => ({ taskId, title: item.title, focusSeconds: item.seconds, completedInRange: item.completedInRange, currentlyDone: item.currentlyDone })),
    unattributedFocusSeconds: sessionsForClient(store, query).filter((fact) => fact.timerMode === 'focus' && fact.taskAttribution.kind === 'unattributed').reduce((sum, fact) => sum + sessionSecondsInRange(fact, query.range), 0)
  }
  const coverage = rangeCoverage(query, store, diagnostics, activities.length > 0 ? 'complete' : 'partial')
  const warnings: AnalyticsWarning[] = [...diagnostics.warnings]
  warnings.push({ code: 'schedule_history_missing', severity: 'info', message: '任务计划历史尚不可重建；计划时长与执行率保持不可用。', source: 'task_activity_facts' })
  if (data.plan.attributedFocusSeconds === 0) warnings.push({ code: 'task_attribution_missing', severity: 'info', message: '没有带显式任务归因的专注事实；计划执行率保持不可用。', source: 'task_activity_facts' })
  const temporal = { kind: 'mixed' as const, range: query.range, asOf: data.current.asOf, rangeFields: ['flow', 'plan'], rangeInvariantFields: ['current'] }
  if (!activities.length && !snapshot.tasks.length) return { state: 'empty', data, reason: 'scope_has_no_items', temporal, coverage, warnings }
  return { state: activities.length && coverage.complete ? 'available' : 'partial', data, temporal, coverage, warnings }
}

function buildHero(query: LearningAnalyticsQuery, focus: AnalyticsSectionResult<FocusAnalytics>, tasks: AnalyticsSectionResult<TaskAnalytics>, bundle: LearningAnalyticsBundle): AnalyticsSectionResult<LearningAnalyticsHero> {
  const snapshot = readStudySnapshot()
  const tokenTotal = bundle.tokens.state === 'available' || bundle.tokens.state === 'empty' || bundle.tokens.state === 'partial' ? bundle.tokens.data.totals.totalTokens : 0
  if (focus.state === 'unavailable') return { state: 'unavailable', reason: 'history_not_recorded', temporal: { kind: 'mixed', range: query.range, asOf: bundle.generatedAt, rangeFields: ['focusSeconds', 'totalTokens'], rangeInvariantFields: ['currentStreakDays', 'currentXp', 'currentLevel', 'currentTaskCompletionRate'] }, coverage: focus.coverage, warnings: focus.warnings }
  if (focus.state !== 'available' && focus.state !== 'empty' && focus.state !== 'partial') throw new Error('Focus data is unavailable.')
  const focusData = focus.data
  const taskData = tasks.state === 'available' || tasks.state === 'empty' || tasks.state === 'partial' ? tasks.data : null
  const level = studyLevel(snapshot.xp)
  const data: LearningAnalyticsHero = { focusSeconds: focusData.sessionStructure.focusSeconds, completedFocusSessions: focusData.sessionStructure.completed, currentStreakDays: snapshot.streakDays, currentXp: snapshot.xp, currentLevel: { level: level.level, xpAtLevelStart: snapshot.xp - level.current, xpAtNextLevel: level.next, currentXp: snapshot.xp, progress: level.progress / 100 }, totalTokens: tokenTotal, currentTaskCompletionRate: taskData?.current.completionRate ?? null, insightLine: '基于当前可用的本机专注与教学数据。' }
  return { state: focus.state === 'available' ? 'available' : 'partial', data, temporal: { kind: 'mixed', range: query.range, asOf: bundle.generatedAt, rangeFields: ['focusSeconds', 'totalTokens'], rangeInvariantFields: ['currentStreakDays', 'currentXp', 'currentLevel', 'currentTaskCompletionRate'] }, coverage: focus.coverage, warnings: [...focus.warnings, ...(tasks.warnings ?? [])] }
}

export function mergePersonalActivityIntoAnalyticsBundle(bundle: LearningAnalyticsBundle, query: LearningAnalyticsQuery): LearningAnalyticsBundle {
  const { store, diagnostics } = readStudyAnalyticsStoreWithDiagnostics(query.scope.personalFocus.clientId, { localToday: query.calendarContext.localToday })
  const focus = buildFocus(query, store, diagnostics)
  const tasks = buildTasks(query, store, diagnostics)
  const hero = buildHero(query, focus, tasks, bundle)
  return { ...bundle, query, hero, focus, tasks }
}

