import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  AnalyticsDataState,
  AnalyticsLocalDate,
  FocusHeatmapCellViewModel
} from '../types'
import { CoreDataTable, CoreSectionState, type CoreStateLabels } from './CoreAnalyticsState'
import '../core-analytics.css'

export type CoreFocusHeatmapCell = FocusHeatmapCellViewModel & {
  completeness?: 'complete' | 'partial'
}

export type FocusHeatmapLabels = CoreStateLabels & {
  grid: string
  instructions: string
  chartView: string
  tableView: string
  dataStart: (dateLabel: string) => string
  today: string
  selected: string
  future: string
  missing: string
  zero: string
  partialCell: string
  covered: string
  drilldownTitle: (dateLabel: string) => string
  closeDrilldown: string
  dateColumn: string
  focusColumn: string
  sessionsColumn: string
  tasksColumn: string
  statusColumn: string
  tableCaption: string
}

export type FocusHeatmapFormatters = {
  date: (date: AnalyticsLocalDate) => string
  month: (date: AnalyticsLocalDate) => string
  duration: (seconds: number) => string
  number: (value: number) => string
}

export type FocusHeatmapProps = {
  state: AnalyticsDataState
  cells: readonly CoreFocusHeatmapCell[]
  localToday: AnalyticsLocalDate
  selectedDate?: AnalyticsLocalDate | null
  dataStartDate?: AnalyticsLocalDate | null
  weekdayLabels: readonly [string, string, string, string, string, string, string]
  labels: FocusHeatmapLabels
  formatters: FocusHeatmapFormatters
  warnings?: readonly string[]
  className?: string
  onSelectedDateChange?: (date: AnalyticsLocalDate) => void
  onDrilldown?: (cell: CoreFocusHeatmapCell) => void
  renderDrilldown?: (cell: CoreFocusHeatmapCell) => ReactNode
}

function parseLocalDate(date: AnalyticsLocalDate): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function mondayIndex(date: AnalyticsLocalDate): number {
  return (parseLocalDate(date).getUTCDay() + 6) % 7
}

function monthKey(date: AnalyticsLocalDate): string {
  return date.slice(0, 7)
}

function stateTokens(
  cell: CoreFocusHeatmapCell,
  localToday: AnalyticsLocalDate,
  isSelected: boolean,
  labels: FocusHeatmapLabels
): string[] {
  const tokens: string[] = []
  if (cell.date === localToday) tokens.push(labels.today)
  if (isSelected) tokens.push(labels.selected)
  if (cell.date > localToday) tokens.push(labels.future)
  else if (cell.coverage === 'uncovered') tokens.push(labels.missing)
  else if (cell.completeness === 'partial') tokens.push(labels.partialCell)
  else if (cell.focusSeconds === 0) tokens.push(labels.zero)
  else tokens.push(labels.covered)
  return tokens
}

