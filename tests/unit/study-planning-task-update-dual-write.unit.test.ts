import { describe, expect, it, vi } from 'vitest'
import {
  applyStudyPlanningCommand,
  buildUpdateTaskCommand,
  updatePlanningTask,
  type StudyPlanningApi
} from '../../src/renderer/src/study-space/planning-client'
import {
  dualWriteUpsertScheduleFromV1,
  type CanonicalPlanningContext
} from '../../src/renderer/src/study-space/planning-dual-write'
import {
  buildUpdateTaskPayloadFromV1,
  dualWriteUpdateTask,
  resolveDefaultWeekAnchorMidnightMs
} from '../../src/renderer/src/study-space/planning-task-update-dual-write'
import {
  jsWeekdayToMonFirst,
  monFirstScheduleToIntervalMs,
  monFirstWeekdayToJs,
  v1ScheduleToIntervalMs,
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  type StudyPlanningSnapshotV1
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
    applyStudyPlanning: vi.fn(async (payload) => {
      options?.onApply?.(payload)
      revision += 1
      snapshot = { ...snapshot, revision, updatedAtMs: revision * 1_000 }
      return {
        ok: true as const,
        revision,
        snapshot,
        effects: [{ type: 'task_updated' as const, taskId: 't1' }],
        path: '/ws/.studiumx/study-planning/snapshot.json'
      }
    })
  }
}

describe('weekday Mon-first ↔ JS conversion', () => {
  it('maps Mon-first 0..6 to JS Sun-first', () => {
    // Mon=0 → JS 1; Tue=1 → 2; … Sat=5 → 6; Sun=6 → 0
    expect(monFirstWeekdayToJs(0)).toBe(1)
    expect(monFirstWeekdayToJs(1)).toBe(2)
    expect(monFirstWeekdayToJs(5)).toBe(6)
    expect(monFirstWeekdayToJs(6)).toBe(0)
    expect(jsWeekdayToMonFirst(0)).toBe(6)
    expect(jsWeekdayToMonFirst(1)).toBe(0)
    expect(jsWeekdayToMonFirst(2)).toBe(1)
  })

  it('rejects out-of-range weekdays', () => {
    expect(monFirstWeekdayToJs(-1)).toBeNull()
    expect(monFirstWeekdayToJs(7)).toBeNull()
    expect(jsWeekdayToMonFirst(7)).toBeNull()
  })

  it('monFirstScheduleToIntervalMs places Monday on week anchor Monday (UTC)', () => {
    // weekAnchor = Monday 2026-07-20 UTC midnight (getUTCDay()=1)
    const weekAnchor = Date.UTC(2026, 6, 20)
    // Product Mon-first weekday 0 = Monday → JS weekday 1
    const mon = monFirstScheduleToIntervalMs({
      weekday: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      weekAnchorMidnightMs: weekAnchor
    })
    expect(mon).not.toBeNull()
    // Same as raw JS weekday 1
    expect(mon).toEqual(
      v1ScheduleToIntervalMs({
        weekday: 1,
        startMinutes: 9 * 60,
        endMinutes: 10 * 60,
        weekAnchorMidnightMs: weekAnchor
      })
    )
    // Product weekday 1 (Tue) is not the same as JS weekday 1 (Mon)
    const tue = monFirstScheduleToIntervalMs({
      weekday: 1,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      weekAnchorMidnightMs: weekAnchor
    })
    expect(tue?.startAtMs).not.toBe(mon?.startAtMs)
    expect(tue?.startAtMs).toBe(mon!.startAtMs + 24 * 60 * 60_000)
  })
})

