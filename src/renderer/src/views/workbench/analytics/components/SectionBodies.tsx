import { useState } from 'react'
import type { AnalyticsCopy } from '../analyticsCopy'
import { addLocalDays, buildAnalyticsDateRange } from '../useStudyAnalytics'
import type { AnalyticsFormatters } from '../chartFormatters'
import type {
  AnalyticsLocalDate,
  AnalyticsRangePreset,
  FocusAnalytics,
  LearningAnalyticsHero,
  MemoryAnalytics,
  PlatformAnalytics,
  ReviewAnalytics,
  TaskAnalytics,
  TaskPlanAnalytics,
  TokenAnalytics
} from '../types'
import { ActiveRangeChart } from '../charts/ActiveRangeChart'
import { CalendarHeatmap } from '../charts/CalendarHeatmap'
import { DonutChart, type DonutSlice } from '../charts/DonutChart'
import { DumbbellChart } from '../charts/DumbbellChart'
import { ProgressGauge } from '../charts/ProgressGauge'
import { MorphPieChart } from '../charts/MorphPieChart'
import { TickGaugeChart } from '../charts/TickGaugeChart'
import { RankBarChart } from '../charts/RankBarChart'
import { StackedBarChart } from '../charts/StackedBarChart'

type Ctx = {
  copy: AnalyticsCopy
  fmt: AnalyticsFormatters
  localToday: AnalyticsLocalDate
}

