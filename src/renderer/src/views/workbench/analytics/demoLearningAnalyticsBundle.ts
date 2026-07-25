import type {
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsHourBuckets,
  AnalyticsLocalDate,
  AnalyticsSectionResult,
  FocusActiveRangeSeries,
  FocusAnalytics,
  InsightsAnalytics,
  LearningAnalyticsBundle,
  LearningAnalyticsHero,
  LearningAnalyticsQuery,
  MemoryAnalytics,
  PlatformAnalytics,
  PresenceSnapshotAnalytics,
  ReviewAnalytics,
  StudyDailyProjection,
  TaskAnalytics,
  TokenAnalytics,
  WorkspaceAssetsAnalytics
} from './types'
import type { LearningAnalyticsClient } from './useStudyAnalytics'

function parseLocalDate(value: AnalyticsLocalDate): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function localDateKey(date: Date): AnalyticsLocalDate {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addLocalDays(value: AnalyticsLocalDate, amount: number): AnalyticsLocalDate {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() + amount)
  return localDateKey(date)
}

function daysInclusive(from: AnalyticsLocalDate, to: AnalyticsLocalDate): AnalyticsLocalDate[] {
  const dates: AnalyticsLocalDate[] = []
  let cursor = from
  while (cursor <= to) {
    dates.push(cursor)
    cursor = addLocalDays(cursor, 1)
  }
  return dates
}

function hashDay(date: AnalyticsLocalDate, salt = 0): number {
  let total = salt * 17
  for (let index = 0; index < date.length; index += 1) {
    total = (total * 31 + date.charCodeAt(index)) % 10_007
  }
  return total
}

function wave(date: AnalyticsLocalDate, salt: number, min: number, max: number): number {
  const seed = hashDay(date, salt)
  const weekday = (parseLocalDate(date).getDay() + 6) % 7
  const weekendFactor = weekday >= 5 ? 0.55 : 1
  const ratio = 0.35 + ((seed % 100) / 100) * 0.65
  return Math.round((min + (max - min) * ratio) * weekendFactor)
}

function emptyHours(): number[] {
  return Array.from({ length: 24 }, () => 0)
}

function hourBucketsForDay(date: AnalyticsLocalDate, focusSeconds: number): AnalyticsHourBuckets {
  const hours = emptyHours()
  if (focusSeconds <= 0) return hours as unknown as AnalyticsHourBuckets

  const weights = [
    0, 0, 0, 0, 0, 0,
    0.02, 0.05, 0.12, 0.16, 0.1, 0.05,
    0.04, 0.06, 0.1, 0.12, 0.08, 0.04,
    0.03, 0.02, 0.01, 0, 0, 0
  ]
  const jitter = hashDay(date, 3) % 5
  let remaining = focusSeconds
  for (let hour = 0; hour < 24; hour += 1) {
    const share = weights[(hour + jitter) % 24] ?? 0
    const value = Math.floor(focusSeconds * share)
    hours[hour] = value
    remaining -= value
  }
  hours[9] = (hours[9] ?? 0) + Math.max(0, remaining)
  return hours as unknown as AnalyticsHourBuckets
}

function sumHours(totals: number[]): AnalyticsHourBuckets {
  return totals as unknown as AnalyticsHourBuckets
}

function addHours(target: number[], source: AnalyticsHourBuckets): void {
  for (let hour = 0; hour < 24; hour += 1) {
    target[hour] = (target[hour] ?? 0) + (source[hour] ?? 0)
  }
}

function coverageFor(
  range: AnalyticsDateRange,
  trackingStartedOn: AnalyticsLocalDate,
  dataStartDate: AnalyticsLocalDate,
  dataEndDate: AnalyticsLocalDate
): AnalyticsCoverage {
  return {
    rangeApplied: true,
    requestedRange: range,
    effectiveRange: range,
    trackingStartedOn,
    dataStartDate,
    dataEndDate,
    retention: {
      policy: 'rolling_local_days',
      days: 400,
      includesToday: true,
      cutoffDate: trackingStartedOn
    },
    complete: true,
    sources: [
      {
        source: 'study_fact_store',
        state: 'complete',
        scanned: 128,
        included: 126,
        missing: 1,
        rejected: 1,
        earliestLocalDate: dataStartDate,
        latestLocalDate: dataEndDate
      },
      {
        source: 'agent_conversations',
        state: 'complete',
        scanned: 42,
        included: 40,
        missing: 2,
        rejected: 0,
        earliestLocalDate: dataStartDate,
        latestLocalDate: dataEndDate
      },
      {
        source: 'review_progress',
        state: 'complete',
        scanned: 18,
        included: 18,
        missing: 0,
        rejected: 0,
        earliestLocalDate: dataStartDate,
        latestLocalDate: dataEndDate
      }
    ]
  }
}

