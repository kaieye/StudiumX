import { describe, expect, it, vi } from 'vitest'
import {
  StudyPlanningStore,
  applyDeleteTaskFutureBlocks,
  type PlanningTask,
  type ScheduleBlock
} from '../../src/shared/study-planning'
import {
  buildDeleteTaskCommand,
  deletePlanningTask,
  projectPlanningTasksToStudyTasks
} from '../../src/renderer/src/study-space/planning-client'
import { dualWriteDeleteTask } from '../../src/renderer/src/study-space/planning-task-delete-dual-write'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'

function task(partial: Partial<PlanningTask> & Pick<PlanningTask, 'id' | 'title'>): PlanningTask {
  return {
    status: 'open',
    categoryId: 'study',
    inbox: false,
    splittable: true,
    revision: 1,
    source: 'manual',
    ...partial
  }
}

function block(
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

describe('applyDeleteTaskFutureBlocks (pure §7.3)', () => {
  it('cancels task with no future blocks without requiring decision', () => {
    const now = 1_000
    const result = applyDeleteTaskFutureBlocks({
      task: task({ id: 't1', title: 'A' }),
      scheduleBlocks: [
        block({ id: 'past', taskId: 't1', startAtMs: 0, endAtMs: 500 }),
        block({ id: 'other', taskId: 't2', startAtMs: 2_000, endAtMs: 3_000 })
      ],
      nowMs: now
    })
    expect(result.task.status).toBe('cancelled')
    expect(result.requiresDecision).toBe(false)
    expect(result.futureBlockIds).toEqual([])
    expect(result.scheduleBlocks.find((b) => b.id === 'past')?.status).toBe('planned')
  })

  it('requires decision when future focus blocks exist', () => {
    const now = 1_000
    const result = applyDeleteTaskFutureBlocks({
      task: task({ id: 't1', title: 'A' }),
      scheduleBlocks: [block({ id: 'fb', taskId: 't1', startAtMs: 2_000, endAtMs: 3_000 })],
      nowMs: now
    })
    expect(result.task.status).toBe('cancelled')
    expect(result.requiresDecision).toBe(true)
    expect(result.futureBlockIds).toEqual(['fb'])
    expect(result.scheduleBlocks.find((b) => b.id === 'fb')?.status).toBe('planned')
  })

  it('cancel_blocks marks future blocks cancelled', () => {
    const now = 1_000
    const result = applyDeleteTaskFutureBlocks({
      task: task({ id: 't1', title: 'A' }),
      scheduleBlocks: [block({ id: 'fb', taskId: 't1', startAtMs: 2_000, endAtMs: 3_000 })],
      nowMs: now,
      decision: 'cancel_blocks'
    })
    expect(result.requiresDecision).toBe(false)
    expect(result.scheduleBlocks.find((b) => b.id === 'fb')?.status).toBe('cancelled')
  })

  it('reassign maps future blocks to target taskId', () => {
    const now = 1_000
    const result = applyDeleteTaskFutureBlocks({
      task: task({ id: 't1', title: 'A' }),
      scheduleBlocks: [block({ id: 'fb', taskId: 't1', startAtMs: 2_000, endAtMs: 3_000 })],
      nowMs: now,
      decision: 'reassign',
      reassignTaskId: 't2'
    })
    expect(result.scheduleBlocks.find((b) => b.id === 'fb')?.taskId).toBe('t2')
  })

  it('keep_as_review leaves future block planned', () => {
    const now = 1_000
    const result = applyDeleteTaskFutureBlocks({
      task: task({ id: 't1', title: 'A' }),
      scheduleBlocks: [block({ id: 'fb', taskId: 't1', startAtMs: 2_000, endAtMs: 3_000 })],
      nowMs: now,
      decision: 'keep_as_review'
    })
    const fb = result.scheduleBlocks.find((b) => b.id === 'fb')
    expect(fb?.status).toBe('planned')
    expect(fb?.taskId).toBe('t1')
  })
})

describe('StudyPlanningStore delete_task', () => {
  it('soft-cancels task and emits task_deleted', () => {
    const store = new StudyPlanningStore({ nowMs: () => 5_000 })
    const c = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 't1', title: '删我', categoryId: 'study' } },
      1
    )
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const d = store.applyCommand(
      { actionId: 'd1', type: 'delete_task', payload: { id: 't1' } },
      c.revision
    )
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.snapshot.tasks.find((t) => t.id === 't1')?.status).toBe('cancelled')
    expect(d.effects.some((e) => e.type === 'task_deleted' && e.taskId === 't1')).toBe(true)
  })

  it('emits future_blocks_need_decision; second delete applies cancel', () => {
    const now = 1_000_000
    const store = new StudyPlanningStore({ nowMs: () => now })
    const c = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 't1', title: '有未来块', categoryId: 'study' } },
      1
    )
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const blockResult = store.applyCommand(
      {
        actionId: 'b1',
        type: 'upsert_schedule_block',
        payload: {
          block: {
            id: 'fb1',
            taskId: 't1',
            kind: 'focus',
            startAtMs: now + 3_600_000,
            endAtMs: now + 7_200_000,
            locked: false,
            source: 'manual',
            status: 'planned',
            revision: 1
          }
        }
      },
      c.revision
    )
    expect(blockResult.ok).toBe(true)
    if (!blockResult.ok) return

    const first = store.applyCommand(
      { actionId: 'd1', type: 'delete_task', payload: { id: 't1' } },
      blockResult.revision
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.snapshot.tasks.find((t) => t.id === 't1')?.status).toBe('cancelled')
    expect(first.snapshot.scheduleBlocks.find((b) => b.id === 'fb1')?.status).toBe('planned')
    expect(first.effects.some((e) => e.type === 'future_blocks_need_decision')).toBe(true)

    const second = store.applyCommand(
      {
        actionId: 'd2',
        type: 'delete_task',
        payload: { id: 't1', futureBlocksDecision: 'cancel' }
      },
      first.revision
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.snapshot.scheduleBlocks.find((b) => b.id === 'fb1')?.status).toBe('cancelled')
    expect(second.effects.some((e) => e.type === 'future_blocks_need_decision')).toBe(false)
  })

  it('fails not_found for missing task', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const r = store.applyCommand(
      { actionId: 'd', type: 'delete_task', payload: { id: 'missing' } },
      1
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('not_found')
  })
})