function Stat({
  label,
  value,
  hint,
  tone = 'default'
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'ok' | 'warn' | 'alert'
}) {
  const valueClass =
    tone === 'default' ? 'analytics-stat__value' : `analytics-stat__value analytics-stat__value--${tone}`
  return (
    <div className="analytics-stat">
      <span className="analytics-stat__label">{label}</span>
      <strong className={valueClass}>{value}</strong>
      {hint ? <small className="analytics-stat__hint">{hint}</small> : null}
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function comparisonHint(
  comparison: { absoluteChange: number; ratioChange: number | null } | undefined,
  fmt: AnalyticsFormatters,
  copy: AnalyticsCopy,
  formatValue: (value: number) => string
): string | undefined {
  if (!comparison) return undefined
  const { absoluteChange, ratioChange } = comparison
  if (absoluteChange === 0) return copy.hero.comparisonFlat
  const direction = absoluteChange > 0 ? copy.hero.comparisonUp : copy.hero.comparisonDown
  const magnitude = formatValue(Math.abs(absoluteChange))
  const ratio =
    ratioChange === null || !Number.isFinite(ratioChange)
      ? ''
      : ` (${fmt.percent(Math.abs(ratioChange))})`
  return `${direction} ${magnitude}${ratio}`
}

/* ---------------------------------------------------------------- Hero --- */

export function HeroBody({ data, copy, fmt }: Ctx & { data: LearningAnalyticsHero }) {
  // Only show comparative deltas; omit static "current" / "in range" footnotes under cards.
  const focusHint = comparisonHint(data.focusComparison, fmt, copy, fmt.duration)
  const tokenHint = comparisonHint(data.tokenComparison, fmt, copy, fmt.compact)

  return (
    <div className="analytics-hero">
      <div className="analytics-hero-grid">
        <Stat label={copy.hero.focus} value={fmt.duration(data.focusSeconds)} hint={focusHint} />
        <Stat
          label={copy.hero.sessions}
          value={`${fmt.integer(data.completedFocusSessions)}${copy.hero.sessionsUnit ? ` ${copy.hero.sessionsUnit}` : ''}`}
        />
        <Stat label={copy.hero.tokens} value={fmt.compact(data.totalTokens)} hint={tokenHint} />
        <Stat
          label={copy.hero.streak}
          value={`${fmt.integer(data.currentStreakDays)} ${copy.hero.days}`}
          tone="ok"
        />
        <Stat
          label={copy.hero.tasks}
          value={fmt.percent(data.currentTaskCompletionRate)}
          tone={(data.currentTaskCompletionRate ?? 0) >= 0.7 ? 'ok' : (data.currentTaskCompletionRate ?? 0) > 0 ? 'warn' : 'default'}
        />
        <Stat label={copy.hero.currentXp} value={fmt.integer(data.currentXp)} />
      </div>
    </div>
  )
}

/** Level progress ring as a peer card beside the overview section. */
export function LevelBody({ data, copy, fmt }: Ctx & { data: LearningAnalyticsHero }) {
  const level = data.currentLevel
  const levelProgress = Number.isFinite(level.progress) ? level.progress : null
  const levelTone: 'default' | 'ok' | 'warn' =
    (levelProgress ?? 0) >= 0.7 ? 'ok' : (levelProgress ?? 0) > 0 ? 'warn' : 'default'
  const levelCenter = `${fmt.integer(level.level)}${copy.hero.levelUnit ? ` ${copy.hero.levelUnit}` : ''}`
  const fillTooltip = `${copy.hero.currentXp}: ${fmt.integer(level.currentXp)}`
  const trackTooltip = `${copy.hero.nextLevelXp}: ${fmt.integer(level.xpAtNextLevel)}`

  return (
    <div className="analytics-level-card">
      <ProgressGauge
        progress={levelProgress}
        title={copy.hero.levelProgressTitle}
        centerValue={levelCenter}
        centerLabel={fmt.percent(levelProgress)}
        emptyLabel={copy.charts.empty}
        tone={levelTone}
        fillTooltip={fillTooltip}
        trackTooltip={trackTooltip}
      />
    </div>
  )
}

/* --------------------------------------------------------------- Focus --- */

export function FocusBody({
  data,
  plan,
  tasks,
  selfPercentile = null,
  rangePreset,
  copy,
  fmt,
  localToday
}: Ctx & {
  data: FocusAnalytics
  /** Plan vs execution lives with task schedule history; shown in focus for proximity to time spent. */
  plan?: TaskPlanAnalytics | null
  /** Task/category share pie sits beside the hour distribution for time-attribution context. */
  tasks?: TaskAnalytics | null
  /** Live peer percentile from presence snapshot (0–1). Null keeps the hub card in its explicit empty state. */
  selfPercentile?: number | null
  /** The selected page range controls active-range chart density. */
  rangePreset: AnalyticsRangePreset
}) {
  const [shareView, setShareView] = useState<'task' | 'category'>('task')
  const planItems = plan
    ? [
        {
          id: 'plan-vs-exec',
          label: copy.tasks.planVsExecLabel,
          before: plan.plannedSeconds,
          after: plan.attributedFocusSeconds
        }
      ]
    : []

  // Prefer attributed focus-time slices; fall back to checklist completion counts so
  // checking tasks on the list produces a visible share pie without a focus run.
  const hasFocusShare = Boolean(tasks?.topByAttributedFocus.some((task) => task.focusSeconds > 0))
  const taskShareMode: 'focus' | 'completion' = hasFocusShare ? 'focus' : 'completion'
  const taskFocusItems = !tasks
    ? []
    : hasFocusShare
      ? tasks.topByAttributedFocus.map((task) => ({
          id: task.taskId,
          label: task.title,
          value: task.focusSeconds
        }))
      : tasks.topByCompletion.map((task) => ({
          id: task.taskId,
          label: task.title,
          value: task.completionCount
        }))
  const categoryFocusItems = !tasks
    ? []
    : hasFocusShare
      ? tasks.byCategoryFocus.map((entry) => ({
          id: entry.categoryId,
          label:
            entry.categoryId === 'uncategorized'
              ? copy.tasks.uncategorized
              : entry.label || entry.categoryId,
          value: entry.focusSeconds
        }))
      : tasks.byCategoryCompletion.map((entry) => ({
          id: entry.categoryId,
          label:
            entry.categoryId === 'uncategorized'
              ? copy.tasks.uncategorized
              : entry.label || entry.categoryId,
          value: entry.completionCount
        }))
  const taskChartTitle = taskShareMode === 'focus' ? copy.tasks.byTaskTitle : copy.tasks.byTaskCompletionTitle
  const categoryChartTitle =
    taskShareMode === 'focus' ? copy.tasks.byCategoryTitle : copy.tasks.byCategoryCompletionTitle
  const chartTitle = shareView === 'task' ? taskChartTitle : categoryChartTitle
  const chartItems = shareView === 'task' ? taskFocusItems : categoryFocusItems
  const formatShareValue =
    taskShareMode === 'focus'
      ? fmt.duration
      : (value: number) => `${fmt.integer(value)}${copy.tasks.completionCountUnit}`
  const emptyShareLabel = !tasks
    ? copy.charts.empty
    : taskShareMode === 'focus'
      ? copy.tasks.noTopTasks
      : copy.tasks.noCompletionShare

  return (
    <div className="analytics-focus">
      <div className="analytics-subcard analytics-focus__heatmap">
        <div className="analytics-focus__heatmap-header">
          <h3 className="analytics-subcard__title">{copy.focus.heatmapTitle}</h3>
          <div className="calendar-heatmap__legend analytics-focus__heatmap-legend" aria-hidden="true">
            <span>{copy.focus.heatmapLegendLess}</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className="calendar-heatmap__cell is-legend" data-level={level} />
            ))}
            <span>{copy.focus.heatmapLegendMore}</span>
          </div>
        </div>
        <CalendarHeatmap
          cells={data.heatmap.map((cell) => ({
            date: cell.date,
            value: cell.focusSeconds,
            sessions: cell.completedFocusSessions,
            tasksCompleted: cell.tasksCompleted,
            isCovered: cell.isCovered
          }))}
          localToday={localToday}
          weekdayLabels={copy.focus.weekdays}
          title={copy.focus.heatmapTitle}
          formatDate={fmt.longDate}
          formatMonth={fmt.month}
          formatValue={fmt.duration}
          legendLess={copy.focus.heatmapLegendLess}
          legendMore={copy.focus.heatmapLegendMore}
          emptyLabel={copy.charts.empty}
          hideLegend
        />
      </div>

      <div className="analytics-subcard analytics-focus__plan">
        <div className="analytics-focus__plan-header">
          <h3 className="analytics-subcard__title">{copy.tasks.planTitle}</h3>
          <div className="dumbbell-chart__legend analytics-focus__plan-legend" aria-hidden="true">
            <span className="dumbbell-chart__swatch dumbbell-chart__swatch--before" />
            <span>{copy.tasks.planned}</span>
            <span className="dumbbell-chart__swatch dumbbell-chart__swatch--after" />
            <span>{copy.tasks.executed}</span>
          </div>
        </div>
        <DumbbellChart
          items={planItems}
          title={copy.tasks.planTitle}
          beforeLabel={copy.tasks.planned}
          afterLabel={copy.tasks.executed}
          formatValue={fmt.duration}
          emptyLabel={copy.tasks.noPlan}
          hideLegend
          stackedRows
          valuesBesideLabel
        />
        {plan ? (
          <dl className="analytics-keyvalue-grid analytics-keyvalue-grid--compact">
            <KeyValue label={copy.tasks.planned} value={fmt.duration(plan.plannedSeconds)} />
            <KeyValue label={copy.tasks.executed} value={fmt.duration(plan.attributedFocusSeconds)} />
          </dl>
        ) : null}
        {tasks ? (
          <div className="analytics-stat-row analytics-focus__task-summary">
            <Stat label={copy.tasks.open} value={fmt.integer(tasks.current.open)} />
            <Stat label={copy.tasks.completed} value={fmt.integer(tasks.current.completed)} tone="ok" />
            <Stat
              label={copy.tasks.overdue}
              value={fmt.integer(tasks.current.overdue)}
              tone={tasks.current.overdue > 0 ? 'alert' : 'default'}
            />
            <Stat
              label={copy.tasks.completionRate}
              value={fmt.percent(tasks.current.completionRate)}
              tone={(tasks.current.completionRate ?? 0) >= 0.7 ? 'ok' : (tasks.current.completionRate ?? 0) > 0 ? 'warn' : 'default'}
            />
          </div>
        ) : null}
      </div>

      <div className="analytics-subcard analytics-focus__share">
        <div className="analytics-focus__share-header">
          <h3 className="analytics-subcard__title">{chartTitle}</h3>
        </div>
        <MorphPieChart
          items={chartItems}
          title={chartTitle}
          formatValue={formatShareValue}
          emptyLabel={emptyShareLabel}
        />
        <div className="analytics-focus__share-footer">
          <div
            className="analytics-focus__share-toggle"
            role="group"
            aria-label={copy.tasks.shareViewLabel}
          >
            <button
              type="button"
              className="analytics-filter-button analytics-focus__share-button"
              aria-pressed={shareView === 'task'}
              onClick={() => setShareView('task')}
            >
              {copy.tasks.shareViewTask}
            </button>
            <button
              type="button"
              className="analytics-filter-button analytics-focus__share-button"
              aria-pressed={shareView === 'category'}
              onClick={() => setShareView('category')}
            >
              {copy.tasks.shareViewCategory}
            </button>
          </div>
        </div>
      </div>

      <div className="analytics-subcard analytics-focus__hours">
        <h3 className="analytics-subcard__title">{copy.focus.hourTitle}</h3>
        <ActiveRangeChart
          series={data.activeRanges}
          rangePreset={rangePreset}
          title={copy.focus.hourTitle}
          formatCategory={(category, mode) =>
            mode === 'hour_of_day' ? fmt.axisHour(Number(category)) : fmt.axisDate(category)
          }
          formatY={(value, unit) =>
            unit === 'minute' ? fmt.minuteMark(value) : fmt.hourMark(value)
          }
          formatDuration={fmt.duration}
          rangeLabel={
            data.activeRanges.mode === 'hour_of_day'
              ? copy.focus.activeRangeHourAxis
              : copy.focus.activeRangeDayAxis
          }
          emptyLabel={copy.charts.empty}
        />
      </div>

      <div className="analytics-subcard analytics-focus__percentile">
        <h3 className="analytics-subcard__title">{copy.focus.percentileTitle}</h3>
        <TickGaugeChart
          progress={selfPercentile}
          title={copy.focus.percentileTitle}
          emptyLabel={copy.focus.percentileEmpty}
        />
      </div>
    </div>
  )
}


