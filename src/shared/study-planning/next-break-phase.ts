/**
 * Single authority for "next rest / wrap_up phase after a completed focus".
 *
 * Used by TimerSession lifecycle (phase_prompt events) and phase-prompt handoff UI.
 * Prefer this over re-walking longBreakEvery / custom_rhythm sequences at call sites.
 *
 * No I/O. Pure domain (ADR-0094 / STC-205 / STC-702).
 */

import type { TimerPlanV2 } from './timer-plan'
import { TIMER_PLAN_SEED_DEFAULTS } from './timer-plan'

/** Rest / wrap phases that may follow a completed focus segment. */
export type NextBreakPhase = 'short_break' | 'long_break' | 'wrap_up'

export type ResolveNextBreakPhaseInput = {
  plan: TimerPlanV2 | null | undefined
  /** Focus rounds completed in this plan cycle (from completed focus TimerSession). */
  focusRoundInPlan: number
  /**
   * STC-702: index of the completed focus step in rhythmSequence when known.
   * When set, walk from this step; otherwise walk by focus count.
   */
  rhythmStepIndex?: number
}

/**
 * Resolve the next phase after focus completes.
 *
 * - continuous / missing plan → short_break
 * - custom_rhythm → first short_break | long_break | wrap_up after the matching focus step
 * - pomodoro → long_break every N focus rounds, else short_break
 */
export function resolveNextBreakPhase(input: ResolveNextBreakPhaseInput): NextBreakPhase {
  const plan = input.plan
  if (!plan || plan.kind === 'continuous') return 'short_break'

  if (plan.kind === 'custom_rhythm' && Array.isArray(plan.rhythmSequence) && plan.rhythmSequence.length > 0) {
    const seq = plan.rhythmSequence
    const rhythmStepIndex = input.rhythmStepIndex
    if (rhythmStepIndex !== undefined && Number.isFinite(rhythmStepIndex)) {
      const base = Math.trunc(rhythmStepIndex)
      for (let j = 1; j <= seq.length; j += 1) {
        const next = seq[(base + j) % seq.length]
        if (next.kind === 'long_break') return 'long_break'
        if (next.kind === 'short_break') return 'short_break'
        if (next.kind === 'wrap_up') return 'wrap_up'
      }
      return 'short_break'
    }

    // Fallback: count focus completions vs focusRoundInPlan.
    const focusRoundInPlan = input.focusRoundInPlan
    let focusSeen = 0
    for (let i = 0; i < seq.length * 2; i += 1) {
      const step = seq[i % seq.length]
      if (step.kind === 'focus') {
        focusSeen += 1
        if (focusSeen === focusRoundInPlan) {
          for (let j = 1; j <= seq.length; j += 1) {
            const next = seq[(i + j) % seq.length]
            if (next.kind === 'long_break') return 'long_break'
            if (next.kind === 'short_break') return 'short_break'
            if (next.kind === 'wrap_up') return 'wrap_up'
          }
          break
        }
      }
    }
    return 'short_break'
  }

  const every = plan.longBreakEvery ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery
  if (input.focusRoundInPlan > 0 && input.focusRoundInPlan % every === 0) return 'long_break'
  return 'short_break'
}
