import { useMemo, useState } from 'react'
import type {
  AnalyticsDataState,
  AnalyticsSectionResult,
  AnalyticsWarning,
  WorkspaceAssetsAnalytics as WorkspaceAssetsData
} from '../types'
import '../deep-analytics.css'

type DeepUiState = AnalyticsDataState | 'loading'
type CourseSortKey = 'name' | 'sessions' | 'lessons' | 'updated'
type LessonSortKey = 'title' | 'course' | 'created' | 'duration'
type SortDirection = 'ascending' | 'descending'

export type AssetAnalyticsProps = {
  /** Current Teaching catalog result. Inventory is deliberately never re-filtered by query.range. */
  result?: AnalyticsSectionResult<WorkspaceAssetsData>
  loading?: boolean
  className?: string
}

const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

function dateTime(value?: string): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

function stateLabel(state: DeepUiState): string {
  switch (state) {
    case 'loading': return '正在加载'
    case 'available': return '数据完整'
    case 'empty': return '当前库存为空'
    case 'partial': return '数据不完整'
    case 'unavailable': return '暂不可用'
    case 'error': return '加载失败'
  }
}

function sectionState({ state, message }: { state: DeepUiState; message: string }) {
  return (
    <div className={`deep-analytics-state deep-analytics-state--${state}`} role={state === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{state === 'loading' ? '…' : state === 'error' ? '!' : state === 'unavailable' ? '—' : '○'}</span>
      <p>{message}</p>
    </div>
  )
}

function warningsList(warnings: readonly AnalyticsWarning[]) {
  if (warnings.length === 0) return null
  return (
    <section className="deep-analytics-warning" aria-labelledby="asset-analytics-warning-title">
      <h4 id="asset-analytics-warning-title">覆盖范围与数据说明</h4>
      <ul>{warnings.map((warning, index) => <li key={`${warning.code}-${index}`} data-severity={warning.severity}>{warning.message}</li>)}</ul>
    </section>
  )
}

function unavailableMessage(result: Extract<AnalyticsSectionResult<WorkspaceAssetsData>, { state: 'unavailable' }>): string {
  switch (result.reason) {
    case 'no_active_workspace': return '当前没有可盘点的 Teaching workspace。'
    case 'permission_denied': return '没有权限读取教学资产目录。'
    case 'source_missing': return '教学资产目录不存在。'
    case 'not_configured': return '教学工作区尚未配置。'
    case 'not_applicable': return '教学资产盘点不适用于当前范围。'
    case 'history_not_recorded': return '教学资产历史尚未记录。'
    case 'unsupported': return '当前版本尚不支持教学资产盘点。'
  }
}

function SortButton({ active, direction, children, onClick }: { active: boolean; direction: SortDirection; children: string; onClick: () => void }) {
  return (
    <button type="button" className="deep-analytics-sort-button" onClick={onClick}>
      <span>{children}</span><span aria-hidden="true">{active ? (direction === 'ascending' ? '↑' : '↓') : '↕'}</span>
    </button>
  )
}

export function AssetAnalytics({ result, loading = false, className = '' }: AssetAnalyticsProps) {
  const [courseSort, setCourseSort] = useState<CourseSortKey>('updated')
  const [courseDirection, setCourseDirection] = useState<SortDirection>('descending')
  const [lessonSort, setLessonSort] = useState<LessonSortKey>('created')
  const [lessonDirection, setLessonDirection] = useState<SortDirection>('descending')
  const state: DeepUiState = loading || !result ? 'loading' : result.state
  const data = result && 'data' in result ? result.data : null

  const courses = useMemo(() => {
    const rows = [...(data?.courses ?? [])]
    const multiplier = courseDirection === 'ascending' ? 1 : -1
    rows.sort((left, right) => {
      if (courseSort === 'sessions') return (left.sessionCount - right.sessionCount) * multiplier
      if (courseSort === 'lessons') return (left.lessonCount - right.lessonCount) * multiplier
      if (courseSort === 'updated') return ((left.updatedAt ?? '').localeCompare(right.updatedAt ?? '')) * multiplier
      return left.name.localeCompare(right.name, 'zh-CN') * multiplier
    })
    return rows
  }, [courseDirection, courseSort, data?.courses])

  const lessons = useMemo(() => {
    const rows = [...(data?.recentLessons ?? [])]
    const multiplier = lessonDirection === 'ascending' ? 1 : -1
    rows.sort((left, right) => {
      if (lessonSort === 'created') return left.createdAt.localeCompare(right.createdAt) * multiplier
      if (lessonSort === 'duration') return (left.durationMinutes - right.durationMinutes) * multiplier
      if (lessonSort === 'course') return left.courseName.localeCompare(right.courseName, 'zh-CN') * multiplier
      return left.title.localeCompare(right.title, 'zh-CN') * multiplier
    })
    return rows
  }, [data?.recentLessons, lessonDirection, lessonSort])

  const updateCourseSort = (key: CourseSortKey) => {
    if (key === courseSort) setCourseDirection((current) => current === 'ascending' ? 'descending' : 'ascending')
    else { setCourseSort(key); setCourseDirection(key === 'name' ? 'ascending' : 'descending') }
  }
  const updateLessonSort = (key: LessonSortKey) => {
    if (key === lessonSort) setLessonDirection((current) => current === 'ascending' ? 'descending' : 'ascending')
    else { setLessonSort(key); setLessonDirection(key === 'title' || key === 'course' ? 'ascending' : 'descending') }
  }

  if (state === 'loading') {
    return (
      <section className={`deep-analytics-card asset-analytics ${className}`.trim()} data-state={state} aria-busy="true">
        {sectionState({ state, message: '正在读取当前教学资产目录。' })}
        <div className="deep-analytics-skeleton" aria-hidden="true"><span /><span /><span /><span /></div>
      </section>
    )
  }
  if (!result) return null
  if (result.state === 'unavailable') {
    return <section className={`deep-analytics-card asset-analytics ${className}`.trim()} data-state={state}>{sectionState({ state, message: unavailableMessage(result) })}{warningsList(result.warnings)}</section>
  }
  if (result.state === 'error') {
    return <section className={`deep-analytics-card asset-analytics ${className}`.trim()} data-state={state}>{sectionState({ state, message: result.error.message })}{warningsList(result.warnings)}</section>
  }
  if (!data) return null

  const currentAsOf = result.temporal.kind === 'as_of'
    ? dateTime(result.temporal.asOf)
    : result.temporal.kind === 'mixed'
      ? dateTime(result.temporal.asOf)
      : '截至现在'
  const requested = result.coverage.requestedRange
  const selectedRange = requested.from === requested.to ? requested.from : `${requested.from} — ${requested.to}`

  return (
    <section className={`deep-analytics-card asset-analytics ${className}`.trim()} data-state={state} aria-busy="false">
      <header className="deep-analytics-basis-row">
        <div><span>当前库存</span><strong>截至 {currentAsOf}，不随日期范围变化</strong></div>
        <div><span>所选区间</span><strong>{selectedRange}（仅供其他历史模块使用）</strong></div>
        <span className="deep-analytics-state-chip" data-state={state}>{stateLabel(state)}</span>
      </header>
      {result.state === 'partial' ? <p className="deep-analytics-inline-status" role="status">部分工作区目录读取失败；已读库存仍可用。</p> : null}
      {warningsList(result.warnings)}

      <section className="deep-analytics-panel" aria-labelledby="asset-inventory-title">
        <div className="deep-analytics-panel-heading"><div><span>当前 · range invariant</span><h4 id="asset-inventory-title">教学资产库存</h4></div></div>
        <dl className="deep-analytics-metric-grid deep-analytics-metric-grid--inventory">
          <div><dt>Workspace</dt><dd>{numberFormatter.format(data.counts.workspaces)}</dd></div>
          <div><dt>Course</dt><dd>{numberFormatter.format(data.counts.courses)}</dd></div>
          <div><dt>Session</dt><dd>{numberFormatter.format(data.counts.sessions)}</dd></div>
          <div><dt>Lesson</dt><dd>{numberFormatter.format(data.counts.lessons)}</dd></div>
          <div><dt>Resource</dt><dd>{numberFormatter.format(data.counts.resources)}</dd></div>
          <div><dt>Learning record</dt><dd>{numberFormatter.format(data.counts.learningRecords)}</dd></div>
          <div><dt>Reference</dt><dd>{numberFormatter.format(data.counts.references)}</dd></div>
          <div><dt>Agent conversation</dt><dd>{numberFormatter.format(data.counts.conversations)}</dd></div>
          <div><dt>Mission 已填写</dt><dd>{numberFormatter.format(data.missionHealth.filter((mission) => mission.hasMission).length)} / {numberFormatter.format(data.missionHealth.length)}</dd></div>
        </dl>
      </section>

      <section className="deep-analytics-panel" aria-labelledby="asset-range-change-title">
        <div className="deep-analytics-panel-heading"><div><span>所选区间</span><h4 id="asset-range-change-title">资产变化</h4></div></div>
        {sectionState({ state: 'unavailable', message: '当前聚合 DTO 只提供截至现在的库存与健康状态，没有 timestamped 资产变化事实；切换日期范围不会过滤当前库存。' })}
      </section>

      <details className="deep-analytics-disclosure" open>
        <summary>展开 Course 库存表</summary>
        {courses.length === 0 ? sectionState({ state: 'empty', message: '当前范围内的 Teaching scope 没有 Course 库存。' }) : (
          <div className="deep-analytics-table-wrap">
            <table className="deep-analytics-table">
              <caption>当前 Course 库存；不是所选日期范围内的创建记录</caption>
              <thead><tr>
                <th scope="col" aria-sort={courseSort === 'name' ? courseDirection : 'none'}><SortButton active={courseSort === 'name'} direction={courseDirection} onClick={() => updateCourseSort('name')}>Course</SortButton></th>
                <th scope="col" aria-sort={courseSort === 'sessions' ? courseDirection : 'none'}><SortButton active={courseSort === 'sessions'} direction={courseDirection} onClick={() => updateCourseSort('sessions')}>Session</SortButton></th>
                <th scope="col" aria-sort={courseSort === 'lessons' ? courseDirection : 'none'}><SortButton active={courseSort === 'lessons'} direction={courseDirection} onClick={() => updateCourseSort('lessons')}>Lesson</SortButton></th>
                <th scope="col">对话 / 置顶</th>
                <th scope="col" aria-sort={courseSort === 'updated' ? courseDirection : 'none'}><SortButton active={courseSort === 'updated'} direction={courseDirection} onClick={() => updateCourseSort('updated')}>最近更新</SortButton></th>
              </tr></thead>
              <tbody>{courses.map((course) => (
                <tr key={`${course.workspaceId}:${course.courseId}`}>
                  <td data-label="Course"><bdi dir="auto">{course.name}</bdi></td>
                  <td data-label="Session">{numberFormatter.format(course.sessionCount)}</td>
                  <td data-label="Lesson">{numberFormatter.format(course.lessonCount)}</td>
                  <td data-label="对话 / 置顶">{numberFormatter.format(course.conversationCount)}{course.pinned ? ' · 已置顶' : ''}</td>
                  <td data-label="最近更新">{dateTime(course.updatedAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </details>

      <details className="deep-analytics-disclosure">
        <summary>展开最近 Lesson 清单</summary>
        {lessons.length === 0 ? sectionState({ state: 'empty', message: '当前目录没有 Lesson。' }) : (
          <div className="deep-analytics-table-wrap">
            <table className="deep-analytics-table">
              <caption>当前目录中的最近 Lesson；创建时间用于排序，不代表区间过滤</caption>
              <thead><tr>
                <th scope="col" aria-sort={lessonSort === 'title' ? lessonDirection : 'none'}><SortButton active={lessonSort === 'title'} direction={lessonDirection} onClick={() => updateLessonSort('title')}>Lesson</SortButton></th>
                <th scope="col" aria-sort={lessonSort === 'course' ? lessonDirection : 'none'}><SortButton active={lessonSort === 'course'} direction={lessonDirection} onClick={() => updateLessonSort('course')}>Course</SortButton></th>
                <th scope="col" aria-sort={lessonSort === 'created' ? lessonDirection : 'none'}><SortButton active={lessonSort === 'created'} direction={lessonDirection} onClick={() => updateLessonSort('created')}>创建时间</SortButton></th>
                <th scope="col" aria-sort={lessonSort === 'duration' ? lessonDirection : 'none'}><SortButton active={lessonSort === 'duration'} direction={lessonDirection} onClick={() => updateLessonSort('duration')}>时长</SortButton></th>
              </tr></thead>
              <tbody>{lessons.map((lesson) => (
                <tr key={`${lesson.workspaceId}:${lesson.lessonId}`}>
                  <td data-label="Lesson"><bdi dir="auto">{lesson.title}</bdi></td>
                  <td data-label="Course"><bdi dir="auto">{lesson.courseName}</bdi></td>
                  <td data-label="创建时间">{dateTime(lesson.createdAt)}</td>
                  <td data-label="时长">{numberFormatter.format(lesson.durationMinutes)} 分钟</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </details>

      <details className="deep-analytics-disclosure" open>
        <summary>展开当前 Mission 健康状态</summary>
        {data.missionHealth.length === 0 ? sectionState({ state: 'empty', message: '当前没有可检查的 Mission。' }) : (
          <div className="deep-analytics-table-wrap">
            <table className="deep-analytics-table">
              <caption>当前 Mission 健康度；只显示标题、是否填写和长度，不显示 Mission 正文</caption>
              <thead><tr><th scope="col">Mission</th><th scope="col">状态</th><th scope="col">正文长度</th><th scope="col">最近更新</th></tr></thead>
              <tbody>{data.missionHealth.map((mission) => (
                <tr key={mission.workspaceId}>
                  <td data-label="Mission"><bdi dir="auto">{mission.title || '未命名 Mission'}</bdi></td>
                  <td data-label="状态"><span className="deep-analytics-pill" data-tone={mission.hasMission ? 'positive' : 'caution'}>{mission.hasMission ? '已填写' : '待补充'}</span></td>
                  <td data-label="正文长度">{mission.hasMission ? `${numberFormatter.format(mission.excerptLength)} 字符` : '不显示正文'}</td>
                  <td data-label="最近更新">{dateTime(mission.updatedAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </details>

      <p className="deep-analytics-privacy-note">隐私：默认摘要导出省略 workspace、Course、Lesson 与 Mission 标题；详细导出仅可包含页面已展示名称，正文、绝对路径和秘密始终排除。</p>
    </section>
  )
}
