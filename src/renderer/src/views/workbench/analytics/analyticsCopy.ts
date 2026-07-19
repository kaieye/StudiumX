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
    modeTitle: string
    roomTitle: string
    signalTitle: string
    structureTitle: string
    completed: string
    interrupted: string
    canceled: string
    completionRate: string
    avgSession: string
    breakTime: string
    weekdays: readonly [string, string, string, string, string, string, string]
    modeLabels: Record<string, string>
    roomLabels: Record<string, string>
    signalLabels: Record<string, string>
  }
  tokens: {
    title: string
    description: string
    total: string
    today: string
    providerCalls: string
    toolCalls: string
    trendTitle: string
    byToolTitle: string
    byWorkspaceTitle: string
    toolCallsUnit: string
    toolErrorsUnit: string
    efficiencyTitle: string
    avgPerConversation: string
    avgPerMessage: string
    toolErrorRate: string
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
    topTasksTitle: string
    noTopTasks: string
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

const modeLabelsZh: Record<string, string> = {
  free: '自由学习', sync: '同步自习', deepwork: '深度工作', exam: '考试冲刺'
}
const roomLabelsZh: Record<string, string> = {
  silent: '静音自习', sprint: '冲刺房', deep: '深度房', exam: '考试房'
}
const signalLabelsZh: Record<string, string> = {
  reading: '阅读', writing: '写作', practice: '练习', review: '复习', exam: '考试'
}
const modeLabelsEn: Record<string, string> = {
  free: 'Free study', sync: 'Synced study', deepwork: 'Deep work', exam: 'Exam sprint'
}
const roomLabelsEn: Record<string, string> = {
  silent: 'Silent room', sprint: 'Sprint room', deep: 'Deep room', exam: 'Exam room'
}
const signalLabelsEn: Record<string, string> = {
  reading: 'Reading', writing: 'Writing', practice: 'Practice', review: 'Review', exam: 'Exam'
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
    description: '汇总你的专注时段、任务节奏、模型消耗与知识沉淀。'
  },
  ranges: {
    today: '今天', week: '本周', month: '本月', '90d': '近 90 天', all: '全部'
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
    inRange: '所选范围'
  },
  focus: {
    title: '专注分析',
    description: '专注时段的分布、节律与结构。',
    heatmapTitle: '专注日历热力图',
    heatmapLegendLess: '少',
    heatmapLegendMore: '多',
    trendTitle: '专注与 Token 趋势',
    trendFocus: '专注时长',
    trendTokens: 'Token 消耗',
    hourTitle: '一天中的专注分布',
    hourPeak: '高峰',
    hourNoPeak: '暂无高峰时段',
    modeTitle: '学习模式占比',
    roomTitle: '自习室占比',
    signalTitle: '学习信号占比',
    structureTitle: '会话结构',
    completed: '已完成',
    interrupted: '被打断',
    canceled: '已取消',
    completionRate: '完成率',
    avgSession: '平均专注时长',
    breakTime: '休息时长',
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    modeLabels: modeLabelsZh,
    roomLabels: roomLabelsZh,
    signalLabels: signalLabelsZh
  },
  tokens: {
    title: 'Token 消耗',
    description: '模型调用的 Token 使用与效率。',
    total: '总 Token 量',
    today: '今日 Token 量',
    providerCalls: '模型调用',
    toolCalls: '工具调用',
    trendTitle: 'Token 使用趋势',
    byToolTitle: '工具调用占比',
    byWorkspaceTitle: '工作区消耗占比',
    toolCallsUnit: '次调用',
    toolErrorsUnit: '次错误',
    efficiencyTitle: '效率',
    avgPerConversation: '每次对话平均',
    avgPerMessage: '每条消息平均',
    toolErrorRate: '工具错误率'
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
    topTasksTitle: '专注投入最多的任务',
    noTopTasks: '尚无带专注归属的任务。'
  },
  review: {
    title: '复习分析',
    description: '复习卡片的作答与正确率。',
    accuracy: '正确率',
    answered: '已作答',
    correct: '答对',
    cards: '复习卡片',
    byLessonTitle: '按课程',
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
    empty: '暂无数据'
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
    description: 'A summary of your focus sessions, task rhythm, model usage, and knowledge.'
  },
  ranges: {
    today: 'Today', week: 'This week', month: 'This month', '90d': 'Last 90 days', all: 'All time'
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
    inRange: 'Selected range'
  },
  focus: {
    title: 'Focus analytics',
    description: 'Distribution, rhythm, and structure of your focus sessions.',
    heatmapTitle: 'Focus calendar heatmap',
    heatmapLegendLess: 'Less',
    heatmapLegendMore: 'More',
    trendTitle: 'Focus & token trend',
    trendFocus: 'Focus time',
    trendTokens: 'Token usage',
    hourTitle: 'Focus by hour of day',
    hourPeak: 'Peak',
    hourNoPeak: 'No peak hour yet',
    modeTitle: 'Study mode share',
    roomTitle: 'Study room share',
    signalTitle: 'Learning signal share',
    structureTitle: 'Session structure',
    completed: 'Completed',
    interrupted: 'Interrupted',
    canceled: 'Canceled',
    completionRate: 'Completion rate',
    avgSession: 'Avg. session',
    breakTime: 'Break time',
    weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    modeLabels: modeLabelsEn,
    roomLabels: roomLabelsEn,
    signalLabels: signalLabelsEn
  },
  tokens: {
    title: 'Token usage',
    description: 'Model token usage and efficiency.',
    total: 'Total tokens',
    today: "Today's tokens",
    providerCalls: 'Model calls',
    toolCalls: 'Tool calls',
    trendTitle: 'Token usage trend',
    byToolTitle: 'Tool call share',
    byWorkspaceTitle: 'Workspace usage share',
    toolCallsUnit: 'calls',
    toolErrorsUnit: 'errors',
    efficiencyTitle: 'Efficiency',
    avgPerConversation: 'Avg. per conversation',
    avgPerMessage: 'Avg. per message',
    toolErrorRate: 'Tool error rate'
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
    topTasksTitle: 'Top tasks by focus',
    noTopTasks: 'No tasks with attributed focus yet.'
  },
  review: {
    title: 'Review analytics',
    description: 'Review card answers and accuracy.',
    accuracy: 'Accuracy',
    answered: 'Answered',
    correct: 'Correct',
    cards: 'Review cards',
    byLessonTitle: 'By lesson',
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
    empty: 'No data'
  }
}

export function getAnalyticsCopy(locale: string): AnalyticsCopy {
  return locale.toLowerCase().startsWith('en') ? analyticsCopyEn : analyticsCopy
}

export type { AnalyticsCopy }