function buildTokenTrendDates(localToday: AnalyticsLocalDate): AnalyticsLocalDate[] {
  const range = buildAnalyticsDateRange('month', localToday)
  const dates: AnalyticsLocalDate[] = []
  for (let date = range.from; date <= range.to; date = addLocalDays(date, 1)) {
    dates.push(date)
  }
  return dates
}

function buildTokenModelSeries(
  data: TokenAnalytics,
  dates: readonly AnalyticsLocalDate[],
  unknownModelLabel: string
): Array<{ id: string; label: string; values: number[] }> {
  const modelRows = data.byDayByModel ?? []
  if (modelRows.some((row) => row.totalTokens > 0)) {
    const totals = new Map<string, number>()
    for (const row of modelRows) {
      totals.set(row.model, (totals.get(row.model) ?? 0) + row.totalTokens)
    }
    const models = [...totals.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([model]) => model)
    return models.map((model) => {
      const byDate = new Map<string, number>()
      for (const row of modelRows) {
        if (row.model !== model) continue
        byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.totalTokens)
      }
      return {
        id: model,
        label: model || unknownModelLabel,
        values: dates.map((date) => byDate.get(date) ?? 0)
      }
    })
  }

  // Fallback: one total series when model attribution is unavailable.
  const totalsByDate = new Map(data.byDay.map((row) => [row.date, row.totalTokens] as const))
  return [
    {
      id: 'total',
      label: unknownModelLabel,
      values: dates.map((date) => totalsByDate.get(date) ?? 0)
    }
  ]
}

