/**
 * Study planning pure domain — TimerPlanV2 normalize/validate (STC-101).
 *
 * Phase 1 first slice (ADR-0094 §4): pure types + validation only.
 * No I/O, no localStorage, no canonical path freeze, no TimerSession lifecycle.
 * Numeric defaults are Phase1 seeds from the planning roadmap (§4.2), not a new durable ADR freeze.
 */

export type TimerPlanKind = 'pomodoro' | 'continuous'
export type TimerClockMode = 'countdown' | 'countup'
export type BreakPolicy = 'automatic' | 'ask' | 'reminder_only' | 'none'
export type WindowFillPolicy = 'complete_cycles' | 'adaptive_final_focus' | 'allow_overrun'

export type TimerPlanNotificationPolicy = {
  sound: boolean
  systemNotification: boolean
  focusEnd: boolean
  breakEnd: boolean
}

/** Non-wire planning sketch; not a frozen file schema. */
export type TimerPlanV2 = {
  id: string
  name: string
  kind: TimerPlanKind
  clockMode: TimerClockMode
  focusMinutes?: number
  shortBreakMinutes?: number
  longBreakMinutes?: number
  longBreakEvery?: number
  breakPolicy: BreakPolicy
  windowFillPolicy: WindowFillPolicy
  minimumFinalFocusMinutes: number
  wrapUpMinutes: number
  notificationPolicy: TimerPlanNotificationPolicy
  revision: number
}

export type TimerPlanValidationIssue = {
  code: string
  message: string
  field?: string
}

export type TimerPlanValidationResult =
  | { ok: true; plan: TimerPlanV2; warnings: TimerPlanValidationIssue[] }
  | { ok: false; issues: TimerPlanValidationIssue[]; plan?: TimerPlanV2 }

/** Phase1 seed defaults (roadmap §4.2). Not durable product freeze. */
export const TIMER_PLAN_SEED_DEFAULTS = {
  classicFocusMinutes: 25,
  classicShortBreakMinutes: 5,
  classicLongBreakMinutes: 15,
  classicLongBreakEvery: 4,
  minimumFinalFocusMinutes: 15,
  wrapUpMinutes: 5,
  windowFillPolicy: 'adaptive_final_focus' as WindowFillPolicy,
  pomodoroBreakPolicy: 'ask' as BreakPolicy,
  continuousBreakPolicy: 'reminder_only' as BreakPolicy,
  planLimit: 12,
  focusMinutesMin: 5,
  focusMinutesMax: 180,
  continuousFocusMinutesMax: 240,
  shortBreakMinutesMin: 1,
  shortBreakMinutesMax: 45,
  longBreakMinutesMin: 5,
  longBreakMinutesMax: 60,
  longBreakEveryMin: 2,
  longBreakEveryMax: 8,
  wrapUpMinutesMin: 0,
  wrapUpMinutesMax: 30,
  minimumFinalFocusMinutesMin: 5,
  minimumFinalFocusMinutesMax: 120
} as const

export const BUILTIN_TIMER_PLAN_CATALOG: readonly TimerPlanV2[] = [
  {
    id: 'classic_25_5',
    name: '经典番茄 25/5',
    kind: 'pomodoro',
    clockMode: 'countdown',
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    breakPolicy: 'ask',
    windowFillPolicy: 'adaptive_final_focus',
    minimumFinalFocusMinutes: 15,
    wrapUpMinutes: 5,
    notificationPolicy: {
      sound: true,
      systemNotification: true,
      focusEnd: true,
      breakEnd: true
    },
    revision: 1
  },
  {
    id: 'deep_50_10',
    name: '深度 50/10',
    kind: 'pomodoro',
    clockMode: 'countdown',
    focusMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    breakPolicy: 'ask',
    windowFillPolicy: 'adaptive_final_focus',
    minimumFinalFocusMinutes: 15,
    wrapUpMinutes: 5,
    notificationPolicy: {
      sound: true,
      systemNotification: true,
      focusEnd: true,
      breakEnd: true
    },
    revision: 1
  },
  {
    id: 'continuous_countup',
    name: '连续专注',
    kind: 'continuous',
    clockMode: 'countup',
    breakPolicy: 'reminder_only',
    windowFillPolicy: 'adaptive_final_focus',
    minimumFinalFocusMinutes: 15,
    wrapUpMinutes: 5,
    notificationPolicy: {
      sound: true,
      systemNotification: true,
      focusEnd: true,
      breakEnd: false
    },
    revision: 1
  }
] as const