function availableSection<T>(
  query: LearningAnalyticsQuery,
  coverage: AnalyticsCoverage,
  data: T,
  temporal: AnalyticsSectionResult<T>['temporal'] = { kind: 'range', range: query.range }
): AnalyticsSectionResult<T> {
  return {
    state: 'available',
    temporal,
    coverage,
    warnings: [],
    data
  }
}

type DemoDay = {
  date: AnalyticsLocalDate
  focusSeconds: number
  completedFocusSessions: number
  breakSeconds: number
  tasksCompleted: number
  promptTokens: number
  completionTokens: number
  runs: number
  hourBuckets: AnalyticsHourBuckets
}

function buildDailySeries(range: AnalyticsDateRange): DemoDay[] {
  return daysInclusive(range.from, range.to).map((date) => {
    const focusSeconds = wave(date, 1, 1_800, 12_600)
    const completedFocusSessions = Math.max(1, Math.round(focusSeconds / 1_800))
    const breakSeconds = Math.round(focusSeconds * 0.18)
    const tasksCompleted = Math.max(0, Math.round(focusSeconds / 3_600) + (hashDay(date, 7) % 2))
    const promptTokens = wave(date, 11, 4_000, 28_000)
    const completionTokens = Math.round(promptTokens * (0.22 + (hashDay(date, 13) % 20) / 100))
    return {
      date,
      focusSeconds,
      completedFocusSessions,
      breakSeconds,
      tasksCompleted,
      promptTokens,
      completionTokens,
      runs: Math.max(1, Math.round(completedFocusSessions * 0.8)),
      hourBuckets: hourBucketsForDay(date, focusSeconds)
    }
  })
}

function buildHero(series: DemoDay[], range: AnalyticsDateRange): LearningAnalyticsHero {
  const focusSeconds = series.reduce((sum, day) => sum + day.focusSeconds, 0)
  const completedFocusSessions = series.reduce((sum, day) => sum + day.completedFocusSessions, 0)
  const totalTokens = series.reduce((sum, day) => sum + day.promptTokens + day.completionTokens, 0)
  const previousFocus = Math.round(focusSeconds * 0.78)
  const previousTokens = Math.round(totalTokens * 0.84)
  const currentXp = 4_860
  const xpAtLevelStart = 4_200
  const xpAtNextLevel = 5_400
  const span = daysInclusive(range.from, range.to).length

  return {
    focusSeconds,
    completedFocusSessions,
    currentStreakDays: 12,
    currentXp,
    currentLevel: {
      level: 18,
      xpAtLevelStart,
      xpAtNextLevel,
      currentXp,
      progress: (currentXp - xpAtLevelStart) / (xpAtNextLevel - xpAtLevelStart)
    },
    totalTokens,
    currentTaskCompletionRate: 0.72,
    focusComparison: {
      previousRange: {
        ...range,
        from: addLocalDays(range.from, -span),
        to: addLocalDays(range.from, -1)
      },
      previousValue: previousFocus,
      absoluteChange: focusSeconds - previousFocus,
      ratioChange: previousFocus === 0 ? null : (focusSeconds - previousFocus) / previousFocus
    },
    tokenComparison: {
      previousRange: {
        ...range,
        from: addLocalDays(range.from, -span),
        to: addLocalDays(range.from, -1)
      },
      previousValue: previousTokens,
      absoluteChange: totalTokens - previousTokens,
      ratioChange: previousTokens === 0 ? null : (totalTokens - previousTokens) / previousTokens
    },
    insightLine: '示例数据：多日专注节奏稳定，晚间学习块贡献突出。'
  }
}


/** X-axis categories for the active-range chart; week always expands Mon-Sun. */
function focusDemoCategories(query: LearningAnalyticsQuery, series: DemoDay[]): AnalyticsLocalDate[] {
  if (query.range.preset === 'week') {
    return Array.from({ length: 7 }, (_, index) => addLocalDays(query.range.from, index))
  }
  if (query.range.from === query.range.to) {
    return [query.range.from]
  }
  if (series.length > 0) {
    return series.map((day) => day.date)
  }
  return daysInclusive(query.range.from, query.range.to)
}

