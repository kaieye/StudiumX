/**
 * Study planning pure domain — TimerPlanV2 normalize/validate (STC-101).
 *
 * Phase 1 first slice (ADR-0094 §4): pure types + validation only.
 * No I/O, no localStorage, no canonical path freeze, no TimerSession lifecycle.
 * Numeric defaults are Phase1 seeds from the planning roadmap (§4.2), not a new durable ADR freeze.
 */

export type TimerPlanKind = 'pomodoro' | 'continuous' | 'custom_rhythm'
/**
 * Sub-mode for kind === 'continuous' (durable V2 field).
 * - open: open-ended countup (no focusMinutes target)
 * - target: continuous cycle / focus target (focusMinutes set; may be countdown or countup)
 * - exam: exam wall simulation (countup + focusMinutes target; V1 continuousTarget true)
 */
export type ContinuousMode = 'open' | 'target' | 'exam'
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
  /**
   * Continuous sub-mode. Required when kind === 'continuous' after normalize
   * (inferred from focusMinutes/clockMode when missing for legacy snapshots).
   */
  continuousMode?: ContinuousMode
  focusMinutes?: number
  shortBreakMinutes?: number
  longBreakMinutes?: number
  longBreakEvery?: number
  breakPolicy: BreakPolicy
  windowFillPolicy: WindowFillPolicy
  minimumFinalFocusMinutes: number
  wrapUpMinutes: number
  notificationPolicy: TimerPlanNotificationPolicy
  /**
   * STC-702: ordered custom rhythm steps (kind + minutes only).
   * Present when kind === 'custom_rhythm'. Not a freeform drag editor.
   */
  rhythmSequence?: Array<{ kind: 'focus' | 'short_break' | 'long_break' | 'wrap_up'; minutes: number }>
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
  shortBreakMinutesMin: 0,
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
    name: '经典番茄',
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
    name: '深度专注',
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
    name: '考场模拟',
    kind: 'continuous',
    clockMode: 'countup',
    continuousMode: 'exam',
    // Default morning exam window 09:00–12:00 = 180 minutes (ring + session target).
    focusMinutes: 180,
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

