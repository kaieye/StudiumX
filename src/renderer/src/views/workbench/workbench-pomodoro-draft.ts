/**
 * Pure timer-plan draft helpers for WorkbenchPomodoro settings editor.
 * No React / DOM. Keeps custom_rhythm and continuousMode authority intact.
 */

import type { StudySnapshot, StudyTimerPlanInput } from '../../study-space/types'
import {
  defaultTimerPlanAdvancedFields,
  isValidTimerPlanAdvancedDraft,
  type PomodoroBreakPolicy
} from '../../study-space/planning-timer-plan-advanced-fields'
import {
  defaultContinuousBreakPolicy,
  isValidContinuousPlanDraft,
  type ContinuousBreakPolicy,
  type StudyTimerPlanKind
} from '../../study-space/planning-timer-plan-kind'
import { totalMinutesFromSimulationWindow } from '../../study-space/planning-simulation-window-ui'

export type TimerPlanDraft = StudyTimerPlanInput

export type DraftFromPlanInput = {
  name: string
  focusMinutes: number
  breakMinutes: number
  simulationStartTime: string
  simulationEndTime: string
  longBreakMinutes?: number
  longBreakEvery?: number
  kind?: StudyTimerPlanKind | string
  clockMode?: 'countdown' | 'countup' | string
  continuousTarget?: boolean
  continuousMode?: 'open' | 'target' | 'exam' | string
  breakPolicy?: PomodoroBreakPolicy | ContinuousBreakPolicy | string
  rhythmSequence?: StudyTimerPlanInput['rhythmSequence']
}

function resolveDraftKind(kind: StudyTimerPlanKind | string | undefined): StudyTimerPlanKind {
  if (kind === 'continuous') return 'continuous'
  if (kind === 'custom_rhythm') return 'custom_rhythm'
  return 'pomodoro'
}

function resolveContinuousMode(
  plan: Pick<DraftFromPlanInput, 'kind' | 'continuousMode' | 'continuousTarget'>
): 'open' | 'target' | 'exam' | undefined {
  const raw = plan.continuousMode
  if (raw === 'open' || raw === 'target' || raw === 'exam') return raw
  if (plan.kind === 'continuous') {
    // Prefer explicit continuousTarget for exam; otherwise target cycle.
    if (plan.continuousTarget === true) return 'exam'
    return 'target'
  }
  return undefined
}

/** Blank draft for 添加方案: always pomodoro shell. */
export function createTimerPlanDraft(snapshot: StudySnapshot): TimerPlanDraft {
  const advanced = defaultTimerPlanAdvancedFields()
  // Blank draft for 添加方案: always pomodoro shell. Do not inherit kind from
  // timerPlans[0] — that previously jumped the editor to continuous after save.
  return {
    name: '',
    focusMinutes: snapshot.focusMinutes,
    breakMinutes: snapshot.breakMinutes,
    simulationStartTime: snapshot.simulationStartTime,
    simulationEndTime: snapshot.simulationEndTime,
    longBreakMinutes: advanced.longBreakMinutes,
    longBreakEvery: advanced.longBreakEvery,
    kind: 'pomodoro',
    clockMode: 'countdown',
    continuousTarget: undefined,
    continuousMode: undefined,
    rhythmSequence: undefined,
    breakPolicy: advanced.breakPolicy
  }
}

/**
 * Project a stored plan / catalog shell into the editor draft.
 * Preserves custom_rhythm (does not collapse to pomodoro).
 * Prefers continuousMode over catalog-id heuristics for exam.
 */
export function draftFromPlan(plan: DraftFromPlanInput): TimerPlanDraft {
  const advanced = defaultTimerPlanAdvancedFields()
  const kind = resolveDraftKind(plan.kind)
  const continuousMode = kind === 'continuous' ? resolveContinuousMode(plan) : undefined
  const isExam =
    continuousMode === 'exam' || (kind === 'continuous' && plan.continuousTarget === true)
  const clockMode =
    kind === 'custom_rhythm'
      ? 'countdown'
      : plan.clockMode === 'countup' || isExam
        ? 'countup'
        : 'countdown'

  return {
    name: plan.name,
    focusMinutes: plan.focusMinutes,
    breakMinutes: plan.breakMinutes,
    simulationStartTime: plan.simulationStartTime,
    simulationEndTime: plan.simulationEndTime,
    longBreakMinutes: plan.longBreakMinutes ?? advanced.longBreakMinutes,
    longBreakEvery: plan.longBreakEvery ?? advanced.longBreakEvery,
    kind,
    clockMode,
    continuousTarget: kind === 'continuous' ? isExam : undefined,
    continuousMode:
      kind === 'continuous'
        ? (isExam ? 'exam' : continuousMode === 'open' ? 'open' : 'target')
        : undefined,
    rhythmSequence: kind === 'custom_rhythm' ? plan.rhythmSequence : undefined,
    breakPolicy: (plan.breakPolicy ?? (
      kind === 'continuous' ? defaultContinuousBreakPolicy() : advanced.breakPolicy
    )) as PomodoroBreakPolicy | ContinuousBreakPolicy
  }
}

