import { useId, useMemo, useState } from 'react'
import type { AnalyticsLocalDate } from '../types'
import { categoricalColor } from './palette'

export type StackedBarSeries = {
  id: string
  label: string
  color?: string
  /** One value per date index; missing treated as 0. */
  values: readonly number[]
}

export type StackedBarChartProps = {
  dates: readonly AnalyticsLocalDate[]
  series: readonly StackedBarSeries[]
  title: string
  formatDate: (date: AnalyticsLocalDate) => string
  formatValue: (value: number) => string
  emptyLabel: string
  /** Label for the tooltip total row (e.g. 合计 / Total). */
  totalLabel: string
}

const WIDTH = 640
const HEIGHT = 220
const PADDING_LEFT = 12
const PADDING_RIGHT = 12
const PADDING_TOP = 16
const PADDING_BOTTOM = 34
const BAR_GAP_RATIO = 0.32
const TOP_RADIUS = 3
const MAX_TOOLTIP_SEGMENTS = 12

type PaintedSegment = {
  id: string
  label: string
  color: string
  value: number
  x: number
  y: number
  width: number
  height: number
  isTop: boolean
}

type PaintedColumn = {
  date: AnalyticsLocalDate
  total: number
  centerX: number
  slotX: number
  slotWidth: number
  barX: number
  barWidth: number
  topY: number
  segments: PaintedSegment[]
}

function buildTooltipRows(active: PaintedColumn | null): PaintedSegment[] {
  if (!active) return []
  const rows = [...active.segments]
    .filter((segment) => segment.value > 0)
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
  if (rows.length <= MAX_TOOLTIP_SEGMENTS) return rows
  const visible = rows.slice(0, MAX_TOOLTIP_SEGMENTS)
  const overflowTotal = rows.slice(MAX_TOOLTIP_SEGMENTS).reduce((sum, row) => sum + row.value, 0)
  return [
    ...visible,
    {
      id: '__other__',
      label: '…',
      color: '#8a8a8a',
      value: overflowTotal,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      isTop: false
    }
  ]
}

/**
 * Vertical stacked bars for multi-category daily totals (e.g. tokens by model).
 * Stack presentation + dimension tooltip follow new-api Model Analytics:
 * active column highlight, dim siblings, floating total + per-model rows.
 */
