/**
 * STC-704: optional block timeZone + week overnight projection chips.
 */
import { describe, expect, it } from 'vitest'
import {
  isValidScheduleBlockTimeZone,
  proposalBlocksToScheduleBlocks,
  validateScheduleBlocks,
  type ScheduleBlock
} from '../../src/shared/study-planning'
import {
  formatWeekChipZoneTooltip,
  monFirstWeekdayFromDateKey,
  projectWeekZoneChips,
  sliceToDayMinutes,
  weekZoneChipToV1Schedule
} from '../../src/renderer/src/study-space/planning-week-zone-projection'
import {
  buildFocusScheduleBlockFromV1,
  projectWeekScheduleEntries
} from '../../src/renderer/src/study-space/planning-schedule-block-adapter'
import { monFirstScheduleToIntervalMs } from '../../src/shared/study-planning'

const SH = 'Asia/Shanghai'
const NY = 'America/New_York'

function focusBlock(
  partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'taskId' | 'startAtMs' | 'endAtMs'>
): ScheduleBlock {
  return {
    kind: 'focus',
    locked: false,
    source: 'manual',
    status: 'planned',
    revision: 1,
    ...partial
  }
}

describe('ScheduleBlock optional timeZone (STC-704 wire)', () => {
  it('accepts valid optional timeZone and rejects garbage ids', () => {
    expect(isValidScheduleBlockTimeZone(SH)).toBe(true)
    expect(isValidScheduleBlockTimeZone('Not/A_Real_Zone')).toBe(false)
    expect(isValidScheduleBlockTimeZone('')).toBe(false)

    const ok = validateScheduleBlocks([
      focusBlock({
        id: 'b1',
        taskId: 't1',
        startAtMs: 1_000,
        endAtMs: 2_000,
        timeZone: SH
      })
    ])
    expect(ok.ok).toBe(true)

    const bad = validateScheduleBlocks([
      focusBlock({
        id: 'b2',
        taskId: 't1',
        startAtMs: 1_000,
        endAtMs: 2_000,
        timeZone: 'Fake/Zone'
      })
    ])
    expect(bad.ok).toBe(false)
    expect(bad.issues.some((i) => i.code === 'block_timezone_invalid')).toBe(true)
  })

  it('stamps timeZone on proposal drafts when provided', () => {
    const drafts = proposalBlocksToScheduleBlocks({
      blocks: [
        {
          kind: 'focus',
          startAtMs: Date.parse('2026-07-21T01:00:00.000Z'),
          endAtMs: Date.parse('2026-07-21T02:00:00.000Z'),
          taskId: 't1'
        }
      ],
      timeZone: SH,
      idPrefix: 'p'
    })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.timeZone).toBe(SH)
  })

  it('omits invalid stamp zone instead of writing garbage', () => {
    const drafts = proposalBlocksToScheduleBlocks({
      blocks: [
        {
          kind: 'focus',
          startAtMs: 1_000,
          endAtMs: 3_600_000,
          taskId: 't1'
        }
      ],
      timeZone: 'Nope/Zone'
    })
    expect(drafts[0]?.timeZone).toBeUndefined()
  })
})

describe('week zone pure helpers', () => {
  it('maps dateKey to Mon-first weekday in zone', () => {
    // 2026-07-21 is Tuesday
    expect(monFirstWeekdayFromDateKey('2026-07-21', SH)).toBe(1)
    // 2026-07-20 is Monday
    expect(monFirstWeekdayFromDateKey('2026-07-20', SH)).toBe(0)
  })

  it('maps midnight-end slice to endMinutes 24*60', () => {
    const minutes = sliceToDayMinutes({
      dateKey: '2026-07-21',
      startAtMs: Date.parse('2026-07-21T14:00:00.000Z'),
      endAtMs: Date.parse('2026-07-21T16:00:00.000Z'),
      durationMs: 2 * 60 * 60_000,
      wallStartLabel: '22:00',
      wallEndLabel: '00:00',
      timeZone: SH
    })
    expect(minutes).toEqual({ startMinutes: 22 * 60, endMinutes: 24 * 60 })
  })
})

