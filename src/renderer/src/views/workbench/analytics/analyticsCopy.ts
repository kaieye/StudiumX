import type {
  AnalyticsEmptyReason,
  AnalyticsRangePreset,
  AnalyticsSectionId,
  AnalyticsUnavailableReason
} from './types'
import type { AnalyticsCustomRangeValidation } from './useStudyAnalytics'

export const analyticsCopy = {
  page: {
    eyebrow: 'Learning Insights',
    title: '学习分析',
    back: '返回自习室',
    skip: '跳到分析内容',
    description: '个人专注、教学工作区与当前在线状态分别统计；缺失历史不会被记作 0。',
    tokenCalculatorEyebrow: 'Token Usage',
    tokenCalculatorTitle: 'Token 消耗量',
    totalTokenUsage: '总 Token 量',
    todayTokenUsage: '今日 Token 量',
    tokenTrend: 'Token 使用趋势',
    tokenTrendRange: '趋势时间范围',
    last7Days: '近 7 天',
    last30Days: '近 30 天',
    tokenDataPartial: '部分日期的数据不完整，缺失值不会按 0 处理。',
    noTokenTrendData: '当前没有可展示的 Token 趋势数据。',
    dataNote: '日期按设备本地自然日计算，区间包含开始与结束日期。',
    updated: '数据更新时间',
    notGenerated: '尚未生成',
    refresh: '刷新分析',
    refreshing: '正在刷新学习分析',
    loaded: '学习分析已更新',
    unavailable: '分析服务尚未接入',
    unavailableDetail: '当前版本还没有可用的学习分析聚合接口。页面不会展示模拟数据；接入后可直接刷新。',
    unavailableSection: '分析服务接入后，此区块将显示真实数据。',
    failed: '学习分析加载失败',
    retry: '重试',
    stale: '正在更新所选范围，暂时显示上一份结果。',
    staleAfterFailure: '刷新未完成，当前显示的是上一份可用结果。',
    privacy: '隐私说明：仅展示聚合指标；导出始终排除对话正文、密钥、绝对路径和工具参数。',
    exportSummary: '导出摘要',
    exportDetailed: '导出详细数据',
    exporting: '正在导出',
    exportSuccess: (fileName: string) => `已导出 ${fileName}`,
    exportFailed: '导出失败，请稍后重试。',
    clear: '清除分析历史',
    clearConfirm: '确定清除分析缓存与个人分析历史吗？教学工作区、对话、任务、复习和记忆源数据不会被删除。',
    clearSuccess: '分析历史已清除，新的记录将从现在开始覆盖。',
    clearFailed: '清除失败，请稍后重试。'
  },
  ranges: {
    legend: '时间范围',
    today: '今天',
    week: '本周',
    month: '本月',
    '90d': '近 90 天',
    all: '全部',
    custom: '自定义',
    customTitle: '自定义日期范围',
    from: '开始日期',
    to: '结束日期',
    apply: '应用范围',
    cancel: '关闭自定义范围',
    summaryPrefix: '当前范围',
    inclusive: '双端包含',
    errors: {
      required: '请选择开始日期和结束日期。',
      invalid_date: '日期格式无效，请重新选择。',
      from_after_to: '开始日期不能晚于结束日期。',
      future_date: '日期范围不能包含未来日期。'
    }
  },
  scopes: {
    title: '数据范围',
    description: '三个数据域彼此独立，不会被一个全局筛选器混在一起。',
    personalLabel: '个人专注',
    personalValue: '仅本机学习者',
    teachingLabel: '教学数据',
    teachingCurrent: '当前工作区',
    teachingAll: '全部工作区',
    teachingNone: '暂无教学工作区',
    teachingCurrentUnavailable: '当前没有选中的教学工作区',
    presenceLabel: '在线状态',
    presenceCurrent: '当前自习空间',
    presenceNone: '未连接自习空间',
    workspaceCount: (count: number) => `${count} 个工作区`
  },
  sections: {
    overview: '总览',
    overviewDescription: '区间指标与当前状态会明确区分。',
    core: '核心分析',
    coreDescription: '为专注图表、Token 与洞察模块提供稳定的数据插槽。',
    deep: '深度盘点',
    deepDescription: '任务、资产、复习、记忆、平台与实时在线快照。',
    deepOpen: '展开深度盘点',
    deepClose: '收起深度盘点',
    hero: '关键指标',
    focus: '专注分析',
    tasks: '任务与计划',
    tokens: 'Token 使用',
    workspace_assets: '教学资产',
    review: '复习进度',
    memory: '记忆库',
    platform: '技能与平台',
    presence: '当前在线',
    insights: '学习洞察'
  } satisfies Record<string, string>,
  metrics: {
    focus: '专注时长',
    sessions: '完成番茄',
    streak: '当前连胜',
    level: '当前等级',
    tokens: 'Token 用量',
    tasks: '当前任务完成率',
    current: '当前状态',
    selectedRange: '所选区间',
    hours: '小时',
    sessionsUnit: '次',
    days: '天',
    levelUnit: '级',
    unknown: '—',
    noTasks: '暂无任务'
  },
  states: {
    loading: '正在加载',
    available: '数据完整',
    empty: '暂无数据',
    partial: '数据不完整',
    unavailable: '暂不可用',
    error: '加载失败',
    sectionRetry: '重试此区块',
    emptyReasons: {
      no_activity: '所选范围内没有已记录的活动。',
      no_matching_records: '没有符合当前范围的数据。',
      not_started: '该数据尚未开始记录。',
      scope_has_no_items: '当前数据范围内没有可统计项目。'
    } satisfies Record<AnalyticsEmptyReason, string>,
    unavailableReasons: {
      not_applicable: '此区块不适用于当前数据范围。',
      not_configured: '相关数据源尚未配置。',
      no_active_workspace: '当前没有可用的教学工作区。',
      permission_denied: '没有权限读取相关数据源。',
      history_not_recorded: '历史数据尚未记录，不能将缺失值显示为 0。',
      source_missing: '所需数据源不存在。',
      unsupported: '当前版本尚不支持此区块。'
    } satisfies Record<AnalyticsUnavailableReason, string>
  },
  coverage: {
    summary: '数据覆盖与说明',
    requested: '请求范围',
    effective: '有效范围',
    tracking: '开始记录',
    dataStart: '最早数据',
    dataEnd: '最近数据',
    complete: '覆盖完整',
    incomplete: '覆盖不完整',
    noDate: '未知',
    warningTitle: '数据说明'
  },
  placeholders: {
    focus: '真实专注图表将在专注事实与日投影接入后显示。',
    tasks: '任务历史和显式专注归因接入后将在这里展示。',
    tokens: 'Token 聚合会优先使用对话 turn，并仅在缺失时使用 ledger 兜底。',
    workspace_assets: '课程、讲义与学习记录库存将在教学聚合接入后显示。',
    review: '复习累计状态与可用的区间历史将在这里展示。',
    memory: '记忆库存与标签概览将在这里展示。',
    platform: '技能、模型、宠物和工作区变化将在这里展示。',
    presence: '这里仅展示当前在线快照，不伪造历史在线趋势。',
    insights: '洞察只会引用可用区块作为证据。'
  } satisfies Record<Exclude<AnalyticsSectionId, 'hero'>, string>
} as const


