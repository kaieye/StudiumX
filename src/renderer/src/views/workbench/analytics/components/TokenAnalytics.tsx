import { useMemo, useState } from 'react'
import type {
  AnalyticsDateRange,
  AnalyticsSectionResult,
  AnalyticsWarning,
  LearningAnalyticsQuery,
  TokenAnalytics
} from '../types'
import '../token-analytics.css'

export type TokenAnalyticsFormatters = {
  number: (value: number) => string
  compactNumber: (value: number) => string
  localDate: (value: string) => string
  duration: (milliseconds: number) => string
  percent: (value: number | null) => string
}

export type TokenAnalyticsProps = {
  /** The page slot may pass the complete result envelope; the component performs no fetching. */
  result?: AnalyticsSectionResult<TokenAnalytics> | null
  query?: LearningAnalyticsQuery
  sectionId?: 'tokens'
  isRefreshing?: boolean
  isStale?: boolean
  onRetry?: () => void
  /** Allows the page or tests to render the shell-equivalent loading/unavailable/error states. */
  fallbackState?: 'loading' | 'unavailable' | 'error'
  fallbackMessage?: string
  formatters?: Partial<TokenAnalyticsFormatters>
}

type TokenDataResult = Extract<
  AnalyticsSectionResult<TokenAnalytics>,
  { state: 'available' | 'empty' | 'partial' }
>

type Grain = 'day' | 'week'
type ViewMode = 'chart' | 'table'
type TokenDayRow = TokenAnalytics['byDay'][number]

type AggregatedDayRow = {
  key: string
  label: string
  promptTokens?: number
  completionTokens?: number
  totalTokens: number
  runs: number
  sourceDates: string[]
}

const defaultFormatters: TokenAnalyticsFormatters = {
  number: (value) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value),
  compactNumber: (value) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value),
  localDate: (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return value
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
  },
  duration: (milliseconds) => {
    const minutes = Math.round(Math.max(0, milliseconds) / 60_000)
    if (minutes < 60) return `${minutes} min`
    const hours = minutes / 60
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(hours)} h`
  },
  percent: (value) => value === null ? '—' : new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(value)
}

function mergeFormatters(overrides?: Partial<TokenAnalyticsFormatters>): TokenAnalyticsFormatters {
  return { ...defaultFormatters, ...overrides }
}

function getRange(result: TokenDataResult, query?: LearningAnalyticsQuery): AnalyticsDateRange {
  return query?.range ?? result.coverage.requestedRange
}

function isDateInRange(value: string, range: AnalyticsDateRange): boolean {
  return value >= range.from && value <= range.to
}

function dateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Uses the browser's local calendar only for arithmetic on an already local YYYY-MM-DD key. */
function localDateFromKey(value: string): Date | null {
  const parts = dateParts(value)
  if (!parts) return null
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12)
  return Number.isNaN(date.getTime()) ? null : date
}

function localDateKey(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

function mondayKey(value: string): string {
  const date = localDateFromKey(value)
  if (!date) return value
  const mondayOffset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - mondayOffset)
  return localDateKey(date)
}

function addDays(value: string, days: number): string {
  const date = localDateFromKey(value)
  if (!date) return value
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

function aggregateByGrain(rows: readonly TokenDayRow[], grain: Grain, range: AnalyticsDateRange, formatters: TokenAnalyticsFormatters): AggregatedDayRow[] {
  const groups = new Map<string, AggregatedDayRow>()
  for (const row of rows) {
    if (!isDateInRange(row.date, range)) continue
    const key = grain === 'day' ? row.date : mondayKey(row.date)
    const current = groups.get(key) ?? {
      key,
      label: '',
      totalTokens: 0,
      runs: 0,
      sourceDates: []
    }
    const hasComponents = row.promptTokens !== undefined && row.completionTokens !== undefined
    if (hasComponents) {
      current.promptTokens = (current.promptTokens ?? 0) + row.promptTokens!
      current.completionTokens = (current.completionTokens ?? 0) + row.completionTokens!
    }
    current.totalTokens += row.totalTokens
    current.runs += row.runs
    current.sourceDates.push(row.date)
    groups.set(key, current)
  }

  return [...groups.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((row) => {
      if (grain === 'day') return { ...row, label: formatters.localDate(row.key) }
      const end = addDays(row.key, 6)
      const visibleEnd = end > range.to ? range.to : end
      return {
        ...row,
        label: `${formatters.localDate(row.key)} — ${formatters.localDate(visibleEnd)}`
      }
    })
}

function displayName(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback
}

function Value({ value, formatters, compact = false }: { value: number | undefined; formatters: TokenAnalyticsFormatters; compact?: boolean }) {
  if (value === undefined) return <span className="token-unknown" aria-label="未提供">—</span>
  return <span title={formatters.number(value)}>{compact ? formatters.compactNumber(value) : formatters.number(value)}</span>
}

function StateMessage({ state, message, onRetry }: { state: 'loading' | 'unavailable' | 'error'; message?: string; onRetry?: () => void }) {
  const copy = {
    loading: ['正在加载 Token 分析', '数据正在准备中。'],
    unavailable: ['Token 分析不可用', message ?? '当前范围或数据源没有可用的 Token 数据。'],
    error: ['Token 分析加载失败', message ?? '读取 Token 分析时发生错误。']
  }[state]
  return (
    <div className={`token-analytics-state token-analytics-state--${state}`} role={state === 'error' ? 'alert' : 'status'}>
      <span className="token-analytics-state__mark" aria-hidden="true">{state === 'loading' ? '…' : state === 'error' ? '!' : '—'}</span>
      <div>
        <strong>{copy[0]}</strong>
        <p>{copy[1]}</p>
        {state === 'error' && onRetry ? <button type="button" className="token-analytics-button" onClick={onRetry}>重试</button> : null}
      </div>
    </div>
  )
}

function WarningDetails({ warnings }: { warnings: readonly AnalyticsWarning[] }) {
  if (!warnings.length) return null
  return (
    <details className="token-analytics-disclosure" data-testid="token-warnings">
      <summary>查看 {warnings.length} 条完整性说明</summary>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${index}`} data-severity={warning.severity}>
            <span>{warning.message}</span>
            {warning.source ? <small>来源：{warning.source}</small> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}

