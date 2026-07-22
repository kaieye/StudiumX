/**
 * STC-307 remainder: multi-block editor model + create/delete dual-write.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  type ScheduleBlock,
  type StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'
import {
  formatBlockTimeRange,
  listTaskBlockEditorRows,
  suggestNextFocusBlockSchedule
} from '../../src/renderer/src/study-space/planning-multi-block-editor'
import {
  allocateFocusBlockId,
  buildDeleteScheduleBlockCommand,
  dualWriteCreateFocusBlock,
  dualWriteDeleteScheduleBlock,
  recomputePrimaryV1Schedule,
  removeBlockFromLocalCache,
  shouldClearV1ScheduleAfterDelete
} from '../../src/renderer/src/study-space/planning-multi-block-dual-write'
import type { CanonicalPlanningContext } from '../../src/renderer/src/study-space/planning-dual-write'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'

const WEEK_ANCHOR = Date.UTC(2026, 6, 19) // Sun 2026-07-19 UTC
const NOW = Date.UTC(2026, 6, 21, 12, 0, 0) // Tue noon

function focusBlock(partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'taskId' | 'startAtMs' | 'endAtMs'>): ScheduleBlock {
  return {
    kind: 'focus',
    locked: false,
    source: 'manual',
    status: 'planned',
    revision: 1,
    ...partial
  }
}

function emptySnapshot(revision: number, blocks: ScheduleBlock[]): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: NOW,
    tasks: [
      {
        id: 't1',
        title: '多块任务',
        status: 'open',
        categoryId: 'study',
        inbox: false,
        splittable: true,
        revision: 1,
        source: 'manual'
      }
    ],
    scheduleBlocks: blocks,
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
}

function mockApi(snapshot: StudyPlanningSnapshotV1) {
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
      const cmd = payload.command as { type: string; payload: { block?: ScheduleBlock; blockId?: string } }
      if (cmd.type === 'upsert_schedule_block' && cmd.payload.block) {
        const without = current.scheduleBlocks.filter((b) => b.id !== cmd.payload.block!.id)
        current = {
          ...current,
          revision: current.revision + 1,
          scheduleBlocks: [...without, cmd.payload.block]
        }
      }
      if (cmd.type === 'delete_schedule_block' && cmd.payload.blockId) {
        current = {
          ...current,
          revision: current.revision + 1,
          scheduleBlocks: current.scheduleBlocks.filter((b) => b.id !== cmd.payload.blockId)
        }
      }
      return {
        ok: true as const,
        revision: current.revision,
        snapshot: current,
        effects: []
      }
    })
  }
  return { api, applied, getSnapshot: () => current }
}

describe('listTaskBlockEditorRows', () => {
  it('lists multi-block rows with primary flag', () => {
    const monStart = new Date(2026, 6, 20, 9, 0, 0, 0)
    const monEnd = new Date(2026, 6, 20, 10, 0, 0, 0)
    const friStart = new Date(2026, 6, 24, 16, 0, 0, 0)
    const friEnd = new Date(2026, 6, 24, 17, 0, 0, 0)
    const nowLocal = new Date(2026, 6, 21, 12, 0, 0, 0).getTime()
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
    const rows = listTaskBlockEditorRows({ taskId: 't1', scheduleBlocks: blocks, nowMs: nowLocal })
    expect(rows).toHaveLength(2)
    expect(rows[0]!.blockId).toBe('b-mon')
    expect(rows[1]!.blockId).toBe('b-fri')
    // nowLocal is Tue Jul 21 → next future is Fri
    expect(rows.find((r) => r.blockId === 'b-fri')?.isPrimary).toBe(true)
    expect(rows.find((r) => r.blockId === 'b-mon')?.isPrimary).toBe(false)
    expect(formatBlockTimeRange(rows[0]!)).toMatch(/周一/)
  })
})

describe('suggestNextFocusBlockSchedule', () => {
  it('places next block after the last end when room remains', () => {
    const next = suggestNextFocusBlockSchedule([
      {
        blockId: 'a',
        schedule: { weekday: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 },
        isPrimary: true,
        locked: false,
        status: 'planned',
        source: 'manual',
        weekday: 0,
        startMinutes: 9 * 60,
        endMinutes: 10 * 60
      }
    ])
    expect(next).toEqual({ weekday: 0, startMinutes: 10 * 60, endMinutes: 11 * 60 })
  })
})

describe('local cache helpers', () => {
  it('removeBlockFromLocalCache and shouldClearV1ScheduleAfterDelete', () => {
    const blocks = [
      focusBlock({
        id: 'only',
        taskId: 't1',
        startAtMs: NOW,
        endAtMs: NOW + 60_000
      })
    ]
    expect(
      shouldClearV1ScheduleAfterDelete({
        blocksBefore: blocks,
        deletedBlockId: 'only',
        taskId: 't1',
        nowMs: NOW
      })
    ).toBe(true)
    const remaining = removeBlockFromLocalCache(blocks, 'only')
    expect(remaining).toHaveLength(0)
    expect(recomputePrimaryV1Schedule(remaining, 't1', NOW)).toBeNull()
  })
})

describe('buildDeleteScheduleBlockCommand', () => {
  it('builds delete envelope', () => {
    const cmd = buildDeleteScheduleBlockCommand('b1', 'act', 42)
    expect(cmd).toEqual({
      actionId: 'act',
      type: 'delete_schedule_block',
      payload: { blockId: 'b1' },
      clientIssuedAtMs: 42
    })
  })
})

describe('dualWriteCreateFocusBlock / dualWriteDeleteScheduleBlock', () => {
  it('creates a second focus block without moving primary', async () => {
    const monStart = new Date(2026, 6, 20, 9, 0, 0, 0)
    const monEnd = new Date(2026, 6, 20, 10, 0, 0, 0)
    const primary = focusBlock({
      id: 'b-primary',
      taskId: 't1',
      startAtMs: monStart.getTime(),
      endAtMs: monEnd.getTime()
    })
    const { api, applied, getSnapshot } = mockApi(emptySnapshot(1, [primary]))
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: '/ws',
      nowMs: () => NOW
    }
    const result = await dualWriteCreateFocusBlock(ctx, {
      taskId: 't1',
      schedule: { weekday: 4, startMinutes: 16 * 60, endMinutes: 17 * 60 },
      weekAnchorMidnightMs: WEEK_ANCHOR,
      blockId: 'b-new'
    })
    expect(result.kind).toBe('canonical_ok')
    expect(result.blockId).toBe('b-new')
    const cmd = (applied[0] as { command: { type: string; payload: { block: ScheduleBlock } } }).command
    expect(cmd.type).toBe('upsert_schedule_block')
    expect(cmd.payload.block.id).toBe('b-new')
    expect(cmd.payload.block.taskId).toBe('t1')
    // primary still present in snapshot after apply mock
    expect(getSnapshot().scheduleBlocks.map((b) => b.id).sort()).toEqual(['b-new', 'b-primary'])
  })

  it('deletes a focus block by id', async () => {
    const blocks = [
      focusBlock({
        id: 'b-a',
        taskId: 't1',
        startAtMs: NOW,
        endAtMs: NOW + 60_000
      }),
      focusBlock({
        id: 'b-b',
        taskId: 't1',
        startAtMs: NOW + 3_600_000,
        endAtMs: NOW + 7_200_000
      })
    ]
    const { api, applied, getSnapshot } = mockApi(emptySnapshot(2, blocks))
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: '/ws',
      nowMs: () => NOW
    }
    const result = await dualWriteDeleteScheduleBlock(ctx, { blockId: 'b-a' })
    expect(result.kind).toBe('canonical_ok')
    const cmd = (applied[0] as { command: { type: string; payload: { blockId: string } } }).command
    expect(cmd.type).toBe('delete_schedule_block')
    expect(cmd.payload.blockId).toBe('b-a')
    expect(getSnapshot().scheduleBlocks.map((b) => b.id)).toEqual(['b-b'])
  })

  it('skips delete without workspace', async () => {
    const result = await dualWriteDeleteScheduleBlock(
      { api: null, workspaceRoot: null },
      { blockId: 'x' }
    )
    expect(result.kind).toBe('canonical_skipped')
  })
})

describe('allocateFocusBlockId', () => {
  it('uses task id and epoch', () => {
    expect(allocateFocusBlockId('t1', 99)).toBe('block:t1:99')
  })
})
