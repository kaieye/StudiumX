/**
 * Phase 7 pure helpers (optional advanced scheduling) — utilization compare,
 * estimate suggestion (never auto-write), multi-window day plan shell.
 */

import { allocateTimeWindow, type AllocationProposal, type AllocatorTask, type TimeWindow } from './allocate-time-window'
import type { TimerPlanV2 } from './timer-plan'
import type { ScheduleBlock } from './schedule-block'

export type UtilizationCompareRow = {
  planId: string
  planName: string
  utilizationRatio: number
  focusMinutesTotal: number
  breakMinutesTotal: number
  warnings: string[]
}

/** STC-705: compare plans on the same window + tasks. */
export function compareAllocationUtilization(input: {
  window: TimeWindow
  plans: readonly TimerPlanV2[]
  tasks?: readonly AllocatorTask[]
  nowMs?: number
}): UtilizationCompareRow[] {
  return input.plans.map((plan) => {
    const proposal: AllocationProposal = allocateTimeWindow({
      window: input.window,
      plan,
      tasks: input.tasks,
      nowMs: input.nowMs
    })
    return {
      planId: plan.id,
      planName: plan.name,
      utilizationRatio: proposal.meta.utilizationRatio,
      focusMinutesTotal: proposal.meta.focusMinutesTotal,
      breakMinutesTotal: proposal.meta.breakMinutesTotal,
      warnings: proposal.warnings
    }
  })
}

/**
 * STC-706: suggest estimate from history; never mutates task.
 * Simple median of completed focus sessions for the task.
 */
export function suggestEstimateMinutesFromHistory(input: {
  focusSecondsSamples: readonly number[]
}): { suggestedMinutes: number | null; sampleCount: number } {
  const mins = input.focusSecondsSamples
    .filter((s) => Number.isFinite(s) && s > 0)
    .map((s) => Math.round(s / 60))
    .sort((a, b) => a - b)
  if (mins.length === 0) return { suggestedMinutes: null, sampleCount: 0 }
  const mid = Math.floor(mins.length / 2)
  const suggested =
    mins.length % 2 === 0 ? Math.round((mins[mid - 1] + mins[mid]) / 2) : mins[mid]
  return { suggestedMinutes: suggested, sampleCount: mins.length }
}

/** STC-701: allocate each window independently, concat proposals. */
export function allocateMultiWindowDay(input: {
  windows: readonly TimeWindow[]
  plan: TimerPlanV2
  tasks?: readonly AllocatorTask[]
  nowMs?: number
}): AllocationProposal[] {
  return input.windows.map((window) =>
    allocateTimeWindow({
      window,
      plan: input.plan,
      tasks: input.tasks,
      nowMs: input.nowMs
    })
  )
}

/**
 * STC-707 simplified: detect overlapping unlocked blocks (conflict list).
 * Full drag-reorder remains UI.
 */
export function findScheduleConflicts(blocks: readonly ScheduleBlock[]): Array<{
  aId: string
  bId: string
}> {
  const ordered = [...blocks].sort((a, b) => a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs)
  const conflicts: Array<{ aId: string; bId: string }> = []
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const a = ordered[i]
      const b = ordered[j]
      if (b.startAtMs >= a.endAtMs) break
      if (a.startAtMs < b.endAtMs && b.startAtMs < a.endAtMs) {
        conflicts.push({ aId: a.id, bId: b.id })
      }
    }
  }
  return conflicts
}
