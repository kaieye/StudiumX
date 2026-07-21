import { describe, expect, it } from 'vitest'
import {
  StudyPlanningStore,
  applyClassificationAction,
  applyCompleteTaskFutureBlocks,
  diffScheduleBlocks,
  projectTaskTimeline,
  resolveEmptyStart,
  shouldShowClassificationPrompt,
  type PlanningTask,
  type ScheduleBlock
} from '../../src/shared/study-planning'

const dayStart = Date.UTC(2026, 6, 21)
const dayEnd = dayStart + 24 * 60 * 60_000
const now = dayStart + 10 * 60 * 60_000 // 10:00

function task(partial: Partial<PlanningTask> & Pick<PlanningTask, 'id' | 'title'>): PlanningTask {
  return {
    status: 'open',
    categoryId: null,
    inbox: true,
    splittable: true,
    revision: 1,
    source: 'manual',
    estimateMinutes: null,
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

describe('projectTaskTimeline (STC-302..305)', () => {
  const tasks = [
    task({ id: 'a', title: 'A', inbox: false, categoryId: 'study' }),
    task({ id: 'b', title: 'B', inbox: true }),
    task({ id: 'c', title: 'C', status: 'done', inbox: false, categoryId: 'study' })
  ]
  const blocks = [
    block({ id: 'b1', taskId: 'a', startAtMs: dayStart + 9 * 3600_000, endAtMs: dayStart + 9.5 * 3600_000 }),
    block({ id: 'b2', taskId: 'a', startAtMs: dayStart + 14 * 3600_000, endAtMs: dayStart + 15 * 3600_000 }),
    block({ id: 'b3', taskId: 'c', startAtMs: dayStart + 8 * 3600_000, endAtMs: dayStart + 9 * 3600_000 })
  ]

  it('inbox view only inbox tasks; preserves manual order', () => {
    const items = projectTaskTimeline({
      view: 'inbox',
      tasks,
      scheduleBlocks: blocks,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      nowMs: now
    })
    expect(items.map((i) => i.task.id)).toEqual(['b'])
  })

  it('today sorts by next block without mutating manualOrder field', () => {
    const items = projectTaskTimeline({
      view: 'today',
      tasks,
      scheduleBlocks: blocks,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      nowMs: now
    })
    // a has next block at 14:00; b has none (infinity); c done with today block
    expect(items.find((i) => i.task.id === 'a')?.manualOrder).toBe(0)
    const a = items.find((i) => i.task.id === 'a')
    expect(a?.blocks).toHaveLength(2)
    expect(a?.nextBlockStartAtMs).toBe(dayStart + 14 * 3600_000)
  })

  it('done view lists completed tasks', () => {
    const items = projectTaskTimeline({
      view: 'done',
      tasks,
      scheduleBlocks: blocks,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      nowMs: now
    })
    expect(items.map((i) => i.task.id)).toEqual(['c'])
  })
})

describe('applyCompleteTaskFutureBlocks (STC-306 / freeze #7)', () => {
  it('requires decision when future blocks exist', () => {
    const t = task({ id: 't', title: 'T' })
    const blocks = [
      block({ id: 'f1', taskId: 't', startAtMs: now + 3600_000, endAtMs: now + 7200_000 })
    ]
    const r = applyCompleteTaskFutureBlocks({ task: t, scheduleBlocks: blocks, nowMs: now })
    expect(r.requiresDecision).toBe(true)
    expect(r.task.status).toBe('done')
    expect(r.futureBlockIds).toEqual(['f1'])
  })

  it('cancel_blocks marks future cancelled', () => {
    const t = task({ id: 't', title: 'T' })
    const blocks = [
      block({ id: 'f1', taskId: 't', startAtMs: now + 3600_000, endAtMs: now + 7200_000 })
    ]
    const r = applyCompleteTaskFutureBlocks({
      task: t,
      scheduleBlocks: blocks,
      nowMs: now,
      decision: 'cancel_blocks'
    })
    expect(r.requiresDecision).toBe(false)
    expect(r.scheduleBlocks[0].status).toBe('cancelled')
  })
})

  it('keep_as_review leaves future blocks planned', () => {
    const t = task({ id: 't', title: 'T' })
    const blocks = [
      block({ id: 'f1', taskId: 't', startAtMs: now + 3600_000, endAtMs: now + 7200_000 })
    ]
    const r = applyCompleteTaskFutureBlocks({
      task: t,
      scheduleBlocks: blocks,
      nowMs: now,
      decision: 'keep_as_review'
    })
    expect(r.requiresDecision).toBe(false)
    expect(r.scheduleBlocks[0].status).toBe('planned')
    expect(r.scheduleBlocks[0].taskId).toBe('t')
  })

  it('reassign moves future blocks to target task', () => {
    const t = task({ id: 't', title: 'T' })
    const blocks = [
      block({ id: 'f1', taskId: 't', startAtMs: now + 3600_000, endAtMs: now + 7200_000 })
    ]
    const r = applyCompleteTaskFutureBlocks({
      task: t,
      scheduleBlocks: blocks,
      nowMs: now,
      decision: 'reassign',
      reassignTaskId: 'other'
    })
    expect(r.requiresDecision).toBe(false)
    expect(r.scheduleBlocks[0].taskId).toBe('other')
    expect(r.scheduleBlocks[0].status).toBe('planned')
  })

  it('second call with decision after requiresDecision applies disposition on already-done task', () => {
    const t = task({ id: 't', title: 'T' })
    const blocks = [
      block({ id: 'f1', taskId: 't', startAtMs: now + 3600_000, endAtMs: now + 7200_000 })
    ]
    const first = applyCompleteTaskFutureBlocks({ task: t, scheduleBlocks: blocks, nowMs: now })
    expect(first.requiresDecision).toBe(true)
    const second = applyCompleteTaskFutureBlocks({
      task: first.task,
      scheduleBlocks: first.scheduleBlocks,
      nowMs: now,
      decision: 'cancel_blocks'
    })
    expect(second.requiresDecision).toBe(false)
    expect(second.task.status).toBe('done')
    expect(second.scheduleBlocks[0].status).toBe('cancelled')
  })
describe('diffScheduleBlocks (STC-308)', () => {
  it('reports added and removed by id', () => {
    const a = block({ id: '1', taskId: 't', startAtMs: 0, endAtMs: 1 })
    const b = block({ id: '2', taskId: 't', startAtMs: 2, endAtMs: 3 })
    const d = diffScheduleBlocks([a], [a, b])
    expect(d.added.map((x) => x.id)).toEqual(['2'])
    expect(d.removed).toEqual([])
  })
})

describe('empty-start + classification (STC-401..407)', () => {
  it('default ask_every_time without choice asks', () => {
    expect(resolveEmptyStart({ policy: 'ask_every_time' })).toEqual({
      action: 'ask',
      policy: 'ask_every_time'
    })
  })

  it('does not silently pick first open task', () => {
    const r = resolveEmptyStart({
      policy: 'ask_every_time',
      userChoice: 'unattributed'
    })
    expect(r).toEqual({ action: 'unattributed' })
  })

  it('remember policies resolve without dialog', () => {
    expect(resolveEmptyStart({ policy: 'remember_quick_start' })).toEqual({ action: 'quick_start' })
    expect(resolveEmptyStart({ policy: 'remember_unattributed' })).toEqual({ action: 'unattributed' })
  })

  it('classification prompt non-blocking; never_prompt opts out', () => {
    expect(
      shouldShowClassificationPrompt({
        taskInbox: true,
        taskStatus: 'done',
        classificationPromptOptOut: false
      }).showPrompt
    ).toBe(true)
    const applied = applyClassificationAction({
      categoryId: null,
      inbox: true,
      action: 'never_prompt',
      preferences: { classificationPromptOptOut: false }
    })
    expect(applied.preferences.classificationPromptOptOut).toBe(true)
    // task completion fields unchanged by never_prompt alone
    expect(applied.inbox).toBe(true)
  })

  it('classify sets category and clears inbox', () => {
    const applied = applyClassificationAction({
      categoryId: null,
      inbox: true,
      action: 'classify',
      selectedCategoryId: 'study',
      preferences: { classificationPromptOptOut: false }
    })
    expect(applied).toMatchObject({ categoryId: 'study', inbox: false })
  })
})

describe('StudyPlanningStore Phase 3/4 commands', () => {
  it('apply_allocation_proposal appends blocks without moving locked', () => {
    const store = new StudyPlanningStore({ nowMs: () => now })
    // seed locked block
    let rev = 1
    const up = store.applyCommand(
      {
        actionId: 'lock',
        type: 'upsert_schedule_block',
        payload: {
          block: block({
            id: 'locked',
            taskId: 'x',
            startAtMs: now,
            endAtMs: now + 30 * 60_000,
            locked: true
          })
        }
      },
      rev
    )
    expect(up.ok).toBe(true)
    if (!up.ok) return
    rev = up.revision

    const applied = store.applyCommand(
      {
        actionId: 'alloc',
        type: 'apply_allocation_proposal',
        payload: {
          planId: 'classic_25_5',
          blocks: [
            {
              kind: 'focus',
              startAtMs: now + 5 * 60_000,
              endAtMs: now + 20 * 60_000,
              taskId: 'y'
            },
            {
              kind: 'focus',
              startAtMs: now + 40 * 60_000,
              endAtMs: now + 60 * 60_000,
              taskId: 'y'
            }
          ]
        }
      },
      rev
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    // overlap with locked skipped; only second block added
    const ids = applied.snapshot.scheduleBlocks.map((b) => b.id)
    expect(ids).toContain('locked')
    expect(applied.snapshot.scheduleBlocks.filter((b) => b.taskId === 'y')).toHaveLength(1)
  })

  it('quick_start creates at most one task + session', () => {
    const store = new StudyPlanningStore({ nowMs: () => now })
    const r = store.applyCommand(
      {
        actionId: 'qs',
        type: 'quick_start',
        payload: {
          taskId: 'tmp-1',
          sessionId: 'sess-qs',
          title: '临时'
        }
      },
      1
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.tasks).toHaveLength(1)
    expect(r.snapshot.tasks[0]).toMatchObject({
      id: 'tmp-1',
      inbox: true,
      source: 'quick_start'
    })
    expect(r.snapshot.timerSessions).toHaveLength(1)
    expect(r.snapshot.timerSessions[0].taskId).toBe('tmp-1')
  })

  it('complete_task with future blocks emits future_blocks_need_decision', () => {
    const store = new StudyPlanningStore({ nowMs: () => now })
    let rev = 1
    const c = store.applyCommand(
      { actionId: 't', type: 'create_task', payload: { id: 'task-f', title: 'F' } },
      rev
    )
    expect(c.ok).toBe(true)
    if (!c.ok) return
    rev = c.revision
    const u = store.applyCommand(
      {
        actionId: 'b',
        type: 'upsert_schedule_block',
        payload: {
          block: block({
            id: 'future',
            taskId: 'task-f',
            startAtMs: now + 7200_000,
            endAtMs: now + 9000_000
          })
        }
      },
      rev
    )
    expect(u.ok).toBe(true)
    if (!u.ok) return
    rev = u.revision
    const done = store.applyCommand(
      { actionId: 'd', type: 'complete_task', payload: { id: 'task-f' } },
      rev
    )
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.snapshot.tasks[0].status).toBe('done')
    expect(done.effects.some((e) => e.type === 'future_blocks_need_decision')).toBe(true)
    // block not cancelled until decision
    expect(done.snapshot.scheduleBlocks[0].status).toBe('planned')
  })
})
