import { useMemo, useState } from 'react'
import type {
  AnalyticsDataState,
  AnalyticsSectionResult,
  AnalyticsWarning,
  ReviewAnalytics as ReviewAnalyticsData
} from '../types'
import '../deep-analytics.css'

type DeepUiState = AnalyticsDataState | 'loading'
type ReviewSortKey = 'lesson' | 'answered' | 'accuracy' | 'cards'
type SortDirection = 'ascending' | 'descending'

export type ReviewAnalyticsProps = {
  /** Cumulative/current and range review metrics supplied by the analytics aggregator. */
  result?: AnalyticsSectionResult<ReviewAnalyticsData>
  loading?: boolean
  className?: string
}

const integer = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 0 })

function stateLabel(state: DeepUiState): string {
  switch (state) {
    case 'loading': return '正在加载'
    case 'available': return '数据完整'
    case 'empty': return '当前没有复习记录'
    case 'partial': return '数据不完整'
    case 'unavailable': return '暂不可用'
    case 'error': return '加载失败'
  }
}

function reviewState(state: DeepUiState, message: string) {
  return (
    <div className={`deep-analytics-state deep-analytics-state--${state}`} role={state === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{state === 'loading' ? '…' : state === 'error' ? '!' : state === 'unavailable' ? '—' : '○'}</span>
      <p>{message}</p>
    </div>
  )
}

function warningList(warnings: readonly AnalyticsWarning[]) {
  if (warnings.length === 0) return null
  return (
    <section className="deep-analytics-warning" aria-labelledby="review-analytics-warning-title">
      <h4 id="review-analytics-warning-title">覆盖范围与数据说明</h4>
      <ul>{warnings.map((warning, index) => <li key={`${warning.code}-${index}`} data-severity={warning.severity}>{warning.message}</li>)}</ul>
    </section>
  )
}

function unavailableMessage(result: Extract<AnalyticsSectionResult<ReviewAnalyticsData>, { state: 'unavailable' }>): string {
  switch (result.reason) {
    case 'history_not_recorded': return '复习历史尚未记录，不能把缺失的区间正确率显示为 0。'
    case 'no_active_workspace': return '当前没有可读取复习进度的 Teaching workspace。'
    case 'permission_denied': return '没有权限读取复习数据。'
    case 'source_missing': return '复习进度或卡片数据源不存在。'
    case 'not_configured': return '复习数据源尚未配置。'
    case 'not_applicable': return '复习分析不适用于当前范围。'
    case 'unsupported': return '当前版本尚不支持复习分析。'
  }
}

function SortButton({ active, direction, children, onClick }: { active: boolean; direction: SortDirection; children: string; onClick: () => void }) {
  return (
    <button type="button" className="deep-analytics-sort-button" onClick={onClick}>
      <span>{children}</span><span aria-hidden="true">{active ? (direction === 'ascending' ? '↑' : '↓') : '↕'}</span>
    </button>
  )
}

export function ReviewAnalytics({ result, loading = false, className = '' }: ReviewAnalyticsProps) {
  const [sortKey, setSortKey] = useState<ReviewSortKey>('accuracy')
  const [sortDirection, setSortDirection] = useState<SortDirection>('ascending')
  const state: DeepUiState = loading || !result ? 'loading' : result.state
  const data = result && 'data' in result ? result.data : null

  const lessons = useMemo(() => {
    const rows = [...(data?.byLesson ?? [])]
    const multiplier = sortDirection === 'ascending' ? 1 : -1
    rows.sort((left, right) => {
      if (sortKey === 'answered') return (left.answered - right.answered) * multiplier
      if (sortKey === 'cards') return (left.reviewCardCount - right.reviewCardCount) * multiplier
      if (sortKey === 'accuracy') {
        const leftValue = left.accuracy ?? Number.POSITIVE_INFINITY
        const rightValue = right.accuracy ?? Number.POSITIVE_INFINITY
        return (leftValue - rightValue) * multiplier
      }
      return (left.title ?? '').localeCompare(right.title ?? '', 'zh-CN') * multiplier
    })
    return rows
  }, [data?.byLesson, sortDirection, sortKey])

  const updateSort = (key: ReviewSortKey) => {
    if (key === sortKey) setSortDirection((current) => current === 'ascending' ? 'descending' : 'ascending')
    else { setSortKey(key); setSortDirection(key === 'lesson' || key === 'accuracy' ? 'ascending' : 'descending') }
  }

  if (state === 'loading') {
    return (
      <section className={`deep-analytics-card review-analytics ${className}`.trim()} data-state={state} aria-busy="true">
        {reviewState(state, '正在加载累计复习进度与卡片库存。')}
        <div className="deep-analytics-skeleton" aria-hidden="true"><span /><span /><span /><span /></div>
      </section>
    )
  }
  if (!result) return null
  if (result.state === 'unavailable') {
    return <section className={`deep-analytics-card review-analytics ${className}`.trim()} data-state={state}>{reviewState(state, unavailableMessage(result))}{warningList(result.warnings)}</section>
  }
  if (result.state === 'error') {
    return <section className={`deep-analytics-card review-analytics ${className}`.trim()} data-state={state}>{reviewState(state, result.error.message)}{warningList(result.warnings)}</section>
  }
  if (!data) return null

  const rangeUnavailable = data.range.answered === null || data.range.correct === null
  const requested = result.coverage.requestedRange
  const selectedRange = requested.from === requested.to ? requested.from : `${requested.from} — ${requested.to}`
  const asOf = result.temporal.kind === 'as_of'
    ? result.temporal.asOf.slice(0, 10)
    : result.temporal.kind === 'mixed'
      ? result.temporal.asOf.slice(0, 10)
      : '截至现在'

  return (
    <section className={`deep-analytics-card review-analytics ${className}`.trim()} data-state={state} aria-busy="false">
      <header className="deep-analytics-basis-row">
        <div><span>累计 / 当前库存</span><strong>截至 {asOf}，不随日期范围变化</strong></div>
        <div><span>区间复习事实</span><strong>{selectedRange}</strong></div>
        <span className="deep-analytics-state-chip" data-state={state}>{stateLabel(state)}</span>
      </header>
      {result.state === 'partial' ? <p className="deep-analytics-inline-status" role="status">部分累计数据可用；缺失项不会显示为 0。</p> : null}
      {warningList(result.warnings)}

      <div className="deep-analytics-split-grid">
        <section className="deep-analytics-panel" aria-labelledby="review-current-title">
          <div className="deep-analytics-panel-heading"><div><span>累计 · range invariant</span><h4 id="review-current-title">复习进度与卡片库存</h4></div></div>
          <dl className="deep-analytics-metric-grid">
            <div><dt>累计作答</dt><dd>{integer.format(data.cumulative.totalAnswered)}</dd></div>
            <div><dt>累计答对</dt><dd>{integer.format(data.cumulative.correct)}</dd></div>
            <div><dt>累计正确率</dt><dd>{data.cumulative.accuracy === null ? '无作答' : percent.format(data.cumulative.accuracy)}</dd></div>
            <div><dt>当前复习卡片</dt><dd>{integer.format(data.cumulative.cardCount)}</dd></div>
          </dl>
        </section>

        <section className="deep-analytics-panel" aria-labelledby="review-range-title">
          <div className="deep-analytics-panel-heading"><div><span>所选区间 · timestamped review facts</span><h4 id="review-range-title">区间正确率</h4></div></div>
          {rangeUnavailable ? reviewState('unavailable', '没有 timestamped review_answered facts；区间作答、答对和正确率不可用，不能显示为 0。') : (
            <dl className="deep-analytics-metric-grid">
              <div><dt>区间作答</dt><dd>{integer.format(data.range.answered ?? 0)}</dd></div>
              <div><dt>区间答对</dt><dd>{integer.format(data.range.correct ?? 0)}</dd></div>
              <div className="deep-analytics-metric--wide"><dt>区间正确率</dt><dd>{data.range.accuracy === null ? '无作答' : percent.format(data.range.accuracy)}</dd></div>
            </dl>
          )}
          {rangeUnavailable ? <p className="deep-analytics-note deep-analytics-note--accent">warning：累计快照仍可用，但它不能回答所选日期范围内发生了什么。</p> : null}
        </section>
      </div>

      <details className="deep-analytics-disclosure" open>
        <summary>展开分 Lesson 累计复习表</summary>
        {lessons.length === 0 ? reviewState('empty', '当前没有按 Lesson 汇总的复习进度或卡片。') : (
          <div className="deep-analytics-table-wrap">
            <table className="deep-analytics-table">
              <caption>按 Lesson 的累计进度与当前卡片库存；不是所选范围的历史</caption>
              <thead><tr>
                <th scope="col" aria-sort={sortKey === 'lesson' ? sortDirection : 'none'}><SortButton active={sortKey === 'lesson'} direction={sortDirection} onClick={() => updateSort('lesson')}>Lesson</SortButton></th>
                <th scope="col" aria-sort={sortKey === 'answered' ? sortDirection : 'none'}><SortButton active={sortKey === 'answered'} direction={sortDirection} onClick={() => updateSort('answered')}>累计作答</SortButton></th>
                <th scope="col">累计答对</th>
                <th scope="col" aria-sort={sortKey === 'accuracy' ? sortDirection : 'none'}><SortButton active={sortKey === 'accuracy'} direction={sortDirection} onClick={() => updateSort('accuracy')}>累计正确率</SortButton></th>
                <th scope="col" aria-sort={sortKey === 'cards' ? sortDirection : 'none'}><SortButton active={sortKey === 'cards'} direction={sortDirection} onClick={() => updateSort('cards')}>当前卡片</SortButton></th>
              </tr></thead>
              <tbody>{lessons.map((lesson) => (
                <tr key={lesson.lessonId}>
                  <td data-label="Lesson"><bdi dir="auto">{lesson.title ?? '未命名 Lesson'}</bdi></td>
                  <td data-label="累计作答">{integer.format(lesson.answered)}</td>
                  <td data-label="累计答对">{integer.format(lesson.correct)}</td>
                  <td data-label="累计正确率">{lesson.accuracy === null ? '无作答' : percent.format(lesson.accuracy)}</td>
                  <td data-label="当前卡片">{integer.format(lesson.reviewCardCount)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </details>

      <details className="deep-analytics-disclosure">
        <summary>查看复习统计与隐私口径</summary>
        <ul className="deep-analytics-contract-list">
          <li>累计作答、累计正确率和当前卡片库存是截至现在的快照，切换日期范围不会改变。</li>
          <li>区间作答、答对与正确率只来自带时间戳的 review_answered facts；缺失时明确不可用。</li>
          <li>页面只显示汇总与 Lesson 标题，不显示题目正文、答案正文、绝对路径或秘密。</li>
        </ul>
      </details>
    </section>
  )
}
