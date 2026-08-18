/**
 * STC-704 week projection — split overnight ScheduleBlocks into local-date chips.
 *
 * Pure helpers only: consume splitIntervalAtLocalMidnights / formatZonedRangeDisplay /
 * reprojectWallClockLabels. No I/O, no Date.now side effects (callers supply host zone).
 *
 * Epoch ms remains authority (ADR-0011). timeZone is projection metadata only.
 * Does not implement travel settings page or silent whole-week rezone (ADR-0011).
 */

import {
  formatZonedRangeDisplay,
  jsWeekdayToMonFirst,
  projectWallClock,
  reprojectWallClockLabels,
  splitIntervalAtLocalMidnights,
  type DateBlockSlice,
  type ScheduleBlock,
  type TimeZoneId
} from '../../../shared/study-planning'

/** One week-grid chip for a single local-date slice of a ScheduleBlock. */
export type WeekZoneChip = {
  /** Parent ScheduleBlock id. */
  blockId: string
  taskId: string | null
  /** Local calendar date YYYY-MM-DD in projection zone. */
  dateKey: string
  /** Product Mon-first weekday 0=Mon … 6=Sun derived from dateKey in projection zone. */
  weekday: number
  /** Minutes from local midnight (0..1440 exclusive end at midnight shown as 24*60 when needed). */
  startMinutes: number
  endMinutes: number
  startAtMs: number
  endAtMs: number
  durationMs: number
  wallStartLabel: string
  wallEndLabel: string
  /** Zone used for this chip's wall labels / minutes. */
  timeZone: TimeZoneId
  /** True when the parent absolute interval crossed local midnight. */
  crossedMidnight: boolean
  /** Index of this slice within the parent block's split (0-based). */
  sliceIndex: number
  /** Total slices for the parent block. */
  sliceCount: number
  /** Parent block's stored zone when present; null when omitted. */
  blockTimeZone: TimeZoneId | null
  /** Host zone used for mismatch display. */
  hostTimeZone: TimeZoneId
  /** True when block.timeZone is set and differs from host. */
  zoneMismatch: boolean
  /**
   * Optional display range for tooltips (absolute duration + wall labels).
   * When zoneMismatch, labels are host-reprojected while anchors stay fixed.
   */
  display:
    | {
        startLabel: string
        endLabel: string
        durationLabel: string
        crossesMidnight: boolean
        /** Present when host ≠ block zone: reprojected host labels. */
        hostReprojectLabel?: string
      }
    | null
}

export type ProjectWeekZoneChipsInput = {
  blocks: readonly ScheduleBlock[]
  /** Host / renderer IANA zone (required; no Date.now fallback). */
  hostTimeZone: TimeZoneId
  /** When true, only `kind === 'focus'` and non-cancelled blocks (default true for week chips). */
  focusOnly?: boolean
}

export type ProjectWeekZoneChipsResult =
  | { ok: true; chips: WeekZoneChip[] }
  | { ok: false; code: string; message: string }

function parseMinutesFromWallLabel(label: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(label.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

/**
 * Map a local dateKey (YYYY-MM-DD) to product Mon-first weekday using absolute
 * noon of that civil day in `timeZone` (avoids host-local Date getters).
 */
export function monFirstWeekdayFromDateKey(
  dateKey: string,
  timeZone: TimeZoneId
): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!parts) return null
  const y = Number(parts[1])
  const mo = Number(parts[2])
  const d = Number(parts[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  // Approximate UTC noon for the civil date, then project wall + JS day via offset.
  // Iterate a few candidate offsets so we land on the intended civil date in zone.
  const candidates = [0, -12, 12, -14, 14].map((h) =>
    Date.UTC(y, mo - 1, d, 12 + h, 0, 0, 0)
  )
  for (const guess of candidates) {
    const wall = projectWallClock(guess, timeZone)
    if (!wall.ok) continue
    if (wall.parts.dateKey !== dateKey) continue
    // Build a Date in UTC from wall parts' offset so getUTCDay matches civil weekday.
    const utcMs =
      Date.UTC(wall.parts.year, wall.parts.month - 1, wall.parts.day, 12, 0, 0, 0) -
      wall.parts.offsetMinutes * 60_000
    // Civil weekday via offset-adjusted instant: use Intl weekday in zone.
    try {
      const wd = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short'
      }).format(new Date(guess))
      const map: Record<string, number> = {
        Mon: 0,
        Tue: 1,
        Wed: 2,
        Thu: 3,
        Fri: 4,
        Sat: 5,
        Sun: 6
      }
      const monFirst = map[wd]
      if (monFirst !== undefined) return monFirst
    } catch {
      // fall through
    }
    void utcMs
    // Fallback: JS getUTCDay on civil noon UTC (wrong near dateline but rare for study).
    const js = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0)).getUTCDay()
    return jsWeekdayToMonFirst(js)
  }
  return null
}

/** Resolve wall minutes for a slice; midnight end (00:00 after cut) → 24*60 for same-day chip. */
export function sliceToDayMinutes(slice: DateBlockSlice): {
  startMinutes: number
  endMinutes: number
} | null {
  const startMinutes = parseMinutesFromWallLabel(slice.wallStartLabel)
  let endMinutes = parseMinutesFromWallLabel(slice.wallEndLabel)
  if (startMinutes == null || endMinutes == null) return null
  // Local midnight cut: end label is 00:00 on next civil day but slice dateKey is prior day.
  if (endMinutes === 0 && slice.endAtMs > slice.startAtMs) {
    endMinutes = 24 * 60
  }
  if (endMinutes <= startMinutes) return null
  if (startMinutes < 0 || endMinutes > 24 * 60) return null
  return { startMinutes, endMinutes }
}

