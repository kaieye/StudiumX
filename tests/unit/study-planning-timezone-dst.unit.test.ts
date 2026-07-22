/**
 * STC-704: cross-day / timezone travel / DST advanced editing (pure domain).
 */
import { describe, expect, it } from 'vitest'
import {
  absoluteDurationMs,
  formatZonedRangeDisplay,
  getUtcOffsetMinutes,
  projectWallClock,
  reprojectWallClockLabels,
  resolveLocalDateTime,
  splitIntervalAtLocalMidnights,
  splitScheduleRangeAcrossMidnight,
  validateEditableTimeRange
} from '../../src/shared/study-planning/timezone-dst-editing'

const NY = 'America/New_York'
const SH = 'Asia/Shanghai'
const UTC = 'UTC'

describe('STC-704 wall-clock projection & absolute duration', () => {
  it('projects absolute instants to local wall clock in a timezone', () => {
    // 2026-07-21 01:00Z = 09:00 Asia/Shanghai (UTC+8)
    const atMs = Date.parse('2026-07-21T01:00:00.000Z')
    const proj = projectWallClock(atMs, SH)
    expect(proj.ok).toBe(true)
    if (!proj.ok) return
    expect(proj.parts.dateKey).toBe('2026-07-21')
    expect(proj.parts.timeLabel).toBe('09:00')
    expect(proj.parts.offsetMinutes).toBe(480)
    expect(getUtcOffsetMinutes(atMs, SH)).toBe(480)
  })

  it('fails closed on invalid timezone / non-finite instant', () => {
    expect(projectWallClock(1_000, 'Not/A_Zone').ok).toBe(false)
    expect(projectWallClock(Number.NaN, UTC).ok).toBe(false)
  })

  it('computes duration via reliable absolute clock (end - start)', () => {
    const start = Date.parse('2026-03-08T05:00:00.000Z')
    const end = Date.parse('2026-03-08T08:00:00.000Z')
    const d = absoluteDurationMs(start, end)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.durationMs).toBe(3 * 60 * 60_000)
  })

  it('refuses empty/inverted ranges', () => {
    const same = absoluteDurationMs(100, 100)
    expect(same.ok).toBe(false)
    if (same.ok) return
    expect(same.code).toBe('range_empty_or_inverted')

    const inv = absoluteDurationMs(200, 100)
    expect(inv.ok).toBe(false)
  })
})

