import { useTranslation } from 'react-i18next'
import type { AnalyticsSectionDataMap, AnalyticsSectionId, AnalyticsSectionResult, LearningAnalyticsQuery } from './types'
import { createAnalyticsI18n } from './i18n'
import {
  FocusHeatmap,
  type FocusHeatmapLabels,
  type CoreFocusHeatmapCell
} from './components/FocusHeatmap'
import { FocusTrendChart, type FocusTrendLabels } from './components/FocusTrendChart'
import { TimeOfDayChart, type TimeOfDayLabels } from './components/TimeOfDayChart'
import { FocusStructure, type FocusStructureLabels } from './components/FocusStructure'
import { GrowthSummary, type GrowthSummaryLabels } from './components/GrowthSummary'
import { TokenAnalytics } from './components/TokenAnalytics'
import { InsightsPanel } from './components/InsightsPanel'
import { TaskAnalytics } from './components/TaskAnalytics'
import { AssetAnalytics } from './components/AssetAnalytics'
import { ReviewAnalytics } from './components/ReviewAnalytics'
import { MemoryAnalytics } from './components/MemoryAnalytics'
import { SkillsAnalytics } from './components/SkillsAnalytics'
import { PresenceAnalytics } from './components/PresenceAnalytics'
import type { AnalyticsIntlFormatters, AnalyticsLabels, AnalyticsPanelState } from './i18n'

export type BuiltInAnalyticsSlotProps<K extends AnalyticsSectionId> = {
  sectionId: K
  result: Extract<AnalyticsSectionResult<AnalyticsSectionDataMap[K]>, { state: 'available' | 'empty' | 'partial' }>
  query: LearningAnalyticsQuery
  isRefreshing: boolean
  isStale: boolean
  onRetry: () => void
  sectionResults?: Partial<Record<AnalyticsSectionId, { state: 'available' | 'empty' | 'partial' | 'unavailable' | 'error' }>>
}

const coreStateLabels = (en: boolean) => ({
  empty: en ? 'No activity in this range.' : '所选范围内暂无活动。',
  partial: en ? 'Data is usable but coverage is incomplete.' : '数据可用，但覆盖范围不完整。',
  unavailable: en ? 'This data is unavailable.' : '此数据暂不可用。',
  error: en ? 'Analytics failed to load.' : '分析加载失败。'
})

function coreLabels(en: boolean) {
  const state = coreStateLabels(en)
  const missing = en ? 'Not covered' : '未覆盖'
  const zero = en ? '0 seconds' : '0 秒'
  return {
    heatmap: {
      ...state,
      grid: en ? 'Focus heatmap' : '专注热力图', instructions: en ? 'Use arrow keys to move across dates.' : '使用方向键浏览日期。', chartView: en ? 'Chart' : '图表', tableView: en ? 'Table' : '表格',
      dataStart: (date: string) => en ? `Tracking starts ${date}` : `开始记录于 ${date}`, today: en ? 'Today' : '今天', selected: en ? 'Selected' : '已选中', future: en ? 'Future' : '未来', missing, zero, partialCell: en ? 'Partial coverage' : '部分覆盖', covered: en ? 'Covered' : '已覆盖',
      drilldownTitle: (date: string) => en ? `Focus details for ${date}` : `${date} 专注详情`, closeDrilldown: en ? 'Close details' : '关闭详情', dateColumn: en ? 'Date' : '日期', focusColumn: en ? 'Focus' : '专注', sessionsColumn: en ? 'Sessions' : '次数', tasksColumn: en ? 'Tasks' : '任务', statusColumn: en ? 'Status' : '状态', tableCaption: en ? 'Focus heatmap data' : '专注热力图数据'
    } satisfies FocusHeatmapLabels,
    trend: {
      ...state,
      chart: en ? 'Focus trend' : '专注趋势', dailyGrain: en ? 'Daily' : '按日', weeklyGrain: en ? 'Weekly' : '按周', target: en ? 'Target' : '目标', running: en ? 'Running now' : '正在进行', missing, zero, partialPoint: en ? 'Partial coverage' : '部分覆盖', showTable: en ? 'Show table' : '显示表格', hideTable: en ? 'Hide table' : '隐藏表格', tableCaption: en ? 'Focus trend data' : '专注趋势数据', dateColumn: en ? 'Date' : '日期', focusColumn: en ? 'Focus' : '专注', sessionsColumn: en ? 'Sessions' : '次数', statusColumn: en ? 'Status' : '状态'
    } satisfies FocusTrendLabels,
    time: {
      ...state,
      distribution: en ? 'Focus by hour' : '按小时专注分布', missing, zero, partialHour: en ? 'Partial' : '部分', bestPeriod: en ? 'Best period' : '最佳时段', bestUnavailable: en ? 'Insufficient coverage' : '覆盖不足', crossMidnightOwnership: en ? 'Hours use local date ownership.' : '小时按本地日期归属。', coverageNote: en ? 'Coverage is incomplete' : '覆盖不完整'
    } satisfies TimeOfDayLabels,
    structure: {
      ...state,
      unknown: en ? 'Unknown' : '未知', missing, focus: en ? 'Focus' : '专注', break: en ? 'Break' : '休息', paused: en ? 'Paused' : '暂停', completed: en ? 'Completed' : '完成', interrupted: en ? 'Interrupted' : '中断', canceled: en ? 'Canceled' : '取消', completionRate: en ? 'Completion rate' : '完成率', interruptionRate: en ? 'Interruption rate' : '中断率', taskAttribution: en ? 'Task attribution' : '任务归因', attributed: en ? 'Attributed' : '已归因', unattributed: en ? 'Unattributed' : '未归因', topTasks: en ? 'Top tasks' : '重点任务', noAttributedTasks: en ? 'No explicitly attributed tasks.' : '没有显式归因任务。'
    } satisfies FocusStructureLabels,
    growth: {
      ...state,
      rangeXp: en ? 'XP earned in range' : '区间获得经验', rangeBasis: (value: string) => en ? `Selected range · ${value}` : `所选区间 · ${value}`, currentBasis: (value: string) => en ? `Current as of ${value}` : `当前状态 · ${value}`, currentXp: en ? 'Current XP' : '当前经验', currentLevel: en ? 'Current level' : '当前等级', levelProgress: en ? 'Level progress' : '等级进度', currentStreak: en ? 'Current streak' : '当前连胜', badges: en ? 'Badges' : '徽章', plantStage: en ? 'Plant stage' : '植物阶段', unlockedBadge: en ? 'Unlocked' : '已解锁', lockedBadge: en ? 'Locked' : '未解锁', noBadges: en ? 'No badges recorded.' : '暂无徽章记录。', missing, legacyUtcStreakWarning: en ? 'Legacy streak semantics may use UTC dates.' : '旧版连胜口径可能使用 UTC 日期。'
    } satisfies GrowthSummaryLabels
  }
}

