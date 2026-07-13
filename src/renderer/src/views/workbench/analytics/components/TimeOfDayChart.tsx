import type { CSSProperties } from 'react'
import type { AnalyticsDataState } from '../types'
import { CoreSectionState, type CoreStateLabels } from './CoreAnalyticsState'
import '../core-analytics.css'

export type CoreHourBucket = {
  hour: number
  seconds: number
  coverage: 'covered' | 'uncovered'
  completeness?: 'complete' | 'partial'
}

export type CoreBestTimeRange = {
  startHour: number
  endHour: number
  label: string
}

export type TimeOfDayLabels = CoreStateLabels & {
  distribution: string
  missing: string
  zero: string
  partialHour: string
  bestPeriod: string
  bestUnavailable: string
  crossMidnightOwnership: string
  coverageNote: string
}

export type TimeOfDayFormatters = {
  hour: (hour: number) => string
  duration: (seconds: number) => string
}

export type TimeOfDayChartProps = {
  state: AnalyticsDataState
  buckets: readonly CoreHourBucket[]
  bestRange?: CoreBestTimeRange | null
  labels: TimeOfDayLabels
  formatters: TimeOfDayFormatters
  warnings?: readonly string[]
  className?: string
}

export function TimeOfDayChart({
  state,
  buckets,
  bestRange = null,
  labels,
  formatters,
  warnings,
  className = ''
}: TimeOfDayChartProps) {
  const maxSeconds = Math.max(1, ...buckets.filter((bucket) => bucket.coverage === 'covered').map((bucket) => bucket.seconds))
  const completeCoverage = state === 'available' && buckets.length === 24 && buckets.every(
    (bucket) => bucket.coverage === 'covered' && bucket.completeness !== 'partial'
  )
  const visibleBest = completeCoverage ? bestRange : null

  return (
    <section className={`core-analytics-card time-of-day ${className}`.trim()} data-state={state}>
      <CoreSectionState state={state} labels={labels} warnings={warnings}>
        <div className="time-of-day__meta">
          <div className="time-of-day__best" data-available={Boolean(visibleBest)}>
            <span>{labels.bestPeriod}</span>
            <strong>{visibleBest?.label ?? labels.bestUnavailable}</strong>
          </div>
          {!completeCoverage ? <span className="core-analytics-status-chip">{labels.coverageNote}</span> : null}
        </div>
        <ol className="time-of-day__bars" aria-label={labels.distribution}>
          {buckets.map((bucket) => {
            const status = bucket.coverage === 'uncovered'
              ? labels.missing
              : bucket.completeness === 'partial'
                ? labels.partialHour
                : bucket.seconds === 0
                  ? labels.zero
                  : formatters.duration(bucket.seconds)
            return (
              <li
                key={bucket.hour}
                className={`time-of-day__bucket${bucket.coverage === 'uncovered' ? ' is-missing' : ''}${bucket.completeness === 'partial' ? ' is-partial' : ''}`}
                aria-label={`${formatters.hour(bucket.hour)}: ${status}`}
              >
                <span className="time-of-day__value">{status}</span>
                <span className="time-of-day__track" aria-hidden="true">
                  <span
                    className="time-of-day__fill"
                    style={{ '--hour-ratio': bucket.coverage === 'covered' ? bucket.seconds / maxSeconds : 0 } as CSSProperties}
                  />
                  {bucket.coverage === 'uncovered' ? <i>?</i> : bucket.completeness === 'partial' ? <i>◐</i> : null}
                </span>
                <span className="time-of-day__hour">{formatters.hour(bucket.hour)}</span>
              </li>
            )
          })}
        </ol>
        <p className="core-analytics-note">{labels.crossMidnightOwnership}</p>
      </CoreSectionState>
    </section>
  )
}
