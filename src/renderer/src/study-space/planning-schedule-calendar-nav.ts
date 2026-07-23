/**
 * Pure calendar navigation helpers for StudyTaskSchedulePage (week/month views).
 *
 * Week anchor convention matches resolveLocalWeekAnchorMidnightMs:
 * Sunday-start local midnight. Product columns remain Mon-first
 * (Mon=anchor+1 … Sat=anchor+6, Sun=anchor+0).
 *
 * Read-only projection helpers only — never writes store.
 */
import {
  monthRangeFromEpoch,
  shiftMonthRange,
  formatMonthTitle,
  type RecurrenceMonthRange
} from './planning-recurrence-month-grid'
import type { StudyTaskCategoryId, StudyTaskSchedule } from './types'

export const SCHEDULE_CALENDAR_DAY_MS = 24 * 60 * 60_000

export type ScheduleCalendarViewMode = 'week' | 'month'

export const SCHEDULE_CALENDAR_VIEW_OPTIONS: readonly {
  id: ScheduleCalendarViewMode
  label: string
  ariaLabel: string
}[] = [
  { id: 'week', label: '周', ariaLabel: '周视图' },
  { id: 'month', label: '月', ariaLabel: '月视图' }
] as const

export type ScheduleCalendarEntry = {
  blockId: string
  taskId: string
  title: string
  done: boolean
  categoryId?: StudyTaskCategoryId
  schedule: StudyTaskSchedule
  /** Local YYYY-MM-DD when projected from absolute ScheduleBlock. */
  dateKey?: string
  sliceIndex?: number
  zoneTooltip?: string
}

export type WeekDayHeadModel = {
  dayIndex: number
  weekdayLabel: string
  /** Day-of-month number for the column's concrete date. */
  dayOfMonth: number
  /** Local YYYY-MM-DD for this column. */
  dateKey: string
  isToday: boolean
}

export type ScheduleMonthTaskChip = {
  blockId: string
  taskId: string
  title: string
  done: boolean
  categoryId?: StudyTaskCategoryId
  startMinutes: number
  endMinutes: number
  /** When multiple slices share a day, keep stable id. */
  chipKey: string
}

export type ScheduleMonthCell = {
  key: string
  isoDate: string
  dayOfMonth: number
  dayStartMs: number
  inMonth: boolean
  isToday: boolean
  tasks: ScheduleMonthTaskChip[]
}