function resolveBlockZone(block: ScheduleBlock, hostTimeZone: TimeZoneId): TimeZoneId {
  const raw = typeof block.timeZone === 'string' ? block.timeZone.trim() : ''
  return raw || hostTimeZone
}

function buildChipDisplay(input: {
  startAtMs: number
  endAtMs: number
  blockTimeZone: TimeZoneId | null
  projectionZone: TimeZoneId
  hostTimeZone: TimeZoneId
}): WeekZoneChip['display'] {
  const base = formatZonedRangeDisplay({
    startAtMs: input.startAtMs,
    endAtMs: input.endAtMs,
    timeZone: input.projectionZone
  })
  if (!base.ok) return null

  let hostReprojectLabel: string | undefined
  if (
    input.blockTimeZone &&
    input.blockTimeZone !== input.hostTimeZone
  ) {
    const reproj = reprojectWallClockLabels({
      startAtMs: input.startAtMs,
      endAtMs: input.endAtMs,
      fromTimeZone: input.blockTimeZone,
      toTimeZone: input.hostTimeZone
    })
    if (reproj.ok) {
      hostReprojectLabel = `${reproj.startLabel} → ${reproj.endLabel} (${input.hostTimeZone})`
    }
  }

  return {
    startLabel: base.startLabel,
    endLabel: base.endLabel,
    durationLabel: base.durationLabel,
    crossesMidnight: base.crossesMidnight,
    ...(hostReprojectLabel ? { hostReprojectLabel } : {})
  }
}

/**
 * Project ScheduleBlocks into week chips, splitting overnight intervals at local midnights.
 * Same-day blocks → one chip; SH 22:00–02:00 → two chips.
 */
export function projectWeekZoneChips(input: ProjectWeekZoneChipsInput): ProjectWeekZoneChipsResult {
  const host = typeof input.hostTimeZone === 'string' ? input.hostTimeZone.trim() : ''
  if (!host) {
    return { ok: false, code: 'host_timezone_required', message: 'hostTimeZone is required' }
  }

  const focusOnly = input.focusOnly !== false
  const chips: WeekZoneChip[] = []

  for (const block of input.blocks) {
    if (focusOnly) {
      if (block.kind !== 'focus') continue
      if (block.status === 'cancelled') continue
    }
    if (!Number.isFinite(block.startAtMs) || !Number.isFinite(block.endAtMs)) continue
    if (block.endAtMs <= block.startAtMs) continue

    const projectionZone = resolveBlockZone(block, host)
    const split = splitIntervalAtLocalMidnights({
      startAtMs: block.startAtMs,
      endAtMs: block.endAtMs,
      timeZone: projectionZone
    })
    if (!split.ok) continue

    const blockTimeZone =
      typeof block.timeZone === 'string' && block.timeZone.trim()
        ? block.timeZone.trim()
        : null
    const zoneMismatch = Boolean(blockTimeZone && blockTimeZone !== host)
    const parentDisplay = buildChipDisplay({
      startAtMs: block.startAtMs,
      endAtMs: block.endAtMs,
      blockTimeZone,
      projectionZone,
      hostTimeZone: host
    })

    for (let i = 0; i < split.slices.length; i += 1) {
      const slice = split.slices[i]
      const minutes = sliceToDayMinutes(slice)
      if (!minutes) continue
      const weekday = monFirstWeekdayFromDateKey(slice.dateKey, projectionZone)
      if (weekday == null) continue

      chips.push({
        blockId: block.id,
        taskId: block.taskId,
        dateKey: slice.dateKey,
        weekday,
        startMinutes: minutes.startMinutes,
        endMinutes: minutes.endMinutes,
        startAtMs: slice.startAtMs,
        endAtMs: slice.endAtMs,
        durationMs: slice.durationMs,
        wallStartLabel: slice.wallStartLabel,
        wallEndLabel: slice.wallEndLabel === '00:00' && minutes.endMinutes === 24 * 60
          ? '24:00'
          : slice.wallEndLabel,
        timeZone: projectionZone,
        crossedMidnight: split.crossedMidnight,
        sliceIndex: i,
        sliceCount: split.slices.length,
        blockTimeZone,
        hostTimeZone: host,
        zoneMismatch,
        display: parentDisplay
      })
    }
  }

  chips.sort(
    (a, b) =>
      a.startAtMs - b.startAtMs ||
      a.sliceIndex - b.sliceIndex ||
      a.blockId.localeCompare(b.blockId)
  )

  return { ok: true, chips }
}

/**
 * Map a WeekZoneChip into V1 weekday+minutes shape for existing week layout.
 * Overnight parent blocks become multiple same-day schedules (one per chip).
 */
export function weekZoneChipToV1Schedule(chip: WeekZoneChip): {
  weekday: number
  startMinutes: number
  endMinutes: number
} {
  return {
    weekday: chip.weekday,
    startMinutes: chip.startMinutes,
    endMinutes: chip.endMinutes
  }
}

/**
 * Tooltip / detail line when host zone ≠ block zone (labels-only; no rewrite).
 */
export function formatWeekChipZoneTooltip(chip: WeekZoneChip): string | null {
  if (!chip.zoneMismatch || !chip.display) return null
  const parts = [
    `${chip.display.startLabel} – ${chip.display.endLabel}`,
    chip.display.durationLabel
  ]
  if (chip.blockTimeZone) {
    parts.push(`块时区 ${chip.blockTimeZone}`)
  }
  if (chip.display.hostReprojectLabel) {
    parts.push(`本机 ${chip.display.hostReprojectLabel}`)
  }
  return parts.join(' · ')
}
