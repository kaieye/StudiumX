/**
 * STC-703 read-only month grid preview for recurrence series.
 *
 * Shows occurrence days in a Mon-first month calendar. Never expands,
 * never clones Task, never writes store — pure model only.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RecurrenceRule } from '../../../../shared/study-planning'
import {
  buildRecurrenceMonthGridModel,
  monthRangeFromEpoch,
  shiftMonthRange,
  type RecurrenceMonthGridModel,
  type RecurrenceMonthRange
} from '../../study-space/planning-recurrence-month-grid'
import type { RecurrenceRuleFormDraft } from '../../study-space/planning-recurrence-expand'

export type RecurrenceMonthPreviewProps = {
  /** Preferred: live form draft (sheet edits). */
  draft?: RecurrenceRuleFormDraft | null
  /** Fallback durable rule when draft not provided. */
  rule?: RecurrenceRule | null
  /**
   * Seed month from this epoch (typically week anchor or dtStart).
   * Changing seed while open does not auto-jump if user already navigated.
   */
  seedEpochMs?: number
  /** Optional controlled month; when set, navigation is external. */
  month?: RecurrenceMonthRange | null
  onMonthChange?: (month: RecurrenceMonthRange) => void
  disabled?: boolean
  className?: string
}

export function RecurrenceMonthPreview({
  draft = null,
  rule = null,
  seedEpochMs,
  month: controlledMonth = null,
  onMonthChange,
  disabled = false,
  className
}: RecurrenceMonthPreviewProps) {
  const seedRange = useMemo(
    () => monthRangeFromEpoch(seedEpochMs ?? Date.now()),
    [seedEpochMs]
  )
  const [localMonth, setLocalMonth] = useState<RecurrenceMonthRange>(seedRange)

  // Re-seed local month when seed changes (sheet open / task change) only if uncontrolled.
  useEffect(() => {
    if (controlledMonth) return
    setLocalMonth(seedRange)
  }, [seedRange.year, seedRange.monthIndex, controlledMonth])

  const month = controlledMonth ?? localMonth

  const model: RecurrenceMonthGridModel = useMemo(
    () =>
      buildRecurrenceMonthGridModel({
        draft: draft ?? undefined,
        rule: rule ?? undefined,
        month
      }),
    [draft, rule, month.year, month.monthIndex]
  )

  const setMonth = (next: RecurrenceMonthRange): void => {
    if (controlledMonth) {
      onMonthChange?.(next)
      return
    }
    setLocalMonth(next)
    onMonthChange?.(next)
  }

  const goPrev = (): void => {
    if (disabled) return
    setMonth(shiftMonthRange(month, -1))
  }

  const goNext = (): void => {
    if (disabled) return
    setMonth(shiftMonthRange(month, 1))
  }

  return (
    <section
      className={`study-recurrence-month-preview${className ? ` ${className}` : ''}`}
      role="region"
      aria-label={model.copy.title}
      style={{
        marginTop: 4,
        padding: '10px 12px',
        borderRadius: 12,
        border: '1px solid color-mix(in srgb, var(--line) 85%, transparent)',
        background: 'color-mix(in srgb, var(--surface-solid) 42%, transparent)'
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8
        }}
      >
        <strong style={{ flex: 1, fontSize: 13 }}>{model.copy.title}</strong>
        <button
          type="button"
          className="study-schedule-secondary-button"
          onClick={goPrev}
          disabled={disabled}
          aria-label={model.copy.prevMonth}
          title={model.copy.prevMonth}
          style={{ minWidth: 32, height: 32, padding: '0 6px' }}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <span style={{ fontSize: 13, fontWeight: 650, minWidth: 88, textAlign: 'center' }}>
          {model.titleLabel}
        </span>
        <button
          type="button"
          className="study-schedule-secondary-button"
          onClick={goNext}
          disabled={disabled}
          aria-label={model.copy.nextMonth}
          title={model.copy.nextMonth}
          style={{ minWidth: 32, height: 32, padding: '0 6px' }}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </header>

      <p
        className="study-schedule-recurrence-summary"
        style={{ marginBottom: 6, fontSize: 12, fontWeight: 600 }}
      >
        {model.summaryLine}
      </p>
      <p
        className="study-recurrence-series-locked-note"
        style={{ marginBottom: 8, fontSize: 11 }}
      >
        {model.copy.readOnlyNote}
      </p>

      <div
        role="grid"
        aria-label={model.titleLabel}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 4
        }}
      >
        {model.weekdayHeaders.map((h) => (
          <div
            key={`hdr-${h}`}
            role="columnheader"
            style={{
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 650,
              color: 'var(--text-muted)',
              padding: '2px 0'
            }}
          >
            {h}
          </div>
        ))}
        {model.cells.map((cell) => {
          const active = cell.inMonth && cell.isOccurrence
          return (
            <div
              key={cell.key}
              role="gridcell"
              aria-label={
                active
                  ? `${cell.isoDate} 有重复实例`
                  : cell.inMonth
                    ? cell.isoDate
                    : `${cell.isoDate} 非本月`
              }
              aria-selected={active || undefined}
              data-iso={cell.isoDate}
              data-occurrence={active ? '1' : '0'}
              data-in-month={cell.inMonth ? '1' : '0'}
              style={{
                minHeight: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                opacity: cell.inMonth ? 1 : 0.35,
                border: active
                  ? '1px solid color-mix(in srgb, var(--accent) 45%, transparent)'
                  : '1px solid transparent',
                background: active
                  ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                  : cell.inMonth
                    ? 'color-mix(in srgb, var(--surface-solid) 55%, transparent)'
                    : 'transparent',
                color: active
                  ? 'color-mix(in srgb, var(--accent) 88%, #fff)'
                  : 'var(--text)',
                pointerEvents: 'none',
                userSelect: 'none'
              }}
            >
              {cell.dayOfMonth}
            </div>
          )
        })}
      </div>

      {model.warnings.length > 0 ? (
        <ul className="study-schedule-recurrence-warnings" style={{ marginTop: 8 }}>
          {model.warnings.slice(0, 4).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