describe('STC-704 cross-midnight split for week projection', () => {
  it('splits a window that crosses local midnight into two date blocks', () => {
    // Asia/Shanghai: 2026-07-21 22:00 – 2026-07-22 02:00 local
    // = 2026-07-21 14:00Z – 2026-07-21 18:00Z
    const startAtMs = Date.parse('2026-07-21T14:00:00.000Z')
    const endAtMs = Date.parse('2026-07-21T18:00:00.000Z')

    const split = splitIntervalAtLocalMidnights({ startAtMs, endAtMs, timeZone: SH })
    expect(split.ok).toBe(true)
    if (!split.ok) return

    expect(split.crossedMidnight).toBe(true)
    expect(split.slices).toHaveLength(2)

    expect(split.slices[0].dateKey).toBe('2026-07-21')
    expect(split.slices[0].wallStartLabel).toBe('22:00')
    expect(split.slices[0].wallEndLabel).toBe('00:00')
    expect(split.slices[0].durationMs).toBe(2 * 60 * 60_000)

    expect(split.slices[1].dateKey).toBe('2026-07-22')
    expect(split.slices[1].wallStartLabel).toBe('00:00')
    expect(split.slices[1].wallEndLabel).toBe('02:00')
    expect(split.slices[1].durationMs).toBe(2 * 60 * 60_000)

    // Absolute anchors preserved
    expect(split.slices[0].startAtMs).toBe(startAtMs)
    expect(split.slices[1].endAtMs).toBe(endAtMs)
    expect(split.slices[0].endAtMs).toBe(split.slices[1].startAtMs)
  })

  it('does not split a same-day window', () => {
    const startAtMs = Date.parse('2026-07-21T01:00:00.000Z') // 09:00 SH
    const endAtMs = Date.parse('2026-07-21T04:00:00.000Z') // 12:00 SH
    const split = splitIntervalAtLocalMidnights({ startAtMs, endAtMs, timeZone: SH })
    expect(split.ok).toBe(true)
    if (!split.ok) return
    expect(split.crossedMidnight).toBe(false)
    expect(split.slices).toHaveLength(1)
    expect(split.slices[0].dateKey).toBe('2026-07-21')
    expect(split.slices[0].wallStartLabel).toBe('09:00')
    expect(split.slices[0].wallEndLabel).toBe('12:00')
  })

  it('marks below-minimum slices when editing across midnight (no silent 3-min pomodoro)', () => {
    // SH: 23:58 – 00:01 → 2 minutes on day1, 1 minute on day2 — both below default min 5
    const startAtMs = Date.parse('2026-07-21T15:58:00.000Z')
    const endAtMs = Date.parse('2026-07-21T16:01:00.000Z')
    const split = splitScheduleRangeAcrossMidnight({
      startAtMs,
      endAtMs,
      timeZone: SH,
      minimumSliceMinutes: 5
    })
    expect(split.ok).toBe(true)
    if (!split.ok) return
    expect(split.crossedMidnight).toBe(true)
    expect(split.slices.every((s) => s.belowMinimum)).toBe(true)

    // Parent range itself also fails validateEditableTimeRange at min=5
    const v = validateEditableTimeRange({ startAtMs, endAtMs, minimumDurationMinutes: 5 })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.issues.some((i) => i.code === 'range_below_minimum')).toBe(true)
  })
})

describe('STC-704 DST transitions', () => {
  it('detects nonexistent local time on spring-forward (America/New_York 2026-03-08 02:30)', () => {
    const res = resolveLocalDateTime({
      timeZone: NY,
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
      second: 0
    })
    expect(res.kind).toBe('nonexistent')
    if (res.kind !== 'nonexistent') return
    // After gap local is 03:00 EDT = 07:00Z
    const after = projectWallClock(res.afterGapAtMs, NY)
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.parts.hour).toBeGreaterThanOrEqual(3)
  })

  it('detects ambiguous local time on fall-back (America/New_York 2026-11-01 01:30)', () => {
    const res = resolveLocalDateTime({
      timeZone: NY,
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30,
      second: 0
    })
    expect(res.kind).toBe('ambiguous')
    if (res.kind !== 'ambiguous') return
    expect(res.earlierAtMs).toBe(Date.parse('2026-11-01T05:30:00.000Z')) // EDT UTC-4
    expect(res.laterAtMs).toBe(Date.parse('2026-11-01T06:30:00.000Z')) // EST UTC-5
    expect(res.earlierOffsetMinutes).toBe(-240)
    expect(res.laterOffsetMinutes).toBe(-300)
  })

  it('uses absolute duration across spring-forward (wall 1h, absolute 1h still when anchors absolute)', () => {
    // Local NY 2026-03-08 01:00 EST → 03:00 EDT is 1 wall-clock hour jump but absolute span:
    // 01:00 EST = 06:00Z, 03:00 EDT = 07:00Z → absolute 1h
    const start = Date.parse('2026-03-08T06:00:00.000Z')
    const end = Date.parse('2026-03-08T07:00:00.000Z')
    const d = absoluteDurationMs(start, end)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.durationMs).toBe(60 * 60_000)

    const display = formatZonedRangeDisplay({ startAtMs: start, endAtMs: end, timeZone: NY })
    expect(display.ok).toBe(true)
    if (!display.ok) return
    expect(display.durationMs).toBe(60 * 60_000)
    expect(display.startLabel).toContain('01:00')
    expect(display.endLabel).toContain('03:00')
  })

  it('uses absolute duration across fall-back (wall 1h labels, absolute 2h)', () => {
    // Local NY 2026-11-01 01:00 EDT → 01:00 EST next occurrence + 1h:
    // 01:00 EDT = 05:00Z, 02:00 EST = 07:00Z → absolute 2h while wall ends at 02:00
    const start = Date.parse('2026-11-01T05:00:00.000Z')
    const end = Date.parse('2026-11-01T07:00:00.000Z')
    const d = absoluteDurationMs(start, end)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.durationMs).toBe(2 * 60 * 60_000)

    const display = formatZonedRangeDisplay({ startAtMs: start, endAtMs: end, timeZone: NY })
    expect(display.ok).toBe(true)
    if (!display.ok) return
    expect(display.durationMs).toBe(2 * 60 * 60_000)
    // wall start 01:00, wall end 02:00 (EST)
    expect(display.startLabel).toContain('01:00')
    expect(display.endLabel).toContain('02:00')
  })

  it('resolves unique local times', () => {
    const res = resolveLocalDateTime({
      timeZone: SH,
      year: 2026,
      month: 7,
      day: 21,
      hour: 9,
      minute: 0
    })
    expect(res.kind).toBe('unique')
    if (res.kind !== 'unique') return
    expect(res.atMs).toBe(Date.parse('2026-07-21T01:00:00.000Z'))
    expect(res.offsetMinutes).toBe(480)
  })
})

