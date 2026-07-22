/**
 * Zone stamp on create / preserve on update (optional block timeZone write policy).
 * Travel-settings product + allocation-proposal product removed 2026-07-22.
 * No silent whole-week rezone.
 */
import { describe, expect, it } from 'vitest'
import {
  StudyPlanningStore,
  type ScheduleBlock
} from '../../src/shared/study-planning'
import {
  normalizeScheduleBlockTimeZoneStamp,
  proposalBlocksToScheduleBlocks,
  resolveScheduleBlockTimeZoneOnWrite
} from '../../src/shared/study-planning/schedule-block'

const SH = 'Asia/Shanghai'
const NY = 'America/New_York'
const NOW = Date.UTC(2026, 6, 21, 2, 0, 0) // 10:00 SH

function focus(
  partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'startAtMs' | 'endAtMs'>
): ScheduleBlock {
  return {
    taskId: 't1',
    kind: 'focus',
    locked: false,
    source: 'manual',
    status: 'planned',
    revision: 1,
    ...partial
  }
}

describe('normalizeScheduleBlockTimeZoneStamp', () => {
  it('accepts valid IANA and trims', () => {
    expect(normalizeScheduleBlockTimeZoneStamp(`  ${SH}  `)).toBe(SH)
  })
  it('rejects invalid / empty', () => {
    expect(normalizeScheduleBlockTimeZoneStamp('Nope/Zone')).toBeUndefined()
    expect(normalizeScheduleBlockTimeZoneStamp('')).toBeUndefined()
    expect(normalizeScheduleBlockTimeZoneStamp(null)).toBeUndefined()
    expect(normalizeScheduleBlockTimeZoneStamp(undefined)).toBeUndefined()
  })
})

describe('resolveScheduleBlockTimeZoneOnWrite (no silent rezone)', () => {
  it('preserves existing zone over host and incoming', () => {
    expect(
      resolveScheduleBlockTimeZoneOnWrite({
        existingTimeZone: NY,
        incomingTimeZone: SH,
        hostTimeZone: SH
      })
    ).toBe(NY)
  })

  it('stamps host when existing has none', () => {
    expect(
      resolveScheduleBlockTimeZoneOnWrite({
        existingTimeZone: undefined,
        incomingTimeZone: undefined,
        hostTimeZone: SH
      })
    ).toBe(SH)
  })

  it('prefers valid incoming over host when existing absent', () => {
    expect(
      resolveScheduleBlockTimeZoneOnWrite({
        existingTimeZone: null,
        incomingTimeZone: NY,
        hostTimeZone: SH
      })
    ).toBe(NY)
  })

  it('ignores invalid host stamp', () => {
    expect(
      resolveScheduleBlockTimeZoneOnWrite({
        hostTimeZone: 'Fake/Zone'
      })
    ).toBeUndefined()
  })
})

describe('proposalBlocksToScheduleBlocks host stamp', () => {
  it('stamps via timeZone field', () => {
    const drafts = proposalBlocksToScheduleBlocks({
      blocks: [
        {
          kind: 'focus',
          startAtMs: NOW,
          endAtMs: NOW + 25 * 60_000,
          taskId: 't1'
        }
      ],
      timeZone: SH,
      idPrefix: 'p'
    })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.timeZone).toBe(SH)
  })

  it('stamps via hostTimeZone alias', () => {
    const drafts = proposalBlocksToScheduleBlocks({
      blocks: [
        {
          kind: 'focus',
          startAtMs: NOW,
          endAtMs: NOW + 25 * 60_000,
          taskId: 't1'
        }
      ],
      hostTimeZone: NY,
      idPrefix: 'h'
    })
    expect(drafts[0]?.timeZone).toBe(NY)
  })

  it('omits zone when stamp absent or invalid', () => {
    const bare = proposalBlocksToScheduleBlocks({
      blocks: [{ kind: 'focus', startAtMs: NOW, endAtMs: NOW + 1_000, taskId: 't1' }]
    })
    expect(bare[0]?.timeZone).toBeUndefined()

    const bad = proposalBlocksToScheduleBlocks({
      blocks: [{ kind: 'focus', startAtMs: NOW, endAtMs: NOW + 1_000, taskId: 't1' }],
      hostTimeZone: 'Not/A/Zone'
    })
    expect(bad[0]?.timeZone).toBeUndefined()
  })
})

describe('StudyPlanningStore upsert_schedule_block preserves zone (no silent rezone)', () => {
  it('preserves existing timeZone when update omits or passes a different host stamp', () => {
    const store = new StudyPlanningStore({ nowMs: () => NOW })
    const create = store.applyCommand(
      {
        actionId: 'create-ny',
        type: 'upsert_schedule_block',
        payload: {
          block: focus({
            id: 'b-preserve',
            startAtMs: NOW,
            endAtMs: NOW + 60 * 60_000,
            timeZone: NY
          })
        }
      },
      1
    )
    expect(create.ok).toBe(true)
    if (!create.ok) return

    const update = store.applyCommand(
      {
        actionId: 'update-attempt-rezone',
        type: 'upsert_schedule_block',
        payload: {
          hostTimeZone: SH,
          block: focus({
            id: 'b-preserve',
            startAtMs: NOW + 5 * 60_000,
            endAtMs: NOW + 65 * 60_000,
            revision: 2,
            // attacker / host tries to overwrite zone
            timeZone: SH
          })
        }
      },
      create.revision
    )
    expect(update.ok).toBe(true)
    if (!update.ok) return
    const block = update.snapshot.scheduleBlocks.find((b) => b.id === 'b-preserve')
    expect(block?.timeZone).toBe(NY)
    expect(block?.startAtMs).toBe(NOW + 5 * 60_000)
  })

  it('stamps host zone on create when block has no zone', () => {
    const store = new StudyPlanningStore({ nowMs: () => NOW })
    const create = store.applyCommand(
      {
        actionId: 'create-stamp',
        type: 'upsert_schedule_block',
        payload: {
          hostTimeZone: SH,
          block: focus({
            id: 'b-new',
            startAtMs: NOW,
            endAtMs: NOW + 30 * 60_000
            // no timeZone on block
          })
        }
      },
      1
    )
    expect(create.ok).toBe(true)
    if (!create.ok) return
    const block = create.snapshot.scheduleBlocks.find((b) => b.id === 'b-new')
    expect(block?.timeZone).toBe(SH)
  })

  it('does not invent zone when host stamp absent', () => {
    const store = new StudyPlanningStore({ nowMs: () => NOW })
    const create = store.applyCommand(
      {
        actionId: 'create-bare',
        type: 'upsert_schedule_block',
        payload: {
          block: focus({
            id: 'b-bare',
            startAtMs: NOW,
            endAtMs: NOW + 15 * 60_000
          })
        }
      },
      1
    )
    expect(create.ok).toBe(true)
    if (!create.ok) return
    expect(create.snapshot.scheduleBlocks[0]?.timeZone).toBeUndefined()
  })
})

describe('resolveScheduleBlockTimeZoneOnWrite confirmOverwrite (IMPL-T)', () => {
  it('overwrites existing only when confirmOverwriteTimeZone is true', () => {
    expect(
      resolveScheduleBlockTimeZoneOnWrite({
        existingTimeZone: NY,
        incomingTimeZone: SH,
        confirmOverwriteTimeZone: true
      })
    ).toBe(SH)
  })
})

