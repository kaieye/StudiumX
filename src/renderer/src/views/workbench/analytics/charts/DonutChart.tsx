import { useId, useMemo, useState } from 'react'
import { categoricalColor } from './palette'

export type DonutSlice = {
  id: string
  label: string
  value: number
}

export type DonutChartProps = {
  slices: readonly DonutSlice[]
  /** Accessible title describing the whole chart. */
  title: string
  /** Formats a raw value for tooltips/legend (e.g. duration or count). */
  formatValue: (value: number) => string
  /** Large centered figure; defaults to the formatted total. */
  centerValue?: string
  /** Small caption under the center figure. */
  centerLabel?: string
  emptyLabel: string
}

const SIZE = 132
const RADIUS = 58
const STROKE = 16
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Dependency-free donut. Slices are drawn as stroked arcs on a single circle via
 * `stroke-dasharray` offsets — no per-slice path math, and only `opacity`/`transform`
 * animate, so it stays compositor-friendly and interruptible.
 */
export function DonutChart({
  slices,
  title,
  formatValue,
  centerValue,
  centerLabel,
  emptyLabel
}: DonutChartProps) {
  const titleId = useId()
  const [activeId, setActiveId] = useState<string | null>(null)

  const { segments, total } = useMemo(() => {
    const positive = slices.filter((slice) => slice.value > 0)
    const sum = positive.reduce((acc, slice) => acc + slice.value, 0)
    let offset = 0
    const built = positive.map((slice, index) => {
      const fraction = sum > 0 ? slice.value / sum : 0
      const segment = {
        ...slice,
        index,
        fraction,
        dash: fraction * CIRCUMFERENCE,
        gap: CIRCUMFERENCE - fraction * CIRCUMFERENCE,
        rotation: (offset / (sum || 1)) * 360
      }
      offset += slice.value
      return segment
    })
    return { segments: built, total: sum }
  }, [slices])

  if (total <= 0) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  return (
    <div className="donut-chart">
      <svg
        className="donut-chart__svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{title}</title>
        <g transform={`translate(${SIZE / 2} ${SIZE / 2})`}>
          <circle className="donut-chart__track" r={RADIUS} cx={0} cy={0} strokeWidth={STROKE} fill="none" />
          {segments.map((segment) => (
            <circle
              key={segment.id}
              className="donut-chart__segment"
              r={RADIUS}
              cx={0}
              cy={0}
              fill="none"
              stroke={categoricalColor(segment.index)}
              strokeWidth={activeId === segment.id ? STROKE + 3 : STROKE}
              strokeDasharray={`${segment.dash} ${segment.gap}`}
              strokeDashoffset={0}
              strokeLinecap="butt"
              transform={`rotate(${segment.rotation - 90})`}
              opacity={activeId && activeId !== segment.id ? 0.4 : 1}
              onPointerEnter={() => setActiveId(segment.id)}
              onPointerLeave={() => setActiveId((current) => (current === segment.id ? null : current))}
            >
              <title>{`${segment.label}: ${formatValue(segment.value)} (${Math.round(segment.fraction * 100)}%)`}</title>
            </circle>
          ))}
        </g>
      </svg>

      <div className="donut-chart__center" aria-hidden="true">
        <strong>{centerValue ?? formatValue(total)}</strong>
        {centerLabel ? <span>{centerLabel}</span> : null}
      </div>

      <ul className="donut-chart__legend">
        {segments.map((segment) => (
          <li
            key={segment.id}
            data-active={activeId === segment.id}
            onPointerEnter={() => setActiveId(segment.id)}
            onPointerLeave={() => setActiveId((current) => (current === segment.id ? null : current))}
          >
            <span className="donut-chart__swatch" style={{ background: categoricalColor(segment.index) }} aria-hidden="true" />
            <span className="donut-chart__legend-label"><bdi dir="auto">{segment.label}</bdi></span>
            <span className="donut-chart__legend-value">{Math.round(segment.fraction * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
