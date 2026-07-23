/**
 * Continuous TimerPlan kind helpers (STC-504 product path remainder).
 *
 * Pure projection between V1 StudyTimerPlan cache fields (kind / clockMode /
 * continuousTarget) and TimerPlanV2 continuous countup shells.
 * Freeze #6: continuous may use breakPolicy none | reminder_only | ask | automatic;
 * pomodoro path continues to coerce none/reminder_only via advanced normalize.
 *
 * No I/O.
 */

import {
  createClassicPomodoroPlan,
  createContinuousCountupPlan,
  createExamSimulationPlan,
  createOpenContinuousPlan,
  createCustomRhythmPlan,
  sumCustomRhythmMinutes,
  TIMER_PLAN_SEED_DEFAULTS,
  type BreakPolicy,
  type ContinuousMode,
  type CustomRhythmStep,
  type TimerClockMode,
  type TimerPlanKind,
  type TimerPlanV2
} from '../../../shared/study-planning'
import type { StudyTimerPlan } from './types'
import { normalizeTimerPlanAdvancedFields } from './planning-timer-plan-advanced-fields'

export type StudyTimerPlanKind = TimerPlanKind
export type StudyTimerClockMode = TimerClockMode
export type ContinuousBreakPolicy = BreakPolicy

export type TimerPlanKindFields = {
  kind?: StudyTimerPlanKind
  clockMode?: StudyTimerClockMode
}

export type NormalizeTimerPlanKindResult = {
  kind: StudyTimerPlanKind
  clockMode: StudyTimerClockMode
  warnings: Array<{ code: string; message: string; field?: string }>
}

const KIND_SET = new Set<StudyTimerPlanKind>(['pomodoro', 'continuous', 'custom_rhythm'])
const CLOCK_SET = new Set<StudyTimerClockMode>(['countdown', 'countup'])
const CONTINUOUS_BREAK_SET = new Set<ContinuousBreakPolicy>([
  'automatic',
  'ask',
  'reminder_only',
  'none'
])

/**
 * Normalize optional kind/clockMode on a V1 plan shell.
 * Missing → pomodoro + countdown (legacy default).
 * continuous without clockMode → countup (product seed).
 */
export function normalizeTimerPlanKindFields(
  input: TimerPlanKindFields | null | undefined
): NormalizeTimerPlanKindResult {
  const warnings: NormalizeTimerPlanKindResult['warnings'] = []
  const rawKind = typeof input?.kind === 'string' ? input.kind.trim() : ''
  let kind: StudyTimerPlanKind = 'pomodoro'
  if (rawKind && KIND_SET.has(rawKind as StudyTimerPlanKind)) {
    kind = rawKind as StudyTimerPlanKind
  } else if (rawKind) {
    warnings.push({
      code: 'plan_kind_fallback',
      message: `Unknown kind "${rawKind}"; using pomodoro`,
      field: 'kind'
    })
  }

  const rawClock = typeof input?.clockMode === 'string' ? input.clockMode.trim() : ''
  let clockMode: StudyTimerClockMode = kind === 'continuous' ? 'countup' : 'countdown'
  if (rawClock && CLOCK_SET.has(rawClock as StudyTimerClockMode)) {
    clockMode = rawClock as StudyTimerClockMode
  } else if (rawClock) {
    warnings.push({
      code: 'clock_mode_fallback',
      message: `Unknown clockMode "${rawClock}"; using ${clockMode}`,
      field: 'clockMode'
    })
  } else if (kind === 'pomodoro') {
    clockMode = 'countdown'
  }

  // custom_rhythm is always countdown; pomodoro may opt into countup (product UI toggle).
  if (kind === 'custom_rhythm' && clockMode === 'countup') {
    warnings.push({
      code: 'custom_rhythm_clock_mode_coerced',
      message: 'custom_rhythm plans use countdown; clockMode coerced',
      field: 'clockMode'
    })
    clockMode = 'countdown'
  }

  return { kind, clockMode, warnings }
}

