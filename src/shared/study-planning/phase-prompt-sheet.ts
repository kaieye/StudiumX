/**
 * Phase-prompt sheet model (STC-205 product path / freeze #3).
 * Pure presentation after focus segment completes with breakPolicy handling.
 *
 * Actions:
 * - start_break: begin short/long rest from frozen planSnapshot
 * - skip_break: skip rest (do not forge rest completion)
 * - later: dismiss; leave idle without starting break
 * - extend_and_start: start rest with longer targetSeconds (planSnapshot still frozen)
 */

import type { BreakPolicy, TimerPlanV2 } from './timer-plan'
import { TIMER_PLAN_SEED_DEFAULTS } from './timer-plan'
import type { TimerSessionPhase, TimerSessionRecord } from './timer-session-lifecycle'

export type PhasePromptAction = 'start_break' | 'skip_break' | 'later' | 'extend_and_start'

/** Preset extend amounts offered on the phase-prompt sheet (minutes). */
export const PHASE_PROMPT_EXTEND_MINUTE_OPTIONS = [1, 5] as const

export type PhasePromptSheetModel = {
  breakPolicy: BreakPolicy
  nextPhase: 'short_break' | 'long_break'
  nextBreakMinutes: number
  focusRoundInPlan: number
  planName: string
  /** +N minute presets for extend_and_start (product §10.3). */
  extendMinuteOptions: readonly number[]
  options: PhasePromptAction[]
  copy: {
    title: string
    description: string
    startBreakLabel: string
    startBreakDetail: string
    skipBreakLabel: string
    skipBreakDetail: string
    laterLabel: string
    /** Label template; UI may append "+N 分钟". */
    extendAndStartLabel: string
    extendAndStartDetail: string
  }
}

/**
 * Next rest phase from frozen plan + focus round (mirrors lifecycle nextBreakPhase).
 * continuous / missing plan → short_break.
 */
export function computeNextBreakPhase(
  plan: TimerPlanV2 | null | undefined,
  focusRoundInPlan: number
): 'short_break' | 'long_break' {
  if (!plan || plan.kind === 'continuous') return 'short_break'
  // STC-702: walk custom rhythm for next short/long break after N focus steps.
  if (plan.kind === 'custom_rhythm' && Array.isArray(plan.rhythmSequence) && plan.rhythmSequence.length > 0) {
    const seq = plan.rhythmSequence
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
          }
          break
        }
      }
    }
    return 'short_break'
  }
  const every = plan.longBreakEvery ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery
  if (focusRoundInPlan > 0 && focusRoundInPlan % every === 0) return 'long_break'
  return 'short_break'
}

export function breakMinutesForPhase(
  plan: TimerPlanV2 | null | undefined,
  phase: 'short_break' | 'long_break'
): number {
  if (!plan) {
    return phase === 'long_break'
      ? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes
      : TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes
  }
  if (phase === 'long_break') {
    return plan.longBreakMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes
  }
  return plan.shortBreakMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes
}

/**
 * Product decision after focus countdown complete (freeze #3 / #6).
 * - automatic → auto_start break
 * - ask → show prompt sheet
 * - reminder_only → remind only (no auto break)
 * - none → suppress break (stay ready for next focus)
 */
export function resolvePhasePromptDisposition(
  breakPolicy: BreakPolicy | string | null | undefined
): 'prompt' | 'auto_start' | 'remind' | 'suppress' {
  if (breakPolicy === 'automatic') return 'auto_start'
  if (breakPolicy === 'none') return 'suppress'
  if (breakPolicy === 'reminder_only') return 'remind'
  // Default / ask / unknown → ask (pomodoro freeze #3)
  return 'prompt'
}

/**
 * Build presentation model for focus→break phase prompt.
 */