function buildDemoActiveRanges(
  series: DemoDay[],
  categories: readonly AnalyticsLocalDate[]
): FocusActiveRangeSeries {
  const singleDay = categories.length <= 1
  if (singleDay) {
    const day = series[0] ?? null
    const hourCategories = Array.from({ length: 24 }, (_, hour) => String(hour))
    if (!day || day.focusSeconds <= 0) {
      return { mode: 'hour_of_day', categories: hourCategories, ranges: [], yMax: 60, yUnit: 'minute' }
    }
    const seed = hashDay(day.date, 51)
    const ranges: FocusActiveRangeSeries['ranges'][number][] = []
    // Two floating capsules on peak study hours.
    const starts = [8 + (seed % 3), 14 + (seed % 4)]
    for (const [index, hour] of starts.entries()) {
      const duration = 18 + ((seed + index * 7) % 28)
      const start = 8 + ((seed + index * 11) % 20)
      const end = Math.min(60, start + duration)
      const activeSeconds = Math.round(day.focusSeconds * (index === 0 ? 0.42 : 0.35))
      ranges.push({
        id: `demo-h${hour}-${index}`,
        category: String(hour),
        start,
        end,
        activeSeconds
      })
    }
    return { mode: 'hour_of_day', categories: hourCategories, ranges, yMax: 60, yUnit: 'minute' }
  }

  const byDate = new Map(series.map((day) => [day.date, day]))
  const ranges = categories.flatMap((date) => {
    const day = byDate.get(date)
    if (!day || day.focusSeconds <= 0) return []
    const seed = hashDay(day.date, 61)
    // Vertical multi-hour windows so day-view capsules read as tall pills, not dashes.
    const morningStart = 8 + (seed % 2) + ((seed % 5) / 10)
    const morningEnd = Math.min(16, morningStart + 2.4 + ((seed % 6) / 5))
    const eveningStart = 17.5 + ((seed % 3) / 2)
    const eveningEnd = Math.min(23.5, eveningStart + 2.0 + ((seed % 4) / 5))
    const morningSeconds = Math.round(day.focusSeconds * 0.55)
    const eveningSeconds = Math.max(0, day.focusSeconds - morningSeconds)
    return [
      {
        id: `${day.date}-am`,
        category: day.date,
        start: morningStart,
        end: morningEnd,
        activeSeconds: morningSeconds
      },
      {
        id: `${day.date}-pm`,
        category: day.date,
        start: eveningStart,
        end: eveningEnd,
        activeSeconds: eveningSeconds
      }
    ]
  })
  return { mode: 'day_of_range', categories: [...categories], ranges, yMax: 24, yUnit: 'hour' }
}

function buildFocus(
  series: DemoDay[],
  heatmapStart: AnalyticsLocalDate,
  heatmapEnd: AnalyticsLocalDate,
  localToday: AnalyticsLocalDate,
  query: LearningAnalyticsQuery
): FocusAnalytics {
  const rangeMap = new Map(series.map((day) => [day.date, day]))
  const heatmapDates = daysInclusive(heatmapStart, heatmapEnd)
  const hourTotals = emptyHours()
  let focusSeconds = 0
  let breakSeconds = 0
  let completed = 0
  let interrupted = 0
  let canceled = 0

  const daily: StudyDailyProjection[] = series.map((day) => {
    focusSeconds += day.focusSeconds
    breakSeconds += day.breakSeconds
    completed += day.completedFocusSessions
    interrupted += hashDay(day.date, 19) % 2
    canceled += hashDay(day.date, 23) % 3 === 0 ? 1 : 0
    addHours(hourTotals, day.hourBuckets)
    return {
      projectionVersion: 1,
      date: day.date,
      focusSeconds: day.focusSeconds,
      breakSeconds: day.breakSeconds,
      completedFocusSessions: day.completedFocusSessions,
      interruptedFocusSessions: hashDay(day.date, 19) % 2,
      xpEarned: Math.round(day.focusSeconds / 60),
      hourBuckets: day.hourBuckets,
      tasksCreated: 1 + (hashDay(day.date, 29) % 2),
      tasksCompleted: day.tasksCompleted,
      tasksReopened: hashDay(day.date, 31) % 2,
      tasksDeleted: hashDay(day.date, 37) % 3 === 0 ? 1 : 0,
      reviewAnswered: 8 + (hashDay(day.date, 41) % 10),
      reviewCorrect: 6 + (hashDay(day.date, 43) % 8),
      sourceFactCount: day.completedFocusSessions + 2,
      rebuiltAt: `${day.date}T12:00:00.000Z`
    }
  })

  return {
    daily,
    heatmap: heatmapDates.map((date) => {
      const inRange = rangeMap.get(date)
      const focus = inRange?.focusSeconds ?? wave(date, 5, 0, 9_000)
      const sessions = inRange?.completedFocusSessions ?? Math.max(0, Math.round(focus / 1_800))
      const tasksCompleted = inRange?.tasksCompleted ?? Math.max(0, Math.round(focus / 3_600))
      return {
        date,
        focusSeconds: focus,
        completedFocusSessions: sessions,
        tasksCompleted,
        isCovered: date <= localToday
      }
    }),
    trend: series.map((day) => ({
      date: day.date,
      focusSeconds: day.focusSeconds,
      completedFocusSessions: day.completedFocusSessions
    })),
    hourBuckets: sumHours(hourTotals),
    activeRanges: buildDemoActiveRanges(series, focusDemoCategories(query, series)),
    sessionStructure: {
      focusSeconds,
      breakSeconds,
      completed,
      interrupted,
      canceled,
      averageCompletedFocusSeconds: completed > 0 ? Math.round(focusSeconds / completed) : null,
      completionRate: completed + interrupted + canceled > 0
        ? completed / (completed + interrupted + canceled)
        : null
    },
    currentGrowth: {
      xp: 4_860,
      level: {
        level: 18,
        xpAtLevelStart: 4_200,
        xpAtNextLevel: 5_400,
        currentXp: 4_860,
        progress: 0.55
      },
      streakDays: 12,
      badges: [
        { id: 'streak-7', label: '连续 7 天', unlocked: true },
        { id: 'deep-focus', label: '深度专注', unlocked: true },
        { id: 'night-owl', label: '夜读达人', unlocked: false }
      ],
      plantStage: 'sprout'
    }
  }
}

