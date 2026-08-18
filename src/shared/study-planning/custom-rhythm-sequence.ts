/**
 * Study planning pure domain — custom rhythm sequence (STC-702).
 *
 * Roadmap §4.1 C: ordered sequence of focus / short_break / long_break / wrap_up.
 * V1 is NOT a freeform drag editor — only ordered steps with kind + minutes.
 * Fail-closed validation; no I/O; no path freeze beyond ADR-0011.
 */

import {
  TIMER_PLAN_SEED_DEFAULTS,
  normalizeTimerPlanV2,
  type TimerPlanV2,
  type TimerPlanValidationIssue,
  type TimerPlanValidationResult
} from './timer-plan'

/** Closed set of step kinds (matches ScheduleBlockKind; no blank in plan identity). */
export type CustomRhythmStepKind = 'focus' | 'short_break' | 'long_break' | 'wrap_up'

export type CustomRhythmStep = {
  kind: CustomRhythmStepKind
  /** Positive integer minutes for this step. */
  minutes: number
}

export type CustomRhythmValidationIssue = {
  code: string
  message: string
  /** 0-based step index when applicable. */
  index?: number
  field?: string
}

export type CustomRhythmValidationResult =
  | { ok: true; sequence: CustomRhythmStep[]; warnings: CustomRhythmValidationIssue[] }
  | { ok: false; issues: CustomRhythmValidationIssue[]; sequence?: CustomRhythmStep[] }

/** Seed limits for custom rhythm (Phase7; not a durable path/schema freeze). */
export const CUSTOM_RHYTHM_SEED_LIMITS = {
  stepsMin: 1,
  stepsMax: 24,
  totalMinutesMin: 5,
  totalMinutesMax: 12 * 60,
  /** Per-kind minute ranges aligned with TIMER_PLAN_SEED_DEFAULTS. */
  focusMinutesMin: TIMER_PLAN_SEED_DEFAULTS.focusMinutesMin,
  focusMinutesMax: TIMER_PLAN_SEED_DEFAULTS.focusMinutesMax,
  shortBreakMinutesMin: TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMin,
  shortBreakMinutesMax: TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMax,
  longBreakMinutesMin: TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMin,
  longBreakMinutesMax: TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMax,
  wrapUpMinutesMin: 1,
  wrapUpMinutesMax: TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutesMax
} as const

