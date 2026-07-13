import type { AnalyticsUnavailableReason } from './types'

type AnalyticsCopy = {
  page: {
    eyebrow: string
    title: string
    back: string
    tokenCalculatorTitle: string
    totalTokenUsage: string
    todayTokenUsage: string
    tokenTrend: string
    tokenTrendRange: string
    last7Days: string
    last30Days: string
    noTokenTrendData: string
    retry: string
    refreshing: string
    loaded: string
    failed: string
    unavailable: string
    unavailableDetail: string
  }
  states: {
    loading: string
    unavailableReasons: Record<AnalyticsUnavailableReason, string>
  }
}

const unavailableReasonsZh: Record<AnalyticsUnavailableReason, string> = {
  not_applicable: '当前范围不适用该分析。',
  not_configured: '所需数据源尚未配置。',
  no_active_workspace: '当前没有可用的教学工作区。',
  permission_denied: '没有读取该数据源的权限。',
  history_not_recorded: '尚未记录历史数据。',
  source_missing: '所需数据源不可用。',
  unsupported: '当前版本不支持该分析。'
}

const unavailableReasonsEn: Record<AnalyticsUnavailableReason, string> = {
  not_applicable: 'This analysis does not apply to the selected range.',
  not_configured: 'The required data source is not configured.',
  no_active_workspace: 'No teaching workspace is available.',
  permission_denied: 'Permission to read the source was denied.',
  history_not_recorded: 'History has not been recorded yet.',
  source_missing: 'The required data source is unavailable.',
  unsupported: 'This analysis is not supported in this version.'
}

export const analyticsCopy: AnalyticsCopy = {
  page: {
    eyebrow: 'Learning Insights',
    title: '学习分析',
    back: '返回自习室',
    tokenCalculatorTitle: 'Token 消耗量',
    totalTokenUsage: '总 Token 量',
    todayTokenUsage: '今日 Token 量',
    tokenTrend: 'Token 使用趋势',
    tokenTrendRange: '趋势时间范围',
    last7Days: '近 7 天',
    last30Days: '近 30 天',
    noTokenTrendData: '当前没有可展示的 Token 趋势数据。',
    retry: '重试',
    refreshing: '正在刷新学习分析',
    loaded: '学习分析已更新',
    failed: '学习分析加载失败',
    unavailable: '分析服务尚未接入',
    unavailableDetail: '当前版本还没有可用的学习分析聚合接口。'
  },
  states: {
    loading: '正在加载',
    unavailableReasons: unavailableReasonsZh
  }
}

const analyticsCopyEn: AnalyticsCopy = {
  page: {
    eyebrow: 'Learning Insights',
    title: 'Learning Analytics',
    back: 'Back to study room',
    tokenCalculatorTitle: 'Token Usage',
    totalTokenUsage: 'Total tokens',
    todayTokenUsage: "Today's tokens",
    tokenTrend: 'Token usage trend',
    tokenTrendRange: 'Trend range',
    last7Days: 'Last 7 days',
    last30Days: 'Last 30 days',
    noTokenTrendData: 'No token trend data is available.',
    retry: 'Retry',
    refreshing: 'Refreshing learning analytics',
    loaded: 'Learning analytics updated',
    failed: 'Learning analytics failed to load',
    unavailable: 'Analytics service is unavailable',
    unavailableDetail: 'No learning analytics aggregation API is available in this version.'
  },
  states: {
    loading: 'Loading',
    unavailableReasons: unavailableReasonsEn
  }
}

export function getAnalyticsCopy(locale: string): AnalyticsCopy {
  return locale.toLowerCase().startsWith('en') ? analyticsCopyEn : analyticsCopy
}