export function buildPhasePromptSheetModel(input: {
  completed: Pick<TimerSessionRecord, 'planSnapshot' | 'focusRoundInPlan' | 'phase' | 'state'>
  /** Override next phase (tests); otherwise computed from frozen plan. */
  nextPhase?: 'short_break' | 'long_break'
}): PhasePromptSheetModel {
  const plan = input.completed.planSnapshot
  const breakPolicy: BreakPolicy =
    plan?.breakPolicy === 'automatic' ||
    plan?.breakPolicy === 'ask' ||
    plan?.breakPolicy === 'reminder_only' ||
    plan?.breakPolicy === 'none'
      ? plan.breakPolicy
      : 'ask'
  const nextPhase =
    input.nextPhase ?? computeNextBreakPhase(plan, input.completed.focusRoundInPlan)
  const nextBreakMinutes = breakMinutesForPhase(plan, nextPhase)
  const planName = (plan?.name ?? '').trim() || '当前方案'
  const isLong = nextPhase === 'long_break'
  const phaseLabel = isLong ? '长休息' : '短休息'

  return {
    breakPolicy,
    nextPhase,
    nextBreakMinutes,
    focusRoundInPlan: input.completed.focusRoundInPlan,
    planName,
    extendMinuteOptions: PHASE_PROMPT_EXTEND_MINUTE_OPTIONS,
    options: ['start_break', 'skip_break', 'later', 'extend_and_start'],
    copy: {
      title: '专注结束 — 开始休息？',
      description: `「${planName}」第 ${input.completed.focusRoundInPlan} 轮专注已到点。建议 ${phaseLabel} ${nextBreakMinutes} 分钟。跳过不会伪造已休息。`,
      startBreakLabel: `开始${phaseLabel}`,
      startBreakDetail: `按方案进入 ${nextBreakMinutes} 分钟${phaseLabel}倒计时（使用当前会话冻结方案）。`,
      skipBreakLabel: '跳过休息',
      skipBreakDetail: '不开始休息段，准备下一轮专注。不会记为已休息。',
      laterLabel: '稍后',
      extendAndStartLabel: `延长后再${phaseLabel}`,
      extendAndStartDetail: `在建议 ${nextBreakMinutes} 分钟基础上再加时长，再进入休息（不改冻结方案）。`
    }
  }
}

/**
 * Map sheet / host answers onto PhasePromptAction (fail-closed).
 */
export function normalizePhasePromptAction(
  raw: string | null | undefined
): PhasePromptAction | null {
  if (raw == null || raw === '') return null
  if (raw === 'start_break' || raw === 'start' || raw === 'break') return 'start_break'
  if (raw === 'skip_break' || raw === 'skip') return 'skip_break'
  if (raw === 'later' || raw === 'dismiss' || raw === 'cancel') return 'later'
  if (raw === 'extend_and_start' || raw === 'extend' || raw === 'extend_break') return 'extend_and_start'
  return null
}

/**
 * Normalize host/sheet extend minutes (fail-closed → null).
 * Accepts only positive finite whole minutes; UI should pass 1 or 5 presets.
 */
export function normalizePhasePromptExtendMinutes(
  raw: number | string | null | undefined
): number | null {
  if (raw == null || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return null
  const minutes = Math.floor(n)
  if (minutes <= 0) return null
  return minutes
}

/**
 * Whether a completed focus session should surface a phase prompt / auto handoff.
 * Only countdown focus segments with planSnapshot participate.
 */
export function shouldOfferPhaseHandoff(
  session: Pick<TimerSessionRecord, 'phase' | 'state' | 'planSnapshot' | 'clockMode'> | null | undefined
): boolean {
  if (!session) return false
  if (session.phase !== 'focus') return false
  if (session.state !== 'completed') return false
  if (!session.planSnapshot) return false
  return true
}

export type PhaseHandoffPlan = {
  disposition: 'prompt' | 'auto_start' | 'remind' | 'suppress'
  breakPolicy: BreakPolicy
  nextPhase: 'short_break' | 'long_break'
  nextBreakMinutes: number
  focusRoundInPlan: number
  plan: TimerPlanV2
  targetSeconds: number
}

/**
 * Project post-focus handoff plan from a completed focus TimerSession.
 * Fail-closed: returns null when session is not a completed focus with snapshot.
 */
export function projectPhaseHandoffPlan(
  completed: TimerSessionRecord | null | undefined
): PhaseHandoffPlan | null {
  if (!shouldOfferPhaseHandoff(completed)) return null
  const plan = completed!.planSnapshot!
  const breakPolicy: BreakPolicy =
    plan.breakPolicy === 'automatic' ||
    plan.breakPolicy === 'ask' ||
    plan.breakPolicy === 'reminder_only' ||
    plan.breakPolicy === 'none'
      ? plan.breakPolicy
      : 'ask'
  const nextPhase = computeNextBreakPhase(plan, completed!.focusRoundInPlan)
  const nextBreakMinutes = breakMinutesForPhase(plan, nextPhase)
  return {
    disposition: resolvePhasePromptDisposition(breakPolicy),
    breakPolicy,
    nextPhase,
    nextBreakMinutes,
    focusRoundInPlan: completed!.focusRoundInPlan,
    plan,
    targetSeconds: nextBreakMinutes * 60
  }
}

/** Type guard helper for phase labels used by UI. */
export function isBreakPhase(phase: TimerSessionPhase): phase is 'short_break' | 'long_break' {
  return phase === 'short_break' || phase === 'long_break'
}
