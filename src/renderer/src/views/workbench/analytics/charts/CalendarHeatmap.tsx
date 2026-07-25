import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { AnalyticsLocalDate } from '../types'

export type HeatmapCell = {
  date: AnalyticsLocalDate
  /** Primary intensity value (focus seconds). */
  value: number
  /** Secondary detail shown in the tooltip (completed sessions). */
  sessions: number
  tasksCompleted: number
  /** False when the date is outside known tracking coverage. */
  isCovered: boolean
}

export type CalendarHeatmapProps = {
  cells: readonly HeatmapCell[]
  localToday: AnalyticsLocalDate
  weekdayLabels: readonly [string, string, string, string, string, string, string]
  title: string
  formatDate: (date: AnalyticsLocalDate) => string
  formatMonth: (date: AnalyticsLocalDate) => string
  formatValue: (seconds: number) => string
  legendLess: string
  legendMore: string
  emptyLabel: string
  /** When true, omit the bottom legend so the parent can place it in a header. */
  hideLegend?: boolean
}

function parseLocalDate(date: AnalyticsLocalDate): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function mondayIndex(date: AnalyticsLocalDate): number {
  return (parseLocalDate(date).getUTCDay() + 6) % 7
}

/** Buckets a value into 0–4 relative to the covered maximum. */
function intensityLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio > 0.66) return 4
  if (ratio > 0.33) return 3
  if (ratio > 0.1) return 2
  return 1
}

/**
 * GitHub-style calendar heatmap. Columns are ISO weeks (Monday top).
 * Keyboard arrows move the active cell for the footer readout; mouse hover
 * does not paint a tracking highlight (native title still shows detail).
 */