const analyticsCopyEn = {
  ...analyticsCopy,
  page: {
    ...analyticsCopy.page,
    eyebrow: 'Learning Insights',
    title: 'Study analytics',
    back: 'Back to study space',
    skip: 'Skip to analytics content',
    description: 'Personal focus, teaching workspaces, and current presence are reported separately; missing history is never shown as zero.',
    tokenCalculatorEyebrow: 'Token Usage',
    tokenCalculatorTitle: 'Token consumption',
    totalTokenUsage: 'Total tokens',
    todayTokenUsage: 'Tokens today',
    tokenTrend: 'Token usage trend',
    tokenTrendRange: 'Trend range',
    last7Days: 'Last 7 days',
    last30Days: 'Last 30 days',
    tokenDataPartial: 'Some dates are incomplete; missing values are not treated as zero.',
    noTokenTrendData: 'No token trend data is available yet.',
    dataNote: 'Dates use the device local calendar. Both range boundaries are included.',
    updated: 'Updated',
    notGenerated: 'Not generated',
    refresh: 'Refresh analytics',
    refreshing: 'Refreshing study analytics',
    loaded: 'Study analytics updated',
    unavailable: 'Analytics service unavailable',
    unavailableDetail: 'No usable analytics aggregate is available right now. No simulated values are shown.',
    unavailableSection: 'This section will show real data when its source is available.',
    failed: 'Study analytics failed to load',
    retry: 'Retry',
    stale: 'Updating the selected range; showing the previous result for now.',
    staleAfterFailure: 'Refresh did not finish; showing the previous available result.',
    privacy: 'Privacy: only aggregate metrics are shown. Exports always exclude conversation content, secrets, absolute paths, and tool arguments.',
    exportSummary: 'Export summary',
    exportDetailed: 'Export detailed data',
    exporting: 'Exporting',
    exportSuccess: (fileName: string) => `Exported ${fileName}`,
    exportFailed: 'Export failed. Please try again.',
    clear: 'Clear analytics history',
    clearConfirm: 'Clear analytics cache and personal analytics history? Teaching workspaces, conversations, tasks, review, and memory source data will not be deleted.',
    clearSuccess: 'Analytics history was cleared. New tracking starts from now.',
    clearFailed: 'Clear failed. Please try again.'
  },
  ranges: {
    ...analyticsCopy.ranges,
    legend: 'Date range', today: 'Today', week: 'This week', month: 'This month', '90d': 'Last 90 days', all: 'All time', custom: 'Custom',
    customTitle: 'Custom date range', from: 'From', to: 'To', apply: 'Apply range', cancel: 'Close custom range', summaryPrefix: 'Selected range', inclusive: 'Inclusive',
    errors: { required: 'Choose both start and end dates.', invalid_date: 'Invalid date format.', from_after_to: 'The start date cannot be after the end date.', future_date: 'A range cannot include future dates.' }
  },
  scopes: {
    ...analyticsCopy.scopes,
    title: 'Data scope', description: 'The three data domains remain separate; one global filter does not mix them.', personalLabel: 'Personal focus', personalValue: 'This device only', teachingLabel: 'Teaching data', teachingCurrent: 'Current workspace', teachingAll: 'All workspaces', teachingNone: 'No teaching workspace', teachingCurrentUnavailable: 'No teaching workspace selected', presenceLabel: 'Presence', presenceCurrent: 'Current study space', presenceNone: 'No study space connected', workspaceCount: (count: number) => `${count} workspaces`
  },
  sections: {
    ...analyticsCopy.sections,
    overview: 'Overview', overviewDescription: 'Range metrics and current state are shown separately.', core: 'Core analytics', coreDescription: 'Focus charts, token usage, and evidence-backed insights.', deep: 'Deep review', deepDescription: 'Tasks, assets, review, memory, platform, and live presence.', deepOpen: 'Open deep review', deepClose: 'Close deep review', hero: 'Key metrics', focus: 'Focus analytics', tasks: 'Tasks and planning', tokens: 'Token usage', workspace_assets: 'Teaching assets', review: 'Review progress', memory: 'Memory inventory', platform: 'Skills and platform', presence: 'Current presence', insights: 'Learning insights'
  },
  metrics: {
    ...analyticsCopy.metrics,
    focus: 'Focus time', sessions: 'Completed focus sessions', streak: 'Current streak', level: 'Current level', tokens: 'Token usage', tasks: 'Current task completion', current: 'Current state', selectedRange: 'Selected range', hours: 'hours', sessionsUnit: 'sessions', days: 'days', levelUnit: 'level', unknown: '—', noTasks: 'No tasks'
  },
  states: {
    ...analyticsCopy.states,
    loading: 'Loading', available: 'Available', empty: 'No data', partial: 'Partial data', unavailable: 'Unavailable', error: 'Failed', sectionRetry: 'Retry section',
    emptyReasons: { no_activity: 'No activity was recorded in this range.', no_matching_records: 'No records match the selected scope.', not_started: 'Tracking has not started.', scope_has_no_items: 'The selected scope has no items.' },
    unavailableReasons: { not_applicable: 'This section does not apply to the selected scope.', not_configured: 'The required source is not configured.', no_active_workspace: 'No teaching workspace is available.', permission_denied: 'Permission to read the source was denied.', history_not_recorded: 'History was not recorded; missing values are not zero.', source_missing: 'The required source is unavailable.', unsupported: 'This section is not supported in this version.' }
  },
  placeholders: {
    ...analyticsCopy.placeholders,
    focus: 'Focus charts appear when timestamped focus facts are available.', tasks: 'Task history and explicit focus attribution appear here when available.', tokens: 'Token aggregation uses conversation turns and falls back to ledger facts only when needed.', workspace_assets: 'Teaching asset inventory appears when the teaching aggregate is available.', review: 'Review inventory and available range history appear here.', memory: 'Memory inventory and tag summaries appear here.', platform: 'Skills, models, pet, and workspace changes appear here.', presence: 'Only the current presence snapshot is shown; historical presence is not fabricated.', insights: 'Insights cite only sections with verified evidence.'
  }
}

export function getAnalyticsCopy(locale: string): typeof analyticsCopy {
  return locale.toLowerCase().startsWith('en') ? (analyticsCopyEn as unknown as typeof analyticsCopy) : analyticsCopy
}

export function rangePresetLabel(preset: AnalyticsRangePreset): string {
  return analyticsCopy.ranges[preset]
}

export function customRangeValidationMessage(validation: AnalyticsCustomRangeValidation): string {
  if (validation.valid) return ''
  return analyticsCopy.ranges.errors[validation.code]
}
