import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAnalyticsCopy } from '../analyticsCopy'
import type { AnalyticsSectionResult, TokenAnalytics } from '../types'

export type TokenConsumptionCardProps = {
  result: AnalyticsSectionResult<TokenAnalytics> | null
  localToday: string
  isRefreshing?: boolean
  isStale?: boolean
  fallbackState?: 'loading' | 'unavailable' | 'error'
  fallbackMessage?: string
  onRetry: () => void
}

type ChartRange = 7 | 30
type ChartPoint = {
  date: string
  value: number | null
  x: number
  y: number | null
}

const CHART_WIDTH = 760
const CHART_HEIGHT = 220
const CHART_PADDING_X = 24
const CHART_PADDING_TOP = 18
const CHART_PADDING_BOTTOM = 34

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  return Number.isNaN(date.getTime()) ? null : date
}

function localDateKey(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

function addLocalDays(value: string, days: number): string {
  const date = parseLocalDate(value)
  if (!date) return value
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

function buildDateKeys(today: string, days: ChartRange): string[] {
  return Array.from({ length: days }, (_, index) => addLocalDays(today, index - days + 1))
}

function formatDate(value: string, locale: string): string {
  const date = parseLocalDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(date)
}

function buildPath(points: ChartPoint[]): string {
  let path = ''
  let drawing = false
  for (const point of points) {
    if (point.y === null) {
      drawing = false
      continue
    }
    path += `${drawing ? ' L' : ' M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    drawing = true
  }
  return path.trim()
}

export function TokenConsumptionCard({
  result,
  localToday,
  isRefreshing = false,
  isStale = false,
  fallbackState = 'loading',
  fallbackMessage,
  onRetry
}: TokenConsumptionCardProps) {
  const { i18n } = useTranslation()
  const copy = getAnalyticsCopy(i18n.language || 'zh-CN')
  const locale = i18n.language?.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
  const [chartRange, setChartRange] = useState<ChartRange>(7)
  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])
  const dataResult = result && (result.state === 'available' || result.state === 'partial' || result.state === 'empty')
    ? result
    : null
  const data = dataResult?.data
  const dateKeys = useMemo(() => buildDateKeys(localToday, chartRange), [chartRange, localToday])
  const dailyValues = useMemo(() => {
    const byDate = new Map(data?.byDay.map((row) => [row.date, row.totalTokens]) ?? [])
    const complete = dataResult?.coverage.complete ?? false
    return dateKeys.map((date) => ({ date, value: byDate.get(date) ?? (complete ? 0 : null) }))
  }, [data?.byDay, dataResult?.coverage.complete, dateKeys])
  const maxValue = Math.max(1, ...dailyValues.map((point) => point.value ?? 0))
  const plotHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM
  const points: ChartPoint[] = dailyValues.map((point, index) => {
    const x = dateKeys.length === 1
      ? CHART_WIDTH / 2
      : CHART_PADDING_X + (index / (dateKeys.length - 1)) * (CHART_WIDTH - CHART_PADDING_X * 2)
    const y = point.value === null
      ? null
      : CHART_PADDING_TOP + plotHeight - (point.value / maxValue) * plotHeight
    return { ...point, x, y }
  })
  const path = buildPath(points)
  const todayValue = dailyValues.at(-1)?.value ?? null
  const status = result?.state ?? fallbackState
  const stateMessage = result?.state === 'error'
    ? result.error.message
    : result?.state === 'unavailable'
      ? copy.states.unavailableReasons[result.reason]
      : status === 'loading'
        ? copy.states.loading
        : fallbackMessage ?? copy.page.unavailableDetail

  return (
    <article className="token-consumption-card" data-state={status} aria-busy={isRefreshing}>
      <div className="token-consumption-card__header">
        <div>
          <p>{copy.page.tokenCalculatorEyebrow}</p>
          <h2>{copy.page.tokenCalculatorTitle}</h2>
        </div>
        <button
          type="button"
          className="token-consumption-card__refresh"
          onClick={onRetry}
          disabled={isRefreshing}
          aria-label={copy.page.refresh}
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>

      {data ? (
        <>
          <div className="token-consumption-card__metrics">
            <div>
              <span>{copy.page.totalTokenUsage}</span>
              <strong>{number.format(data.totals.totalTokens)}</strong>
              <small>Tokens</small>
            </div>
            <div>
              <span>{copy.page.todayTokenUsage}</span>
              <strong>{todayValue === null ? '—' : number.format(todayValue)}</strong>
              <small>{formatDate(localToday, locale)}</small>
            </div>
          </div>

          <div className="token-consumption-card__chart-header">
            <div>
              <h3>{copy.page.tokenTrend}</h3>
              {isStale || dataResult?.state === 'partial' ? <p>{copy.page.tokenDataPartial}</p> : null}
            </div>
            <div className="token-consumption-card__range" aria-label={copy.page.tokenTrendRange}>
              {([7, 30] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={chartRange === days}
                  onClick={() => setChartRange(days)}
                >
                  {days === 7 ? copy.page.last7Days : copy.page.last30Days}
                </button>
              ))}
            </div>
          </div>

          <div className="token-consumption-card__chart" role="img" aria-label={`${copy.page.tokenTrend}，${chartRange === 7 ? copy.page.last7Days : copy.page.last30Days}`}>
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} aria-hidden="true">
              {[0, 0.5, 1].map((ratio) => {
                const y = CHART_PADDING_TOP + plotHeight * ratio
                return <line key={ratio} x1={CHART_PADDING_X} x2={CHART_WIDTH - CHART_PADDING_X} y1={y} y2={y} className="token-consumption-card__grid-line" />
              })}
              {path ? <path d={path} className="token-consumption-card__line" fill="none" /> : null}
              {points.map((point) => point.y === null ? null : (
                <circle key={point.date} cx={point.x} cy={point.y} r={chartRange === 7 ? 4.5 : 3} className="token-consumption-card__point">
                  <title>{`${formatDate(point.date, locale)}：${number.format(point.value ?? 0)} tokens`}</title>
                </circle>
              ))}
            </svg>
            <div className="token-consumption-card__axis" aria-hidden="true">
              <span>{formatDate(dateKeys[0], locale)}</span>
              <span>{formatDate(localToday, locale)}</span>
            </div>
            {!path ? <p className="token-consumption-card__empty">{copy.page.noTokenTrendData}</p> : null}
          </div>
        </>
      ) : (
        <div className="token-consumption-card__state" role={status === 'error' ? 'alert' : 'status'}>
          <p>{stateMessage}</p>
          {status !== 'loading' ? (
            <button type="button" onClick={onRetry}>{copy.page.retry}</button>
          ) : null}
        </div>
      )}
    </article>
  )
}

export default TokenConsumptionCard