export function StackedBarChart({
  dates,
  series,
  title,
  formatDate,
  formatValue,
  emptyLabel,
  totalLabel
}: StackedBarChartProps) {
  const titleId = useId()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const painted = useMemo(() => {
    const count = dates.length
    const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT
    const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM
    const baselineY = PADDING_TOP + plotHeight
    const colored = series.map((serie, index) => ({
      ...serie,
      color: serie.color ?? categoricalColor(index)
    }))

    const totals = dates.map((_, dayIndex) =>
      colored.reduce((sum, serie) => sum + Math.max(0, serie.values[dayIndex] ?? 0), 0)
    )
    const max = Math.max(1, ...totals)
    const slot = count > 0 ? plotWidth / count : plotWidth
    const barWidth = Math.max(4, slot * (1 - BAR_GAP_RATIO))

    const columns: PaintedColumn[] = dates.map((date, dayIndex) => {
      let cursor = baselineY
      const rawSegments: Array<Omit<PaintedSegment, 'isTop'>> = []
      for (const serie of colored) {
        const value = Math.max(0, serie.values[dayIndex] ?? 0)
        if (value <= 0) continue
        const height = (value / max) * plotHeight
        const y = cursor - height
        rawSegments.push({
          id: serie.id,
          label: serie.label,
          color: serie.color,
          value,
          x: PADDING_LEFT + dayIndex * slot + (slot - barWidth) / 2,
          y,
          width: barWidth,
          height
        })
        cursor = y
      }

      const segments: PaintedSegment[] = rawSegments.map((segment, index) => ({
        ...segment,
        isTop: index === rawSegments.length - 1
      }))

      const topY = segments.length > 0 ? Math.min(...segments.map((segment) => segment.y)) : baselineY
      const barX = PADDING_LEFT + dayIndex * slot + (slot - barWidth) / 2

      return {
        date,
        total: totals[dayIndex] ?? 0,
        centerX: PADDING_LEFT + dayIndex * slot + slot / 2,
        slotX: PADDING_LEFT + dayIndex * slot,
        slotWidth: slot,
        barX,
        barWidth,
        topY,
        segments
      }
    })

    return { columns, colored, baselineY, plotHeight }
  }, [dates, series])

  const hasData = painted.columns.some((column) => column.total > 0)
  const active = activeIndex !== null ? painted.columns[activeIndex] ?? null : null
  const activeTooltipRows = useMemo(() => buildTooltipRows(active), [active])
  const activeReadout = active
    ? `${formatDate(active.date)} · ${totalLabel} ${formatValue(active.total)}${
        activeTooltipRows.length
          ? ` · ${activeTooltipRows.map((segment) => `${segment.label} ${formatValue(segment.value)}`).join(' / ')}`
          : ''
      }`
    : ''

  if (!hasData) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const gridRatios = [0, 0.5, 1]
  const tickEvery = Math.max(1, Math.ceil(dates.length / 7))

  const tooltipStyle = active
    ? ({
        // Keep the panel inside the plot; center on the bar when space allows.
        left: `${Math.min(88, Math.max(12, (active.centerX / WIDTH) * 100))}%`,
        // Prefer sitting just above the stack top, but never leave the plot.
        top: `${Math.min(58, Math.max(2, ((active.topY - 12) / HEIGHT) * 100))}%`
      } as const)
    : undefined

  return (
    <div
      className="stacked-bar-chart"
      data-has-active={activeIndex !== null}
      onPointerLeave={() => setActiveIndex(null)}
    >
      <div className="stacked-bar-chart__plot">
        <svg
          className="stacked-bar-chart__svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={titleId}
          preserveAspectRatio="none"
        >
          <title id={titleId}>{title}</title>
          {gridRatios.map((ratio) => {
            const y = PADDING_TOP + painted.plotHeight * ratio
            return (
              <line
                key={ratio}
                className="stacked-bar-chart__grid"
                x1={PADDING_LEFT}
                x2={WIDTH - PADDING_RIGHT}
                y1={y}
                y2={y}
              />
            )
          })}

          {active ? (
            <line
              className="stacked-bar-chart__guide"
              x1={active.centerX}
              x2={active.centerX}
              y1={PADDING_TOP}
              y2={painted.baselineY}
            />
          ) : null}

          {painted.columns.map((column, index) => {
            const isActive = activeIndex === index
            const isDimmed = activeIndex !== null && !isActive
            return (
              <g
                key={column.date}
                className="stacked-bar-chart__column"
                data-active={isActive}
                data-dimmed={isDimmed}
                onPointerEnter={() => setActiveIndex(index)}
              >
                {/* Full-slot hit target for dimension-style hover. */}
                <rect
                  className="stacked-bar-chart__hit"
                  x={column.slotX}
                  y={PADDING_TOP}
                  width={Math.max(1, column.slotWidth)}
                  height={painted.plotHeight}
                  fill="transparent"
                />
                {column.segments.map((segment) => (
                  <rect
                    key={`${column.date}-${segment.id}`}
                    className="stacked-bar-chart__segment"
                    x={segment.x}
                    y={segment.y}
                    width={segment.width}
                    height={Math.max(0.5, segment.height)}
                    rx={segment.isTop ? Math.min(TOP_RADIUS, segment.width / 2) : 0}
                    ry={segment.isTop ? Math.min(TOP_RADIUS, segment.height / 2, TOP_RADIUS) : 0}
                    fill={segment.color}
                  />
                ))}
                {index % tickEvery === 0 || index === dates.length - 1 ? (
                  <text
                    className="stacked-bar-chart__tick"
                    x={column.centerX}
                    y={HEIGHT - 10}
                    textAnchor="middle"
                  >
                    {formatDate(column.date)}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>

        {active && tooltipStyle ? (
          <div className="stacked-bar-chart__tooltip" style={tooltipStyle} role="tooltip">
            <div className="stacked-bar-chart__tooltip-date">{formatDate(active.date)}</div>
            <div className="stacked-bar-chart__tooltip-total">
              <span>{totalLabel}</span>
              <strong>{formatValue(active.total)}</strong>
            </div>
            {activeTooltipRows.length > 0 ? (
              <ul className="stacked-bar-chart__tooltip-list">
                {activeTooltipRows.map((row) => (
                  <li key={`${active.date}-${row.id}`}>
                    <span
                      className="stacked-bar-chart__tooltip-swatch"
                      style={{ background: row.color }}
                      aria-hidden="true"
                    />
                    <span className="stacked-bar-chart__tooltip-name">
                      <bdi dir="auto">{row.label}</bdi>
                    </span>
                    <span className="stacked-bar-chart__tooltip-value">{formatValue(row.value)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="stacked-bar-chart__footer">
        <p className="stacked-bar-chart__readout sr-only" aria-live="polite">
          {activeReadout}
        </p>
        <ul className="stacked-bar-chart__legend">
          {painted.colored.map((serie) => (
            <li key={serie.id}>
              <span
                className="stacked-bar-chart__swatch"
                style={{ background: serie.color }}
                aria-hidden="true"
              />
              <bdi dir="auto">{serie.label}</bdi>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
