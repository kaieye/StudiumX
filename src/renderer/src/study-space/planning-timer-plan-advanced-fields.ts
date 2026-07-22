/**
 * Pure advanced TimerPlan field helpers (STC-502 remainder).
 *
 * Normalizes optional V1 cache fields (long break / breakPolicy) for product
 * UI drafts and dual-write projection. No I/O. Pomodoro path only: freeze #6
 * refuses silent none/reminder_only (coerced to ask).
 */

import {
  TIMER_PLAN_SEED_DEFAULTS,
  type BreakPolicy
} from '../../../shared/study-planning'

export type PomodoroBreakPolicy = Extract<BreakPolicy, 'automatic' | 'ask'>

export type TimerPlanAdvancedFields = {
  longBreakMinutes?: number
  longBreakEvery?: number
  breakPolicy?: BreakPolicy
}

export type TimerPlanAdvancedFieldsNormalized = {
  longBreakMinutes: number
  longBreakEvery: number
  breakPolicy: PomodoroBreakPolicy
}

export type NormalizeTimerPlanAdvancedResult = {
  fields: TimerPlanAdvancedFieldsNormalized
  warnings: Array<{ code: string; message: string; field?: string }>
}

const POMODORO_BREAK_POLICY_SET = new Set<PomodoroBreakPolicy>(['automatic', 'ask'])
const ALL_BREAK_POLICY_SET = new Set<BreakPolicy>([
  'automatic',
  'ask',
  'reminder_only',
  'none'
])

function asInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.trunc(value)
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Normalize optional advanced plan fields for pomodoro product path.
 * Missing fields fall back to classic seed defaults (15 / 4 / ask).
 * none/reminder_only are coerced to ask (freeze #6).
 */
export function normalizeTimerPlanAdvancedFields(
  input: TimerPlanAdvancedFields | null | undefined
): NormalizeTimerPlanAdvancedResult {
  const warnings: NormalizeTimerPlanAdvancedResult['warnings'] = []
  const raw = input ?? {}

  const longRaw = asInt(raw.longBreakMinutes)
  let longBreakMinutes: number = TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes
  if (longRaw !== undefined) {
    longBreakMinutes = clampInt(
      longRaw,
      TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMin,
      TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMax
    )
    if (longBreakMinutes !== longRaw) {
      warnings.push({
        code: 'long_break_minutes_clamped',
        message: `longBreakMinutes clamped to ${longBreakMinutes}`,
        field: 'longBreakMinutes'
      })
    }
  }

  const everyRaw = asInt(raw.longBreakEvery)
  let longBreakEvery: number = TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery
  if (everyRaw !== undefined) {
    longBreakEvery = clampInt(
      everyRaw,
      TIMER_PLAN_SEED_DEFAULTS.longBreakEveryMin,
      TIMER_PLAN_SEED_DEFAULTS.longBreakEveryMax
    )
    if (longBreakEvery !== everyRaw) {
      warnings.push({
        code: 'long_break_every_clamped',
        message: `longBreakEvery clamped to ${longBreakEvery}`,
        field: 'longBreakEvery'
      })
    }
  }

  let breakPolicy: PomodoroBreakPolicy = TIMER_PLAN_SEED_DEFAULTS.pomodoroBreakPolicy as PomodoroBreakPolicy
  const breakRaw = typeof raw.breakPolicy === 'string' ? raw.breakPolicy.trim() : ''
  if (breakRaw && POMODORO_BREAK_POLICY_SET.has(breakRaw as PomodoroBreakPolicy)) {
    breakPolicy = breakRaw as PomodoroBreakPolicy
  } else if (breakRaw && ALL_BREAK_POLICY_SET.has(breakRaw as BreakPolicy)) {
    // freeze #6: continuous-only policies must not be silent pomodoro defaults
    warnings.push({
      code: 'pomodoro_break_policy_coerced',
      message: `breakPolicy "${breakRaw}" not allowed for pomodoro; coerced to ask`,
      field: 'breakPolicy'
    })
    breakPolicy = 'ask'
  } else if (breakRaw) {
    warnings.push({
      code: 'break_policy_fallback',
      message: `Unknown breakPolicy "${breakRaw}"; using ask`,
      field: 'breakPolicy'
    })
    breakPolicy = 'ask'
  }

  return {
    fields: { longBreakMinutes, longBreakEvery, breakPolicy },
    warnings
  }
}

/**
 * Project advanced fields onto a V1 StudyTimerPlan shell (optional keys only when
 * present / non-default is not required — always write normalized values when
 * caller requests persistence).
 */
export function applyAdvancedFieldsToV1Plan<T extends TimerPlanAdvancedFields>(
  plan: T,
  advanced?: TimerPlanAdvancedFields | null
): T & TimerPlanAdvancedFieldsNormalized {
  const { fields } = normalizeTimerPlanAdvancedFields({
    longBreakMinutes: advanced?.longBreakMinutes ?? plan.longBreakMinutes,
    longBreakEvery: advanced?.longBreakEvery ?? plan.longBreakEvery,
    breakPolicy: advanced?.breakPolicy ?? plan.breakPolicy
  })
  return {
    ...plan,
    ...fields
  }
}

/**
 * Whether a draft advanced section is valid for save (all integers in range).
 * Name / focus / short break / window remain caller's responsibility.
 */
export function isValidTimerPlanAdvancedDraft(
  draft: TimerPlanAdvancedFields
): boolean {
  const { fields, warnings } = normalizeTimerPlanAdvancedFields(draft)
  // After normalize, fields are always in range; reject only if original was
  // non-finite garbage that became defaults via missing — still valid for save.
  // Treat NaN inputs as invalid when explicitly provided.
  if (draft.longBreakMinutes !== undefined) {
    if (!Number.isInteger(draft.longBreakMinutes)) return false
    if (
      draft.longBreakMinutes < TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMin ||
      draft.longBreakMinutes > TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMax
    ) {
      return false
    }
  }
  if (draft.longBreakEvery !== undefined) {
    if (!Number.isInteger(draft.longBreakEvery)) return false
    if (
      draft.longBreakEvery < TIMER_PLAN_SEED_DEFAULTS.longBreakEveryMin ||
      draft.longBreakEvery > TIMER_PLAN_SEED_DEFAULTS.longBreakEveryMax
    ) {
      return false
    }
  }
  if (draft.breakPolicy !== undefined) {
    if (!POMODORO_BREAK_POLICY_SET.has(draft.breakPolicy as PomodoroBreakPolicy)) {
      // none/reminder_only are invalid for pomodoro product draft
      return false
    }
  }
  void fields
  void warnings
  return true
}

/** Seed defaults for new plan draft advanced section. */
export function defaultTimerPlanAdvancedFields(): TimerPlanAdvancedFieldsNormalized {
  return {
    longBreakMinutes: TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes,
    longBreakEvery: TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery,
    breakPolicy: TIMER_PLAN_SEED_DEFAULTS.pomodoroBreakPolicy as PomodoroBreakPolicy
  }
}

/** Pomodoro-only break policy options for product select. */
export const POMODORO_BREAK_POLICY_OPTIONS: readonly {
  value: PomodoroBreakPolicy
  label: string
}[] = [
  { value: 'ask', label: '到点询问' },
  { value: 'automatic', label: '自动休息' }
] as const

/**
 * Pick advanced fields from an unknown partial for snapshot normalize.
 * Omits keys when input lacks them (legacy cache stays sparse).
 */
export function pickOptionalAdvancedFields(
  raw: Record<string, unknown>
): TimerPlanAdvancedFields {
  const out: TimerPlanAdvancedFields = {}
  const longRaw = asInt(raw.longBreakMinutes)
  if (longRaw !== undefined) {
    out.longBreakMinutes = clampInt(
      longRaw,
      TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMin,
      TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMax
    )
  }
  const everyRaw = asInt(raw.longBreakEvery)
  if (everyRaw !== undefined) {
    out.longBreakEvery = clampInt(
      everyRaw,
      TIMER_PLAN_SEED_DEFAULTS.longBreakEveryMin,
      TIMER_PLAN_SEED_DEFAULTS.longBreakEveryMax
    )
  }
  const breakRaw = typeof raw.breakPolicy === 'string' ? raw.breakPolicy.trim() : ''
  if (breakRaw && ALL_BREAK_POLICY_SET.has(breakRaw as BreakPolicy)) {
    // Persist as-is for reverse project; dual-write path coerces for pomodoro save.
    out.breakPolicy = breakRaw as BreakPolicy
  }
  return out
}
