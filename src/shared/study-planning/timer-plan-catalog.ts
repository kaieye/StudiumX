/**
 * Timer plan catalog + TimeWindow templates (Phase 5 pure / STC-501..508).
 * Builtin seed ids cannot be deleted; field/name overrides may be saved under the same id.
 */

import {
  BUILTIN_TIMER_PLAN_CATALOG,
  TIMER_PLAN_SEED_DEFAULTS,
  normalizeTimerPlanV2,
  type TimerPlanV2
} from './timer-plan'
import type { TimerSessionRecord } from './timer-session-lifecycle'

export const TIMER_PLAN_USER_LIMIT = TIMER_PLAN_SEED_DEFAULTS.planLimit

export function isBuiltinTimerPlanId(id: string): boolean {
  return BUILTIN_TIMER_PLAN_CATALOG.some((p) => p.id === id)
}

export function listBuiltinTimerPlans(): readonly TimerPlanV2[] {
  return BUILTIN_TIMER_PLAN_CATALOG
}

/** Copy builtin or any plan as a new custom plan (STC-501). */
export function copyTimerPlanAsCustom(input: {
  source: TimerPlanV2
  newId: string
  newName?: string
}):
  | { ok: true; plan: TimerPlanV2 }
  | { ok: false; code: string; message: string } {
  const name = (input.newName?.trim() || `${input.source.name} 副本`).slice(0, 80)
  const result = normalizeTimerPlanV2({
    ...input.source,
    id: input.newId,
    name,
    revision: 1
  })
  if (!result.ok) {
    return { ok: false, code: 'plan_invalid', message: result.issues.map((i) => i.message).join('; ') }
  }
  return { ok: true, plan: result.plan }
}

export type TimerPlanCatalogOpResult =
  | { ok: true; plans: TimerPlanV2[]; defaultTimerPlanId?: string | null }
  | { ok: false; code: 'plan_limit' | 'not_found' | 'builtin_readonly' | 'invalid'; message: string }

/** Enforce max 12; never silent slice (STC-507). */
export function canAddTimerPlan(existingCount: number): boolean {
  return existingCount < TIMER_PLAN_USER_LIMIT
}

export function removeTimerPlanFromCatalog(input: {
  plans: readonly TimerPlanV2[]
  planId: string
  defaultTimerPlanId?: string | null
}): TimerPlanCatalogOpResult {
  if (isBuiltinTimerPlanId(input.planId)) {
    // Allow removing only if it was copied into user list with same id? Builtins live in catalog constant.
    // User list may hold copies; if id is builtin id in user store, refuse delete of system identity.
    return {
      ok: false,
      code: 'builtin_readonly',
      message: 'System builtin plans are read-only; copy then delete the custom copy'
    }
  }
  if (!input.plans.some((p) => p.id === input.planId)) {
    return { ok: false, code: 'not_found', message: `plan ${input.planId}` }
  }
  const plans = input.plans.filter((p) => p.id !== input.planId)
  let defaultTimerPlanId = input.defaultTimerPlanId
  if (defaultTimerPlanId === input.planId) {
    defaultTimerPlanId = plans[0]?.id ?? 'classic_25_5'
  }
  return { ok: true, plans, defaultTimerPlanId }
}

export function renameTimerPlanInCatalog(input: {
  plans: readonly TimerPlanV2[]
  planId: string
  name: string
}): TimerPlanCatalogOpResult {
  const name = input.name.trim()
  if (!name) return { ok: false, code: 'invalid', message: 'name required' }
  const existing = input.plans.find((p) => p.id === input.planId)
  if (existing) {
    return {
      ok: true,
      plans: input.plans.map((p) =>
        p.id === input.planId ? { ...p, name, revision: p.revision + 1 } : p
      )
    }
  }
  // Builtin seed not yet in user list: materialize a renamed override under the same id.
  if (isBuiltinTimerPlanId(input.planId)) {
    const seed = BUILTIN_TIMER_PLAN_CATALOG.find((p) => p.id === input.planId)
    if (!seed) {
      return { ok: false, code: 'not_found', message: `plan ${input.planId}` }
    }
    const normalized = normalizeTimerPlanV2({ ...seed, name, revision: seed.revision + 1 })
    if (!normalized.ok) {
      return { ok: false, code: 'invalid', message: normalized.issues.map((i) => i.message).join('; ') }
    }
    return { ok: true, plans: [...input.plans, normalized.plan] }
  }
  return { ok: false, code: 'not_found', message: `plan ${input.planId}` }
}

