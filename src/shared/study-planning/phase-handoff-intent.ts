/**
 * Pure host intents after focus/break segment handoff (STC-205 / freeze #3/#6).
 *
 * Projectors ({@link projectPhaseHandoffPlan} / {@link projectBreakEndHandoffPlan})
 * already answer disposition + targets. This module hides the four-way
 * disposition → shell / notify / start table so useStudySession does not
 * re-implement the same switch twice.
 *
 * No I/O. Host applies commits, dual-write starts, and notifications.
 */

import type {
  BreakEndHandoffPlan,
  BreakEndPromptAction
} from './break-end-prompt-sheet'
import { normalizeBreakEndPromptAction } from './break-end-prompt-sheet'
import type { PhaseHandoffPlan, PhasePromptAction } from './phase-prompt-sheet'
import {
  normalizePhasePromptAction,
  normalizePhasePromptExtendMinutes
} from './phase-prompt-sheet'

export type FocusCompleteHandoffIntent =
  | { kind: 'auto_start_break'; breakMinutes: number }
  | {
      kind: 'remind'
      breakMinutes: number
      notifyTitle: string
      notifyBody: string
    }
  | { kind: 'suppress_to_focus_idle' }
  | { kind: 'prompt'; breakMinutes: number }

export type BreakEndHandoffIntent =
  | { kind: 'auto_start_focus' }
  | {
      kind: 'remind'
      notifyTitle: string
      notifyBody: string
      nextFocusRound: number
    }
  | { kind: 'suppress_idle_focus' }
  | { kind: 'prompt' }

export type PhasePromptAnswerIntent =
  | { kind: 'noop' }
  | { kind: 'skip_to_focus_idle' }
  | { kind: 'start_break' }
  | { kind: 'extend_and_start'; extendMinutes: number }

export type BreakEndAnswerIntent =
  | { kind: 'noop' }
  | { kind: 'start_focus' }
  | { kind: 'wrap_up' }

/**
 * Map post-focus disposition to a single host intent (shell + side effects).
 */
export function resolveFocusCompleteHandoffIntent(
  handoff: PhaseHandoffPlan
): FocusCompleteHandoffIntent {
  const breakMinutes = handoff.nextBreakMinutes
  if (handoff.disposition === 'auto_start') {
    return { kind: 'auto_start_break', breakMinutes }
  }
  if (handoff.disposition === 'remind') {
    return {
      kind: 'remind',
      breakMinutes,
      notifyTitle: '自习室',
      notifyBody: `专注到点。当前方案仅提醒休息（${breakMinutes} 分钟建议）。`
    }
  }
  if (handoff.disposition === 'suppress') {
    return { kind: 'suppress_to_focus_idle' }
  }
  return { kind: 'prompt', breakMinutes }
}

/**
 * Map post-break disposition to a single host intent.
 * Idle focus shell seconds remain host-local (depends on hostAfterAdvance).
 */
export function resolveBreakEndHandoffIntent(
  handoff: BreakEndHandoffPlan
): BreakEndHandoffIntent {
  if (handoff.disposition === 'auto_start') {
    return { kind: 'auto_start_focus' }
  }
  if (handoff.disposition === 'remind') {
    return {
      kind: 'remind',
      nextFocusRound: handoff.nextFocusRound,
      notifyTitle: '自习室',
      notifyBody: `休息到点。当前方案仅提醒（下一轮专注建议第 ${handoff.nextFocusRound} 轮）。`
    }
  }
  if (handoff.disposition === 'suppress') {
    return { kind: 'suppress_idle_focus' }
  }
  return { kind: 'prompt' }
}

/**
 * Map phase-prompt sheet answer → host intent (fail-closed).
 */
export function resolvePhasePromptAnswerIntent(input: {
  action: PhasePromptAction | string | null | undefined
  extendMinutes?: number | string | null
}): PhasePromptAnswerIntent {
  const action = normalizePhasePromptAction(
    typeof input.action === 'string' ? input.action : input.action ?? null
  )
  if (!action || action === 'later') return { kind: 'noop' }
  if (action === 'skip_break') return { kind: 'skip_to_focus_idle' }
  if (action === 'start_break') return { kind: 'start_break' }
  if (action === 'extend_and_start') {
    const extendMinutes = normalizePhasePromptExtendMinutes(input.extendMinutes)
    if (extendMinutes == null) return { kind: 'noop' }
    return { kind: 'extend_and_start', extendMinutes }
  }
  return { kind: 'noop' }
}

/**
 * Map break-end sheet answer → host intent (fail-closed).
 * wrap_up is suppressed when the handoff does not offer it.
 */
export function resolveBreakEndAnswerIntent(input: {
  action: BreakEndPromptAction | string | null | undefined
  offerWrapUp: boolean
}): BreakEndAnswerIntent {
  const action = normalizeBreakEndPromptAction(
    typeof input.action === 'string' ? input.action : input.action ?? null
  )
  if (!action || action === 'later') return { kind: 'noop' }
  if (action === 'start_focus') return { kind: 'start_focus' }
  if (action === 'wrap_up') {
    if (!input.offerWrapUp) return { kind: 'noop' }
    return { kind: 'wrap_up' }
  }
  return { kind: 'noop' }
}
