/**
 * STC-707 opt-in conflict auto-resolve proposal (pure).
 *
 * Produces a pure projection of unlocked block moves that clear overlaps.
 * Never writes store, never moves locked blocks, never auto-applies.
 * Optional hard window rejects moves past window.endAtMs when hardEnd is true.
 *
 * ADR-0130 §5.1: default product path remains list/banner + user edit;
 * silent auto-stagger is forbidden. Callers must require explicit confirm.
 */

import { findScheduleConflicts } from './advanced-scheduling'
import { isValidScheduleBlockInterval, type ScheduleBlock } from './schedule-block'

/** Max greedy resolve iterations (safety cap). */
export const SCHEDULE_CONFLICT_RESOLVE_MAX_STEPS = 32

export type ProposeScheduleConflictResolvePolicy =
  | 'shift_later_unlocked'
  | 'shift_earlier_unlocked'

export type ProposeScheduleConflictResolveWindow = {
  startAtMs: number
  endAtMs: number
  /** When true (default for product), reject moves with to.endAtMs > window.endAtMs. */
  hardEnd: boolean
}

export type ProposeScheduleConflictResolveInput = {
  blocks: readonly ScheduleBlock[]
  /** Optional hard window; only enforced when hardEnd is true. */
  window?: ProposeScheduleConflictResolveWindow
  /**
   * Which unlocked peer to move when both unlocked.
   * Default: shift the later-starting block later to sit at the earlier peer's end.
   */
  policy?: ProposeScheduleConflictResolvePolicy
  /** If set, only attempt these pair keys; default all from findScheduleConflicts. */
  pairFilter?: ReadonlyArray<{ aId: string; bId: string }>
  /** Override max greedy steps (default SCHEDULE_CONFLICT_RESOLVE_MAX_STEPS). */
  maxSteps?: number
}

export type ProposedBlockMove = {
  blockId: string
  from: { startAtMs: number; endAtMs: number }
  to: { startAtMs: number; endAtMs: number }
  reason: string
}

export type ProposeScheduleConflictResolveOk = {
  ok: true
  moves: ProposedBlockMove[]
  /** Pure projection after all moves; not written. */
  nextBlocks: ScheduleBlock[]
  remainingConflicts: Array<{ aId: string; bId: string }>
  warnings: string[]
}

export type ProposeScheduleConflictResolveCode =
  | 'no_conflicts'
  | 'both_locked'
  | 'no_gap'
  | 'hard_end_violation'
  | 'locked_would_move'
  | 'duration_invalid'
  | 'step_cap'

export type ProposeScheduleConflictResolveErr = {
  ok: false
  code: ProposeScheduleConflictResolveCode
  message: string
  details?: Record<string, unknown>
}

export type ProposeScheduleConflictResolveResult =
  | ProposeScheduleConflictResolveOk
  | ProposeScheduleConflictResolveErr

