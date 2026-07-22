/**
 * STC-703 pure month-grid model for recurrence occurrence dates.
 *
 * Given a recurrence rule (or form draft) + local calendar month, list
 * occurrence dates inside that month. Respects until/count via pure expand.
 * Fail-closed on invalid rule. Read-only preview only — never writes store,
 * never clones Task, never auto-materializes schedule blocks.
 */
import {
  expandRecurrenceToScheduleBlocks,
  validateRecurrenceRule,
  type RecurrenceRule
} from '../../../shared/study-planning'
import {
  buildRecurrenceRuleFromForm,
  type RecurrenceRuleFormDraft
} from './planning-recurrence-expand'

const DAY_MS = 24 * 60 * 60_000

/** Mon-first weekday headers (display only). */
export const RECURRENCE_MONTH_WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const

export type RecurrenceMonthRange = {
  /** Local calendar year. */
  year: number
  /** Local calendar month index, 0=Jan … 11=Dec. */
  monthIndex: number
}

export type RecurrenceMonthGridCell = {
  key: string
  /** 1–31 for in-month days; leading/trailing pad days still have a dayOfMonth. */
  dayOfMonth: number
  /** Local midnight for this cell day. */
  dayStartMs: number
  isoDate: string
  inMonth: boolean
  isOccurrence: boolean
  /** Number of expanded intervals on this local day (usually 0 or 1). */
  occurrenceCount: number
  /** JS weekday 0=Sun … 6=Sat. */
  weekdayJs: number
}

export type RecurrenceMonthGridModel = {
  year: number
  monthIndex: number
  titleLabel: string
  weekdayHeaders: readonly string[]
  /** Fixed 6×7 = 42 cells, Mon-first layout. */
  cells: RecurrenceMonthGridCell[]
  occurrenceIsoDates: string[]
  occurrenceCount: number
  ok: boolean
  warnings: string[]
  summaryLine: string
  copy: {
    title: string
    emptyLabel: string
    invalidLabel: string
    prevMonth: string
    nextMonth: string
    readOnlyNote: string
  }
}

function clampMonthIndex(monthIndex: number): number {
  if (!Number.isFinite(monthIndex)) return 0
  const m = Math.trunc(monthIndex)
  if (m < 0) return 0
  if (m > 11) return 11
  return m
}

/**
 * Local calendar month containing an epoch (wall clock).
 */
export function monthRangeFromEpoch(epochMs: number): RecurrenceMonthRange {
  if (!Number.isFinite(epochMs)) {
    const now = new Date()
    return { year: now.getFullYear(), monthIndex: now.getMonth() }
  }
  const d = new Date(epochMs)
  return { year: d.getFullYear(), monthIndex: d.getMonth() }
}

/**
 * Exclusive month window [first-of-month local midnight, first-of-next-month).
 * Fail-closed: non-finite year → empty invalid window (start === end).
 */
export function monthWindowMs(range: RecurrenceMonthRange): {
  windowStartMs: number
  windowEndMs: number
} {
  const year = Number.isFinite(range.year) ? Math.trunc(range.year) : NaN
  const monthIndex = clampMonthIndex(range.monthIndex)
  if (!Number.isFinite(year)) {
    return { windowStartMs: 0, windowEndMs: 0 }
  }
  const windowStartMs = new Date(year, monthIndex, 1).getTime()
  const windowEndMs = new Date(year, monthIndex + 1, 1).getTime()
  return { windowStartMs, windowEndMs }
}

/**
 * Shift month range by delta months (can cross year). Pure.
 */
export function shiftMonthRange(range: RecurrenceMonthRange, deltaMonths: number): RecurrenceMonthRange {
  const year = Number.isFinite(range.year) ? Math.trunc(range.year) : new Date().getFullYear()
  const monthIndex = clampMonthIndex(range.monthIndex)
  const delta = Number.isFinite(deltaMonths) ? Math.trunc(deltaMonths) : 0
  const d = new Date(year, monthIndex + delta, 1)
  return { year: d.getFullYear(), monthIndex: d.getMonth() }
}

export function formatMonthTitle(range: RecurrenceMonthRange): string {
  const year = Number.isFinite(range.year) ? Math.trunc(range.year) : 0
  const monthIndex = clampMonthIndex(range.monthIndex)
  return `${year}年${monthIndex + 1}月`
}

