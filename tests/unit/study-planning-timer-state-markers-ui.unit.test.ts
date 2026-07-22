/**
 * STC-604 pure state markers + reduced-motion class plan.
 */
import { describe, expect, it } from 'vitest'
import { projectPlanningTimerStateMarkers } from '../../src/renderer/src/study-space/planning-timer-state-markers-ui'
import {
  createClassicPomodoroPlan,
  createContinuousCountupPlan,
  startTimerSession
} from '../../src/shared/study-planning'

describe('planning-timer-state-markers-ui (STC-604)', () => {
  it('labels idle shell with non-color chip text', () => {
    const model = projectPlanningTimerStateMarkers({
      timerState: 'idle',
      timerMode: 'focus',
      selectedMode: 'focus',
      remainingSeconds: 25 * 60
    })
    expect(model.visualState).toBe('idle')
    expect(model.stateLabelZh).toBe('空闲')
    expect(model.phaseLabelZh).toBe('专注')
    expect(model.stateChipText).toBe('空闲 · 专注')
    expect(model.overtimeLabelZh).toBeNull()
    expect(model.cardClassTokens).toEqual(['is-focus', 'is-state-idle'])
    expect(model.reduceMotion).toBe(false)
  })

  it('prefers live TimerSession state and wrap_up phase labels', () => {
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'm1',
      nowMs: 0,
      plan,
      phase: 'wrap_up',
      targetSeconds: 5 * 60
    }).session!
    const model = projectPlanningTimerStateMarkers({
      timerState: 'paused', // shell stale
      timerMode: 'break',
      selectedMode: 'break',
      activeSession: started,
      remainingSeconds: 60
    })
    expect(model.visualState).toBe('running') // session is running
    expect(model.surfacePhase).toBe('wrap_up')
    expect(model.stateChipText).toBe('运行中 · 收尾')
    expect(model.cardClassTokens).toContain('is-wrap_up')
    expect(model.cardClassTokens).toContain('is-state-running')
  })

  it('marks overtime when countdown remaining is 0 while open', () => {
    const model = projectPlanningTimerStateMarkers({
      timerState: 'running',
      timerMode: 'focus',
      remainingSeconds: 0,
      countdownSegment: true
    })
    expect(model.overtimeLabelZh).toBe('已超时')
    expect(model.cardClassTokens).toContain('is-overtime')
  })

  it('does not mark overtime for countup continuous sessions', () => {
    const plan = createContinuousCountupPlan({ name: '连', continuousTarget: false })
    const started = startTimerSession({
      id: 'c1',
      nowMs: 0,
      plan,
      phase: 'focus',
      targetSeconds: null
    }).session!
    const model = projectPlanningTimerStateMarkers({
      timerState: 'running',
      timerMode: 'focus',
      activeSession: started,
      remainingSeconds: 0,
      countdownSegment: true
    })
    // session.clockMode countup → no overtime
    expect(model.overtimeLabelZh).toBeNull()
    expect(model.cardClassTokens).not.toContain('is-overtime')
  })

  it('adds is-reduced-motion token when flag set', () => {
    const model = projectPlanningTimerStateMarkers({
      timerState: 'running',
      timerMode: 'focus',
      reducedMotion: true,
      remainingSeconds: 10
    })
    expect(model.reduceMotion).toBe(true)
    expect(model.cardClassTokens).toContain('is-reduced-motion')
  })

  it('maps needs_reconcile session state to 待对账', () => {
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'r1',
      nowMs: 0,
      plan,
      phase: 'focus',
      targetSeconds: 25 * 60
    }).session!
    const needs = { ...started, state: 'needs_reconcile' as const, pendingReconcileSeconds: 90 }
    const model = projectPlanningTimerStateMarkers({
      timerState: 'paused',
      timerMode: 'focus',
      activeSession: needs,
      remainingSeconds: 10
    })
    expect(model.visualState).toBe('needs_reconcile')
    expect(model.stateLabelZh).toBe('待对账')
    expect(model.stateChipText).toContain('待对账')
    expect(model.cardClassTokens).toContain('is-state-needs_reconcile')
  })
})