function buildTokens(series: DemoDay[]): TokenAnalytics {
  const totals = series.reduce(
    (acc, day) => {
      acc.promptTokens += day.promptTokens
      acc.completionTokens += day.completionTokens
      acc.totalTokens += day.promptTokens + day.completionTokens
      acc.providerCalls += day.runs
      acc.toolCalls += day.runs + (hashDay(day.date, 47) % 3)
      acc.toolErrors += hashDay(day.date, 53) % 2
      acc.iterations += day.runs * 2
      acc.childRuns += hashDay(day.date, 59) % 2
      acc.durationMs += day.focusSeconds * 12
      return acc
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      providerCalls: 0,
      toolCalls: 0,
      toolErrors: 0,
      iterations: 0,
      childRuns: 0,
      durationMs: 0,
      budgetStops: 1
    }
  )
  const lastDate = series.at(-1)?.date ?? '2026-07-25'

  return {
    totals,
    byDay: series.map((day) => ({
      date: day.date,
      promptTokens: day.promptTokens,
      completionTokens: day.completionTokens,
      totalTokens: day.promptTokens + day.completionTokens,
      runs: day.runs
    })),
    byConversation: [
      {
        conversationKey: 'ws-algo/conv-dp',
        conversationId: 'conv-dp',
        title: '动态规划精讲',
        workspaceId: 'ws-algo',
        workspaceName: '算法冲刺',
        source: 'conversation',
        promptTokens: Math.round(totals.promptTokens * 0.34),
        completionTokens: Math.round(totals.completionTokens * 0.3),
        totalTokens: Math.round(totals.totalTokens * 0.33),
        providerCalls: Math.max(1, Math.round(totals.providerCalls * 0.3)),
        toolCalls: Math.max(1, Math.round(totals.toolCalls * 0.28)),
        toolErrors: 1,
        messageCount: 48,
        durationMs: Math.round(totals.durationMs * 0.3),
        updatedAt: `${lastDate}T18:20:00.000Z`
      },
      {
        conversationKey: 'ws-eng/conv-essay',
        conversationId: 'conv-essay',
        title: '英语写作批改',
        workspaceId: 'ws-eng',
        workspaceName: '英语写作',
        source: 'conversation',
        promptTokens: Math.round(totals.promptTokens * 0.26),
        completionTokens: Math.round(totals.completionTokens * 0.28),
        totalTokens: Math.round(totals.totalTokens * 0.27),
        providerCalls: Math.max(1, Math.round(totals.providerCalls * 0.25)),
        toolCalls: Math.max(1, Math.round(totals.toolCalls * 0.22)),
        toolErrors: 0,
        messageCount: 36,
        durationMs: Math.round(totals.durationMs * 0.24),
        updatedAt: `${lastDate}T16:05:00.000Z`
      },
      {
        conversationKey: 'ws-sys/conv-os',
        conversationId: 'conv-os',
        title: '操作系统复盘',
        workspaceId: 'ws-sys',
        workspaceName: '系统课',
        source: 'ledger_fallback',
        promptTokens: Math.round(totals.promptTokens * 0.2),
        completionTokens: Math.round(totals.completionTokens * 0.22),
        totalTokens: Math.round(totals.totalTokens * 0.21),
        providerCalls: Math.max(1, Math.round(totals.providerCalls * 0.2)),
        toolCalls: Math.max(1, Math.round(totals.toolCalls * 0.2)),
        toolErrors: 1,
        messageCount: 28,
        durationMs: Math.round(totals.durationMs * 0.2),
        updatedAt: `${lastDate}T11:40:00.000Z`
      }
    ],
    byWorkspace: [
      { workspaceId: 'ws-algo', name: '算法冲刺', totalTokens: Math.round(totals.totalTokens * 0.38), conversationCount: 8 },
      { workspaceId: 'ws-eng', name: '英语写作', totalTokens: Math.round(totals.totalTokens * 0.27), conversationCount: 5 },
      { workspaceId: 'ws-sys', name: '系统课', totalTokens: Math.round(totals.totalTokens * 0.21), conversationCount: 4 },
      { workspaceId: 'ws-math', name: '高数刷题', totalTokens: Math.round(totals.totalTokens * 0.14), conversationCount: 3 }
    ],
    byTool: [
      { name: 'read_file', calls: Math.max(8, Math.round(totals.toolCalls * 0.34)), errors: 0 },
      { name: 'search_workspace', calls: Math.max(5, Math.round(totals.toolCalls * 0.24)), errors: 1 },
      { name: 'write_notes', calls: Math.max(4, Math.round(totals.toolCalls * 0.18)), errors: 0 },
      { name: 'quiz_generator', calls: Math.max(3, Math.round(totals.toolCalls * 0.14)), errors: 1 },
      { name: 'memory_lookup', calls: Math.max(2, Math.round(totals.toolCalls * 0.1)), errors: 0 }
    ],
    efficiency: {
      averageTokensPerUsageFact: Math.round(totals.totalTokens / Math.max(1, totals.providerCalls)),
      averageTokensPerConversation: Math.round(totals.totalTokens / 3),
      averageTokensPerMessage: Math.round(totals.totalTokens / 112),
      averageDurationMs: Math.round(totals.durationMs / Math.max(1, totals.providerCalls)),
      toolErrorRate: totals.toolCalls > 0 ? totals.toolErrors / totals.toolCalls : 0
    },
    contextGovernance: {
      compactionEvents: 6,
      replacedTokens: 18_400,
      hygieneSavedTokens: 9_200,
      childRunShare: totals.providerCalls > 0 ? totals.childRuns / totals.providerCalls : 0
    },
    sourceCoverage: {
      conversationsScanned: 42,
      conversationsReadable: 40,
      conversationsWithUsage: 38,
      conversationsPartiallyMissingUsage: 2,
      ledgerSnapshotsScanned: 12,
      ledgerFallbackConversations: 2,
      invalidLedgerRows: 0
    }
  }
}