/** Pick sparse kind/clockMode from unknown cache for snapshot normalize. */
export function pickOptionalKindFields(
  raw: Record<string, unknown>
): TimerPlanKindFields {
  const out: TimerPlanKindFields = {}
  const kindRaw = typeof raw.kind === 'string' ? raw.kind.trim() : ''
  if (kindRaw && KIND_SET.has(kindRaw as StudyTimerPlanKind)) {
    out.kind = kindRaw as StudyTimerPlanKind
  }
  const clockRaw = typeof raw.clockMode === 'string' ? raw.clockMode.trim() : ''
  if (clockRaw && CLOCK_SET.has(clockRaw as StudyTimerClockMode)) {
    out.clockMode = clockRaw as StudyTimerClockMode
  }
  return out
}

/** Continuous break policy options (freeze #6). */
export const CONTINUOUS_BREAK_POLICY_OPTIONS: readonly {
  value: ContinuousBreakPolicy
  label: string
}[] = [
  { value: 'reminder_only', label: '仅提醒' },
  { value: 'none', label: '不休息' },
  { value: 'ask', label: '到点询问' },
  { value: 'automatic', label: '自动休息' }
] as const

/** Product UI: exam simulation is a top-level plan type (stored as continuous + continuousTarget). */
export type StudyTimerPlanKindUi = StudyTimerPlanKind | 'exam'

export const TIMER_PLAN_KIND_OPTIONS: readonly {
  value: StudyTimerPlanKindUi
  label: string
}[] = [
  { value: 'pomodoro', label: '番茄循环' },
  { value: 'continuous', label: '连续专注' },
  { value: 'exam', label: '考场模拟' }
] as const

/** Map stored plan fields → top-level kind select value. */
export function timerPlanKindToUi(
  kind: StudyTimerPlanKind | string | undefined,
  continuousTarget?: boolean
): StudyTimerPlanKindUi {
  if (kind === 'continuous' && continuousTarget === true) return 'exam'
  if (kind === 'continuous') return 'continuous'
  if (kind === 'custom_rhythm') return 'custom_rhythm'
  return 'pomodoro'
}

export function defaultContinuousBreakPolicy(): ContinuousBreakPolicy {
  return TIMER_PLAN_SEED_DEFAULTS.continuousBreakPolicy
}

/**
 * Validate continuous draft for save.
 * Open countup: continuousTarget false / focusMinutes ignored as target.
 * Target countup: continuousTarget true + integer focusMinutes in range.
 */
export function isValidContinuousPlanDraft(draft: {
  name?: string
  focusMinutes?: number | null
  breakMinutes?: number | null
  continuousTarget?: boolean
  breakPolicy?: string
  /**
   * Total session minutes for continuous cycle / exam (encoded via simulation window in V1 cache).
   * When provided, preferred over simulationStart/End string pair validation.
   */
  totalMinutes?: number | null
  simulationStartTime?: string
  simulationEndTime?: string
}): boolean {
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) return false
  const policy = typeof draft.breakPolicy === 'string' ? draft.breakPolicy.trim() : ''
  if (!policy || !CONTINUOUS_BREAK_SET.has(policy as ContinuousBreakPolicy)) return false

  // Total duration (minutes) — continuous cycle and exam both need a positive total.
  const total =
    draft.totalMinutes != null && Number.isInteger(draft.totalMinutes)
      ? draft.totalMinutes
      : null
  if (total != null) {
    if (total < TIMER_PLAN_SEED_DEFAULTS.focusMinutesMin || total > TIMER_PLAN_SEED_DEFAULTS.continuousFocusMinutesMax) {
      return false
    }
  } else {
    const start = draft.simulationStartTime ?? ''
    const end = draft.simulationEndTime ?? ''
    if (start && end && start >= end) return false
  }

  if (draft.continuousTarget === true) {
    // Exam / open continuous: only total minutes required (no separate focus target field).
    return total != null || Boolean(draft.simulationStartTime && draft.simulationEndTime && draft.simulationStartTime < draft.simulationEndTime)
  }

  // Continuous cycle: focus + break segment minutes.
  if (draft.focusMinutes == null || !Number.isInteger(draft.focusMinutes)) return false
  if (
    draft.focusMinutes < TIMER_PLAN_SEED_DEFAULTS.focusMinutesMin ||
    draft.focusMinutes > TIMER_PLAN_SEED_DEFAULTS.continuousFocusMinutesMax
  ) {
    return false
  }
  if (draft.breakMinutes != null) {
    if (
      !Number.isInteger(draft.breakMinutes)
      || draft.breakMinutes < TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMin
      || draft.breakMinutes > TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMax
    ) {
      return false
    }
  }
  return total != null || Boolean(draft.simulationStartTime && draft.simulationEndTime)
}

