import { describe, expect, it, vi } from 'vitest'
import {
  applyStudyPlanningCommand,
  buildCompleteTaskCommand,
  buildCreateTaskCommand,
  completePlanningTask,
  createPlanningTask,
  projectPlanningTasksToStudyTasks,
  readStudyPlanningSnapshot,
  type StudyPlanningApi
} from '../../src/renderer/src/study-space/planning-client'
import {
  dualWriteCompleteTask,
  dualWriteCreateTask,
  type CanonicalPlanningContext
} from '../../src/renderer/src/study-space/planning-dual-write'
import type { StudyPlanningSnapshotV1 } from '../../src/shared/study-planning'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION
} from '../../src/shared/study-planning'

function emptySnapshot(revision = 1): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: 1_000,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
}

function mockApi(options?: {
  revision?: number
  onApply?: (payload: unknown) => void
  applyImpl?: StudyPlanningApi['applyStudyPlanning']
}): StudyPlanningApi {
  let revision = options?.revision ?? 1
  let snapshot = emptySnapshot(revision)
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'empty' as const
    })),
    applyStudyPlanning: options?.applyImpl
      ? options.applyImpl
      : vi.fn(async (payload) => {
          options?.onApply?.(payload)
          const next = {
            ...snapshot,
            revision: revision + 1,
            tasks: [
              ...snapshot.tasks,
              {
                id: (payload.command.payload as { id: string }).id,
                title: (payload.command.payload as { title: string }).title,
                status: 'open' as const,
                categoryId: null,
                inbox: true,
                splittable: true,
                revision: 1,
                source: 'manual' as const
              }
            ]
          }
          revision = next.revision
          snapshot = next
          return {
            ok: true as const,
            revision,
            snapshot,
            effects: [{ type: 'task_created' as const, taskId: (payload.command.payload as { id: string }).id }],
            path: '/ws/.studiumx/study-planning/snapshot.json'
          }
        })
  }
}

