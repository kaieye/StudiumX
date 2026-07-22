/**
 * Pure presentation for STC-603: non-ticking timer status + keyboard action map.
 *
 * Wraps shared `timerStatusAriaLabel` for WorkbenchPomodoro (and hosts) without
 * I/O or React. Status text must never include ticking seconds (§11.2).
 */

import { timerStatusAriaLabel } from '../../../shared/study-planning'
import type { TimerSessionRecord } from '../../../shared/study-planning'
import type { StudyTimerMode, StudyTimerState } from './types'

export type PlanningTimerKeyboardAction =
  | 'toggle_or_start'
  | 'reset'
  | 'extend_break'
  | 'select_focus'
  | 'select_break'
  | 'none'

export type PlanningTimerA11yStatusModel = {
  /** Static status for aria-live (no MM:SS / digits of remaining time). */
  statusLabel: string
  /** Prefer live TimerSession fields when present; else V1 shell snapshot. */
  state: string
  phase: string
  clockMode: string
  taskTitle: string | null
}

export type PlanningTimerKeyboardMapInput = {
  /** Space / Enter → start preview mode or toggle running/paused. */
  key: string
  /** When true, ignore shortcuts (user is typing in an input/select/textarea). */
  targetIsEditable?: boolean
  /**
   * Panel is open and focused enough to accept shortcuts.
   * Host should only call when the pomodoro panel (not settings) has focus.
   */
  panelOpen?: boolean
  /** Settings drawer open — shortcuts suppressed so inputs stay normal. */
  settingsOpen?: boolean
  /** Whether extend-break control is available (host already computed). */
  canExtendBreak?: boolean
  selectedMode?: StudyTimerMode
}

export type PlanningTimerKeyboardMapResult = {
  action: PlanningTimerKeyboardAction
  /** When true, host should preventDefault / stopPropagation. */
  preventDefault: boolean
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Resolve status fields for SR: prefer active TimerSession over V1 shell.
 * Never includes remaining/elapsed seconds.
 */
export function projectPlanningTimerA11yStatus(input: {
  timerState: StudyTimerState | string
  timerMode: StudyTimerMode | string
  /** Optional live session (UI clock authority). */
  activeSession?: TimerSessionRecord | null
  /** Selected / focus task title when attributing focus. */
  taskTitle?: string | null
  /**
   * Fallback clock mode when no active session (V1 shell is always countdown
   * for classic pomodoro display).
   */
  fallbackClockMode?: 'countdown' | 'countup'
}): PlanningTimerA11yStatusModel {
  const session = input.activeSession ?? null
  const state = session?.state ?? String(input.timerState || 'idle')
  const phase = session?.phase
    ?? (input.timerMode === 'break' ? 'break' : 'focus')
  const clockMode =
    session?.clockMode
    ?? input.fallbackClockMode
    ?? 'countdown'
  const taskTitle =
    typeof input.taskTitle === 'string' && input.taskTitle.trim().length > 0
      ? input.taskTitle.trim()
      : null

  const statusLabel = timerStatusAriaLabel({
    state,
    phase,
    clockMode,
    taskTitle
  })

  return {
    statusLabel,
    state,
    phase,
    clockMode,
    taskTitle
  }
}

/**
 * Map a keydown to a pomodoro control action. Pure; host owns handlers.
 *
 * - Space / Enter → toggle_or_start
 * - r / R → reset
 * - + / = → extend_break (only when canExtendBreak)
 * - ArrowLeft / f → select_focus
 * - ArrowRight / b → select_break
 *
 * Editable targets and closed/settings panels map to none (no preventDefault).
 */
export function mapPlanningTimerKeyboardAction(
  input: PlanningTimerKeyboardMapInput
): PlanningTimerKeyboardMapResult {
  if (input.targetIsEditable === true) {
    return { action: 'none', preventDefault: false }
  }
  if (input.panelOpen === false) {
    return { action: 'none', preventDefault: false }
  }
  if (input.settingsOpen === true) {
    return { action: 'none', preventDefault: false }
  }

  const key = input.key
  if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
    return { action: 'toggle_or_start', preventDefault: true }
  }
  if (key === 'r' || key === 'R') {
    return { action: 'reset', preventDefault: true }
  }
  if ((key === '+' || key === '=') && input.canExtendBreak === true) {
    return { action: 'extend_break', preventDefault: true }
  }
  if (key === 'ArrowLeft' || key === 'f' || key === 'F') {
    if (input.selectedMode === 'focus') {
      return { action: 'none', preventDefault: false }
    }
    return { action: 'select_focus', preventDefault: true }
  }
  if (key === 'ArrowRight' || key === 'b' || key === 'B') {
    if (input.selectedMode === 'break') {
      return { action: 'none', preventDefault: false }
    }
    return { action: 'select_break', preventDefault: true }
  }
  return { action: 'none', preventDefault: false }
}

/** True when the event target is an editable control (input/select/textarea/contenteditable). */
export function isPlanningTimerKeyboardTargetEditable(
  target: EventTarget | null | undefined
): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as {
    tagName?: string
    isContentEditable?: boolean
    closest?: (selector: string) => Element | null
  }
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (EDITABLE_TAGS.has(tag)) return true
  if (el.isContentEditable === true) return true
  if (typeof el.closest === 'function') {
    try {
      if (el.closest('input, textarea, select, [contenteditable="true"]')) {
        return true
      }
    } catch {
      // ignore
    }
  }
  return false
}
