/**
 * STC-307: ScheduleBlock week adapter + dual-write by real block id.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildFocusScheduleBlockFromV1,
  defaultV1ScheduleBlockId,
  listActiveFocusBlocksForTask,
  projectWeekScheduleEntries,
  projectWeekScheduleEntriesFromHost,
  resolveFocusBlockIdForScheduleUpsert
} from '../../src/renderer/src/study-space/planning-schedule-block-adapter'
import {
  dualWriteUpsertScheduleFromV1,
  type CanonicalPlanningContext
} from '../../src/renderer/src/study-space/planning-dual-write'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  monFirstScheduleToIntervalMs,
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  type ScheduleBlock,
  type StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'

const WEEK_ANCHOR = Date.UTC(2026, 6, 19) // Sun 2026-07-19 UTC (getUTCDay=0)
const NOW = Date.UTC(2026, 6, 21, 12, 0, 0) // Tue noon

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

function emptySnapshot(revision = 1, blocks: ScheduleBlock[] = []): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: NOW,
    tasks: [],
    scheduleBlocks: blocks,
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
}

function mockApi(snapshot: StudyPlanningSnapshotV1): {
  api: StudyPlanningApi
  applied: unknown[]
} {
  const applied: unknown[] = []
  let current = snapshot
  const api: StudyPlanningApi = {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot: current,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: vi.fn(async (payload) => {
      applied.push(payload)
      const block = (payload as { command: { payload: { block: ScheduleBlock } } }).command.payload.block
      const without = current.scheduleBlocks.filter((b) => b.id !== block.id)
      current = {
        ...current,
        revision: current.revision + 1,
        updatedAtMs: NOW + current.revision,
        scheduleBlocks: [...without, block]
      }
      return {
        ok: true as const,
        revision: current.revision,
        snapshot: current,
        effects: [{ type: 'schedule_blocks_applied' as const, count: 1 }],
        path: '/ws/.studiumx/study-planning/snapshot.json'
      }
    })
  }
  return { api, applied }
}

describe('resolveFocusBlockIdForScheduleUpsert', () => {
  it('uses preferred block id when provided', () => {
    const blocks = [
      focusBlock({
        id: 'migrated-block-t1',
        taskId: 't1',
        startAtMs: NOW,
        endAtMs: NOW + 3_600_000
      })
    ]
    expect(resolveFocusBlockIdForScheduleUpsert(blocks, 't1', NOW, 'block-explicit')).toBe(
      'block-explicit'
    )
  })

  it('prefers primary (next future) over default :v1', () => {
    const mon = monFirstScheduleToIntervalMs({
      weekday: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      weekAnchorMidnightMs: WEEK_ANCHOR
    })!
    const wed = monFirstScheduleToIntervalMs({
      weekday: 2,
      startMinutes: 14 * 60,
      endMinutes: 15 * 60,
      weekAnchorMidnightMs: WEEK_ANCHOR
    })!
    // NOW is Tuesday; Monday past, Wednesday future → primary = Wednesday
    const blocks = [
      focusBlock({
        id: 'block:t1:v1',
        taskId: 't1',
        startAtMs: mon.startAtMs,
        endAtMs: mon.endAtMs
      }),
      focusBlock({
        id: 'migrated-block-t1-wed',
        taskId: 't1',
        startAtMs: wed.startAtMs,
        endAtMs: wed.endAtMs,
        source: 'migrated_v1',
        locked: true
      })
    ]
    expect(resolveFocusBlockIdForScheduleUpsert(blocks, 't1', NOW)).toBe('migrated-block-t1-wed')
  })

  it('defaults to block:${taskId}:v1 when no focus blocks exist', () => {
    expect(resolveFocusBlockIdForScheduleUpsert([], 't9', NOW)).toBe(defaultV1ScheduleBlockId('t9'))
  })
})

describe('projectWeekScheduleEntries', () => {
  it('projects multi-block chips for one task without cloning Task rows', () => {
    const mon = monFirstScheduleToIntervalMs({
      weekday: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      weekAnchorMidnightMs: WEEK_ANCHOR
    })!
    const fri = monFirstScheduleToIntervalMs({
      weekday: 4,
      startMinutes: 16 * 60,
      endMinutes: 17 * 60,
      weekAnchorMidnightMs: WEEK_ANCHOR
    })!
    // Use local wall-clock constructors so reverse scheduleBlockToV1Schedule is TZ-stable.
    const monStart = new Date(2026, 6, 20, 9, 0, 0, 0)
    const monEnd = new Date(2026, 6, 20, 10, 0, 0, 0)
    const friStart = new Date(2026, 6, 24, 16, 0, 0, 0)
    const friEnd = new Date(2026, 6, 24, 17, 0, 0, 0)
    void mon
    void fri
    const blocks = [
      focusBlock({
        id: 'b-mon',
        taskId: 't1',
        startAtMs: monStart.getTime(),
        endAtMs: monEnd.getTime()
      }),
      focusBlock({
        id: 'b-fri',
        taskId: 't1',
        startAtMs: friStart.getTime(),
        endAtMs: friEnd.getTime()
      })
    ]
    const entries = projectWeekScheduleEntries({
      tasks: [{ id: 't1', title: '多块任务', done: false, categoryId: 'study' }],
      scheduleBlocks: blocks,
      nowMs: new Date(2026, 6, 21, 12, 0, 0, 0).getTime()
    })
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.blockId).sort()).toEqual(['b-fri', 'b-mon'])
    expect(entries.every((e) => e.taskId === 't1')).toBe(true)
    expect(entries.find((e) => e.blockId === 'b-mon')?.schedule).toEqual({
      weekday: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60
    })
    expect(entries.find((e) => e.blockId === 'b-fri')?.schedule).toEqual({
      weekday: 4,
      startMinutes: 16 * 60,
      endMinutes: 17 * 60
    })
    // Exactly one primary
    expect(entries.filter((e) => e.isPrimary)).toHaveLength(1)
  })

  it('falls back to V1.schedule when canonical empty', () => {
    const entries = projectWeekScheduleEntriesFromHost({
      tasks: [
        {
          id: 't1',
          title: '仅 V1',
          done: false,
          schedule: { weekday: 1, startMinutes: 60, endMinutes: 120 }
        }
      ],
      scheduleBlocks: [],
      weekAnchorMidnightMs: WEEK_ANCHOR,
      nowMs: NOW
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.blockId).toBe(defaultV1ScheduleBlockId('t1'))
    expect(entries[0]?.schedule.weekday).toBe(1)
  })

  it('keeps V1-only task chips when other tasks have canonical blocks', () => {
    const start = new Date(2026, 6, 20, 9, 0, 0, 0)
    const end = new Date(2026, 6, 20, 10, 0, 0, 0)
    const entries = projectWeekScheduleEntriesFromHost({
      tasks: [
        { id: 't1', title: '有块', done: false, categoryId: 'study' },
        {
          id: 't2',
          title: '仅 V1',
          done: false,
          schedule: { weekday: 3, startMinutes: 200, endMinutes: 260 }
        }
      ],
      scheduleBlocks: [
        focusBlock({
          id: 'b1',
          taskId: 't1',
          startAtMs: start.getTime(),
          endAtMs: end.getTime()
        })
      ],
      weekAnchorMidnightMs: WEEK_ANCHOR,
      nowMs: NOW
    })
    expect(entries.map((e) => e.taskId).sort()).toEqual(['t1', 't2'])
    expect(entries.find((e) => e.taskId === 't2')?.blockId).toBe(defaultV1ScheduleBlockId('t2'))
  })
})

describe('buildFocusScheduleBlockFromV1', () => {
  it('preserves migrated identity / locked / plan fields', () => {
    const existing = focusBlock({
      id: 'migrated-block-t1',
      taskId: 't1',
      startAtMs: 1,
      endAtMs: 2,
      locked: true,
      source: 'migrated_v1',
      planId: 'plan-a',
      planRevision: 3,
      revision: 4,
      status: 'planned'
    })
    const built = buildFocusScheduleBlockFromV1({
      taskId: 't1',
      schedule: { weekday: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 },
      weekAnchorMidnightMs: WEEK_ANCHOR,
      blockId: 'migrated-block-t1',
      existing
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.block.id).toBe('migrated-block-t1')
    expect(built.block.locked).toBe(true)
    expect(built.block.source).toBe('migrated_v1')
    expect(built.block.planId).toBe('plan-a')
    expect(built.block.planRevision).toBe(3)
    expect(built.block.revision).toBe(5)
    expect(built.block.startAtMs).not.toBe(1)
  })
})

describe('dualWriteUpsertScheduleFromV1 multi-block id resolve', () => {
  it('moves existing primary block instead of inventing block:task:v1', async () => {
    const monStart = new Date(2026, 6, 20, 9, 0, 0, 0)
    const monEnd = new Date(2026, 6, 20, 10, 0, 0, 0)
    const existing = focusBlock({
      id: 'migrated-block-t1',
      taskId: 't1',
      startAtMs: monStart.getTime(),
      endAtMs: monEnd.getTime(),
      source: 'migrated_v1',
      locked: true
    })
    const { api, applied } = mockApi(emptySnapshot(2, [existing]))
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: '/ws',
      nowMs: () => NOW
    }
    const result = await dualWriteUpsertScheduleFromV1(ctx, {
      taskId: 't1',
      schedule: { weekday: 2, startMinutes: 11 * 60, endMinutes: 12 * 60 },
      weekAnchorMidnightMs: WEEK_ANCHOR
    })
    expect(result.kind).toBe('canonical_ok')
    expect(applied).toHaveLength(1)
    const cmd = (applied[0] as {
      command: { type: string; payload: { block: ScheduleBlock } }
    }).command
    expect(cmd.type).toBe('upsert_schedule_block')
    expect(cmd.payload.block.id).toBe('migrated-block-t1')
    expect(cmd.payload.block.taskId).toBe('t1')
    expect(cmd.payload.block.locked).toBe(true)
    expect(cmd.payload.block.source).toBe('migrated_v1')
    const expected = monFirstScheduleToIntervalMs({
      weekday: 2,
      startMinutes: 11 * 60,
      endMinutes: 12 * 60,
      weekAnchorMidnightMs: WEEK_ANCHOR
    })
    expect(cmd.payload.block.startAtMs).toBe(expected!.startAtMs)
    expect(cmd.payload.block.endAtMs).toBe(expected!.endAtMs)
  })

  it('honors explicit blockId among multi-block set (does not move primary)', async () => {
    const aStart = new Date(2026, 6, 20, 9, 0, 0, 0)
    const aEnd = new Date(2026, 6, 20, 10, 0, 0, 0)
    const bStart = new Date(2026, 6, 24, 16, 0, 0, 0)
    const bEnd = new Date(2026, 6, 24, 17, 0, 0, 0)
    const blocks = [
      focusBlock({
        id: 'b-a',
        taskId: 't1',
        startAtMs: aStart.getTime(),
        endAtMs: aEnd.getTime()
      }),
      focusBlock({
        id: 'b-b',
        taskId: 't1',
        startAtMs: bStart.getTime(),
        endAtMs: bEnd.getTime()
      })
    ]
    const { api, applied } = mockApi(emptySnapshot(1, blocks))
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: '/ws',
      nowMs: () => new Date(2026, 6, 21, 12, 0, 0, 0).getTime()
    }
    const result = await dualWriteUpsertScheduleFromV1(ctx, {
      taskId: 't1',
      schedule: { weekday: 3, startMinutes: 8 * 60, endMinutes: 9 * 60 },
      weekAnchorMidnightMs: WEEK_ANCHOR,
      blockId: 'b-b'
    })
    expect(result.kind).toBe('canonical_ok')
    const cmd = (applied[0] as {
      command: { payload: { block: ScheduleBlock } }
    }).command
    expect(cmd.payload.block.id).toBe('b-b')
    // sibling block is not removed by upsert (store replaces by id only)
    expect(listActiveFocusBlocksForTask(blocks, 't1')).toHaveLength(2)
  })

  it('creates default :v1 id when task has no blocks yet', async () => {
    const { api, applied } = mockApi(emptySnapshot(1, []))
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: '/ws',
      nowMs: () => NOW
    }
    await dualWriteUpsertScheduleFromV1(ctx, {
      taskId: 'new-task',
      schedule: { weekday: 0, startMinutes: 60, endMinutes: 120 },
      weekAnchorMidnightMs: WEEK_ANCHOR
    })
    const cmd = (applied[0] as {
      command: { payload: { block: ScheduleBlock } }
    }).command
    expect(cmd.payload.block.id).toBe(defaultV1ScheduleBlockId('new-task'))
  })
})
