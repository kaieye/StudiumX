/**
 * STC-704 pure domain — cross-day / timezone travel / DST advanced editing.
 *
 * Roadmap §12:
 * - Store absolute times (epoch ms) + timezone awareness at pure layer
 * - Cross-midnight windows split into date blocks for week projection
 * - DST: duration via reliable absolute clock (endMs - startMs); display by local wall clock
 * - Editing helpers: split across midnight, reproject wall-clock labels, detect ambiguous/nonexistent local times
 * - Fail-closed on invalid ranges; no silent sub-minimum focus blocks (e.g. 3-minute pomodoros)
 *
 * Pure: no I/O, no Date.now side effects (callers supply instants), no OS hooks.
 * Not a durable wire freeze (ADR-0094 freeze #5 spirit).
 */


/**
 * Matches TIMER_PLAN_SEED_DEFAULTS.focusMinutesMin (timer-plan seed).
 * Inlined so this module stays free of timer-plan coupling (STC-704 pure slice).
 */
export const EDITABLE_RANGE_MIN_MINUTES_DEFAULT = 5

const MINUTE_MS = 60_000
const SECOND_MS = 1_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** IANA timezone id (e.g. "America/New_York", "Asia/Shanghai"). */
export type TimeZoneId = string

export type WallClockParts = {
  year: number
  /** 1–12 */
  month: number
  day: number
  /** 0–23 */
  hour: number
  minute: number
  second: number
  /** UTC offset of this instant in the zone, minutes east of UTC (e.g. -240 for EDT). */
  offsetMinutes: number
  /** Local calendar date key YYYY-MM-DD in the zone. */
  dateKey: string
  /** Local HH:mm label. */
  timeLabel: string
}

export type LocalDateTimeInput = {
  timeZone: TimeZoneId
  year: number
  /** 1–12 */
  month: number
  day: number
  /** 0–23 */
  hour: number
  minute: number
  second?: number
}

export type LocalTimeResolution =
  | { kind: 'unique'; atMs: number; offsetMinutes: number }
  | {
      kind: 'ambiguous'
      /** Earlier absolute instant (pre-fallback, typically DST). */
      earlierAtMs: number
      earlierOffsetMinutes: number
      /** Later absolute instant (post-fallback, typically standard). */
      laterAtMs: number
      laterOffsetMinutes: number
    }
  | {
      kind: 'nonexistent'
      /** First valid instant after the spring-forward gap. */
      afterGapAtMs: number
      message: string
    }
  | { kind: 'invalid_input'; code: string; message: string }

export type DateBlockSlice = {
  /** Local calendar date YYYY-MM-DD in `timeZone`. */
  dateKey: string
  startAtMs: number
  endAtMs: number
  /** Absolute duration (reliable clock): endAtMs - startAtMs. */
  durationMs: number
  wallStartLabel: string
  wallEndLabel: string
  timeZone: TimeZoneId
}

export type EditableRangeIssue = {
  code: string
  message: string
}

export type EditableRangeValidation =
  | { ok: true; durationMs: number; durationMinutes: number }
  | { ok: false; issues: EditableRangeIssue[] }

export type SplitIntervalResult =
  | { ok: true; slices: DateBlockSlice[]; crossedMidnight: boolean }
  | { ok: false; code: string; message: string }

export type ReprojectWallClockResult =
  | {
      ok: true
      startAtMs: number
      endAtMs: number
      durationMs: number
      from: { timeZone: TimeZoneId; start: WallClockParts; end: WallClockParts }
      to: { timeZone: TimeZoneId; start: WallClockParts; end: WallClockParts }
      startLabel: string
      endLabel: string
      durationLabel: string
    }
  | { ok: false; code: string; message: string }

const wallPartsCache = new Map<string, Intl.DateTimeFormat>()

function dtfFor(timeZone: TimeZoneId): Intl.DateTimeFormat {
  const key = timeZone
  let fmt = wallPartsCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
    wallPartsCache.set(key, fmt)
  }
  return fmt
}

