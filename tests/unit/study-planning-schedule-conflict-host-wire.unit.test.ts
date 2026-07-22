/**
 * STC-707 host wire glue: preview selection + apply sequence (mock dual-write).
 * Does not mount the full StudyTaskSchedulePage (giant); pure host helpers only.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ScheduleBlock } from '../../src/shared/study-planning'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  applyConflictResolveMovesAndRefresh,
  applyMovesToLocalBlocks,
  buildConflictResolvePreviewModel,
  shouldClearScheduleBlocksOverride,
  shouldWireConflictResolveCta
} from '../../src/renderer/src/study-space/planning-schedule-conflict-resolve-host'

function focusBlock(
  partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'startAtMs' | 'endAtMs'>
): ScheduleBlock {
  return {
    taskId: partial.taskId ?? 'task-a',
    kind: 'focus',
    locked: partial.locked ?? false,
    source: partial.source ?? 'manual',
    status: partial.status ?? 'planned',
    revision: partial.revision ?? 1,
    ...partial
  }
}

function localMs(y: number, m: number, d: number, hh: number, mm: number): number {
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
}

function mockApi(blocks: ScheduleBlock[], options?: { failApply?: boolean }): StudyPlanningApi {
  let revision = 1
  let scheduleBlocks = blocks.map((b) => ({ ...b }))
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot: {
        schemaVersion: 1 as const,
        revision,
        updatedAtMs: 0,
        tasks: [],
        scheduleBlocks: scheduleBlocks.slice(),
        timerPlans: [],
        timerSessions: [],
        preferences: {},
        localAnalyticsHints: {}
      } as never,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: vi.fn(async (payload) => {
      if (options?.failApply) {
        return {
          ok: false as const,
          revision,
          error: { code: 'invalid_command' as const, message: 'forced fail' }
        }
      }
      const command = (payload as {
        command?: { type?: string; payload?: { block?: ScheduleBlock } }
      }).command
      const block = command?.payload?.block
      if (block) {
        scheduleBlocks = scheduleBlocks.map((b) => (b.id === block.id ? { ...block } : b))
        revision += 1
      }
      return {
        ok: true as const,
        revision,
        snapshot: {
          schemaVersion: 1 as const,
          revision,
          updatedAtMs: 0,
          tasks: [],
          scheduleBlocks: scheduleBlocks.slice(),
          timerPlans: [],
          timerSessions: [],
          preferences: {},
          localAnalyticsHints: {}
        } as never,
        effects: []
      }
    })
  }
}

describe('planning-schedule-conflict-resolve-host (STC-707)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shouldWireConflictResolveCta requires context + conflicts', () => {
    expect(
      shouldWireConflictResolveCta({ hasPlanningContext: true, hasConflicts: true })
    ).toBe(true)
    expect(
      shouldWireConflictResolveCta({ hasPlanningContext: false, hasConflicts: true })
    ).toBe(false)
    expect(
      shouldWireConflictResolveCta({ hasPlanningContext: true, hasConflicts: false })
    ).toBe(false)
  })

  it('buildConflictResolvePreviewModel returns null when hasConflicts false', () => {
    const a = focusBlock({
      id: 'a',
      taskId: 't1',
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0)
    })
    const b = focusBlock({
      id: 'b',
      taskId: 't2',
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30)
    })
    expect(
      buildConflictResolvePreviewModel({
        scheduleBlocks: [a, b],
        hasConflicts: false
      })
    ).toBeNull()
  })

  it('buildConflictResolvePreviewModel ready for unlocked overlap', () => {
    const a = focusBlock({
      id: 'a',
      taskId: 't1',
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0)
    })
    const b = focusBlock({
      id: 'b',
      taskId: 't2',
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30)
    })
    const preview = buildConflictResolvePreviewModel({
      scheduleBlocks: [a, b],
      hasConflicts: true
    })
    expect(preview).not.toBeNull()
    expect(preview!.kind).toBe('ready')
    expect(preview!.moves.length).toBeGreaterThan(0)
  })

  it('buildConflictResolvePreviewModel unavailable for both locked', () => {
    const a = focusBlock({
      id: 'a',
      locked: true,
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0)
    })
    const b = focusBlock({
      id: 'b',
      locked: true,
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30)
    })
    const preview = buildConflictResolvePreviewModel({
      scheduleBlocks: [a, b],
      hasConflicts: true
    })
    expect(preview!.kind).toBe('unavailable')
    expect(preview!.moves).toEqual([])
  })

  it('applyConflictResolveMovesAndRefresh sequential dual-write + refresh', async () => {
    const a = focusBlock({
      id: 'a',
      taskId: 't1',
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0),
      revision: 1
    })
    const b = focusBlock({
      id: 'b',
      taskId: 't2',
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30),
      revision: 1
    })
    const api = mockApi([a, b])
    const preview = buildConflictResolvePreviewModel({
      scheduleBlocks: [a, b],
      hasConflicts: true
    })
    expect(preview?.kind).toBe('ready')
    const result = await applyConflictResolveMovesAndRefresh(
      { api, workspaceRoot: '/ws', nowMs: () => 1_700_000_000_000 },
      { moves: preview!.moves }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.applied).toBe(preview!.moves.length)
    expect(result.scheduleBlocks.length).toBe(2)
    // After resolve, no overlapping focus windows in refreshed blocks
    const sorted = [...result.scheduleBlocks].sort((x, y) => x.startAtMs - y.startAtMs)
    expect(sorted[0]!.endAtMs).toBeLessThanOrEqual(sorted[1]!.startAtMs)
    expect(api.applyStudyPlanning).toHaveBeenCalled()
  })

  it('applyConflictResolveMovesAndRefresh refuses locked and fails closed', async () => {
    const locked = focusBlock({
      id: 'locked',
      locked: true,
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0)
    })
    const free = focusBlock({
      id: 'free',
      locked: false,
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30)
    })
    const api = mockApi([locked, free])
    // Craft a move that would touch locked — dual-write must refuse
    const result = await applyConflictResolveMovesAndRefresh(
      { api, workspaceRoot: '/ws', nowMs: () => 1_700_000_000_000 },
      {
        moves: [
          {
            blockId: 'locked',
            from: { startAtMs: locked.startAtMs, endAtMs: locked.endAtMs },
            to: {
              startAtMs: localMs(2026, 7, 20, 11, 0),
              endAtMs: localMs(2026, 7, 20, 12, 0)
            },
            reason: 'test'
          }
        ]
      }
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('locked_would_move')
    expect(result.applied).toBe(0)
    expect(api.applyStudyPlanning).not.toHaveBeenCalled()
  })

  it('applyConflictResolveMovesAndRefresh skips without workspace', async () => {
    const result = await applyConflictResolveMovesAndRefresh(
      { api: null, workspaceRoot: null },
      {
        moves: [
          {
            blockId: 'x',
            from: { startAtMs: 0, endAtMs: 1 },
            to: { startAtMs: 10, endAtMs: 20 },
            reason: 't'
          }
        ]
      }
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('canonical_skipped')
  })

  it('applyMovesToLocalBlocks never mutates locked', () => {
    const locked = focusBlock({
      id: 'locked',
      locked: true,
      startAtMs: 100,
      endAtMs: 200,
      revision: 3
    })
    const free = focusBlock({
      id: 'free',
      locked: false,
      startAtMs: 150,
      endAtMs: 250,
      revision: 1
    })
    const next = applyMovesToLocalBlocks([locked, free], [
      {
        blockId: 'locked',
        from: { startAtMs: 100, endAtMs: 200 },
        to: { startAtMs: 300, endAtMs: 400 },
        reason: 'x'
      },
      {
        blockId: 'free',
        from: { startAtMs: 150, endAtMs: 250 },
        to: { startAtMs: 200, endAtMs: 300 },
        reason: 'x'
      }
    ])
    expect(next.find((b) => b.id === 'locked')).toMatchObject({
      startAtMs: 100,
      endAtMs: 200,
      revision: 3
    })
    expect(next.find((b) => b.id === 'free')).toMatchObject({
      startAtMs: 200,
      endAtMs: 300,
      revision: 2
    })
  })

  it('shouldClearScheduleBlocksOverride when parent catches up', () => {
    const a = focusBlock({ id: 'a', startAtMs: 1, endAtMs: 2 })
    expect(
      shouldClearScheduleBlocksOverride({
        override: [a],
        parent: [a]
      })
    ).toBe(true)
    expect(
      shouldClearScheduleBlocksOverride({
        override: [a],
        parent: [focusBlock({ id: 'a', startAtMs: 9, endAtMs: 10 })]
      })
    ).toBe(false)
    expect(
      shouldClearScheduleBlocksOverride({
        override: null,
        parent: [a]
      })
    ).toBe(true)
  })

  it('shouldClearScheduleBlocksOverride when parent re-hydrate drops override-only orphans', () => {
    const live = focusBlock({ id: 'live', startAtMs: 1, endAtMs: 2 })
    const orphan = focusBlock({ id: 'orphan', startAtMs: 3, endAtMs: 4 })
    // Parent no longer has orphan ids at all → override is pure stale ghost.
    expect(
      shouldClearScheduleBlocksOverride({
        override: [live, orphan],
        parent: [live]
      })
    ).toBe(true)
  })

  it('buildConflictResolvePreviewModel ignores orphan-task blocks when tasks provided', () => {
    const live = focusBlock({
      id: 'live',
      taskId: 't1',
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0)
    })
    const orphan = focusBlock({
      id: 'orphan',
      taskId: 't-gone',
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30)
    })
    const preview = buildConflictResolvePreviewModel({
      scheduleBlocks: [live, orphan],
      tasks: [{ id: 't1', title: '阅读' }],
      hasConflicts: true
    })
    expect(preview).not.toBeNull()
    expect(preview!.kind).toBe('unavailable')
    expect(preview!.reasonCode).toBe('no_conflicts')
  })
})
