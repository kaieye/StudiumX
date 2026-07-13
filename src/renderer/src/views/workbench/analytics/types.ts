import type {
  AnalyticsDataState,
  AnalyticsDateRange,
  AnalyticsInsight,
  AnalyticsLocalDate,
  AnalyticsRangePreset,
  AnalyticsSectionId,
  AnalyticsSectionResult,
  AnalyticsWarning,
  FocusAnalytics,
  InsightsAnalytics,
  LearningAnalyticsBundle,
  LearningAnalyticsHero,
  LearningAnalyticsScope,
  MemoryAnalytics,
  PlatformAnalytics,
  PresenceSnapshotAnalytics,
  ReviewAnalytics,
  TaskAnalytics,
  TeachingAnalyticsScope,
  TokenAnalytics,
  WorkspaceAssetsAnalytics
} from '../../../../../shared/teaching-types/analytics'

export type * from '../../../../../shared/teaching-types/analytics'

/** Renderer-only section data lookup; source DTOs remain defined in shared types. */
export type AnalyticsSectionDataMap = {
  hero: LearningAnalyticsHero
  focus: FocusAnalytics
  tasks: TaskAnalytics
  tokens: TokenAnalytics
  workspace_assets: WorkspaceAssetsAnalytics
  review: ReviewAnalytics
  memory: MemoryAnalytics
  platform: PlatformAnalytics
  presence: PresenceSnapshotAnalytics
  insights: InsightsAnalytics
}

export type AnalyticsSectionResultMap = {
  [K in AnalyticsSectionId]: AnalyticsSectionResult<AnalyticsSectionDataMap[K]>
}

export type StudyAnalyticsPageLoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; queryKey: string }
  | { kind: 'ready'; bundle: LearningAnalyticsBundle; refreshing: boolean }
  | { kind: 'failed'; message: string; retryable: boolean }

/** Date control values are local dates; from/to remain inclusive. */
export type AnalyticsRangeControlValue = {
  preset: AnalyticsRangePreset
  from: AnalyticsLocalDate
  to: AnalyticsLocalDate
}

/**
 * Only teaching scope is user-selectable globally. Personal focus stays personal and
 * Presence stays bound to the current live space; the UI must not imply otherwise.
 */
export type AnalyticsScopeControlValue = {
  teaching: TeachingAnalyticsScope
}

export type AnalyticsSectionDescriptor = {
  id: AnalyticsSectionId
  anchorId: `analytics-${string}`
  title: string
  priority: 'primary' | 'secondary' | 'tertiary'
  defaultExpanded: boolean
}

export type AnalyticsSectionPresentation = {
  id: AnalyticsSectionId
  state: AnalyticsDataState
  title: string
  subtitle?: string
  warnings: AnalyticsWarning[]
  isRangeFiltered: boolean
  isRangeInvariant: boolean
}

export type AnalyticsMetricCardViewModel = {
  id: string
  label: string
  displayValue: string
  unit?: string
  state: AnalyticsDataState
  /** Screen-reader text must include temporal semantics, e.g. “当前连胜” vs “本周专注”. */
  ariaLabel: string
  sectionId: AnalyticsSectionId
  comparisonLabel?: string
  warningLabel?: string
}

export type FocusHeatmapCellViewModel = {
  date: AnalyticsLocalDate
  focusSeconds: number
  completedFocusSessions: number
  tasksCompleted: number
  intensity: 0 | 1 | 2 | 3 | 4
  /** Uncovered dates render as unknown, not as a zero-intensity activity day. */
  coverage: 'covered' | 'uncovered'
  tooltip: string
}

export type AnalyticsInsightViewModel = AnalyticsInsight & {
  tone: 'neutral' | 'positive' | 'caution'
}

export type StudyAnalyticsViewModel = {
  generatedAtLabel: string
  rangeLabel: string
  range: AnalyticsDateRange
  scope: LearningAnalyticsScope
  sections: AnalyticsSectionPresentation[]
  heroCards: AnalyticsMetricCardViewModel[]
  heatmapCells: FocusHeatmapCellViewModel[]
  insights: AnalyticsInsightViewModel[]
}
