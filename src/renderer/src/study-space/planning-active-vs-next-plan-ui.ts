/**
 * Pure presentation for STC-503: active TimerSession planSnapshot vs next plan.
 *
 * Product path uses projectActiveVsNextTimerPlan; this peel only formats
 * labels/copy for thin UI. No I/O, no React.
 */

import {
  isBuiltinTimerPlanId,
  listBuiltinTimerPlans,
  projectActiveVsNextTimerPlan,
  type BreakPolicy,
  type TimerPlanV2,
  type TimerSessionRecord
} from '../../../shared/study-planning'
import { pickActiveTimerSession } from './planning-timer-display'
import { v1TimerPlanToV2 } from './planning-timer-plan-dual-write'
import type { StudyTimerPlan } from './types'

export type ActiveVsNextPlanSideModel = {
  id: string
  name: string
  summary: string
  revision: number
  focusMinutes: number | null
  breakPolicy: BreakPolicy
  source: 'snapshot' | 'catalog'
}

export type ActiveVsNextPlanUiModel = {
  /** Hide strip when neither active nor next is resolvable. */
  visible: boolean
  diverges: boolean
  hasActiveSession: boolean
  active: ActiveVsNextPlanSideModel | null
  next: ActiveVsNextPlanSideModel | null
  copy: {
    title: string
    activeLabel: string
    nextLabel: string
    divergesHint: string
    idleHint: string
    missingNextHint: string
  }
}

export type BuildActiveVsNextPlanUiModelInput = {
  /** Live local TimerSession (UI clock authority) when present. */
  activeSession?: TimerSessionRecord | null
  /**
   * Canonical timerSessions cache (hydrate / finish). Used only when
   * activeSession is null/undefined to recover a running/paused session.
   */
  timerSessions?: readonly TimerSessionRecord[] | null
  /** Preference / next-segment plan id (sole-read defaultTimerPlanId). */
  nextPlanId?: string | null
  /** V1 user catalog rows (session snapshot.timerPlans). */
  userPlans?: readonly StudyTimerPlan[] | null
}

const BREAK_POLICY_LABEL: Record<BreakPolicy, string> = {
  automatic: '自动休息',
  ask: '询问休息',
  reminder_only: '仅提醒',
  none: '无休息'
}

export function formatTimerPlanBreakPolicy(policy: BreakPolicy | null | undefined): string {
  if (!policy) return '—'
  return BREAK_POLICY_LABEL[policy] ?? policy
}

export function formatTimerPlanDurationSummary(plan: Pick<
  TimerPlanV2,
  'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'breakPolicy' | 'kind' | 'clockMode'
>): string {
  if (plan.kind === 'continuous') {
    const focus = plan.focusMinutes != null ? `${plan.focusMinutes} 分钟` : '连续'
    const clock = plan.clockMode === 'countup' ? '正计时' : '倒计时'
    return `${focus} · ${clock} · ${formatTimerPlanBreakPolicy(plan.breakPolicy)}`
  }
  const focus = plan.focusMinutes ?? 25
  const shortBreak = plan.shortBreakMinutes ?? 5
  const long = plan.longBreakMinutes
  const base = `${focus}/${shortBreak}`
  const longPart = long != null ? ` · 长休 ${long}` : ''
  return `${base}${longPart} · ${formatTimerPlanBreakPolicy(plan.breakPolicy)}`
}

/**
 * Build a merged catalog: builtins first, then user plans (user wins on same id).
 */
export function buildTimerPlanCatalogForActiveVsNext(
  userPlans: readonly StudyTimerPlan[] | null | undefined
): TimerPlanV2[] {
  const byId = new Map<string, TimerPlanV2>()
  for (const builtin of listBuiltinTimerPlans()) {
    byId.set(builtin.id, builtin)
  }
  for (const plan of userPlans ?? []) {
    if (!plan?.id) continue
    byId.set(plan.id, v1TimerPlanToV2(plan))
  }
  return Array.from(byId.values())
}

/**
 * Prefer live session; else pick active (running/paused) from sole-read cache.
 */
export function resolveActiveTimerSessionForPlanUi(input: {
  activeSession?: TimerSessionRecord | null
  timerSessions?: readonly TimerSessionRecord[] | null
}): TimerSessionRecord | null {
  if (input.activeSession) return input.activeSession
  const sessions = input.timerSessions
  if (!sessions || sessions.length === 0) return null
  return pickActiveTimerSession(sessions, 'any')
}

/**
 * Resolve next-segment plan id with classic fallback when unset / missing.
 */
export function resolveNextTimerPlanId(
  nextPlanId: string | null | undefined,
  catalog: readonly Pick<TimerPlanV2, 'id'>[]
): string | null {
  const trimmed = typeof nextPlanId === 'string' ? nextPlanId.trim() : ''
  if (trimmed && catalog.some((p) => p.id === trimmed)) return trimmed
  if (catalog.some((p) => p.id === 'classic_25_5')) return 'classic_25_5'
  return catalog[0]?.id ?? null
}

function toSideModel(
  plan: TimerPlanV2,
  source: 'snapshot' | 'catalog'
): ActiveVsNextPlanSideModel {
  return {
    id: plan.id,
    name: plan.name || (isBuiltinTimerPlanId(plan.id) ? plan.id : '未命名方案'),
    summary: formatTimerPlanDurationSummary(plan),
    revision: plan.revision,
    focusMinutes: plan.focusMinutes ?? null,
    breakPolicy: plan.breakPolicy,
    source
  }
}

/**
 * Project STC-503 UI model from live/cached session + next plan preference.
 */
export function buildActiveVsNextPlanUiModel(
  input: BuildActiveVsNextPlanUiModelInput
): ActiveVsNextPlanUiModel {
  const catalog = buildTimerPlanCatalogForActiveVsNext(input.userPlans)
  const activeSession = resolveActiveTimerSessionForPlanUi({
    activeSession: input.activeSession,
    timerSessions: input.timerSessions
  })
  const nextId = resolveNextTimerPlanId(input.nextPlanId, catalog)
  const projection = projectActiveVsNextTimerPlan({
    activeSession,
    nextPlanId: nextId,
    catalog
  })

  const active = projection.activeSnapshot
    ? toSideModel(projection.activeSnapshot, 'snapshot')
    : null
  const next = projection.nextPlan ? toSideModel(projection.nextPlan, 'catalog') : null
  const hasActiveSession = Boolean(activeSession && active)
  const diverges = projection.diverges
  const visible = Boolean(active || next)

  return {
    visible,
    diverges,
    hasActiveSession,
    active,
    next,
    copy: {
      title: '当前会话与下一段方案',
      activeLabel: '当前会话方案快照',
      nextLabel: '下一段方案',
      divergesHint: '当前会话保持冻结；修改只影响下一段。',
      idleHint: '开始计时后，此处显示本会话冻结的方案快照。',
      missingNextHint: '尚未选择下一段方案。'
    }
  }
}
