import { useId, useMemo, useState } from 'react'
import type { AnalyticsDataState, AnalyticsLocalDate, AnalyticsTimePoint } from '../types'
import { CoreDataTable, CoreSectionState, type CoreStateLabels } from './CoreAnalyticsState'
import '../core-analytics.css'

export type CoreTrendPoint = AnalyticsTimePoint & {
  coverage: 'covered' | 'uncovered'
  completeness?: 'complete' | 'partial'
}

export type CoreRunningFocusOverlay = {
  date: AnalyticsLocalDate
  additionalSeconds: number
  label: string
}

export type FocusTrendLabels = CoreStateLabels & {
  chart: string
  dailyGrain: string
  weeklyGrain: string
  target: string
  running: string
  missing: string
  zero: string
  partialPoint: string
  showTable: string
  hideTable: string
  tableCaption: string
  dateColumn: string
  focusColumn: string
  sessionsColumn: string
  statusColumn: string
}

export type FocusTrendFormatters = {
  date: (date: AnalyticsLocalDate, grain: 'day' | 'week') => string
  duration: (seconds: number) => string
  number: (value: number) => string
}

export type FocusTrendChartProps = {
  state: AnalyticsDataState
  points: readonly CoreTrendPoint[]
  grain: 'day' | 'week'
  targetSeconds?: number | null
  runningOverlay?: CoreRunningFocusOverlay | null
  summary: string
  labels: FocusTrendLabels
  formatters: FocusTrendFormatters
  warnings?: readonly string[]
  className?: string
}

type PlotPoint = CoreTrendPoint & { x: number; y: number }

