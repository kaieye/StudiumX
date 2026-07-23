/**
 * Sole next-break phase authority (lifecycle + phase-prompt).
 */

import { describe, expect, it } from 'vitest'
import {
  createClassicPomodoroPlan,
  createCustomRhythmPlan,
  resolveNextBreakPhase
} from '../../src/shared/study-planning'

describe('resolveNextBreakPhase', () => {
  it('pomodoro long break every N focus rounds', () => {
    const plan = createClassicPomodoroPlan({ longBreakEvery: 4 })
    expect(resolveNextBreakPhase({ plan, focusRoundInPlan: 1 })).toBe('short_break')
    expect(resolveNextBreakPhase({ plan, focusRoundInPlan: 4 })).toBe('long_break')
  })

  it('continuous always short_break', () => {
    const plan = createClassicPomodoroPlan({
      kind: 'continuous',
      clockMode: 'countup',
      breakPolicy: 'none'
    })
    expect(
      resolveNextBreakPhase({
        plan: { ...plan, kind: 'continuous' },
        focusRoundInPlan: 4
      })
    ).toBe('short_break')
  })

  it('custom_rhythm walks from rhythmStepIndex including wrap_up', () => {
    const created = createCustomRhythmPlan({
      id: 'r1',
      name: '节奏',
      sequence: [
        { kind: 'focus', minutes: 20 },
        { kind: 'wrap_up', minutes: 5 },
        { kind: 'short_break', minutes: 5 }
      ]
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // From focus at index 0 → next is wrap_up
    expect(
      resolveNextBreakPhase({
        plan: created.plan,
        focusRoundInPlan: 1,
        rhythmStepIndex: 0
      })
    ).toBe('wrap_up')
    // From focus-count fallback after first focus
    expect(
      resolveNextBreakPhase({
        plan: created.plan,
        focusRoundInPlan: 1
      })
    ).toBe('wrap_up')
  })
})