function localDayStartMs(epochMs: number): number {
  const d = new Date(epochMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function formatIsoDateLocal(epochMs: number): string {
  const d = new Date(epochMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Monday-first grid origin (local midnight) for the calendar sheet that contains month.
 */
function monFirstGridStartMs(year: number, monthIndex: number): number {
  const first = new Date(year, monthIndex, 1)
  const js = first.getDay() // 0=Sun
  const monOffset = (js + 6) % 7 // Mon=0 … Sun=6
  return localDayStartMs(first.getTime()) - monOffset * DAY_MS
}

function resolveRule(input: {
  rule?: RecurrenceRule | null
  draft?: RecurrenceRuleFormDraft | null
}): RecurrenceRule | null {
  if (input.rule) return input.rule
  if (input.draft) return buildRecurrenceRuleFromForm(input.draft)
  return null
}

function emptyCopy(): RecurrenceMonthGridModel['copy'] {
  return {
    title: '本月实例',
    emptyLabel: '本月无重复日期',
    invalidLabel: '规则无效，无法生成月份预览',
    prevMonth: '上一月',
    nextMonth: '下一月',
    readOnlyNote: '只读预览 · 不会自动展开 · 不会克隆任务'
  }
}

function emptyModel(
  range: RecurrenceMonthRange,
  warnings: string[],
  summaryLine: string
): RecurrenceMonthGridModel {
  const year = Number.isFinite(range.year) ? Math.trunc(range.year) : new Date().getFullYear()
  const monthIndex = clampMonthIndex(range.monthIndex)
  const cells = buildEmptyCells(year, monthIndex, new Set())
  return {
    year,
    monthIndex,
    titleLabel: formatMonthTitle({ year, monthIndex }),
    weekdayHeaders: RECURRENCE_MONTH_WEEKDAY_HEADERS,
    cells,
    occurrenceIsoDates: [],
    occurrenceCount: 0,
    ok: false,
    warnings,
    summaryLine,
    copy: emptyCopy()
  }
}

function buildEmptyCells(
  year: number,
  monthIndex: number,
  occurrenceDays: Set<string>
): RecurrenceMonthGridCell[] {
  const gridStart = monFirstGridStartMs(year, monthIndex)
  const cells: RecurrenceMonthGridCell[] = []
  for (let i = 0; i < 42; i++) {
    const dayStartMs = gridStart + i * DAY_MS
    const d = new Date(dayStartMs)
    const inMonth = d.getFullYear() === year && d.getMonth() === monthIndex
    const isoDate = formatIsoDateLocal(dayStartMs)
    const occurrenceCount = occurrenceDays.has(isoDate) ? 1 : 0
    cells.push({
      key: `cell:${isoDate}`,
      dayOfMonth: d.getDate(),
      dayStartMs,
      isoDate,
      inMonth,
      isOccurrence: occurrenceCount > 0 && inMonth,
      occurrenceCount: inMonth ? occurrenceCount : 0,
      weekdayJs: d.getDay()
    })
  }
  return cells
}

/**
 * Pure month grid: occurrence dates for a rule within a local calendar month.
 *
 * - Respects `untilMs` / `count` via `expandRecurrenceToScheduleBlocks`.
 * - Fail-closed: invalid rule → empty cells + warnings; no throw.
 * - Never writes; never invents Task; empty existingBlocks (preview only).
 */
export function buildRecurrenceMonthGridModel(input: {
  rule?: RecurrenceRule | null
  draft?: RecurrenceRuleFormDraft | null
  month: RecurrenceMonthRange
}): RecurrenceMonthGridModel {
  const year = Number.isFinite(input.month.year)
    ? Math.trunc(input.month.year)
    : new Date().getFullYear()
  const monthIndex = clampMonthIndex(input.month.monthIndex)
  const range: RecurrenceMonthRange = { year, monthIndex }
  const copy = emptyCopy()

  const rule = resolveRule(input)
  if (!rule) {
    return emptyModel(range, ['缺少重复规则'], copy.invalidLabel)
  }

  const validation = validateRecurrenceRule(rule)
  if (!validation.ok) {
    return emptyModel(
      range,
      validation.issues.map((i) => i.message),
      copy.invalidLabel
    )
  }

  const window = monthWindowMs(range)
  if (window.windowEndMs <= window.windowStartMs) {
    return emptyModel(range, ['月份范围无效'], copy.invalidLabel)
  }

  const result = expandRecurrenceToScheduleBlocks({
    rules: [rule],
    window,
    existingBlocks: []
  })

  const counts = new Map<string, number>()
  for (const block of result.blocks) {
    if (!Number.isFinite(block.startAtMs)) continue
    const iso = formatIsoDateLocal(block.startAtMs)
    counts.set(iso, (counts.get(iso) ?? 0) + 1)
  }

  const occurrenceIsoDates = [...counts.keys()].sort()
  const occurrenceDays = new Set(occurrenceIsoDates)
  const cells = buildEmptyCells(year, monthIndex, occurrenceDays).map((cell) => {
    const n = counts.get(cell.isoDate) ?? 0
    if (!cell.inMonth || n <= 0) return cell
    return {
      ...cell,
      isOccurrence: true,
      occurrenceCount: n
    }
  })

  const occurrenceCount = result.blocks.length
  const warnings = result.warnings.map((w) => w.message)
  const summaryLine =
    occurrenceCount > 0
      ? `本月 ${occurrenceCount} 个实例 · ${occurrenceIsoDates.length} 天`
      : copy.emptyLabel

  return {
    year,
    monthIndex,
    titleLabel: formatMonthTitle(range),
    weekdayHeaders: RECURRENCE_MONTH_WEEKDAY_HEADERS,
    cells,
    occurrenceIsoDates,
    occurrenceCount,
    ok: true,
    warnings,
    summaryLine,
    copy
  }
}

export type { RecurrenceRuleFormDraft }
