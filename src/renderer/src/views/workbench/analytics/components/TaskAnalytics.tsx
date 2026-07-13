import { useMemo, useState } from 'react'
import type {
  AnalyticsDataState,
  AnalyticsSectionResult,
  AnalyticsWarning,
  TaskAnalytics as TaskAnalyticsData
} from '../types'
import '../deep-analytics.css'

type DeepUiState = AnalyticsDataState | 'loading'
type TaskSortKey = 'title' | 'focus' | 'status'
type SortDirection = 'ascending' | 'descending'

export type TaskAnalyticsProps = {
  /** Shared-contract section result. The component never reads IPC, storage, or task snapshots. */
  result?: AnalyticsSectionResult<TaskAnalyticsData>
  /** Use when the page has not produced a section envelope yet. */
  loading?: boolean
  className?: string
}

const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })
const percentFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  maximumFractionDigits: 0
})

function duration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  if (safeSeconds < 60) return `${numberFormatter.format(safeSeconds)} 秒`
  const minutes = safeSeconds / 60
  if (minutes < 60) return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: minutes >= 10 ? 0 : 1 }).format(minutes)} 分钟`
  const hours = minutes / 60
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: hours >= 10 ? 0 : 1 }).format(hours)} 小时`
}

function ratio(value: number | null): string {
  return value === null ? '不可用' : percentFormatter.format(value)
}

function rangeLabel(result: AnalyticsSectionResult<TaskAnalyticsData>): string {
  const { from, to } = result.coverage.requestedRange
  return from === to ? from : `${from} — ${to}`
}

function stateLabel(state: DeepUiState): string {
  switch (state) {
    case 'loading': return '正在加载'
    case 'available': return '数据完整'
    case 'empty': return '已确认无记录'
    case 'partial': return '数据不完整'
    case 'unavailable': return '暂不可用'
    case 'error': return '加载失败'
  }
}

function unavailableMessage(result: Extract<AnalyticsSectionResult<TaskAnalyticsData>, { state: 'unavailable' }>): string {
  switch (result.reason) {
    case 'history_not_recorded': return '任务生命周期历史尚未记录；当前库存不能倒推出区间历史。'
    case 'no_active_workspace': return '当前没有可用于任务分析的教学工作区。'
    case 'permission_denied': return '没有权限读取任务分析数据。'
    case 'source_missing': return '任务分析所需的数据源不存在。'
    case 'not_configured': return '任务分析数据源尚未配置。'
    case 'not_applicable': return '任务分析不适用于当前范围。'
    case 'unsupported': return '当前版本尚不支持任务分析。'
  }
}

function warningCodes(warnings: readonly AnalyticsWarning[]): Set<string> {
  return new Set(warnings.map((warning) => warning.code))
}

function TaskState({ state, message }: { state: DeepUiState; message?: string }) {
  return (
    <div
      className={`deep-analytics-state deep-analytics-state--${state}`}
      role={state === 'error' ? 'alert' : 'status'}
      aria-live={state === 'loading' ? 'polite' : undefined}
    >
      <span aria-hidden="true">{state === 'loading' ? '…' : state === 'error' ? '!' : state === 'unavailable' ? '—' : '○'}</span>
      <p>{message ?? stateLabel(state)}</p>
    </div>
  )
}

