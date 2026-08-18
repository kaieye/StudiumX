import { describe, expect, it } from 'vitest'
import {
  StudyPlanningStore,
  projectTaskPlanVsActual,
  type StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'

describe('StudyPlanningStore (ADR-0011 skeleton / STC-207/208)', () => {
  it('CAS rejects wrong expectedRevision', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1000 })
    const snap = store.readSnapshot()
    expect(snap.revision).toBe(1)
    const bad = store.applyCommand(
      {
        actionId: 'a1',
        type: 'create_task',
        payload: { id: 't1', title: 'X' }
      },
      99
    )
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.error.code).toBe('revision_conflict')
    expect(store.readSnapshot().tasks).toHaveLength(0)
  })

  it('create_task + exact actionId retry is idempotent', () => {
    const store = new StudyPlanningStore({ nowMs: () => 2000 })
    const cmd = {
      actionId: 'create-1',
      type: 'create_task' as const,
      payload: { id: 'task-1', title: '读论文' }
    }
    const first = store.applyCommand(cmd, 1)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.revision).toBe(2)
    expect(first.snapshot.tasks[0]).toMatchObject({
      id: 'task-1',
      title: '读论文',
      inbox: true,
      categoryId: null
    })

    const retry = store.applyCommand(cmd, 1)
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.replayed).toBe(true)
    expect(retry.revision).toBe(2)
    expect(store.readSnapshot().tasks).toHaveLength(1)
  })

  it('single running TimerSession invariant on start', () => {
    let t = 10_000
    const store = new StudyPlanningStore({ nowMs: () => t })
    const s1 = store.applyCommand(
      {
        actionId: 'start-1',
        type: 'start_timer_session',
        payload: { id: 'sess-1', planId: 'classic_25_5', taskId: null }
      },
      1
    )
    expect(s1.ok).toBe(true)
    if (!s1.ok) return
    const s2 = store.applyCommand(
      {
        actionId: 'start-2',
        type: 'start_timer_session',
        payload: { id: 'sess-2', planId: 'classic_25_5', taskId: null }
      },
      s1.revision
    )
    expect(s2.ok).toBe(false)
    if (s2.ok) return
    expect(s2.error.code).toBe('invariant_violation')
  })

  it('start → advance → pause → resume → finish path', () => {
    let t = 1_000_000
    const store = new StudyPlanningStore({ nowMs: () => t })
    let rev = store.readSnapshot().revision
    const start = store.applyCommand(
      {
        actionId: 's',
        type: 'start_timer_session',
        payload: { id: 'sess', planId: 'classic_25_5', taskId: 't' }
      },
      rev
    )
    expect(start.ok).toBe(true)
    if (!start.ok) return
    rev = start.revision

    t += 30_000
    const adv = store.applyCommand(
      {
        actionId: 'adv1',
        type: 'advance_timer_session',
        payload: { sessionId: 'sess', nowMs: t }
      },
      rev
    )
    expect(adv.ok).toBe(true)
    if (!adv.ok) return
    rev = adv.revision
    const running = adv.snapshot.timerSessions.find((s) => s.id === 'sess')
    expect(running?.accumulatedActiveSeconds).toBe(30)

    const paused = store.applyCommand(
      { actionId: 'p', type: 'pause_timer_session', payload: { sessionId: 'sess' } },
      rev
    )
    expect(paused.ok).toBe(true)
    if (!paused.ok) return
    rev = paused.revision

    t += 60_000
    const resumed = store.applyCommand(
      { actionId: 'r', type: 'resume_timer_session', payload: { sessionId: 'sess' } },
      rev
    )
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return
    rev = resumed.revision

    t += 10_000
    const adv2 = store.applyCommand(
      {
        actionId: 'adv2',
        type: 'advance_timer_session',
        payload: { sessionId: 'sess', nowMs: t }
      },
      rev
    )
    expect(adv2.ok).toBe(true)
    if (!adv2.ok) return
    rev = adv2.revision
    expect(adv2.snapshot.timerSessions[0].accumulatedActiveSeconds).toBe(40)

    const fin = store.applyCommand(
      {
        actionId: 'f',
        type: 'finish_timer_session',
        payload: { sessionId: 'sess', reason: 'manual' }
      },
      rev
    )
    expect(fin.ok).toBe(true)
    if (!fin.ok) return
    expect(fin.snapshot.timerSessions[0].state).toBe('completed')
  })

  it('stale advance emits reconcile_required; discard does not credit focus', () => {
    let t = 5_000_000
    const store = new StudyPlanningStore({ nowMs: () => t })
    let rev = 1
    const start = store.applyCommand(
      {
        actionId: 'st',
        type: 'start_timer_session',
        payload: { id: 's', planId: 'classic_25_5', taskId: 'task' }
      },
      rev
    )
    expect(start.ok).toBe(true)
    if (!start.ok) return
    rev = start.revision

    t += 200 * 60_000
    const adv = store.applyCommand(
      {
        actionId: 'adv',
        type: 'advance_timer_session',
        payload: { sessionId: 's', nowMs: t }
      },
      rev
    )
    expect(adv.ok).toBe(true)
    if (!adv.ok) return
    expect(adv.effects.some((e) => e.type === 'reconcile_required')).toBe(true)
    expect(adv.snapshot.timerSessions[0].state).toBe('needs_reconcile')
    rev = adv.revision

    const disc = store.applyCommand(
      {
        actionId: 'd',
        type: 'reconcile_stale_session',
        payload: { sessionId: 's', decision: 'discard_gap' }
      },
      rev
    )
    expect(disc.ok).toBe(true)
    if (!disc.ok) return
    expect(disc.snapshot.timerSessions[0].accumulatedFocusSeconds).toBe(0)
  })

  it('projectTaskPlanVsActual separates plan, focus, break, unattributed (STC-208)', () => {
    const snap: StudyPlanningSnapshotV1 = {
      schema: 'studiumx.study-planning',
      schemaVersion: 1,
      revision: 1,
      updatedAtMs: 0,
      tasks: [],
      scheduleBlocks: [
        {
          id: 'b1',
          taskId: 'T',
          kind: 'focus',
          startAtMs: 0,
          endAtMs: 25 * 60_000,
          locked: false,
          source: 'allocator',
          status: 'planned',
          revision: 1
        }
      ],
      timerPlans: [],
      timerSessions: [
        {
          id: 's1',
          taskId: 'T',
          scheduleBlockId: 'b1',
          phase: 'focus',
          clockMode: 'countdown',
          state: 'completed',
          targetSeconds: 1500,
          startedAtMs: 0,
          lastSampleWallMs: 0,
          accumulatedActiveSeconds: 1200,
          accumulatedFocusSeconds: 1200,
          planSnapshot: null,
          attributionReason: 'explicit',
          focusRoundInPlan: 1
        },
        {
          id: 's2',
          taskId: null,
          scheduleBlockId: null,
          phase: 'focus',
          clockMode: 'countup',
          state: 'completed',
          targetSeconds: null,
          startedAtMs: 0,
          lastSampleWallMs: 0,
          accumulatedActiveSeconds: 300,
          accumulatedFocusSeconds: 300,
          planSnapshot: null,
          attributionReason: 'unattributed',
          focusRoundInPlan: 1
        },
        {
          id: 's3',
          taskId: null,
          scheduleBlockId: null,
          phase: 'short_break',
          clockMode: 'countdown',
          state: 'completed',
          targetSeconds: 300,
          startedAtMs: 0,
          lastSampleWallMs: 0,
          accumulatedActiveSeconds: 300,
          accumulatedFocusSeconds: 0,
          planSnapshot: null,
          attributionReason: 'unattributed',
          focusRoundInPlan: 1
        }
      ],
      preferences: {},
      localAnalyticsHints: {}
    }
    const proj = projectTaskPlanVsActual({
      taskId: 'T',
      scheduleBlocks: snap.scheduleBlocks,
      timerSessions: snap.timerSessions
    })
    expect(proj.plannedFocusSeconds).toBe(25 * 60)
    expect(proj.actualFocusSeconds).toBe(1200)
    expect(proj.unattributedFocusSeconds).toBe(300)
    expect(proj.breakSeconds).toBe(300)
  })

  it('complete_task with future blocks emits need_decision; second complete with decision applies', () => {
    const now = 1_000_000
    const store = new StudyPlanningStore({ nowMs: () => now })
    const c = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 't1', title: '主任务', categoryId: 'study' } },
      1
    )
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const block = store.applyCommand(
      {
        actionId: 'c2',
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
    expect(block.ok).toBe(true)
    if (!block.ok) return

    const first = store.applyCommand(
      { actionId: 'c3', type: 'complete_task', payload: { id: 't1' } },
      block.revision
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.snapshot.tasks.find((t) => t.id === 't1')?.status).toBe('done')
    expect(first.snapshot.scheduleBlocks.find((b) => b.id === 'fb1')?.status).toBe('planned')
    expect(first.effects.some((e) => e.type === 'future_blocks_need_decision')).toBe(true)
    const need = first.effects.find((e) => e.type === 'future_blocks_need_decision')
    expect(need).toMatchObject({ type: 'future_blocks_need_decision', taskId: 't1', blockIds: ['fb1'] })

    // Second complete while already done + wire alias cancel → cancel_blocks.
    const second = store.applyCommand(
      {
        actionId: 'c4',
        type: 'complete_task',
        payload: { id: 't1', futureBlocksDecision: 'cancel' }
      },
      first.revision
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.snapshot.tasks.find((t) => t.id === 't1')?.status).toBe('done')
    expect(second.snapshot.scheduleBlocks.find((b) => b.id === 'fb1')?.status).toBe('cancelled')
    expect(second.effects.some((e) => e.type === 'future_blocks_need_decision')).toBe(false)
  })

  it('complete_task reassign maps future blocks to target taskId (already done)', () => {
    const now = 2_000_000
    const store = new StudyPlanningStore({ nowMs: () => now })
    let rev = 1
    for (const [id, title] of [
      ['t1', '完成'],
      ['t2', '接手']
    ] as const) {
      const r = store.applyCommand(
        { actionId: `create:${id}`, type: 'create_task', payload: { id, title, categoryId: 'study' } },
        rev
      )
      expect(r.ok).toBe(true)
      if (!r.ok) return
      rev = r.revision
    }
    const block = store.applyCommand(
      {
        actionId: 'b1',
        type: 'upsert_schedule_block',
        payload: {
          block: {
            id: 'fb2',
            taskId: 't1',
            kind: 'focus',
            startAtMs: now + 60_000,
            endAtMs: now + 120_000,
            locked: false,
            source: 'manual',
            status: 'planned',
            revision: 1
          }
        }
      },
      rev
    )
    expect(block.ok).toBe(true)
    if (!block.ok) return
    const done = store.applyCommand(
      { actionId: 'done', type: 'complete_task', payload: { id: 't1' } },
      block.revision
    )
    expect(done.ok).toBe(true)
    if (!done.ok) return
    const reassigned = store.applyCommand(
      {
        actionId: 're',
        type: 'complete_task',
        payload: { id: 't1', futureBlocksDecision: 'reassign', reassignTaskId: 't2' }
      },
      done.revision
    )
    expect(reassigned.ok).toBe(true)
    if (!reassigned.ok) return
    expect(reassigned.snapshot.scheduleBlocks.find((b) => b.id === 'fb2')?.taskId).toBe('t2')
    expect(reassigned.snapshot.scheduleBlocks.find((b) => b.id === 'fb2')?.status).toBe('planned')
  })
  it('complete_task with inbox suggests classification without blocking', () => {
    const store = new StudyPlanningStore({ nowMs: () => 9 })
    const c = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 'i1', title: '临时' } },
      1
    )
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const done = store.applyCommand(
      { actionId: 'c2', type: 'complete_task', payload: { id: 'i1' } },
      c.revision
    )
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.snapshot.tasks[0].status).toBe('done')
    expect(done.effects.some((e) => e.type === 'classification_prompt_suggested')).toBe(true)
  })

  it('save_timer_plan refuses silent truncate above 12', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    let rev = 1
    for (let i = 0; i < 11; i += 1) {
      const r = store.applyCommand(
        {
          actionId: `plan-${i}`,
          type: 'save_timer_plan',
          payload: {
            plan: {
              id: `p${i}`,
              name: `P${i}`,
              kind: 'pomodoro',
              clockMode: 'countdown',
              focusMinutes: 25,
              shortBreakMinutes: 5,
              longBreakMinutes: 15,
              longBreakEvery: 4,
              breakPolicy: 'ask',
              windowFillPolicy: 'adaptive_final_focus',
              minimumFinalFocusMinutes: 15,
              wrapUpMinutes: 5,
              notificationPolicy: {
                sound: true,
                systemNotification: true,
                focusEnd: true,
                breakEnd: true
              },
              revision: 1
            }
          }
        },
        rev
      )
      expect(r.ok).toBe(true)
      if (!r.ok) return
      rev = r.revision
    }
    // seed classic + 11 = 12; next must fail
    const over = store.applyCommand(
      {
        actionId: 'plan-over',
        type: 'save_timer_plan',
        payload: {
          plan: {
            id: 'overflow',
            name: 'over',
            kind: 'pomodoro',
            clockMode: 'countdown',
            focusMinutes: 25,
            shortBreakMinutes: 5,
            longBreakMinutes: 15,
            longBreakEvery: 4,
            breakPolicy: 'ask',
            windowFillPolicy: 'adaptive_final_focus',
            minimumFinalFocusMinutes: 15,
            wrapUpMinutes: 5,
            notificationPolicy: {
              sound: true,
              systemNotification: true,
              focusEnd: true,
              breakEnd: true
            },
            revision: 1
          }
        }
      },
      rev
    )
    expect(over.ok).toBe(false)
    if (over.ok) return
    expect(over.error.code).toBe('invariant_violation')
  })
})