/**
 * STC-503: what the running session uses vs what the next segment will use.
 */
export function projectActiveVsNextTimerPlan(input: {
  activeSession: TimerSessionRecord | null
  nextPlanId: string | null | undefined
  catalog: readonly TimerPlanV2[]
}): {
  activeSnapshot: TimerPlanV2 | null
  nextPlan: TimerPlanV2 | null
  diverges: boolean
} {
  const activeSnapshot = input.activeSession?.planSnapshot ?? null
  const nextId = input.nextPlanId ?? null
  const nextPlan = nextId ? input.catalog.find((p) => p.id === nextId) ?? null : null
  const diverges = Boolean(
    activeSnapshot &&
      nextPlan &&
      (activeSnapshot.id !== nextPlan.id ||
        activeSnapshot.revision !== nextPlan.revision ||
        activeSnapshot.focusMinutes !== nextPlan.focusMinutes ||
        activeSnapshot.breakPolicy !== nextPlan.breakPolicy)
  )
  return { activeSnapshot, nextPlan, diverges }
}

/** TimeWindow templates — NOT part of TimerPlan identity (STC-508). */
export type TimeWindowTemplate = {
  id: string
  name: string
  /** Minutes from local midnight. */
  startMinutes: number
  endMinutes: number
  hardEnd: boolean
}

export const BUILTIN_TIME_WINDOW_TEMPLATES: readonly TimeWindowTemplate[] = [
  { id: 'morning_0900_1200', name: '上午 09:00–12:00', startMinutes: 9 * 60, endMinutes: 12 * 60, hardEnd: true },
  { id: 'afternoon_1400_1700', name: '下午 14:00–17:00', startMinutes: 14 * 60, endMinutes: 17 * 60, hardEnd: true },
  { id: 'evening_1900_2200', name: '晚间 19:00–22:00', startMinutes: 19 * 60, endMinutes: 22 * 60, hardEnd: true },
  { id: 'deep_block_3h', name: '深度 3 小时（从现在起）', startMinutes: -1, endMinutes: -1, hardEnd: true }
] as const

export function materializeTimeWindowTemplate(input: {
  template: TimeWindowTemplate
  dayEpochMs: number
  /** Required when template uses relative "from now". */
  nowMs?: number
}): { startAtMs: number; endAtMs: number; hardEnd: boolean; label: string } {
  if (input.template.startMinutes < 0) {
    const now = input.nowMs ?? input.dayEpochMs
    const end = now + 3 * 60 * 60_000
    return {
      startAtMs: now,
      endAtMs: end,
      hardEnd: input.template.hardEnd,
      label: input.template.name
    }
  }
  const startAtMs = input.dayEpochMs + input.template.startMinutes * 60_000
  const endAtMs = input.dayEpochMs + input.template.endMinutes * 60_000
  return {
    startAtMs,
    endAtMs,
    hardEnd: input.template.hardEnd,
    label: input.template.name
  }
}

/** Continuous countdown target validation (STC-505): 30–240 minutes. */
export function validateContinuousCountdownMinutes(minutes: number): {
  ok: boolean
  minutes?: number
  code?: string
} {
  if (!Number.isFinite(minutes)) return { ok: false, code: 'not_finite' }
  const m = Math.trunc(minutes)
  if (m < 30 || m > 240) return { ok: false, code: 'out_of_range' }
  return { ok: true, minutes: m }
}
