/**
 * Break-end prompt sheet model (STC-205 remainder / roadmap §10.3).
 * Pure presentation after a rest segment completes: next focus / wrap_up / later.
 *
 * Product rule: rest end must not silently start the next focus or task.
 * breakPolicy automatic may auto_start next focus; ask/remind/none leave idle focus shell
 * (no intermediate break-end prompt page).
 *
 * Actions:
 * - start_focus: begin next focus from frozen planSnapshot (round +1)
 * - wrap_up: begin wrap_up countdown from plan wrapUpMinutes (not rest, not core focus)
 * - later: dismiss; leave idle focus shell without starting
 */

import type { BreakPolicy, TimerPlanV2 } from './timer-plan'
import {
  focusTargetSecondsForPlan,
  isOpenContinuousPlanV2,
  normalizeBreakPolicy,
  TIMER_PLAN_SEED_DEFAULTS
} from './timer-plan'

export { focusTargetSecondsForPlan }
import type { TimerSessionPhase, TimerSessionRecord } from './timer-session-lifecycle'
import { isBreakPhase, resolvePhasePromptDisposition } from './phase-prompt-sheet'

export type BreakEndPromptAction = 'start_focus' | 'wrap_up' | 'later'

export type BreakEndPromptSheetModel = {
  breakPolicy: BreakPolicy
  focusRoundInPlan: number
  nextFocusRound: number
  planName: string
  focusMinutes: number | null
  wrapUpMinutes: number
  /** False when wrapUpMinutes is 0 — hide wrap_up option. */
  offerWrapUp: boolean
  options: BreakEndPromptAction[]
  copy: {
    title: string
    description: string
    startFocusLabel: string
    startFocusDetail: string
    wrapUpLabel: string
    wrapUpDetail: string
    laterLabel: string
  }
}

export type BreakEndHandoffPlan = {
  disposition: 'prompt' | 'auto_start' | 'remind' | 'suppress'
  breakPolicy: BreakPolicy
  nextPhase: 'focus'
  focusRoundInPlan: number
  nextFocusRound: number
  plan: TimerPlanV2
  focusTargetSeconds: number | null
  wrapUpMinutes: number
  wrapUpTargetSeconds: number
  offerWrapUp: boolean
}

/**
 * Whether a completed break session should surface break-end handoff.
 * Requires completed short_break|long_break with planSnapshot.
 */
export function shouldOfferBreakEndHandoff(
  session: Pick<TimerSessionRecord, 'phase' | 'state' | 'planSnapshot'> | null | undefined
): boolean {
  if (!session) return false
  if (!isBreakPhase(session.phase)) return false
  if (session.state !== 'completed') return false
  if (!session.planSnapshot) return false
  return true
}

export function wrapUpMinutesForPlan(plan: TimerPlanV2 | null | undefined): number {
  if (!plan) return TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutes
  const n = plan.wrapUpMinutes
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutes
  }
  return Math.max(0, Math.floor(n))
}

/**
 * Project post-break handoff from a completed rest TimerSession.
 * Fail-closed: null when not completed break with snapshot.
 */
export function projectBreakEndHandoffPlan(
  completed: TimerSessionRecord | null | undefined
): BreakEndHandoffPlan | null {
  if (!shouldOfferBreakEndHandoff(completed)) return null
  const plan = completed!.planSnapshot!
  const breakPolicy = normalizeBreakPolicy(plan.breakPolicy)
  const wrapUpMinutes = wrapUpMinutesForPlan(plan)
  const focusRoundInPlan = completed!.focusRoundInPlan
  return {
    disposition: resolvePhasePromptDisposition(breakPolicy),
    breakPolicy,
    nextPhase: 'focus',
    focusRoundInPlan,
    nextFocusRound: focusRoundInPlan + 1,
    plan,
    focusTargetSeconds: focusTargetSecondsForPlan(plan),
    wrapUpMinutes,
    wrapUpTargetSeconds: wrapUpMinutes * 60,
    offerWrapUp: wrapUpMinutes > 0
  }
}

/**
 * Build presentation model for break→focus / wrap_up prompt.
 */
export function buildBreakEndPromptSheetModel(input: {
  completed: Pick<TimerSessionRecord, 'planSnapshot' | 'focusRoundInPlan' | 'phase' | 'state'>
}): BreakEndPromptSheetModel {
  const plan = input.completed.planSnapshot
  const breakPolicy = normalizeBreakPolicy(plan?.breakPolicy)
  const focusRoundInPlan = input.completed.focusRoundInPlan
  const nextFocusRound = focusRoundInPlan + 1
  const planName = (plan?.name ?? '').trim() || '当前方案'
  const wrapUpMinutes = wrapUpMinutesForPlan(plan ?? undefined)
  const offerWrapUp = wrapUpMinutes > 0
  // Prefer continuousMode / isOpenContinuousPlanV2 — not kind+countup (exam is countup with focus).
  const focusMinutes =
    plan == null
      ? TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes
      : isOpenContinuousPlanV2(plan)
        ? null
        : plan.focusMinutes != null && Number.isFinite(plan.focusMinutes)
          ? plan.focusMinutes
          : TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes

  const focusLabel =
    focusMinutes == null
      ? '连续专注'
      : `${focusMinutes} 分钟专注`

  const options: BreakEndPromptAction[] = offerWrapUp
    ? ['start_focus', 'wrap_up', 'later']
    : ['start_focus', 'later']

  return {
    breakPolicy,
    focusRoundInPlan,
    nextFocusRound,
    planName,
    focusMinutes,
    wrapUpMinutes,
    offerWrapUp,
    options,
    copy: {
      title: '休息结束 — 下一步？',
      description: `「${planName}」休息已到点。不会自动开始下一轮专注；请选择开始第 ${nextFocusRound} 轮、收尾，或稍后。`,
      startFocusLabel: `开始第 ${nextFocusRound} 轮专注`,
      startFocusDetail: `按冻结方案进入 ${focusLabel}（方案快照不因目录编辑改写）。`,
      wrapUpLabel: '开始收尾',
      wrapUpDetail: `进入 ${wrapUpMinutes} 分钟收尾（整理/复盘；不算休息，也不记任务核心专注）。`,
      laterLabel: '稍后'
    }
  }
}

/**
 * Map sheet / host answers onto BreakEndPromptAction (fail-closed).
 */
export function normalizeBreakEndPromptAction(
  raw: string | null | undefined
): BreakEndPromptAction | null {
  if (raw == null || raw === '') return null
  if (raw === 'start_focus' || raw === 'start' || raw === 'focus' || raw === 'next_focus') {
    return 'start_focus'
  }
  if (raw === 'wrap_up' || raw === 'wrapup' || raw === 'wrap-up' || raw === '收尾') {
    return 'wrap_up'
  }
  if (raw === 'later' || raw === 'dismiss' || raw === 'cancel') return 'later'
  return null
}

/** Type guard: wrap_up phase. */
export function isWrapUpPhase(phase: TimerSessionPhase): phase is 'wrap_up' {
  return phase === 'wrap_up'
}
