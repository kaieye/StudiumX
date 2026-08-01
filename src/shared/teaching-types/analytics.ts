/**
 * Shared data contract for the Learning Analytics page.
 *
 * This module is intentionally renderer-agnostic. Main, preload, and renderer code
 * may depend on it; it must not import types from `src/renderer`.
 */
import type { DailyXpProgress, DailyXpSummary } from '../study-progression'

/** A Gregorian local-calendar date serialized exactly as `YYYY-MM-DD`. */
export type AnalyticsLocalDate = string

/** An absolute timestamp serialized as an ISO-8601 instant (normally UTC with `Z`). */
export type AnalyticsInstant = string

export type AnalyticsRangePreset = 'today' | 'week' | 'month' | 'all' | 'custom'

/**
 * All date ranges include both boundary dates.
 * `week` means the last 7 local days ending today; `month` means the last 30 local days ending today.
 * Historical study facts are matched by their captured local date, not by UTC date.
 */
export type AnalyticsDateRange = {
  from: AnalyticsLocalDate
  to: AnalyticsLocalDate
  preset: AnalyticsRangePreset
  fromInclusive: true
  toInclusive: true
  calendar: 'local_gregorian'
  weekStartsOn: 1
}

export type PersonalFocusAnalyticsScope =
  | {
      kind: 'personal'
      /** Local learner/client identity. Personal focus never includes presence peers. */
      clientId: string
    }
  | {
      /** A legacy/non-personal query. Personal-study payloads must be ignored. */
      kind: 'none'
    }

export type TeachingAnalyticsScope =
  | { kind: 'none' }
  | {
      kind: 'workspace'
      workspaceId: string
      /** Display-only name captured when the query is resolved. */
      workspaceName?: string
    }
  | {
      kind: 'all_workspaces'
      /** The concrete workspace set scanned for this response. */
      workspaceIds: string[]
    }

export type PresenceAnalyticsScope =
  | { kind: 'none' }
  | {
      kind: 'live_space'
      spaceCode: string
    }

/**
 * The three domains are deliberately independent. A teaching-workspace filter must
 * not filter personal focus facts, and a date range must not fabricate presence history.
 */
export type LearningAnalyticsScope = {
  personalFocus: PersonalFocusAnalyticsScope
  teaching: TeachingAnalyticsScope
  presence: PresenceAnalyticsScope
}

