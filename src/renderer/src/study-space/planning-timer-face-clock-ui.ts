/**
 * Pure face-clock projection for WorkbenchPomodoro + ImmersiveFocusTimer.
 *
 * Idle / mode-preview must follow the **applied** plan (pomodoro, continuous cycle,
 * exam window, open countup) — not a hard-coded 25:00 + "25 / 5 · 09:00–12:00" chrome.
 * Exam continuous: dial shows the simulation start wall-clock (e.g. 09:00) and counts up.
 * Exam detection prefers continuousMode (via continuousModeFromV1), not only continuousTarget.
 * No I/O, no React.
 */

import { formatStudyDuration } from './domain'
import { isExamContinuousPlan, normalizeTimerPlanKindFields } from './planning-timer-plan-kind'
import type { StudyTimerMode, StudyTimerPlan, StudyTimerState } from './types'

export type WorkbenchTimerFaceClockModel = {
  /** Seconds shown on the dial (countdown remaining, countup elapsed, or wall offset). */
  displaySeconds: number
  /** countdown | countup — open countup idle seeds at 00:00; exam uses wall countup. */
  clockMode: 'countdown' | 'countup'
  /**
   * Optional caption under the dial. Prefer null: plan details live in settings,
   * not a misleading combined "25/5 · window" line on every plan.
   */
  faceMeta: string | null
  /**
   * When set, dial formats as a wall clock (HH:MM or HH:MM:SS) from this base + displaySeconds.
   * Used for exam simulation (start at e.g. 09:00, then count up).
   */
  wallBaseSeconds?: number | null
}

/** Plan fields needed for face kind / exam / countup projection. */
export type TimerFaceAppliedPlan = Pick<
  StudyTimerPlan,
  'kind' | 'clockMode' | 'continuousTarget' | 'continuousMode' | 'focusMinutes' | 'breakMinutes'
> | null | undefined

export type ProjectWorkbenchTimerFaceClockInput = {
  timerState: StudyTimerState | string
  timerMode: StudyTimerMode | string
  selectedMode: StudyTimerMode
  remainingSeconds: number
  focusMinutes: number
  breakMinutes: number
  simulationStartTime?: string | null
  simulationEndTime?: string | null
  /** Applied / default plan shell when known (kind + continuousMode + clockMode). */
  appliedPlan?: TimerFaceAppliedPlan
  activeSessionClockMode?: 'countdown' | 'countup' | null
}

function asMode(value: string | StudyTimerMode): StudyTimerMode {
  return value === 'break' ? 'break' : 'focus'
}

function planKind(
  plan: TimerFaceAppliedPlan
): 'pomodoro' | 'continuous' | 'custom_rhythm' {
  if (!plan) return 'pomodoro'
  return normalizeTimerPlanKindFields({ kind: plan.kind }).kind
}

/**
 * Exam continuous face: prefer continuousMode / continuousModeFromV1 over
 * continuousTarget-only (target countup must not paint wall clock).
 */
function isExamContinuous(plan: TimerFaceAppliedPlan): boolean {
  if (!plan || planKind(plan) !== 'continuous') return false
  return isExamContinuousPlan(plan)
}

/** Non-exam countup dial (pomodoro countup or continuous open/cycle countup). */
function isCountupFace(plan: TimerFaceAppliedPlan): boolean {
  if (isExamContinuous(plan)) return false
  return plan?.clockMode === 'countup'
}

/**
 * Parse "HH:MM" or "H:MM" into seconds from local midnight. Null when invalid.
 */
export function parseSimulationTimeToSeconds(
  value: string | null | undefined
): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = m[3] != null ? Number(m[3]) : 0
  if (!Number.isInteger(h) || !Number.isInteger(min) || !Number.isInteger(sec)) return null
  if (h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) return null
  return h * 3600 + min * 60 + sec
}

export type FaceClockTimeParts = {
  /** Primary line: HH:MM (wall) or minutes (duration). */
  primary: string
  /** Secondary line: SS (always two digits). */
  seconds: string
}

