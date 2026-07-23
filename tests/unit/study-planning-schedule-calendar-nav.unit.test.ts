/**
 * Pure calendar navigation for schedule week/month views.
 */
import { describe, expect, it } from 'vitest'
import {
  buildScheduleMonthModel,
  buildWeekDayHeadModels,
  filterScheduleEntriesForWeek,
  formatLocalDateKey,
  formatWeekRangeLabel,
  isDateKeyInWeekWindow,
  monFirstDayIndexToLocalMidnightMs,
  monthRangeFromWeekAnchor,
  parseLocalDateKeyMs,
  shiftWeekAnchorMidnightMs,
  type ScheduleCalendarEntry
} from '../../src/renderer/src/study-space/planning-schedule-calendar-nav'

/** Local Sunday midnight 2026-07-19 (week containing Mon 2026-07-20). */
const WEEK_ANCHOR = new Date(2026, 6, 19, 0, 0, 0, 0).getTime()
const DAY = 24 * 60 * 60_000

function entry(partial: Partial<ScheduleCalendarEntry> & Pick<ScheduleCalendarEntry, 'blockId' | 'taskId' | 'title' | 'schedule'>): ScheduleCalendarEntry {
  return {
    done: false,
    ...partial
  }
}

describe('week anchor navigation', () => {
  it('maps Mon-first dayIndex onto Sunday-anchored week', () => {
    expect(formatLocalDateKey(monFirstDayIndexToLocalMidnightMs(WEEK_ANCHOR, 0)!)).toBe('2026-07-20')
    expect(formatLocalDateKey(monFirstDayIndexToLocalMidnightMs(WEEK_ANCHOR, 5)!)).toBe('2026-07-25')
    expect(formatLocalDateKey(monFirstDayIndexToLocalMidnightMs(WEEK_ANCHOR, 6)!)).toBe('2026-07-19')
  })

  it('shifts week by ±1 week', () => {
    expect(shiftWeekAnchorMidnightMs(WEEK_ANCHOR, 1)).toBe(WEEK_ANCHOR + 7 * DAY)
    expect(shiftWeekAnchorMidnightMs(WEEK_ANCHOR, -1)).toBe(WEEK_ANCHOR - 7 * DAY)
  })

  it('formats week range as Mon–Sun', () => {
    expect(formatWeekRangeLabel(WEEK_ANCHOR)).toBe('2026年7月19日 – 7月25日')
  })

  it('builds day heads with absolute dates and today flag', () => {
    const heads = buildWeekDayHeadModels({
      weekAnchorMidnightMs: WEEK_ANCHOR,
      todayMs: new Date(2026, 6, 22, 12, 0, 0, 0).getTime() // Wed
    })
    expect(heads).toHaveLength(7)
    expect(heads[0]).toMatchObject({ dayIndex: 0, dateKey: '2026-07-20', dayOfMonth: 20, isToday: false })
    expect(heads[2]).toMatchObject({ dayIndex: 2, dateKey: '2026-07-22', isToday: true })
    expect(heads[6]).toMatchObject({ dayIndex: 6, dateKey: '2026-07-19' })
  })
})

describe('week window filter', () => {
  it('keeps absolute chips only inside the week', () => {
    const entries: ScheduleCalendarEntry[] = [
      entry({
        blockId: 'b1',
        taskId: 't1',
        title: 'in-week',
        dateKey: '2026-07-21',
        schedule: { weekday: 1, startMinutes: 60, endMinutes: 120 }
      }),
      entry({
        blockId: 'b2',
        taskId: 't2',
        title: 'next-week',
        dateKey: '2026-07-27',
        schedule: { weekday: 0, startMinutes: 60, endMinutes: 120 }
      }),
      entry({
        blockId: 'b3',
        taskId: 't3',
        title: 'v1-pattern',
        schedule: { weekday: 0, startMinutes: 60, endMinutes: 120 }
      })
    ]
    const filtered = filterScheduleEntriesForWeek(entries, WEEK_ANCHOR)
    expect(filtered.map((e) => e.taskId).sort()).toEqual(['t1', 't3'])
    expect(isDateKeyInWeekWindow('2026-07-19', WEEK_ANCHOR)).toBe(true)
    expect(isDateKeyInWeekWindow('2026-07-25', WEEK_ANCHOR)).toBe(true)
    expect(isDateKeyInWeekWindow('2026-07-26', WEEK_ANCHOR)).toBe(false)
    expect(isDateKeyInWeekWindow('2026-07-27', WEEK_ANCHOR)).toBe(false)
  })
})

describe('month model', () => {
  it('places absolute chips and paints V1 weekday patterns inside month', () => {
    const model = buildScheduleMonthModel({
      month: { year: 2026, monthIndex: 6 },
      todayMs: new Date(2026, 6, 23, 8, 0, 0, 0).getTime(),
      entries: [
        entry({
          blockId: 'abs',
          taskId: 'abs-task',
          title: '绝对块',
          dateKey: '2026-07-15',
          schedule: { weekday: 2, startMinutes: 9 * 60, endMinutes: 10 * 60 }
        }),
        entry({
          blockId: 'v1',
          taskId: 'v1-task',
          title: '每周一',
          schedule: { weekday: 0, startMinutes: 14 * 60, endMinutes: 15 * 60 }
        }),
        entry({
          blockId: 'out',
          taskId: 'out-task',
          title: '下月',
          dateKey: '2026-08-01',
          schedule: { weekday: 5, startMinutes: 60, endMinutes: 120 }
        })
      ]
    })

    expect(model.titleLabel).toBe('2026年7月')
    expect(model.cells).toHaveLength(42)
    const day15 = model.cells.find((c) => c.isoDate === '2026-07-15')
    expect(day15?.tasks.map((t) => t.taskId)).toEqual(['abs-task'])
    // Mondays in July 2026: 6,13,20,27
    const mondays = model.cells.filter(
      (c) => c.inMonth && c.tasks.some((t) => t.taskId === 'v1-task')
    )
    expect(mondays.map((c) => c.dayOfMonth).sort((a, b) => a - b)).toEqual([6, 13, 20, 27])
    expect(model.cells.find((c) => c.isoDate === '2026-08-01')?.tasks).toEqual([])
    expect(model.cells.find((c) => c.isoDate === '2026-07-23')?.isToday).toBe(true)
    expect(model.scheduledDayCount).toBeGreaterThanOrEqual(5)
  })

  it('monthRangeFromWeekAnchor seeds from product Monday', () => {
    // Week of 2026-12-28 Mon is still Dec; week of 2027-01-04 uses Jan
    const lateDecAnchor = new Date(2026, 11, 27, 0, 0, 0, 0).getTime() // Sun
    expect(monthRangeFromWeekAnchor(lateDecAnchor)).toEqual({ year: 2026, monthIndex: 11 })
    const earlyJanAnchor = new Date(2027, 0, 3, 0, 0, 0, 0).getTime()
    expect(monthRangeFromWeekAnchor(earlyJanAnchor)).toEqual({ year: 2027, monthIndex: 0 })
  })

  it('parseLocalDateKeyMs rejects bad keys', () => {
    expect(parseLocalDateKeyMs('2026-07-20')).toBe(new Date(2026, 6, 20).getTime())
    expect(parseLocalDateKeyMs('nope')).toBeNull()
  })
})
