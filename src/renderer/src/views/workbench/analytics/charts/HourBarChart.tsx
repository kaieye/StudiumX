import { useMemo, useState } from 'react'
import type { AnalyticsHourBuckets } from '../types'

export type HourBarChartProps = {
  buckets: AnalyticsHourBuckets
  title: string
  formatHour: (hour: number) => string
  formatValue: (seconds: number) => string
  peakLabel: string
  peakNoneLabel: string
  emptyLabel: string
}

/**
 * 24-hour focus distribution as a vertical bar column. Heights animate only via
 * `transform: scaleY`, and the active hour is reported through an aria-live line.
 */
export function HourBarChart({
  buckets,
  title,
  formatHour,
  formatValue,
  peakLabel,
  peakNoneLabel,
  emptyLabel
}: HourBarChartProps) {
  const [activeHour, setActiveHour] = useState<number | null>(null)

  const { max, total, peakHour } = useMemo(() => {
    let maxSeconds = 0
    let sum = 0
    let peak = -1
    buckets.forEach((seconds, hour) => {
      sum += seconds
      if (seconds > maxSeconds) {
        maxSeconds = seconds
        peak = hour
      }
    })
    return { max: maxSeconds, total: sum, peakHour: peak }
  }, [buckets])

  if (total <= 0) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const active = activeHour !== null ? activeHour : peakHour
  const activeReadout = active >= 0
    ? `${formatHour(active)} · ${formatValue(buckets[active] ?? 0)}`
    : ''

  return (
    <div className="hour-bars" role="img" aria-label={title}>
      <ol className="hour-bars__track">
        {buckets.map((seconds, hour) => {
          const ratio = max > 0 ? seconds / max : 0
          return (
            <li
              key={hour}
              className="hour-bars__col"
              data-peak={hour === peakHour}
              data-active={hour === active}
              title={`${formatHour(hour)}: ${formatValue(seconds)}`}
              onPointerEnter={() => setActiveHour(hour)}
              onPointerLeave={() => setActiveHour((current) => (current === hour ? null : current))}
            >
              <span className="hour-bars__bar" style={{ '--hour-ratio': ratio } as React.CSSProperties} />
              {hour % 6 === 0 ? <span className="hour-bars__tick">{formatHour(hour)}</span> : null}
            </li>
          )
        })}
      </ol>
      <div className="hour-bars__footer">
        <p className="hour-bars__readout" aria-live="polite">{activeReadout}</p>
        <span className="hour-bars__peak">
          {peakHour >= 0 ? `${peakLabel} ${formatHour(peakHour)}` : peakNoneLabel}
        </span>
      </div>
    </div>
  )
}
