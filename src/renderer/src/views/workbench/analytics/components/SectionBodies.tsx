import type { AnalyticsCopy } from '../analyticsCopy'
import type { AnalyticsFormatters } from '../chartFormatters'
import type {
  AnalyticsDimensionBreakdown,
  AnalyticsLocalDate,
  FocusAnalytics,
  LearningAnalyticsHero,
  MemoryAnalytics,
  PlatformAnalytics,
  ReviewAnalytics,
  TaskAnalytics,
  TokenAnalytics
} from '../types'
import { CalendarHeatmap } from '../charts/CalendarHeatmap'
import { DonutChart, type DonutSlice } from '../charts/DonutChart'
import { HourBarChart } from '../charts/HourBarChart'
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

/* ---------------------------------------------------------------- Hero --- */

export function HeroBody({ data, copy, fmt }: Ctx & { data: LearningAnalyticsHero }) {
  return (
    <div className="analytics-hero-grid">
      <Stat label={copy.hero.focus} value={fmt.duration(data.focusSeconds)} hint={copy.hero.inRange} />
      <Stat
        label={copy.hero.sessions}
        value={`${fmt.integer(data.completedFocusSessions)}${copy.hero.sessionsUnit ? ` ${copy.hero.sessionsUnit}` : ''}`}
        hint={copy.hero.inRange}
      />
      <Stat label={copy.hero.tokens} value={fmt.compact(data.totalTokens)} hint={copy.hero.inRange} />
      <Stat
        label={copy.hero.streak}
        value={`${fmt.integer(data.currentStreakDays)} ${copy.hero.days}`}
        hint={copy.hero.current}
        tone="ok"
      />
      <Stat
        label={copy.hero.level}
        value={`${fmt.integer(data.currentLevel.level)}${copy.hero.levelUnit ? ` ${copy.hero.levelUnit}` : ''}`}
        hint={copy.hero.current}
      />
      <Stat
        label={copy.hero.tasks}
        value={fmt.percent(data.currentTaskCompletionRate)}
        hint={copy.hero.current}
        tone={(data.currentTaskCompletionRate ?? 0) >= 0.7 ? 'ok' : (data.currentTaskCompletionRate ?? 0) > 0 ? 'warn' : 'default'}
      />
    </div>
  )
}

/* --------------------------------------------------------------- Focus --- */

function dimensionSlices<T extends string>(
  breakdown: readonly AnalyticsDimensionBreakdown<T>[],
  labels: Record<string, string>
): DonutSlice[] {
  return breakdown.map((item) => ({
    id: item.id,
    label: labels[item.id] ?? item.id,
    value: item.seconds
  }))
}

