import type { AnalyticsRangePreset, AnalyticsUnavailableReason } from './types'

type SectionStateCopy = {
  loading: string
  empty: string
  partial: string
  error: string
  retry: string
}

type AnalyticsCopy = {
  page: {
    eyebrow: string
    title: string
    back: string
    refresh: string
    refreshing: string
    loaded: string
    failed: string
    apiUnavailable: string
    apiUnavailableDetail: string
    requestFailedDetail: string
    skip: string
    updated: string
    notGenerated: string
    rangeLabel: string
    description: string
    demo: string
    demoExit: string
    demoActive: string
    demoLoaded: string
  }
  ranges: Record<Exclude<AnalyticsRangePreset, 'custom'>, string>
  states: {
    loading: string
    unavailableReasons: Record<AnalyticsUnavailableReason, string>
  }
  section: SectionStateCopy
  hero: {
    title: string
    focus: string
    sessions: string
    sessionsUnit: string
    streak: string
    days: string
    level: string
    levelUnit: string
    tokens: string
    tasks: string
    noTasks: string
    current: string
    inRange: string
    levelProgressTitle: string
    currentXp: string
    nextLevelXp: string
    xpToNext: string
    comparisonUp: string
    comparisonDown: string
    comparisonFlat: string
  }
  focus: {
    title: string
    description: string
    heatmapTitle: string
    heatmapLegendLess: string
    heatmapLegendMore: string
    trendTitle: string
    trendFocus: string
    trendTokens: string
    hourTitle: string
    hourPeak: string
    hourNoPeak: string
    activeRangeHourAxis: string
    activeRangeDayAxis: string
    structureTitle: string
    structureChartTitle: string
    completed: string
    interrupted: string
    canceled: string
    completionRate: string
    avgSession: string
    breakTime: string
    weekdays: readonly [string, string, string, string, string, string, string]
    percentileTitle: string
    percentileCenterLabel: string
    percentileRemaining: (ticks: number) => string
    percentileFooter: string
    percentileEmpty: string
    percentileTooltip: (percent: number) => string
  }
  tokens: {
    title: string
    description: string
    total: string
    today: string
    providerCalls: string
    toolCalls: string
    trendTitle: string
    unknownModel: string
    byToolTitle: string
    byWorkspaceTitle: string
    noToolShare: string
    noWorkspaceShare: string
    toolCallsUnit: string
    toolErrorsUnit: string
  }
  tasks: {
    title: string
    description: string
    open: string
    completed: string
    overdue: string
    completionRate: string
    flowTitle: string
    created: string
    reopened: string
    deleted: string
    noTopTasks: string
    noCompletionShare: string
    byTaskTitle: string
    byCategoryTitle: string
    byTaskCompletionTitle: string
    byCategoryCompletionTitle: string
    shareViewTask: string
    shareViewCategory: string
    shareViewLabel: string
    noCategoryShare: string
    completionCountUnit: string
    uncategorized: string
    planTitle: string
    planVsExecLabel: string
    planned: string
    executed: string
    noPlan: string
  }
  review: {
    title: string
    description: string
    accuracy: string
    answered: string
    correct: string
    cards: string
    byLessonTitle: string
    noLessons: string
  }
  memory: {
    title: string
    description: string
    active: string
    tombstones: string
    scopeTitle: string
    tagsTitle: string
    noTags: string
    scopeLabels: Record<'user' | 'workspace' | 'project', string>
  }
  platform: {
    title: string
    description: string
    model: string
    skills: string
    skillsUnit: string
    skillsTitle: string
    noSkills: string
    changesTitle: string
    changesUnit: string
  }
  insights: {
    title: string
    description: string
    empty: string
    kinds: Record<'observation' | 'warning' | 'action', string>
  }
  charts: {
    empty: string
    total: string
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
    refresh: '刷新',
    refreshing: '正在刷新学习分析',
    loaded: '学习分析已更新',
    failed: '学习分析加载失败',
    apiUnavailable: '学习分析功能不可用',
    apiUnavailableDetail: '当前应用未提供学习分析 API。请更新应用或联系管理员。',
    requestFailedDetail: '分析服务暂时无法响应。请稍后重试。',
    skip: '跳到分析内容',
    updated: '更新于',
    notGenerated: '尚未生成',
    rangeLabel: '时间范围',
    description: '汇总你的专注时段、任务节奏、模型消耗与知识沉淀。',
    demo: '示例',
    demoExit: '退出示例',
    demoActive: '示例模式',
    demoLoaded: '正在展示示例数据（多日伪造学习记录）'
  },
  ranges: {
    today: '今天', week: '7天', month: '30天', all: '全部'
  },
  states: {
    loading: '正在加载',
    unavailableReasons: unavailableReasonsZh
  },
  section: {
    loading: '正在加载',
    empty: '当前范围内暂无学习记录。',
    partial: '部分数据源不完整，结果可能存在缺口。',
    error: '该板块加载失败。',
    retry: '重试'
  },
  hero: {
    title: '概览',
    focus: '专注时长',
    sessions: '完成番茄钟',
    sessionsUnit: '次',
    streak: '连续学习',
    days: '天',
    level: '等级',
    levelUnit: '级',
    tokens: 'Token 消耗',
    tasks: '任务完成率',
    noTasks: '暂无任务',
    current: '当前',
    inRange: '所选范围',
    levelProgressTitle: '等级进度',
    currentXp: '当前经验',
    nextLevelXp: '下一级门槛',
    xpToNext: '距下一级',
    comparisonUp: '较上期 +',
    comparisonDown: '较上期 −',
    comparisonFlat: '与上期持平'
  },
  focus: {
    title: '专注分析',
    description: '专注时段的分布、节律与结构。',
    heatmapTitle: '专注日历热力图',
    heatmapLegendLess: '少',
    heatmapLegendMore: '多',
    trendTitle: '专注趋势',
    trendFocus: '专注时长',
    trendTokens: 'Token 消耗',
    hourTitle: '专注分布',
    hourPeak: '高峰',
    hourNoPeak: '暂无高峰时段',
    activeRangeHourAxis: '今日时段',
    activeRangeDayAxis: '日期',
    structureTitle: '会话结构',
    structureChartTitle: '完成 vs 中断',
    completed: '已完成',
    interrupted: '被打断',
    canceled: '已取消',
    completionRate: '完成率',
    avgSession: '平均专注时长',
    breakTime: '休息时长',
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    percentileTitle: '专注超越',
    percentileCenterLabel: '超过同学',
    percentileRemaining: (ticks) => (ticks <= 0 ? '已站在最前' : `还差 ${ticks} 个刻度`),
    percentileFooter: '一格 = 1% · 上墨 = 已超过',
    percentileEmpty: '暂无同伴对比数据',
    percentileTooltip: (percent) => `专注时长超过 ${percent}% 的同学`
  },
  tokens: {
    title: 'Token 消耗',
    description: '模型调用的 Token 使用分布。',
    total: '总 Token 量',
    today: '今日 Token 量',
    providerCalls: '模型调用',
    toolCalls: '工具调用',
    trendTitle: 'Token 使用趋势',
    unknownModel: '未标注模型',
    byToolTitle: '工具调用排行',
    byWorkspaceTitle: '工作区消耗排行',
    noToolShare: '尚无工具调用记录。',
    noWorkspaceShare: '尚无工作区 Token 分布。',
    toolCallsUnit: '次调用',
    toolErrorsUnit: '次错误'
  },
  tasks: {
    title: '任务分析',
    description: '任务的当前状态与流转节奏。',
    open: '进行中',
    completed: '已完成',
    overdue: '已逾期',
    completionRate: '完成率',
    flowTitle: '任务流转',
    created: '新建',
    reopened: '重新打开',
    deleted: '已删除',
    noTopTasks: '尚无带专注归属的任务。选择任务并完成专注后会出现时间占比。',
    noCompletionShare: '尚无任务完成记录。在清单中勾选任务后会出现完成占比。',
    byTaskTitle: '任务时间排行',
    byCategoryTitle: '类别时间排行',
    byTaskCompletionTitle: '任务完成排行',
    byCategoryCompletionTitle: '类别完成排行',
    shareViewTask: '按任务',
    shareViewCategory: '按类别',
    shareViewLabel: '排行维度',
    noCategoryShare: '尚无任务类别时间分布。',
    completionCountUnit: ' 次',
    uncategorized: '未分类',
    planTitle: '计划 vs 执行',
    planVsExecLabel: '计划时段',
    planned: '计划时长',
    executed: '实际专注',
    noPlan: '尚无计划与执行对比数据。'
  },
  review: {
    title: '复习分析',
    description: '复习卡片的作答与正确率。',
    accuracy: '正确率',
    answered: '已作答',
    correct: '答对',
    cards: '复习卡片',
    byLessonTitle: '按课程正确率',
    noLessons: '暂无复习记录。'
  },
  memory: {
    title: '记忆分析',
    description: 'AI 记忆的规模、范围与标签分布。',
    active: '活跃记忆',
    tombstones: '已删除',
    scopeTitle: '记忆范围占比',
    tagsTitle: '高频标签',
    noTags: '暂无标签。',
    scopeLabels: { user: '用户', workspace: '工作区', project: '项目' }
  },
  platform: {
    title: '平台分析',
    description: '技能、模型与工作区变更。',
    model: '当前模型',
    skills: '已安装技能',
    skillsUnit: '个',
    skillsTitle: '技能分类占比',
    noSkills: '暂无已安装技能。',
    changesTitle: '工作区变更趋势',
    changesUnit: '次变更'
  },
  insights: {
    title: '洞察',
    description: '基于当前数据的自动观察。',
    empty: '暂无可展示的洞察。',
    kinds: { observation: '观察', warning: '提醒', action: '建议' }
  },
  charts: {
    empty: '暂无数据',
    total: '合计'
  }
}

