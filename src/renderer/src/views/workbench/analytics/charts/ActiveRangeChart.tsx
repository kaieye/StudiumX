import { useMemo, useState } from 'react'
import type { AnalyticsRangePreset, FocusActiveRangeSeries } from '../types'

export type ActiveRangeChartProps = {
  series: FocusActiveRangeSeries
  /** Selected analytics window, used to keep capsule density consistent across views. */
  rangePreset: AnalyticsRangePreset
  title: string
  formatCategory: (category: string, mode: FocusActiveRangeSeries['mode']) => string
  formatY: (value: number, unit: FocusActiveRangeSeries['yUnit']) => string
  formatDuration: (seconds: number) => string
  rangeLabel: string
  emptyLabel: string
}

export type ActiveRangeYAxis = {
  min: number
  max: number
  ticks: number[]
}

/**
 * Fits the visible vertical scale to the current capsules, retaining a one-unit
 * margin and the unit's natural bounds (0–24 hours or 0–60 minutes).
 */
export function createActiveRangeYAxis(
  ranges: FocusActiveRangeSeries['ranges'],
  yMax: FocusActiveRangeSeries['yMax']
): ActiveRangeYAxis {
  const endpoints = ranges.flatMap(({ start, end }) => [start, end])
    .filter((value) => Number.isFinite(value))

  if (endpoints.length === 0) {
    return { min: 0, max: yMax, ticks: [0, yMax] }
  }

  const min = Math.max(0, Math.floor(Math.min(...endpoints)) - 1)
  const max = Math.min(yMax, Math.ceil(Math.max(...endpoints)) + 1)
  const span = Math.max(1, max - min)
  const tickCount = Math.min(5, span + 1)
  const ticks = Array.from({ length: tickCount }, (_, index) => (
    Math.round(min + (span * index) / (tickCount - 1))
  )).filter((value, index, values) => index === 0 || value !== values[index - 1])

  return { min, max, ticks }
}

/**
 * Floating range capsules (lieflat Glance "Daily active range").
 * Vertical pills: X = category, Y = [start, end] on a dynamic axis.
 */
export function ActiveRangeChart({
  series,
  rangePreset,
  title,
  formatCategory,
  formatY,
  formatDuration,
  rangeLabel,
  emptyLabel
}: ActiveRangeChartProps) {
  const [hoverId, setHoverId] = useState<string | null>(null)

  const byCategory = useMemo(() => {
    const map = new Map<string, FocusActiveRangeSeries['ranges'][number][]>()
    for (const item of series.ranges) {
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }
    return map
  }, [series.ranges])

  const totalSeconds = useMemo(
    () => series.ranges.reduce((sum, item) => sum + item.activeSeconds, 0),
    [series.ranges]
  )

  const yAxis = useMemo(
    () => createActiveRangeYAxis(series.ranges, series.yMax),
    [series.ranges, series.yMax]
  )

  const shouldShowTick = (index: number): boolean => {
    const count = series.categories.length
    if (count <= 1) return true
    if (series.mode === 'hour_of_day') {
      // Three-hour marks give the today view a more useful time scale without crowding.
      // Include the final hour explicitly because 23 is not divisible by three.
      const hour = Number(series.categories[index])
      return hour % 3 === 0 || hour === 23
    }
    // Multi-day: show evenly spaced labels; week (7) shows every day.
    if (count <= 8) return true
    const maxLabels = count <= 16 ? 8 : 6
    const step = Math.max(1, Math.ceil((count - 1) / Math.max(1, maxLabels - 1)))
    return index % step === 0 || index === count - 1
  }

  // Plot height is CSS-fluid (--active-range-height). Capsule floor uses % of axis.
  const isEmpty = totalSeconds <= 0 || series.ranges.length === 0

  // No categories at all: fall back to a plain empty label (should be rare after scaffold).
  if (series.categories.length === 0) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const hover = hoverId ? series.ranges.find((item) => item.id === hoverId) ?? null : null
  const readout = isEmpty
    ? emptyLabel
    : hover
      ? `${formatCategory(hover.category, series.mode)} · ${formatY(hover.start, series.yUnit)}–${formatY(hover.end, series.yUnit)} · ${formatDuration(hover.activeSeconds)}`
      : `${series.ranges.length} · ${formatDuration(totalSeconds)}`

  return (
    <div
      className="active-range"
      data-mode={series.mode}
      data-range-preset={rangePreset}
      role="img"
      aria-label={title}
      style={
        {
          // Only set column count here; height stays CSS-fluid so the chart
          // resizes with the analytics container / card.
          '--active-range-cols': series.categories.length
        } as React.CSSProperties
      }
    >
      <div className="active-range__plot">
        <div className="active-range__y" aria-hidden="true">
          <ol className="active-range__y-ticks">
            {[...yAxis.ticks].reverse().map((value) => (
              <li key={value} style={{ bottom: `${((value - yAxis.min) / (yAxis.max - yAxis.min)) * 100}%` }}>
                <span>{formatY(value, series.yUnit)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="active-range__body">
          <ol className="active-range__track">
            {series.categories.map((category, index) => {
              const items = byCategory.get(category) ?? []
              return (
                <li key={category} className="active-range__col">
                  <div className="active-range__lane">
                    {items.map((item) => {
                      const span = Math.max(0, item.end - item.start)
                      const rawHeightPct = (span / (yAxis.max - yAxis.min)) * 100
                      // Relative floor keeps short sessions visible without a fixed plot px.
                      const minHeightPct = series.mode === 'hour_of_day' ? 4.5 : 5.5
                      const heightPct = Math.max(rawHeightPct, minHeightPct)
                      // Prefer growing upward; clamp to the top of the plot when near yMax.
                      const bottomPct = Math.min(
                        ((item.start - yAxis.min) / (yAxis.max - yAxis.min)) * 100,
                        Math.max(0, 100 - heightPct)
                      )
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="active-range__capsule"
                          data-hover={hover?.id === item.id}
                          style={{
                            bottom: `${bottomPct}%`,
                            height: `${heightPct}%`,
                            animationDelay: `${Math.min(index, 14) * 36}ms`
                          }}
                          title={`${formatCategory(category, series.mode)} · ${formatY(item.start, series.yUnit)}–${formatY(item.end, series.yUnit)} · ${formatDuration(item.activeSeconds)}`}
                          aria-label={`${formatCategory(category, series.mode)} ${rangeLabel} ${formatY(item.start, series.yUnit)}–${formatY(item.end, series.yUnit)}`}
                          onPointerEnter={() => setHoverId(item.id)}
                          onPointerLeave={() => setHoverId((current) => (current === item.id ? null : current))}
                          onFocus={() => setHoverId(item.id)}
                          onBlur={() => setHoverId((current) => (current === item.id ? null : current))}
                        />
                      )
                    })}
                  </div>
                </li>
              )
            })}
          </ol>
          <ol className="active-range__x" aria-hidden="true">
            {series.categories.map((category, index) => {
              if (!shouldShowTick(index)) {
                return <li key={`tick-${category}`} className="active-range__x-slot" />
              }
              return (
                <li key={`tick-${category}`} className="active-range__x-slot">
                  <span className="active-range__tick">
                    {formatCategory(category, series.mode)}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>

      <div className="active-range__footer">
        <p className="active-range__readout" aria-live="polite">{readout}</p>
        <span className="active-range__meta">{rangeLabel}</span>
      </div>
    </div>
  )
}
