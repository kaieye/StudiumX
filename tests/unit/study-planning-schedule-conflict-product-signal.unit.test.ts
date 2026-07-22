/**
 * STC-707 product-signal freeze invariants (IMPL-U).
 *
 * Decision: opt-in preview→confirm writeback is a shipped default capability
 * when conflicts are detected + planning context exists.
 * Silent auto-stagger remains forbidden.
 *
 * Invariants covered:
 * - locked block not moved
 * - hard end respected
 * - no apply without explicit confirm (auto-on-detect is false)
 * - sequential dual-write CAS path still used (host apply)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  proposeScheduleConflictResolve,
  type ScheduleBlock
} from '../../src/shared/study-planning'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  STC_707_PRODUCT_SIGNAL,
  applyConflictResolveMovesAndRefresh,
  buildConflictResolvePreviewModel,
  canConfirmConflictResolveApply,
  shouldAutoApplyConflictResolveOnDetect,
  shouldWireConflictResolveCta
} from '../../src/renderer/src/study-space/planning-schedule-conflict-resolve-host'
import {
  projectScheduleConflictsBanner,
  projectScheduleConflictResolvePreview
} from '../../src/renderer/src/study-space/planning-schedule-conflicts-ui'

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

function mockApi(blocks: ScheduleBlock[]): StudyPlanningApi {
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
      const command = (payload as {
        command?: { type?: string; payload?: { block?: ScheduleBlock } }
        expectedRevision?: number
      }).command
      const expectedRevision = (payload as { expectedRevision?: number }).expectedRevision
      if (typeof expectedRevision === 'number' && expectedRevision !== revision) {
        return {
          ok: false as const,
          revision,
          error: { code: 'revision_conflict' as const, message: 'CAS mismatch' }
        }
      }
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

describe('STC-707 product-signal freeze', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('freezes opt-in writeback as shipped default; silent auto banned', () => {
    expect(STC_707_PRODUCT_SIGNAL.optInWritebackShippedDefault).toBe(true)
    expect(STC_707_PRODUCT_SIGNAL.silentAutoStaggerAllowed).toBe(false)
    expect(STC_707_PRODUCT_SIGNAL.requireExplicitConfirm).toBe(true)
    expect(STC_707_PRODUCT_SIGNAL.respectLockedBlocks).toBe(true)
    expect(STC_707_PRODUCT_SIGNAL.respectHardEnd).toBe(true)
    expect(shouldAutoApplyConflictResolveOnDetect()).toBe(false)
  })

  it('wires CTA whenever conflicts + planning context (shipped default capability)', () => {
    expect(
      shouldWireConflictResolveCta({ hasPlanningContext: true, hasConflicts: true })
    ).toBe(true)
    // Without context or without conflicts → no CTA (cannot CAS / nothing to resolve)
    expect(
      shouldWireConflictResolveCta({ hasPlanningContext: false, hasConflicts: true })
    ).toBe(false)
    expect(
      shouldWireConflictResolveCta({ hasPlanningContext: true, hasConflicts: false })
    ).toBe(false)
  })

  it('banner copy always offers two-step labels and locked/hard-end respect note', () => {
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
    const model = projectScheduleConflictsBanner({
      scheduleBlocks: [a, b],
      tasks: [
        { id: 't1', title: 'A' },
        { id: 't2', title: 'B' }
      ]
    })
    expect(model.kind).toBe('conflicts')
    expect(model.copy.previewResolveLabel).toBe('预览错开')
    expect(model.copy.applyResolveLabel).toBe('确认应用')
    expect(model.copy.resolveRespectNote).toMatch(/锁定/)
    expect(model.copy.resolveRespectNote).toMatch(/硬结束/)
    expect(model.copy.resolveRespectNote).toMatch(/不会静默/)
  })

  it('disables confirm apply when preview empty or all targets locked', () => {
    expect(canConfirmConflictResolveApply({ preview: null })).toBe(false)

    const bothLocked = [
      focusBlock({
        id: 'a',
        locked: true,
        startAtMs: localMs(2026, 7, 20, 9, 0),
        endAtMs: localMs(2026, 7, 20, 10, 0)
      }),
      focusBlock({
        id: 'b',
        locked: true,
        startAtMs: localMs(2026, 7, 20, 9, 30),
        endAtMs: localMs(2026, 7, 20, 10, 30)
      })
    ]
    const unavailable = projectScheduleConflictResolvePreview({ scheduleBlocks: bothLocked })
    expect(unavailable.kind).toBe('unavailable')
    expect(unavailable.moves).toEqual([])
    expect(canConfirmConflictResolveApply({ preview: unavailable })).toBe(false)

    const unlocked = [
      focusBlock({
        id: 'a',
        startAtMs: localMs(2026, 7, 20, 9, 0),
        endAtMs: localMs(2026, 7, 20, 10, 0)
      }),
      focusBlock({
        id: 'b',
        startAtMs: localMs(2026, 7, 20, 9, 30),
        endAtMs: localMs(2026, 7, 20, 10, 30)
      })
    ]
    const ready = projectScheduleConflictResolvePreview({ scheduleBlocks: unlocked })
    expect(ready.kind).toBe('ready')
    expect(canConfirmConflictResolveApply({ preview: ready })).toBe(true)
  })

  it('invariant: locked block is not moved by pure propose or host apply', async () => {
    const locked = focusBlock({
      id: 'locked',
      locked: true,
      taskId: 't1',
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0),
      revision: 2
    })
    const free = focusBlock({
      id: 'free',
      locked: false,
      taskId: 't2',
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30),
      revision: 1
    })

    const proposal = proposeScheduleConflictResolve({ blocks: [locked, free] })
    expect(proposal.ok).toBe(true)
    if (!proposal.ok) return
    expect(proposal.moves.every((m) => m.blockId !== 'locked')).toBe(true)
    const lockedNext = proposal.nextBlocks.find((b) => b.id === 'locked')
    expect(lockedNext).toMatchObject({
      startAtMs: locked.startAtMs,
      endAtMs: locked.endAtMs
    })

    // Host apply of a crafted locked move must refuse (no dual-write call)
    const api = mockApi([locked, free])
    const refused = await applyConflictResolveMovesAndRefresh(
      { api, workspaceRoot: '/ws', nowMs: () => 1_700_000_000_000 },
      {
        moves: [
          {
            blockId: 'locked',
            from: { startAtMs: locked.startAtMs, endAtMs: locked.endAtMs },
            to: {
              startAtMs: localMs(2026, 7, 20, 12, 0),
              endAtMs: localMs(2026, 7, 20, 13, 0)
            },
            reason: 'crafted'
          }
        ]
      }
    )
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.code).toBe('locked_would_move')
    expect(api.applyStudyPlanning).not.toHaveBeenCalled()
  })

  it('invariant: hard end is respected (fail closed)', () => {
    const a = focusBlock({
      id: 'a',
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0)
    })
    const b = focusBlock({
      id: 'b',
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30)
    })
    // Window ends at 10:00 — shifting free block later would exceed hard end
    const window = {
      startAtMs: localMs(2026, 7, 20, 8, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0),
      hardEnd: true
    }
    const proposal = proposeScheduleConflictResolve({ blocks: [a, b], window })
    expect(proposal.ok).toBe(false)
    if (proposal.ok) return
    expect(proposal.code).toBe('hard_end_violation')

    const preview = projectScheduleConflictResolvePreview({
      scheduleBlocks: [a, b],
      window
    })
    expect(preview.kind).toBe('unavailable')
    expect(preview.reasonCode).toBe('hard_end_violation')
    expect(canConfirmConflictResolveApply({ preview })).toBe(false)
  })

  it('invariant: no apply without explicit confirm (detect path never auto-applies)', () => {
    // Product freeze: detect must never call apply.
    expect(shouldAutoApplyConflictResolveOnDetect()).toBe(false)
    expect(STC_707_PRODUCT_SIGNAL.requireExplicitConfirm).toBe(true)

    // Building preview alone produces moves but does not write.
    const a = focusBlock({
      id: 'a',
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 0)
    })
    const b = focusBlock({
      id: 'b',
      startAtMs: localMs(2026, 7, 20, 9, 30),
      endAtMs: localMs(2026, 7, 20, 10, 30)
    })
    const api = mockApi([a, b])
    const preview = buildConflictResolvePreviewModel({
      scheduleBlocks: [a, b],
      hasConflicts: true
    })
    expect(preview?.kind).toBe('ready')
    // No host apply invoked merely by building preview
    expect(api.applyStudyPlanning).not.toHaveBeenCalled()
    expect(api.readStudyPlanning).not.toHaveBeenCalled()
  })

  it('invariant: sequential dual-write CAS path used on host apply', async () => {
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
    const c = focusBlock({
      id: 'c',
      taskId: 't3',
      startAtMs: localMs(2026, 7, 20, 10, 15),
      endAtMs: localMs(2026, 7, 20, 11, 0),
      revision: 1
    })
    // Two overlaps → may need multiple sequential upserts
    const api = mockApi([a, b, c])
    const preview = buildConflictResolvePreviewModel({
      scheduleBlocks: [a, b, c],
      hasConflicts: true
    })
    expect(preview?.kind).toBe('ready')
    expect(preview!.moves.length).toBeGreaterThan(0)

    const result = await applyConflictResolveMovesAndRefresh(
      { api, workspaceRoot: '/ws', nowMs: () => 1_700_000_000_000 },
      { moves: preview!.moves }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.applied).toBe(preview!.moves.length)
    // Sequential CAS: each applyStudyPlanning call carries expectedRevision
    const applyMock = api.applyStudyPlanning as ReturnType<typeof vi.fn>
    expect(applyMock.mock.calls.length).toBe(preview!.moves.length)
    for (const call of applyMock.mock.calls) {
      const payload = call[0] as { expectedRevision?: number; command?: { type?: string } }
      expect(typeof payload.expectedRevision).toBe('number')
      expect(payload.command?.type).toBe('upsert_schedule_block')
    }
    // Revisions should advance (CAS chain), not all equal the initial revision
    const revs = applyMock.mock.calls.map(
      (call) => (call[0] as { expectedRevision: number }).expectedRevision
    )
    for (let i = 1; i < revs.length; i++) {
      expect(revs[i]).toBeGreaterThan(revs[i - 1]!)
    }
  })
})
