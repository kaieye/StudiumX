import type { AnalyticsCopy } from '../analyticsCopy'
import type { AnalyticsFormatters } from '../chartFormatters'
import type {
  AnalyticsLocalDate,
  FocusAnalytics,
  LearningAnalyticsHero,
  MemoryAnalytics,
  PlatformAnalytics,
  ReviewAnalytics,
  TaskAnalytics,
  TokenAnalytics
} from '../types'
import { ActiveRangeChart } from '../charts/ActiveRangeChart'
import { CalendarHeatmap } from '../charts/CalendarHeatmap'
import { DonutChart, type DonutSlice } from '../charts/DonutChart'
import { DumbbellChart } from '../charts/DumbbellChart'
import { ProgressGauge } from '../charts/ProgressGauge'
import { RankBarChart } from '../charts/RankBarChart'
import { TrendChart } from '../charts/TrendChart'
import { categoricalColor } from '../charts/palette'

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

export function FocusBody({ data, copy, fmt, localToday }: Ctx & { data: FocusAnalytics }) {
  return (
    <div className="analytics-focus">
      <div className="analytics-subcard analytics-focus__heatmap">
        <h3 className="analytics-subcard__title">{copy.focus.heatmapTitle}</h3>
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
        />
      </div>

      <div className="analytics-subcard analytics-focus__hours">
        <h3 className="analytics-subcard__title">{copy.focus.hourTitle}</h3>
        <ActiveRangeChart
          series={data.activeRanges}
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

    </div>
  )
}

/* -------------------------------------------------------------- Tokens --- */