function WarningList({ warnings }: { warnings: readonly AnalyticsWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <section className="deep-analytics-warning" aria-labelledby="task-analytics-warning-title">
      <h4 id="task-analytics-warning-title">覆盖范围与数据说明</h4>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${index}`} data-severity={warning.severity}>{warning.message}</li>
        ))}
      </ul>
    </section>
  )
}

function SortButton({
  active,
  direction,
  children,
  onClick
}: {
  active: boolean
  direction: SortDirection
  children: string
  onClick: () => void
}) {
  return (
    <button type="button" className="deep-analytics-sort-button" onClick={onClick}>
      <span>{children}</span>
      <span aria-hidden="true">{active ? (direction === 'ascending' ? '↑' : '↓') : '↕'}</span>
    </button>
  )
}

export function TaskAnalytics({ result, loading = false, className = '' }: TaskAnalyticsProps) {
  const [sortKey, setSortKey] = useState<TaskSortKey>('focus')
  const [sortDirection, setSortDirection] = useState<SortDirection>('descending')
  const state: DeepUiState = loading || !result ? 'loading' : result.state
  const data = result && 'data' in result ? result.data : null
  const warnings = result?.warnings ?? []
  const codes = warningCodes(warnings)
  const lifecycleUnavailable = codes.has('task_history_missing')
  const scheduleUnavailable = lifecycleUnavailable || codes.has('schedule_history_missing')
  const attributionPartial = codes.has('task_attribution_missing')

  const sortedTasks = useMemo(() => {
    const tasks = [...(data?.topByAttributedFocus ?? [])]
    const multiplier = sortDirection === 'ascending' ? 1 : -1
    tasks.sort((left, right) => {
      if (sortKey === 'focus') return (left.focusSeconds - right.focusSeconds) * multiplier
      if (sortKey === 'status') {
        const leftStatus = Number(left.completedInRange) + Number(Boolean(left.currentlyDone))
        const rightStatus = Number(right.completedInRange) + Number(Boolean(right.currentlyDone))
        return (leftStatus - rightStatus) * multiplier
      }
      return left.title.localeCompare(right.title, 'zh-CN') * multiplier
    })
    return tasks
  }, [data?.topByAttributedFocus, sortDirection, sortKey])

  const setSort = (nextKey: TaskSortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => current === 'ascending' ? 'descending' : 'ascending')
    } else {
      setSortKey(nextKey)
      setSortDirection(nextKey === 'title' ? 'ascending' : 'descending')
    }
  }

  if (state === 'loading') {
    return (
      <section className={`deep-analytics-card task-analytics ${className}`.trim()} data-state={state} aria-busy="true">
        <TaskState state="loading" message="正在加载任务生命周期与显式归因数据。" />
        <div className="deep-analytics-skeleton" aria-hidden="true"><span /><span /><span /><span /></div>
      </section>
    )
  }

  if (!result) return null

  if (result.state === 'unavailable') {
    return (
      <section className={`deep-analytics-card task-analytics ${className}`.trim()} data-state={state}>
        <TaskState state="unavailable" message={unavailableMessage(result)} />
        <WarningList warnings={warnings} />
      </section>
    )
  }

  if (result.state === 'error') {
    return (
      <section className={`deep-analytics-card task-analytics ${className}`.trim()} data-state={state}>
        <TaskState state="error" message={result.error.message} />
        <WarningList warnings={warnings} />
      </section>
    )
  }

  if (!data) return null

  const maxPlanSeconds = Math.max(data.plan.plannedSeconds, data.plan.attributedFocusSeconds, 1)
  const plannedShare = data.plan.plannedSeconds / maxPlanSeconds
  const actualShare = data.plan.attributedFocusSeconds / maxPlanSeconds
  const asOf = data.current.asOf.slice(0, 10)

  return (
    <section className={`deep-analytics-card task-analytics ${className}`.trim()} data-state={state} aria-busy="false">
      <header className="deep-analytics-basis-row">
        <div>
          <span>区间任务事实</span>
          <strong>{rangeLabel(result)}</strong>
        </div>
        <div>
          <span>当前任务库存</span>
          <strong>截至 {asOf}，不随日期范围变化</strong>
        </div>
        <span className="deep-analytics-state-chip" data-state={state}>{stateLabel(state)}</span>
      </header>

      {result.state === 'partial' ? (
        <p className="deep-analytics-inline-status" role="status">仅展示已确认的数据；缺失历史不会按 0 处理。</p>
      ) : null}
      <WarningList warnings={warnings} />

      <div className="deep-analytics-split-grid">
        <section className="deep-analytics-panel" aria-labelledby="task-current-title">
          <div className="deep-analytics-panel-heading">
            <div><span>当前 · 范围不变</span><h4 id="task-current-title">任务库存</h4></div>
          </div>
          <dl className="deep-analytics-metric-grid">
            <div><dt>任务总数</dt><dd>{numberFormatter.format(data.current.total)}</dd></div>
            <div><dt>待办</dt><dd>{numberFormatter.format(data.current.open)}</dd></div>
            <div><dt>已完成</dt><dd>{numberFormatter.format(data.current.completed)}</dd></div>
            <div><dt>逾期</dt><dd>{numberFormatter.format(data.current.overdue)}</dd></div>
            <div className="deep-analytics-metric--wide">
              <dt>当前完成率</dt>
              <dd>{data.current.completionRate === null ? '不可用（没有当前任务）' : ratio(data.current.completionRate)}</dd>
            </div>
          </dl>
        </section>

        <section className="deep-analytics-panel" aria-labelledby="task-flow-title">
          <div className="deep-analytics-panel-heading">
            <div><span>所选区间 · 仅显式 lifecycle facts</span><h4 id="task-flow-title">任务流转</h4></div>
          </div>
          {lifecycleUnavailable ? (
            <TaskState state="unavailable" message="任务创建、完成、重开与删除历史不可用；当前 done 状态不会被倒推成区间事件。" />
          ) : (
            <dl className="deep-analytics-metric-grid">
              <div><dt>创建</dt><dd>{numberFormatter.format(data.flow.created)}</dd></div>
              <div><dt>完成</dt><dd>{numberFormatter.format(data.flow.completed)}</dd></div>
              <div><dt>重开</dt><dd>{numberFormatter.format(data.flow.reopened)}</dd></div>
              <div><dt>删除</dt><dd>{numberFormatter.format(data.flow.deleted)}</dd></div>
              <div className="deep-analytics-metric--wide"><dt>结转</dt><dd>不可用（区间起点库存未包含在聚合 DTO）</dd></div>
            </dl>
          )}
          <p className="deep-analytics-note">标题变化与 schedule 变化只认 taskId 对应的显式事实；不按标题相似度或“第一个未完成任务”猜测。</p>
        </section>
      </div>

      <section className="deep-analytics-panel task-analytics__plan" aria-labelledby="task-plan-title">
        <div className="deep-analytics-panel-heading">
          <div><span>所选区间 · schedule history + 显式 taskId 归因</span><h4 id="task-plan-title">计划与实际</h4></div>
          <strong>{scheduleUnavailable ? '不可用' : ratio(data.plan.executionRate)}</strong>
        </div>
        {scheduleUnavailable ? (
          <TaskState state="unavailable" message="缺少可重建的 schedule 历史；计划时长和执行率不能显示为 0。" />
        ) : (
          <>
            <dl className="deep-analytics-metric-grid">
              <div><dt>计划时长</dt><dd>{duration(data.plan.plannedSeconds)}</dd></div>
              <div><dt>计划次数</dt><dd>{numberFormatter.format(data.plan.scheduledOccurrences)}</dd></div>
              <div><dt>显式归因专注</dt><dd>{duration(data.plan.attributedFocusSeconds)}{attributionPartial ? '（部分）' : ''}</dd></div>
              <div><dt>计划执行率</dt><dd>{ratio(data.plan.executionRate)}</dd></div>
            </dl>
            <div className="task-analytics__comparison" aria-label={`计划 ${duration(data.plan.plannedSeconds)}；显式归因实际 ${duration(data.plan.attributedFocusSeconds)}；执行率 ${ratio(data.plan.executionRate)}`}>
              <div><span>计划</span><i style={{ inlineSize: `${plannedShare * 100}%` }} /></div>
              <div><span>实际</span><i style={{ inlineSize: `${actualShare * 100}%` }} /></div>
            </div>
            {data.plan.executionRate !== null && data.plan.executionRate > 1 ? (
              <p className="deep-analytics-note deep-analytics-note--accent">执行率超过 100% 是有效结果，不会被截断。</p>
            ) : null}
          </>
        )}
      </section>

      <section className="deep-analytics-attribution" aria-labelledby="task-attribution-title">
        <div>
          <span>未归因 / unknown</span>
          <h4 id="task-attribution-title">没有显式 taskId 的专注</h4>
          <p>这些专注仍计入个人专注总量，但不会进入任务耗时排行或计划执行率；组件不会事后猜测任务。</p>
        </div>
        <strong>{duration(data.unattributedFocusSeconds)}{attributionPartial ? '（覆盖不完整）' : ''}</strong>
      </section>

      <details className="deep-analytics-disclosure" open>
        <summary>展开任务耗时与显式归因表</summary>
        {sortedTasks.length === 0 ? (
          <TaskState state={lifecycleUnavailable || attributionPartial ? 'unavailable' : 'empty'} message={lifecycleUnavailable || attributionPartial ? '没有足够的显式 taskId 归因数据可生成排行。' : '所选区间没有显式归因的任务专注。'} />
        ) : (
          <div className="deep-analytics-table-wrap">
            <table className="deep-analytics-table">
              <caption>按显式 taskId 聚合的任务专注耗时；标题仅为事件时快照</caption>
              <thead>
                <tr>
                  <th scope="col" aria-sort={sortKey === 'title' ? sortDirection : 'none'}><SortButton active={sortKey === 'title'} direction={sortDirection} onClick={() => setSort('title')}>任务</SortButton></th>
                  <th scope="col">归因</th>
                  <th scope="col" aria-sort={sortKey === 'focus' ? sortDirection : 'none'}><SortButton active={sortKey === 'focus'} direction={sortDirection} onClick={() => setSort('focus')}>专注耗时</SortButton></th>
                  <th scope="col" aria-sort={sortKey === 'status' ? sortDirection : 'none'}><SortButton active={sortKey === 'status'} direction={sortDirection} onClick={() => setSort('status')}>状态</SortButton></th>
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((task) => (
                  <tr key={task.taskId} data-task-id={task.taskId}>
                    <td data-label="任务"><bdi dir="auto">{task.title}</bdi></td>
                    <td data-label="归因"><span className="deep-analytics-pill">显式 taskId</span><code><bdi dir="auto">{task.taskId}</bdi></code></td>
                    <td data-label="专注耗时">{duration(task.focusSeconds)}</td>
                    <td data-label="状态">
                      <span>{task.completedInRange ? '区间内完成' : '区间内未完成'}</span>
                      <small>{task.currentlyDone === null ? '当前状态未知' : task.currentlyDone ? '当前已完成' : '当前待办'}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <details className="deep-analytics-disclosure">
        <summary>查看任务历史与隐私口径</summary>
        <ul className="deep-analytics-contract-list">
          <li>区间历史只接受 created / completed / reopened / schedule changed / title changed / deleted 显式事实。</li>
          <li>任务耗时只接受 session 开始时捕获的 taskId；标题快照不会被用来推断归因。</li>
          <li>默认摘要导出省略任务标题；详细导出可包含页面可见标题，但不会包含正文、绝对路径或秘密。</li>
        </ul>
      </details>
    </section>
  )
}
