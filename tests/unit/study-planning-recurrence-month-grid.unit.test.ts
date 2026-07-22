/**
 * STC-703 pure month-grid model for recurrence occurrence dates.
 * Respects until/count; fail-closed on invalid rule; no auto-expand / no task clone.
 */
import { describe, expect, it } from 'vitest'
import type { RecurrenceRule } from '../../src/shared/study-planning'
import type { RecurrenceRuleFormDraft } from '../../src/renderer/src/study-space/planning-recurrence-expand'
import {
  buildRecurrenceMonthGridModel,
  formatMonthTitle,
  monthRangeFromEpoch,
  monthWindowMs,
  shiftMonthRange,
  RECURRENCE_MONTH_WEEKDAY_HEADERS
} from '../../src/renderer/src/study-space/planning-recurrence-month-grid'

/** Monday 2026-07-20 local — use local Date so month grid (local) is stable. */
const LOCAL_MON = new Date(2026, 6, 20, 0, 0, 0, 0).getTime()
const DAY = 24 * 60 * 60_000

function dailyRule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    id: 'recurrence:task-read',
    taskId: 'task-read',
    kind: 'focus',
    frequency: 'daily',
    dtStartMs: LOCAL_MON,
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    expandAsLocked: true,
    ...overrides
  }
}

function weeklyRule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    id: 'recurrence:task-read',
    taskId: 'task-read',
    kind: 'focus',
    frequency: 'weekly',
    byWeekday: [1, 3, 5], // Mon Wed Fri
    dtStartMs: LOCAL_MON,
    startMinutes: 14 * 60,
    endMinutes: 15 * 60,
    expandAsLocked: true,
    ...overrides
  }
}

function dailyDraft(overrides: Partial<RecurrenceRuleFormDraft> = {}): RecurrenceRuleFormDraft {
  return {
    taskId: 'task-read',
    frequency: 'daily',
    byWeekday: [],
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    dtStartMs: LOCAL_MON,
    expandAsLocked: true,
    ...overrides
  }
}

describe('monthRange helpers', () => {
  it('monthRangeFromEpoch uses local year/month', () => {
    expect(monthRangeFromEpoch(LOCAL_MON)).toEqual({ year: 2026, monthIndex: 6 })
  })

  it('monthWindowMs is exclusive end of next local month', () => {
    const w = monthWindowMs({ year: 2026, monthIndex: 6 })
    expect(w.windowStartMs).toBe(new Date(2026, 6, 1).getTime())
    expect(w.windowEndMs).toBe(new Date(2026, 7, 1).getTime())
    expect(w.windowEndMs).toBeGreaterThan(w.windowStartMs)
  })

  it('shiftMonthRange crosses year boundaries', () => {
    expect(shiftMonthRange({ year: 2026, monthIndex: 11 }, 1)).toEqual({
      year: 2027,
      monthIndex: 0
    })
    expect(shiftMonthRange({ year: 2026, monthIndex: 0 }, -1)).toEqual({
      year: 2025,
      monthIndex: 11
    })
  })

  it('formatMonthTitle is zh year-month', () => {
    expect(formatMonthTitle({ year: 2026, monthIndex: 6 })).toBe('2026年7月')
  })
})

