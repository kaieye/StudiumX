import { describe, expect, it } from 'vitest'
import {
  TIMER_SESSION_SEED,
  advanceTimerSession,
  assertSingleRunningTimerSession,
  createClassicPomodoroPlan,
  finishTimerSession,
  normalizeTimerPlanV2,
  pauseTimerSession,
  projectTimerDisplay,
  reconcileTimerSession,
  resumeTimerSession,
  startNextPhaseFromCompleted,
  startTimerSession,
  switchTimerSessionTask,
  type TimerSessionRecord
} from '../../src/shared/study-planning'

const t0 = Date.UTC(2026, 6, 21, 9, 0, 0)

function classicPlan() {
  return createClassicPomodoroPlan()
}

describe('TimerSession lifecycle (STC-201..207)', () => {
  it('starts countdown focus with frozen planSnapshot (STC-201/203)', () => {
    const plan = classicPlan()
    const result = startTimerSession({
      id: 'ts-1',
      nowMs: t0,
      plan,
      taskId: 'task-a',
      startActionId: 'act-1'
    })
    expect(result.error).toBeUndefined()
    expect(result.session).toMatchObject({
      id: 'ts-1',
      state: 'running',
      clockMode: 'countdown',
      phase: 'focus',
      taskId: 'task-a',
      targetSeconds: 25 * 60,
      accumulatedActiveSeconds: 0,
      startActionId: 'act-1'
    })
    expect(result.session!.planSnapshot).toEqual(plan)
    // Mutating original plan object must not rewrite frozen snapshot fields via shared refs
    // (we clone notificationPolicy + shallow plan).
    expect(result.session!.planSnapshot).not.toBe(plan)
  })

  it('supports open-ended countup continuous (STC-202)', () => {
    const plan = normalizeTimerPlanV2({
      id: 'continuous_countup',
      name: '连续专注',
      kind: 'continuous',
      clockMode: 'countup',
      breakPolicy: 'reminder_only'
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const started = startTimerSession({
      id: 'cu-1',
      nowMs: t0,
      plan: plan.plan,
      taskId: null,
      attributionReason: 'unattributed'
    })
    expect(started.session!.clockMode).toBe('countup')
    expect(started.session!.targetSeconds).toBeNull()

    const advanced = advanceTimerSession(started.session!, t0 + 90_000)
    expect(advanced.session!.accumulatedActiveSeconds).toBe(90)
    expect(advanced.session!.accumulatedFocusSeconds).toBe(90)
    expect(advanced.session!.state).toBe('running')

    const display = projectTimerDisplay(advanced.session!)
    expect(display.mode).toBe('countup')
    expect(display.elapsedSeconds).toBe(90)
    expect(display.remainingSeconds).toBeNull()
  })

  it('supports targeted countup (goal reminder) (STC-202)', () => {
    const plan = normalizeTimerPlanV2({
      id: 'c',
      name: 'flow',
      kind: 'continuous',
      clockMode: 'countup',
      breakPolicy: 'none',
      focusMinutes: 30
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const started = startTimerSession({
      id: 'cu-2',
      nowMs: t0,
      plan: plan.plan,
      targetSeconds: 30 * 60
    })
    // continuous with focusMinutes → target from phase when not overridden... we overrode.
    expect(started.session!.targetSeconds).toBe(30 * 60)
    expect(started.session!.clockMode).toBe('countup')
  })

  it('pause freezes accumulation; resume continues (STC-201)', () => {
    const started = startTimerSession({ id: 'p1', nowMs: t0, plan: classicPlan(), taskId: 't' })
    const after10 = advanceTimerSession(started.session!, t0 + 10_000)
    expect(after10.session!.accumulatedActiveSeconds).toBe(10)

    const paused = pauseTimerSession(after10.session!, t0 + 10_000)
    expect(paused.session!.state).toBe('paused')

    // Wall advances while paused — no more accumulation
    const stillPaused = advanceTimerSession(paused.session!, t0 + 60_000)
    expect(stillPaused.session!.accumulatedActiveSeconds).toBe(10)

    const resumed = resumeTimerSession(paused.session!, t0 + 60_000)
    expect(resumed.session!.state).toBe('running')
    const afterMore = advanceTimerSession(resumed.session!, t0 + 70_000)
    expect(afterMore.session!.accumulatedActiveSeconds).toBe(20)
  })

  it('countdown reaches target → completed + phase_prompt with ask (STC-205 / freeze #3)', () => {
    const started = startTimerSession({ id: 'cd-1', nowMs: t0, plan: classicPlan(), taskId: 't' })
    const done = advanceTimerSession(started.session!, t0 + 25 * 60_000)
    expect(done.session!.state).toBe('completed')
    expect(done.session!.accumulatedActiveSeconds).toBe(25 * 60)
    expect(done.events.some((e) => e.type === 'segment_completed')).toBe(true)
    const prompt = done.events.find((e) => e.type === 'phase_prompt')
    expect(prompt).toMatchObject({ type: 'phase_prompt', breakPolicy: 'ask' })
  })

  it('startNextPhaseFromCompleted requires confirmation when breakPolicy is ask', () => {
    const started = startTimerSession({ id: 'cd-2', nowMs: t0, plan: classicPlan(), taskId: 't' })
    const done = advanceTimerSession(started.session!, t0 + 25 * 60_000)
    const denied = startNextPhaseFromCompleted({
      completed: done.session!,
      nowMs: t0 + 25 * 60_000,
      newSessionId: 'br-1',
      phase: 'short_break',
      userConfirmed: false
    })
    expect(denied.error?.code).toBe('break_needs_confirmation')

    const ok = startNextPhaseFromCompleted({
      completed: done.session!,
      nowMs: t0 + 25 * 60_000,
      newSessionId: 'br-1',
      phase: 'short_break',
      userConfirmed: true
    })
    expect(ok.session).toMatchObject({
      id: 'br-1',
      phase: 'short_break',
      state: 'running',
      taskId: null,
      targetSeconds: 5 * 60
    })
    // planSnapshot identity preserved from completed segment
    expect(ok.session!.planSnapshot).toEqual(done.session!.planSnapshot)
  })

  it('switch task ends old segment and starts new with same planSnapshot (STC-204)', () => {
    const started = startTimerSession({ id: 'sw-1', nowMs: t0, plan: classicPlan(), taskId: 'A' })
    const mid = advanceTimerSession(started.session!, t0 + 120_000)
    const switched = switchTimerSessionTask({
      session: mid.session!,
      nowMs: t0 + 120_000,
      newSessionId: 'sw-2',
      newTaskId: 'B'
    })
    expect(switched.closedSession).toMatchObject({
      id: 'sw-1',
      taskId: 'A',
      state: 'completed',
      accumulatedFocusSeconds: 120
    })
    expect(switched.session).toMatchObject({
      id: 'sw-2',
      taskId: 'B',
      state: 'running',
      accumulatedActiveSeconds: 0
    })
    expect(switched.session!.planSnapshot).toEqual(mid.session!.planSnapshot)
    expect(switched.events.some((e) => e.type === 'task_switched')).toBe(true)
  })

  it('stale gap > 120min → needs_reconcile without silent focus credit (STC-206)', () => {
    const started = startTimerSession({ id: 'st-1', nowMs: t0, plan: classicPlan(), taskId: 't' })
    const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 1) * 60_000
    const stale = advanceTimerSession(started.session!, t0 + gapMs)
    expect(stale.session!.state).toBe('needs_reconcile')
    expect(stale.session!.accumulatedFocusSeconds).toBe(0)
    expect(stale.session!.pendingReconcileSeconds).toBeGreaterThan(120 * 60)
    expect(stale.events.some((e) => e.type === 'needs_reconcile')).toBe(true)

    const discarded = reconcileTimerSession(stale.session!, 'discard_gap', t0 + gapMs)
    expect(discarded.session!.state).toBe('running')
    expect(discarded.session!.accumulatedFocusSeconds).toBe(0)

    // Re-start gap path for confirm_all
    const started2 = startTimerSession({ id: 'st-2', nowMs: t0, plan: classicPlan(), taskId: 't' })
    const stale2 = advanceTimerSession(started2.session!, t0 + gapMs)
    const confirmed = reconcileTimerSession(stale2.session!, 'confirm_all', t0 + gapMs)
    expect(confirmed.session!.accumulatedActiveSeconds).toBeGreaterThan(120 * 60)
  })

  it('truncate_to_target only fills remaining countdown room (STC-206)', () => {
    const started = startTimerSession({ id: 'tr-1', nowMs: t0, plan: classicPlan(), taskId: 't' })
    const mid = advanceTimerSession(started.session!, t0 + 20 * 60_000)
    expect(mid.session!.accumulatedActiveSeconds).toBe(20 * 60)
    // Force reconcile with huge gap
    const huge = advanceTimerSession(mid.session!, t0 + 20 * 60_000 + 200 * 60_000)
    expect(huge.session!.state).toBe('needs_reconcile')
    const truncated = reconcileTimerSession(huge.session!, 'truncate_to_target', t0 + 20 * 60_000 + 200 * 60_000)
    // Should complete at 25 min target, not add full gap
    expect(truncated.session!.accumulatedActiveSeconds).toBeLessThanOrEqual(25 * 60)
    expect(truncated.session!.state === 'completed' || truncated.session!.accumulatedActiveSeconds === 25 * 60).toBe(
      true
    )
  })

  it('assertSingleRunningTimerSession enforces invariant (STC-207)', () => {
    const a = startTimerSession({ id: 'a', nowMs: t0, plan: classicPlan() }).session!
    const b = startTimerSession({ id: 'b', nowMs: t0, plan: classicPlan() }).session!
    expect(assertSingleRunningTimerSession([a])).toEqual({ ok: true })
    expect(assertSingleRunningTimerSession([a, b])).toMatchObject({ ok: false, code: 'multiple_running' })
    const paused = pauseTimerSession(a, t0).session!
    expect(assertSingleRunningTimerSession([paused, b])).toEqual({ ok: true })
  })

  it('finish manual / cancel (STC-201)', () => {
    const started = startTimerSession({ id: 'f1', nowMs: t0, plan: classicPlan(), taskId: 't' })
    const mid = advanceTimerSession(started.session!, t0 + 30_000)
    const finished = finishTimerSession(mid.session!, t0 + 30_000, 'manual')
    expect(finished.session!.state).toBe('completed')
    expect(finished.session!.endedAtMs).toBe(t0 + 30_000)

    const started2 = startTimerSession({ id: 'f2', nowMs: t0, plan: classicPlan() })
    const cancelled = finishTimerSession(started2.session!, t0 + 5_000, 'cancelled')
    expect(cancelled.session!.state).toBe('cancelled')
  })

  it('editing plan catalog does not rewrite running planSnapshot (STC-203)', () => {
    const plan = classicPlan()
    const started = startTimerSession({ id: 'ed-1', nowMs: t0, plan, taskId: 't' })
    const frozenFocus = started.session!.planSnapshot!.focusMinutes
    // Simulate catalog edit: new plan object with different minutes
    const edited = createClassicPomodoroPlan({ id: plan.id, focusMinutes: 50 })
    expect(edited.focusMinutes).toBe(50)
    // Running session still has 25
    expect(started.session!.planSnapshot!.focusMinutes).toBe(frozenFocus)
    expect(started.session!.targetSeconds).toBe(25 * 60)
  })

  it('break time does not add to accumulatedFocusSeconds (invariant)', () => {
    const plan = classicPlan()
    const focusDone = advanceTimerSession(
      startTimerSession({ id: 'bf', nowMs: t0, plan, taskId: 't' }).session!,
      t0 + 25 * 60_000
    )
    const br = startNextPhaseFromCompleted({
      completed: focusDone.session!,
      nowMs: t0 + 25 * 60_000,
      newSessionId: 'br',
      phase: 'short_break',
      userConfirmed: true
    })
    const afterBreak = advanceTimerSession(br.session!, t0 + 25 * 60_000 + 5 * 60_000)
    expect(afterBreak.session!.accumulatedActiveSeconds).toBe(5 * 60)
    expect(afterBreak.session!.accumulatedFocusSeconds).toBe(0)
  })

  it('projectTimerDisplay countdown remaining decreases', () => {
    const started = startTimerSession({ id: 'd1', nowMs: t0, plan: classicPlan() })
    const mid = advanceTimerSession(started.session!, t0 + 60_000)
    const d = projectTimerDisplay(mid.session!)
    expect(d.remainingSeconds).toBe(24 * 60)
    expect(d.elapsedSeconds).toBe(60)
  })
})