const KIND_SET = new Set<TimerPlanKind>(['pomodoro', 'continuous'])
const CLOCK_SET = new Set<TimerClockMode>(['countdown', 'countup'])
const BREAK_POLICY_SET = new Set<BreakPolicy>(['automatic', 'ask', 'reminder_only', 'none'])
const FILL_POLICY_SET = new Set<WindowFillPolicy>([
  'complete_cycles',
  'adaptive_final_focus',
  'allow_overrun'
])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.trunc(value)
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function issue(code: string, message: string, field?: string): TimerPlanValidationIssue {
  return field ? { code, message, field } : { code, message }
}

function defaultNotificationPolicy(): TimerPlanNotificationPolicy {
  return {
    sound: true,
    systemNotification: true,
    focusEnd: true,
    breakEnd: true
  }
}

function normalizeNotificationPolicy(raw: unknown): TimerPlanNotificationPolicy {
  if (!isObject(raw)) return defaultNotificationPolicy()
  return {
    sound: raw.sound !== false,
    systemNotification: raw.systemNotification !== false,
    focusEnd: raw.focusEnd !== false,
    breakEnd: raw.breakEnd !== false
  }
}

/**
 * Normalize unknown input into a TimerPlanV2 seed-complete plan, then validate.
 * Fail-closed on identity / kind / clockMode; numeric fields clamp to seed ranges.
 */