describe('start_timer_session phase', () => {
  it('starts short_break TimerSession when phase is set', () => {
    const store = new StudyPlanningStore({ nowMs: () => 5000 })
    const base = store.readSnapshot()
    const result = store.applyCommand(
      {
        actionId: 'start-break-1',
        type: 'start_timer_session',
        payload: {
          id: 'ts-break-1',
          planId: 'classic_25_5',
          phase: 'short_break',
          taskId: null,
          targetSeconds: 300
        }
      },
      base.revision
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const session = result.snapshot.timerSessions.find((s) => s.id === 'ts-break-1')
    expect(session?.phase).toBe('short_break')
    expect(session?.taskId).toBeNull()
    expect(session?.state).toBe('running')
    expect(session?.targetSeconds).toBe(300)
  })
})


describe('delete_schedule_block (STC-307)', () => {
  it('removes a focus block by id and emits schedule_block_deleted', () => {
    const now = 3_000_000
    const store = new StudyPlanningStore({ nowMs: () => now })
    const created = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 't1', title: '多块', categoryId: 'study' } },
      1
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    let rev = created.revision
    for (const [id, start] of [
      ['b1', now + 60_000],
      ['b2', now + 3_600_000]
    ] as const) {
      const r = store.applyCommand(
        {
          actionId: `up:${id}`,
          type: 'upsert_schedule_block',
          payload: {
            block: {
              id,
              taskId: 't1',
              kind: 'focus',
              startAtMs: start,
              endAtMs: start + 1_800_000,
              locked: false,
              source: 'manual',
              status: 'planned',
              revision: 1
            }
          }
        },
        rev
      )
      expect(r.ok).toBe(true)
      if (!r.ok) return
      rev = r.revision
    }
    expect(rev).toBeGreaterThan(1)

    const deleted = store.applyCommand(
      {
        actionId: 'del1',
        type: 'delete_schedule_block',
        payload: { blockId: 'b1' }
      },
      rev
    )
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.snapshot.scheduleBlocks.map((b) => b.id)).toEqual(['b2'])
    expect(deleted.effects).toContainEqual({
      type: 'schedule_block_deleted',
      blockId: 'b1',
      taskId: 't1'
    })
  })

  it('returns not_found for missing block id', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const r = store.applyCommand(
      { actionId: 'd', type: 'delete_schedule_block', payload: { blockId: 'missing' } },
      1
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('not_found')
  })

  it('refuses locked blocks', () => {
    const now = 4_000_000
    const store = new StudyPlanningStore({ nowMs: () => now })
    const created = store.applyCommand(
      { actionId: 'c1', type: 'create_task', payload: { id: 't1', title: '锁', categoryId: 'study' } },
      1
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const up = store.applyCommand(
      {
        actionId: 'up',
        type: 'upsert_schedule_block',
        payload: {
          block: {
            id: 'locked-b',
            taskId: 't1',
            kind: 'focus',
            startAtMs: now,
            endAtMs: now + 60_000,
            locked: true,
            source: 'manual',
            status: 'planned',
            revision: 1
          }
        }
      },
      created.revision
    )
    expect(up.ok).toBe(true)
    if (!up.ok) return
    const del = store.applyCommand(
      { actionId: 'del', type: 'delete_schedule_block', payload: { blockId: 'locked-b' } },
      up.revision
    )
    expect(del.ok).toBe(false)
    if (del.ok) return
    expect(del.error.code).toBe('invariant_violation')
  })
})
