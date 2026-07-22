/**
 * Pure STC-603 timer a11y status + keyboard map.
 */
import { describe, expect, it } from 'vitest'
import {
  isPlanningTimerKeyboardTargetEditable,
  mapPlanningTimerKeyboardAction,
  projectPlanningTimerA11yStatus
} from '../../src/renderer/src/study-space/planning-timer-a11y-ui'
import {
  createClassicPomodoroPlan,
  startTimerSession
} from '../../src/shared/study-planning'

describe('planning-timer-a11y-ui (STC-603)', () => {
  it('projects static status from V1 shell without ticking digits', () => {
    const model = projectPlanningTimerA11yStatus({
      timerState: 'running',
      timerMode: 'focus',
      taskTitle: '读论文',
      fallbackClockMode: 'countdown'
    })
    expect(model.statusLabel).toContain('running')
    expect(model.statusLabel).toContain('focus')
    expect(model.statusLabel).toContain('countdown')
    expect(model.statusLabel).toContain('读论文')
    expect(model.statusLabel).not.toMatch(/\d+:\d+/)
    expect(model.statusLabel).not.toMatch(/\d+s/)
  })

  it('prefers live TimerSession phase/state/clock over shell', () => {
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 's-break',
      nowMs: 0,
      plan,
      phase: 'short_break',
      targetSeconds: 5 * 60
    }).session!
    const model = projectPlanningTimerA11yStatus({
      timerState: 'idle',
      timerMode: 'focus',
      activeSession: started,
      taskTitle: 'ignored-on-break'
    })
    expect(model.state).toBe('running')
    expect(model.phase).toBe('short_break')
    expect(model.clockMode).toBe('countdown')
    expect(model.statusLabel).toContain('short_break')
    expect(model.statusLabel).not.toMatch(/\d+:\d+/)
  })

  it('maps Space/Enter to toggle_or_start when panel open', () => {
    expect(
      mapPlanningTimerKeyboardAction({ key: ' ', panelOpen: true })
    ).toEqual({ action: 'toggle_or_start', preventDefault: true })
    expect(
      mapPlanningTimerKeyboardAction({ key: 'Enter', panelOpen: true })
    ).toEqual({ action: 'toggle_or_start', preventDefault: true })
  })

  it('maps r to reset and + to extend only when allowed', () => {
    expect(
      mapPlanningTimerKeyboardAction({ key: 'r', panelOpen: true })
    ).toEqual({ action: 'reset', preventDefault: true })
    expect(
      mapPlanningTimerKeyboardAction({
        key: '+',
        panelOpen: true,
        canExtendBreak: false
      })
    ).toEqual({ action: 'none', preventDefault: false })
    expect(
      mapPlanningTimerKeyboardAction({
        key: '+',
        panelOpen: true,
        canExtendBreak: true
      })
    ).toEqual({ action: 'extend_break', preventDefault: true })
  })

  it('maps arrow/f/b for mode tabs and no-ops when already selected', () => {
    expect(
      mapPlanningTimerKeyboardAction({
        key: 'ArrowLeft',
        panelOpen: true,
        selectedMode: 'break'
      })
    ).toEqual({ action: 'select_focus', preventDefault: true })
    expect(
      mapPlanningTimerKeyboardAction({
        key: 'f',
        panelOpen: true,
        selectedMode: 'focus'
      })
    ).toEqual({ action: 'none', preventDefault: false })
    expect(
      mapPlanningTimerKeyboardAction({
        key: 'b',
        panelOpen: true,
        selectedMode: 'focus'
      })
    ).toEqual({ action: 'select_break', preventDefault: true })
  })

  it('suppresses shortcuts when panel closed, settings open, or editable', () => {
    expect(
      mapPlanningTimerKeyboardAction({ key: ' ', panelOpen: false })
    ).toEqual({ action: 'none', preventDefault: false })
    expect(
      mapPlanningTimerKeyboardAction({
        key: ' ',
        panelOpen: true,
        settingsOpen: true
      })
    ).toEqual({ action: 'none', preventDefault: false })
    expect(
      mapPlanningTimerKeyboardAction({
        key: ' ',
        panelOpen: true,
        targetIsEditable: true
      })
    ).toEqual({ action: 'none', preventDefault: false })
  })

  it('detects editable keyboard targets', () => {
    const input = document.createElement('input')
    const div = document.createElement('div')
    expect(isPlanningTimerKeyboardTargetEditable(input)).toBe(true)
    expect(isPlanningTimerKeyboardTargetEditable(div)).toBe(false)
    expect(isPlanningTimerKeyboardTargetEditable(null)).toBe(false)
  })
})