export function CalendarHeatmap({
  cells,
  localToday,
  weekdayLabels,
  title,
  formatDate,
  formatMonth,
  formatValue,
  legendLess,
  legendMore,
  emptyLabel,
  hideLegend = false
}: CalendarHeatmapProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => [...cells].sort((a, b) => a.date.localeCompare(b.date)), [cells])
  const maxValue = useMemo(
    () => Math.max(0, ...sorted.filter((cell) => cell.isCovered).map((cell) => cell.value)),
    [sorted]
  )
  const leadingBlanks = sorted[0] ? mondayIndex(sorted[0].date) : 0
  const columns = Math.ceil((leadingBlanks + sorted.length) / 7)
  const [cellPx, setCellPx] = useState(12)

  useEffect(() => {
    const node = scrollRef.current
    if (!node || columns <= 0) return

    const measure = () => {
      const styles = getComputedStyle(node)
      const padLeft = Number.parseFloat(styles.paddingLeft) || 0
      const padRight = Number.parseFloat(styles.paddingRight) || 0
      // Leave room for weekday labels (22px) + body gap (4px).
      const available = Math.max(0, node.clientWidth - padLeft - padRight - 26)
      const gap = 3
      const preferredCellPx = 12
      const minCellPx = 8
      const maxCellPx = 14
      // Fit the real date range only. Keep the latest week flush right by
      // growing cells instead of inventing neutral trailing week columns.
      const rawCellPx = (available - gap * Math.max(0, columns - 1)) / columns
      const nextCellPx = Math.min(
        maxCellPx,
        Math.max(minCellPx, Math.round(rawCellPx * 100) / 100)
      )
      // Prefer the measured size, but never collapse below the preferred size
      // when the card is wide enough — horizontal scroll covers overflow.
      const preferredFit = Math.max(minCellPx, Math.min(maxCellPx, preferredCellPx))
      const resolved = available >= columns * preferredFit + gap * Math.max(0, columns - 1)
        ? Math.max(preferredFit, nextCellPx)
        : nextCellPx

      setCellPx((current) => (Math.abs(current - resolved) < 0.05 ? current : resolved))
      // Keep the latest week flush against the visible right edge.
      node.scrollLeft = Math.max(0, node.scrollWidth - node.clientWidth)
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [columns])

  const monthMarkers = useMemo(() => {
    type Marker = { key: string; label: string; column: number; span: number }
    const starts: Array<{ key: string; label: string; column: number; cellIndex: number }> = []
    let previous = ''
    sorted.forEach((cell, index) => {
      const key = cell.date.slice(0, 7)
      if (key !== previous) {
        starts.push({
          key,
          label: formatMonth(cell.date),
          column: Math.floor((leadingBlanks + index) / 7),
          cellIndex: index
        })
        previous = key
      }
    })

    return starts.map((start, index) => {
      const next = starts[index + 1]
      const endExclusive = next
        ? Math.floor((leadingBlanks + next.cellIndex) / 7)
        : columns
      return {
        key: start.key,
        label: start.label,
        column: start.column,
        // Span every week owned by this month so short labels are not clipped
        // by a single narrow week track (e.g. months that start mid-week).
        span: Math.max(1, endExclusive - start.column)
      } satisfies Marker
    })
  }, [sorted, leadingBlanks, columns, formatMonth])

  const initialIndex = useMemo(() => {
    const exact = sorted.findIndex((cell) => cell.date === localToday)
    if (exact >= 0) return exact
    return Math.max(0, sorted.length - 1)
  }, [sorted, localToday])
  const [activeIndex, setActiveIndex] = useState(initialIndex)

  if (sorted.length === 0) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const move = (next: number) => {
    setActiveIndex(Math.max(0, Math.min(sorted.length - 1, next)))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
      ArrowDown: 1,
      PageUp: -28,
      PageDown: 28
    }
    const offset = moves[event.key]
    if (offset !== undefined) {
      event.preventDefault()
      move(activeIndex + offset)
    } else if (event.key === 'Home') {
      event.preventDefault()
      move(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      move(sorted.length - 1)
    }
  }

  return (
    <div className="calendar-heatmap">
      <div className="calendar-heatmap__scroll" ref={scrollRef}>
        <div
          className="calendar-heatmap__inner"
          style={
            {
              '--heatmap-columns': columns,
              '--heatmap-cell': `${cellPx}px`
            } as React.CSSProperties
          }
        >
          <div className="calendar-heatmap__months" aria-hidden="true">
            {monthMarkers.map((marker) => (
              <span
                key={marker.key}
                style={{
                  gridColumnStart: marker.column + 1,
                  gridColumnEnd: `span ${marker.span}`
                }}
              >
                {marker.label}
              </span>
            ))}
          </div>

          <div className="calendar-heatmap__body">
            <div className="calendar-heatmap__weekdays" aria-hidden="true">
              {weekdayLabels.map((label, index) => (
                <span key={index} data-visible={index % 2 === 1}>{label}</span>
              ))}
            </div>

            <div
              ref={gridRef}
              className="calendar-heatmap__grid"
              role="img"
              aria-label={title}
              tabIndex={0}
              onKeyDown={handleKeyDown}
            >
              {Array.from({ length: leadingBlanks }, (_, index) => (
                <span key={`blank-${index}`} className="calendar-heatmap__cell is-blank" aria-hidden="true" />
              ))}
              {sorted.map((cell, index) => {
                const future = cell.date > localToday
                const level = cell.isCovered && !future ? intensityLevel(cell.value, maxValue) : 0
                return (
                  <span
                    key={cell.date}
                    className="calendar-heatmap__cell"
                    aria-hidden="true"
                    data-level={level}
                    data-uncovered={!cell.isCovered || future}
                    data-today={cell.date === localToday}
                    data-active={index === activeIndex}
                    title={
                      future
                        ? formatDate(cell.date)
                        : cell.isCovered
                          ? `${formatDate(cell.date)} · ${formatValue(cell.value)} · ${cell.sessions}`
                          : formatDate(cell.date)
                    }
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {hideLegend ? null : (
        <div className="calendar-heatmap__footer">
          <div className="calendar-heatmap__legend" aria-hidden="true">
            <span>{legendLess}</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className="calendar-heatmap__cell is-legend" data-level={level} />
            ))}
            <span>{legendMore}</span>
          </div>
        </div>
      )}
    </div>
  )
}