export type LearningAnalyticsQuery = {
  range: AnalyticsDateRange
  scope: LearningAnalyticsScope
  calendarContext: {
    /** Local date at query construction; preset ranges must end on or before this date. */
    localToday: AnalyticsLocalDate
    /** IANA zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
    timeZone: string
    weekStartsOn: 1
  }
}

export type AnalyticsTemporalBasis =
  | {
      kind: 'range'
      range: AnalyticsDateRange
    }
  | {
      kind: 'as_of'
      /** Current-state metric; the selected date range is intentionally ignored. */
      asOf: AnalyticsInstant
      rangeInvariant: true
    }
  | {
      kind: 'live_snapshot'
      /** Presence is a current read-only snapshot, never a historical time series. */
      capturedAt: AnalyticsInstant
      rangeInvariant: true
      staleAfterSeconds: number
    }
  | {
      kind: 'mixed'
      /** Section contains both range-filtered and current-state fields. */
      range: AnalyticsDateRange
      asOf: AnalyticsInstant
      rangeFields: string[]
      rangeInvariantFields: string[]
    }

export type AnalyticsDataState = 'available' | 'empty' | 'partial' | 'unavailable' | 'error'

export type AnalyticsWarningSeverity = 'info' | 'warning'

export type AnalyticsWarningCode =
  | 'range_before_tracking_started'
  | 'range_before_retention_window'
  | 'legacy_aggregate_not_backfillable'
  | 'legacy_utc_date_semantics'
  | 'facts_recovered_with_invalid_rows'
  | 'source_scan_incomplete'
  | 'source_not_configured'
  | 'source_permission_denied'
  | 'source_timezone_inferred'
  | 'conversation_usage_missing'
  | 'conversation_usage_partially_missing'
  | 'ledger_fallback_used'
  | 'ledger_rows_invalid'
  | 'token_components_missing'
  | 'token_total_inconsistent'
  | 'task_history_missing'
  | 'task_attribution_missing'
  | 'schedule_history_missing'
  | 'review_history_missing'
  | 'presence_stale'
  | 'retention_pruned'
  | 'custom'

export type AnalyticsWarning = {
  code: AnalyticsWarningCode
  severity: AnalyticsWarningSeverity
  /** Sanitized user-facing text; must not contain secrets or raw source content. */
  message: string
  source?: AnalyticsSourceId
  /** Optional structured counts/identifiers safe to expose to the renderer. */
  details?: Record<string, string | number | boolean | null>
}

export type AnalyticsSourceId =
  | 'study_snapshot'
  | 'study_fact_store'
  | 'study_daily_projection'
  | 'task_snapshot'
  | 'task_activity_facts'
  | 'agent_conversations'
  | 'learning_work_ledger'
  | 'workspace_catalog'
  | 'review_progress'
  | 'review_cards'
  | 'memory_store'
  | 'skill_catalog'
  | 'settings'
  | 'workspace_change_history'
  | 'presence'
  | `custom:${string}`

export type AnalyticsSourceCoverage = {
  source: AnalyticsSourceId
  state: 'complete' | 'partial' | 'unavailable' | 'error'
  /** Number of source records inspected, when meaningful. */
  scanned: number
  /** Number of records accepted into the result. */
  included: number
  /** Known records with missing fields that prevented full inclusion. */
  missing: number
  /** Malformed, duplicate, or otherwise rejected records. */
  rejected: number
  earliestLocalDate?: AnalyticsLocalDate
  latestLocalDate?: AnalyticsLocalDate
}

export type AnalyticsRetentionCoverage = {
  policy: 'rolling_local_days'
  /** Frozen policy value. Analytics-owned history retains 400 local dates. */
  days: 400
  includesToday: true
  /** Oldest local date eligible for retention for this response. */
  cutoffDate: AnalyticsLocalDate
}

export type AnalyticsCoverage = {
  /** Whether the selected range was actually applied to this dataset. */
  rangeApplied: boolean
  requestedRange: AnalyticsDateRange
  /** Requested range clipped to tracking/retention/source availability, if any. */
  effectiveRange: AnalyticsDateRange | null
  /** First local date on which fact logging was enabled; days after it may be true zeroes. */
  trackingStartedOn: AnalyticsLocalDate | null
  /** Earliest retained local date containing at least one accepted fact, if any. */
  dataStartDate: AnalyticsLocalDate | null
  /** Latest retained local date containing at least one accepted fact, if any. */
  dataEndDate: AnalyticsLocalDate | null
  retention: AnalyticsRetentionCoverage
  complete: boolean
  sources: AnalyticsSourceCoverage[]
}

export type AnalyticsEmptyReason =
  | 'no_activity'
  | 'no_matching_records'
  | 'not_started'
  | 'scope_has_no_items'

export type AnalyticsUnavailableReason =
  | 'not_applicable'
  | 'not_configured'
  | 'no_active_workspace'
  | 'permission_denied'
  | 'history_not_recorded'
  | 'source_missing'
  | 'unsupported'

export type AnalyticsError = {
  code: string
  /** Sanitized message only; no absolute paths, source content, keys, or endpoints. */
  message: string
  retryable: boolean
}

type AnalyticsResultBase = {
  temporal: AnalyticsTemporalBasis
  coverage: AnalyticsCoverage
  warnings: AnalyticsWarning[]
}

/**
 * Standard state envelope for every page section.
 * `empty` means a successful, complete scan with a legitimate zero result.
 * `partial` means usable data with known omissions. `unavailable` is expected lack
 * of applicability/access; `error` is an attempted operation that failed.
 */
export type AnalyticsSectionResult<T> =
  | (AnalyticsResultBase & { state: 'available'; data: T })
  | (AnalyticsResultBase & { state: 'empty'; data: T; reason: AnalyticsEmptyReason })
  | (AnalyticsResultBase & { state: 'partial'; data: T })
  | (AnalyticsResultBase & { state: 'unavailable'; reason: AnalyticsUnavailableReason })
  | (AnalyticsResultBase & { state: 'error'; error: AnalyticsError })

export type StudyAnalyticsModeId = 'free' | 'sync' | 'deepwork' | 'exam' | `custom:${string}`
export type StudyAnalyticsRoomId = 'silent' | 'sprint' | 'deep' | 'exam' | `custom:${string}`
export type StudyAnalyticsSignalId = 'reading' | 'writing' | 'practice' | 'review' | 'exam' | `custom:${string}`

/** Monday is 0 and Sunday is 6, matching the current task schedule UI. */
export type AnalyticsWeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Exactly 24 local-hour buckets, each measured in active seconds. */
export type AnalyticsHourBuckets = readonly [
  number, number, number, number, number, number,
  number, number, number, number, number, number,
  number, number, number, number, number, number,
  number, number, number, number, number, number
]

export type StudySessionDaySegment = {
  localDate: AnalyticsLocalDate
  /** `Date#getTimezoneOffset()` semantics for the segment; preserves travel/DST history. */
  timezoneOffsetMinutes: number
  startedAt: AnalyticsInstant
  endedAt: AnalyticsInstant
  activeSeconds: number
  pausedSeconds: number
  hourBuckets: AnalyticsHourBuckets
}

export type StudyTaskAttribution =
  | {
      kind: 'explicit'
      /** Captured when the focus session starts; never inferred from title text later. */
      capturedAt: 'session_start'
      taskId: string
      taskTitleSnapshot: string
      workspaceId?: string
    }
  | {
      kind: 'unattributed'
      reason: 'no_task_selected' | 'legacy_session' | 'task_missing'
    }

/** Immutable timer-session fact; this, not DailyLog, is the authority for focus history. */
export type StudySessionFact = {
  factVersion: 1
  factKind: 'study_session'
  id: string
  clientId: string
  timerMode: 'focus' | 'break'
  outcome: 'completed' | 'interrupted' | 'canceled'
  startedAt: AnalyticsInstant
  endedAt: AnalyticsInstant
  recordedAt: AnalyticsInstant
  plannedSeconds: number
  activeSeconds: number
  pausedSeconds: number
  /** 1 only for a normally completed focus timer; otherwise 0. */
  completedFocusSessions: 0 | 1
  xpEarned: number
  context: {
    modeId: StudyAnalyticsModeId
    roomId: StudyAnalyticsRoomId
    signalId: StudyAnalyticsSignalId
    spaceCode?: string
  }
  taskAttribution: StudyTaskAttribution
  /** Segments sum to the fact totals and split at local midnight and offset changes. */
  daySegments: StudySessionDaySegment[]
}

export type StudyTaskScheduleSnapshot = {
  weekday: AnalyticsWeekdayIndex
  startMinutes: number
  endMinutes: number
  colorId?: string
}

export type StudyTaskStateSnapshot = {
  taskId: string
  title: string
  done: boolean
  schedule?: StudyTaskScheduleSnapshot
  workspaceId?: string
  /** Optional Study task category id (builtin or custom-*). */
  categoryId?: string
  /** Display name captured with the snapshot; analytics may fall back to id. */
  categoryName?: string
}

type StudyActivityFactBase = {
  factVersion: 1
  factKind: 'study_activity'
  id: string
  clientId: string
  occurredAt: AnalyticsInstant
  recordedAt: AnalyticsInstant
  localDate: AnalyticsLocalDate
  timezoneOffsetMinutes: number
}

/** Append-only task lifecycle history required for range-aware task analytics. */
export type StudyTaskActivityFact = StudyActivityFactBase & {
  activity:
    | { kind: 'task_created'; after: StudyTaskStateSnapshot }
    | { kind: 'task_completed'; before: StudyTaskStateSnapshot; after: StudyTaskStateSnapshot }
    | { kind: 'task_reopened'; before: StudyTaskStateSnapshot; after: StudyTaskStateSnapshot }
    | { kind: 'task_schedule_changed'; before: StudyTaskStateSnapshot; after: StudyTaskStateSnapshot }
    | { kind: 'task_title_changed'; before: StudyTaskStateSnapshot; after: StudyTaskStateSnapshot }
    | { kind: 'task_deleted'; before: StudyTaskStateSnapshot }
}

export type StudyReviewActivityFact = StudyActivityFactBase & {
  activity: {
    kind: 'review_answered'
    workspaceId: string
    lessonId: string
    correct: boolean
  }
}

export type StudyWorkspaceActivityFact = StudyActivityFactBase & {
  activity: {
    kind: 'workspace_changed' | 'lesson_generated'
    workspaceId: string
    lessonId?: string
    source?: 'ai' | 'fallback' | 'manual'
    succeeded?: boolean
  }
}

export type StudySkillActivityFact = StudyActivityFactBase & {
  activity: {
    kind: 'skill_used'
    skillId: string
    workspaceId?: string
    succeeded?: boolean
  }
}

export type StudyActivityFact =
  | StudyTaskActivityFact
  | StudyReviewActivityFact
  | StudyWorkspaceActivityFact
  | StudySkillActivityFact

export type StudyAnalyticsFact = StudySessionFact | StudyActivityFact

/** Rebuildable per-day projection. It must never be the only source of a metric. */
export type StudyDailyProjection = {
  projectionVersion: 1
  date: AnalyticsLocalDate
  focusSeconds: number
  breakSeconds: number
  completedFocusSessions: number
  interruptedFocusSessions: number
  xpEarned: number
  hourBuckets: AnalyticsHourBuckets
  tasksCreated: number
  tasksCompleted: number
  tasksReopened: number
  tasksDeleted: number
  reviewAnswered: number
  reviewCorrect: number
  sourceFactCount: number
  rebuiltAt: AnalyticsInstant
}

export type StudyAnalyticsStoreV1 = {
  version: 1
  clientId: string
  trackingStartedOn: AnalyticsLocalDate
  retention: {
    policy: 'rolling_local_days'
    days: 400
  }
  /** Append-only within the retention window; facts are the local authority. */
  facts: StudyAnalyticsFact[]
  /** Disposable cache derived only from `facts`. */
  dailyProjections: StudyDailyProjection[]
  updatedAt: AnalyticsInstant
}

/**
 * Bounded renderer-to-main snapshot. The localStorage ledger remains renderer-owned;
 * Main validates this payload and calculates all personal sections from accepted facts.
 */
export type PersonalStudyAnalyticsSnapshot = {
  version: 1
  /** Renderer-produced change identity. Main treats this as untrusted cache input. */
  identity: string
  capturedAt: AnalyticsInstant
  clientId: string
  trackingStartedOn: AnalyticsLocalDate
  /** Immutable session/activity facts only. Daily projections never cross the IPC seam. */
  facts: StudyAnalyticsFact[]
  current: {
    xp: number
    streakDays: number
    tasks: StudyTaskStateSnapshot[]
    /** Local capped-XP bookkeeping, passed only through the personal source seam. */
    dailyXpProgress?: DailyXpProgress
  }
  diagnostics?: {
    invalidFactRows?: number
    retentionPruned?: boolean
  }
}

/** Request envelope keeps personal source data out of returned/exported bundle queries. */
export type LearningAnalyticsRequest = {
  query: LearningAnalyticsQuery
  personalStudy?: PersonalStudyAnalyticsSnapshot
  /** Initial sections required by a lean analytics page read. */
  sectionIds?: AnalyticsSectionId[]
  /** Explicit retry sections whose providers should bypass cache once. */
  refreshSectionIds?: AnalyticsSectionId[]
}

export type AnalyticsComparison = {
  previousRange: AnalyticsDateRange
  previousValue: number
  absoluteChange: number
  /** Null when the previous value is zero. */
  ratioChange: number | null
}

export type AnalyticsLevelProgress = {
  level: number
  xpAtLevelStart: number
  xpAtNextLevel: number
  currentXp: number
  progress: number
}

export type LearningAnalyticsHero = {
  /** Range-filtered personal focus seconds. */
  focusSeconds: number
  /** Range-filtered normally completed focus timers. */
  completedFocusSessions: number
  /** Current streak as of bundle generation; range-invariant. */
  currentStreakDays: number
  /** Current lifetime XP/level as of bundle generation; range-invariant. */
  currentXp: number
  currentLevel: AnalyticsLevelProgress
  /** Range-filtered token total. */
  totalTokens: number
  /** Current StudyTask done/total ratio; null when there are no current tasks. */
  currentTaskCompletionRate: number | null
  focusComparison?: AnalyticsComparison
  tokenComparison?: AnalyticsComparison
  insightLine: string
}

export type AnalyticsTimePoint = {
  date: AnalyticsLocalDate
  focusSeconds: number
  completedFocusSessions: number
}

export type FocusHeatmapPoint = {
  date: AnalyticsLocalDate
  focusSeconds: number
  completedFocusSessions: number
  tasksCompleted: number
  /** True zero only when the date is inside known tracking coverage. */
  isCovered: boolean
}

/**
 * Floating active-range capsules for focus rhythm (lieflat "Daily active range").
 * - `hour_of_day`: single-day view — X = hour 0–23, Y = minutes 0–60 within that hour
 * - `day_of_range`: multi-day view — X = local date, Y = hours 0–24 within the day
 */
export type FocusActiveRangeMode = 'hour_of_day' | 'day_of_range'

export type FocusActiveRangeItem = {
  id: string
  /** X category: hour `0`–`23` or `YYYY-MM-DD`. */
  category: string
  /** Inclusive lower bound on the vertical axis. */
  start: number
  /** Exclusive-ish upper bound on the vertical axis (`start < end`). */
  end: number
  /** Active seconds covered by this capsule (tooltip / readout). */
  activeSeconds: number
}

export type FocusActiveRangeSeries = {
  mode: FocusActiveRangeMode
  /** Ordered X-axis categories (hours as decimal strings, or local dates). */
  categories: readonly string[]
  ranges: readonly FocusActiveRangeItem[]
  /** Vertical axis maximum: 60 minutes or 24 hours. */
  yMax: 60 | 24
  yUnit: 'minute' | 'hour'
}

export type FocusAnalytics = {
  daily: StudyDailyProjection[]
  heatmap: FocusHeatmapPoint[]
  trend: AnalyticsTimePoint[]
  hourBuckets: AnalyticsHourBuckets
  /** Range-capsule series for the selected calendar window. */
  activeRanges: FocusActiveRangeSeries
  sessionStructure: {
    focusSeconds: number
    breakSeconds: number
    completed: number
    interrupted: number
    canceled: number
    averageCompletedFocusSeconds: number | null
    completionRate: number | null
  }
  /** Current snapshot values; selected range does not alter them. */
  currentGrowth: {
    xp: number
    level: AnalyticsLevelProgress
    streakDays: number
    badges: Array<{ id: string; label: string; unlocked: boolean }>
    plantStage: string
    /** Present for local personal analytics; absent for older/Web aggregate payloads. */
    dailyXp?: DailyXpSummary
  }
}

export type CurrentTaskAnalytics = {
  asOf: AnalyticsInstant
  total: number
  open: number
  completed: number
  /** Open tasks whose current-week scheduled interval ended before `asOf`. */
  overdue: number
  completionRate: number | null
}

export type TaskFlowAnalytics = {
  created: number
  completed: number
  reopened: number
  deleted: number
  byDay: Array<{
    date: AnalyticsLocalDate
    created: number
    completed: number
    reopened: number
    deleted: number
  }>
}

export type TaskPlanAnalytics = {
  /** Reconstructed from task lifecycle/schedule history, never current schedule projected backward. */
  plannedSeconds: number
  scheduledOccurrences: number
  /** Focus seconds with explicit task IDs matching scheduled tasks/occurrences. */
  attributedFocusSeconds: number
  /** May exceed 1; null when plannedSeconds is zero or schedule history is unavailable. */
  executionRate: number | null
}

export type TaskAnalytics = {
  /** Current task inventory; intentionally range-invariant. */
  current: CurrentTaskAnalytics
  /** Range-filtered lifecycle events. */
  flow: TaskFlowAnalytics
  /** Range-filtered schedule history and explicit focus attribution. */
  plan: TaskPlanAnalytics
  topByAttributedFocus: Array<{
    taskId: string
    title: string
    focusSeconds: number
    completedInRange: boolean
    currentlyDone: boolean | null
    categoryId?: string | null
    categoryName?: string | null
  }>
  /** Focus-time share rolled up by task category (range-filtered attribution). */
  byCategoryFocus: Array<{
    categoryId: string
    label: string
    focusSeconds: number
  }>
  /**
   * Range-filtered task_completed events rolled up by task.
   * Powers checklist-driven pies when no attributed focus exists yet.
   */
  topByCompletion: Array<{
    taskId: string
    title: string
    completionCount: number
    categoryId?: string | null
    categoryName?: string | null
  }>
  /** Completion-count share rolled up by task category (range-filtered). */
  byCategoryCompletion: Array<{
    categoryId: string
    label: string
    completionCount: number
  }>
  unattributedFocusSeconds: number
}

/**
 * Consent-gated derived charts that may be stored by the sync service for
 * browser/phone rendering. This deliberately excludes raw activity facts,
 * task titles, conversation/workspace metadata, review answers, memories,
 * tool data, and any teaching evidence. Local files and the personal ledger
 * remain the only teaching-decision authority.
 */
export type SyncedAnalyticsVisualizationsV1 = {
  version: 1
  focus: Pick<
    FocusAnalytics,
    'daily' | 'heatmap' | 'trend' | 'hourBuckets' | 'activeRanges' | 'sessionStructure' | 'currentGrowth'
  >
  /** Aggregate task charts only; per-task labels never leave the device here. */
  tasks?: Pick<TaskAnalytics, 'current' | 'flow' | 'plan' | 'unattributedFocusSeconds'>
}

export type TokenUsageNumbers = {
  promptTokens?: number
  completionTokens?: number
  /** Use source total when present; otherwise derive prompt + completion. */
  totalTokens: number
  providerCalls: number
  toolCalls: number
  toolErrors: number
  iterations: number
  childRuns: number
  durationMs: number
  budgetStopReason?: 'duration' | 'provider_calls' | 'tool_calls' | 'total_tokens'
}

/** Normalized usage unit before aggregation. */
export type TokenUsageFact = {
  source: 'conversation' | 'ledger_fallback'
  /** Stable workspace + conversation + turn/snapshot identity used for deduplication. */
  dedupeKey: string
  conversationKey: string
  conversationId: string
  conversationTitle: string
  workspaceId?: string
  workspaceName?: string
  courseRelativePath?: string
  turnId?: string
  occurredAt: AnalyticsInstant
  localDate: AnalyticsLocalDate
  /** Conversation/ledger timestamps lack captured local dates, so v1 uses query timezone. */
  localDateSource: 'query_timezone'
  usage: TokenUsageNumbers
  componentsComplete: boolean
}

export type TokenAnalyticsCoverage = {
  conversationsScanned: number
  conversationsReadable: number
  conversationsWithUsage: number
  conversationsPartiallyMissingUsage: number
  ledgerSnapshotsScanned: number
  ledgerFallbackConversations: number
  invalidLedgerRows: number
}

export type TokenAnalytics = {
  totals: {
    promptTokens?: number
    completionTokens?: number
    totalTokens: number
    providerCalls: number
    toolCalls: number
    toolErrors: number
    iterations: number
    childRuns: number
    durationMs: number
    budgetStops: number
  }
  byDay: Array<{
    date: AnalyticsLocalDate
    promptTokens?: number
    completionTokens?: number
    totalTokens: number
    runs: number
  }>
  /**
   * Daily totals broken down by model label (usage-ledger model_usage).
   * When empty, the renderer falls back to total-token bars without model segments.
   */
  byDayByModel: Array<{
    date: AnalyticsLocalDate
    model: string
    totalTokens: number
    runs: number
  }>
  byConversation: Array<{
    conversationKey: string
    conversationId: string
    title: string
    workspaceId?: string
    workspaceName?: string
    courseRelativePath?: string
    source: 'conversation' | 'ledger_fallback'
    promptTokens?: number
    completionTokens?: number
    totalTokens: number
    providerCalls: number
    toolCalls: number
    toolErrors: number
    messageCount: number
    durationMs: number
    updatedAt: AnalyticsInstant
  }>
  byWorkspace: Array<{
    workspaceId: string
    name: string
    totalTokens: number
    conversationCount: number
  }>
  byTool: Array<{
    name: string
    calls: number
    errors: number
  }>
  efficiency: {
    averageTokensPerUsageFact: number | null
    averageTokensPerConversation: number | null
    averageTokensPerMessage: number | null
    averageDurationMs: number | null
    toolErrorRate: number | null
  }
  contextGovernance: {
    compactionEvents: number
    replacedTokens: number
    hygieneSavedTokens: number
    childRunShare: number | null
  }
  sourceCoverage: TokenAnalyticsCoverage
}

export type WorkspaceAssetsAnalytics = {
  counts: {
    workspaces: number
    courses: number
    sessions: number
    lessons: number
    resources: number
    learningRecords: number
    references: number
    conversations: number
  }
  courses: Array<{
    workspaceId: string
    courseId: string
    name: string
    sessionCount: number
    lessonCount: number
    conversationCount: number
    pinned: boolean
    updatedAt?: AnalyticsInstant
  }>
  recentLessons: Array<{
    workspaceId: string
    lessonId: string
    title: string
    courseName: string
    createdAt: AnalyticsInstant
    durationMinutes: number
  }>
  missionHealth: Array<{
    workspaceId: string
    hasMission: boolean
    title: string
    excerptLength: number
    updatedAt?: AnalyticsInstant
  }>
}

export type ReviewAnalytics = {
  /** Existing cumulative progress snapshot; range-invariant until answer facts exist. */
  cumulative: {
    totalAnswered: number
    correct: number
    accuracy: number | null
    cardCount: number
  }
  /** Range metrics are null when timestamped review facts were not recorded. */
  range: {
    answered: number | null
    correct: number | null
    accuracy: number | null
  }
  byLesson: Array<{
    lessonId: string
    title?: string
    answered: number
    correct: number
    accuracy: number | null
    reviewCardCount: number
  }>
}

export type MemoryAnalytics = {
  /** Current memory inventory; range-invariant. */
  activeCount: number
  tombstoneCount: number
  byScope: Array<{ scope: 'user' | 'workspace' | 'project'; count: number }>
  topTags: Array<{ tag: string; count: number }>
  confidenceBuckets: Array<{ fromInclusive: number; toInclusive: number; count: number }>
  recentlyUpdated: Array<{
    id: string
    scope: 'user' | 'workspace' | 'project'
    tags: string[]
    confidence: number
    updatedAt: AnalyticsInstant
  }>
}

export type PlatformAnalytics = {
  /** Current inventories/settings are range-invariant; activity counts are range-filtered when facts exist. */
  skills: {
    installed: number
    byCategory: Array<{ category: string; count: number }>
    usedInRange: number | null
  }
  pet: {
    appearanceId: string
    plantStage: string
  }
  model: {
    providerLabel: string
    modelLabel: string
    lessonRunsInRange: number | null
    failedLessonRunsInRange: number | null
  }
  workspaceChanges: {
    changesInRange: number | null
    byDay: Array<{ date: AnalyticsLocalDate; count: number }>
  }
  connectors: Array<{
    id: string
    configured: boolean
    usedInRange: number | null
  }>
}

export type PresenceSnapshotAnalytics = {
  capturedAt: AnalyticsInstant
  spaceCode: string
  online: number
  roomCapacityPercent: number | null
  peerFocusSecondsToday: number
  selfPercentile: number | null
  eventCounts: Partial<Record<'checkin' | 'focus_start' | 'task_done' | 'cheer', number>>
}

export type AnalyticsInsight = {
  id: string
  kind: 'observation' | 'warning' | 'action'
  text: string
  explanation: string
  evidenceSectionIds: AnalyticsSectionId[]
  action?: {
    label: string
    route: string
  }
}

export type InsightsAnalytics = {
  items: AnalyticsInsight[]
}

export type AnalyticsSectionId =
  | 'hero'
  | 'focus'
  | 'tasks'
  | 'tokens'
  | 'workspace_assets'
  | 'review'
  | 'memory'
  | 'platform'
  | 'presence'
  | 'insights'

export type LearningAnalyticsBundle = {
  contractVersion: 1
  generatedAt: AnalyticsInstant
  query: LearningAnalyticsQuery
  hero: AnalyticsSectionResult<LearningAnalyticsHero>
  focus: AnalyticsSectionResult<FocusAnalytics>
  tasks: AnalyticsSectionResult<TaskAnalytics>
  tokens: AnalyticsSectionResult<TokenAnalytics>
  workspaceAssets: AnalyticsSectionResult<WorkspaceAssetsAnalytics>
  review: AnalyticsSectionResult<ReviewAnalytics>
  memory: AnalyticsSectionResult<MemoryAnalytics>
  platform: AnalyticsSectionResult<PlatformAnalytics>
  presence: AnalyticsSectionResult<PresenceSnapshotAnalytics>
  insights: AnalyticsSectionResult<InsightsAnalytics>
}

export type AnalyticsExportFormat = 'json' | 'csv'
export type AnalyticsExportDetail = 'summary' | 'detailed'

export type AnalyticsExportRequest = {
  query: LearningAnalyticsQuery
  /** Reused only to calculate this export; it is not echoed into the export query. */
  personalStudy?: PersonalStudyAnalyticsSnapshot
  format: AnalyticsExportFormat
  /** `summary` omits user-authored labels; `detailed` includes displayed titles/names only. */
  detail: AnalyticsExportDetail
  sectionIds: AnalyticsSectionId[]
}

export type AnalyticsExportManifest = {
  contractVersion: 1
  generatedAt: AnalyticsInstant
  format: AnalyticsExportFormat
  detail: AnalyticsExportDetail
  includedSections: AnalyticsSectionId[]
  /** Fields always excluded regardless of detail level. */
  excludedSensitiveFields: Array<
    | 'conversation_content'
    | 'mission_content'
    | 'memory_content'
    | 'tool_arguments'
    | 'tool_results'
    | 'absolute_paths'
    | 'api_keys'
    | 'secret_endpoints'
  >
}

export type AnalyticsExportResult =
  | { canceled: true }
  | {
      canceled: false
      /** Safe display name only; the renderer does not receive an absolute path. */
      fileName: string
      bytesWritten: number
      manifest: AnalyticsExportManifest
    }

export type AnalyticsClearTarget =
  | 'derived_cache'
  | 'personal_activity_history'
  | 'analytics_preferences'

export type ClearAnalyticsRequest = {
  targets: AnalyticsClearTarget[]
  confirmed: true
}

export type ClearAnalyticsResult = {
  cleared: AnalyticsClearTarget[]
  /** Teaching workspaces, conversations, ledger, review, memory, and current tasks are never deleted here. */
  preservedSourceDomains: Array<'teaching_workspaces' | 'conversations' | 'ledger' | 'review' | 'memory' | 'current_tasks'>
  trackingRestartedOn?: AnalyticsLocalDate
}
