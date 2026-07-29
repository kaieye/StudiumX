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
    task({ id: 'overdue', title: 'Overdue', dueAtMs: now - 60 * 60_000 }),
    task({ id: 'today-due', title: 'Due today', dueAtMs: now + 2 * 60 * 60_000 }),
    task({ id: 'today-block', title: 'Scheduled today', inbox: false, categoryId: 'study' }),
    task({ id: 'future-block', title: 'Scheduled later', inbox: false, categoryId: 'study' }),
    task({ id: 'unscheduled', title: 'No date' }),
    task({ id: 'done', title: 'Done', status: 'done', inbox: false, categoryId: 'study' })
  ]
  const blocks = [
    block({
      id: 'today',
      taskId: 'today-block',
      startAtMs: dayStart + 14 * 3600_000,
      endAtMs: dayStart + 15 * 3600_000
    }),
    block({
      id: 'future',
      taskId: 'future-block',
      startAtMs: dayEnd + 9 * 3600_000,
      endAtMs: dayEnd + 10 * 3600_000
    })
  ]

  it('today includes only open tasks due today or overdue, or with a non-cancelled block today', () => {
    const items = projectTaskTimeline({
      view: 'today',
      tasks,
      scheduleBlocks: blocks,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      nowMs: now
    })
    expect(items.map((i) => i.task.id)).toEqual(['overdue', 'today-due', 'today-block'])
  })

  it('unfinished includes all open tasks and orders them by urgency', () => {
    const items = projectTaskTimeline({
      view: 'unfinished',
      tasks,
      scheduleBlocks: blocks,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      nowMs: now
    })
    expect(items.map((i) => i.task.id)).toEqual([
      'overdue',
      'today-due',
      'today-block',
      'future-block',
      'unscheduled'
    ])
  })

  it('all keeps cancelled tasks out and puts open tasks before completed ones', () => {
    const items = projectTaskTimeline({
      view: 'all',
      tasks: [...tasks, task({ id: 'cancelled', title: 'Cancelled', status: 'cancelled' })],
      scheduleBlocks: blocks,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      nowMs: now
    })
    expect(items.map((i) => i.task.id)).toEqual([
      'overdue',
      'today-due',
      'today-block',
      'future-block',
      'unscheduled',
      'done'
    ])
  })

  it('ignores cancelled blocks when projecting today and calculating planned focus', () => {
    const scheduled = task({ id: 'scheduled', title: 'Scheduled' })
    const cancelledBlock = block({
      id: 'cancelled-block',
      taskId: 'scheduled',
      startAtMs: dayStart + 11 * 3600_000,
      endAtMs: dayStart + 12 * 3600_000,
      status: 'cancelled'
    })
    const items = projectTaskTimeline({
      view: 'today',
      tasks: [scheduled],
      scheduleBlocks: [cancelledBlock],
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      nowMs: now
    })
    expect(items).toEqual([])

    const allItems = projectTaskTimeline({
      view: 'all',
      tasks: [scheduled],
      scheduleBlocks: [cancelledBlock],
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      nowMs: now
    })
    expect(allItems[0]?.plannedFocusSeconds).toBe(0)
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
describe('diffScheduleBlocks (pure set-diff; historical STC-308 UI removed)', () => {
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
      categoryId: 'other',
      inbox: false,
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