const analyticsCopyEn: AnalyticsCopy = {
  page: {
    eyebrow: 'Learning Insights',
    title: 'Learning Analytics',
    back: 'Back to study room',
    refresh: 'Refresh',
    refreshing: 'Refreshing learning analytics',
    loaded: 'Learning analytics updated',
    failed: 'Learning analytics failed to load',
    apiUnavailable: 'Learning Analytics is unavailable',
    apiUnavailableDetail: 'This app does not provide the Learning Analytics API. Update the app or contact your administrator.',
    requestFailedDetail: 'The analytics service could not respond. Try again later.',
    skip: 'Skip to analytics content',
    updated: 'Updated',
    notGenerated: 'Not generated yet',
    rangeLabel: 'Date range',
    description: 'A summary of your focus sessions, task rhythm, model usage, and knowledge.',
    demo: 'Sample',
    demoExit: 'Exit sample',
    demoActive: 'Sample mode',
    demoLoaded: 'Showing sample multi-day analytics data'
  },
  ranges: {
    today: 'Today', week: '7 days', month: '30 days', all: 'All time'
  },
  states: {
    loading: 'Loading',
    unavailableReasons: unavailableReasonsEn
  },
  section: {
    loading: 'Loading',
    empty: 'No learning activity was recorded in the selected range.',
    partial: 'Some sources are incomplete; results may have gaps.',
    error: 'This section failed to load.',
    retry: 'Retry'
  },
  hero: {
    title: 'Overview',
    focus: 'Focus time',
    sessions: 'Focus sessions',
    sessionsUnit: '',
    streak: 'Streak',
    days: 'days',
    level: 'Level',
    levelUnit: '',
    tokens: 'Token usage',
    tasks: 'Task completion',
    noTasks: 'No tasks',
    current: 'Current',
    inRange: 'Selected range',
    levelProgressTitle: 'Level progress',
    currentXp: 'Current XP',
    nextLevelXp: 'Next level at',
    xpToNext: 'XP to next',
    comparisonUp: 'vs prev +',
    comparisonDown: 'vs prev −',
    comparisonFlat: 'Unchanged vs previous'
  },
  focus: {
    title: 'Focus analytics',
    description: 'Distribution, rhythm, and structure of your focus sessions.',
    heatmapTitle: 'Focus calendar heatmap',
    heatmapLegendLess: 'Less',
    heatmapLegendMore: 'More',
    trendTitle: 'Focus trend',
    trendFocus: 'Focus time',
    trendTokens: 'Token usage',
    hourTitle: 'Focus by hour of day',
    hourPeak: 'Peak',
    hourNoPeak: 'No peak hour yet',
    activeRangeHourAxis: 'Hours today',
    activeRangeDayAxis: 'Dates',
    structureTitle: 'Session structure',
    structureChartTitle: 'Completed vs interrupted',
    completed: 'Completed',
    interrupted: 'Interrupted',
    canceled: 'Canceled',
    completionRate: 'Completion rate',
    avgSession: 'Avg. session',
    breakTime: 'Break time',
    weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    percentileTitle: 'Focus percentile',
    percentileCenterLabel: 'of peers',
    percentileRemaining: (ticks) => (ticks <= 0 ? 'At the top' : `${ticks} ticks to go`),
    percentileFooter: 'ONE TICK = 1% · INKED = AHEAD',
    percentileEmpty: 'No peer comparison yet',
    percentileTooltip: (percent) => `Ahead of ${percent}% of peers in focus time`
  },
  tokens: {
    title: 'Token usage',
    description: 'Model token usage distribution.',
    total: 'Total tokens',
    today: "Today's tokens",
    providerCalls: 'Model calls',
    toolCalls: 'Tool calls',
    trendTitle: 'Token usage trend',
    unknownModel: 'Unlabeled model',
    byToolTitle: 'Tool call ranking',
    byWorkspaceTitle: 'Workspace usage ranking',
    noToolShare: 'No tool calls yet.',
    noWorkspaceShare: 'No workspace token share yet.',
    toolCallsUnit: 'calls',
    toolErrorsUnit: 'errors'
  },
  tasks: {
    title: 'Task analytics',
    description: 'Current task state and flow rhythm.',
    open: 'Open',
    completed: 'Completed',
    overdue: 'Overdue',
    completionRate: 'Completion rate',
    flowTitle: 'Task flow',
    created: 'Created',
    reopened: 'Reopened',
    deleted: 'Deleted',
    noTopTasks: 'No tasks with attributed focus yet. Select a task and finish a focus session to see time share.',
    noCompletionShare: 'No task completions yet. Check tasks off the list to see completion share.',
    byTaskTitle: 'Focus by task',
    byCategoryTitle: 'Focus by category',
    byTaskCompletionTitle: 'Completions by task',
    byCategoryCompletionTitle: 'Completions by category',
    shareViewTask: 'By task',
    shareViewCategory: 'By category',
    shareViewLabel: 'Ranking dimension',
    noCategoryShare: 'No task-category focus share yet.',
    completionCountUnit: 'x',
    uncategorized: 'Uncategorized',
    planTitle: 'Plan vs execution',
    planVsExecLabel: 'Scheduled block',
    planned: 'Planned',
    executed: 'Executed focus',
    noPlan: 'No plan vs execution data yet.'
  },
  review: {
    title: 'Review analytics',
    description: 'Review card answers and accuracy.',
    accuracy: 'Accuracy',
    answered: 'Answered',
    correct: 'Correct',
    cards: 'Review cards',
    byLessonTitle: 'Accuracy by lesson',
    noLessons: 'No review activity yet.'
  },
  memory: {
    title: 'Memory analytics',
    description: 'Scale, scope, and tags of AI memory.',
    active: 'Active memories',
    tombstones: 'Deleted',
    scopeTitle: 'Memory scope share',
    tagsTitle: 'Top tags',
    noTags: 'No tags yet.',
    scopeLabels: { user: 'User', workspace: 'Workspace', project: 'Project' }
  },
  platform: {
    title: 'Platform analytics',
    description: 'Skills, model, and workspace changes.',
    model: 'Current model',
    skills: 'Installed skills',
    skillsUnit: '',
    skillsTitle: 'Skill category share',
    noSkills: 'No installed skills.',
    changesTitle: 'Workspace change trend',
    changesUnit: 'changes'
  },
  insights: {
    title: 'Insights',
    description: 'Automatic observations from your current data.',
    empty: 'No insights to show yet.',
    kinds: { observation: 'Observation', warning: 'Heads up', action: 'Suggestion' }
  },
  charts: {
    empty: 'No data',
    total: 'Total'
  }
}

export function getAnalyticsCopy(locale: string): AnalyticsCopy {
  return locale.toLowerCase().startsWith('en') ? analyticsCopyEn : analyticsCopy
}

export type { AnalyticsCopy }