export function FocusHeatmap({
  state,
  cells,
  localToday,
  selectedDate = null,
  dataStartDate = null,
  weekdayLabels,
  labels,
  formatters,
  warnings,
  className = '',
  onSelectedDateChange,
  onDrilldown,
  renderDrilldown
}: FocusHeatmapProps) {
  const baseId = useId()
  const gridRef = useRef<HTMLDivElement>(null)
  const sortedCells = useMemo(() => [...cells].sort((a, b) => a.date.localeCompare(b.date)), [cells])
  const initialIndex = useMemo(() => {
    const preferred = selectedDate ?? localToday
    const exact = sortedCells.findIndex((cell) => cell.date === preferred)
    if (exact >= 0) return exact
    let lastUsable = -1
    sortedCells.forEach((cell, index) => {
      if (cell.date <= localToday) lastUsable = index
    })
    return Math.max(0, lastUsable)
  }, [localToday, selectedDate, sortedCells])
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [drilldownIndex, setDrilldownIndex] = useState<number | null>(null)

  useEffect(() => {
    setActiveIndex(initialIndex)
  }, [initialIndex])

  const activeCell = sortedCells[activeIndex] ?? null
  const leadingDays = sortedCells[0] ? mondayIndex(sortedCells[0].date) : 0
  const monthMarkers = useMemo(() => {
    const markers: Array<{ key: string; date: AnalyticsLocalDate; week: number }> = []
    let previous = ''
    sortedCells.forEach((cell, index) => {
      const key = monthKey(cell.date)
      if (key !== previous) {
        markers.push({ key, date: cell.date, week: Math.floor((leadingDays + index) / 7) + 1 })
        previous = key
      }
    })
    return markers
  }, [leadingDays, sortedCells])

  const setActive = (index: number) => {
    if (sortedCells.length === 0) return
    const next = Math.max(0, Math.min(sortedCells.length - 1, index))
    setActiveIndex(next)
    onSelectedDateChange?.(sortedCells[next].date)
  }

  const openDrilldown = () => {
    const cell = sortedCells[activeIndex]
    if (!cell || cell.date > localToday) return
    setDrilldownIndex(activeIndex)
    onDrilldown?.(cell)
  }

  const closeDrilldown = () => {
    setDrilldownIndex(null)
    gridRef.current?.focus()
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keyMoves: Partial<Record<string, number>> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      PageUp: -28,
      PageDown: 28
    }
    const offset = keyMoves[event.key]
    if (offset !== undefined) {
      event.preventDefault()
      setActive(activeIndex + offset)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setActive(sortedCells.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openDrilldown()
    }
  }

  const activeStatus = activeCell
    ? stateTokens(activeCell, localToday, true, labels).join(', ')
    : ''
  const drilldownCell = drilldownIndex === null ? null : sortedCells[drilldownIndex]

  return (
    <section className={`core-analytics-card focus-heatmap ${className}`.trim()} data-state={state}>
      <CoreSectionState state={state} labels={labels} warnings={warnings}>
        <div className="core-analytics-view-switch" role="group" aria-label={labels.grid}>
          <button
            type="button"
            className={view === 'chart' ? 'is-active' : ''}
            aria-pressed={view === 'chart'}
            onClick={() => setView('chart')}
          >
            {labels.chartView}
          </button>
          <button
            type="button"
            className={view === 'table' ? 'is-active' : ''}
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
          >
            {labels.tableView}
          </button>
        </div>

        {dataStartDate ? (
          <p className="core-analytics-note">{labels.dataStart(formatters.date(dataStartDate))}</p>
        ) : null}

        {view === 'chart' ? (
          <div className="focus-heatmap__viewport">
            <p id={`${baseId}-instructions`} className="sr-only">{labels.instructions}</p>
            <div className="focus-heatmap__layout">
              <div className="focus-heatmap__months" aria-hidden="true">
                {monthMarkers.map((marker) => (
                  <span
                    key={marker.key}
                    style={{ '--heatmap-week': marker.week } as CSSProperties}
                  >
                    {formatters.month(marker.date)}
                  </span>
                ))}
              </div>
              <div className="focus-heatmap__weekdays" aria-hidden="true">
                {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
              <div
                ref={gridRef}
                className="focus-heatmap__grid"
                role="grid"
                tabIndex={0}
                aria-label={labels.grid}
                aria-describedby={`${baseId}-instructions ${baseId}-active-detail`}
                aria-activedescendant={activeCell ? `${baseId}-cell-${activeIndex}` : undefined}
                onKeyDown={handleGridKeyDown}
                style={{ '--heatmap-leading-days': leadingDays } as CSSProperties}
              >
                {sortedCells.map((cell, index) => {
                  const selected = index === activeIndex
                  const tokens = stateTokens(cell, localToday, selected, labels)
                  const statusClass = cell.date > localToday
                    ? 'future'
                    : cell.coverage === 'uncovered'
                      ? 'missing'
                      : cell.completeness === 'partial'
                        ? 'partial'
                        : cell.focusSeconds === 0
                          ? 'zero'
                          : 'covered'
                  return (
                    <div
                      id={`${baseId}-cell-${index}`}
                      key={cell.date}
                      role="gridcell"
                      className={`focus-heatmap__cell focus-heatmap__cell--${statusClass}${selected ? ' is-selected' : ''}`}
                      aria-label={`${formatters.date(cell.date)}: ${cell.tooltip}; ${tokens.join(', ')}`}
                      aria-selected={selected}
                      aria-current={cell.date === localToday ? 'date' : undefined}
                      aria-disabled={cell.date > localToday || undefined}
                      data-intensity={cell.intensity}
                      data-date={cell.date}
                      onClick={() => {
                        setActive(index)
                        if (cell.date <= localToday) {
                          setDrilldownIndex(index)
                          onDrilldown?.(cell)
                        }
                      }}
                      onPointerEnter={() => setActive(index)}
                    >
                      <span className="focus-heatmap__cell-symbol" aria-hidden="true">
                        {statusClass === 'missing' ? '?' : statusClass === 'partial' ? '◐' : statusClass === 'future' ? '·' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            {activeCell ? (
              <div id={`${baseId}-active-detail`} className="focus-heatmap__active-detail" role="status" aria-live="polite">
                <strong>{formatters.date(activeCell.date)}</strong>
                <span>{activeCell.tooltip}</span>
                <span className="core-analytics-status-chip">{activeStatus}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <CoreDataTable
            caption={labels.tableCaption}
            rows={sortedCells}
            getRowKey={(cell) => cell.date}
            columns={[
              { key: 'date', label: labels.dateColumn, render: (cell) => formatters.date(cell.date) },
              {
                key: 'focus',
                label: labels.focusColumn,
                render: (cell) => cell.coverage === 'uncovered' || cell.date > localToday
                  ? labels.missing
                  : formatters.duration(cell.focusSeconds)
              },
              {
                key: 'sessions',
                label: labels.sessionsColumn,
                render: (cell) => cell.coverage === 'uncovered' || cell.date > localToday
                  ? labels.missing
                  : formatters.number(cell.completedFocusSessions)
              },
              {
                key: 'tasks',
                label: labels.tasksColumn,
                render: (cell) => cell.coverage === 'uncovered' || cell.date > localToday
                  ? labels.missing
                  : formatters.number(cell.tasksCompleted)
              },
              {
                key: 'status',
                label: labels.statusColumn,
                render: (cell) => stateTokens(cell, localToday, cell.date === activeCell?.date, labels).join(', ')
              }
            ]}
          />
        )}

        {drilldownCell ? (
          <div
            className="core-analytics-dialog-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDrilldown()
            }}
          >
            <div
              className="core-analytics-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${baseId}-dialog-title`}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeDrilldown()
                }
              }}
            >
              <div className="core-analytics-dialog__header">
                <h3 id={`${baseId}-dialog-title`}>{labels.drilldownTitle(formatters.date(drilldownCell.date))}</h3>
                <button type="button" autoFocus onClick={closeDrilldown} aria-label={labels.closeDrilldown}>×</button>
              </div>
              {renderDrilldown ? renderDrilldown(drilldownCell) : (
                <dl className="core-analytics-definition-grid">
                  <div><dt>{labels.focusColumn}</dt><dd>{formatters.duration(drilldownCell.focusSeconds)}</dd></div>
                  <div><dt>{labels.sessionsColumn}</dt><dd>{formatters.number(drilldownCell.completedFocusSessions)}</dd></div>
                  <div><dt>{labels.tasksColumn}</dt><dd>{formatters.number(drilldownCell.tasksCompleted)}</dd></div>
                  <div><dt>{labels.statusColumn}</dt><dd>{stateTokens(drilldownCell, localToday, true, labels).join(', ')}</dd></div>
                </dl>
              )}
            </div>
          </div>
        ) : null}
      </CoreSectionState>
    </section>
  )
}