function buildTasks(series: DemoDay[], asOf: string): TaskAnalytics {
  const created = series.reduce((sum, day) => sum + 1 + (hashDay(day.date, 29) % 2), 0)
  const completed = series.reduce((sum, day) => sum + day.tasksCompleted, 0)
  const reopened = series.reduce((sum, day) => sum + (hashDay(day.date, 31) % 2), 0)
  const deleted = series.reduce((sum, day) => sum + (hashDay(day.date, 37) % 3 === 0 ? 1 : 0), 0)
  const attributedFocusSeconds = Math.round(
    series.reduce((sum, day) => sum + day.focusSeconds, 0) * 0.82
  )
  const plannedSeconds = Math.round(attributedFocusSeconds * 1.12)

  return {
    current: {
      asOf,
      total: 18,
      open: 5,
      completed: 13,
      overdue: 2,
      completionRate: 13 / 18
    },
    flow: {
      created,
      completed,
      reopened,
      deleted,
      byDay: series.map((day) => ({
        date: day.date,
        created: 1 + (hashDay(day.date, 29) % 2),
        completed: day.tasksCompleted,
        reopened: hashDay(day.date, 31) % 2,
        deleted: hashDay(day.date, 37) % 3 === 0 ? 1 : 0
      }))
    },
    plan: {
      plannedSeconds,
      scheduledOccurrences: Math.max(series.length * 2, 8),
      attributedFocusSeconds,
      executionRate: plannedSeconds > 0 ? attributedFocusSeconds / plannedSeconds : null
    },
    topByAttributedFocus: [
      { taskId: 'task-dp', title: '动态规划专题', focusSeconds: Math.round(attributedFocusSeconds * 0.28), completedInRange: true, currentlyDone: false, categoryId: 'cat-algo', categoryName: '算法' },
      { taskId: 'task-essay', title: '英语议论文改写', focusSeconds: Math.round(attributedFocusSeconds * 0.2), completedInRange: true, currentlyDone: true, categoryId: 'cat-lang', categoryName: '语言' },
      { taskId: 'task-os', title: '进程调度笔记', focusSeconds: Math.round(attributedFocusSeconds * 0.16), completedInRange: false, currentlyDone: false, categoryId: 'cat-sys', categoryName: '系统' },
      { taskId: 'task-math', title: '高数错题复盘', focusSeconds: Math.round(attributedFocusSeconds * 0.14), completedInRange: true, currentlyDone: true, categoryId: 'cat-math', categoryName: '数学' },
      { taskId: 'task-reading', title: '论文精读', focusSeconds: Math.round(attributedFocusSeconds * 0.12), completedInRange: false, currentlyDone: false, categoryId: 'cat-research', categoryName: '研究' }
    ],
    byCategoryFocus: [
      { categoryId: 'cat-algo', label: '算法', focusSeconds: Math.round(attributedFocusSeconds * 0.34) },
      { categoryId: 'cat-lang', label: '语言', focusSeconds: Math.round(attributedFocusSeconds * 0.22) },
      { categoryId: 'cat-sys', label: '系统', focusSeconds: Math.round(attributedFocusSeconds * 0.18) },
      { categoryId: 'cat-math', label: '数学', focusSeconds: Math.round(attributedFocusSeconds * 0.15) },
      { categoryId: 'uncategorized', label: '未分类', focusSeconds: Math.round(attributedFocusSeconds * 0.11) }
    ],
    topByCompletion: [
      { taskId: 'task-dp', title: '动态规划专题', completionCount: 9, categoryId: 'cat-algo', categoryName: '算法' },
      { taskId: 'task-essay', title: '英语议论文改写', completionCount: 7, categoryId: 'cat-lang', categoryName: '语言' },
      { taskId: 'task-math', title: '高数错题复盘', completionCount: 6, categoryId: 'cat-math', categoryName: '数学' },
      { taskId: 'task-os', title: '进程调度笔记', completionCount: 4, categoryId: 'cat-sys', categoryName: '系统' }
    ],
    byCategoryCompletion: [
      { categoryId: 'cat-algo', label: '算法', completionCount: 12 },
      { categoryId: 'cat-lang', label: '语言', completionCount: 9 },
      { categoryId: 'cat-math', label: '数学', completionCount: 7 },
      { categoryId: 'cat-sys', label: '系统', completionCount: 5 },
      { categoryId: 'uncategorized', label: '未分类', completionCount: 3 }
    ],
    unattributedFocusSeconds: Math.round(series.reduce((sum, day) => sum + day.focusSeconds, 0) * 0.18)
  }
}

