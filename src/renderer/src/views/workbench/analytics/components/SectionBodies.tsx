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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="analytics-stat">
      <span className="analytics-stat__label">{label}</span>
      <strong className="analytics-stat__value">{value}</strong>
      {hint ? <small className="analytics-stat__hint">{hint}</small> : null}
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
      <Stat label={copy.hero.streak} value={`${fmt.integer(data.currentStreakDays)} ${copy.hero.days}`} hint={copy.hero.current} />
      <Stat
        label={copy.hero.level}
        value={`${fmt.integer(data.currentLevel.level)}${copy.hero.levelUnit ? ` ${copy.hero.levelUnit}` : ''}`}
        hint={copy.hero.current}
      />
      <Stat label={copy.hero.tasks} value={fmt.percent(data.currentTaskCompletionRate)} hint={copy.hero.current} />
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
          <div><dt>{copy.focus.completed}</dt><dd>{fmt.integer(s.completed)}</dd></div>
          <div><dt>{copy.focus.interrupted}</dt><dd>{fmt.integer(s.interrupted)}</dd></div>
          <div><dt>{copy.focus.canceled}</dt><dd>{fmt.integer(s.canceled)}</dd></div>
          <div><dt>{copy.focus.completionRate}</dt><dd>{fmt.percent(s.completionRate)}</dd></div>
          <div><dt>{copy.focus.avgSession}</dt><dd>{fmt.duration(s.averageCompletedFocusSeconds)}</dd></div>
          <div><dt>{copy.focus.breakTime}</dt><dd>{fmt.duration(s.breakSeconds)}</dd></div>
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
  return (
    <div className="analytics-tasks">
      <div className="analytics-stat-row">
        <Stat label={copy.tasks.open} value={fmt.integer(data.current.open)} />
        <Stat label={copy.tasks.completed} value={fmt.integer(data.current.completed)} />
        <Stat label={copy.tasks.overdue} value={fmt.integer(data.current.overdue)} />
        <Stat label={copy.tasks.completionRate} value={fmt.percent(data.current.completionRate)} />
      </div>

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{copy.tasks.flowTitle}</h3>
        <dl className="analytics-keyvalue-grid">
          <div><dt>{copy.tasks.created}</dt><dd>{fmt.integer(data.flow.created)}</dd></div>
          <div><dt>{copy.tasks.completed}</dt><dd>{fmt.integer(data.flow.completed)}</dd></div>
          <div><dt>{copy.tasks.reopened}</dt><dd>{fmt.integer(data.flow.reopened)}</dd></div>
          <div><dt>{copy.tasks.deleted}</dt><dd>{fmt.integer(data.flow.deleted)}</dd></div>
        </dl>
      </div>

      <div className="analytics-subcard">
        <h3 className="analytics-subcard__title">{copy.tasks.topTasksTitle}</h3>
        {data.topByAttributedFocus.length > 0 ? (
          <ol className="analytics-rank-list">
            {data.topByAttributedFocus.map((task) => (
              <li key={task.taskId}>
                <bdi dir="auto" className="analytics-rank-list__label">{task.title}</bdi>
                <span className="analytics-rank-list__value">{fmt.duration(task.focusSeconds)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="analytics-chart-empty">{copy.tasks.noTopTasks}</p>
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
        <Stat label={copy.review.accuracy} value={fmt.percent(data.cumulative.accuracy)} />
        <Stat label={copy.review.answered} value={fmt.integer(data.cumulative.totalAnswered)} />
        <Stat label={copy.review.correct} value={fmt.integer(data.cumulative.correct)} />
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
                  {fmt.percent(lesson.accuracy)} · {fmt.integer(lesson.answered)}
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
