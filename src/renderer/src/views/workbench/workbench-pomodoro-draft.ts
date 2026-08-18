/**
 * Pure timer-plan draft helpers for WorkbenchPomodoro settings editor.
 * No React / DOM. Keeps custom_rhythm and continuousMode authority intact.
 *
 * Also owns editor kind-switch transitions and live-commit decisions so React
 * components only wire state + host callbacks.
 */

import type { StudySnapshot, StudyTimerPlanInput } from '../../study-space/types'
import {
  defaultTimerPlanAdvancedFields,
  isValidTimerPlanAdvancedDraft,
  type PomodoroBreakPolicy
} from '../../study-space/planning-timer-plan-advanced-fields'
import {
  continuousModeFromV1,
  defaultContinuousBreakPolicy,
  isExamContinuousPlan,
  isValidContinuousPlanDraft,
  isValidCustomRhythmPlanDraft,
  normalizeTimerPlanKindFields,
  type ContinuousBreakPolicy,
  type StudyTimerPlanKind,
  type StudyTimerPlanKindUi
} from '../../study-space/planning-timer-plan-kind'
import {
  simulationWindowFromTotalMinutes,
  totalMinutesFromSimulationWindow
} from '../../study-space/planning-simulation-window-ui'
import { normalizeBreakPolicy } from '../../../../shared/study-planning'

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
  return normalizeTimerPlanKindFields({ kind: kind as StudyTimerPlanKind | undefined }).kind
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
  const continuousMode =
    kind === 'continuous'
      ? continuousModeFromV1({
          kind: 'continuous',
          clockMode: plan.clockMode === 'countup' || plan.clockMode === 'countdown'
            ? plan.clockMode
            : undefined,
          continuousTarget: plan.continuousTarget === true,
          continuousMode: plan.continuousMode as 'open' | 'target' | 'exam' | undefined,
          focusMinutes: plan.focusMinutes
        })
      : undefined
  const isExam = kind === 'continuous' && continuousMode === 'exam'
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
    continuousMode: kind === 'continuous' ? continuousMode : undefined,
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
      ? continuousModeFromV1({
          kind: 'continuous',
          clockMode: draft.clockMode === 'countup' || draft.clockMode === 'countdown'
            ? draft.clockMode
            : undefined,
          continuousTarget: draft.continuousTarget === true,
          continuousMode: draft.continuousMode as 'open' | 'target' | 'exam' | undefined,
          focusMinutes: draft.focusMinutes
        })
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
      continuousTarget: isExamContinuousPlan(next),
      continuousMode: next.continuousMode,
      breakPolicy: next.breakPolicy,
      totalMinutes: total,
      simulationStartTime: next.simulationStartTime,
      simulationEndTime: next.simulationEndTime
    })
  }
  if (kind === 'custom_rhythm') {
    return isValidCustomRhythmPlanDraft({
      name: next.name,
      rhythmSequence: next.rhythmSequence,
      simulationStartTime: next.simulationStartTime,
      simulationEndTime: next.simulationEndTime
    })
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
    const isExam = isExamContinuousPlan(next)
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
    // Apply-only: sequence shape must be saveable; name optional (live preset).
    return isValidCustomRhythmPlanDraft({
      name: next.name.trim() || 'custom',
      rhythmSequence: next.rhythmSequence,
      simulationStartTime: next.simulationStartTime,
      simulationEndTime: next.simulationEndTime
    })
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

/**
 * Apply top-level kind UI selection (番茄 / 连续 / 考场) onto a draft.
 * Hides exam window defaults, continuous totals, and breakPolicy coercion.
 */
export function applyTimerPlanKindUi(
  current: TimerPlanDraft,
  next: StudyTimerPlanKindUi
): TimerPlanDraft {
  if (next === 'exam') {
    const existingTotal = totalMinutesFromSimulationWindow(
      current.simulationStartTime,
      current.simulationEndTime
    )
    const keepWindow =
      Boolean(current.simulationStartTime)
      && Boolean(current.simulationEndTime)
      && current.simulationStartTime < current.simulationEndTime
      && current.simulationStartTime !== '00:00'
    const examStart = keepWindow ? current.simulationStartTime : '09:00'
    const examEnd = keepWindow
      ? current.simulationEndTime
      : (existingTotal
        ? (simulationWindowFromTotalMinutes(existingTotal, '09:00')?.end ?? '11:30')
        : '11:30')
    const examTotal =
      totalMinutesFromSimulationWindow(examStart, examEnd) ?? 150
    return {
      ...current,
      kind: 'continuous',
      continuousTarget: true,
      continuousMode: 'exam',
      clockMode: 'countup',
      focusMinutes: examTotal,
      breakMinutes: 0,
      simulationStartTime: examStart,
      simulationEndTime: examEnd,
      breakPolicy: 'none',
      rhythmSequence: undefined
    }
  }
  if (next === 'continuous') {
    const existingTotal = totalMinutesFromSimulationWindow(
      current.simulationStartTime,
      current.simulationEndTime
    )
    const nextFocus =
      Number.isInteger(current.focusMinutes) && current.focusMinutes >= 5
        ? current.focusMinutes
        : 25
    const nextBreak =
      Number.isInteger(current.breakMinutes) && current.breakMinutes >= 0
        ? current.breakMinutes
        : 5
    const nextTotal =
      existingTotal ?? Math.min(240, Math.max(5, nextFocus * 2 + nextBreak))
    const totalWindow = simulationWindowFromTotalMinutes(nextTotal) ?? {
      start: '00:00',
      end: '01:30'
    }
    return {
      ...current,
      kind: 'continuous',
      continuousTarget: false,
      continuousMode: 'target',
      clockMode: current.clockMode === 'countup' ? 'countup' : 'countdown',
      focusMinutes: nextFocus,
      breakMinutes: nextBreak,
      simulationStartTime: totalWindow.start,
      simulationEndTime: totalWindow.end,
      breakPolicy: normalizeBreakPolicy(
        current.breakPolicy,
        defaultContinuousBreakPolicy()
      ),
      rhythmSequence: undefined
    }
  }
  // pomodoro (and unknown UI → pomodoro shell)
  const pomodoroPolicy = normalizeBreakPolicy(current.breakPolicy, 'ask')
  return {
    ...current,
    kind: 'pomodoro',
    continuousTarget: undefined,
    continuousMode: undefined,
    clockMode: 'countdown',
    breakPolicy:
      pomodoroPolicy === 'automatic' || pomodoroPolicy === 'ask'
        ? pomodoroPolicy
        : 'ask',
    breakMinutes: current.breakMinutes || 5,
    rhythmSequence: undefined
  }
}

export type LiveDraftCommitDecision =
  | { action: 'skip' }
  | { action: 'save'; id: string; payload: StudyTimerPlanInput }
  | { action: 'applyOnly'; payload: StudyTimerPlanInput }

export type DecideLiveDraftCommitInput = {
  draft: TimerPlanDraft
  isAddingPlanMode: boolean
  isEditingCustomPlan: boolean
  selectedCatalogRow: {
    id: string
    planKind: string
    focusMinutes: number
    breakMinutes: number
    simulationStartTime: string
    simulationEndTime: string
    name: string
  } | null
  /** Resolved applied shell for clock/exam comparison (may be null). */
  appliedShell:
    | {
        clockMode?: 'countdown' | 'countup' | string
        kind?: string
        continuousTarget?: boolean
        continuousMode?: string | null
        focusMinutes?: number | null
      }
    | null
    | undefined
}

/**
 * Pure decision for live draft commit while settings are open.
 * Running session planSnapshot stays frozen (STC-503 / ADR-0011).
 */
export function decideLiveDraftCommit(
  input: DecideLiveDraftCommitInput
): LiveDraftCommitDecision {
  const { draft, isAddingPlanMode, isEditingCustomPlan, selectedCatalogRow, appliedShell } =
    input
  if (isAddingPlanMode) return { action: 'skip' }
  if (isEditingCustomPlan && selectedCatalogRow && isDraftPayloadValid(draft)) {
    return {
      action: 'save',
      id: selectedCatalogRow.id,
      payload: buildPlanPayload(draft)
    }
  }
  if (!hasApplyableTimerFields(draft)) return { action: 'skip' }
  const row = selectedCatalogRow
  if (row) {
    const nextKind = resolveDraftKind(draft.kind)
    const rowKind = draftKindFromCatalogPlanKind(row.planKind)
    const draftClock = draft.clockMode === 'countup' ? 'countup' : 'countdown'
    const shellClock = appliedShell?.clockMode === 'countup' ? 'countup' : 'countdown'
    const draftExam = isExamContinuousPlan(draft)
    const shellExam = Boolean(appliedShell && isExamContinuousPlan(appliedShell))
    const sameTimer =
      nextKind === rowKind
      && draft.focusMinutes === row.focusMinutes
      && draft.breakMinutes === row.breakMinutes
      && draft.simulationStartTime === row.simulationStartTime
      && draft.simulationEndTime === row.simulationEndTime
      && draftClock === shellClock
      && draftExam === shellExam
    if (sameTimer) return { action: 'skip' }
  }
  return {
    action: 'applyOnly',
    payload: buildPlanPayload({
      ...draft,
      name: draft.name.trim() || selectedCatalogRow?.name || 'temp'
    })
  }
}

// ---------------------------------------------------------------------------
// Catalog row → draft + save/apply decisions (host React only wires callbacks)
// ---------------------------------------------------------------------------

export type CatalogPlanDraftSource = {
  id: string
  name: string
  planKind: string
  focusMinutes: number
  breakMinutes: number
  simulationStartTime: string
  simulationEndTime: string
}

/**
 * Project catalog row / stored plan shell into editor draft.
 * Prefer full shell when present; otherwise row planKind with continuous→target fallback.
 */
export function draftFromCatalogPlanSources(input: {
  shell: DraftFromPlanInput | null | undefined
  row: CatalogPlanDraftSource | null | undefined
}): TimerPlanDraft | null {
  if (input.shell) return draftFromPlan(input.shell)
  const row = input.row
  if (!row) return null
  const kind = draftKindFromCatalogPlanKind(row.planKind)
  return draftFromPlan({
    name: row.name,
    focusMinutes: row.focusMinutes,
    breakMinutes: row.breakMinutes,
    simulationStartTime: row.simulationStartTime,
    simulationEndTime: row.simulationEndTime,
    kind,
    continuousTarget: false,
    continuousMode: kind === 'continuous' ? 'target' : undefined,
    clockMode: 'countdown'
  })
}

export type SavePlanDecision =
  | { action: 'skip' }
  | { action: 'create'; payload: StudyTimerPlanInput }
  | { action: 'update'; id: string; payload: StudyTimerPlanInput }

export type ApplyPlanDecision =
  | { action: 'skip' }
  | {
      action: 'create_and_apply'
      payload: StudyTimerPlanInput
    }
  | {
      action: 'update_and_apply'
      id: string
      payload: StudyTimerPlanInput
    }

/**
 * Pure save-to-catalog decision (does not switch live applied preset).
 */
export function decideSavePlan(input: {
  draft: TimerPlanDraft
  hasValidDraft: boolean
  isAddingPlanMode: boolean
  isEditingCustomPlan: boolean
  selectedCatalogRowId: string | null | undefined
}): SavePlanDecision {
  if (!input.hasValidDraft) return { action: 'skip' }
  const payload = buildPlanPayload(input.draft)
  if (input.isAddingPlanMode) {
    return { action: 'create', payload }
  }
  if (input.isEditingCustomPlan && input.selectedCatalogRowId) {
    return { action: 'update', id: input.selectedCatalogRowId, payload }
  }
  // Builtin / new-name: save as a new custom catalog plan.
  return { action: 'create', payload }
}

/**
 * Pure apply (live preset) decision. Skips when already viewing applied plan.
 */
export function decideApplyPlan(input: {
  draft: TimerPlanDraft
  hasValidDraft: boolean
  isAddingPlanMode: boolean
  isEditingCustomPlan: boolean
  isViewingAppliedPlan: boolean
  selectedCatalogRowId: string | null | undefined
}): ApplyPlanDecision {
  if (!input.hasValidDraft || input.isViewingAppliedPlan) return { action: 'skip' }
  const payload = buildPlanPayload(input.draft)
  if (input.isAddingPlanMode) {
    return { action: 'create_and_apply', payload }
  }
  if (input.isEditingCustomPlan && input.selectedCatalogRowId) {
    return {
      action: 'update_and_apply',
      id: input.selectedCatalogRowId,
      payload
    }
  }
  // Builtin / new-name: create custom then apply.
  return { action: 'create_and_apply', payload }
}