export function normalizeTimerPlanV2(input: unknown): TimerPlanValidationResult {
  const warnings: TimerPlanValidationIssue[] = []
  const hard: TimerPlanValidationIssue[] = []

  if (!isObject(input)) {
    return {
      ok: false,
      issues: [issue('plan_not_object', 'Timer plan must be an object')]
    }
  }

  const id = asTrimmedString(input.id)
  if (!id) hard.push(issue('plan_id_required', 'Timer plan id is required', 'id'))

  const name = asTrimmedString(input.name)
  if (!name) hard.push(issue('plan_name_required', 'Timer plan name is required', 'name'))

  const kindRaw = asTrimmedString(input.kind)
  const kind = kindRaw && KIND_SET.has(kindRaw as TimerPlanKind) ? (kindRaw as TimerPlanKind) : undefined
  if (!kind) hard.push(issue('plan_kind_invalid', 'kind must be pomodoro or continuous', 'kind'))

  const clockRaw = asTrimmedString(input.clockMode)
  const clockMode =
    clockRaw && CLOCK_SET.has(clockRaw as TimerClockMode) ? (clockRaw as TimerClockMode) : undefined
  if (!clockMode) {
    hard.push(issue('plan_clock_mode_invalid', 'clockMode must be countdown or countup', 'clockMode'))
  }

  if (hard.length > 0 || !id || !name || !kind || !clockMode) {
    return { ok: false, issues: hard }
  }

  // Product freeze #3 / #6: pomodoro default ask; continuous may use none/reminder_only.
  let breakPolicy: BreakPolicy = TIMER_PLAN_SEED_DEFAULTS.pomodoroBreakPolicy
  const breakRaw = asTrimmedString(input.breakPolicy)
  if (breakRaw && BREAK_POLICY_SET.has(breakRaw as BreakPolicy)) {
    breakPolicy = breakRaw as BreakPolicy
  } else if (breakRaw) {
    warnings.push(issue('break_policy_fallback', `Unknown breakPolicy "${breakRaw}"; using default`, 'breakPolicy'))
  } else if (kind === 'continuous') {
    breakPolicy = TIMER_PLAN_SEED_DEFAULTS.continuousBreakPolicy
  }

  if (kind === 'pomodoro' && (breakPolicy === 'none' || breakPolicy === 'reminder_only')) {
    // Allowed only as explicit continuous policy per freeze #6; soft-coerce pomodoro.
    warnings.push(
      issue(
        'pomodoro_break_policy_coerced',
        'pomodoro plans must not silently default to none/reminder_only; coerced to ask',
        'breakPolicy'
      )
    )
    breakPolicy = 'ask'
  }

  let windowFillPolicy: WindowFillPolicy = TIMER_PLAN_SEED_DEFAULTS.windowFillPolicy
  const fillRaw = asTrimmedString(input.windowFillPolicy)
  if (fillRaw && FILL_POLICY_SET.has(fillRaw as WindowFillPolicy)) {
    windowFillPolicy = fillRaw as WindowFillPolicy
  } else if (fillRaw) {
    warnings.push(
      issue('window_fill_policy_fallback', `Unknown windowFillPolicy "${fillRaw}"; using adaptive_final_focus`, 'windowFillPolicy')
    )
  }

  const focusMax =
    kind === 'continuous'
      ? TIMER_PLAN_SEED_DEFAULTS.continuousFocusMinutesMax
      : TIMER_PLAN_SEED_DEFAULTS.focusMinutesMax

  let focusMinutes: number | undefined
  const focusRaw = asInt(input.focusMinutes)
  if (focusRaw !== undefined) {
    focusMinutes = clampInt(focusRaw, TIMER_PLAN_SEED_DEFAULTS.focusMinutesMin, focusMax)
    if (focusMinutes !== focusRaw) {
      warnings.push(issue('focus_minutes_clamped', `focusMinutes clamped to ${focusMinutes}`, 'focusMinutes'))
    }
  } else if (kind === 'pomodoro') {
    focusMinutes = TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes
  }

  let shortBreakMinutes: number | undefined
  const shortRaw = asInt(input.shortBreakMinutes)
  if (shortRaw !== undefined) {
    shortBreakMinutes = clampInt(
      shortRaw,
      TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMin,
      TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMax
    )
    if (shortBreakMinutes !== shortRaw) {
      warnings.push(
        issue('short_break_minutes_clamped', `shortBreakMinutes clamped to ${shortBreakMinutes}`, 'shortBreakMinutes')
      )
    }
  } else if (kind === 'pomodoro') {
    shortBreakMinutes = TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes
  }

  let longBreakMinutes: number | undefined
  const longRaw = asInt(input.longBreakMinutes)
  if (longRaw !== undefined) {
    longBreakMinutes = clampInt(
      longRaw,
      TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMin,
      TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMax
    )
    if (longBreakMinutes !== longRaw) {
      warnings.push(
        issue('long_break_minutes_clamped', `longBreakMinutes clamped to ${longBreakMinutes}`, 'longBreakMinutes')
      )
    }
  } else if (kind === 'pomodoro') {
    longBreakMinutes = TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes
  }

  let longBreakEvery: number | undefined
  const everyRaw = asInt(input.longBreakEvery)
  if (everyRaw !== undefined) {
    longBreakEvery = clampInt(
      everyRaw,
      TIMER_PLAN_SEED_DEFAULTS.longBreakEveryMin,
      TIMER_PLAN_SEED_DEFAULTS.longBreakEveryMax
    )
    if (longBreakEvery !== everyRaw) {
      warnings.push(issue('long_break_every_clamped', `longBreakEvery clamped to ${longBreakEvery}`, 'longBreakEvery'))
    }
  } else if (kind === 'pomodoro') {
    longBreakEvery = TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery
  }

  const minFinalRaw = asInt(input.minimumFinalFocusMinutes)
  const minimumFinalFocusMinutes = clampInt(
    minFinalRaw ?? TIMER_PLAN_SEED_DEFAULTS.minimumFinalFocusMinutes,
    TIMER_PLAN_SEED_DEFAULTS.minimumFinalFocusMinutesMin,
    TIMER_PLAN_SEED_DEFAULTS.minimumFinalFocusMinutesMax
  )

  const wrapRaw = asInt(input.wrapUpMinutes)
  const wrapUpMinutes = clampInt(
    wrapRaw ?? TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutes,
    TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutesMin,
    TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutesMax
  )

  const revisionRaw = asInt(input.revision)
  const revision = revisionRaw !== undefined && revisionRaw >= 1 ? revisionRaw : 1

  const plan: TimerPlanV2 = {
    id,
    name,
    kind,
    clockMode,
    ...(focusMinutes !== undefined ? { focusMinutes } : {}),
    ...(shortBreakMinutes !== undefined ? { shortBreakMinutes } : {}),
    ...(longBreakMinutes !== undefined ? { longBreakMinutes } : {}),
    ...(longBreakEvery !== undefined ? { longBreakEvery } : {}),
    breakPolicy,
    windowFillPolicy,
    minimumFinalFocusMinutes,
    wrapUpMinutes,
    notificationPolicy: normalizeNotificationPolicy(input.notificationPolicy),
    revision
  }

  // Continuous + countdown without focus target is weak; warn.
  if (kind === 'continuous' && clockMode === 'countdown' && focusMinutes === undefined) {
    warnings.push(
      issue(
        'continuous_countdown_missing_focus',
        'continuous countdown should set focusMinutes (30–240 seed range)',
        'focusMinutes'
      )
    )
  }

  return { ok: true, plan, warnings }
}

/** Validate an already-shaped plan (stricter; no silent field invent). */
export function validateTimerPlanV2(plan: TimerPlanV2): TimerPlanValidationResult {
  return normalizeTimerPlanV2(plan)
}

/** Create classic 25/5 seed plan (readonly catalog entry clone). */
export function createClassicPomodoroPlan(overrides?: Partial<TimerPlanV2>): TimerPlanV2 {
  const base = BUILTIN_TIMER_PLAN_CATALOG[0]
  const result = normalizeTimerPlanV2({ ...base, ...overrides, id: overrides?.id ?? base.id })
  if (!result.ok) {
    // Catalog base is always valid; surface a deterministic fallback for type safety.
    return { ...base }
  }
  return result.plan
}