/** Normalize editor draft into StudyTimerPlanInput for save/apply. */
export function buildPlanPayload(draft: TimerPlanDraft): StudyTimerPlanInput {
  const kind = resolveDraftKind(draft.kind)
  const continuousMode =
    kind === 'continuous'
      ? (
        draft.continuousMode === 'open'
        || draft.continuousMode === 'target'
        || draft.continuousMode === 'exam'
          ? draft.continuousMode
          : draft.continuousTarget === true
            ? 'exam'
            : 'target'
      )
      : undefined
  const isExam = kind === 'continuous' && continuousMode === 'exam'
  const totalMinutes =
    totalMinutesFromSimulationWindow(draft.simulationStartTime, draft.simulationEndTime)
    ?? (Number.isInteger(draft.focusMinutes) ? draft.focusMinutes : 90)

  if (kind === 'custom_rhythm') {
    return {
      ...draft,
      name: draft.name.trim(),
      kind: 'custom_rhythm',
      clockMode: 'countdown',
      continuousTarget: undefined,
      continuousMode: undefined,
      rhythmSequence: draft.rhythmSequence
    }
  }

  return {
    ...draft,
    name: draft.name.trim(),
    kind,
    // Exam always countup; pomodoro/continuous cycle may opt into countup.
    clockMode: isExam
      ? 'countup'
      : (draft.clockMode === 'countup' ? 'countup' : 'countdown'),
    continuousTarget: kind === 'continuous' ? isExam : undefined,
    continuousMode: kind === 'continuous' ? continuousMode : undefined,
    focusMinutes: isExam ? totalMinutes : draft.focusMinutes,
    breakMinutes: kind === 'continuous'
      ? (isExam ? 0 : (draft.breakMinutes || 0))
      : draft.breakMinutes,
    rhythmSequence: undefined
  }
}

/** Full draft validity for catalog save / primary CTA. */
export function isDraftPayloadValid(next: TimerPlanDraft): boolean {
  const kind = resolveDraftKind(next.kind)
  const total =
    totalMinutesFromSimulationWindow(next.simulationStartTime, next.simulationEndTime)
    ?? (
      Number.isInteger(next.focusMinutes) && next.focusMinutes >= 5
        ? next.focusMinutes
        : null
    )
  if (kind === 'continuous') {
    return isValidContinuousPlanDraft({
      name: next.name,
      focusMinutes: next.focusMinutes,
      breakMinutes: next.breakMinutes,
      continuousTarget: next.continuousTarget === true || next.continuousMode === 'exam',
      continuousMode: next.continuousMode,
      breakPolicy: next.breakPolicy,
      totalMinutes: total,
      simulationStartTime: next.simulationStartTime,
      simulationEndTime: next.simulationEndTime
    })
  }
  if (kind === 'custom_rhythm') {
    return Boolean(next.name.trim())
  }
  return Boolean(next.name.trim())
    && Number.isInteger(next.focusMinutes)
    && Number.isInteger(next.breakMinutes)
    && next.focusMinutes >= 5
    && next.focusMinutes <= 120
    && next.breakMinutes >= 0
    && next.breakMinutes <= 45
    && isValidTimerPlanAdvancedDraft({
      longBreakMinutes: next.longBreakMinutes,
      longBreakEvery: next.longBreakEvery,
      breakPolicy: next.breakPolicy
    })
}

/** Timer fields only — immediate active-preset apply without requiring catalog name. */
export function hasApplyableTimerFields(next: TimerPlanDraft): boolean {
  const kind = resolveDraftKind(next.kind)
  if (kind === 'continuous') {
    const total = totalMinutesFromSimulationWindow(next.simulationStartTime, next.simulationEndTime)
    const isExam = next.continuousMode === 'exam' || next.continuousTarget === true
    if (isExam) {
      return total != null && total >= 5
    }
    return Number.isInteger(next.focusMinutes)
      && next.focusMinutes >= 5
      && next.focusMinutes <= 240
      && Number.isInteger(next.breakMinutes)
      && next.breakMinutes >= 0
      && next.breakMinutes <= 45
      && total != null
      && total >= 5
  }
  if (kind === 'custom_rhythm') {
    return Boolean(next.rhythmSequence?.length)
  }
  return Number.isInteger(next.focusMinutes)
    && Number.isInteger(next.breakMinutes)
    && next.focusMinutes >= 5
    && next.focusMinutes <= 120
    && next.breakMinutes >= 0
    && next.breakMinutes <= 45
}

/** Normalize catalog row planKind to draft kind without exam-id hardcoding. */
export function draftKindFromCatalogPlanKind(
  planKind: 'pomodoro' | 'continuous' | 'custom_rhythm' | string,
  continuousMode?: 'open' | 'target' | 'exam' | string | null,
  continuousTarget?: boolean
): StudyTimerPlanKind {
  if (planKind === 'continuous') return 'continuous'
  if (planKind === 'custom_rhythm') return 'custom_rhythm'
  if (continuousMode === 'exam' || continuousMode === 'open' || continuousMode === 'target') {
    return 'continuous'
  }
  if (continuousTarget === true) return 'continuous'
  return 'pomodoro'
}
