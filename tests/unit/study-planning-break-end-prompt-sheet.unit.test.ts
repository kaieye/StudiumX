/**
 * STC-205 pure break-end prompt model (break→focus / wrap_up handoff, §10.3).
 */

import { describe, expect, it } from 'vitest'
import {
  buildBreakEndPromptSheetModel,
  createClassicPomodoroPlan,
  normalizeBreakEndPromptAction,
  projectBreakEndHandoffPlan,
  shouldOfferBreakEndHandoff,
  startTimerSession,
  type TimerSessionRecord
} from '../../src/shared/study-planning'

function completedBreak(overrides: Partial<TimerSessionRecord> = {}): TimerSessionRecord {
  const plan = createClassicPomodoroPlan()
  const started = startTimerSession({
    id: 'b1',
    nowMs: 1_000,
    plan,
    phase: 'short_break',
    focusRoundInPlan: 1
  }).session!
  return {
    ...started,
    state: 'completed',
    endedAtMs: 1_000 + 5 * 60_000,
    accumulatedActiveSeconds: 5 * 60,
    ...overrides
  }
}

describe('break-end-prompt-sheet pure model (STC-205 remainder)', () => {
  it('shouldOfferBreakEndHandoff only for completed break with snapshot', () => {
    expect(shouldOfferBreakEndHandoff(completedBreak())).toBe(true)
    expect(shouldOfferBreakEndHandoff(null)).toBe(false)
    expect(
      shouldOfferBreakEndHandoff(
        completedBreak({ phase: 'focus', state: 'completed' })
      )
    ).toBe(false)
    expect(
      shouldOfferBreakEndHandoff(completedBreak({ state: 'running' }))
    ).toBe(false)
    expect(
      shouldOfferBreakEndHandoff(completedBreak({ planSnapshot: null }))
    ).toBe(false)
  })

  it('projectBreakEndHandoffPlan for classic ask → prompt + next focus round', () => {
    const plan = projectBreakEndHandoffPlan(completedBreak({ focusRoundInPlan: 2 }))
    expect(plan).toMatchObject({
      disposition: 'prompt',
      breakPolicy: 'ask',
      nextPhase: 'focus',
      focusRoundInPlan: 2,
      nextFocusRound: 3,
      focusTargetSeconds: 25 * 60,
      offerWrapUp: true,
      wrapUpMinutes: 5
    })
  })

  it('projectBreakEndHandoffPlan for automatic → auto_start', () => {
    const plan = createClassicPomodoroPlan({ breakPolicy: 'automatic' })
    const handoff = projectBreakEndHandoffPlan(
      completedBreak({ planSnapshot: plan })
    )
    expect(handoff?.disposition).toBe('auto_start')
  })

  it('projectBreakEndHandoffPlan for none → suppress', () => {
    const plan = createClassicPomodoroPlan({ breakPolicy: 'none' })
    const handoff = projectBreakEndHandoffPlan(
      completedBreak({
        planSnapshot: { ...plan, breakPolicy: 'none', kind: 'continuous' }
      })
    )
    expect(handoff?.disposition).toBe('suppress')
  })

  it('buildBreakEndPromptSheetModel offers start_focus / wrap_up / later', () => {
    const model = buildBreakEndPromptSheetModel({
      completed: completedBreak({ focusRoundInPlan: 3 })
    })
    expect(model.nextFocusRound).toBe(4)
    expect(model.options).toEqual(['start_focus', 'wrap_up', 'later'])
    expect(model.offerWrapUp).toBe(true)
    expect(model.copy.title).toMatch(/休息结束/)
    expect(model.copy.startFocusLabel).toMatch(/第 4 轮/)
    expect(model.copy.wrapUpLabel).toMatch(/收尾/)
  })

  it('hides wrap_up when wrapUpMinutes is 0', () => {
    const plan = createClassicPomodoroPlan({ wrapUpMinutes: 0 })
    const model = buildBreakEndPromptSheetModel({
      completed: completedBreak({ planSnapshot: plan })
    })
    expect(model.offerWrapUp).toBe(false)
    expect(model.options).toEqual(['start_focus', 'later'])
  })

  it('normalizeBreakEndPromptAction is fail-closed', () => {
    expect(normalizeBreakEndPromptAction('start_focus')).toBe('start_focus')
    expect(normalizeBreakEndPromptAction('next_focus')).toBe('start_focus')
    expect(normalizeBreakEndPromptAction('wrap_up')).toBe('wrap_up')
    expect(normalizeBreakEndPromptAction('收尾')).toBe('wrap_up')
    expect(normalizeBreakEndPromptAction('later')).toBe('later')
    expect(normalizeBreakEndPromptAction('dismiss')).toBe('later')
    expect(normalizeBreakEndPromptAction('nope')).toBeNull()
  })
})