export type ScheduleMonthModel = {
  year: number
  monthIndex: number
  titleLabel: string
  weekdayHeaders: readonly string[]
  cells: ScheduleMonthCell[]
  scheduledDayCount: number
  totalTaskChips: number
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const MONTH_WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const

function localMidnightMs(epochMs: number): number {
  const d = new Date(epochMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function parseLocalDateKeyMs(dateKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const ms = new Date(year, month - 1, day).getTime()
  return Number.isFinite(ms) ? ms : null
}

export function formatLocalDateKey(epochMs: number): string {
  const d = new Date(epochMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Product Mon-first dayIndex → absolute local midnight within the Sunday-anchored week.
 * dayIndex 0=Mon … 5=Sat → anchor+1 … anchor+6; dayIndex 6=Sun → anchor+0.
 */
export function monFirstDayIndexToLocalMidnightMs(
  weekAnchorMidnightMs: number,
  dayIndex: number
): number | null {
  if (!Number.isFinite(weekAnchorMidnightMs)) return null
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) return null
  const offsetDays = dayIndex === 6 ? 0 : dayIndex + 1
  return weekAnchorMidnightMs + offsetDays * SCHEDULE_CALENDAR_DAY_MS
}

export function shiftWeekAnchorMidnightMs(weekAnchorMidnightMs: number, deltaWeeks: number): number {
  const anchor = Number.isFinite(weekAnchorMidnightMs)
    ? weekAnchorMidnightMs
    : localMidnightMs(Date.now())
  const delta = Number.isFinite(deltaWeeks) ? Math.trunc(deltaWeeks) : 0
  return anchor + delta * 7 * SCHEDULE_CALENDAR_DAY_MS
}

/**
 * Human label for the visible product week (Mon → Sun column order).
 */
export function formatWeekRangeLabel(weekAnchorMidnightMs: number): string {
  // Sunday-anchored week window is [anchor, anchor+7) = Sun … Sat chronologically.
  if (!Number.isFinite(weekAnchorMidnightMs)) return ''
  const start = new Date(weekAnchorMidnightMs)
  const end = new Date(weekAnchorMidnightMs + 6 * SCHEDULE_CALENDAR_DAY_MS)
  const startY = start.getFullYear()
  const endY = end.getFullYear()
  const startLabel = `${start.getMonth() + 1}月${start.getDate()}日`
  const endLabel =
    startY === endY
      ? `${end.getMonth() + 1}月${end.getDate()}日`
      : `${endY}年${end.getMonth() + 1}月${end.getDate()}日`
  if (startY !== endY) return `${startY}年${startLabel} – ${endLabel}`
  return `${startY}年${startLabel} – ${endLabel}`
}

export function isDateKeyInWeekWindow(
  dateKey: string,
  weekAnchorMidnightMs: number
): boolean {
  const dayMs = parseLocalDateKeyMs(dateKey)
  if (dayMs == null || !Number.isFinite(weekAnchorMidnightMs)) return false
  const end = weekAnchorMidnightMs + 7 * SCHEDULE_CALENDAR_DAY_MS
  return dayMs >= weekAnchorMidnightMs && dayMs < end
}

/**
 * Keep absolute chips in the visible week; keep V1 weekday-only rows (no dateKey)
 * as repeating weekly patterns.
 */
export function filterScheduleEntriesForWeek(
  entries: readonly ScheduleCalendarEntry[],
  weekAnchorMidnightMs: number
): ScheduleCalendarEntry[] {
  return entries.filter((entry) => {
    if (!entry.dateKey) return true
    return isDateKeyInWeekWindow(entry.dateKey, weekAnchorMidnightMs)
  })
}

export function buildWeekDayHeadModels(input: {
  weekAnchorMidnightMs: number
  todayMs?: number
  weekdayLabels?: readonly string[]
}): WeekDayHeadModel[] {
  const labels = input.weekdayLabels ?? WEEKDAY_LABELS
  const todayKey = formatLocalDateKey(input.todayMs ?? Date.now())
  return labels.map((weekdayLabel, dayIndex) => {
    const dayMs = monFirstDayIndexToLocalMidnightMs(input.weekAnchorMidnightMs, dayIndex) ?? 0
    const dateKey = formatLocalDateKey(dayMs)
    const d = new Date(dayMs)
    return {
      dayIndex,
      weekdayLabel,
      dayOfMonth: d.getDate(),
      dateKey,
      isToday: dateKey === todayKey
    }
  })
}

function monFirstGridStartMs(year: number, monthIndex: number): number {
  const first = new Date(year, monthIndex, 1)
  const js = first.getDay()
  const monOffset = (js + 6) % 7
  return localMidnightMs(first.getTime()) - monOffset * SCHEDULE_CALENDAR_DAY_MS
}

function monFirstWeekdayFromLocalMs(dayStartMs: number): number {
  return (new Date(dayStartMs).getDay() + 6) % 7
}

function chipKeyFor(entry: ScheduleCalendarEntry, dayKey: string): string {
  const slice = entry.sliceIndex ?? 0
  return `${entry.blockId}:${dayKey}:${slice}`
}

/**
 * Month grid of scheduled chips. Absolute dateKey chips land on that day;
 * V1 weekday-only entries repeat on matching weekdays inside the month.
 */
export function buildScheduleMonthModel(input: {
  month: RecurrenceMonthRange
  entries: readonly ScheduleCalendarEntry[]
  todayMs?: number
}): ScheduleMonthModel {
  const year = Number.isFinite(input.month.year)
    ? Math.trunc(input.month.year)
    : new Date().getFullYear()
  const monthIndex = Number.isFinite(input.month.monthIndex)
    ? Math.min(11, Math.max(0, Math.trunc(input.month.monthIndex)))
    : 0
  const todayKey = formatLocalDateKey(input.todayMs ?? Date.now())
  const gridStart = monFirstGridStartMs(year, monthIndex)
  const byDay = new Map<string, ScheduleMonthTaskChip[]>()

  const pushChip = (isoDate: string, entry: ScheduleCalendarEntry): void => {
    const list = byDay.get(isoDate) ?? []
    list.push({
      blockId: entry.blockId,
      taskId: entry.taskId,
      title: entry.title,
      done: entry.done,
      ...(entry.categoryId ? { categoryId: entry.categoryId } : {}),
      startMinutes: entry.schedule.startMinutes,
      endMinutes: entry.schedule.endMinutes,
      chipKey: chipKeyFor(entry, isoDate)
    })
    byDay.set(isoDate, list)
  }

  for (const entry of input.entries) {
    if (entry.dateKey) {
      const dayMs = parseLocalDateKeyMs(entry.dateKey)
      if (dayMs == null) continue
      const d = new Date(dayMs)
      if (d.getFullYear() !== year || d.getMonth() !== monthIndex) continue
      pushChip(entry.dateKey, entry)
      continue
    }
    // Weekday-only V1 cache: paint every matching in-month weekday.
    for (let i = 0; i < 42; i += 1) {
      const dayStartMs = gridStart + i * SCHEDULE_CALENDAR_DAY_MS
      const d = new Date(dayStartMs)
      if (d.getFullYear() !== year || d.getMonth() !== monthIndex) continue
      if (monFirstWeekdayFromLocalMs(dayStartMs) !== entry.schedule.weekday) continue
      pushChip(formatLocalDateKey(dayStartMs), entry)
    }
  }

  const cells: ScheduleMonthCell[] = []
  let scheduledDayCount = 0
  let totalTaskChips = 0
  for (let i = 0; i < 42; i += 1) {
    const dayStartMs = gridStart + i * SCHEDULE_CALENDAR_DAY_MS
    const d = new Date(dayStartMs)
    const isoDate = formatLocalDateKey(dayStartMs)
    const inMonth = d.getFullYear() === year && d.getMonth() === monthIndex
    const tasks = (byDay.get(isoDate) ?? [])
      .slice()
      .sort(
        (a, b) =>
          a.startMinutes - b.startMinutes ||
          a.chipKey.localeCompare(b.chipKey)
      )
    if (inMonth && tasks.length > 0) {
      scheduledDayCount += 1
      totalTaskChips += tasks.length
    }
    cells.push({
      key: `month-cell:${isoDate}`,
      isoDate,
      dayOfMonth: d.getDate(),
      dayStartMs,
      inMonth,
      isToday: isoDate === todayKey,
      tasks: inMonth ? tasks : []
    })
  }

  return {
    year,
    monthIndex,
    titleLabel: formatMonthTitle({ year, monthIndex }),
    weekdayHeaders: MONTH_WEEKDAY_HEADERS,
    cells,
    scheduledDayCount,
    totalTaskChips
  }
}

export function monthRangeFromWeekAnchor(weekAnchorMidnightMs: number): RecurrenceMonthRange {
  // Prefer the product Monday of the visible week as the month seed.
  const monMs = monFirstDayIndexToLocalMidnightMs(weekAnchorMidnightMs, 0)
  return monthRangeFromEpoch(monMs ?? weekAnchorMidnightMs)
}

export { shiftMonthRange, monthRangeFromEpoch, formatMonthTitle }
export type { RecurrenceMonthRange }
