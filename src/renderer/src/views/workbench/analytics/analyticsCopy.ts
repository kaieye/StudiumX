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
    staleAfterFailure: '刷新未完成，当前显示的是上一份可用结果。'
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

export function rangePresetLabel(preset: AnalyticsRangePreset): string {
  return analyticsCopy.ranges[preset]
}

export function customRangeValidationMessage(validation: AnalyticsCustomRangeValidation): string {
  if (validation.valid) return ''
  return analyticsCopy.ranges.errors[validation.code]
}