function CoveragePanel({ data, result, query, formatters }: { data: TokenAnalytics; result: TokenDataResult; query?: LearningAnalyticsQuery; formatters: TokenAnalyticsFormatters }) {
  const coverage = data.sourceCoverage
  const range = getRange(result, query)
  const hasFallback = coverage.ledgerFallbackConversations > 0
  const hasPartial = coverage.conversationsPartiallyMissingUsage > 0 || coverage.invalidLedgerRows > 0 || !result.coverage.complete
  return (
    <section className="token-analytics-panel token-analytics-coverage-panel" aria-labelledby="token-coverage-title">
      <div className="token-analytics-panel-heading">
        <div>
          <h4 id="token-coverage-title">来源与覆盖范围</h4>
          <p>区间为双端包含：{formatters.localDate(range.from)} — {formatters.localDate(range.to)}。本地日期来自 usage fact 的发生时间与查询时区。</p>
        </div>
        <span className={`token-analytics-badge ${hasPartial ? 'is-warning' : 'is-complete'}`}>
          {hasPartial ? '部分覆盖' : '覆盖完整'}
        </span>
      </div>
      <div className="token-analytics-coverage-grid">
        <div><span>对话已扫描</span><strong>{formatters.number(coverage.conversationsScanned)}</strong></div>
        <div><span>可读取对话</span><strong>{formatters.number(coverage.conversationsReadable)}</strong></div>
        <div><span>包含 usage</span><strong>{formatters.number(coverage.conversationsWithUsage)}</strong></div>
        <div><span>部分缺 usage</span><strong>{formatters.number(coverage.conversationsPartiallyMissingUsage)}</strong></div>
        <div><span>Ledger 快照</span><strong>{formatters.number(coverage.ledgerSnapshotsScanned)}</strong></div>
        <div><span>Ledger 兜底对话</span><strong>{formatters.number(coverage.ledgerFallbackConversations)}</strong></div>
        <div><span>无效 Ledger 行</span><strong>{formatters.number(coverage.invalidLedgerRows)}</strong></div>
        <div><span>模型拆分</span><strong className="token-analytics-unavailable-value">不可用</strong></div>
      </div>
'      <div className="token-analytics-source-coverage" aria-label="分析来源覆盖状态">
        {result.coverage.sources.map((source) => (
          <div key={source.source}>
            <span dir="auto">{source.source}</span>
            <strong data-source-state={source.state}>{source.state}</strong>
            <small>{formatters.number(source.included)} / {formatters.number(source.scanned)} 已纳入</small>
          </div>
        ))}
      </div>
      <div className="token-analytics-source-notes">'
        <p><strong>计数口径：</strong>优先使用对话 turn usage；对话 usage 缺失时才使用去重后的 Ledger 最新快照。Ledger 快照不会逐行相加。</p>
        <p><strong>日期口径：</strong>趋势只使用 turn/usage fact 的发生日期；不会用 conversation updatedAt 代替 turn 时间。</p>
        {hasFallback ? <p className="is-warning">部分对话使用 Ledger 兜底，因此 prompt/completion 或细粒度工具覆盖可能不完整。</p> : null}
        {hasPartial ? <p className="is-warning">缺失记录不是 0。请展开“完整性说明”查看缺口和可操作的修复提示。</p> : null}
      </div>
    </section>
  )
}

