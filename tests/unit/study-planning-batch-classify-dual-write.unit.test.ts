/**
 * Dual-write tests for batch classify (STC-408).
 */
import { describe, expect, it, vi } from 'vitest'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  buildBatchClassifyTasksCommand,
  dualWriteBatchClassifyTasks
} from '../../src/renderer/src/study-space/planning-batch-classify-dual-write'

function mockApi(options?: {
  revision?: number
  onApply?: (payload: unknown) => void
  conflictOnce?: boolean
}): StudyPlanningApi {
  let revision = options?.revision ?? 1
  let conflictRemaining = options?.conflictOnce ? 1 : 0
  let snapshot = {
    schemaVersion: 1 as const,
    revision,
    updatedAtMs: 0,
    tasks: [
      {
        id: 'a',
        title: 'A',
        status: 'open' as const,
        priority: 'normal' as const,
        categoryId: null,
        inbox: true,
        estimateMinutes: null,
        source: 'manual' as const,
        createdAtMs: 0,
        updatedAtMs: 0,
        completedAtMs: null,
        splittable: true
      },
      {
        id: 'b',
        title: 'B',
        status: 'open' as const,
        priority: 'normal' as const,
        categoryId: null,
        inbox: true,
        estimateMinutes: null,
        source: 'manual' as const,
        createdAtMs: 0,
        updatedAtMs: 0,
        completedAtMs: null,
        splittable: true
      }
    ],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: vi.fn(async (payload) => {
      options?.onApply?.(payload)
      if (conflictRemaining > 0) {
        conflictRemaining -= 1
        return {
          ok: false as const,
          revision,
          error: { code: 'revision_conflict' as const, message: 'stale' }
        }
      }
      revision += 1
      snapshot = { ...snapshot, revision }
      return {
        ok: true as const,
        revision,
        snapshot,
        effects: []
      }
    })
  }
}

describe('batch classify dual-write (STC-408)', () => {
  it('builds batch_classify_tasks envelope', () => {
    const cmd = buildBatchClassifyTasksCommand(
      { taskIds: ['a', 'b'], categoryId: 'study' },
      'act1',
      9
    )
    expect(cmd).toMatchObject({
      actionId: 'act1',
      type: 'batch_classify_tasks',
      payload: { taskIds: ['a', 'b'], categoryId: 'study' },
      clientIssuedAtMs: 9
    })
  })

  it('skips without workspace', async () => {
    const r = await dualWriteBatchClassifyTasks(
      { workspaceRoot: null, api: null },
      { taskIds: ['a'], categoryId: 'study' }
    )
    expect(r.kind).toBe('canonical_skipped')
  })

  it('rejects empty category or taskIds', async () => {
    const api = mockApi()
    const r1 = await dualWriteBatchClassifyTasks(
      { workspaceRoot: 'D:/ws', api },
      { taskIds: ['a'], categoryId: '  ' }
    )
    expect(r1.kind).toBe('canonical_failed')
    const r2 = await dualWriteBatchClassifyTasks(
      { workspaceRoot: 'D:/ws', api },
      { taskIds: [], categoryId: 'study' }
    )
    expect(r2.kind).toBe('canonical_failed')
  })

  it('applies with CAS expectedRevision', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const r = await dualWriteBatchClassifyTasks(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 1000 },
      { taskIds: ['a', 'b'], categoryId: 'exercise' }
    )
    expect(r.kind).toBe('canonical_ok')
    expect(applied).toHaveLength(1)
    const payload = applied[0] as {
      expectedRevision: number
      command: { type: string; payload: { taskIds: string[]; categoryId: string } }
    }
    expect(payload.expectedRevision).toBe(1)
    expect(payload.command.type).toBe('batch_classify_tasks')
    expect(payload.command.payload).toEqual({
      taskIds: ['a', 'b'],
      categoryId: 'exercise'
    })
  })

  it('retries once on revision_conflict', async () => {
    const applied: unknown[] = []
    const api = mockApi({ conflictOnce: true, onApply: (p) => applied.push(p) })
    const r = await dualWriteBatchClassifyTasks(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 2000 },
      { taskIds: ['a'], categoryId: 'study' }
    )
    expect(r.kind).toBe('canonical_ok')
    expect(applied).toHaveLength(2)
  })
})
