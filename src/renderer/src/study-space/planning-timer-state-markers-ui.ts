/**
 * Pure presentation for STC-604: non-color state markers + reduced-motion class plan.
 *
 * §11.2: running / paused / rest / wrap_up / overtime must not rely on color alone;
 * reduce non-essential motion when prefers-reduced-motion is set.
 * No I/O, no React, no window access (caller passes reducedMotion boolean).
 */

import type { TimerSessionRecord } from '../../../shared/study-planning'
import type { StudyTimerMode, StudyTimerState } from './types'
import {
  projectPlanningTimerPhaseChrome,
  type PlanningTimerSurfacePhase
} from './planning-timer-phase-chrome-ui'

export type PlanningTimerVisualState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'needs_reconcile'

export type PlanningTimerStateMarkerModel = {
  /** Effective visual state (prefer live TimerSession). */
  visualState: PlanningTimerVisualState
  /** Surface phase from phase chrome (focus | break | wrap_up). */
  surfacePhase: PlanningTimerSurfacePhase
  /**
   * Short Chinese state word for face / chip (not color-only).
   * Examples: 运行中 / 已暂停 / 待对账 / 空闲
   */
  stateLabelZh: string
  /**
   * Short Chinese phase word (not color-only).
   * Examples: 专注 / 休息 / 收尾
   */
  phaseLabelZh: string
  /**
   * Combined chip text for UI (state · phase), e.g. "运行中 · 专注".
   * Always includes text so color-blind users get status without hue.
   */
  stateChipText: string
  /**
   * Optional overtime badge when remainingSeconds hit 0 while still open countdown.
   * null when not overtime.
   */
  overtimeLabelZh: string | null
  /** Card data attribute value for CSS hooks (not teaching authority). */
  dataTimerState: PlanningTimerVisualState
  /**
   * Class tokens for the pomodoro card (excluding open/closing/settings).
   * Host joins with spaces. Includes is-{phase} and is-state-{visualState}
   * and optionally is-overtime / is-reduced-motion.
   */
  cardClassTokens: string[]
  /**
   * When reducedMotion is true, progress bar / ring should snap (no CSS transition).
   * Pure flag for host + CSS class is-reduced-motion.
   */
  reduceMotion: boolean
}

export type ProjectPlanningTimerStateMarkerInput = {
  timerState: StudyTimerState | string
  timerMode: StudyTimerMode | string
  selectedMode?: StudyTimerMode
  activeSession?: TimerSessionRecord | null
  /**
   * Remaining seconds for open countdown face (0 → overtime badge when running/paused).
   * Count-up continuous sessions never show overtime via remaining alone.
   */
  remainingSeconds?: number | null
  /** Caller-resolved prefers-reduced-motion (default false). */
  reducedMotion?: boolean
  /**
   * When true, treat remainingSeconds===0 as overtime (countdown segments).
   * Host should pass false for open continuous count-up.
   */
  countdownSegment?: boolean
}

function visualStateFrom(
  session: TimerSessionRecord | null | undefined,
  timerState: string
): PlanningTimerVisualState {
  if (session) {
    if (session.state === 'needs_reconcile') return 'needs_reconcile'
    if (session.state === 'running') return 'running'
    if (session.state === 'paused') return 'paused'
    // completed / cancelled → fall through to shell
  }
  if (timerState === 'running') return 'running'
  if (timerState === 'paused') return 'paused'
  return 'idle'
}

function stateLabelZh(state: PlanningTimerVisualState): string {
  switch (state) {
    case 'running':
      return '运行中'
    case 'paused':
      return '已暂停'
    case 'needs_reconcile':
      return '待对账'
    default:
      return '空闲'
  }
}

/**
 * Project non-color state markers + reduced-motion class tokens for WorkbenchPomodoro.
 */
export function projectPlanningTimerStateMarkers(
  input: ProjectPlanningTimerStateMarkerInput
): PlanningTimerStateMarkerModel {
  const selectedMode: StudyTimerMode =
    input.selectedMode === 'break' || input.selectedMode === 'focus'
      ? input.selectedMode
      : input.timerMode === 'break'
        ? 'break'
        : 'focus'

  const phaseChrome = projectPlanningTimerPhaseChrome({
    activeSession: input.activeSession ?? null,
    timerMode: input.timerMode,
    selectedMode
  })

  const visualState = visualStateFrom(
    input.activeSession ?? null,
    String(input.timerState || 'idle')
  )
  const stateZh = stateLabelZh(visualState)
  const phaseZh = phaseChrome.phaseHintZh

  const remaining =
    typeof input.remainingSeconds === 'number' && Number.isFinite(input.remainingSeconds)
      ? Math.max(0, Math.floor(input.remainingSeconds))
      : null
  const countdown =
    input.countdownSegment !== false &&
    // Prefer session clockMode when open
    (input.activeSession?.clockMode !== 'countup')
  const isOpen =
    visualState === 'running' ||
    visualState === 'paused' ||
    visualState === 'needs_reconcile'
  const overtime =
    countdown && isOpen && remaining === 0 ? '已超时' : null

  const reduceMotion = input.reducedMotion === true

  const cardClassTokens = [
    `is-${phaseChrome.cardMode}`,
    `is-state-${visualState}`
  ]
  if (overtime) cardClassTokens.push('is-overtime')
  if (reduceMotion) cardClassTokens.push('is-reduced-motion')

  return {
    visualState,
    surfacePhase: phaseChrome.surfacePhase,
    stateLabelZh: stateZh,
    phaseLabelZh: phaseZh,
    stateChipText: `${stateZh} · ${phaseZh}`,
    overtimeLabelZh: overtime,
    dataTimerState: visualState,
    cardClassTokens,
    reduceMotion
  }
}