function isOpenContinuous(plan: Pick<StudyTimerPlan, 'kind' | 'clockMode' | 'continuousTarget'>): boolean {
  const { kind, clockMode } = normalizeTimerPlanKindFields({
    kind: plan.kind,
    clockMode: plan.clockMode
  })
  return kind === 'continuous' && clockMode === 'countup' && plan.continuousTarget !== true
}

/**
 * Project V1 StudyTimerPlan → TimerPlanV2 respecting kind.
 */
export function projectV1TimerPlanToV2(plan: StudyTimerPlan): TimerPlanV2 {
  const { kind, clockMode } = normalizeTimerPlanKindFields({
    kind: plan.kind,
    clockMode: plan.clockMode
  })

  if (kind === 'continuous') {
    const breakRaw = plan.breakPolicy
    const breakPolicy: ContinuousBreakPolicy =
      breakRaw && CONTINUOUS_BREAK_SET.has(breakRaw)
        ? breakRaw
        : defaultContinuousBreakPolicy()

    const open = isOpenContinuous({
      kind,
      clockMode,
      continuousTarget: plan.continuousTarget
    })
    // V1 continuousTarget true → exam; open countup → open; else target (cycle).
    const continuousMode: ContinuousMode = open
      ? 'open'
      : plan.continuousTarget === true
        ? 'exam'
        : 'target'

    if (continuousMode === 'exam') {
      return createExamSimulationPlan({
        id: plan.id,
        name: plan.name,
        breakPolicy,
        focusMinutes: plan.focusMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes,
        ...(plan.breakMinutes > 0 ? { shortBreakMinutes: plan.breakMinutes } : {})
      })
    }
    if (continuousMode === 'open') {
      return createOpenContinuousPlan({
        id: plan.id,
        name: plan.name,
        clockMode: clockMode === 'countdown' ? 'countdown' : 'countup',
        breakPolicy,
        ...(plan.breakMinutes > 0 ? { shortBreakMinutes: plan.breakMinutes } : {})
      })
    }
    return createContinuousCountupPlan({
      id: plan.id,
      name: plan.name,
      kind: 'continuous',
      continuousMode: 'target',
      clockMode: clockMode === 'countdown' ? 'countdown' : 'countup',
      breakPolicy,
      focusMinutes: plan.focusMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes,
      ...(plan.breakMinutes > 0 ? { shortBreakMinutes: plan.breakMinutes } : {})
    })
  }

  if (kind === 'custom_rhythm') {
    const sequence = Array.isArray(plan.rhythmSequence)
      ? (plan.rhythmSequence as CustomRhythmStep[])
      : []
    const advanced = normalizeTimerPlanAdvancedFields({
      longBreakMinutes: plan.longBreakMinutes,
      longBreakEvery: plan.longBreakEvery,
      breakPolicy: plan.breakPolicy
    }).fields
    const created = createCustomRhythmPlan({
      id: plan.id,
      name: plan.name,
      sequence,
      overrides: {
        breakPolicy: advanced.breakPolicy,
        ...(plan.focusMinutes > 0 ? { focusMinutes: plan.focusMinutes } : {}),
        ...(plan.breakMinutes > 0 ? { shortBreakMinutes: plan.breakMinutes } : {}),
        ...(advanced.longBreakMinutes !== undefined
          ? { longBreakMinutes: advanced.longBreakMinutes }
          : {})
      }
    })
    if (!created.ok) {
      // Fail-closed: refuse silent demote to pomodoro; throw for dual-write callers.
      throw new Error(
        `custom_rhythm sequence invalid: ${created.issues.map((i) => i.message).join('; ')}`
      )
    }
    return created.plan
  }

  const advanced = normalizeTimerPlanAdvancedFields({
    longBreakMinutes: plan.longBreakMinutes,
    longBreakEvery: plan.longBreakEvery,
    breakPolicy: plan.breakPolicy
  }).fields
  return createClassicPomodoroPlan({
    id: plan.id,
    name: plan.name,
    focusMinutes: plan.focusMinutes,
    shortBreakMinutes: plan.breakMinutes,
    longBreakMinutes: advanced.longBreakMinutes,
    longBreakEvery: advanced.longBreakEvery,
    breakPolicy: advanced.breakPolicy,
    kind: 'pomodoro',
    clockMode: clockMode === 'countup' ? 'countup' : 'countdown'
  })
}