function pathSegments(points: readonly PlotPoint[]): string[] {
  const segments: string[] = []
  let current = ''
  for (const point of points) {
    if (point.coverage === 'uncovered') {
      if (current) segments.push(current)
      current = ''
      continue
    }
    current += `${current ? ' L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  }
  if (current) segments.push(current)
  return segments
}

export function FocusTrendChart({
  state,
  points,
  grain,
  targetSeconds = null,
  runningOverlay = null,
  summary,
  labels,
  formatters,
  warnings,
  className = ''
}: FocusTrendChartProps) {
  const id = useId()
  const [showTable, setShowTable] = useState(false)
  const width = 720
  const height = 260
  const inset = { top: 22, right: 20, bottom: 36, left: 46 }
  const plotWidth = width - inset.left - inset.right
  const plotHeight = height - inset.top - inset.bottom

  const plotted = useMemo(() => {
    const values = points
      .filter((point) => point.coverage === 'covered')
      .map((point) => point.focusSeconds)
    if (targetSeconds !== null) values.push(targetSeconds)
    if (runningOverlay) {
      const point = points.find((candidate) => candidate.date === runningOverlay.date)
      if (point?.coverage === 'covered') values.push(point.focusSeconds + runningOverlay.additionalSeconds)
    }
    const max = Math.max(1, ...values)
    return points.map((point, index): PlotPoint => ({
      ...point,
      x: inset.left + (points.length <= 1 ? plotWidth / 2 : index * plotWidth / (points.length - 1)),
      y: inset.top + plotHeight - (point.focusSeconds / max) * plotHeight
    }))
  }, [plotHeight, plotWidth, points, runningOverlay, targetSeconds])

  const maxValue = useMemo(() => {
    const values = plotted.filter((point) => point.coverage === 'covered').map((point) => point.focusSeconds)
    if (targetSeconds !== null) values.push(targetSeconds)
    if (runningOverlay) {
      const point = plotted.find((candidate) => candidate.date === runningOverlay.date)
      if (point?.coverage === 'covered') values.push(point.focusSeconds + runningOverlay.additionalSeconds)
    }
    return Math.max(1, ...values)
  }, [plotted, runningOverlay, targetSeconds])
  const targetY = targetSeconds === null
    ? null
    : inset.top + plotHeight - (targetSeconds / maxValue) * plotHeight
  const runningBase = runningOverlay
    ? plotted.find((point) => point.date === runningOverlay.date && point.coverage === 'covered')
    : null
  const runningY = runningBase && runningOverlay
    ? inset.top + plotHeight - ((runningBase.focusSeconds + runningOverlay.additionalSeconds) / maxValue) * plotHeight
    : null

  return (
    <section className={`core-analytics-card focus-trend ${className}`.trim()} data-state={state}>
      <CoreSectionState state={state} labels={labels} warnings={warnings}>
        <figure className="focus-trend__figure" aria-labelledby={`${id}-summary`}>
          <div className="focus-trend__legend" aria-hidden="true">
            <span><i className="focus-trend__legend-line" />{grain === 'day' ? labels.dailyGrain : labels.weeklyGrain}</span>
            {targetSeconds !== null ? <span><i className="focus-trend__legend-target" />{labels.target}</span> : null}
            {runningOverlay ? <span><i className="focus-trend__legend-running" />{labels.running}</span> : null}
          </div>
          <div className="focus-trend__svg-wrap">
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true" focusable="false">
              <g className="focus-trend__grid-lines">
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y = inset.top + ratio * plotHeight
                  return <line key={ratio} x1={inset.left} x2={width - inset.right} y1={y} y2={y} />
                })}
              </g>
              <line className="focus-trend__axis" x1={inset.left} x2={width - inset.right} y1={height - inset.bottom} y2={height - inset.bottom} />
              {targetY !== null ? (
                <line className="focus-trend__target" x1={inset.left} x2={width - inset.right} y1={targetY} y2={targetY} />
              ) : null}
              {pathSegments(plotted).map((path, index) => (
                <path key={index} className="focus-trend__line" d={path} />
              ))}
              {plotted.map((point) => {
                if (point.coverage === 'uncovered') {
                  return (
                    <g key={point.date} className="focus-trend__missing">
                      <line x1={point.x - 4} x2={point.x + 4} y1={height - inset.bottom - 4} y2={height - inset.bottom + 4} />
                      <line x1={point.x + 4} x2={point.x - 4} y1={height - inset.bottom - 4} y2={height - inset.bottom + 4} />
                    </g>
                  )
                }
                return (
                  <g key={point.date} className={point.completeness === 'partial' ? 'focus-trend__point is-partial' : 'focus-trend__point'}>
                    <circle cx={point.x} cy={point.y} r={point.focusSeconds === 0 ? 5 : 4} />
                    {point.focusSeconds === 0 ? <line x1={point.x - 3} x2={point.x + 3} y1={point.y} y2={point.y} /> : null}
                  </g>
                )
              })}
              {runningBase && runningY !== null ? (
                <g className="focus-trend__running-overlay">
                  <line x1={runningBase.x} x2={runningBase.x} y1={runningBase.y} y2={runningY} />
                  <circle cx={runningBase.x} cy={runningY} r="7" />
                </g>
              ) : null}
            </svg>
          </div>
          <figcaption id={`${id}-summary`} className="core-analytics-summary">{summary}</figcaption>
          {runningOverlay ? (
            <p className="core-analytics-note">
              <strong>{runningOverlay.label}</strong>{' '}
              {formatters.duration(runningOverlay.additionalSeconds)}
            </p>
          ) : null}
        </figure>
        <button
          type="button"
          className="core-analytics-table-toggle"
          aria-expanded={showTable}
          aria-controls={`${id}-table`}
          onClick={() => setShowTable((current) => !current)}
        >
          {showTable ? labels.hideTable : labels.showTable}
        </button>
        {showTable ? (
          <div id={`${id}-table`}>
            <CoreDataTable
              caption={labels.tableCaption}
              rows={points}
              getRowKey={(point) => point.date}
              columns={[
                { key: 'date', label: labels.dateColumn, render: (point) => formatters.date(point.date, grain) },
                {
                  key: 'focus',
                  label: labels.focusColumn,
                  render: (point) => point.coverage === 'uncovered' ? labels.missing : formatters.duration(point.focusSeconds)
                },
                {
                  key: 'sessions',
                  label: labels.sessionsColumn,
                  render: (point) => point.coverage === 'uncovered' ? labels.missing : formatters.number(point.completedFocusSessions)
                },
                {
                  key: 'status',
                  label: labels.statusColumn,
                  render: (point) => point.coverage === 'uncovered'
                    ? labels.missing
                    : point.completeness === 'partial'
                      ? labels.partialPoint
                      : point.focusSeconds === 0
                        ? labels.zero
                        : grain === 'day' ? labels.dailyGrain : labels.weeklyGrain
                }
              ]}
            />
          </div>
        ) : null}
      </CoreSectionState>
    </section>
  )
}