function pairKeyOf(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`
}

function cloneBlocks(blocks: readonly ScheduleBlock[]): ScheduleBlock[] {
  return blocks.map((b) => ({ ...b }))
}

function filterPairs(
  pairs: ReadonlyArray<{ aId: string; bId: string }>,
  pairFilter?: ReadonlyArray<{ aId: string; bId: string }>
): Array<{ aId: string; bId: string }> {
  if (!pairFilter || pairFilter.length === 0) return [...pairs]
  const allowed = new Set(pairFilter.map((p) => pairKeyOf(p.aId, p.bId)))
  return pairs.filter((p) => allowed.has(pairKeyOf(p.aId, p.bId)))
}

/**
 * Deterministic pick: which unlocked block to move for one overlap pair.
 * Never returns a locked block id.
 */
function pickMoveTarget(input: {
  a: ScheduleBlock
  b: ScheduleBlock
  policy: ProposeScheduleConflictResolvePolicy
}): { moveId: string; anchor: ScheduleBlock } | { error: ProposeScheduleConflictResolveCode; message: string } {
  const aLocked = Boolean(input.a.locked)
  const bLocked = Boolean(input.b.locked)

  if (aLocked && bLocked) {
    return {
      error: 'both_locked',
      message: `Both blocks are locked: ${input.a.id} / ${input.b.id}`
    }
  }

  if (aLocked && !bLocked) {
    return { moveId: input.b.id, anchor: input.a }
  }
  if (bLocked && !aLocked) {
    return { moveId: input.a.id, anchor: input.b }
  }

  // Both unlocked — deterministic policy.
  const earlier = input.a.startAtMs <= input.b.startAtMs ? input.a : input.b
  const later = earlier.id === input.a.id ? input.b : input.a

  if (input.policy === 'shift_earlier_unlocked') {
    // Move the earlier block earlier so it ends at the later block's start.
    return { moveId: earlier.id, anchor: later }
  }

  // Default: shift later-start block later to sit at earlier peer's end.
  return { moveId: later.id, anchor: earlier }
}

function proposeShift(input: {
  move: ScheduleBlock
  anchor: ScheduleBlock
  policy: ProposeScheduleConflictResolvePolicy
}): { startAtMs: number; endAtMs: number } | null {
  const duration = input.move.endAtMs - input.move.startAtMs
  if (!(duration > 0) || !Number.isFinite(duration)) return null

  if (input.policy === 'shift_earlier_unlocked') {
    // Place move so it ends at anchor.startAtMs (must not invent negative times only via hard window).
    const endAtMs = input.anchor.startAtMs
    const startAtMs = endAtMs - duration
    if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs <= startAtMs) return null
    return { startAtMs, endAtMs }
  }

  // shift_later_unlocked: place move so it starts at anchor.endAtMs
  const startAtMs = input.anchor.endAtMs
  const endAtMs = startAtMs + duration
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs <= startAtMs) return null
  return { startAtMs, endAtMs }
}

function violatesHardEnd(
  window: ProposeScheduleConflictResolveWindow | undefined,
  to: { startAtMs: number; endAtMs: number }
): boolean {
  if (!window || window.hardEnd !== true) return false
  if (!Number.isFinite(window.endAtMs)) return false
  return to.endAtMs > window.endAtMs
}

/**
 * Propose deterministic unlocked shifts that clear schedule overlaps.
 * Pure: no I/O, no Date.now, no store.
 */
export function proposeScheduleConflictResolve(
  input: ProposeScheduleConflictResolveInput
): ProposeScheduleConflictResolveResult {
  const policy: ProposeScheduleConflictResolvePolicy =
    input.policy === 'shift_earlier_unlocked' ? 'shift_earlier_unlocked' : 'shift_later_unlocked'
  const maxSteps =
    typeof input.maxSteps === 'number' && Number.isFinite(input.maxSteps) && input.maxSteps > 0
      ? Math.floor(input.maxSteps)
      : SCHEDULE_CONFLICT_RESOLVE_MAX_STEPS

  const working = cloneBlocks(input.blocks)
  const initialPairs = filterPairs(findScheduleConflicts(working), input.pairFilter)

  if (initialPairs.length === 0) {
    return {
      ok: false,
      code: 'no_conflicts',
      message: 'No schedule conflicts to resolve.'
    }
  }

  const moves: ProposedBlockMove[] = []
  const warnings: string[] = []
  const movedIds = new Set<string>()

  for (let step = 0; step < maxSteps; step += 1) {
    const pairs = filterPairs(findScheduleConflicts(working), input.pairFilter)
    if (pairs.length === 0) break

    // Stable pick: earliest-start pair first, then pairKey.
    const byId = new Map(working.map((b) => [b.id, b]))
    const ordered = [...pairs].sort((left, right) => {
      const a = byId.get(left.aId)
      const b = byId.get(right.aId)
      const aStart = a?.startAtMs ?? 0
      const bStart = b?.startAtMs ?? 0
      if (aStart !== bStart) return aStart - bStart
      return pairKeyOf(left.aId, left.bId).localeCompare(pairKeyOf(right.aId, right.bId))
    })

    const pair = ordered[0]
    const a = byId.get(pair.aId)
    const b = byId.get(pair.bId)
    if (!a || !b) {
      return {
        ok: false,
        code: 'no_gap',
        message: 'Conflict references a missing block.',
        details: { pair }
      }
    }

    const pick = pickMoveTarget({ a, b, policy })
    if ('error' in pick) {
      return {
        ok: false,
        code: pick.error,
        message: pick.message,
        details: { aId: a.id, bId: b.id }
      }
    }

    const moveBlock = byId.get(pick.moveId)
    if (!moveBlock) {
      return {
        ok: false,
        code: 'no_gap',
        message: `Move target missing: ${pick.moveId}`
      }
    }

    if (moveBlock.locked) {
      // Defensive — pickMoveTarget must never select locked.
      return {
        ok: false,
        code: 'locked_would_move',
        message: `Refusing to move locked block ${moveBlock.id}`,
        details: { blockId: moveBlock.id }
      }
    }

    const to = proposeShift({ move: moveBlock, anchor: pick.anchor, policy })
    if (!to) {
      return {
        ok: false,
        code: 'duration_invalid',
        message: `Invalid duration for block ${moveBlock.id}`,
        details: { blockId: moveBlock.id }
      }
    }

    if (!isValidScheduleBlockInterval(to)) {
      return {
        ok: false,
        code: 'duration_invalid',
        message: `Proposed interval invalid for block ${moveBlock.id}`,
        details: { blockId: moveBlock.id, to }
      }
    }

    if (violatesHardEnd(input.window, to)) {
      return {
        ok: false,
        code: 'hard_end_violation',
        message: `Move of ${moveBlock.id} would end past hard window end`,
        details: {
          blockId: moveBlock.id,
          to,
          windowEndAtMs: input.window?.endAtMs
        }
      }
    }

    // No-op guard (would infinite-loop).
    if (to.startAtMs === moveBlock.startAtMs && to.endAtMs === moveBlock.endAtMs) {
      return {
        ok: false,
        code: 'no_gap',
        message: `No productive shift for block ${moveBlock.id}`,
        details: { blockId: moveBlock.id, pair }
      }
    }

    const from = { startAtMs: moveBlock.startAtMs, endAtMs: moveBlock.endAtMs }
    const reason =
      policy === 'shift_earlier_unlocked'
        ? `shift_earlier_before:${pick.anchor.id}`
        : `shift_later_after:${pick.anchor.id}`

    // Apply to working projection (revision not mutated — pure proposal).
    const idx = working.findIndex((row) => row.id === moveBlock.id)
    if (idx < 0) {
      return {
        ok: false,
        code: 'no_gap',
        message: `Move target missing in working set: ${moveBlock.id}`
      }
    }
    working[idx] = {
      ...working[idx],
      startAtMs: to.startAtMs,
      endAtMs: to.endAtMs
    }

    moves.push({
      blockId: moveBlock.id,
      from,
      to,
      reason
    })
    movedIds.add(moveBlock.id)
  }

  const remaining = filterPairs(findScheduleConflicts(working), input.pairFilter)

  if (remaining.length > 0 && moves.length >= maxSteps) {
    return {
      ok: false,
      code: 'step_cap',
      message: `Exceeded max resolve steps (${maxSteps}) with remaining conflicts`,
      details: { remainingCount: remaining.length, moveCount: moves.length }
    }
  }

  if (moves.length === 0) {
    // Should have failed earlier; fail-closed.
    if (remaining.length > 0) {
      const sample = remaining[0]
      const byId = new Map(working.map((b) => [b.id, b]))
      const a = byId.get(sample.aId)
      const b = byId.get(sample.bId)
      if (a?.locked && b?.locked) {
        return {
          ok: false,
          code: 'both_locked',
          message: `Both blocks are locked: ${sample.aId} / ${sample.bId}`,
          details: { aId: sample.aId, bId: sample.bId }
        }
      }
      return {
        ok: false,
        code: 'no_gap',
        message: 'Could not propose any unlocked moves for remaining conflicts.',
        details: { remainingCount: remaining.length }
      }
    }
    return {
      ok: false,
      code: 'no_conflicts',
      message: 'No schedule conflicts to resolve.'
    }
  }

  if (remaining.length > 0) {
    warnings.push(`remaining_conflicts:${remaining.length}`)
  }

  // Verify no locked block was moved (defensive invariant).
  for (const move of moves) {
    const original = input.blocks.find((b) => b.id === move.blockId)
    if (original?.locked) {
      return {
        ok: false,
        code: 'locked_would_move',
        message: `Refusing proposal that would move locked block ${move.blockId}`,
        details: { blockId: move.blockId }
      }
    }
  }

  return {
    ok: true,
    moves,
    nextBlocks: working,
    remainingConflicts: remaining,
    warnings
  }
}