describe('STC-704 reproject wall-clock labels (timezone travel)', () => {
  it('keeps absolute anchors and duration while changing display zone', () => {
    // 09:00–12:00 Shanghai = 01:00–04:00 UTC = 21:00–00:00 previous evening in NY (prev day)
    const startAtMs = Date.parse('2026-07-21T01:00:00.000Z')
    const endAtMs = Date.parse('2026-07-21T04:00:00.000Z')

    const reproj = reprojectWallClockLabels({
      startAtMs,
      endAtMs,
      fromTimeZone: SH,
      toTimeZone: NY
    })
    expect(reproj.ok).toBe(true)
    if (!reproj.ok) return

    expect(reproj.startAtMs).toBe(startAtMs)
    expect(reproj.endAtMs).toBe(endAtMs)
    expect(reproj.durationMs).toBe(3 * 60 * 60_000)
    expect(reproj.from.start.timeLabel).toBe('09:00')
    expect(reproj.from.end.timeLabel).toBe('12:00')
    // NY is EDT (UTC-4) in July → 21:00 previous calendar day through 00:00
    expect(reproj.to.start.timeLabel).toBe('21:00')
    expect(reproj.to.end.timeLabel).toBe('00:00')
  })
})

describe('STC-704 fail-closed editing validation', () => {
  it('refuses silent 3-minute pomodoro under default 5-minute minimum', () => {
    const start = Date.parse('2026-07-21T01:00:00.000Z')
    const end = start + 3 * 60_000
    const v = validateEditableTimeRange({ startAtMs: start, endAtMs: end })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.issues.map((i) => i.code)).toContain('range_below_minimum')
  })

  it('accepts ranges at or above minimum', () => {
    const start = Date.parse('2026-07-21T01:00:00.000Z')
    const end = start + 25 * 60_000
    const v = validateEditableTimeRange({ startAtMs: start, endAtMs: end })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.durationMinutes).toBe(25)
  })

  it('formatZonedRangeDisplay reports date keys for cross-midnight ranges', () => {
    const startAtMs = Date.parse('2026-07-21T14:00:00.000Z')
    const endAtMs = Date.parse('2026-07-21T18:00:00.000Z')
    const disp = formatZonedRangeDisplay({ startAtMs, endAtMs, timeZone: SH })
    expect(disp.ok).toBe(true)
    if (!disp.ok) return
    expect(disp.crossesMidnight).toBe(true)
    expect(disp.dateKeys).toEqual(['2026-07-21', '2026-07-22'])
    expect(disp.durationMs).toBe(4 * 60 * 60_000)
  })
})
