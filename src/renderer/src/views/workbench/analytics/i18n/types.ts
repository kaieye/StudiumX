import type {
  AnalyticsDataState,
  AnalyticsEmptyReason,
  AnalyticsSectionId,
  AnalyticsUnavailableReason,
  AnalyticsWarningCode
} from '../types'

export type SupportedAnalyticsLocale = 'zh-CN' | 'en-US'
export type AnalyticsLocale = SupportedAnalyticsLocale | (string & {})
export type AnalyticsDirection = 'ltr' | 'rtl'
export type AnalyticsPanelState = AnalyticsDataState | 'loading'

export type AnalyticsLabels = {
  common: {
    unknown: string
    none: string
    retry: string
    warnings: string
    coverage: string
    currentSnapshot: string
    currentInventory: string
    selectedRange: string
    count: string
    status: string
    source: string
    included: string
    missing: string
    rejected: string
    complete: string
    incomplete: string
    tokenUnit: string
  }
  states: Record<AnalyticsPanelState, string> & {
    emptyReasons: Record<AnalyticsEmptyReason, string>
    unavailableReasons: Record<AnalyticsUnavailableReason, string>
    genericError: string
    partialDetail: string
  }
  warningCodes: Record<AnalyticsWarningCode, string>
  sections: Record<AnalyticsSectionId, string>
  memory: {
    title: string
    description: string
    privacyNotice: string
    active: string
    tombstones: string
    scopeDistribution: string
    scope: string
    scopes: Record<'user' | 'workspace' | 'project', string>
    tags: string
    topTags: string
    noTags: string
    confidence: string
    confidenceDistribution: string
    confidenceRange: string
    recent: string
    recentDescription: string
    updatedAt: string
    noRecent: string
    empty: string
    unavailable: string
  }
  skills: {
    title: string
    description: string
    currentConfiguration: string
    rangeUsage: string
    installed: string
    categories: string
    category: string
    provider: string
    model: string
    petAppearance: string
    plantStage: string
    connectors: string
    connector: string
    configured: string
    notConfigured: string
    skillsUsed: string
    lessonRuns: string
    failedLessonRuns: string
    workspaceChanges: string
    connectorUsage: string
    date: string
    rangeHistoryUnavailable: string
    noCategories: string
    noConnectors: string
    noWorkspaceChanges: string
    empty: string
    unavailable: string
  }
  presence: {
    title: string
    description: string
    snapshotOnly: string
    capturedAt: string
    space: string
    online: string
    capacity: string
    peerFocusToday: string
    selfPercentile: string
    events: string
    event: string
    eventTypes: Record<'checkin' | 'focus_start' | 'task_done' | 'cheer', string>
    noHistory: string
    empty: string
    unavailable: string
  }
  insights: {
    title: string
    description: string
    dataBacked: string
    observation: string
    warning: string
    action: string
    evidence: string
    evidenceState: string
    noEvidenceBackedItems: string
    coverageTitle: string
    sourceCoverageCaption: string
    empty: string
    unavailable: string
  }
}

export type AnalyticsIntlFormatters = {
  locale: string
  direction: AnalyticsDirection
  number: (value: number) => string
  compactNumber: (value: number) => string
  compactTokens: (value: number) => string
  percent: (ratio: number) => string
  duration: (seconds: number) => string
  localDate: (value: string) => string
  instant: (value: string) => string
  list: (values: readonly string[]) => string
}

export type AnalyticsI18n = {
  locale: string
  dictionaryLocale: SupportedAnalyticsLocale
  direction: AnalyticsDirection
  labels: AnalyticsLabels
  formatters: AnalyticsIntlFormatters
}
