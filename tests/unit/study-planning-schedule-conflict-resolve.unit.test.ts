import { describe, expect, it } from 'vitest'
import type { ScheduleBlock } from '../../src/shared/study-planning'
import {
  findScheduleConflicts,
  proposeScheduleConflictResolve
} from '../../src/shared/study-planning'

function focus(
  partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'startAtMs' | 'endAtMs'>
): ScheduleBlock {
  return {
    taskId: partial.taskId ?? `task-${partial.id}`,
    kind: 'focus',
    locked: partial.locked ?? false,
    source: partial.source ?? 'manual',
    status: partial.status ?? 'planned',
    revision: partial.revision ?? 1,
    ...partial
  }
}

describe('proposeScheduleConflictResolve (STC-707)', () => {
  it('shifts later unlocked block to clear unlocked∩unlocked overlap', () => {
    const a = focus({ id: 'a', startAtMs: 0, endAtMs: 100, taskId: 't1' })
    const b = focus({ id: 'b', startAtMs: 50, endAtMs: 150, taskId: 't2' })
    const result = proposeScheduleConflictResolve({ blocks: [a, b] })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.moves).toHaveLength(1)
    expect(result.moves[0].blockId).toBe('b')
    expect(result.moves[0].from).toEqual({ startAtMs: 50, endAtMs: 150 })
    expect(result.moves[0].to).toEqual({ startAtMs: 100, endAtMs: 200 })
    // Duration preserved
    expect(result.moves[0].to.endAtMs - result.moves[0].to.startAtMs).toBe(100)
    // Locked / unmoved side unchanged
    const nextA = result.nextBlocks.find((row) => row.id === 'a')
    expect(nextA?.startAtMs).toBe(0)
    expect(nextA?.endAtMs).toBe(100)
    expect(result.remainingConflicts).toHaveLength(0)
    expect(findScheduleConflicts(result.nextBlocks)).toHaveLength(0)
  })

  it('moves only unlocked peer when locked∩unlocked; locked timestamps identical', () => {
    const locked = focus({
      id: 'locked',
      startAtMs: 0,
      endAtMs: 100,
      locked: true,
      taskId: 't1'
    })
    const free = focus({
      id: 'free',
      startAtMs: 50,
      endAtMs: 150,
      locked: false,
      taskId: 't2'
    })
    const result = proposeScheduleConflictResolve({ blocks: [locked, free] })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.moves).toHaveLength(1)
    expect(result.moves[0].blockId).toBe('free')
    expect(result.moves[0].to).toEqual({ startAtMs: 100, endAtMs: 200 })

    const nextLocked = result.nextBlocks.find((row) => row.id === 'locked')
    expect(nextLocked?.startAtMs).toBe(0)
    expect(nextLocked?.endAtMs).toBe(100)
    expect(nextLocked?.locked).toBe(true)
    expect(result.remainingConflicts).toHaveLength(0)
  })

  it('fails closed on locked∩locked (both_locked)', () => {
    const a = focus({ id: 'a', startAtMs: 0, endAtMs: 100, locked: true })
    const b = focus({ id: 'b', startAtMs: 50, endAtMs: 150, locked: true })
    const result = proposeScheduleConflictResolve({ blocks: [a, b] })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('both_locked')
  })

  it('rejects moves past hardEnd window (hard_end_violation)', () => {
    const a = focus({ id: 'a', startAtMs: 0, endAtMs: 100 })
    const b = focus({ id: 'b', startAtMs: 50, endAtMs: 150 })
    // Shifting b later → [100, 200]; window hard end at 180 rejects.
    const result = proposeScheduleConflictResolve({
      blocks: [a, b],
      window: { startAtMs: 0, endAtMs: 180, hardEnd: true }
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('hard_end_violation')
  })

  it('allows shift when hardEnd false even past window end', () => {
    const a = focus({ id: 'a', startAtMs: 0, endAtMs: 100 })
    const b = focus({ id: 'b', startAtMs: 50, endAtMs: 150 })
    const result = proposeScheduleConflictResolve({
      blocks: [a, b],
      window: { startAtMs: 0, endAtMs: 180, hardEnd: false }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.moves[0].to.endAtMs).toBe(200)
  })

  it('returns no_conflicts when already clear (idempotent fail-closed)', () => {
    const a = focus({ id: 'a', startAtMs: 0, endAtMs: 100 })
    const b = focus({ id: 'b', startAtMs: 100, endAtMs: 200 })
    const result = proposeScheduleConflictResolve({ blocks: [a, b] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('no_conflicts')
  })

  it('preserves duration and never invents zero-length intervals', () => {
    const a = focus({ id: 'a', startAtMs: 10, endAtMs: 70 })
    const b = focus({ id: 'b', startAtMs: 40, endAtMs: 130 })
    const result = proposeScheduleConflictResolve({ blocks: [a, b] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const move of result.moves) {
      const fromDur = move.from.endAtMs - move.from.startAtMs
      const toDur = move.to.endAtMs - move.to.startAtMs
      expect(toDur).toBe(fromDur)
      expect(toDur).toBeGreaterThan(0)
    }
  })

  it('shift_earlier_unlocked moves earlier peer before later start', () => {
    const a = focus({ id: 'a', startAtMs: 0, endAtMs: 100 })
    const b = focus({ id: 'b', startAtMs: 50, endAtMs: 150 })
    const result = proposeScheduleConflictResolve({
      blocks: [a, b],
      policy: 'shift_earlier_unlocked'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.moves[0].blockId).toBe('a')
    expect(result.moves[0].to).toEqual({ startAtMs: -50, endAtMs: 50 })
    expect(result.remainingConflicts).toHaveLength(0)
  })
})