/**
 * Project TimerPlanV2 → V1 StudyTimerPlan including kind/clockMode.
 */
export function projectV2TimerPlanToV1(
  plan: TimerPlanV2,
  window?: { simulationStartTime?: string; simulationEndTime?: string }
): StudyTimerPlan {
  const advanced = normalizeTimerPlanAdvancedFields({
    longBreakMinutes: plan.longBreakMinutes,
    longBreakEvery: plan.longBreakEvery,
    breakPolicy: plan.breakPolicy
  }).fields

  if (plan.kind === 'continuous') {
    // Prefer durable continuousMode; legacy: open = countup without focus; exam only when mode is exam.
    const clockMode = plan.clockMode === 'countdown' ? 'countdown' : 'countup'
    let continuousMode = plan.continuousMode
    if (continuousMode !== 'open' && continuousMode !== 'target' && continuousMode !== 'exam') {
      if (clockMode === 'countup' && plan.focusMinutes == null) continuousMode = 'open'
      else if (plan.id === 'continuous_countup') continuousMode = 'exam'
      else continuousMode = 'target'
    }
    const isExam = continuousMode === 'exam'
    const openCountup = continuousMode === 'open'
    return {
      id: plan.id,
      name: plan.name,
      focusMinutes:
        plan.focusMinutes
        ?? (isExam ? 180 : TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes),
      breakMinutes:
        plan.shortBreakMinutes
        ?? (isExam || openCountup ? 0 : TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes),
      simulationStartTime: window?.simulationStartTime ?? '09:00',
      simulationEndTime: window?.simulationEndTime ?? '12:00',
      kind: 'continuous',
      clockMode: isExam ? 'countup' : clockMode,
      continuousTarget: isExam,
      breakPolicy: plan.breakPolicy
    }
  }

  if (plan.kind === 'custom_rhythm') {
    const sequence = Array.isArray(plan.rhythmSequence)
      ? plan.rhythmSequence.map((s) => ({ kind: s.kind, minutes: s.minutes }))
      : []
    return {
      id: plan.id,
      name: plan.name,
      focusMinutes: plan.focusMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes,
      breakMinutes:
        plan.shortBreakMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes,
      simulationStartTime: window?.simulationStartTime ?? '09:00',
      simulationEndTime: window?.simulationEndTime ?? '12:00',
      kind: 'custom_rhythm',
      clockMode: 'countdown',
      longBreakMinutes: plan.longBreakMinutes ?? advanced.longBreakMinutes,
      longBreakEvery: advanced.longBreakEvery,
      breakPolicy: plan.breakPolicy === 'automatic' || plan.breakPolicy === 'ask'
        ? plan.breakPolicy
        : advanced.breakPolicy,
      ...(sequence.length > 0 ? { rhythmSequence: sequence } : {})
    }
  }

  return {
    id: plan.id,
    name: plan.name,
    focusMinutes: plan.focusMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes,
    breakMinutes:
      plan.shortBreakMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes,
    simulationStartTime: window?.simulationStartTime ?? '09:00',
    simulationEndTime: window?.simulationEndTime ?? '12:00',
    kind: 'pomodoro',
    clockMode: plan.clockMode === 'countup' ? 'countup' : 'countdown',
    longBreakMinutes: advanced.longBreakMinutes,
    longBreakEvery: advanced.longBreakEvery,
    breakPolicy: advanced.breakPolicy
  }
}

