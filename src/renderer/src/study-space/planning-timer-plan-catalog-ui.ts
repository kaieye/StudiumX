/**
 * Pure TimerPlan catalog UI model (STC-501/502 product path depth).
 *
 * Builtins are always listed (seed defaults). Timer fields may be overridden
 * via host userPlans with the same id. Builtins cannot be deleted; rename/edit ok.
 * No I/O.
 */

import {
  isBuiltinTimerPlanId,
  listBuiltinTimerPlans,
  type TimerPlanV2
} from '../../../shared/study-planning'
import { v2TimerPlanToV1 } from './planning-timer-plan-dual-write'
import { formatTimerPlanKindSummary } from './planning-timer-plan-kind'
import type { StudyTimerPlan } from './types'

export type TimerPlanCatalogRowKind = 'builtin' | 'custom'

export type TimerPlanCatalogRow = {
  id: string
  name: string
  focusMinutes: number
  breakMinutes: number
  simulationStartTime: string
  simulationEndTime: string
  kind: TimerPlanCatalogRowKind
  /** Plan kind for product label (pomodoro | continuous | custom_rhythm). */
  planKind: 'pomodoro' | 'continuous' | 'custom_rhythm'
  /** Human summary (focus/break or continuous countup). */
  summary: string
  readonly: boolean
  isDefault: boolean
  canRename: boolean
  canDelete: boolean
  canSetDefault: boolean
  canCopy: boolean
}

export type ListTimerPlanCatalogRowsInput = {
  userPlans: readonly StudyTimerPlan[]
  defaultTimerPlanId?: string | null
  /**
   * When true (default), builtins not already present in userPlans are prepended
   * as readonly catalog entries so STC-501 copy path is always visible.
   */
  includeBuiltins?: boolean
}

function v2ToRowShell(plan: TimerPlanV2, window?: {
  simulationStartTime?: string
  simulationEndTime?: string
}): StudyTimerPlan {
  return v2TimerPlanToV1(plan, window)
}

/**
 * Normalize rename input: trim, length cap (V1 UI max 24), empty → invalid.
 */
export function normalizeTimerPlanRename(name: string, maxLen = 24):
  | { ok: true; name: string }
  | { ok: false; code: 'empty' | 'unchanged'; message: string } {
  const trimmed = name.trim().slice(0, maxLen)
  if (!trimmed) {
    return { ok: false, code: 'empty', message: 'name required' }
  }
  return { ok: true, name: trimmed }
}

/**
 * Whether a plan id is a system seed that cannot be deleted from the catalog.
 * (Fields and name may still be edited and dual-written under the same id.)
 */
export function isReadonlyTimerPlanId(planId: string): boolean {
  return isBuiltinTimerPlanId(planId)
}

/**
 * Resolve default plan id with fallback to classic when unset / missing.
 */
export function resolveDefaultTimerPlanId(
  defaultTimerPlanId: string | null | undefined,
  rows: readonly Pick<TimerPlanCatalogRow, 'id'>[]
): string {
  if (defaultTimerPlanId && rows.some((r) => r.id === defaultTimerPlanId)) {
    return defaultTimerPlanId
  }
  if (rows.some((r) => r.id === 'classic_25_5')) return 'classic_25_5'
  return rows[0]?.id ?? 'classic_25_5'
}

/**
 * Project user plans + optional builtin catalog into ordered UI rows.
 * Builtins first (catalog order), then custom (user list order).
 */
export function listTimerPlanCatalogRows(
  input: ListTimerPlanCatalogRowsInput
): TimerPlanCatalogRow[] {
  const includeBuiltins = input.includeBuiltins !== false
  const userById = new Map(input.userPlans.map((p) => [p.id, p]))
  const rows: TimerPlanCatalogRow[] = []
  const seen = new Set<string>()

  const pushRow = (plan: StudyTimerPlan, kind: TimerPlanCatalogRowKind): void => {
    if (seen.has(plan.id)) return
    seen.add(plan.id)
    const isBuiltin = kind === 'builtin' || isBuiltinTimerPlanId(plan.id)
    // System seeds stay non-deletable; fields/name are editable (overrides live in userPlans).
    const readonly = false
    const isDefault =
      (input.defaultTimerPlanId ?? null) === plan.id ||
      (!input.defaultTimerPlanId && plan.id === 'classic_25_5')
    const planKind =
      plan.kind === 'continuous'
        ? 'continuous'
        : plan.kind === 'custom_rhythm'
          ? 'custom_rhythm'
          : 'pomodoro'
    rows.push({
      id: plan.id,
      name: plan.name,
      focusMinutes: plan.focusMinutes,
      breakMinutes: plan.breakMinutes,
      simulationStartTime: plan.simulationStartTime,
      simulationEndTime: plan.simulationEndTime,
      kind: isBuiltin ? 'builtin' : 'custom',
      planKind,
      summary: formatTimerPlanKindSummary(plan),
      readonly,
      isDefault,
      canRename: true,
      canDelete: !isBuiltin,
      canSetDefault: true,
      canCopy: true
    })
  }

  if (includeBuiltins) {
    for (const builtin of listBuiltinTimerPlans()) {
      const host = userById.get(builtin.id)
      // Prefer saved override (same id) when the user has edited a system plan.
      const shell = host ?? v2ToRowShell(builtin)
      pushRow(shell, 'builtin')
    }
  }

  for (const plan of input.userPlans) {
    if (isBuiltinTimerPlanId(plan.id)) continue
    pushRow(plan, 'custom')
  }

  // Recompute isDefault against resolved id so only one row is marked.
  const resolvedDefault = resolveDefaultTimerPlanId(input.defaultTimerPlanId, rows)
  return rows.map((r) => ({
    ...r,
    isDefault: r.id === resolvedDefault
  }))
}

/**
 * Find a plan shell for apply/copy when source may be builtin-only (not in user list).
 */
export function resolveTimerPlanShellForCatalog(
  planId: string,
  userPlans: readonly StudyTimerPlan[]
): StudyTimerPlan | null {
  const fromUser = userPlans.find((p) => p.id === planId)
  if (fromUser) return fromUser
  if (!isBuiltinTimerPlanId(planId)) return null
  const builtin = listBuiltinTimerPlans().find((p) => p.id === planId)
  if (!builtin) return null
  return v2ToRowShell(builtin)
}

/**
 * Apply rename on a V1 plan list without changing active timer presets.
 */
export function renameTimerPlanInV1List(
  plans: readonly StudyTimerPlan[],
  planId: string,
  name: string
):
  | { ok: true; plans: StudyTimerPlan[] }
  | { ok: false; code: 'not_found' | 'builtin_readonly' | 'invalid'; message: string } {
  const normalized = normalizeTimerPlanRename(name)
  if (!normalized.ok) {
    return { ok: false, code: 'invalid', message: normalized.message }
  }
  if (plans.some((p) => p.id === planId)) {
    return {
      ok: true,
      plans: plans.map((p) => (p.id === planId ? { ...p, name: normalized.name } : p))
    }
  }
  // Builtin seed not yet in user list: materialize a renamed override under the same id.
  if (isBuiltinTimerPlanId(planId)) {
    const shell = resolveTimerPlanShellForCatalog(planId, plans)
    if (!shell) {
      return { ok: false, code: 'not_found', message: `plan ${planId}` }
    }
    return {
      ok: true,
      plans: [...plans, { ...shell, name: normalized.name }]
    }
  }
  return { ok: false, code: 'not_found', message: `plan ${planId}` }
}