/**
 * Format wall seconds-from-midnight (+ optional day wrap).
 * Primary is HH:MM; seconds are always a separate SS line for the dial.
 */
export function formatExamWallClockParts(
  wallBaseSeconds: number,
  elapsedSeconds: number
): FaceClockTimeParts {
  const total = Math.max(0, Math.floor(wallBaseSeconds) + Math.max(0, Math.floor(elapsedSeconds)))
  const day = total % 86400
  const h = Math.floor(day / 3600)
  const m = Math.floor((day % 3600) / 60)
  const s = day % 60
  return {
    primary: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    seconds: String(s).padStart(2, '0')
  }
}

/**
 * Format duration (countdown/countup) as minutes primary + SS secondary.
 * Long sessions may show more than 2 minute digits (e.g. 180).
 */
export function formatDurationClockParts(totalSeconds: number): FaceClockTimeParts {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const s = safe % 60
  return {
    primary: String(minutes).padStart(2, '0'),
    seconds: String(s).padStart(2, '0')
  }
}

/**
 * Compact single-line wall clock (e.g. header meta). HH:MM or HH:MM:SS.
 */
export function formatExamWallClock(
  wallBaseSeconds: number,
  elapsedSeconds: number,
  options?: { alwaysSeconds?: boolean }
): string {
  const parts = formatExamWallClockParts(wallBaseSeconds, elapsedSeconds)
  if (options?.alwaysSeconds || Number(parts.seconds) !== 0 || elapsedSeconds > 0) {
    return `${parts.primary}:${parts.seconds}`
  }
  return parts.primary
}

/**
 * Idle / preview duration for the selected mode, in whole seconds.
 * Exam continuous returns elapsed seed 0 (wall start is painted via wallBaseSeconds).
 */
export function projectPlanPreviewSeconds(input: {
  selectedMode: StudyTimerMode
  focusMinutes: number
  breakMinutes: number
  simulationStartTime?: string | null
  simulationEndTime?: string | null
  appliedPlan?: TimerFaceAppliedPlan
}): number {
  const plan = input.appliedPlan ?? null
  const focusMin = Number.isFinite(input.focusMinutes)
    ? Math.max(0, Math.floor(input.focusMinutes))
    : 0
  const breakMin = Number.isFinite(input.breakMinutes)
    ? Math.max(0, Math.floor(input.breakMinutes))
    : 0

  if (input.selectedMode === 'break') {
    // Exam continuous has no rest segment on the product face.
    if (isExamContinuous(plan)) return 0
    return breakMin * 60
  }

  if (isCountupFace(plan) || isExamContinuous(plan)) {
    // Countup faces seed at 0 elapsed (exam paints wall base separately).
    return 0
  }

  // Continuous cycle / pomodoro / custom: applied focus minutes on the host shell.
  return focusMin * 60
}

/**
 * Dial caption. Always null for now — plan cadence / exam window belong in settings,
 * not under the live face (avoids 25/5 + default 09:00–12:00 on every plan).
 */
export function projectWorkbenchTimerFaceMeta(_input: {
  selectedMode: StudyTimerMode
  focusMinutes: number
  breakMinutes: number
  simulationStartTime?: string | null
  simulationEndTime?: string | null
  appliedPlan?: TimerFaceAppliedPlan
}): string | null {
  return null
}

/**
 * Project what the pomodoro dial should show for the current host snapshot.
 */