describe('projectPlanningTasksToStudyTasks filters cancelled', () => {
  it('omits cancelled tasks from V1 UI projection', () => {
    const rows = projectPlanningTasksToStudyTasks([
      { id: 'a', title: 'Open', status: 'open', categoryId: 'study' },
      { id: 'b', title: 'Done', status: 'done', categoryId: 'study' },
      { id: 'c', title: 'Gone', status: 'cancelled', categoryId: 'study' }
    ])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows.find((r) => r.id === 'b')?.done).toBe(true)
  })
})

describe('planning-client / dualWrite delete_task', () => {
  it('buildDeleteTaskCommand shapes envelope', () => {
    const cmd = buildDeleteTaskCommand(
      { id: 't1', futureBlocksDecision: 'cancel', reassignTaskId: null },
      'aid',
      42
    )
    expect(cmd).toEqual({
      actionId: 'aid',
      type: 'delete_task',
      payload: { id: 't1', futureBlocksDecision: 'cancel', reassignTaskId: null },
      clientIssuedAtMs: 42
    })
  })

  it('deletePlanningTask publishes delete_task envelope', async () => {
    const apply = vi.fn().mockResolvedValue({
      ok: true,
      revision: 2,
      snapshot: {
        revision: 2,
        tasks: [],
        scheduleBlocks: [],
        timerPlans: [],
        timerSessions: [],
        preferences: {},
        categories: [],
        localAnalyticsHints: {}
      },
      effects: [{ type: 'task_deleted', taskId: 't1' }]
    })
    const api = {
      applyStudyPlanning: apply,
      readStudyPlanning: vi.fn()
    } as unknown as StudyPlanningApi

    const result = await deletePlanningTask(api, '/ws', { id: 't1' }, {
      expectedRevision: 1,
      actionId: 'del-1',
      nowMs: () => 99
    })
    expect(result.ok).toBe(true)
    expect(apply).toHaveBeenCalledWith({
      workspaceRoot: '/ws',
      expectedRevision: 1,
      command: buildDeleteTaskCommand({ id: 't1' }, 'del-1', 99)
    })
  })

  it('dualWriteDeleteTask maps cancel_blocks wire alias', async () => {
    const apply = vi.fn().mockResolvedValue({
      ok: true,
      revision: 2,
      snapshot: {
        revision: 2,
        tasks: [],
        scheduleBlocks: [],
        timerPlans: [],
        timerSessions: [],
        preferences: {},
        categories: [],
        localAnalyticsHints: {}
      },
      effects: []
    })
    const read = vi.fn().mockResolvedValue({
      ok: true,
      snapshot: {
        revision: 1,
        tasks: [],
        scheduleBlocks: [],
        timerPlans: [],
        timerSessions: [],
        preferences: {},
        categories: [],
        localAnalyticsHints: {}
      }
    })
    const api = {
      applyStudyPlanning: apply,
      readStudyPlanning: read
    } as unknown as StudyPlanningApi

    const dw = await dualWriteDeleteTask(
      { api, workspaceRoot: '/ws', nowMs: () => 1 },
      't9',
      { futureBlocksDecision: 'cancel_blocks' }
    )
    expect(dw.kind).toBe('canonical_ok')
    const cmd = apply.mock.calls[0][0].command
    expect(cmd.type).toBe('delete_task')
    expect(cmd.payload.futureBlocksDecision).toBe('cancel')
  })

  it('dualWriteDeleteTask skips without workspace', async () => {
    const dw = await dualWriteDeleteTask({ api: null, workspaceRoot: null }, 't1')
    expect(dw.kind).toBe('canonical_skipped')
  })
})