const STEP_KIND_SET = new Set<CustomRhythmStepKind>([
  'focus',
  'short_break',
  'long_break',
  'wrap_up'
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

function issue(
  code: string,
  message: string,
  extra?: { index?: number; field?: string }
): CustomRhythmValidationIssue {
  return {
    code,
    message,
    ...(extra?.index !== undefined ? { index: extra.index } : {}),
    ...(extra?.field ? { field: extra.field } : {})
  }
}

function minutesRangeForKind(kind: CustomRhythmStepKind): { min: number; max: number } {
  switch (kind) {
    case 'focus':
      return {
        min: CUSTOM_RHYTHM_SEED_LIMITS.focusMinutesMin,
        max: CUSTOM_RHYTHM_SEED_LIMITS.focusMinutesMax
      }
    case 'short_break':
      return {
        min: CUSTOM_RHYTHM_SEED_LIMITS.shortBreakMinutesMin,
        max: CUSTOM_RHYTHM_SEED_LIMITS.shortBreakMinutesMax
      }
    case 'long_break':
      return {
        min: CUSTOM_RHYTHM_SEED_LIMITS.longBreakMinutesMin,
        max: CUSTOM_RHYTHM_SEED_LIMITS.longBreakMinutesMax
      }
    case 'wrap_up':
      return {
        min: CUSTOM_RHYTHM_SEED_LIMITS.wrapUpMinutesMin,
        max: CUSTOM_RHYTHM_SEED_LIMITS.wrapUpMinutesMax
      }
  }
}

/**
 * Normalize unknown input into a fail-closed ordered rhythm sequence.
 * Clamps in-range minutes with warnings; rejects invalid kind / empty / oversize.
 */
export function normalizeCustomRhythmSequence(input: unknown): CustomRhythmValidationResult {
  const hard: CustomRhythmValidationIssue[] = []
  const warnings: CustomRhythmValidationIssue[] = []

  if (!Array.isArray(input)) {
    return {
      ok: false,
      issues: [issue('sequence_not_array', 'rhythmSequence must be an array', { field: 'rhythmSequence' })]
    }
  }

  if (input.length < CUSTOM_RHYTHM_SEED_LIMITS.stepsMin) {
    hard.push(
      issue('sequence_empty', 'rhythmSequence must include at least one step', {
        field: 'rhythmSequence'
      })
    )
  }
  if (input.length > CUSTOM_RHYTHM_SEED_LIMITS.stepsMax) {
    hard.push(
      issue(
        'sequence_too_long',
        `rhythmSequence max ${CUSTOM_RHYTHM_SEED_LIMITS.stepsMax} steps (refuse silent truncate)`,
        { field: 'rhythmSequence' }
      )
    )
  }

  const sequence: CustomRhythmStep[] = []
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i]
    if (!isObject(raw)) {
      hard.push(issue('step_not_object', `step[${i}] must be an object`, { index: i }))
      continue
    }
    const kindRaw = asTrimmedString(raw.kind)
    if (!kindRaw || !STEP_KIND_SET.has(kindRaw as CustomRhythmStepKind)) {
      hard.push(
        issue('step_kind_invalid', `step[${i}].kind must be focus|short_break|long_break|wrap_up`, {
          index: i,
          field: 'kind'
        })
      )
      continue
    }
    const kind = kindRaw as CustomRhythmStepKind
    const minutesRaw = asInt(raw.minutes)
    if (minutesRaw === undefined) {
      hard.push(
        issue('step_minutes_required', `step[${i}].minutes must be a finite number`, {
          index: i,
          field: 'minutes'
        })
      )
      continue
    }
    const range = minutesRangeForKind(kind)
    if (minutesRaw < range.min || minutesRaw > range.max) {
      // Fail-closed on out-of-range (no silent invent of product intent).
      hard.push(
        issue(
          'step_minutes_out_of_range',
          `step[${i}] ${kind} minutes must be ${range.min}-${range.max}`,
          { index: i, field: 'minutes' }
        )
      )
      continue
    }
    sequence.push({ kind, minutes: minutesRaw })
  }

  if (hard.length > 0) {
    return { ok: false, issues: hard, sequence: sequence.length > 0 ? sequence : undefined }
  }

  if (!sequence.some((s) => s.kind === 'focus')) {
    return {
      ok: false,
      issues: [
        issue('sequence_requires_focus', 'rhythmSequence must include at least one focus step', {
          field: 'rhythmSequence'
        })
      ],
      sequence
    }
  }

  // Soft: wrap_up after a break-only trailing pattern is fine; warn if wrap_up is not last.
  const lastWrapIdx = sequence.map((s) => s.kind).lastIndexOf('wrap_up')
  if (lastWrapIdx >= 0 && lastWrapIdx !== sequence.length - 1) {
    warnings.push(
      issue(
        'wrap_up_not_terminal',
        'wrap_up is usually the final step; non-terminal wrap_up is allowed but unusual',
        { index: lastWrapIdx, field: 'kind' }
      )
    )
  }

  const total = sumCustomRhythmMinutes(sequence).totalMinutes
  if (total < CUSTOM_RHYTHM_SEED_LIMITS.totalMinutesMin) {
    hard.push(
      issue(
        'sequence_total_too_short',
        `sequence total minutes must be >= ${CUSTOM_RHYTHM_SEED_LIMITS.totalMinutesMin}`,
        { field: 'rhythmSequence' }
      )
    )
  }
  if (total > CUSTOM_RHYTHM_SEED_LIMITS.totalMinutesMax) {
    hard.push(
      issue(
        'sequence_total_too_long',
        `sequence total minutes must be <= ${CUSTOM_RHYTHM_SEED_LIMITS.totalMinutesMax}`,
        { field: 'rhythmSequence' }
      )
    )
  }
  if (hard.length > 0) {
    return { ok: false, issues: hard, sequence }
  }

  return { ok: true, sequence, warnings }
}

/** Stricter validate of already-shaped steps (no invent). */
export function validateCustomRhythmSequence(
  steps: readonly CustomRhythmStep[]
): CustomRhythmValidationResult {
  return normalizeCustomRhythmSequence(steps)
}