export function projectWorkbenchTimerFaceClock(
  input: ProjectWorkbenchTimerFaceClockInput
): WorkbenchTimerFaceClockModel {
  const selectedMode = asMode(input.selectedMode)
  const isModePreview = selectedMode !== asMode(String(input.timerMode || 'focus'))
  const timerState = String(input.timerState || 'idle')
  const plan = input.appliedPlan ?? null
  const openCountup = isCountupFace(plan)
  const exam = isExamContinuous(plan)
  const liveClockMode: 'countdown' | 'countup' =
    input.activeSessionClockMode === 'countup' || openCountup || exam
      ? 'countup'
      : 'countdown'

  const wallBaseSeconds = exam
    ? parseSimulationTimeToSeconds(input.simulationStartTime)
    : null

  const faceMeta = projectWorkbenchTimerFaceMeta({
    selectedMode,
    focusMinutes: input.focusMinutes,
    breakMinutes: input.breakMinutes,
    simulationStartTime: input.simulationStartTime,
    simulationEndTime: input.simulationEndTime,
    appliedPlan: plan
  })

  const useLive =
    !isModePreview
    && (timerState === 'running' || timerState === 'paused')

  if (useLive) {
    const live = Number.isFinite(input.remainingSeconds)
      ? Math.max(0, Math.floor(input.remainingSeconds))
      : 0
    return {
      displaySeconds: live,
      clockMode: liveClockMode,
      faceMeta,
      wallBaseSeconds
    }
  }

  const preview = projectPlanPreviewSeconds({
    selectedMode,
    focusMinutes: input.focusMinutes,
    breakMinutes: input.breakMinutes,
    simulationStartTime: input.simulationStartTime,
    simulationEndTime: input.simulationEndTime,
    appliedPlan: plan
  })

  return {
    displaySeconds: preview,
    clockMode: liveClockMode,
    faceMeta,
    wallBaseSeconds
  }
}

/** Shared dial presentation for WorkbenchPomodoro + immersive focus timer. */
export type ProjectTimerFacePresentationInput = ProjectWorkbenchTimerFaceClockInput & {
  /** 0–100 host progress; clamped. */
  timerProgress?: number | null
  /**
   * When true (WorkbenchPomodoro), mode-tab preview zeros the ring.
   * Immersive has no mode tabs — leave false/undefined.
   */
  modePreviewZerosProgress?: boolean
}

export type TimerFacePresentationModel = {
  faceClock: WorkbenchTimerFaceClockModel
  displaySeconds: number
  isExamFace: boolean
  /** Dial primary + SS parts (wall or duration). */
  timeParts: FaceClockTimeParts
  /** Single-line a11y / compact label (MM:SS or wall HH:MM[:SS]). */
  remainingTime: string
  displayedProgress: number
  /** CSS custom property for the progress ring. */
  ringStyle: { '--timer-ring-offset': string }
}

/**
 * Project dial clock + formatted labels + ring progress for any workbench face.
 * Both WorkbenchPomodoro and ImmersiveFocusTimerScene should call this with the
 * same snapshot/plan/session slice so exam/countup paint identically.
 */
export function projectTimerFacePresentation(
  input: ProjectTimerFacePresentationInput
): TimerFacePresentationModel {
  const faceClock = projectWorkbenchTimerFaceClock(input)
  const displaySeconds = faceClock.displaySeconds
  const isExamFace = faceClock.wallBaseSeconds != null
  const timerState = String(input.timerState || 'idle')
  const timeParts = isExamFace
    ? formatExamWallClockParts(faceClock.wallBaseSeconds!, displaySeconds)
    : formatDurationClockParts(displaySeconds)
  const remainingTime = isExamFace
    ? formatExamWallClock(faceClock.wallBaseSeconds!, displaySeconds, {
        alwaysSeconds: timerState === 'running' || timerState === 'paused'
      })
    : formatStudyDuration(displaySeconds)

  const selectedMode = asMode(input.selectedMode)
  const isModePreview = selectedMode !== asMode(String(input.timerMode || 'focus'))
  const zeroProgress = Boolean(input.modePreviewZerosProgress) && isModePreview
  const displayedProgress = zeroProgress
    ? 0
    : Math.min(100, Math.max(0, input.timerProgress ?? 0))

  return {
    faceClock,
    displaySeconds,
    isExamFace,
    timeParts,
    remainingTime,
    displayedProgress,
    ringStyle: { '--timer-ring-offset': `${100 - displayedProgress}` }
  }
}