describe('planning-client (renderer canonical adapter)', () => {
  it('fail-closed read without workspace root', async () => {
    const api = mockApi()
    const result = await readStudyPlanningSnapshot(api, '  ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('missing_workspace')
    expect(api.readStudyPlanning).not.toHaveBeenCalled()
  })

  it('fail-closed read when api missing', async () => {
    const result = await readStudyPlanningSnapshot(undefined, 'D:/ws')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('api_unavailable')
  })

  it('reads snapshot via IPC payload', async () => {
    const api = mockApi({ revision: 3 })
    const result = await readStudyPlanningSnapshot(api, ' D:/ws ')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.revision).toBe(3)
    expect(result.path).toContain('snapshot.json')
    expect(api.readStudyPlanning).toHaveBeenCalledWith({ workspaceRoot: 'D:/ws' })
  })

  it('buildCreateTaskCommand shares caller id', () => {
    const cmd = buildCreateTaskCommand(
      { id: 'task-shared', title: '读论文', categoryId: null },
      'act-1',
      99
    )
    expect(cmd).toEqual({
      actionId: 'act-1',
      type: 'create_task',
      payload: { id: 'task-shared', title: '读论文', categoryId: null, inbox: true },
      clientIssuedAtMs: 99
    })
  })

  it('createPlanningTask applies expectedRevision CAS and returns effects', async () => {
    const seen: unknown[] = []
    const api = mockApi({
      onApply: (p) => seen.push(p)
    })
    const result = await createPlanningTask(api, '/ws', {
      id: 't1',
      title: '任务 A'
    }, { expectedRevision: 1, actionId: 'fixed-action', nowMs: () => 42 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.revision).toBe(2)
    expect(result.effects).toEqual([{ type: 'task_created', taskId: 't1' }])
    expect(seen[0]).toMatchObject({
      workspaceRoot: '/ws',
      expectedRevision: 1,
      command: {
        actionId: 'fixed-action',
        type: 'create_task',
        payload: { id: 't1', title: '任务 A' }
      }
    })
  })

  it('createPlanningTask surfaces revision_conflict without silent overwrite', async () => {
    const api = mockApi({
      applyImpl: vi.fn(async () => ({
        ok: false as const,
        revision: 5,
        error: { code: 'revision_conflict', message: 'expected 1, actual 5' }
      }))
    })
    // After conflict, createPlanningTask re-reads and retries once; force second fail too
    let calls = 0
    api.applyStudyPlanning = vi.fn(async () => {
      calls += 1
      return {
        ok: false as const,
        revision: 5 + calls,
        error: { code: 'revision_conflict', message: `conflict ${calls}` }
      }
    })
    api.readStudyPlanning = vi.fn(async () => ({
      ok: true as const,
      snapshot: emptySnapshot(5),
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    }))

    const result = await createPlanningTask(api, '/ws', { id: 't', title: 'X' }, {
      expectedRevision: 1,
      nowMs: () => 1
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('revision_conflict')
    expect(api.applyStudyPlanning).toHaveBeenCalledTimes(2)
  })

  it('applyStudyPlanningCommand rejects invalid expectedRevision client-side', async () => {
    const api = mockApi()
    const result = await applyStudyPlanningCommand(api, '/ws', 0, buildCreateTaskCommand(
      { id: 'a', title: 'A' },
      'x'
    ))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_command')
    expect(api.applyStudyPlanning).not.toHaveBeenCalled()
  })

  it('completePlanningTask builds complete_task envelope', async () => {
    const api = mockApi({
      applyImpl: vi.fn(async (payload) => ({
        ok: true as const,
        revision: 2,
        snapshot: emptySnapshot(2),
        effects: [{ type: 'task_updated' as const, taskId: 'done-1' }],
        path: '/p'
      }))
    })
    const result = await completePlanningTask(api, '/ws', { id: 'done-1' }, {
      expectedRevision: 1,
      actionId: 'c1',
      nowMs: () => 7
    })
    expect(result.ok).toBe(true)
    expect(api.applyStudyPlanning).toHaveBeenCalledWith({
      workspaceRoot: '/ws',
      expectedRevision: 1,
      command: buildCompleteTaskCommand({ id: 'done-1' }, 'c1', 7)
    })
  })

  it('projectPlanningTasksToStudyTasks maps done status', () => {
    expect(
      projectPlanningTasksToStudyTasks([
        { id: '1', title: 'A', status: 'open', categoryId: null },
        { id: '2', title: 'B', status: 'done', categoryId: 'study' }
      ])
    ).toEqual([
      { id: '1', title: 'A', done: false },
      { id: '2', title: 'B', done: true, categoryId: 'study' }
    ])
  })
})

describe('planning dual-write', () => {
  it('skips when workspace root missing (fail-closed, no IPC)', async () => {
    const api = mockApi()
    const ctx: CanonicalPlanningContext = { api, workspaceRoot: null }
    const result = await dualWriteCreateTask(ctx, { id: 't', title: 'X' })
    expect(result.kind).toBe('canonical_skipped')
    if (result.kind !== 'canonical_skipped') return
    expect(result.reason).toBe('missing_workspace')
    expect(api.applyStudyPlanning).not.toHaveBeenCalled()
  })

  it('publishes create_task with shared id', async () => {
    const api = mockApi()
    const ctx: CanonicalPlanningContext = { api, workspaceRoot: 'D:/project/ws' }
    const result = await dualWriteCreateTask(ctx, {
      id: 'shared-id',
      title: '双写任务',
      categoryId: null
    })
    expect(result.kind).toBe('canonical_ok')
    expect(api.applyStudyPlanning).toHaveBeenCalled()
    const payload = (api.applyStudyPlanning as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.command.payload).toMatchObject({ id: 'shared-id', title: '双写任务' })
  })

  it('publishes complete_task on dualWriteCompleteTask', async () => {
    const api = mockApi({
      applyImpl: vi.fn(async () => ({
        ok: true as const,
        revision: 2,
        snapshot: emptySnapshot(2),
        effects: []
      }))
    })
    const result = await dualWriteCompleteTask(
      { api, workspaceRoot: '/ws' },
      'task-9'
    )
    expect(result.kind).toBe('canonical_ok')
    const payload = (api.applyStudyPlanning as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.command.type).toBe('complete_task')
    expect(payload.command.payload).toMatchObject({ id: 'task-9' })
  })

  it('maps pure futureBlocksDecision aliases to client wire on dualWriteCompleteTask', async () => {
    const applyImpl = vi.fn(async () => ({
      ok: true as const,
      revision: 3,
      snapshot: emptySnapshot(3),
      effects: [] as const,
      path: '/ws/.studiumx/study-planning/snapshot.json'
    }))
    const api = mockApi({ applyImpl })

    await dualWriteCompleteTask(
      { api, workspaceRoot: '/ws', nowMs: () => 42 },
      'task-9',
      { futureBlocksDecision: 'cancel_blocks' }
    )
    expect(applyImpl.mock.calls[0][0].command.payload).toMatchObject({
      id: 'task-9',
      futureBlocksDecision: 'cancel'
    })

    await dualWriteCompleteTask(
      { api, workspaceRoot: '/ws', nowMs: () => 43 },
      'task-9',
      { futureBlocksDecision: 'keep_as_review' }
    )
    expect(applyImpl.mock.calls[1][0].command.payload).toMatchObject({
      id: 'task-9',
      futureBlocksDecision: 'keep_review'
    })

    await dualWriteCompleteTask(
      { api, workspaceRoot: '/ws', nowMs: () => 44 },
      'task-9',
      { futureBlocksDecision: 'reassign', reassignTaskId: 't-other' }
    )
    expect(applyImpl.mock.calls[2][0].command.payload).toMatchObject({
      id: 'task-9',
      futureBlocksDecision: 'reassign',
      reassignTaskId: 't-other'
    })
  })

  it('buildCompleteTaskCommand includes futureBlocksDecision wire payload', () => {
    expect(
      buildCompleteTaskCommand(
        { id: 'x', futureBlocksDecision: 'keep_review', reassignTaskId: null },
        'a1',
        9
      )
    ).toMatchObject({
      actionId: 'a1',
      type: 'complete_task',
      clientIssuedAtMs: 9,
      payload: { id: 'x', futureBlocksDecision: 'keep_review', reassignTaskId: null }
    })
  })
  it('surfaces canonical_failed on io_failed', async () => {
    const api = mockApi({
      applyImpl: vi.fn(async () => ({
        ok: false as const,
        revision: 1,
        error: { code: 'io_failed', message: 'disk full' }
      }))
    })
    const result = await dualWriteCreateTask(
      { api, workspaceRoot: '/ws' },
      { id: 't', title: 'Y' }
    )
    expect(result.kind).toBe('canonical_failed')
    if (result.kind !== 'canonical_failed') return
    expect(result.result.error.code).toBe('io_failed')
  })
})