function TotalsPanel({ data, formatters }: { data: TokenAnalytics; formatters: TokenAnalyticsFormatters }) {
  const metrics: Array<[string, number | undefined, boolean]> = [
    ['Total tokens', data.totals.totalTokens, true],
    ['Prompt tokens', data.totals.promptTokens, false],
    ['Completion tokens', data.totals.completionTokens, false],
    ['Provider calls', data.totals.providerCalls, false],
    ['Tool calls', data.totals.toolCalls, false],
    ['Tool errors', data.totals.toolErrors, false],
    ['Iterations', data.totals.iterations, false],
    ['Child runs', data.totals.childRuns, false],
    ['Budget stops', data.totals.budgetStops, false]
  ]
  return (
    <section className="token-analytics-panel" aria-labelledby="token-totals-title">
      <div className="token-analytics-panel-heading">
        <div><h4 id="token-totals-title">Token 总览</h4><p>大数默认紧凑显示，悬停或展开明细可查看精确值。</p></div>
      </div>
      <div className="token-analytics-total-grid">
        {metrics.map(([label, value, primary]) => (
          <div className={primary ? 'token-analytics-total token-analytics-total--primary' : 'token-analytics-total'} key={label}>
            <span>{label}</span>
            <strong><Value value={value} formatters={formatters} compact /></strong>
            {value !== undefined ? <small>{formatters.number(value)}</small> : <small>未提供，未推断</small>}
          </div>
        ))}
      </div>
    </section>
  )
}

function TrendPanel({ data, result, query, formatters }: { data: TokenAnalytics; result: TokenDataResult; query?: LearningAnalyticsQuery; formatters: TokenAnalyticsFormatters }) {
  const [grain, setGrain] = useState<Grain>('day')
  const [view, setView] = useState<ViewMode>('chart')
  const range = getRange(result, query)
  const rows = useMemo(() => aggregateByGrain(data.byDay, grain, range, formatters), [data.byDay, formatters, grain, range])
  const maxTokens = Math.max(...rows.map((row) => row.totalTokens), 0)
  const chartWidth = 720
  const chartHeight = 210
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? chartWidth / 2 : (index / (rows.length - 1)) * (chartWidth - 32) + 16
    const y = maxTokens === 0 ? chartHeight - 24 : chartHeight - 24 - (row.totalTokens / maxTokens) * (chartHeight - 48)
    return { ...row, x, y }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  return (
    <section className="token-analytics-panel token-analytics-trend-panel" aria-labelledby="token-trend-title">
      <div className="token-analytics-panel-heading token-analytics-panel-heading--controls">
        <div><h4 id="token-trend-title">按本地日期趋势</h4><p>未出现的日期不补成 0；它们可能没有可覆盖的 usage fact。</p></div>
        <div className="token-analytics-control-group" aria-label="趋势显示控制">
          <div className="token-analytics-segmented" role="group" aria-label="时间粒度">
            <button type="button" aria-pressed={grain === 'day'} onClick={() => setGrain('day')}>日</button>
            <button type="button" aria-pressed={grain === 'week'} onClick={() => setGrain('week')}>周</button>
          </div>
          <div className="token-analytics-segmented" role="group" aria-label="趋势视图">
            <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>图表</button>
            <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>表格</button>
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="token-analytics-no-data" role="status">当前范围没有可显示的日期桶；这不是对缺失日期的零值猜测。</p>
      ) : view === 'chart' ? (
        <>
          <div className="token-analytics-chart-wrap" role="img" aria-label="Token 使用趋势图">
            <svg className="token-analytics-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} aria-hidden="true">
              <title id="token-trend-chart-title">Token 使用趋势图</title>
              <desc id="token-trend-chart-desc">按{grain === 'day' ? '本地日' : '本地周'}显示 total tokens。详细数据可切换到表格视图。</desc>
              <line x1="16" y1={chartHeight - 24} x2={chartWidth - 16} y2={chartHeight - 24} className="token-analytics-chart-axis" />
              {path ? <path d={path} className="token-analytics-chart-line" fill="none" /> : null}
              {points.map((point) => (
                <circle key={point.key} cx={point.x} cy={point.y} r="5" className="token-analytics-chart-point">
                  <title>{`${point.label}：${formatters.number(point.totalTokens)} tokens`}</title>
                </circle>
              ))}
            </svg>
          </div>
          <div className="token-analytics-chart-summary" aria-live="polite">
            {points.map((point) => <span key={point.key}><b>{point.label}</b><Value value={point.totalTokens} formatters={formatters} compact /></span>)}
          </div>
        </>
      ) : (
        <TokenTrendTable rows={rows} grain={grain} formatters={formatters} />
      )}
    </section>
  )
}