export function TokenBody({ data, copy, fmt, localToday }: Ctx & { data: TokenAnalytics }) {
  const todayRow = data.byDay.find((row) => row.date === localToday)
  const trendDates = data.byDay.map((row) => row.date)
  const hasSplit = data.byDay.some(
    (row) => (row.promptTokens ?? 0) > 0 || (row.completionTokens ?? 0) > 0
  )
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

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{copy.tokens.trendTitle}</h3>
        <TrendChart
          dates={trendDates}
          series={
            hasSplit
              ? [
                  {
                    id: 'prompt',
                    label: copy.tokens.promptTrend,
                    color: categoricalColor(0),
                    values: data.byDay.map((row) => row.promptTokens ?? 0),
                    format: fmt.integer,
                    fill: true,
                    sharedScale: true
                  },
                  {
                    id: 'completion',
                    label: copy.tokens.completionTrend,
                    color: categoricalColor(1),
                    values: data.byDay.map((row) => row.completionTokens ?? 0),
                    format: fmt.integer,
                    fill: true,
                    sharedScale: true
                  }
                ]
              : [
                  {
                    id: 'tokens',
                    label: copy.tokens.trendTitle,
                    color: categoricalColor(1),
                    values: data.byDay.map((row) => row.totalTokens),
                    format: fmt.integer,
                    fill: true
                  }
                ]
          }
          title={copy.tokens.trendTitle}
          formatDate={fmt.shortDate}
          emptyLabel={copy.charts.empty}
          sharedScale={hasSplit}
        />
      </div>

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{copy.tokens.byWorkspaceTitle}</h3>
        <RankBarChart
          items={workspaceItems}
          title={copy.tokens.byWorkspaceTitle}
          formatValue={fmt.integer}
          emptyLabel={copy.tokens.noWorkspaceShare}
        />
      </div>

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{copy.tokens.efficiencyTitle}</h3>
        <dl className="analytics-keyvalue-grid">
          <KeyValue
            label={copy.tokens.avgPerConversation}
            value={fmt.integer(data.efficiency.averageTokensPerConversation)}
          />
          <KeyValue
            label={copy.tokens.avgPerMessage}
            value={fmt.integer(data.efficiency.averageTokensPerMessage)}
          />
          <KeyValue label={copy.tokens.toolErrorRate} value={fmt.percent(data.efficiency.toolErrorRate)} />
        </dl>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- Tasks --- */

export function TaskBody({ data, copy, fmt }: Ctx & { data: TaskAnalytics }) {
  // Prefer attributed focus-time bars; fall back to checklist completion counts so
  // checking tasks on the list produces visible share charts without a focus run.
  const hasFocusShare = data.topByAttributedFocus.some((task) => task.focusSeconds > 0)
  const taskShareMode: 'focus' | 'completion' = hasFocusShare ? 'focus' : 'completion'
  const taskFocusItems = hasFocusShare
    ? data.topByAttributedFocus.map((task) => ({
        id: task.taskId,
        label: task.title,
        value: task.focusSeconds
      }))
    : data.topByCompletion.map((task) => ({
        id: task.taskId,
        label: task.title,
        value: task.completionCount
      }))
  const categoryFocusItems = hasFocusShare
    ? data.byCategoryFocus.map((entry) => ({
        id: entry.categoryId,
        label:
          entry.categoryId === 'uncategorized'
            ? copy.tasks.uncategorized
            : entry.label || entry.categoryId,
        value: entry.focusSeconds
      }))
    : data.byCategoryCompletion.map((entry) => ({
        id: entry.categoryId,
        label:
          entry.categoryId === 'uncategorized'
            ? copy.tasks.uncategorized
            : entry.label || entry.categoryId,
        value: entry.completionCount
      }))
  const taskChartTitle = taskShareMode === 'focus' ? copy.tasks.byTaskTitle : copy.tasks.byTaskCompletionTitle
  const categoryChartTitle = taskShareMode === 'focus' ? copy.tasks.byCategoryTitle : copy.tasks.byCategoryCompletionTitle
  const formatShareValue = taskShareMode === 'focus'
    ? fmt.duration
    : (value: number) => `${fmt.integer(value)}${copy.tasks.completionCountUnit}`
  const emptyShareLabel = taskShareMode === 'focus' ? copy.tasks.noTopTasks : copy.tasks.noCompletionShare
  const rankedTasks = hasFocusShare
    ? data.topByAttributedFocus.map((task) => ({
        id: task.taskId,
        label: task.title,
        value: fmt.duration(task.focusSeconds)
      }))
    : data.topByCompletion.map((task) => ({
        id: task.taskId,
        label: task.title,
        value: `${fmt.integer(task.completionCount)}${copy.tasks.completionCountUnit}`
      }))
  const rankTitle = hasFocusShare ? copy.tasks.topTasksTitle : copy.tasks.topCompletionTitle

  const plan = data.plan
  const planItems = [
    {
      id: 'plan-vs-exec',
      label: copy.tasks.planVsExecLabel,
      before: plan.plannedSeconds,
      after: plan.attributedFocusSeconds
    }
  ]
  const hasPlanData = plan.plannedSeconds > 0 || plan.attributedFocusSeconds > 0

  return (
    <div className="analytics-tasks">
      <div className="analytics-stat-row">
        <Stat label={copy.tasks.open} value={fmt.integer(data.current.open)} />
        <Stat label={copy.tasks.completed} value={fmt.integer(data.current.completed)} tone="ok" />
        <Stat
          label={copy.tasks.overdue}
          value={fmt.integer(data.current.overdue)}
          tone={data.current.overdue > 0 ? 'alert' : 'default'}
        />
        <Stat
          label={copy.tasks.completionRate}
          value={fmt.percent(data.current.completionRate)}
          tone={(data.current.completionRate ?? 0) >= 0.7 ? 'ok' : (data.current.completionRate ?? 0) > 0 ? 'warn' : 'default'}
        />
      </div>

      <div className="analytics-subcard analytics-tasks__bars">
        <div className="analytics-donut-cell">
          <h3 className="analytics-subcard__title">{taskChartTitle}</h3>
          <RankBarChart
            items={taskFocusItems}
            title={taskChartTitle}
            formatValue={formatShareValue}
            emptyLabel={emptyShareLabel}
          />
        </div>
        <div className="analytics-donut-cell">
          <h3 className="analytics-subcard__title">{categoryChartTitle}</h3>
          <RankBarChart
            items={categoryFocusItems}
            title={categoryChartTitle}
            formatValue={formatShareValue}
            emptyLabel={emptyShareLabel}
          />
        </div>
      </div>

      {hasPlanData ? (
        <div className="analytics-subcard">
          <h3 className="analytics-subcard__title">{copy.tasks.planTitle}</h3>
          <DumbbellChart
            items={planItems}
            title={copy.tasks.planTitle}
            beforeLabel={copy.tasks.planned}
            afterLabel={copy.tasks.executed}
            formatValue={fmt.duration}
            emptyLabel={copy.tasks.noPlan}
          />
          <dl className="analytics-keyvalue-grid analytics-keyvalue-grid--compact">
            <KeyValue label={copy.tasks.planned} value={fmt.duration(plan.plannedSeconds)} />
            <KeyValue label={copy.tasks.executed} value={fmt.duration(plan.attributedFocusSeconds)} />
            <KeyValue label={copy.tasks.executionRate} value={fmt.percent(plan.executionRate)} />
          </dl>
        </div>
      ) : null}

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{rankTitle}</h3>
        {rankedTasks.length > 0 ? (
          <ol className="analytics-rank-list">
            {rankedTasks.map((task) => (
              <li key={task.id}>
                <bdi dir="auto" className="analytics-rank-list__label">{task.label}</bdi>
                <span className="analytics-rank-list__value">{task.value}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="analytics-chart-empty">{emptyShareLabel}</p>
        )}
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

      <div className="analytics-subcard analytics-review__accuracy">
        <h3 className="analytics-subcard__title">{copy.review.accuracyGaugeTitle}</h3>
        <ProgressGauge
          progress={accuracy}
          title={copy.review.accuracyGaugeTitle}
          centerValue={fmt.percent(accuracy)}
          centerLabel={copy.review.accuracy}
          emptyLabel={copy.charts.empty}
          tone={accuracyTone}
        />
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