function buildReview(series: DemoDay[]): ReviewAnalytics {
  const answered = series.reduce((sum, day) => sum + 8 + (hashDay(day.date, 41) % 10), 0)
  const correct = series.reduce((sum, day) => sum + 6 + (hashDay(day.date, 43) % 8), 0)
  const accuracy = answered > 0 ? Math.min(0.98, correct / answered) : null

  return {
    cumulative: {
      totalAnswered: Math.max(answered, 186),
      correct: Math.max(correct, 152),
      accuracy: Math.max(accuracy ?? 0, 0.82),
      cardCount: 248
    },
    range: {
      answered,
      correct,
      accuracy
    },
    byLesson: [
      { lessonId: 'lesson-dp-1', title: '背包问题入门', answered: 42, correct: 37, accuracy: 37 / 42, reviewCardCount: 28 },
      { lessonId: 'lesson-os-2', title: '虚拟内存', answered: 36, correct: 29, accuracy: 29 / 36, reviewCardCount: 24 },
      { lessonId: 'lesson-eng-3', title: '议论文结构', answered: 31, correct: 27, accuracy: 27 / 31, reviewCardCount: 20 },
      { lessonId: 'lesson-math-4', title: '多元函数极值', answered: 28, correct: 21, accuracy: 21 / 28, reviewCardCount: 22 },
      { lessonId: 'lesson-net-5', title: 'TCP 握手', answered: 24, correct: 20, accuracy: 20 / 24, reviewCardCount: 16 },
      { lessonId: 'lesson-db-6', title: '事务隔离级别', answered: 22, correct: 17, accuracy: 17 / 22, reviewCardCount: 18 }
    ]
  }
}

