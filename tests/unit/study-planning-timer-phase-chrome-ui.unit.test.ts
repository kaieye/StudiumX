/**
 * Pure STC-205 wrap_up mid-run phase chrome.
 */
import { describe, expect, it } from 'vitest'
import { projectPlanningTimerPhaseChrome } from '../../src/renderer/src/study-space/planning-timer-phase-chrome-ui'
import {
  createClassicPomodoroPlan,
  startTimerSession
} from '../../src/shared/study-planning'

describe('planning-timer-phase-chrome-ui (STC-205 wrap_up chrome)', () => {
  it('labels idle/focus shell as focus chrome', () => {
    const model = projectPlanningTimerPhaseChrome({
      timerMode: 'focus',
      selectedMode: 'focus',
      activeSession: null
    })
    expect(model.surfacePhase).toBe('focus')
    expect(model.timerLabel).toBe('专注计时')
    expect(model.cardMode).toBe('focus')
    expect(model.showFocusTaskLabel).toBe(true)
    expect(model.modeTabsInteractive).toBe(true)
  })

  it('labels break shell without session as rest', () => {
    const model = projectPlanningTimerPhaseChrome({
      timerMode: 'break',
      selectedMode: 'break',
      activeSession: null
    })
    expect(model.surfacePhase).toBe('break')
    expect(model.timerLabel).toBe('休息计时')
    expect(model.faceBadge).toBeNull()
  })

  it('does not label wrap_up session as rest even when V1 shell is break', () => {
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'wrap1',
      nowMs: 0,
      plan,
      phase: 'wrap_up',
      targetSeconds: 5 * 60
    }).session!
    const model = projectPlanningTimerPhaseChrome({
      timerMode: 'break',
      selectedMode: 'break',
      activeSession: started
    })
    expect(model.surfacePhase).toBe('wrap_up')
    expect(model.timerLabel).toBe('收尾计时')
    expect(model.cardMode).toBe('wrap_up')
    expect(model.faceBadge).toContain('收尾')
    expect(model.showFocusTaskLabel).toBe(false)
    expect(model.modeTabsInteractive).toBe(false)
    expect(model.selectedModeVisual).toBe('break')
  })

  it('labels short_break session as rest chrome', () => {
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'b1',
      nowMs: 0,
      plan,
      phase: 'short_break',
      targetSeconds: 5 * 60
    }).session!
    const model = projectPlanningTimerPhaseChrome({
      timerMode: 'break',
      selectedMode: 'break',
      activeSession: started
    })
    expect(model.surfacePhase).toBe('break')
    expect(model.timerLabel).toBe('休息计时')
    expect(model.faceBadge).toBeNull()
  })

  it('ignores closed sessions for chrome (falls back to shell)', () => {
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'closed',
      nowMs: 0,
      plan,
      phase: 'wrap_up',
      targetSeconds: 5 * 60
    }).session!
    const closed = { ...started, state: 'completed' as const, endedAtMs: 1 }
    const model = projectPlanningTimerPhaseChrome({
      timerMode: 'focus',
      selectedMode: 'focus',
      activeSession: closed
    })
    expect(model.surfacePhase).toBe('focus')
    expect(model.timerLabel).toBe('专注计时')
  })
})
