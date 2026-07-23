/**
 * Pure host intents after focus/break handoff (STC-205 disposition tables).
 */

import { describe, expect, it } from 'vitest'
import {
  createClassicPomodoroPlan,
  projectBreakEndHandoffPlan,
  projectPhaseHandoffPlan,
  resolveBreakEndAnswerIntent,
  resolveBreakEndHandoffIntent,
  resolveFocusCompleteHandoffIntent,
  resolvePhasePromptAnswerIntent,
  startTimerSession,
  type TimerSessionRecord
} from '../../src/shared/study-planning'

function completedFocus(overrides: Partial<TimerSessionRecord> = {}): TimerSessionRecord {
  const plan = createClassicPomodoroPlan()
  const started = startTimerSession({
    id: 'f1',
    nowMs: 1_000,
    plan,
    taskId: 't1',
    phase: 'focus'
  }).session!
  return {
    ...started,
    state: 'completed',
    endedAtMs: 1_000 + 25 * 60_000,
    accumulatedActiveSeconds: 25 * 60,
    accumulatedFocusSeconds: 25 * 60,
    ...overrides
  }
}

function completedBreak(overrides: Partial<TimerSessionRecord> = {}): TimerSessionRecord {
  const plan = createClassicPomodoroPlan()
  const started = startTimerSession({
    id: 'b1',
    nowMs: 1_000,
    plan,
    taskId: null,
    phase: 'short_break'
  }).session!
  return {
    ...started,
    state: 'completed',
    endedAtMs: 1_000 + 5 * 60_000,
    accumulatedActiveSeconds: 5 * 60,
    focusRoundInPlan: 1,
    ...overrides
  }
}

describe('resolveFocusCompleteHandoffIntent', () => {
  it('maps ask → prompt with break minutes', () => {
    const handoff = projectPhaseHandoffPlan(completedFocus({ focusRoundInPlan: 1 }))!
    expect(resolveFocusCompleteHandoffIntent(handoff)).toEqual({
      kind: 'prompt',
      breakMinutes: 5
    })
  })

  it('maps automatic → auto_start_break', () => {
    const plan = createClassicPomodoroPlan({ breakPolicy: 'automatic' })
    const handoff = projectPhaseHandoffPlan(completedFocus({ planSnapshot: plan }))!
    expect(resolveFocusCompleteHandoffIntent(handoff).kind).toBe('auto_start_break')
  })

  it('maps reminder_only → remind with notify copy', () => {
    // createClassicPomodoroPlan may coerce pomodoro reminder_only → ask; force snapshot.
    const plan = {
      ...createClassicPomodoroPlan(),
      breakPolicy: 'reminder_only' as const
    }
    const handoff = projectPhaseHandoffPlan(completedFocus({ planSnapshot: plan }))!
    const intent = resolveFocusCompleteHandoffIntent(handoff)
    expect(intent).toMatchObject({
      kind: 'remind',
      breakMinutes: 5,
      notifyTitle: '自习室'
    })
    if (intent.kind === 'remind') {
      expect(intent.notifyBody).toMatch(/5 分钟/)
    }
  })

  it('maps none → suppress_to_focus_idle', () => {
    const plan = {
      ...createClassicPomodoroPlan(),
      breakPolicy: 'none' as const
    }
    const handoff = projectPhaseHandoffPlan(completedFocus({ planSnapshot: plan }))!
    expect(resolveFocusCompleteHandoffIntent(handoff)).toEqual({
      kind: 'suppress_to_focus_idle'
    })
  })
})

describe('resolveBreakEndHandoffIntent', () => {
  it('maps ask → prompt', () => {
    const handoff = projectBreakEndHandoffPlan(completedBreak())!
    expect(resolveBreakEndHandoffIntent(handoff)).toEqual({ kind: 'prompt' })
  })

  it('maps automatic → auto_start_focus', () => {
    const plan = createClassicPomodoroPlan({ breakPolicy: 'automatic' })
    const handoff = projectBreakEndHandoffPlan(
      completedBreak({ planSnapshot: plan })
    )!
    expect(resolveBreakEndHandoffIntent(handoff).kind).toBe('auto_start_focus')
  })

  it('maps reminder_only → remind with next round copy', () => {
    const plan = {
      ...createClassicPomodoroPlan(),
      breakPolicy: 'reminder_only' as const
    }
    const handoff = projectBreakEndHandoffPlan(
      completedBreak({ planSnapshot: plan, focusRoundInPlan: 2 })
    )!
    const intent = resolveBreakEndHandoffIntent(handoff)
    expect(intent.kind).toBe('remind')
    if (intent.kind === 'remind') {
      expect(intent.nextFocusRound).toBe(3)
      expect(intent.notifyBody).toMatch(/第 3 轮/)
    }
  })

  it('maps none → suppress_idle_focus', () => {
    const plan = {
      ...createClassicPomodoroPlan(),
      breakPolicy: 'none' as const
    }
    const handoff = projectBreakEndHandoffPlan(
      completedBreak({ planSnapshot: plan })
    )!
    expect(resolveBreakEndHandoffIntent(handoff)).toEqual({
      kind: 'suppress_idle_focus'
    })
  })
})

describe('resolvePhasePromptAnswerIntent', () => {
  it('normalizes actions fail-closed', () => {
    expect(resolvePhasePromptAnswerIntent({ action: 'later' })).toEqual({ kind: 'noop' })
    expect(resolvePhasePromptAnswerIntent({ action: null })).toEqual({ kind: 'noop' })
    expect(resolvePhasePromptAnswerIntent({ action: 'skip' })).toEqual({
      kind: 'skip_to_focus_idle'
    })
    expect(resolvePhasePromptAnswerIntent({ action: 'start_break' })).toEqual({
      kind: 'start_break'
    })
    expect(
      resolvePhasePromptAnswerIntent({ action: 'extend_and_start', extendMinutes: 5 })
    ).toEqual({ kind: 'extend_and_start', extendMinutes: 5 })
    expect(
      resolvePhasePromptAnswerIntent({ action: 'extend_and_start', extendMinutes: 0 })
    ).toEqual({ kind: 'noop' })
  })
})

describe('resolveBreakEndAnswerIntent', () => {
  it('hides wrap_up when not offered', () => {
    expect(
      resolveBreakEndAnswerIntent({ action: 'wrap_up', offerWrapUp: false })
    ).toEqual({ kind: 'noop' })
    expect(
      resolveBreakEndAnswerIntent({ action: 'wrap_up', offerWrapUp: true })
    ).toEqual({ kind: 'wrap_up' })
    expect(
      resolveBreakEndAnswerIntent({ action: 'start_focus', offerWrapUp: false })
    ).toEqual({ kind: 'start_focus' })
  })
})
