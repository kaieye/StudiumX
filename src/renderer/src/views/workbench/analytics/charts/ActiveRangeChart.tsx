import { useMemo, useState } from 'react'
import type { FocusActiveRangeSeries } from '../types'

export type ActiveRangeChartProps = {
  series: FocusActiveRangeSeries
  title: string
  formatCategory: (category: string, mode: FocusActiveRangeSeries['mode']) => string
  formatY: (value: number, unit: FocusActiveRangeSeries['yUnit']) => string
  formatDuration: (seconds: number) => string
  rangeLabel: string
  emptyLabel: string
}

/**
 * Floating range capsules (lieflat Glance "Daily active range").
 * Vertical pills: X = category, Y = [start, end] on a fixed axis.
 */
export function ActiveRangeChart({
  series,
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

  const tickValues = useMemo(() => {
    if (series.yUnit === 'minute') return [0, 15, 30, 45, 60]
    return [0, 6, 12, 18, 24]
  }, [series.yUnit])

  const shouldShowTick = (index: number): boolean => {
    const count = series.categories.length
    if (count <= 1) return true
    if (series.mode === 'hour_of_day') {
      // Even 0 / 6 / 12 / 18 / 23 so the final hour is included without crowding.
      const hour = Number(series.categories[index])
      return hour === 0 || hour === 6 || hour === 12 || hour === 18 || hour === 23
    }
    // Multi-day: show evenly spaced labels; week (7) shows every day.
    if (count <= 8) return true
    const maxLabels = count <= 16 ? 8 : 6
    const step = Math.max(1, Math.ceil((count - 1) / Math.max(1, maxLabels - 1)))
    return index % step === 0 || index === count - 1
  }

  // Compact plot: card is half page width; keep multi-day a bit taller for vertical pills.
  const plotHeight = series.mode === 'hour_of_day' ? 132 : 156
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
      role="img"
      aria-label={title}
      style={{ '--active-range-height': `${plotHeight}px`, '--active-range-cols': series.categories.length } as React.CSSProperties}
    >
      <div className="active-range__plot">
        <div className="active-range__y" aria-hidden="true">
          <ol className="active-range__y-ticks">
            {[...tickValues].reverse().map((value) => (
              <li key={value} style={{ bottom: `${(value / series.yMax) * 100}%` }}>
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
                      const rawHeightPct = (span / series.yMax) * 100
                      // Pixel floor keeps short sessions as vertical pills on a 0–24h axis
                      // (where 25 minutes is only ~1.7% of plot height and would read as a dash).
                      const minHeightPx = series.mode === 'hour_of_day' ? 10 : 14
                      const minHeightPct = (minHeightPx / plotHeight) * 100
                      const heightPct = Math.max(rawHeightPct, minHeightPct)
                      // Prefer growing upward; clamp to the top of the plot when near yMax.
                      const bottomPct = Math.min(
                        (item.start / series.yMax) * 100,
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