/* -------------------------------------------------------------- Tokens --- */


export function TokenBody({ data, trendData, copy, fmt, localToday }: Ctx & {
  data: TokenAnalytics
  /** The trend is always based on the rolling 30-day token view. */
  trendData?: TokenAnalytics
}) {
  const todayRow = data.byDay.find((row) => row.date === localToday)
  const trendDates = trendData ? buildTokenTrendDates(localToday) : []
  const modelSeries = trendData
    ? buildTokenModelSeries(trendData, trendDates, copy.tokens.unknownModel)
    : []
  const workspaceItems = data.byWorkspace.map((entry) => ({
    id: entry.workspaceId,
    label: entry.name || entry.workspaceId,
    value: entry.totalTokens
  }))

  return (
    <div className="analytics-tokens">
      <div className="analytics-stat-row analytics-stat-row--tokens">
        <Stat label={copy.tokens.total} value={fmt.integer(data.totals.totalTokens)} />
        <Stat label={copy.tokens.today} value={todayRow ? fmt.integer(todayRow.totalTokens) : '—'} />
      </div>

      <div className="analytics-tokens__charts">
        <div className="analytics-subcard analytics-tokens__trend">
          <h3 className="analytics-subcard__title">{copy.tokens.trendTitle}</h3>
          <StackedBarChart
            dates={trendDates}
            series={modelSeries}
            title={copy.tokens.trendTitle}
            formatDate={fmt.shortDate}
            formatValue={fmt.integer}
            emptyLabel={copy.charts.empty}
            totalLabel={copy.charts.total}
          />
        </div>

        <div className="analytics-subcard analytics-tokens__workspace-ranking">
          <h3 className="analytics-subcard__title">{copy.tokens.byWorkspaceTitle}</h3>
          <RankBarChart
            items={workspaceItems}
            title={copy.tokens.byWorkspaceTitle}
            formatValue={fmt.integer}
            emptyLabel={copy.tokens.noWorkspaceShare}
          />
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Review --- */

export function ReviewBody({ data, copy, fmt }: Ctx & { data: ReviewAnalytics }) {
  const accuracy = data.cumulative.accuracy
  const accuracyTone: 'default' | 'ok' | 'warn' =
    (accuracy ?? 0) >= 0.8 ? 'ok' : (accuracy ?? 0) > 0 ? 'warn' : 'default'
  const lessonItems = data.byLesson.slice(0, 8).map((lesson) => ({
    id: lesson.lessonId,
    label: lesson.title ?? lesson.lessonId,
    value: Math.round((lesson.accuracy ?? 0) * 100)
  }))

  return (
    <div className="analytics-review">
      <div className="analytics-stat-row">
        <Stat
          label={copy.review.accuracy}
          value={fmt.percent(accuracy)}
          tone={accuracyTone}
        />
        <Stat label={copy.review.answered} value={fmt.integer(data.cumulative.totalAnswered)} />
        <Stat label={copy.review.correct} value={fmt.integer(data.cumulative.correct)} tone="ok" />
        <Stat label={copy.review.cards} value={fmt.integer(data.cumulative.cardCount)} />
      </div>

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{copy.review.byLessonTitle}</h3>
        {lessonItems.some((item) => item.value > 0) ? (
          <RankBarChart
            items={lessonItems}
            title={copy.review.byLessonTitle}
            formatValue={(value) => `${fmt.integer(value)}%`}
            emptyLabel={copy.review.noLessons}
          />
        ) : data.byLesson.length > 0 ? (
          <ol className="analytics-rank-list">
            {data.byLesson.slice(0, 8).map((lesson) => (
              <li key={lesson.lessonId}>
                <bdi dir="auto" className="analytics-rank-list__label">{lesson.title ?? lesson.lessonId}</bdi>
                <span className="analytics-rank-list__value">
                  {`${fmt.percent(lesson.accuracy)} · ${fmt.integer(lesson.answered)}`}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="analytics-chart-empty">{copy.review.noLessons}</p>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Memory --- */

export function MemoryBody({ data, copy, fmt }: Ctx & { data: MemoryAnalytics }) {
  const scopeSlices: DonutSlice[] = data.byScope.map((entry) => ({
    id: entry.scope,
    label: copy.memory.scopeLabels[entry.scope],
    value: entry.count
  }))
  return (
    <div className="analytics-memory">
      <div className="analytics-stat-row">
        <Stat label={copy.memory.active} value={fmt.integer(data.activeCount)} />
        <Stat label={copy.memory.tombstones} value={fmt.integer(data.tombstoneCount)} />
      </div>

      <div className="analytics-subcard analytics-focus__donuts">
        <div className="analytics-donut-cell">
          <h3 className="analytics-subcard__title">{copy.memory.scopeTitle}</h3>
          <DonutChart
            slices={scopeSlices}
            title={copy.memory.scopeTitle}
            formatValue={fmt.integer}
            emptyLabel={copy.charts.empty}
          />
        </div>
        <div className="analytics-donut-cell">
          <h3 className="analytics-subcard__title">{copy.memory.tagsTitle}</h3>
          {data.topTags.length > 0 ? (
            <ul className="analytics-tag-cloud">
              {data.topTags.slice(0, 16).map((tag) => (
                <li key={tag.tag}>
                  <bdi dir="auto">{tag.tag}</bdi>
                  <span>{fmt.integer(tag.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="analytics-chart-empty">{copy.memory.noTags}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ Platform --- */

export function PlatformBody({ data, copy, fmt }: Ctx & { data: PlatformAnalytics }) {
  const categorySlices: DonutSlice[] = data.skills.byCategory.map((entry) => ({
    id: entry.category,
    label: entry.category,
    value: entry.count
  }))
  return (
    <div className="analytics-platform">
      <div className="analytics-stat-row">
        <Stat label={copy.platform.model} value={data.model.modelLabel} hint={data.model.providerLabel} />
        <Stat
          label={copy.platform.skills}
          value={`${fmt.integer(data.skills.installed)}${copy.platform.skillsUnit ? ` ${copy.platform.skillsUnit}` : ''}`}
        />
      </div>

      <div className="analytics-subcard analytics-donut-cell">
        <h3 className="analytics-subcard__title">{copy.platform.skillsTitle}</h3>
        <DonutChart
          slices={categorySlices}
          title={copy.platform.skillsTitle}
          formatValue={fmt.integer}
          emptyLabel={copy.platform.noSkills}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ Insights --- */

export function InsightsBody({
  data,
  copy
}: Ctx & { data: { items: ReadonlyArray<{ id: string; kind: 'observation' | 'warning' | 'action'; text: string; explanation: string }> } }) {
  if (data.items.length === 0) {
    return <p className="analytics-chart-empty">{copy.insights.empty}</p>
  }
  return (
    <ul className="analytics-insight-list">
      {data.items.map((item) => (
        <li key={item.id} className="analytics-insight" data-kind={item.kind}>
          <span className="analytics-insight__kind">{copy.insights.kinds[item.kind]}</span>
          <div className="analytics-insight__body">
            <p className="analytics-insight__text">{item.text}</p>
            <p className="analytics-insight__explanation">{item.explanation}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