function buildWorkspaceAssets(asOf: string): WorkspaceAssetsAnalytics {
  return {
    counts: {
      workspaces: 4,
      courses: 9,
      sessions: 26,
      lessons: 48,
      resources: 73,
      learningRecords: 112,
      references: 35,
      conversations: 42
    },
    courses: [
      { workspaceId: 'ws-algo', courseId: 'course-dp', name: '算法冲刺 · DP', sessionCount: 8, lessonCount: 14, conversationCount: 12, pinned: true, updatedAt: asOf },
      { workspaceId: 'ws-eng', courseId: 'course-essay', name: '英语写作营', sessionCount: 5, lessonCount: 10, conversationCount: 8, pinned: true, updatedAt: asOf },
      { workspaceId: 'ws-sys', courseId: 'course-os', name: '操作系统', sessionCount: 7, lessonCount: 12, conversationCount: 9, pinned: false, updatedAt: asOf }
    ],
    recentLessons: [
      { workspaceId: 'ws-algo', lessonId: 'lesson-dp-1', title: '背包问题入门', courseName: '算法冲刺 · DP', createdAt: asOf, durationMinutes: 35 },
      { workspaceId: 'ws-sys', lessonId: 'lesson-os-2', title: '虚拟内存', courseName: '操作系统', createdAt: asOf, durationMinutes: 40 },
      { workspaceId: 'ws-eng', lessonId: 'lesson-eng-3', title: '议论文结构', courseName: '英语写作营', createdAt: asOf, durationMinutes: 30 }
    ],
    missionHealth: [
      { workspaceId: 'ws-algo', hasMission: true, title: '两周内完成 DP 专题', excerptLength: 86, updatedAt: asOf },
      { workspaceId: 'ws-eng', hasMission: true, title: '每周两篇议论文', excerptLength: 64, updatedAt: asOf },
      { workspaceId: 'ws-sys', hasMission: false, title: '', excerptLength: 0 }
    ]
  }
}

function buildMemory(): MemoryAnalytics {
  return {
    activeCount: 36,
    tombstoneCount: 4,
    byScope: [
      { scope: 'user', count: 14 },
      { scope: 'workspace', count: 16 },
      { scope: 'project', count: 6 }
    ],
    topTags: [
      { tag: '算法', count: 12 },
      { tag: '复习', count: 9 },
      { tag: '写作', count: 7 },
      { tag: '系统', count: 6 },
      { tag: '错题', count: 5 },
      { tag: '模板', count: 4 }
    ],
    confidenceBuckets: [
      { fromInclusive: 0, toInclusive: 0.4, count: 5 },
      { fromInclusive: 0.4, toInclusive: 0.7, count: 14 },
      { fromInclusive: 0.7, toInclusive: 1, count: 17 }
    ],
    recentlyUpdated: [
      { id: 'mem-1', scope: 'workspace', tags: ['算法', '模板'], confidence: 0.86, updatedAt: '2026-07-24T10:00:00.000Z' },
      { id: 'mem-2', scope: 'user', tags: ['复习'], confidence: 0.74, updatedAt: '2026-07-23T18:20:00.000Z' },
      { id: 'mem-3', scope: 'project', tags: ['写作'], confidence: 0.69, updatedAt: '2026-07-22T09:15:00.000Z' }
    ]
  }
}

function buildPlatform(series: DemoDay[]): PlatformAnalytics {
  return {
    skills: {
      installed: 14,
      byCategory: [
        { category: '学习辅助', count: 5 },
        { category: '写作润色', count: 3 },
        { category: '代码讲解', count: 4 },
        { category: '复习卡片', count: 2 }
      ],
      usedInRange: Math.max(4, Math.round(series.length * 0.6))
    },
    pet: {
      appearanceId: 'sprout-default',
      plantStage: 'sprout'
    },
    model: {
      providerLabel: 'OpenAI Compatible',
      modelLabel: 'demo-model-pro',
      lessonRunsInRange: Math.max(3, Math.round(series.length * 0.4)),
      failedLessonRunsInRange: 1
    },
    workspaceChanges: {
      changesInRange: series.length + 4,
      byDay: series.map((day) => ({
        date: day.date,
        count: 1 + (hashDay(day.date, 61) % 3)
      }))
    },
    connectors: [
      { id: 'local-files', configured: true, usedInRange: 12 },
      { id: 'web-search', configured: true, usedInRange: 5 },
      { id: 'calendar', configured: false, usedInRange: null }
    ]
  }
}

function buildPresence(asOf: string, spaceCode: string | null | undefined): PresenceSnapshotAnalytics {
  return {
    capturedAt: asOf,
    spaceCode: spaceCode || 'demo-space',
    online: 18,
    roomCapacityPercent: 0.62,
    peerFocusSecondsToday: 46_800,
    selfPercentile: 0.78,
    eventCounts: {
      checkin: 12,
      focus_start: 27,
      task_done: 19,
      cheer: 8
    }
  }
}

