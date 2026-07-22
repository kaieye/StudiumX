/**
 * STC-205: local next-phase start preserves frozen planSnapshot.
 */

import { describe, expect, it } from 'vitest'
import {
  createClassicPomodoroPlan,
  startTimerSession
} from '../../src/shared/study-planning'
import { startLocalNextPhaseFromCompleted } from '../../src/renderer/src/study-space/planning-timer-display'

describe('startLocalNextPhaseFromCompleted (STC-205)', () => {
  it('starts short_break from frozen planSnapshot when userConfirmed', () => {
    const plan = createClassicPomodoroPlan({ shortBreakMinutes: 7 })
    const started = startTimerSession({
      id: 'f',
      nowMs: 0,
      plan,
      taskId: 't'
    }).session!
    const completed = {
      ...started,
      state: 'completed' as const,
      endedAtMs: 25 * 60_000
    }
    const next = startLocalNextPhaseFromCompleted({
      completed,
      newSessionId: 'b1',
      nowMs: 25 * 60_000,
      phase: 'short_break',
      userConfirmed: true
    })
    expect(next).toMatchObject({
      id: 'b1',
      phase: 'short_break',
      state: 'running',
      taskId: null,
      targetSeconds: 7 * 60
    })
    expect(next!.planSnapshot).toEqual(completed.planSnapshot)
  })

  it('returns null when ask and userConfirmed false', () => {
    const plan = createClassicPomodoroPlan({ breakPolicy: 'ask' })
    const started = startTimerSession({ id: 'f', nowMs: 0, plan }).session!
    const completed = { ...started, state: 'completed' as const, endedAtMs: 1 }
    const next = startLocalNextPhaseFromCompleted({
      completed,
      newSessionId: 'b',
      nowMs: 1,
      phase: 'short_break',
      userConfirmed: false
    })
    expect(next).toBeNull()
  })

  it('applies targetSeconds override for extended break start', () => {
    const plan = createClassicPomodoroPlan({ shortBreakMinutes: 5 })
    const started = startTimerSession({ id: 'f', nowMs: 0, plan, taskId: 't' }).session!
    const completed = {
      ...started,
      state: 'completed' as const,
      endedAtMs: 25 * 60_000
    }
    const next = startLocalNextPhaseFromCompleted({
      completed,
      newSessionId: 'b-ext',
      nowMs: 25 * 60_000,
      phase: 'short_break',
      userConfirmed: true,
      targetSeconds: 6 * 60
    })
    expect(next?.targetSeconds).toBe(360)
    expect(next?.planSnapshot).toEqual(completed.planSnapshot)
  })

  it('starts focus from completed break with focusRound +1', () => {
    const plan = createClassicPomodoroPlan({ focusMinutes: 25 })
    const started = startTimerSession({
      id: 'b',
      nowMs: 0,
      plan,
      phase: 'short_break',
      focusRoundInPlan: 2
    }).session!
    const completed = {
      ...started,
      state: 'completed' as const,
      endedAtMs: 5 * 60_000
    }
    const next = startLocalNextPhaseFromCompleted({
      completed,
      newSessionId: 'f2',
      nowMs: 5 * 60_000,
      phase: 'focus',
      userConfirmed: true
    })
    expect(next).toMatchObject({
      id: 'f2',
      phase: 'focus',
      state: 'running',
      focusRoundInPlan: 3,
      targetSeconds: 25 * 60
    })
    expect(next!.planSnapshot).toEqual(completed.planSnapshot)
  })

  it('starts wrap_up from completed break using frozen wrapUpMinutes', () => {
    const plan = createClassicPomodoroPlan({ wrapUpMinutes: 8 })
    const started = startTimerSession({
      id: 'b',
      nowMs: 0,
      plan,
      phase: 'long_break',
      focusRoundInPlan: 4
    }).session!
    const completed = {
      ...started,
      state: 'completed' as const,
      endedAtMs: 15 * 60_000
    }
    const next = startLocalNextPhaseFromCompleted({
      completed,
      newSessionId: 'w1',
      nowMs: 15 * 60_000,
      phase: 'wrap_up',
      userConfirmed: true
    })
    expect(next).toMatchObject({
      id: 'w1',
      phase: 'wrap_up',
      state: 'running',
      taskId: null,
      targetSeconds: 8 * 60,
      focusRoundInPlan: 4
    })
    expect(next!.planSnapshot).toEqual(completed.planSnapshot)
  })

  it('applies taskId override when starting focus after break', () => {
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'b',
      nowMs: 0,
      plan,
      phase: 'short_break',
      focusRoundInPlan: 1
    }).session!
    const completed = {
      ...started,
      state: 'completed' as const,
      endedAtMs: 5 * 60_000,
      taskId: null
    }
    const next = startLocalNextPhaseFromCompleted({
      completed,
      newSessionId: 'f-reattach',
      nowMs: 5 * 60_000,
      phase: 'focus',
      userConfirmed: true,
      taskId: 'task-selected'
    })
    expect(next).toMatchObject({
      phase: 'focus',
      taskId: 'task-selected',
      focusRoundInPlan: 2
    })
  })

})
