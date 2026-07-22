import { describe, expect, it, vi } from 'vitest'
import {
  StudyPlanningStore,
  applyReopenTask,
  type PlanningTask
} from '../../src/shared/study-planning'
import {
  buildReopenTaskCommand,
  reopenPlanningTask,
  type StudyPlanningApi
} from '../../src/renderer/src/study-space/planning-client'
import { dualWriteReopenTask } from '../../src/renderer/src/study-space/planning-dual-write'

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

describe('applyReopenTask (pure)', () => {
  it('reopens done → open and bumps revision', () => {
    const result = applyReopenTask({ task: task({ id: 't1', title: 'A', status: 'done', revision: 3 }) })
    expect(result.changed).toBe(true)
    expect(result.task.status).toBe('open')
    expect(result.task.revision).toBe(4)
  })

  it('reopens cancelled → open', () => {
    const result = applyReopenTask({
      task: task({ id: 't1', title: 'A', status: 'cancelled', revision: 2 })
    })
    expect(result.changed).toBe(true)
    expect(result.task.status).toBe('open')
    expect(result.task.revision).toBe(3)
  })

  it('idempotent when already open (no revision bump)', () => {
    const t = task({ id: 't1', title: 'A', status: 'open', revision: 5 })
    const result = applyReopenTask({ task: t })
    expect(result.changed).toBe(false)
    expect(result.task).toBe(t)
    expect(result.task.revision).toBe(5)
  })
})

describe('StudyPlanningStore reopen_task', () => {
  it('reopens a done task and emits task_updated', () => {
    const store = new StudyPlanningStore({ nowMs: () => 5_000 })
    const c = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 't1', title: 'Done me', categoryId: 'study' } },
      1
    )
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const done = store.applyCommand(
      { actionId: 'd1', type: 'complete_task', payload: { id: 't1' } },
      c.revision
    )
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.snapshot.tasks.find((t) => t.id === 't1')?.status).toBe('done')

    const reopened = store.applyCommand(
      { actionId: 'r1', type: 'reopen_task', payload: { id: 't1' } },
      done.revision
    )
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.snapshot.tasks.find((t) => t.id === 't1')?.status).toBe('open')
    expect(reopened.effects.some((e) => e.type === 'task_updated' && e.taskId === 't1')).toBe(true)
  })

  it('reopens a cancelled task', () => {
    const store = new StudyPlanningStore({ nowMs: () => 5_000 })
    const c = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 't1', title: 'Cancel me', categoryId: 'study' } },
      1
    )
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const del = store.applyCommand(
      { actionId: 'del1', type: 'delete_task', payload: { id: 't1' } },
      c.revision
    )
    expect(del.ok).toBe(true)
    if (!del.ok) return

    const reopened = store.applyCommand(
      { actionId: 'r1', type: 'reopen_task', payload: { id: 't1' } },
      del.revision
    )
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.snapshot.tasks.find((t) => t.id === 't1')?.status).toBe('open')
  })

  it('idempotent reopen on already-open task (action still ok)', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const c = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 't1', title: 'Open', categoryId: 'study' } },
      1
    )
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const revBefore = c.snapshot.tasks.find((t) => t.id === 't1')!.revision
    const r = store.applyCommand(
      { actionId: 'r1', type: 'reopen_task', payload: { id: 't1' } },
      c.revision
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.tasks.find((t) => t.id === 't1')?.status).toBe('open')
    expect(r.snapshot.tasks.find((t) => t.id === 't1')?.revision).toBe(revBefore)
  })

  it('fails not_found for missing task', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const r = store.applyCommand(
      { actionId: 'r', type: 'reopen_task', payload: { id: 'missing' } },
      1
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('not_found')
  })
})

describe('buildReopenTaskCommand / reopenPlanningTask client', () => {
  it('builds reopen_task envelope', () => {
    const env = buildReopenTaskCommand({ id: 't9' }, 'aid-1', 42)
    expect(env.type).toBe('reopen_task')
    expect(env.actionId).toBe('aid-1')
    expect(env.payload).toEqual({ id: 't9' })
    expect(env.clientIssuedAtMs).toBe(42)
  })

  it('reopenPlanningTask applies with CAS retry on conflict', async () => {
    let calls = 0
    const api: StudyPlanningApi = {
      readStudyPlanning: vi.fn(async () => ({
        ok: true as const,
        snapshot: {
          schemaVersion: 1,
          revision: 10,
          updatedAtMs: 1,
          tasks: [],
          scheduleBlocks: [],
          timerPlans: [],
          timerSessions: [],
          preferences: {},
          localAnalyticsHints: {}
        }
      })),
      applyStudyPlanning: vi.fn(async (payload) => {
        calls += 1
        if (calls === 1) {
          return {
            ok: false as const,
            revision: 10,
            error: { code: 'revision_conflict' as const, message: 'stale' }
          }
        }
        expect(payload.expectedRevision).toBe(10)
        expect(payload.command.type).toBe('reopen_task')
        return {
          ok: true as const,
          revision: 11,
          effects: [{ type: 'task_updated' as const, taskId: 't1' }],
          snapshot: {
            schemaVersion: 1,
            revision: 11,
            updatedAtMs: 2,
            tasks: [],
            scheduleBlocks: [],
            timerPlans: [],
            timerSessions: [],
            preferences: {},
            localAnalyticsHints: {}
          }
        }
      })
    }
    const result = await reopenPlanningTask(api, '/ws', { id: 't1' }, { nowMs: () => 99 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.revision).toBe(11)
    expect(calls).toBe(2)
  })
})

describe('dualWriteReopenTask', () => {
  it('skips without workspace', async () => {
    const r = await dualWriteReopenTask({ api: null, workspaceRoot: null }, 't1')
    expect(r.kind).toBe('canonical_skipped')
  })

  it('publishes reopen_task when context present', async () => {
    const apply = vi.fn(async () => ({
      ok: true as const,
      revision: 2,
      effects: [{ type: 'task_updated' as const, taskId: 't1' }],
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
    }))
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
    const r = await dualWriteReopenTask({ api, workspaceRoot: 'D:/ws' }, 't1')
    expect(r.kind).toBe('canonical_ok')
    expect(apply).toHaveBeenCalled()
    const payload = apply.mock.calls[0][0]
    expect(payload.command.type).toBe('reopen_task')
    expect(payload.command.payload).toEqual({ id: 't1' })
  })
})