export function FocusBody({ data, copy, fmt, localToday }: Ctx & { data: FocusAnalytics }) {
  const s = data.sessionStructure
  const trendDates = data.trend.map((point) => point.date)
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

      <div className="analytics-subcard analytics-focus__trend">
        <h3 className="analytics-subcard__title">{copy.focus.trendTitle}</h3>
        <TrendChart
          dates={trendDates}
          series={[
            {
              id: 'focus',
              label: copy.focus.trendFocus,
              color: categoricalColor(0),
              values: data.trend.map((point) => point.focusSeconds),
              format: fmt.duration
            }
          ]}
          title={copy.focus.trendTitle}
          formatDate={fmt.shortDate}
          emptyLabel={copy.charts.empty}
        />
      </div>

      <div className="analytics-subcard analytics-focus__hours">
        <h3 className="analytics-subcard__title">{copy.focus.hourTitle}</h3>
        <HourBarChart
          buckets={data.hourBuckets}
          title={copy.focus.hourTitle}
          formatHour={fmt.hour}
          formatValue={fmt.duration}
          peakLabel={copy.focus.hourPeak}
          peakNoneLabel={copy.focus.hourNoPeak}
          emptyLabel={copy.charts.empty}
        />
      </div>

      <div className="analytics-subcard analytics-focus__donuts">
        <div className="analytics-donut-cell">
          <h3 className="analytics-subcard__title">{copy.focus.modeTitle}</h3>
          <DonutChart
            slices={dimensionSlices(data.modeBreakdown, copy.focus.modeLabels)}
            title={copy.focus.modeTitle}
            formatValue={fmt.duration}
            emptyLabel={copy.charts.empty}
          />
        </div>
        <div className="analytics-donut-cell">
          <h3 className="analytics-subcard__title">{copy.focus.signalTitle}</h3>
          <DonutChart
            slices={dimensionSlices(data.signalBreakdown, copy.focus.signalLabels)}
            title={copy.focus.signalTitle}
            formatValue={fmt.duration}
            emptyLabel={copy.charts.empty}
          />
        </div>
      </div>

      <div className="analytics-subcard analytics-focus__structure">
        <h3 className="analytics-subcard__title">{copy.focus.structureTitle}</h3>
        <dl className="analytics-keyvalue-grid">
          <KeyValue label={copy.focus.completed} value={fmt.integer(s.completed)} />
          <KeyValue label={copy.focus.interrupted} value={fmt.integer(s.interrupted)} />
          <KeyValue label={copy.focus.canceled} value={fmt.integer(s.canceled)} />
          <KeyValue label={copy.focus.completionRate} value={fmt.percent(s.completionRate)} />
          <KeyValue label={copy.focus.avgSession} value={fmt.duration(s.averageCompletedFocusSeconds)} />
          <KeyValue label={copy.focus.breakTime} value={fmt.duration(s.breakSeconds)} />
        </dl>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Tokens --- */

export function TokenBody({ data, copy, fmt, localToday }: Ctx & { data: TokenAnalytics }) {
  const todayRow = data.byDay.find((row) => row.date === localToday)
  const trendDates = data.byDay.map((row) => row.date)

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
          series={[
            {
              id: 'tokens',
              label: copy.tokens.trendTitle,
              color: categoricalColor(1),
              values: data.byDay.map((row) => row.totalTokens),
              format: fmt.integer
            }
          ]}
          title={copy.tokens.trendTitle}
          formatDate={fmt.shortDate}
          emptyLabel={copy.charts.empty}
        />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- Tasks --- */

export function TaskBody({ data, copy, fmt }: Ctx & { data: TaskAnalytics }) {
  // Prefer attributed focus-time pies; fall back to checklist completion counts so
  // checking tasks on the list produces visible share charts without a focus run.
  const hasFocusShare = data.topByAttributedFocus.some((task) => task.focusSeconds > 0)
  const taskShareMode: 'focus' | 'completion' = hasFocusShare ? 'focus' : 'completion'
  const taskFocusSlices: DonutSlice[] = hasFocusShare
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
  const categoryFocusSlices: DonutSlice[] = hasFocusShare
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

      <div className="analytics-subcard analytics-tasks__donuts">
        <div className="analytics-donut-cell">
          <h3 className="analytics-subcard__title">{taskChartTitle}</h3>
          <DonutChart
            slices={taskFocusSlices}
            title={taskChartTitle}
            formatValue={formatShareValue}
            emptyLabel={emptyShareLabel}
          />
        </div>
        <div className="analytics-donut-cell">
          <h3 className="analytics-subcard__title">{categoryChartTitle}</h3>
          <DonutChart
            slices={categoryFocusSlices}
            title={categoryChartTitle}
            formatValue={formatShareValue}
            emptyLabel={emptyShareLabel}
          />
        </div>
      </div>

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{copy.tasks.flowTitle}</h3>
        <dl className="analytics-keyvalue-grid">
          <KeyValue label={copy.tasks.created} value={fmt.integer(data.flow.created)} />
          <KeyValue label={copy.tasks.completed} value={fmt.integer(data.flow.completed)} />
          <KeyValue label={copy.tasks.reopened} value={fmt.integer(data.flow.reopened)} />
          <KeyValue label={copy.tasks.deleted} value={fmt.integer(data.flow.deleted)} />
        </dl>
      </div>

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
  return (
    <div className="analytics-review">
      <div className="analytics-stat-row">
        <Stat
          label={copy.review.accuracy}
          value={fmt.percent(data.cumulative.accuracy)}
          tone={(data.cumulative.accuracy ?? 0) >= 0.8 ? 'ok' : (data.cumulative.accuracy ?? 0) > 0 ? 'warn' : 'default'}
        />
        <Stat label={copy.review.answered} value={fmt.integer(data.cumulative.totalAnswered)} />
        <Stat label={copy.review.correct} value={fmt.integer(data.cumulative.correct)} tone="ok" />
        <Stat label={copy.review.cards} value={fmt.integer(data.cumulative.cardCount)} />
      </div>

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{copy.review.byLessonTitle}</h3>
        {data.byLesson.length > 0 ? (
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