export function sumCustomRhythmMinutes(sequence: readonly CustomRhythmStep[]): {
  totalMinutes: number
  focusMinutes: number
  breakMinutes: number
  wrapUpMinutes: number
} {
  let focusMinutes = 0
  let breakMinutes = 0
  let wrapUpMinutes = 0
  for (const step of sequence) {
    if (step.kind === 'focus') focusMinutes += step.minutes
    else if (step.kind === 'wrap_up') wrapUpMinutes += step.minutes
    else breakMinutes += step.minutes
  }
  return {
    totalMinutes: focusMinutes + breakMinutes + wrapUpMinutes,
    focusMinutes,
    breakMinutes,
    wrapUpMinutes
  }
}

/**
 * Primary field projections for lifecycle compatibility (first occurrence per kind).
 * Does not invent missing kinds.
 */
export function projectCustomRhythmPrimaryMinutes(sequence: readonly CustomRhythmStep[]): {
  focusMinutes?: number
  shortBreakMinutes?: number
  longBreakMinutes?: number
  wrapUpMinutes?: number
} {
  const out: {
    focusMinutes?: number
    shortBreakMinutes?: number
    longBreakMinutes?: number
    wrapUpMinutes?: number
  } = {}
  for (const step of sequence) {
    if (step.kind === 'focus' && out.focusMinutes === undefined) out.focusMinutes = step.minutes
    if (step.kind === 'short_break' && out.shortBreakMinutes === undefined) {
      out.shortBreakMinutes = step.minutes
    }
    if (step.kind === 'long_break' && out.longBreakMinutes === undefined) {
      out.longBreakMinutes = step.minutes
    }
    if (step.kind === 'wrap_up' && out.wrapUpMinutes === undefined) out.wrapUpMinutes = step.minutes
  }
  return out
}

/**
 * Resolve the step at `stepIndex` (0-based, modular over sequence length when wrap=true).
 * Fail-closed when sequence empty or index invalid without wrap.
 */
export function resolveCustomRhythmStep(
  sequence: readonly CustomRhythmStep[],
  stepIndex: number,
  options?: { wrap?: boolean }
): { ok: true; step: CustomRhythmStep; index: number } | { ok: false; code: string } {
  if (!sequence.length) return { ok: false, code: 'sequence_empty' }
  if (!Number.isFinite(stepIndex)) return { ok: false, code: 'index_invalid' }
  const raw = Math.trunc(stepIndex)
  if (options?.wrap) {
    const mod = ((raw % sequence.length) + sequence.length) % sequence.length
    return { ok: true, step: sequence[mod], index: mod }
  }
  if (raw < 0 || raw >= sequence.length) return { ok: false, code: 'index_out_of_range' }
  return { ok: true, step: sequence[raw], index: raw }
}

/** Next step after completing `completedStepIndex` (wraps by default for cycle playback). */
export function nextCustomRhythmStep(
  sequence: readonly CustomRhythmStep[],
  completedStepIndex: number,
  options?: { wrap?: boolean }
): { ok: true; step: CustomRhythmStep; index: number } | { ok: false; code: string } {
  const wrap = options?.wrap !== false
  return resolveCustomRhythmStep(sequence, completedStepIndex + 1, { wrap })
}

/**
 * Expand sequence into a flat playback list for one or more cycles.
 * Caps total expanded steps to avoid state explosion (max 48 expanded steps).
 */
export function expandCustomRhythmSequence(
  sequence: readonly CustomRhythmStep[],
  options?: { cycles?: number; maxSteps?: number }
): { ok: true; steps: CustomRhythmStep[] } | { ok: false; code: string; message: string } {
  const validated = validateCustomRhythmSequence(sequence)
  if (!validated.ok) {
    return {
      ok: false,
      code: 'sequence_invalid',
      message: validated.issues.map((i) => i.message).join('; ')
    }
  }
  const cycles = Math.max(1, Math.trunc(options?.cycles ?? 1))
  const maxSteps = Math.max(1, Math.trunc(options?.maxSteps ?? 48))
  if (cycles * validated.sequence.length > maxSteps) {
    return {
      ok: false,
      code: 'expand_too_large',
      message: `refusing expand: ${cycles} cycles × ${validated.sequence.length} steps > max ${maxSteps}`
    }
  }
  const steps: CustomRhythmStep[] = []
  for (let c = 0; c < cycles; c += 1) {
    for (const step of validated.sequence) steps.push({ ...step })
  }
  return { ok: true, steps }
}