const KIND_SET = new Set<TimerPlanKind>(['pomodoro', 'continuous', 'custom_rhythm'])
const CLOCK_SET = new Set<TimerClockMode>(['countdown', 'countup'])
const CONTINUOUS_MODE_SET = new Set<ContinuousMode>(['open', 'target', 'exam'])
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
  if (!kind) hard.push(issue('plan_kind_invalid', 'kind must be pomodoro, continuous, or custom_rhythm', 'kind'))

  const clockRaw = asTrimmedString(input.clockMode)
  const clockMode =
    clockRaw && CLOCK_SET.has(clockRaw as TimerClockMode) ? (clockRaw as TimerClockMode) : undefined
  if (!clockMode) {
    hard.push(issue('plan_clock_mode_invalid', 'clockMode must be countdown or countup', 'clockMode'))
  }

  if (hard.length > 0 || !id || !name || !kind || !clockMode) {
    return { ok: false, issues: hard }
  }

  // continuousMode: explicit field preferred; legacy infer from focusMinutes / clockMode.
  let continuousMode: ContinuousMode | undefined
  if (kind === 'continuous') {
    const modeRaw = asTrimmedString(input.continuousMode)
    if (modeRaw && CONTINUOUS_MODE_SET.has(modeRaw as ContinuousMode)) {
      continuousMode = modeRaw as ContinuousMode
    } else if (modeRaw) {
      warnings.push(
        issue(
          'continuous_mode_fallback',
          `Unknown continuousMode "${modeRaw}"; inferring from focus/clock`,
          'continuousMode'
        )
      )
    }
    if (continuousMode === undefined) {
      const focusProbe = asInt(input.focusMinutes)
      if (clockMode === 'countup' && focusProbe === undefined) {
        continuousMode = 'open'
      } else if (clockMode === 'countup' && focusProbe != null) {
        // Legacy catalog exam seed id; other countup+focus → target (V1 continuousTarget maps exam explicitly).
        continuousMode = id === 'continuous_countup' ? 'exam' : 'target'
      } else {
        continuousMode = 'target'
      }
    }
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
  } else if (kind === 'custom_rhythm') {
    // Custom rhythm defaults to ask (same product freeze #3 spirit as pomodoro).
    breakPolicy = TIMER_PLAN_SEED_DEFAULTS.pomodoroBreakPolicy
  }

  if (
    (kind === 'pomodoro' || kind === 'custom_rhythm') &&
    (breakPolicy === 'none' || breakPolicy === 'reminder_only')
  ) {
    // Allowed only as explicit continuous policy per freeze #6; soft-coerce pomodoro/custom_rhythm.
    warnings.push(
      issue(
        'pomodoro_break_policy_coerced',
        'pomodoro/custom_rhythm plans must not silently default to none/reminder_only; coerced to ask',
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

  // STC-702: optional ordered rhythm sequence (custom_rhythm only; fail-closed).
  let rhythmSequence: TimerPlanV2['rhythmSequence']
  const rawSequence = input.rhythmSequence
  if (kind === 'custom_rhythm') {
    if (!Array.isArray(rawSequence)) {
      hard.push(
        issue(
          'rhythm_sequence_required',
          'custom_rhythm plans require rhythmSequence array',
          'rhythmSequence'
        )
      )
    } else {
      // Inline lightweight validate to avoid circular import with custom-rhythm-sequence.
      const STEP_KINDS = new Set(['focus', 'short_break', 'long_break', 'wrap_up'])
      const steps: NonNullable<TimerPlanV2['rhythmSequence']> = []
      if (rawSequence.length < 1 || rawSequence.length > 24) {
        hard.push(
          issue(
            'rhythm_sequence_length',
            'rhythmSequence length must be 1-24',
            'rhythmSequence'
          )
        )
      }
      let hasFocus = false
      for (let i = 0; i < rawSequence.length; i += 1) {
        const step = rawSequence[i]
        if (!isObject(step)) {
          hard.push(issue('rhythm_step_invalid', 'step[' + i + '] must be object', 'rhythmSequence'))
          continue
        }
        const sk = asTrimmedString(step.kind)
        const mins = asInt(step.minutes)
        if (!sk || !STEP_KINDS.has(sk) || mins === undefined || mins < 1) {
          hard.push(
            issue(
              'rhythm_step_invalid',
              'step[' + i + '] needs kind+positive minutes',
              'rhythmSequence'
            )
          )
          continue
        }
        if (sk === 'focus') hasFocus = true
        steps.push({ kind: sk as NonNullable<TimerPlanV2['rhythmSequence']>[number]['kind'], minutes: mins })
      }
      if (steps.length > 0 && !hasFocus) {
        hard.push(
          issue(
            'rhythm_sequence_requires_focus',
            'rhythmSequence must include at least one focus step',
            'rhythmSequence'
          )
        )
      }
      if (hard.length === 0 && steps.length > 0) {
        rhythmSequence = steps
        // Project primary minutes when missing so lifecycle phaseDurationSeconds still works.
        if (focusMinutes === undefined) {
          const firstFocus = steps.find((s) => s.kind === 'focus')
          if (firstFocus) focusMinutes = firstFocus.minutes
        }
        if (shortBreakMinutes === undefined) {
          const firstShort = steps.find((s) => s.kind === 'short_break')
          if (firstShort) shortBreakMinutes = firstShort.minutes
        }
        if (longBreakMinutes === undefined) {
          const firstLong = steps.find((s) => s.kind === 'long_break')
          if (firstLong) longBreakMinutes = firstLong.minutes
        }
      }
    }
    if (hard.length > 0) {
      return { ok: false, issues: hard }
    }
  } else if (Array.isArray(rawSequence) && rawSequence.length > 0) {
    warnings.push(
      issue(
        'rhythm_sequence_ignored',
        'rhythmSequence is only used when kind is custom_rhythm; ignored',
        'rhythmSequence'
      )
    )
  }

  // Exam sub-mode always countup; open has no focus target.
  let resolvedClock = clockMode
  let resolvedFocus = focusMinutes
  let resolvedContinuousMode = continuousMode
  if (kind === 'continuous' && continuousMode === 'exam') {
    resolvedClock = 'countup'
    if (resolvedFocus === undefined) {
      resolvedFocus = 180
      warnings.push(
        issue('exam_focus_defaulted', 'exam continuousMode defaulted focusMinutes to 180', 'focusMinutes')
      )
    }
  }
  if (kind === 'continuous' && continuousMode === 'open') {
    resolvedFocus = undefined
  }
  // If open but focus was provided explicitly, promote to target.
  if (kind === 'continuous' && resolvedContinuousMode === 'open' && asInt(input.focusMinutes) != null) {
    // open factory always passes undefined; explicit focus on open → treat as target
    if (Object.prototype.hasOwnProperty.call(input, 'focusMinutes') && input.focusMinutes != null) {
      resolvedContinuousMode = 'target'
      resolvedFocus = focusMinutes
    }
  }

  const plan: TimerPlanV2 = {
    id,
    name,
    kind,
    clockMode: resolvedClock,
    ...(kind === 'continuous' && resolvedContinuousMode
      ? { continuousMode: resolvedContinuousMode }
      : {}),
    ...(resolvedFocus !== undefined ? { focusMinutes: resolvedFocus } : {}),
    ...(shortBreakMinutes !== undefined ? { shortBreakMinutes } : {}),
    ...(longBreakMinutes !== undefined ? { longBreakMinutes } : {}),
    ...(longBreakEvery !== undefined ? { longBreakEvery } : {}),
    breakPolicy,
    windowFillPolicy,
    minimumFinalFocusMinutes,
    wrapUpMinutes,
    notificationPolicy: normalizeNotificationPolicy(input.notificationPolicy),
    ...(rhythmSequence !== undefined ? { rhythmSequence } : {}),
    revision
  }

  // Continuous + countdown without focus target is weak; warn.
  if (kind === 'continuous' && resolvedClock === 'countdown' && resolvedFocus === undefined) {
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

/** Exam wall simulation seed (catalog id continuous_countup; continuousMode exam). */
export function createExamSimulationPlan(overrides?: Partial<TimerPlanV2>): TimerPlanV2 {
  const base = BUILTIN_TIMER_PLAN_CATALOG.find((p) => p.id === 'continuous_countup') ?? BUILTIN_TIMER_PLAN_CATALOG[2]
  const result = normalizeTimerPlanV2({
    ...base,
    ...overrides,
    id: overrides?.id ?? base.id,
    kind: 'continuous',
    clockMode: 'countup',
    continuousMode: 'exam',
    focusMinutes:
      overrides != null && Object.prototype.hasOwnProperty.call(overrides, 'focusMinutes')
        ? overrides.focusMinutes
        : (base.focusMinutes ?? 180)
  })
  if (!result.ok) {
    return {
      ...base,
      id: overrides?.id ?? base.id,
      continuousMode: 'exam',
      clockMode: 'countup',
      kind: 'continuous',
      focusMinutes: base.focusMinutes ?? 180
    }
  }
  return result.plan
}

/** Open continuous countup: no focusMinutes target (never inherits exam 180). */
export function createOpenContinuousPlan(overrides?: Partial<TimerPlanV2>): TimerPlanV2 {
  const base = BUILTIN_TIMER_PLAN_CATALOG.find((p) => p.id === 'continuous_countup') ?? BUILTIN_TIMER_PLAN_CATALOG[2]
  const { focusMinutes: _dropFocus, continuousMode: _dropMode, ...baseShell } = base
  const id = overrides?.id ?? 'open_continuous'
  const result = normalizeTimerPlanV2({
    ...baseShell,
    ...overrides,
    id,
    kind: 'continuous',
    clockMode: overrides?.clockMode === 'countdown' ? 'countdown' : 'countup',
    continuousMode: 'open',
    focusMinutes: undefined,
    name: overrides?.name ?? '连续专注'
  })
  if (!result.ok) {
    return {
      ...baseShell,
      id,
      kind: 'continuous',
      clockMode: 'countup',
      continuousMode: 'open',
      name: overrides?.name ?? '连续专注',
      breakPolicy: base.breakPolicy
    }
  }
  // Ensure open stays without focusMinutes even if normalize invents one.
  if (result.plan.focusMinutes != null) {
    const { focusMinutes: _f, ...rest } = result.plan
    return { ...rest, continuousMode: 'open' }
  }
  return { ...result.plan, continuousMode: 'open' }
}

/**
 * @deprecated Prefer createExamSimulationPlan / createOpenContinuousPlan.
 * Compat wrapper: catalog id continuous_countup or continuousMode exam → exam seed;
 * explicit open (no focus / continuousMode open) → open; else target continuous.
 */
export function createContinuousCountupPlan(overrides?: Partial<TimerPlanV2>): TimerPlanV2 {
  const id = overrides?.id
  const mode = overrides?.continuousMode
  const hasFocus =
    overrides != null && Object.prototype.hasOwnProperty.call(overrides, 'focusMinutes')
  const focus = hasFocus ? overrides!.focusMinutes : undefined

  // Exam: explicit mode, or default catalog seed (no overrides / only cosmetic overrides).
  if (mode === 'exam') {
    return createExamSimulationPlan(overrides)
  }
  if (mode === 'open') {
    return createOpenContinuousPlan(overrides)
  }
  if (mode === 'target') {
    const base = BUILTIN_TIMER_PLAN_CATALOG.find((p) => p.id === 'continuous_countup') ?? BUILTIN_TIMER_PLAN_CATALOG[2]
    const { focusMinutes: _cf, continuousMode: _cm, ...baseShell } = base
    const result = normalizeTimerPlanV2({
      ...baseShell,
      ...overrides,
      id: overrides?.id ?? 'continuous_target',
      kind: 'continuous',
      continuousMode: 'target',
      ...(hasFocus
        ? focus === undefined
          ? { focusMinutes: undefined }
          : { focusMinutes: focus }
        : { focusMinutes: TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes })
    })
    if (!result.ok) {
      return createOpenContinuousPlan(overrides)
    }
    return result.plan
  }

  // No continuousMode: legacy heuristics without id-only exam for non-catalog shells.
  if (!hasFocus && (id == null || id === 'continuous_countup')) {
    return createExamSimulationPlan(overrides)
  }
  if (!hasFocus || focus === undefined) {
    return createOpenContinuousPlan(overrides)
  }
  // Has focusMinutes → target continuous (not exam unless mode/id catalog handled above)
  if (id === 'continuous_countup') {
    return createExamSimulationPlan(overrides)
  }
  const base = BUILTIN_TIMER_PLAN_CATALOG.find((p) => p.id === 'continuous_countup') ?? BUILTIN_TIMER_PLAN_CATALOG[2]
  const { focusMinutes: _cf, continuousMode: _cm, ...baseShell } = base
  const result = normalizeTimerPlanV2({
    ...baseShell,
    ...overrides,
    id: overrides?.id ?? 'continuous_target',
    kind: 'continuous',
    continuousMode: 'target',
    focusMinutes: focus
  })
  if (!result.ok) {
    return {
      ...baseShell,
      id: overrides?.id ?? 'continuous_target',
      kind: 'continuous',
      clockMode: overrides?.clockMode === 'countdown' ? 'countdown' : 'countup',
      continuousMode: 'target',
      focusMinutes: focus,
      breakPolicy: base.breakPolicy,
      windowFillPolicy: base.windowFillPolicy,
      minimumFinalFocusMinutes: base.minimumFinalFocusMinutes,
      wrapUpMinutes: base.wrapUpMinutes,
      notificationPolicy: base.notificationPolicy,
      revision: 1,
      name: overrides?.name ?? base.name
    }
  }
  return result.plan
}