function panelState(result: { state: 'available' | 'empty' | 'partial' }): AnalyticsPanelState {
  return result.state
}

function formattersFor(i18n: ReturnType<typeof createAnalyticsI18n>): AnalyticsIntlFormatters {
  return i18n.formatters
}

function FocusSlot({ result, query }: BuiltInAnalyticsSlotProps<'focus'>) {
  const { i18n: reactI18n } = useTranslation()
  const locale = reactI18n.language.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
  const english = locale === 'en-US'
  const labels = coreLabels(english)
  const intl = createAnalyticsI18n(locale, { timeZone: query.calendarContext.timeZone })
  const data = result.data
  if (!data || !Array.isArray(data.heatmap) || !Array.isArray(data.trend) || !Array.isArray(data.hourBuckets) || !data.sessionStructure || !data.currentGrowth) {
    return <div className="analytics-module-slot" data-analytics-slot="focus" role="status">{labels.heatmap.unavailable}</div>
  }
  const cells: CoreFocusHeatmapCell[] = data.heatmap.map((cell) => ({ ...cell, intensity: cell.isCovered ? Math.min(4, Math.ceil(cell.focusSeconds / 3600)) as 0 | 1 | 2 | 3 | 4 : 0, coverage: cell.isCovered ? 'covered' : 'uncovered', tooltip: `${intl.formatters.localDate(cell.date)} · ${intl.formatters.duration(cell.focusSeconds)}` }))
  const points = data.trend.map((point) => ({ ...point, coverage: cells.find((cell) => cell.date === point.date)?.coverage ?? 'uncovered' as 'covered' | 'uncovered' }))
  const hours = data.hourBuckets.map((seconds, hour) => ({ hour, seconds, coverage: result.coverage.complete ? 'covered' as const : 'uncovered' as const }))
  const totalFocus = data.sessionStructure.focusSeconds
  const dimensionGroups = [
    { id: 'mode', label: english ? 'Mode' : '模式', items: data.modeBreakdown.map((item) => ({ id: item.id, label: item.id, seconds: item.seconds, share: item.share, kind: 'known' as const })) },
    { id: 'room', label: english ? 'Room' : '房间', items: data.roomBreakdown.map((item) => ({ id: item.id, label: item.id, seconds: item.seconds, share: item.share, kind: 'known' as const })) },
    { id: 'signal', label: english ? 'Signal' : '信号', items: data.signalBreakdown.map((item) => ({ id: item.id, label: item.id, seconds: item.seconds, share: item.share, kind: 'known' as const })) }
  ]
  return <div className="analytics-focus-slot">
    <FocusHeatmap state={result.state} cells={cells} localToday={query.calendarContext.localToday} dataStartDate={result.coverage.dataStartDate} weekdayLabels={(english ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['一', '二', '三', '四', '五', '六', '日']) as [string, string, string, string, string, string, string]} labels={labels.heatmap} formatters={{ date: intl.formatters.localDate, month: intl.formatters.localDate, duration: intl.formatters.duration, number: intl.formatters.number }} warnings={result.warnings.map((warning) => warning.message)} />
    <FocusTrendChart state={result.state} points={points} grain="day" summary={intl.formatters.duration(totalFocus)} labels={labels.trend} formatters={{ date: (date, grain) => grain === 'week' ? intl.formatters.localDate(date) : intl.formatters.localDate(date), duration: intl.formatters.duration, number: intl.formatters.number }} warnings={result.warnings.map((warning) => warning.message)} />
    <TimeOfDayChart state={result.state} buckets={hours} labels={labels.time} formatters={{ hour: (hour) => `${hour}:00`, duration: intl.formatters.duration }} warnings={result.warnings.map((warning) => warning.message)} />
    <FocusStructure state={result.state} dimensionGroups={dimensionGroups} session={{ focusSeconds: data.sessionStructure.focusSeconds, breakSeconds: data.sessionStructure.breakSeconds, pausedSeconds: null, completed: data.sessionStructure.completed, interrupted: data.sessionStructure.interrupted, canceled: data.sessionStructure.canceled, completionRate: data.sessionStructure.completionRate, interruptionRate: data.sessionStructure.interrupted + data.sessionStructure.canceled > 0 ? (data.sessionStructure.interrupted + data.sessionStructure.canceled) / Math.max(1, data.sessionStructure.completed + data.sessionStructure.interrupted + data.sessionStructure.canceled) : null }} taskAttribution={{ attributedSeconds: null, unattributedSeconds: null, topTasks: [] }} labels={labels.structure} formatters={{ duration: intl.formatters.duration, number: intl.formatters.number, percent: intl.formatters.percent }} warnings={result.warnings.map((warning) => warning.message)} />
    <GrowthSummary state={result.state} rangeXp={data.daily.reduce((sum, day) => sum + day.xpEarned, 0)} current={data.currentGrowth} rangeLabel={intl.formatters.localDate(query.range.from)} currentAsOfLabel={intl.formatters.instant(new Date().toISOString())} labels={labels.growth} formatters={{ number: intl.formatters.number, percent: intl.formatters.percent, xp: intl.formatters.number, days: intl.formatters.number }} warnings={result.warnings.map((warning) => warning.message)} />
  </div>
}