/**
 * Create a custom_rhythm TimerPlanV2 from an ordered sequence.
 * Sets primary focus/break/wrap minutes from first occurrence for lifecycle fallbacks.
 */
export function createCustomRhythmPlan(input: {
  id: string
  name: string
  sequence: readonly CustomRhythmStep[] | unknown
  overrides?: Partial<TimerPlanV2>
}): TimerPlanValidationResult {
  const seqResult = normalizeCustomRhythmSequence(input.sequence)
  if (!seqResult.ok) {
    return {
      ok: false,
      issues: seqResult.issues.map((i) => ({
        code: i.code,
        message: i.message,
        ...(i.field ? { field: i.field } : {})
      }))
    }
  }

  const primary = projectCustomRhythmPrimaryMinutes(seqResult.sequence)
  const base = {
    id: input.id,
    name: input.name,
    clockMode: 'countdown' as const,
    breakPolicy: 'ask' as const,
    windowFillPolicy: TIMER_PLAN_SEED_DEFAULTS.windowFillPolicy,
    minimumFinalFocusMinutes: TIMER_PLAN_SEED_DEFAULTS.minimumFinalFocusMinutes,
    wrapUpMinutes: primary.wrapUpMinutes ?? TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutes,
    notificationPolicy: {
      sound: true,
      systemNotification: true,
      focusEnd: true,
      breakEnd: true
    },
    revision: 1,
    ...(primary.focusMinutes !== undefined ? { focusMinutes: primary.focusMinutes } : {}),
    ...(primary.shortBreakMinutes !== undefined
      ? { shortBreakMinutes: primary.shortBreakMinutes }
      : {}),
    ...(primary.longBreakMinutes !== undefined ? { longBreakMinutes: primary.longBreakMinutes } : {}),
    ...input.overrides,
    // Force kind + sequence after overrides (identity of this factory).
    kind: 'custom_rhythm' as const,
    rhythmSequence: seqResult.sequence
  }

  const result = normalizeTimerPlanV2(base)
  if (!result.ok) return result
  // Surface sequence soft warnings onto plan warnings.
  const warnings: TimerPlanValidationIssue[] = [
    ...result.warnings,
    ...seqResult.warnings.map((w) => ({
      code: w.code,
      message: w.message,
      ...(w.field ? { field: w.field } : {})
    }))
  ]
  return { ok: true, plan: result.plan, warnings }
}

/** Type guard: plan is custom_rhythm with a sequence array (may still need validate). */
export function isCustomRhythmPlan(
  plan: Pick<TimerPlanV2, 'kind' | 'rhythmSequence'> | null | undefined
): plan is TimerPlanV2 & { kind: 'custom_rhythm'; rhythmSequence: CustomRhythmStep[] } {
  return Boolean(plan && plan.kind === 'custom_rhythm' && Array.isArray(plan.rhythmSequence))
}

/**
 * Minutes for a session phase from sequence when available.
 * Prefer step at `stepIndex` when provided; else first matching kind; else undefined.
 */
export function customRhythmMinutesForPhase(
  sequence: readonly CustomRhythmStep[] | null | undefined,
  phase: CustomRhythmStepKind,
  stepIndex?: number
): number | undefined {
  if (!sequence?.length) return undefined
  if (stepIndex !== undefined && Number.isFinite(stepIndex)) {
    const resolved = resolveCustomRhythmStep(sequence, stepIndex, { wrap: true })
    if (resolved.ok && resolved.step.kind === phase) return resolved.step.minutes
  }
  const first = sequence.find((s) => s.kind === phase)
  return first?.minutes
}

// ---------------------------------------------------------------------------
// STC-702 product-signal polish (ordered list only; no freeform drag)
// ---------------------------------------------------------------------------

