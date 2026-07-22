/**
 * STC-205 pure phase-prompt model (focus→break handoff).
 */

import { describe, expect, it } from 'vitest'
import {
  buildPhasePromptSheetModel,
  computeNextBreakPhase,
  createClassicPomodoroPlan,
  normalizePhasePromptAction,
  projectPhaseHandoffPlan,
  resolvePhasePromptDisposition,
  shouldOfferPhaseHandoff,
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

describe('phase-prompt-sheet pure model (STC-205)', () => {
  it('resolvePhasePromptDisposition maps freeze #3/#6 policies', () => {
    expect(resolvePhasePromptDisposition('ask')).toBe('prompt')
    expect(resolvePhasePromptDisposition('automatic')).toBe('auto_start')
    expect(resolvePhasePromptDisposition('reminder_only')).toBe('remind')
    expect(resolvePhasePromptDisposition('none')).toBe('suppress')
    expect(resolvePhasePromptDisposition(undefined)).toBe('prompt')
  })

  it('computeNextBreakPhase uses long break every N focus rounds', () => {
    const plan = createClassicPomodoroPlan({ longBreakEvery: 4, longBreakMinutes: 15 })
    expect(computeNextBreakPhase(plan, 1)).toBe('short_break')
    expect(computeNextBreakPhase(plan, 3)).toBe('short_break')
    expect(computeNextBreakPhase(plan, 4)).toBe('long_break')
    expect(computeNextBreakPhase(plan, 8)).toBe('long_break')
  })

  it('buildPhasePromptSheetModel offers start / skip / later with minutes', () => {
    const model = buildPhasePromptSheetModel({ completed: completedFocus({ focusRoundInPlan: 4 }) })
    expect(model.nextPhase).toBe('long_break')
    expect(model.nextBreakMinutes).toBe(15)
    expect(model.options).toEqual(['start_break', 'skip_break', 'later', 'extend_and_start'])
    expect(model.extendMinuteOptions).toEqual([1, 5])
    expect(model.copy.title).toMatch(/专注结束/)
    expect(model.copy.startBreakLabel).toMatch(/长休息/)
  })

  it('normalizePhasePromptAction is fail-closed', () => {
    expect(normalizePhasePromptAction('start_break')).toBe('start_break')
    expect(normalizePhasePromptAction('skip')).toBe('skip_break')
    expect(normalizePhasePromptAction('dismiss')).toBe('later')
    expect(normalizePhasePromptAction('nope')).toBeNull()
    expect(normalizePhasePromptAction('extend')).toBe('extend_and_start')
    expect(normalizePhasePromptAction('extend_and_start')).toBe('extend_and_start')
  })

  it('projectPhaseHandoffPlan fails closed without completed focus snapshot', () => {
    expect(projectPhaseHandoffPlan(null)).toBeNull()
    expect(
      projectPhaseHandoffPlan(
        completedFocus({ phase: 'short_break', state: 'completed' })
      )
    ).toBeNull()
    expect(
      projectPhaseHandoffPlan(completedFocus({ state: 'running' }))
    ).toBeNull()
  })

  it('projectPhaseHandoffPlan for classic ask → prompt + short break target', () => {
    const plan = projectPhaseHandoffPlan(completedFocus({ focusRoundInPlan: 1 }))
    expect(plan).toMatchObject({
      disposition: 'prompt',
      breakPolicy: 'ask',
      nextPhase: 'short_break',
      nextBreakMinutes: 5,
      targetSeconds: 300
    })
    expect(shouldOfferPhaseHandoff(completedFocus())).toBe(true)
  })

  it('projectPhaseHandoffPlan for automatic → auto_start', () => {
    const plan = createClassicPomodoroPlan({ breakPolicy: 'automatic' })
    const handoff = projectPhaseHandoffPlan(completedFocus({ planSnapshot: plan }))
    expect(handoff?.disposition).toBe('auto_start')
  })

  it('projectPhaseHandoffPlan for none → suppress', () => {
    const plan = createClassicPomodoroPlan({
      kind: 'continuous',
      clockMode: 'countup',
      breakPolicy: 'none'
    })
    // createClassic may coerce; force snapshot
    const session = completedFocus({
      planSnapshot: { ...plan, breakPolicy: 'none', kind: 'continuous' }
    })
    const handoff = projectPhaseHandoffPlan(session)
    expect(handoff?.disposition).toBe('suppress')
  })
})