describe('buildUpdateTaskCommand / updatePlanningTask', () => {
  it('builds update_task envelope with title + inbox category', () => {
    const cmd = buildUpdateTaskCommand(
      { id: 't1', title: '新标题', categoryId: null },
      'act-1',
      1_700
    )
    expect(cmd).toEqual({
      actionId: 'act-1',
      type: 'update_task',
      payload: { id: 't1', title: '新标题', categoryId: null, inbox: true },
      clientIssuedAtMs: 1_700
    })
  })

  it('updatePlanningTask applies CAS and returns ok', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const result = await updatePlanningTask(api, '/ws', {
      id: 't1',
      title: '改名'
    }, { nowMs: () => 5_000 })
    expect(result.ok).toBe(true)
    expect(applied).toHaveLength(1)
    const payload = applied[0] as {
      expectedRevision: number
      command: { type: string; payload: { id: string; title: string } }
    }
    expect(payload.expectedRevision).toBe(1)
    expect(payload.command.type).toBe('update_task')
    expect(payload.command.payload).toMatchObject({ id: 't1', title: '改名' })
  })

  it('applyStudyPlanningCommand rejects bad revision (shared path)', async () => {
    const api = mockApi()
    const result = await applyStudyPlanningCommand(api, '/ws', 0, {
      actionId: 'x',
      type: 'update_task',
      payload: { id: 't' }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_command')
  })
})

describe('dualWriteUpdateTask', () => {
  it('skips when workspace missing', async () => {
    const ctx: CanonicalPlanningContext = { api: mockApi(), workspaceRoot: null }
    const result = await dualWriteUpdateTask(ctx, {
      taskId: 't1',
      update: { title: 'X' }
    })
    expect(result.task).toEqual({ kind: 'canonical_skipped', reason: 'missing_workspace' })
    expect(result.schedule).toBeNull()
  })

  it('publishes update_task for title/category', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: '/ws',
      nowMs: () => 9_000
    }
    const result = await dualWriteUpdateTask(ctx, {
      taskId: 't1',
      update: { title: '周计划作业', categoryId: 'study' }
    })
    expect(result.task?.kind).toBe('canonical_ok')
    expect(result.schedule).toBeNull()
    expect(applied).toHaveLength(1)
    const cmd = (applied[0] as { command: { type: string; payload: Record<string, unknown> } }).command
    expect(cmd.type).toBe('update_task')
    expect(cmd.payload).toMatchObject({
      id: 't1',
      title: '周计划作业',
      categoryId: 'study'
    })
  })

  it('publishes upsert_schedule_block for Mon-first weekday schedule (week drag)', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: '/ws',
      nowMs: () => 9_000
    }
    // Product Mon-first: 0 = Monday
    const weekAnchor = Date.UTC(2026, 6, 20) // Mon UTC
    const result = await dualWriteUpdateTask(ctx, {
      taskId: 't1',
      update: {
        schedule: { weekday: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 }
      },
      weekAnchorMidnightMs: weekAnchor
    })
    expect(result.task).toBeNull()
    expect(result.schedule?.kind).toBe('canonical_ok')
    expect(applied).toHaveLength(1)
    const cmd = (applied[0] as {
      command: { type: string; payload: { block: { startAtMs: number; endAtMs: number; taskId: string } } }
    }).command
    expect(cmd.type).toBe('upsert_schedule_block')
    expect(cmd.payload.block.taskId).toBe('t1')
    const expected = monFirstScheduleToIntervalMs({
      weekday: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      weekAnchorMidnightMs: weekAnchor
    })
    expect(cmd.payload.block.startAtMs).toBe(expected!.startAtMs)
    expect(cmd.payload.block.endAtMs).toBe(expected!.endAtMs)
  })

  it('publishes both update_task and schedule when both present', async () => {
    const types: string[] = []
    const api = mockApi({
      onApply: (p) => {
        types.push((p as { command: { type: string } }).command.type)
      }
    })
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: '/ws',
      nowMs: () => 9_000
    }
    const result = await dualWriteUpdateTask(ctx, {
      taskId: 't1',
      update: {
        title: '拖拽后改名',
        schedule: { weekday: 2, startMinutes: 60, endMinutes: 120 }
      },
      weekAnchorMidnightMs: Date.UTC(2026, 6, 20)
    })
    expect(result.task?.kind).toBe('canonical_ok')
    expect(result.schedule?.kind).toBe('canonical_ok')
    expect(types).toEqual(['update_task', 'upsert_schedule_block'])
  })

  it('buildUpdateTaskPayloadFromV1 ignores schedule-only / done-only', () => {
    expect(
      buildUpdateTaskPayloadFromV1('t', { schedule: { weekday: 0, startMinutes: 0, endMinutes: 60 } })
    ).toBeNull()
    expect(buildUpdateTaskPayloadFromV1('t', { done: true })).toBeNull()
    expect(buildUpdateTaskPayloadFromV1('t', { title: '  ' })).toBeNull()
    expect(buildUpdateTaskPayloadFromV1('t', { title: 'ok', categoryId: null })).toEqual({
      id: 't',
      title: 'ok',
      categoryId: null
    })
  })

  it('resolveDefaultWeekAnchorMidnightMs lands on local Sunday midnight', () => {
    // 2026-07-22 local Wednesday → Sunday 2026-07-19
    const wed = new Date(2026, 6, 22, 15, 30, 0, 0).getTime()
    const anchor = resolveDefaultWeekAnchorMidnightMs(wed)
    const d = new Date(anchor)
    expect(d.getDay()).toBe(0)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })

  it('dualWriteUpsertScheduleFromV1 fail-closed without workspace', async () => {
    const result = await dualWriteUpsertScheduleFromV1(
      { api: mockApi(), workspaceRoot: '  ' },
      {
        taskId: 't',
        schedule: { weekday: 0, startMinutes: 0, endMinutes: 60 },
        weekAnchorMidnightMs: Date.UTC(2026, 6, 20)
      }
    )
    expect(result.kind).toBe('canonical_skipped')
  })
})