/** Short product labels distinguishing step kinds (a11y + editor copy). */
export const CUSTOM_RHYTHM_STEP_KIND_LABELS: Readonly<
  Record<CustomRhythmStepKind, { label: string; shortLabel: string; description: string }>
> = {
  focus: {
    label: '专注',
    shortLabel: '专注',
    description: '专注学习时段'
  },
  short_break: {
    label: '短休息',
    shortLabel: '短休',
    description: '短休息时段'
  },
  long_break: {
    label: '长休息',
    shortLabel: '长休',
    description: '长休息时段'
  },
  wrap_up: {
    label: '收尾',
    shortLabel: '收尾',
    description: '收尾整理时段（通常为序列末步）'
  }
} as const

export const CUSTOM_RHYTHM_STEP_KIND_OPTIONS: readonly {
  value: CustomRhythmStepKind
  label: string
  shortLabel: string
}[] = (
  ['focus', 'short_break', 'long_break', 'wrap_up'] as const
).map((value) => ({
  value,
  label: CUSTOM_RHYTHM_STEP_KIND_LABELS[value].label,
  shortLabel: CUSTOM_RHYTHM_STEP_KIND_LABELS[value].shortLabel
}))

/** User-facing Chinese copy for editor issues (codes stay stable for tests). */
export function formatCustomRhythmIssueMessage(
  issue: CustomRhythmValidationIssue
): string {
  const step = issue.index !== undefined ? `第 ${issue.index + 1} 步` : '序列'
  switch (issue.code) {
    case 'sequence_not_array':
      return '节奏序列无效：需要步骤列表'
    case 'sequence_empty':
      return '节奏序列不能为空，请至少添加一步（含一次专注）'
    case 'sequence_too_long':
      return `节奏最多 ${CUSTOM_RHYTHM_SEED_LIMITS.stepsMax} 步，不会静默截断`
    case 'sequence_requires_focus':
      return '节奏至少需要一个「专注」步骤'
    case 'sequence_total_too_short':
      return `合计时长至少 ${CUSTOM_RHYTHM_SEED_LIMITS.totalMinutesMin} 分钟`
    case 'sequence_total_too_long':
      return `合计时长不能超过 ${CUSTOM_RHYTHM_SEED_LIMITS.totalMinutesMax} 分钟`
    case 'step_not_object':
      return `${step} 数据无效`
    case 'step_kind_invalid':
      return `${step} 类型无效（须为 专注 / 短休息 / 长休息 / 收尾）`
    case 'step_minutes_required':
      return `${step} 分钟数无效`
    case 'step_minutes_out_of_range':
      return `${step} 分钟超出允许范围（禁止静默改写为默认番茄）`
    case 'wrap_up_not_terminal':
      return '「收尾」通常放在最后一步；当前允许但非常规'
    default:
      return issue.message
  }
}

/**
 * Editor-facing issue list: hard errors first, then warnings.
 * Empty / unknown kind / non-positive minutes fail-closed (no silent invent).
 */
export function listCustomRhythmEditorIssues(
  sequence: unknown
): {
  ok: boolean
  hard: Array<CustomRhythmValidationIssue & { displayMessage: string }>
  warnings: Array<CustomRhythmValidationIssue & { displayMessage: string }>
} {
  const result = normalizeCustomRhythmSequence(sequence)
  if (!result.ok) {
    return {
      ok: false,
      hard: result.issues.map((i) => ({
        ...i,
        displayMessage: formatCustomRhythmIssueMessage(i)
      })),
      warnings: []
    }
  }
  return {
    ok: true,
    hard: [],
    warnings: result.warnings.map((i) => ({
      ...i,
      displayMessage: formatCustomRhythmIssueMessage(i)
    }))
  }
}

/**
 * Advance rhythm step index after a phase completes.
 * - Walks forward to the next step whose kind matches `nextPhase` (wrap).
 * - When completed step is wrap_up and wrap_up is last in sequence, marks
 *   `wrapUpTerminal: true` (cycle may still wrap for multi-cycle playback).
 * Fail-closed on empty sequence.
 */
