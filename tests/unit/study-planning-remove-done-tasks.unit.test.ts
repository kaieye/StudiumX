import { describe, expect, it, vi } from 'vitest'
import {
  collectDoneTaskIds,
  dualWriteRemoveDoneTasks
} from '../../src/renderer/src/study-space/planning-task-delete-dual-write'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'

describe('collectDoneTaskIds', () => {
  it('returns only done task ids, trimmed', () => {
    expect(
      collectDoneTaskIds([
        { id: 'a', done: true },
        { id: 'b', done: false },
        { id: '  c  ', done: true },
        { id: '', done: true },
        { id: 'd' }
      ])
    ).toEqual(['a', 'c'])
  })

  it('empty when none done', () => {
    expect(collectDoneTaskIds([{ id: 'x', done: false }])).toEqual([])
  })
})

describe('dualWriteRemoveDoneTasks', () => {
  it('skips without workspace (each id → skipped)', async () => {
    const results = await dualWriteRemoveDoneTasks({ api: null, workspaceRoot: null }, ['t1', 't2'])
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.kind === 'canonical_skipped')).toBe(true)
  })

  it('publishes delete_task with cancel decision for each id', async () => {
    const apply = vi.fn(async (payload: { command: { type: string; payload: Record<string, unknown> } }) => {
      expect(payload.command.type).toBe('delete_task')
      expect(payload.command.payload.futureBlocksDecision).toBe('cancel')
      return {
        ok: true as const,
        revision: 2,
        effects: [{ type: 'task_deleted' as const, taskId: String(payload.command.payload.id) }],
        snapshot: {
          schemaVersion: 1,
          revision: 2,
          updatedAtMs: 1,
          tasks: [],
          scheduleBlocks: [],
          timerPlans: [],
          timerSessions: [],
          preferences: {},
          localAnalyticsHints: {}
        }
      }
    })
    const api: StudyPlanningApi = {
      readStudyPlanning: vi.fn(async () => ({
        ok: true as const,
        snapshot: {
          schemaVersion: 1,
          revision: 1,
          updatedAtMs: 1,
          tasks: [],
          scheduleBlocks: [],
          timerPlans: [],
          timerSessions: [],
          preferences: {},
          localAnalyticsHints: {}
        }
      })),
      applyStudyPlanning: apply
    }
    const results = await dualWriteRemoveDoneTasks({ api, workspaceRoot: 'D:/ws' }, ['t1', 't2'])
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.kind === 'canonical_ok')).toBe(true)
    expect(apply).toHaveBeenCalledTimes(2)
    const ids = apply.mock.calls.map((c) => c[0].command.payload.id)
    expect(ids).toEqual(['t1', 't2'])
  })
})