describe('projectWeekZoneChips overnight SH 22-02 → two chips', () => {
  it('splits Asia/Shanghai overnight focus into two weekday chips', () => {
    // Asia/Shanghai: 2026-07-21 22:00 – 2026-07-22 02:00 local
    // = 2026-07-21 14:00Z – 2026-07-21 18:00Z
    const startAtMs = Date.parse('2026-07-21T14:00:00.000Z')
    const endAtMs = Date.parse('2026-07-21T18:00:00.000Z')
    const block = focusBlock({
      id: 'overnight-1',
      taskId: 't1',
      startAtMs,
      endAtMs,
      timeZone: SH
    })

    const result = projectWeekZoneChips({
      blocks: [block],
      hostTimeZone: SH,
      focusOnly: true
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.chips).toHaveLength(2)

    const [first, second] = result.chips
    expect(first.dateKey).toBe('2026-07-21')
    expect(first.weekday).toBe(1) // Tuesday
    expect(first.startMinutes).toBe(22 * 60)
    expect(first.endMinutes).toBe(24 * 60)
    expect(first.wallStartLabel).toBe('22:00')
    expect(first.crossedMidnight).toBe(true)
    expect(first.sliceIndex).toBe(0)
    expect(first.sliceCount).toBe(2)
    expect(first.durationMs).toBe(2 * 60 * 60_000)

    expect(second.dateKey).toBe('2026-07-22')
    expect(second.weekday).toBe(2) // Wednesday
    expect(second.startMinutes).toBe(0)
    expect(second.endMinutes).toBe(2 * 60)
    expect(second.wallStartLabel).toBe('00:00')
    expect(second.wallEndLabel).toBe('02:00')
    expect(second.sliceIndex).toBe(1)
    expect(second.durationMs).toBe(2 * 60 * 60_000)

    // Absolute anchors preserved across slices
    expect(first.startAtMs).toBe(startAtMs)
    expect(second.endAtMs).toBe(endAtMs)
    expect(first.endAtMs).toBe(second.startAtMs)

    const v1a = weekZoneChipToV1Schedule(first)
    expect(v1a).toEqual({
      weekday: 1,
      startMinutes: 22 * 60,
      endMinutes: 24 * 60
    })
  })

  it('same-day window stays single chip', () => {
    const startAtMs = Date.parse('2026-07-21T01:00:00.000Z') // 09:00 SH
    const endAtMs = Date.parse('2026-07-21T04:00:00.000Z') // 12:00 SH
    const result = projectWeekZoneChips({
      blocks: [
        focusBlock({
          id: 'same',
          taskId: 't1',
          startAtMs,
          endAtMs,
          timeZone: SH
        })
      ],
      hostTimeZone: SH
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chips).toHaveLength(1)
    expect(result.chips[0]?.crossedMidnight).toBe(false)
    expect(result.chips[0]?.startMinutes).toBe(9 * 60)
    expect(result.chips[0]?.endMinutes).toBe(12 * 60)
  })

  it('zone mismatch builds labels-only host reproject tooltip', () => {
    // SH 09:00–10:00 = 01:00–02:00Z; host NY will show different wall labels
    const startAtMs = Date.parse('2026-07-21T01:00:00.000Z')
    const endAtMs = Date.parse('2026-07-21T02:00:00.000Z')
    const result = projectWeekZoneChips({
      blocks: [
        focusBlock({
          id: 'travel',
          taskId: 't1',
          startAtMs,
          endAtMs,
          timeZone: SH
        })
      ],
      hostTimeZone: NY
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chips).toHaveLength(1)
    const chip = result.chips[0]!
    expect(chip.zoneMismatch).toBe(true)
    expect(chip.blockTimeZone).toBe(SH)
    expect(chip.hostTimeZone).toBe(NY)
    expect(chip.display?.hostReprojectLabel).toBeTruthy()
    const tip = formatWeekChipZoneTooltip(chip)
    expect(tip).toContain('块时区')
    expect(tip).toContain(SH)
  })
})

describe('adapter projectWeekScheduleEntries overnight', () => {
  it('emits two week entries for overnight SH block (no longer drops)', () => {
    const startAtMs = Date.parse('2026-07-21T14:00:00.000Z')
    const endAtMs = Date.parse('2026-07-21T18:00:00.000Z')
    const entries = projectWeekScheduleEntries({
      tasks: [{ id: 't1', title: '通宵', done: false, categoryId: 'study' }],
      scheduleBlocks: [
        focusBlock({
          id: 'b-overnight',
          taskId: 't1',
          startAtMs,
          endAtMs,
          timeZone: SH
        })
      ],
      nowMs: Date.parse('2026-07-21T08:00:00.000Z'),
      hostTimeZone: SH
    })
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.blockId === 'b-overnight')).toBe(true)
    expect(entries.every((e) => e.taskId === 't1')).toBe(true)
    // One primary only (first slice)
    expect(entries.filter((e) => e.isPrimary)).toHaveLength(1)
    expect(entries.map((e) => e.sliceIndex).sort()).toEqual([0, 1])
    const tue = entries.find((e) => e.schedule.weekday === 1)
    const wed = entries.find((e) => e.schedule.weekday === 2)
    expect(tue?.schedule.startMinutes).toBe(22 * 60)
    expect(tue?.schedule.endMinutes).toBe(24 * 60)
    expect(wed?.schedule.startMinutes).toBe(0)
    expect(wed?.schedule.endMinutes).toBe(2 * 60)
  })

  it('stamps host timeZone on buildFocusScheduleBlockFromV1 create', () => {
    const WEEK_ANCHOR = Date.UTC(2026, 6, 19) // Sun
    const built = buildFocusScheduleBlockFromV1({
      taskId: 't1',
      schedule: { weekday: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 },
      weekAnchorMidnightMs: WEEK_ANCHOR,
      blockId: 'block:t1:v1',
      existing: null,
      hostTimeZone: SH
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.block.timeZone).toBe(SH)
    const interval = monFirstScheduleToIntervalMs({
      weekday: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      weekAnchorMidnightMs: WEEK_ANCHOR
    })
    expect(built.block.startAtMs).toBe(interval!.startAtMs)
  })

  it('preserves existing block timeZone over host stamp', () => {
    const WEEK_ANCHOR = Date.UTC(2026, 6, 19)
    const existing = focusBlock({
      id: 'b1',
      taskId: 't1',
      startAtMs: 1,
      endAtMs: 2,
      timeZone: NY,
      revision: 3
    })
    const built = buildFocusScheduleBlockFromV1({
      taskId: 't1',
      schedule: { weekday: 1, startMinutes: 10 * 60, endMinutes: 11 * 60 },
      weekAnchorMidnightMs: WEEK_ANCHOR,
      blockId: 'b1',
      existing,
      hostTimeZone: SH
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.block.timeZone).toBe(NY)
  })
})