describe('buildRecurrenceMonthGridModel', () => {
  it('lists 42 Mon-first cells and marks daily occurrences in-month', () => {
    const model = buildRecurrenceMonthGridModel({
      rule: dailyRule(),
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(true)
    expect(model.cells).toHaveLength(42)
    expect(model.weekdayHeaders).toEqual([...RECURRENCE_MONTH_WEEKDAY_HEADERS])
    expect(model.titleLabel).toBe('2026年7月')
    // From Jul 20 through Jul 31 inclusive = 12 days
    expect(model.occurrenceCount).toBe(12)
    expect(model.occurrenceIsoDates).toHaveLength(12)
    expect(model.occurrenceIsoDates[0]).toBe('2026-07-20')
    expect(model.occurrenceIsoDates[model.occurrenceIsoDates.length - 1]).toBe('2026-07-31')

    const occCells = model.cells.filter((c) => c.isOccurrence)
    expect(occCells).toHaveLength(12)
    expect(occCells.every((c) => c.inMonth)).toBe(true)
    expect(model.copy.readOnlyNote).toMatch(/只读|不会自动展开|不会克隆/)
  })

  it('weekly byWeekday only marks matching weekdays', () => {
    const model = buildRecurrenceMonthGridModel({
      rule: weeklyRule(),
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(true)
    // Jul 20 Mon, 22 Wed, 24 Fri, 27 Mon, 29 Wed, 31 Fri = 6
    expect(model.occurrenceCount).toBe(6)
    expect(model.occurrenceIsoDates).toEqual([
      '2026-07-20',
      '2026-07-22',
      '2026-07-24',
      '2026-07-27',
      '2026-07-29',
      '2026-07-31'
    ])
  })

  it('respects untilMs (exclusive bound) within the month', () => {
    // until local Jul 25 midnight → last occurrence Jul 24
    const untilMs = new Date(2026, 6, 25).getTime()
    const model = buildRecurrenceMonthGridModel({
      rule: dailyRule({ untilMs }),
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(true)
    // Jul 20..24 = 5
    expect(model.occurrenceCount).toBe(5)
    expect(model.occurrenceIsoDates).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24'
    ])
  })

  it('respects count from dtStart (global, not month-only)', () => {
    const model = buildRecurrenceMonthGridModel({
      rule: dailyRule({ count: 3 }),
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(true)
    expect(model.occurrenceCount).toBe(3)
    expect(model.occurrenceIsoDates).toEqual(['2026-07-20', '2026-07-21', '2026-07-22'])
  })

  it('empty month when rule starts after the month', () => {
    const model = buildRecurrenceMonthGridModel({
      rule: dailyRule({ dtStartMs: new Date(2026, 7, 1).getTime() }),
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(true)
    expect(model.occurrenceCount).toBe(0)
    expect(model.occurrenceIsoDates).toEqual([])
    expect(model.summaryLine).toBe(model.copy.emptyLabel)
  })

  it('fail-closed on invalid weekly (empty byWeekday)', () => {
    const model = buildRecurrenceMonthGridModel({
      rule: weeklyRule({ byWeekday: [] }),
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(false)
    expect(model.occurrenceCount).toBe(0)
    expect(model.warnings.length).toBeGreaterThan(0)
    expect(model.summaryLine).toBe(model.copy.invalidLabel)
  })

  it('fail-closed on focus rule without taskId', () => {
    const model = buildRecurrenceMonthGridModel({
      rule: dailyRule({ taskId: null }),
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(false)
    expect(model.occurrenceCount).toBe(0)
    expect(model.warnings.some((w) => /taskId/i.test(w) || /task/i.test(w))).toBe(true)
  })

  it('fail-closed when rule and draft both missing', () => {
    const model = buildRecurrenceMonthGridModel({
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(false)
    expect(model.occurrenceCount).toBe(0)
    expect(model.warnings[0]).toMatch(/缺少/)
  })

  it('accepts form draft path (no task clone — binds existing taskId)', () => {
    const model = buildRecurrenceMonthGridModel({
      draft: dailyDraft({ count: 2 }),
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(true)
    expect(model.occurrenceCount).toBe(2)
    // Pure model only — no Task invented; taskId stays on rule surface via expand blocks.
    expect(model.occurrenceIsoDates).toEqual(['2026-07-20', '2026-07-21'])
  })

  it('pad cells outside month are never marked occurrence', () => {
    const model = buildRecurrenceMonthGridModel({
      rule: dailyRule({ dtStartMs: new Date(2026, 5, 1).getTime() }), // from June 1
      month: { year: 2026, monthIndex: 6 }
    })
    expect(model.ok).toBe(true)
    // All of July 1–31 daily
    expect(model.occurrenceCount).toBe(31)
    const padOcc = model.cells.filter((c) => !c.inMonth && c.isOccurrence)
    expect(padOcc).toHaveLength(0)
    const padWithCount = model.cells.filter((c) => !c.inMonth && c.occurrenceCount > 0)
    expect(padWithCount).toHaveLength(0)
  })
})
