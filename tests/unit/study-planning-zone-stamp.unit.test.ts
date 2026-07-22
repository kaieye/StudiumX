/**
 * STC-704 residual: allocation/store zone stamp on create; preserve on update.
 * No travel settings; no silent whole-week rezone.
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
import {
  buildApplyAllocationProposalCommand
} from '../../src/renderer/src/study-space/planning-allocation-dual-write'
import {
  buildAllocationProposalDualWriteInput,
  resolveOptionalHostTimeZoneForAllocationStamp
} from '../../src/renderer/src/study-space/session/useStudySession'

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

describe('StudyPlanningStore apply_allocation_proposal stamps host zone on create', () => {
  it('stamps hostTimeZone on newly appended blocks only', () => {
    const store = new StudyPlanningStore({ nowMs: () => NOW })
    const r = store.applyCommand(
      {
        actionId: 'alloc-zone-1',
        type: 'apply_allocation_proposal',
        payload: {
          planId: 'classic_25_5',
          idPrefix: 'zalloc',
          hostTimeZone: SH,
          blocks: [
            {
              kind: 'focus',
              startAtMs: NOW + 60_000,
              endAtMs: NOW + 30 * 60_000,
              taskId: 'y'
            }
          ]
        }
      },
      1
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const added = r.snapshot.scheduleBlocks.filter((b) => b.id.startsWith('zalloc'))
    expect(added).toHaveLength(1)
    expect(added[0]?.timeZone).toBe(SH)
  })

  it('does not rewrite existing blocks when applying allocation (append-only)', () => {
    const store = new StudyPlanningStore({ nowMs: () => NOW })
    const seed = store.applyCommand(
      {
        actionId: 'seed-ny',
        type: 'upsert_schedule_block',
        payload: {
          block: focus({
            id: 'existing-ny',
            startAtMs: NOW - 2 * 60 * 60_000,
            endAtMs: NOW - 60 * 60_000,
            timeZone: NY
          })
        }
      },
      1
    )
    expect(seed.ok).toBe(true)
    if (!seed.ok) return

    const applied = store.applyCommand(
      {
        actionId: 'alloc-after-seed',
        type: 'apply_allocation_proposal',
        payload: {
          hostTimeZone: SH,
          idPrefix: 'new',
          blocks: [
            {
              kind: 'focus',
              startAtMs: NOW + 60_000,
              endAtMs: NOW + 40 * 60_000,
              taskId: 'y'
            }
          ]
        }
      },
      seed.revision
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const existing = applied.snapshot.scheduleBlocks.find((b) => b.id === 'existing-ny')
    expect(existing?.timeZone).toBe(NY)
    const created = applied.snapshot.scheduleBlocks.find((b) => b.id.startsWith('new'))
    expect(created?.timeZone).toBe(SH)
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

describe('buildApplyAllocationProposalCommand payload zone field', () => {
  it('includes hostTimeZone when provided', () => {
    const cmd = buildApplyAllocationProposalCommand(
      {
        blocks: [
          {
            kind: 'focus',
            startAtMs: NOW,
            endAtMs: NOW + 25 * 60_000,
            taskId: 't1'
          }
        ],
        planId: 'classic_25_5',
        idPrefix: 'alloc-z',
        hostTimeZone: SH
      },
      'aid-z',
      99
    )
    expect(cmd.payload).toMatchObject({
      planId: 'classic_25_5',
      idPrefix: 'alloc-z',
      hostTimeZone: SH
    })
  })

  it('omits hostTimeZone when not provided', () => {
    const cmd = buildApplyAllocationProposalCommand(
      {
        blocks: [
          {
            kind: 'focus',
            startAtMs: NOW,
            endAtMs: NOW + 25 * 60_000,
            taskId: 't1'
          }
        ],
        idPrefix: 'alloc-plain'
      },
      'aid-plain'
    )
    expect((cmd.payload as { hostTimeZone?: string }).hostTimeZone).toBeUndefined()
  })
})

describe('host glue: applyAllocationProposal stamps hostTimeZone (STC-704 IMPL-O)', () => {
  it('buildAllocationProposalDualWriteInput passes hostTimeZone when resolver returns zone', () => {
    const input = buildAllocationProposalDualWriteInput(
      {
        blocks: [
          {
            kind: 'focus',
            startAtMs: NOW,
            endAtMs: NOW + 25 * 60_000,
            taskId: 't1'
          }
        ],
        planId: 'classic_25_5',
        planRevision: 2,
        idPrefix: 'alloc-host'
      },
      () => SH
    )
    expect(input).toMatchObject({
      planId: 'classic_25_5',
      planRevision: 2,
      idPrefix: 'alloc-host',
      hostTimeZone: SH
    })
    expect(input.blocks).toHaveLength(1)
  })

  it('omits hostTimeZone when resolver returns undefined (fail soft / Intl unavailable)', () => {
    const input = buildAllocationProposalDualWriteInput(
      {
        blocks: [
          {
            kind: 'focus',
            startAtMs: NOW,
            endAtMs: NOW + 25 * 60_000,
            taskId: 't1'
          }
        ],
        idPrefix: 'alloc-no-zone'
      },
      () => undefined
    )
    expect(input.hostTimeZone).toBeUndefined()
    expect('hostTimeZone' in input).toBe(false)
  })

  it('omits hostTimeZone when resolver returns empty string', () => {
    const input = buildAllocationProposalDualWriteInput(
      {
        blocks: [
          {
            kind: 'focus',
            startAtMs: NOW,
            endAtMs: NOW + 25 * 60_000
          }
        ]
      },
      () => '   '
    )
    // empty after trim is falsy → omit
    expect(input.hostTimeZone).toBeUndefined()
  })

  it('dual-write command from host glue includes hostTimeZone for NEW block stamp only', () => {
    const dualArgs = buildAllocationProposalDualWriteInput(
      {
        blocks: [
          {
            kind: 'focus',
            startAtMs: NOW,
            endAtMs: NOW + 25 * 60_000,
            taskId: 't1'
          }
        ],
        planId: 'classic_25_5',
        idPrefix: 'alloc-wire'
      },
      () => NY
    )
    const cmd = buildApplyAllocationProposalCommand(dualArgs, 'aid-host-wire', 42)
    expect(cmd.payload).toMatchObject({
      planId: 'classic_25_5',
      idPrefix: 'alloc-wire',
      hostTimeZone: NY
    })
  })

  it('resolveOptionalHostTimeZoneForAllocationStamp returns string or undefined (no throw)', () => {
    const zone = resolveOptionalHostTimeZoneForAllocationStamp()
    if (zone !== undefined) {
      expect(typeof zone).toBe('string')
      expect(zone.trim().length).toBeGreaterThan(0)
    } else {
      expect(zone).toBeUndefined()
    }
  })
})

