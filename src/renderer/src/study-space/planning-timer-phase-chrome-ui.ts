/**
 * Pure presentation for STC-205 wrap_up mid-run chrome (and phase face labels).
 *
 * Distinguishes durable TimerSession phase from V1 shell timerMode:
 * wrap_up is stored as timerMode=break for analytics shell, but UI must
 * not label it as rest. No I/O, no React.
 */

import type { TimerSessionRecord } from '../../../shared/study-planning'
import type { StudyTimerMode } from './types'

export type PlanningTimerSurfacePhase = 'focus' | 'break' | 'wrap_up'

export type PlanningTimerPhaseChromeModel = {
  /** Effective phase for chrome (prefer live TimerSession). */
  surfacePhase: PlanningTimerSurfacePhase
  /** Card / ring mode class suffix: focus | break | wrap_up. */
  cardMode: PlanningTimerSurfacePhase
  /** Disclosure toggle label (e.g. 收尾计时). */
  timerLabel: string
  /** Optional face badge under the clock digits. */
  faceBadge: string | null
  /** Show focus-task attribution line (false for break/wrap_up). */
  showFocusTaskLabel: boolean
  /**
   * Whether mode tabs should follow user selection.
   * During wrap_up, tabs stay decorative (wrap_up is not focus/break).
   */
  modeTabsInteractive: boolean
  /** Tab that should appear selected for V1 shell (wrap_up maps to break). */
  selectedModeVisual: StudyTimerMode
  /** Short a11y phase hint (Chinese). */
  phaseHintZh: string
}

export type ProjectPlanningTimerPhaseChromeInput = {
  /** Live local TimerSession (UI clock authority) when present. */
  activeSession?: TimerSessionRecord | null
  /** V1 shell mode (focus | break). */
  timerMode: StudyTimerMode | string
  /** User-selected tab in the panel. */
  selectedMode: StudyTimerMode
}

function surfaceFromSessionPhase(
  phase: string | null | undefined
): PlanningTimerSurfacePhase | null {
  if (phase === 'wrap_up') return 'wrap_up'
  if (phase === 'focus') return 'focus'
  if (
    phase === 'short_break' ||
    phase === 'long_break' ||
    phase === 'break'
  ) {
    return 'break'
  }
  return null
}

/**
 * Project mid-run chrome from live TimerSession + V1 shell.
 * Prefer activeSession.phase when session is open (running/paused/needs_reconcile).
 */
export function projectPlanningTimerPhaseChrome(
  input: ProjectPlanningTimerPhaseChromeInput
): PlanningTimerPhaseChromeModel {
  const session = input.activeSession ?? null
  const open =
    session != null &&
    (session.state === 'running' ||
      session.state === 'paused' ||
      session.state === 'needs_reconcile')

  const fromSession = open ? surfaceFromSessionPhase(session!.phase) : null
  const surfacePhase: PlanningTimerSurfacePhase =
    fromSession ??
    (input.timerMode === 'break' ? 'break' : 'focus')

  if (surfacePhase === 'wrap_up') {
    return {
      surfacePhase: 'wrap_up',
      cardMode: 'wrap_up',
      timerLabel: '收尾计时',
      faceBadge: '收尾 · 不计入任务专注',
      showFocusTaskLabel: false,
      modeTabsInteractive: false,
      selectedModeVisual: 'break',
      phaseHintZh: '收尾'
    }
  }

  if (surfacePhase === 'break') {
    return {
      surfacePhase: 'break',
      cardMode: 'break',
      timerLabel: '休息计时',
      faceBadge: null,
      showFocusTaskLabel: false,
      modeTabsInteractive: true,
      selectedModeVisual: input.selectedMode === 'focus' ? 'focus' : 'break',
      phaseHintZh: '休息'
    }
  }

  // focus
  const previewingBreak =
    input.selectedMode === 'break' && input.timerMode !== 'break'
  return {
    surfacePhase: 'focus',
    cardMode: previewingBreak ? 'break' : 'focus',
    timerLabel: input.selectedMode === 'break' ? '休息计时' : '专注计时',
    faceBadge: null,
    showFocusTaskLabel: input.selectedMode === 'focus',
    modeTabsInteractive: true,
    selectedModeVisual: input.selectedMode,
    phaseHintZh: '专注'
  }
}
