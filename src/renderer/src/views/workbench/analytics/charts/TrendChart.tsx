import { useId, useMemo } from 'react'
import type { AnalyticsLocalDate } from '../types'

export type TrendSeries = {
  id: string
  label: string
  color: string
  /** One value per point, aligned to `dates`; null renders a gap. */
  values: readonly (number | null)[]
  /** Formats a value for the tooltip. */
  format: (value: number) => string
}

export type TrendChartProps = {
  dates: readonly AnalyticsLocalDate[]
  series: readonly TrendSeries[]
  title: string
  formatDate: (date: AnalyticsLocalDate) => string
  emptyLabel: string
}

const WIDTH = 640
const HEIGHT = 200
const PADDING_X = 12
const PADDING_TOP = 14
const PADDING_BOTTOM = 26

type PlottedPoint = { x: number; y: number | null }

function buildPath(points: readonly PlottedPoint[]): string {
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

/**
 * Multi-series trend line normalized per-series (each series to its own max), so
 * a large token count and a small focus count share the plot without one flattening
 * the other. Only the paths are drawn — no fills — to stay legible on glass.
 */
export function TrendChart({ dates, series, title, formatDate, emptyLabel }: TrendChartProps) {
  const titleId = useId()

  const plotted = useMemo(() => {
    const count = dates.length
    const plotWidth = WIDTH - PADDING_X * 2
    const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM
    return series.map((serie) => {
      const max = Math.max(1, ...serie.values.map((value) => value ?? 0))
      const points: PlottedPoint[] = serie.values.map((value, index) => ({
        x: count === 1 ? WIDTH / 2 : PADDING_X + (index / (count - 1)) * plotWidth,
        y: value === null ? null : PADDING_TOP + plotHeight - (value / max) * plotHeight
      }))
      return { ...serie, points, path: buildPath(points), max }
    })
  }, [dates.length, series])

  const hasData = series.some((serie) => serie.values.some((value) => value !== null && value > 0))
  if (!hasData) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const gridRatios = [0, 0.5, 1]

  return (
    <div className="trend-chart">
      <svg
        className="trend-chart__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        preserveAspectRatio="none"
      >
        <title id={titleId}>{title}</title>
        {gridRatios.map((ratio) => {
          const y = PADDING_TOP + (HEIGHT - PADDING_TOP - PADDING_BOTTOM) * ratio
          return (
            <line
              key={ratio}
              className="trend-chart__grid"
              x1={PADDING_X}
              x2={WIDTH - PADDING_X}
              y1={y}
              y2={y}
            />
          )
        })}
        {plotted.map((serie) => (
          <path
            key={serie.id}
            className="trend-chart__line"
            d={serie.path}
            fill="none"
            stroke={serie.color}
          />
        ))}
        {plotted.map((serie) => (
          serie.points.map((point, index) => (
            point.y === null ? null : (
              <circle
                key={`${serie.id}-${index}`}
                className="trend-chart__point"
                cx={point.x}
                cy={point.y}
                r={2.4}
                fill={serie.color}
              >
                <title>{`${formatDate(dates[index])} · ${serie.label}: ${serie.format(serie.values[index] ?? 0)}`}</title>
              </circle>
            )
          ))
        ))}
      </svg>
      <ul className="trend-chart__legend">
        {series.map((serie) => (
          <li key={serie.id}>
            <span className="trend-chart__swatch" style={{ background: serie.color }} aria-hidden="true" />
            {serie.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