function buildInsights(): InsightsAnalytics {
  return {
    items: [
      {
        id: 'insight-1',
        kind: 'observation',
        text: '近几日晚间 20–22 点专注时长最高。',
        explanation: '小时分布显示晚间学习块最稳定，可作为固定深度工作窗口。',
        evidenceSectionIds: ['focus']
      },
      {
        id: 'insight-2',
        kind: 'action',
        text: '把未分类任务归到「算法 / 语言」类目。',
        explanation: '仍有约 11% 的专注时长未分类，归类后任务贡献会更清晰。',
        evidenceSectionIds: ['tasks']
      },
      {
        id: 'insight-3',
        kind: 'warning',
        text: '工具错误率略高于平时。',
        explanation: '示例数据中 search / quiz 工具有少量失败，可检查相关技能配置。',
        evidenceSectionIds: ['tokens']
      }
    ]
  }
}

/**
 * Build a dense, multi-day Learning Analytics bundle for UI demos.
 * Deterministic for a given query so refreshes stay stable.
 */
export function createDemoLearningAnalyticsBundle(query: LearningAnalyticsQuery): LearningAnalyticsBundle {
  const range = query.range
  const localToday = query.calendarContext.localToday
  const asOf = `${localToday}T12:00:00.000Z`
  const trackingStartedOn = addLocalDays(localToday, -119)
  // Clamp open-ended / sentinel ranges to tracked demo history so "all" stays dense but finite.
  const seriesFrom = range.from < trackingStartedOn ? trackingStartedOn : range.from
  const seriesTo = range.to > localToday ? localToday : range.to
  const seriesRange: AnalyticsDateRange = {
    ...range,
    from: seriesFrom <= seriesTo ? seriesFrom : trackingStartedOn,
    to: seriesFrom <= seriesTo ? seriesTo : localToday
  }
  const series = buildDailySeries(seriesRange)
  // Fixed 365-day calendar independent of the selected range preset.
  const heatmapStart = addLocalDays(localToday, -364)
  const heatmapEnd = localToday
  const dataStartDate = series[0]?.date ?? seriesRange.from
  const dataEndDate = series.at(-1)?.date ?? seriesRange.to
  const coverage = coverageFor(range, trackingStartedOn, dataStartDate, dataEndDate)
  const mixedTemporal = {
    kind: 'mixed' as const,
    range,
    asOf,
    rangeFields: ['flow', 'plan', 'topByAttributedFocus', 'byCategoryFocus'],
    rangeInvariantFields: ['current']
  }
  const presenceSpaceCode = query.scope.presence.kind === 'live_space'
    ? query.scope.presence.spaceCode
    : null

  return {
    contractVersion: 1,
    generatedAt: asOf,
    query,
    hero: availableSection(query, coverage, buildHero(series, range)),
    focus: availableSection(query, coverage, buildFocus(series, heatmapStart, heatmapEnd, localToday, query)),
    tasks: availableSection(query, coverage, buildTasks(series, asOf), mixedTemporal),
    tokens: availableSection(query, coverage, buildTokens(series)),
    workspaceAssets: availableSection(
      query,
      coverage,
      buildWorkspaceAssets(asOf),
      { kind: 'as_of', asOf, rangeInvariant: true }
    ),
    review: availableSection(
      query,
      coverage,
      buildReview(series),
      {
        kind: 'mixed',
        range,
        asOf,
        rangeFields: ['range', 'byLesson'],
        rangeInvariantFields: ['cumulative']
      }
    ),
    memory: availableSection(
      query,
      coverage,
      buildMemory(),
      { kind: 'as_of', asOf, rangeInvariant: true }
    ),
    platform: availableSection(
      query,
      coverage,
      buildPlatform(series),
      {
        kind: 'mixed',
        range,
        asOf,
        rangeFields: ['skills.usedInRange', 'model.lessonRunsInRange', 'workspaceChanges'],
        rangeInvariantFields: ['skills.installed', 'pet', 'model.providerLabel', 'model.modelLabel']
      }
    ),
    presence: availableSection(
      query,
      {
        ...coverage,
        rangeApplied: false,
        effectiveRange: null
      },
      buildPresence(asOf, presenceSpaceCode),
      {
        kind: 'live_snapshot',
        capturedAt: asOf,
        rangeInvariant: true,
        staleAfterSeconds: 120
      }
    ),
    insights: availableSection(query, coverage, buildInsights())
  }
}

export const demoLearningAnalyticsClient: LearningAnalyticsClient = {
  async getLearningAnalytics(query, _signal) {
    return createDemoLearningAnalyticsBundle(query)
  },
  async refreshLearningAnalyticsSections(query, _sectionIds, _signal) {
    return createDemoLearningAnalyticsBundle(query)
  }
}