export function AnalyticsSectionSlot<K extends AnalyticsSectionId>(props: BuiltInAnalyticsSlotProps<K>) {
  const { i18n: reactI18n } = useTranslation()
  const locale = reactI18n.language.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
  const intl = createAnalyticsI18n(locale, { timeZone: props.query.calendarContext.timeZone })
  const labels: AnalyticsLabels = intl.labels
  const common = { labels, formatters: formattersFor(intl), onRetry: props.onRetry, retryable: true, warnings: props.result.warnings }
  switch (props.sectionId) {
    case 'focus': return <FocusSlot {...props as BuiltInAnalyticsSlotProps<'focus'>} />
    case 'tokens': return <TokenAnalytics result={props.result as BuiltInAnalyticsSlotProps<'tokens'>['result']} query={props.query} isRefreshing={props.isRefreshing} isStale={props.isStale} onRetry={props.onRetry} formatters={{ number: labels.common.tokenUnit === 'tokens' ? intl.formatters.number : intl.formatters.number, compactNumber: intl.formatters.compactNumber, localDate: intl.formatters.localDate, duration: (milliseconds) => intl.formatters.duration(milliseconds / 1000), percent: (value) => value === null ? labels.common.unknown : intl.formatters.percent(value) }} />
    case 'tasks': return <TaskAnalytics result={props.result as BuiltInAnalyticsSlotProps<'tasks'>['result']} />
    case 'workspace_assets': return <AssetAnalytics result={props.result as BuiltInAnalyticsSlotProps<'workspace_assets'>['result']} />
    case 'review': return <ReviewAnalytics result={props.result as BuiltInAnalyticsSlotProps<'review'>['result']} />
    case 'memory': {
      const result = props.result as BuiltInAnalyticsSlotProps<'memory'>['result']
      return <MemoryAnalytics {...common} state={panelState(result)} data={result.data} asOfLabel={intl.formatters.instant(new Date().toISOString())} emptyReason={result.state === 'empty' ? result.reason : undefined} />
    }
    case 'platform': {
      const result = props.result as BuiltInAnalyticsSlotProps<'platform'>['result']
      const data = result.data
      return <SkillsAnalytics {...common} state={panelState(result)} data={{ skills: data.skills, pet: data.pet, model: data.model, workspaceChanges: data.workspaceChanges, connectors: data.connectors }} rangeLabel={intl.formatters.localDate(props.query.range.from)} asOfLabel={intl.formatters.instant(new Date().toISOString())} emptyReason={result.state === 'empty' ? result.reason : undefined} />
    }
    case 'presence': {
      const result = props.result as BuiltInAnalyticsSlotProps<'presence'>['result']
      return <PresenceAnalytics {...common} state={panelState(result)} data={result.data} emptyReason={result.state === 'empty' ? result.reason : undefined} />
    }
    case 'insights': {
      const result = props.result as BuiltInAnalyticsSlotProps<'insights'>['result']
      return <InsightsPanel {...common} state={panelState(result)} data={result.data} evidenceStates={Object.fromEntries(Object.entries(props.sectionResults ?? {}).map(([sectionId, result]) => [sectionId, result.state]))} coverage={result.coverage} emptyReason={result.state === 'empty' ? result.reason : undefined} />
    }
    default: return null
  }
}