/** Catalog / UI summary line for a plan shell. */
export function formatTimerPlanKindSummary(
  plan: Pick<
    StudyTimerPlan,
    | 'kind'
    | 'clockMode'
    | 'focusMinutes'
    | 'breakMinutes'
    | 'continuousTarget'
    | 'breakPolicy'
    | 'rhythmSequence'
  >
): string {
  if (isOpenContinuous(plan)) return '连续专注 · 正计时'
  const { kind, clockMode } = normalizeTimerPlanKindFields({
    kind: plan.kind,
    clockMode: plan.clockMode
  })
  if (kind === 'continuous') {
    if (clockMode === 'countup') return `连续专注 · 目标 ${plan.focusMinutes} 分钟`
    return `连续专注 · 倒计时 ${plan.focusMinutes} 分钟`
  }
  if (kind === 'custom_rhythm') {
    const seq = Array.isArray(plan.rhythmSequence) ? plan.rhythmSequence : []
    if (seq.length > 0) {
      const total = sumCustomRhythmMinutes(seq).totalMinutes
      return `自定义 · ${seq.length} 步 · ${total} 分`
    }
    return '自定义节奏'
  }
  return `${plan.focusMinutes} / ${plan.breakMinutes} 分钟`
}

/** Resolve frozen TimerPlanV2 for a start from V1 cache / default id. */
export function resolvePlanV2ForStart(input: {
  planId?: string | null
  userPlans?: readonly StudyTimerPlan[]
  plan?: TimerPlanV2 | null
}): TimerPlanV2 {
  if (input.plan) return input.plan
  const planId = input.planId?.trim() || 'classic_25_5'
  const fromUser = input.userPlans?.find((p) => p.id === planId)
  if (fromUser) return projectV1TimerPlanToV2(fromUser)

  if (planId === 'continuous_countup') {
    return createExamSimulationPlan({ id: planId })
  }
  if (planId === 'deep_50_10') {
    return createClassicPomodoroPlan({
      id: 'deep_50_10',
      name: '深度专注',
      focusMinutes: 50,
      shortBreakMinutes: 10
    })
  }
  return createClassicPomodoroPlan(
    planId !== 'classic_25_5' ? { id: planId } : undefined
  )
}

/**
 * Target seconds for local start.
 * Open continuous countup → null (lifecycle open-ended).
 */
export function resolveStartTargetSeconds(plan: TimerPlanV2): number | null {
  if (isOpenContinuousPlanV2(plan)) {
    return null
  }
  if (plan.focusMinutes != null) return Math.max(1, plan.focusMinutes * 60)
  return 25 * 60
}

export function isOpenContinuousPlanV2(plan: TimerPlanV2): boolean {
  if (plan.kind !== 'continuous') return false
  if (plan.continuousMode === 'open') return true
  if (plan.continuousMode === 'exam' || plan.continuousMode === 'target') return false
  return plan.clockMode === 'countup' && plan.focusMinutes == null
}


/** Validate custom_rhythm draft for save (ordered sequence, fail-closed). */
export function isValidCustomRhythmPlanDraft(draft: {
  name?: string
  rhythmSequence?: readonly CustomRhythmStep[] | null
  simulationStartTime?: string
  simulationEndTime?: string
}): boolean {
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) return false
  const start = draft.simulationStartTime ?? ''
  const end = draft.simulationEndTime ?? ''
  if (start && end && start >= end) return false
  // Lazy import-free: use createCustomRhythmPlan for fail-closed sequence check.
  const seq = draft.rhythmSequence
  if (!Array.isArray(seq) || seq.length === 0) return false
  const created = createCustomRhythmPlan({
    id: 'draft-validate',
    name,
    sequence: seq
  })
  return created.ok
}