function isValidTimeZone(timeZone: TimeZoneId): boolean {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false
  try {
    // Throws RangeError for unknown IANA ids in modern engines.
    dtfFor(timeZone.trim())
    return true
  } catch {
    return false
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dateKeyOf(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function timeLabelOf(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`
}

/**
 * Project absolute instant → local wall-clock parts in `timeZone`.
 * Fail-closed when instant or zone is invalid.
 */
export function projectWallClock(
  atMs: number,
  timeZone: TimeZoneId
): { ok: true; parts: WallClockParts } | { ok: false; code: string; message: string } {
  if (!Number.isFinite(atMs)) {
    return { ok: false, code: 'instant_not_finite', message: 'atMs must be a finite epoch ms' }
  }
  const tz = timeZone.trim()
  if (!isValidTimeZone(tz)) {
    return { ok: false, code: 'timezone_invalid', message: `Unknown or empty timeZone: ${timeZone}` }
  }

  const parts = dtfFor(tz).formatToParts(new Date(atMs))
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((p) => p.type === type)?.value
    const n = raw == null ? NaN : Number(raw)
    return n
  }

  let hour = get('hour')
  // Some engines emit hour "24" at midnight under hourCycle h23 edge cases.
  if (hour === 24) hour = 0

  const year = get('year')
  const month = get('month')
  const day = get('day')
  const minute = get('minute')
  const second = get('second')

  if (![year, month, day, hour, minute, second].every((n) => Number.isFinite(n))) {
    return { ok: false, code: 'wall_clock_project_failed', message: 'Failed to project wall clock parts' }
  }

  const offsetMinutes = getUtcOffsetMinutes(atMs, tz)
  return {
    ok: true,
    parts: {
      year,
      month,
      day,
      hour,
      minute,
      second,
      offsetMinutes,
      dateKey: dateKeyOf(year, month, day),
      timeLabel: timeLabelOf(hour, minute)
    }
  }
}

/**
 * UTC offset (minutes east of UTC) at `atMs` in `timeZone`.
 * Uses the difference between the zoned wall fields and the absolute instant.
 */
export function getUtcOffsetMinutes(atMs: number, timeZone: TimeZoneId): number {
  const tz = timeZone.trim()
  const parts = dtfFor(tz).formatToParts(new Date(atMs))
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((p) => p.type === type)?.value
    return raw == null ? NaN : Number(raw)
  }
  let hour = get('hour')
  if (hour === 24) hour = 0
  // Construct a UTC ms that has the same Y-M-D H:M:S as the wall clock.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'), 0)
  // offsetMinutes = wallAsUtc - actualUtc, in minutes.
  return Math.round((asUtc - atMs) / MINUTE_MS)
}

/**
 * Resolve a civil local date-time in `timeZone` to absolute ms.
 * Detects DST spring-forward gaps (nonexistent) and fall-back folds (ambiguous).
 */
export function resolveLocalDateTime(input: LocalDateTimeInput): LocalTimeResolution {
  const tz = input.timeZone?.trim() ?? ''
  if (!isValidTimeZone(tz)) {
    return { kind: 'invalid_input', code: 'timezone_invalid', message: `Unknown or empty timeZone: ${input.timeZone}` }
  }

  const { year, month, day, hour, minute } = input
  const second = input.second ?? 0
  if (
    ![year, month, day, hour, minute, second].every((n) => Number.isFinite(n) && Number.isInteger(n)) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return {
      kind: 'invalid_input',
      code: 'local_fields_invalid',
      message: 'year/month/day/hour/minute/second out of range'
    }
  }

  // Two candidate UTC guesses covering typical offset range (±14h).
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0)
  const guessA = wallAsUtc // assume UTC+0
  const guessB = wallAsUtc - 14 * HOUR_MS // far west
  const guessC = wallAsUtc + 14 * HOUR_MS // far east

  const matches: Array<{ atMs: number; offsetMinutes: number }> = []
  const seen = new Set<number>()

  for (const guess of [guessA, guessB, guessC]) {
    // Iterate a few times from each guess to converge on correct offset.
    let at = guess
    for (let i = 0; i < 4; i += 1) {
      const off = getUtcOffsetMinutes(at, tz)
      const candidate = wallAsUtc - off * MINUTE_MS
      const off2 = getUtcOffsetMinutes(candidate, tz)
      const final = wallAsUtc - off2 * MINUTE_MS
      if (!Number.isFinite(final)) break
      at = final
    }
    const offsetMinutes = getUtcOffsetMinutes(at, tz)
    const projected = projectWallClock(at, tz)
    if (!projected.ok) continue
    const p = projected.parts
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    ) {
      if (!seen.has(at)) {
        seen.add(at)
        matches.push({ atMs: at, offsetMinutes })
      }
    }
  }

  // Also probe neighbors around the fold (±3h) to catch both ambiguous instants.
  for (const base of [...matches.map((m) => m.atMs), wallAsUtc]) {
    for (const delta of [-3 * HOUR_MS, -2 * HOUR_MS, -HOUR_MS, HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS]) {
      const probe = base + delta
      const off = getUtcOffsetMinutes(probe, tz)
      const candidate = wallAsUtc - off * MINUTE_MS
      const projected = projectWallClock(candidate, tz)
      if (!projected.ok) continue
      const p = projected.parts
      if (
        p.year === year &&
        p.month === month &&
        p.day === day &&
        p.hour === hour &&
        p.minute === minute &&
        p.second === second &&
        !seen.has(candidate)
      ) {
        seen.add(candidate)
        matches.push({ atMs: candidate, offsetMinutes: getUtcOffsetMinutes(candidate, tz) })
      }
    }
  }

  matches.sort((a, b) => a.atMs - b.atMs)

  if (matches.length === 0) {
    // Nonexistent local time (spring forward). Point at first valid after gap via binary search nearby.
    const afterGapAtMs = findFirstValidAfterGap(wallAsUtc, tz, year, month, day, hour, minute, second)
    return {
      kind: 'nonexistent',
      afterGapAtMs,
      message: `Local time ${dateKeyOf(year, month, day)} ${timeLabelOf(hour, minute)} does not exist in ${tz} (DST gap)`
    }
  }

  if (matches.length === 1) {
    return {
      kind: 'unique',
      atMs: matches[0].atMs,
      offsetMinutes: matches[0].offsetMinutes
    }
  }

  // Ambiguous: keep earliest and latest matches.
  const earlier = matches[0]
  const later = matches[matches.length - 1]
  return {
    kind: 'ambiguous',
    earlierAtMs: earlier.atMs,
    earlierOffsetMinutes: earlier.offsetMinutes,
    laterAtMs: later.atMs,
    laterOffsetMinutes: later.offsetMinutes
  }
}

function findFirstValidAfterGap(
  wallAsUtc: number,
  timeZone: TimeZoneId,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): number {
  // Search forward up to 3h for the first instant whose wall clock is >= requested civil time on same date,
  // or the next representable local minute.
  const start = wallAsUtc - 14 * HOUR_MS
  const end = wallAsUtc + 14 * HOUR_MS
  let best = wallAsUtc
  for (let t = start; t <= end; t += MINUTE_MS) {
    const p = projectWallClock(t, timeZone)
    if (!p.ok) continue
    if (p.parts.year !== year || p.parts.month !== month || p.parts.day !== day) continue
    const localMins = p.parts.hour * 60 + p.parts.minute
    const targetMins = hour * 60 + minute
    if (localMins > targetMins || (localMins === targetMins && p.parts.second >= second)) {
      best = t
      break
    }
    best = t
  }
  return best
}

/**
 * Absolute duration via reliable clock semantics (epoch delta).
 * Fail-closed when range is invalid — never invents a positive duration.
 */
export function absoluteDurationMs(
  startAtMs: number,
  endAtMs: number
): { ok: true; durationMs: number } | { ok: false; code: string; message: string } {
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) {
    return { ok: false, code: 'range_not_finite', message: 'startAtMs/endAtMs must be finite epoch ms' }
  }
  if (endAtMs <= startAtMs) {
    return { ok: false, code: 'range_empty_or_inverted', message: 'endAtMs must be after startAtMs' }
  }
  return { ok: true, durationMs: endAtMs - startAtMs }
}

/**
 * Fail-closed editable range validation.
 * Refuses silent sub-minimum focus slices (default min = TIMER_PLAN focusMinutesMin = 5).
 * Callers must surface issues instead of inventing a 3-minute pomodoro.
 */
export function validateEditableTimeRange(input: {
  startAtMs: number
  endAtMs: number
  /** Minimum allowed duration in minutes (default: focusMinutesMin seed = 5). */
  minimumDurationMinutes?: number
  /** When true (default), empty/inverted ranges fail. */
  requirePositive?: boolean
}): EditableRangeValidation {
  const issues: EditableRangeIssue[] = []
  const minMinutes =
    input.minimumDurationMinutes ?? EDITABLE_RANGE_MIN_MINUTES_DEFAULT

  if (!Number.isFinite(input.startAtMs) || !Number.isFinite(input.endAtMs)) {
    issues.push({ code: 'range_not_finite', message: 'startAtMs/endAtMs must be finite epoch ms' })
    return { ok: false, issues }
  }
  if (input.endAtMs <= input.startAtMs) {
    issues.push({
      code: 'range_empty_or_inverted',
      message: 'endAtMs must be after startAtMs — refuse empty/inverted edit'
    })
    return { ok: false, issues }
  }

  const durationMs = input.endAtMs - input.startAtMs
  const durationMinutes = durationMs / MINUTE_MS

  if (!Number.isFinite(minMinutes) || minMinutes < 0) {
    issues.push({ code: 'minimum_invalid', message: 'minimumDurationMinutes must be a non-negative finite number' })
    return { ok: false, issues }
  }

  if (durationMinutes + 1e-9 < minMinutes) {
    issues.push({
      code: 'range_below_minimum',
      message: `Duration ${formatDurationLabel(durationMs)} is below minimum ${minMinutes} minutes — refuse silent short pomodoro`
    })
    return { ok: false, issues }
  }

  return { ok: true, durationMs, durationMinutes }
}

function formatDurationLabel(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / MINUTE_MS)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/**
 * Find the next local midnight at or after `atMs` in `timeZone` (absolute ms).
 */
export function nextLocalMidnightMs(
  atMs: number,
  timeZone: TimeZoneId
): { ok: true; midnightMs: number; dateKey: string } | { ok: false; code: string; message: string } {
  const projected = projectWallClock(atMs, timeZone)
  if (!projected.ok) return projected

  const { year, month, day, hour, minute, second } = projected.parts
  // If already exactly midnight, return this instant.
  if (hour === 0 && minute === 0 && second === 0) {
    return { ok: true, midnightMs: atMs, dateKey: projected.parts.dateKey }
  }

  // Resolve next calendar day 00:00:00 via UTC day roll of civil Y-M-D, then resolveLocalDateTime.
  const probeDate = new Date(Date.UTC(year, month - 1, day))
  probeDate.setUTCDate(probeDate.getUTCDate() + 1)
  const ny = probeDate.getUTCFullYear()
  const nm = probeDate.getUTCMonth() + 1
  const nd = probeDate.getUTCDate()

  const resolved = resolveLocalDateTime({
    timeZone,
    year: ny,
    month: nm,
    day: nd,
    hour: 0,
    minute: 0,
    second: 0
  })

  if (resolved.kind === 'unique') {
    return { ok: true, midnightMs: resolved.atMs, dateKey: dateKeyOf(ny, nm, nd) }
  }
  if (resolved.kind === 'ambiguous') {
    // Prefer earlier midnight mapping for day boundary.
    return { ok: true, midnightMs: resolved.earlierAtMs, dateKey: dateKeyOf(ny, nm, nd) }
  }
  if (resolved.kind === 'nonexistent') {
    return { ok: true, midnightMs: resolved.afterGapAtMs, dateKey: dateKeyOf(ny, nm, nd) }
  }
  return { ok: false, code: resolved.code, message: resolved.message }
}

/**
 * Split an absolute interval at each local midnight in `timeZone`.
 * Cross-midnight windows become multiple date blocks for week projection (§12).
 */
export function splitIntervalAtLocalMidnights(input: {
  startAtMs: number
  endAtMs: number
  timeZone: TimeZoneId
}): SplitIntervalResult {
  const duration = absoluteDurationMs(input.startAtMs, input.endAtMs)
  if (!duration.ok) {
    return { ok: false, code: duration.code, message: duration.message }
  }
  const tz = input.timeZone?.trim() ?? ''
  if (!isValidTimeZone(tz)) {
    return { ok: false, code: 'timezone_invalid', message: `Unknown or empty timeZone: ${input.timeZone}` }
  }

  const slices: DateBlockSlice[] = []
  let cursor = input.startAtMs
  // Guard against pathological loops (e.g. bad TZ data).
  const maxSlices = 400

  while (cursor < input.endAtMs && slices.length < maxSlices) {
    const wall = projectWallClock(cursor, tz)
    if (!wall.ok) {
      return { ok: false, code: wall.code, message: wall.message }
    }

    const midnight = nextLocalMidnightMs(cursor + SECOND_MS, tz)
    if (!midnight.ok) {
      return { ok: false, code: midnight.code, message: midnight.message }
    }

    // nextLocalMidnightMs(cursor+1s) is the upcoming midnight strictly after cursor when cursor is not midnight.
    // If cursor is exactly midnight, nextLocalMidnightMs returns cursor — advance to following day.
    let cut = midnight.midnightMs
    if (cut <= cursor) {
      const after = nextLocalMidnightMs(cursor + DAY_MS / 2, tz)
      if (!after.ok) {
        return { ok: false, code: after.code, message: after.message }
      }
      cut = after.midnightMs
    }

    const sliceEnd = Math.min(input.endAtMs, cut)
    if (sliceEnd <= cursor) {
      return {
        ok: false,
        code: 'split_progress_stalled',
        message: 'Could not advance past local midnight while splitting interval'
      }
    }

    const startParts = projectWallClock(cursor, tz)
    const endParts = projectWallClock(sliceEnd, tz)
    if (!startParts.ok || !endParts.ok) {
      return {
        ok: false,
        code: 'wall_clock_project_failed',
        message: 'Failed to project wall labels for date slice'
      }
    }

    // End label at exact midnight belongs to next day wall clock 00:00 —
    // for display of a half-open [start, end) day slice we show 24:00 style as 00:00 next day.
    // Prefer the wall clock at end instant (may be 00:00).
    slices.push({
      dateKey: startParts.parts.dateKey,
      startAtMs: cursor,
      endAtMs: sliceEnd,
      durationMs: sliceEnd - cursor,
      wallStartLabel: startParts.parts.timeLabel,
      wallEndLabel: endParts.parts.timeLabel,
      timeZone: tz
    })

    cursor = sliceEnd
  }

  if (cursor < input.endAtMs) {
    return {
      ok: false,
      code: 'split_too_many_slices',
      message: `Interval spans more than ${maxSlices} local days`
    }
  }

  return {
    ok: true,
    slices,
    crossedMidnight: slices.length > 1
  }
}

/**
 * Editing helper: split a schedule range that crosses local midnight into date blocks.
 * Same absolute anchors; fails closed on invalid range/zone.
 */
export function splitScheduleRangeAcrossMidnight(input: {
  startAtMs: number
  endAtMs: number
  timeZone: TimeZoneId
  /** Optional minimum per-slice minutes; slices below min get `belowMinimum: true` (still returned). */
  minimumSliceMinutes?: number
}):
  | {
      ok: true
      slices: Array<DateBlockSlice & { belowMinimum: boolean }>
      crossedMidnight: boolean
    }
  | { ok: false; code: string; message: string } {
  const split = splitIntervalAtLocalMidnights(input)
  if (!split.ok) return split

  const minMin =
    input.minimumSliceMinutes ?? EDITABLE_RANGE_MIN_MINUTES_DEFAULT

  return {
    ok: true,
    crossedMidnight: split.crossedMidnight,
    slices: split.slices.map((s) => ({
      ...s,
      belowMinimum: s.durationMs / MINUTE_MS + 1e-9 < minMin
    }))
  }
}

/**
 * Reproject absolute range wall-clock labels into a travel/destination timezone.
 * Absolute anchors + duration are preserved (reliable clock); only display labels change.
 */
export function reprojectWallClockLabels(input: {
  startAtMs: number
  endAtMs: number
  fromTimeZone: TimeZoneId
  toTimeZone: TimeZoneId
}): ReprojectWallClockResult {
  const duration = absoluteDurationMs(input.startAtMs, input.endAtMs)
  if (!duration.ok) {
    return { ok: false, code: duration.code, message: duration.message }
  }

  const fromStart = projectWallClock(input.startAtMs, input.fromTimeZone)
  const fromEnd = projectWallClock(input.endAtMs, input.fromTimeZone)
  const toStart = projectWallClock(input.startAtMs, input.toTimeZone)
  const toEnd = projectWallClock(input.endAtMs, input.toTimeZone)

  for (const r of [fromStart, fromEnd, toStart, toEnd]) {
    if (!r.ok) return { ok: false, code: r.code, message: r.message }
  }

  if (!fromStart.ok || !fromEnd.ok || !toStart.ok || !toEnd.ok) {
    return { ok: false, code: 'wall_clock_project_failed', message: 'Failed to project wall clocks' }
  }

  return {
    ok: true,
    startAtMs: input.startAtMs,
    endAtMs: input.endAtMs,
    durationMs: duration.durationMs,
    from: {
      timeZone: input.fromTimeZone.trim(),
      start: fromStart.parts,
      end: fromEnd.parts
    },
    to: {
      timeZone: input.toTimeZone.trim(),
      start: toStart.parts,
      end: toEnd.parts
    },
    startLabel: `${toStart.parts.dateKey} ${toStart.parts.timeLabel}`,
    endLabel: `${toEnd.parts.dateKey} ${toEnd.parts.timeLabel}`,
    durationLabel: formatDurationLabel(duration.durationMs)
  }
}

/**
 * Display rules helper (§12): wall-clock labels + absolute duration label.
 * - Store: absolute epoch ms (+ caller keeps timeZone)
 * - Display: local wall clock in given timeZone
 * - Duration: reliable absolute delta (not wall-clock arithmetic across DST)
 */
export function formatZonedRangeDisplay(input: {
  startAtMs: number
  endAtMs: number
  timeZone: TimeZoneId
}):
  | {
      ok: true
      startLabel: string
      endLabel: string
      dateKeys: string[]
      durationMs: number
      durationLabel: string
      crossesMidnight: boolean
    }
  | { ok: false; code: string; message: string } {
  const duration = absoluteDurationMs(input.startAtMs, input.endAtMs)
  if (!duration.ok) {
    return { ok: false, code: duration.code, message: duration.message }
  }
  const start = projectWallClock(input.startAtMs, input.timeZone)
  const end = projectWallClock(input.endAtMs, input.timeZone)
  if (!start.ok) return start
  if (!end.ok) return end

  const split = splitIntervalAtLocalMidnights({
    startAtMs: input.startAtMs,
    endAtMs: input.endAtMs,
    timeZone: input.timeZone
  })
  if (!split.ok) return split

  return {
    ok: true,
    startLabel: `${start.parts.dateKey} ${start.parts.timeLabel}`,
    endLabel: `${end.parts.dateKey} ${end.parts.timeLabel}`,
    dateKeys: split.slices.map((s) => s.dateKey),
    durationMs: duration.durationMs,
    durationLabel: formatDurationLabel(duration.durationMs),
    crossesMidnight: split.crossedMidnight
  }
}