export function advanceCustomRhythmOnPhaseComplete(input: {
  sequence: readonly CustomRhythmStep[]
  completedStepIndex: number
  nextPhase: CustomRhythmStepKind
}):
  | {
      ok: true
      nextStepIndex: number
      nextStep: CustomRhythmStep
      wrapUpTerminal: boolean
      wrapped: boolean
    }
  | { ok: false; code: string } {
  const seq = input.sequence
  if (!seq.length) return { ok: false, code: 'sequence_empty' }
  const completedIdx = Number.isFinite(input.completedStepIndex)
    ? Math.trunc(input.completedStepIndex)
    : 0
  const completedMod = ((completedIdx % seq.length) + seq.length) % seq.length
  const completed = seq[completedMod]
  const wrapUpTerminal =
    completed.kind === 'wrap_up' && completedMod === seq.length - 1

  let nextStepIndex: number | undefined
  let wrapped = false
  for (let j = 1; j <= seq.length; j += 1) {
    const absolute = completedMod + j
    const idx = absolute % seq.length
    if (absolute >= seq.length) wrapped = true
    if (seq[idx].kind === input.nextPhase) {
      nextStepIndex = idx
      break
    }
  }
  if (nextStepIndex === undefined) {
    const fallback = seq.findIndex((s) => s.kind === input.nextPhase)
    if (fallback < 0) return { ok: false, code: 'phase_not_in_sequence' }
    nextStepIndex = fallback
    wrapped = true
  }
  return {
    ok: true,
    nextStepIndex,
    nextStep: seq[nextStepIndex],
    wrapUpTerminal,
    wrapped
  }
}

/**
 * Pure coexistence check: classic_25_5 / deep_50_10 identity rows must stay
 * pomodoro-shaped (not custom_rhythm). Focus/break minutes may be user-edited.
 */
export function assertBuiltinPomodoroSemanticsIntact(plans: readonly {
  id: string
  kind?: string
  focusMinutes?: number
  shortBreakMinutes?: number
  rhythmSequence?: unknown
}[]): { ok: true } | { ok: false; code: string; planId: string } {
  const classic = plans.find((p) => p.id === 'classic_25_5')
  if (classic) {
    if (classic.kind && classic.kind !== 'pomodoro') {
      return { ok: false, code: 'classic_kind_rewritten', planId: 'classic_25_5' }
    }
    if (Array.isArray(classic.rhythmSequence) && classic.rhythmSequence.length > 0) {
      return { ok: false, code: 'classic_has_rhythm_sequence', planId: 'classic_25_5' }
    }
  }
  const deep = plans.find((p) => p.id === 'deep_50_10')
  if (deep) {
    if (deep.kind && deep.kind !== 'pomodoro') {
      return { ok: false, code: 'deep_kind_rewritten', planId: 'deep_50_10' }
    }
    if (Array.isArray(deep.rhythmSequence) && deep.rhythmSequence.length > 0) {
      return { ok: false, code: 'deep_has_rhythm_sequence', planId: 'deep_50_10' }
    }
  }
  return { ok: true }
}

export function isActivePlanSnapshotFrozenAgainstCatalogEdit(input: {
  activePlanSnapshot:
    | { kind?: string; rhythmSequence?: readonly CustomRhythmStep[] | null }
    | null
    | undefined
  /** Original frozen sequence captured at session start. */
  frozenSequence: readonly CustomRhythmStep[] | null | undefined
  catalogSequence?: readonly CustomRhythmStep[] | null | undefined
}): boolean {
  const snap = input.activePlanSnapshot
  if (!snap) return true
  const live = snap.rhythmSequence
  const frozen = input.frozenSequence
  if (!Array.isArray(live) || !Array.isArray(frozen)) {
    // No sequence to protect — freeze vacuously holds.
    return true
  }
  if (live.length !== frozen.length) return false
  for (let i = 0; i < live.length; i += 1) {
    if (live[i].kind !== frozen[i].kind || live[i].minutes !== frozen[i].minutes) {
      return false
    }
  }
  // Catalog may differ freely; snapshot must still match frozen original.
  void input.catalogSequence
  return true
}

/**
 * Whether a draft sequence is saveable (fail-closed product gate).
 * Empty / unknown kind / non-positive minutes -> false (no silent tomato invent).
 */
export function isSaveableCustomRhythmSequence(sequence: unknown): boolean {
  return normalizeCustomRhythmSequence(sequence).ok
}
