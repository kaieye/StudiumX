/**
 * Phase 7 pure helpers still in product:
 * - estimate suggestion (never auto-write)
 * - schedule conflict detection (used by STC-707 opt-in resolve)
 *
 * Product removal (2026-07-22): allocateTimeWindow / multi-window day allocation /
 * plan utilization compare driven by AllocationProposal are **removed** —
 * no "按时钟方案生成排程提案" product path.
 */

import type { ScheduleBlock } from './schedule-block'

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

/**
 * STC-707 simplified: detect overlapping schedule blocks (conflict list).
 * Locked blocks are included (UI lists them; resolve pure refuses to move them).
 * Full drag-reorder remains UI; auto-stagger is opt-in via proposeScheduleConflictResolve.
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