function TokenTrendTable({ rows, grain, formatters }: { rows: readonly AggregatedDayRow[]; grain: Grain; formatters: TokenAnalyticsFormatters }) {
  return (
    <div className="token-analytics-table-wrap">
      <table className="token-analytics-table">
        <caption>{grain === 'day' ? '按日 Token 使用' : '按周 Token 使用'}</caption>
        <thead><tr><th scope="col">本地日期</th><th scope="col">总 tokens</th><th scope="col">Prompt</th><th scope="col">Completion</th><th scope="col">运行次数</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td><Value value={row.totalTokens} formatters={formatters} /></td><td><Value value={row.promptTokens} formatters={formatters} /></td><td><Value value={row.completionTokens} formatters={formatters} /></td><td>{formatters.number(row.runs)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function RankingTable({ data, formatters }: { data: TokenAnalytics; formatters: TokenAnalyticsFormatters }) {
  return (
    <div className="token-analytics-ranking-grid">
      <section className="token-analytics-panel" aria-labelledby="token-conversations-title">
        <div className="token-analytics-panel-heading"><div><h4 id="token-conversations-title">按对话</h4><p>名称仅显示安全的标题；不显示正文、参数、结果或路径。</p></div></div>
        <div className="token-analytics-table-wrap"><table className="token-analytics-table"><caption>对话 Token 排名</caption><thead><tr><th scope="col">对话</th><th scope="col">来源</th><th scope="col">总 tokens</th><th scope="col">消息</th><th scope="col">工具错误</th></tr></thead><tbody>
          {data.byConversation.length ? data.byConversation.map((row) => <tr key={row.conversationKey}><th scope="row"><span dir="auto" className="token-analytics-name">{displayName(row.title, '未命名对话')}</span>{row.workspaceName ? <small dir="auto">{row.workspaceName}</small> : null}</th><td><span className={`token-analytics-source-badge is-${row.source === 'conversation' ? 'primary' : 'fallback'}`}>{row.source === 'conversation' ? 'turn usage' : 'ledger 兜底'}</span></td><td><Value value={row.totalTokens} formatters={formatters} /></td><td>{formatters.number(row.messageCount)}</td><td>{formatters.number(row.toolErrors)}</td></tr>) : <tr><td colSpan={5}>无可覆盖对话</td></tr>}
        </tbody></table></div>
      </section>
      <section className="token-analytics-panel" aria-labelledby="token-workspaces-title">
        <div className="token-analytics-panel-heading"><div><h4 id="token-workspaces-title">按工作区</h4><p>长名称会换行，不以绝对路径补全。</p></div></div>
        <div className="token-analytics-table-wrap"><table className="token-analytics-table"><caption>工作区 Token 排名</caption><thead><tr><th scope="col">工作区</th><th scope="col">总 tokens</th><th scope="col">对话数</th></tr></thead><tbody>
          {data.byWorkspace.length ? data.byWorkspace.map((row) => <tr key={row.workspaceId}><th scope="row"><span dir="auto" className="token-analytics-name">{displayName(row.name, '未命名工作区')}</span></th><td><Value value={row.totalTokens} formatters={formatters} /></td><td>{formatters.number(row.conversationCount)}</td></tr>) : <tr><td colSpan={3}>无可覆盖工作区</td></tr>}
        </tbody></table></div>
      </section>
      <section className="token-analytics-panel" aria-labelledby="token-tools-title">
        <div className="token-analytics-panel-heading"><div><h4 id="token-tools-title">按工具</h4><p>仅显示工具名称和计数，不显示 tool args/results。</p></div></div>
        <div className="token-analytics-table-wrap"><table className="token-analytics-table"><caption>工具调用统计</caption><thead><tr><th scope="col">工具</th><th scope="col">调用</th><th scope="col">错误</th></tr></thead><tbody>
          {data.byTool.length ? data.byTool.map((row) => <tr key={row.name}><th scope="row"><span dir="auto" className="token-analytics-name">{row.name}</span></th><td>{formatters.number(row.calls)}</td><td>{formatters.number(row.errors)}</td></tr>) : <tr><td colSpan={3}>无可覆盖工具调用</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  )
}

function EfficiencyPanel({ data, formatters }: { data: TokenAnalytics; formatters: TokenAnalyticsFormatters }) {
  const items: Array<[string, string]> = [
    ['平均每 usage fact', data.efficiency.averageTokensPerUsageFact === null ? '—' : formatters.compactNumber(data.efficiency.averageTokensPerUsageFact)],
    ['平均每对话', data.efficiency.averageTokensPerConversation === null ? '—' : formatters.compactNumber(data.efficiency.averageTokensPerConversation)],
    ['平均每消息', data.efficiency.averageTokensPerMessage === null ? '—' : formatters.compactNumber(data.efficiency.averageTokensPerMessage)],
    ['平均时长', data.efficiency.averageDurationMs === null ? '—' : formatters.duration(data.efficiency.averageDurationMs)],
    ['工具错误率', formatters.percent(data.efficiency.toolErrorRate)]
  ]
  return (
    <section className="token-analytics-panel" aria-labelledby="token-efficiency-title">
      <div className="token-analytics-panel-heading"><div><h4 id="token-efficiency-title">效率与上下文治理</h4><p>空值代表没有可用分母，不等于 0。</p></div></div>
      <div className="token-analytics-efficiency-grid">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <dl className="token-analytics-governance-list">
        <div><dt>压缩事件</dt><dd>{formatters.number(data.contextGovernance.compactionEvents)}</dd></div>
        <div><dt>替换 tokens</dt><dd>{formatters.number(data.contextGovernance.replacedTokens)}</dd></div>
        <div><dt>卫生节省 tokens</dt><dd>{formatters.number(data.contextGovernance.hygieneSavedTokens)}</dd></div>
        <div><dt>子运行占比</dt><dd>{formatters.percent(data.contextGovernance.childRunShare)}</dd></div>
      </dl>
    </section>
  )
}

export function TokenAnalytics({
  result = null,
  query,
  isRefreshing = false,
  isStale = false,
  onRetry,
  fallbackState,
  fallbackMessage,
  formatters: formatterOverrides
}: TokenAnalyticsProps) {
  const formatters = useMemo(() => mergeFormatters(formatterOverrides), [formatterOverrides])
  const state = result?.state ?? fallbackState ?? 'loading'

  if (!result || state === 'loading' || state === 'unavailable' || state === 'error') {
    return <StateMessage state={state as 'loading' | 'unavailable' | 'error'} message={result?.state === 'error' ? result.error.message : fallbackMessage} onRetry={onRetry} />
  }

  const dataResult = result as TokenDataResult
  const data = dataResult.data
  return (
    <div className="token-analytics" data-token-state={dataResult.state} data-refreshing={isRefreshing || undefined} data-stale={isStale || undefined}>
      <div className="token-analytics-intro" role="note">
        <p><strong>{dataResult.state === 'empty' ? '当前范围为完整空结果。' : dataResult.state === 'partial' ? '当前结果可用，但存在已知缺口。' : '当前结果来自已接入的数据源。'}</strong> prompt/completion 只有后端明确提供时才展示；不会从 total tokens 反推。</p>
      </div>
      <WarningDetails warnings={dataResult.warnings} />
      <TotalsPanel data={data} formatters={formatters} />
      <CoveragePanel data={data} result={dataResult} query={query} formatters={formatters} />
      <TrendPanel data={data} result={dataResult} query={query} formatters={formatters} />
      <RankingTable data={data} formatters={formatters} />
      <EfficiencyPanel data={data} formatters={formatters} />
    </div>
  )
}

export default TokenAnalytics
