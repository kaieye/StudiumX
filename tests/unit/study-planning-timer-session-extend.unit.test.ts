/**
 * STC-205 pure extend target (countdown only; planSnapshot frozen).
 */

import { describe, expect, it } from 'vitest'
import {
  computeExtendedBreakTargetSeconds,
  createClassicPomodoroPlan,
  defaultMaxTargetSecondsForPhase,
  extendTimerSessionTarget,
  resolveExtendAddSeconds,
  startTimerSession,
  TIMER_PLAN_SEED_DEFAULTS
} from '../../src/shared/study-planning'

function runningBreak(overrides: Record<string, unknown> = {}) {
  const plan = createClassicPomodoroPlan({ shortBreakMinutes: 5 })
  const started = startTimerSession({
    id: 'b1',
    nowMs: 10_000,
    plan,
    phase: 'short_break',
    targetSeconds: 5 * 60
  }).session!
  return { ...started, ...overrides }
}

describe('extendTimerSessionTarget (STC-205)', () => {
  it('resolveExtendAddSeconds prefers addSeconds and floors', () => {
    expect(resolveExtendAddSeconds({ addSeconds: 90.9 })).toBe(90)
    expect(resolveExtendAddSeconds({ addMinutes: 1.5 })).toBe(90)
    expect(resolveExtendAddSeconds({ addSeconds: 0 })).toBeNull()
    expect(resolveExtendAddSeconds({})).toBeNull()
  })

  it('extends running countdown break target without rewriting planSnapshot', () => {
    const session = runningBreak()
    const planRef = session.planSnapshot
    const result = extendTimerSessionTarget({
      session,
      nowMs: 10_000 + 30_000,
      addMinutes: 1
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.previousTargetSeconds).toBe(300)
    expect(result.nextTargetSeconds).toBe(360)
    expect(result.addedSeconds).toBe(60)
    expect(result.session.targetSeconds).toBe(360)
    expect(result.session.planSnapshot).toBe(planRef)
    expect(result.session.state).toBe('running')
    // wall advanced ~30s of active
    expect(result.session.accumulatedActiveSeconds).toBeGreaterThanOrEqual(30)
  })

  it('extends paused session without inventing active time', () => {
    const session = runningBreak({ state: 'paused', accumulatedActiveSeconds: 40 })
    const result = extendTimerSessionTarget({
      session,
      nowMs: 99_000,
      addSeconds: 120
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextTargetSeconds).toBe(420)
    expect(result.session.accumulatedActiveSeconds).toBe(40)
    expect(result.session.state).toBe('paused')
  })

  it('clamps to short-break max (45 min seed)', () => {
    const maxSec = defaultMaxTargetSecondsForPhase('short_break')
    expect(maxSec).toBe(TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMax * 60)
    const session = runningBreak({ targetSeconds: maxSec - 30 })
    const result = extendTimerSessionTarget({
      session,
      nowMs: 10_000,
      addMinutes: 5
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextTargetSeconds).toBe(maxSec)
    expect(result.addedSeconds).toBe(30)
  })

  it('fails closed on completed / needs_reconcile / countup / open target', () => {
    const completed = runningBreak({ state: 'completed', endedAtMs: 1 })
    expect(extendTimerSessionTarget({ session: completed, nowMs: 1, addMinutes: 1 }).ok).toBe(false)

    const recon = runningBreak({ state: 'needs_reconcile', pendingReconcileSeconds: 999 })
    expect(extendTimerSessionTarget({ session: recon, nowMs: 1, addMinutes: 1 }).ok).toBe(false)

    const countup = runningBreak({ clockMode: 'countup', targetSeconds: 300 })
    expect(extendTimerSessionTarget({ session: countup, nowMs: 1, addMinutes: 1 }).ok).toBe(false)

    const open = runningBreak({ targetSeconds: null })
    expect(extendTimerSessionTarget({ session: open as never, nowMs: 1, addMinutes: 1 }).ok).toBe(
      false
    )
  })

  it('computeExtendedBreakTargetSeconds adds minutes and clamps', () => {
    expect(
      computeExtendedBreakTargetSeconds({
        baseMinutes: 5,
        extendMinutes: 1,
        phase: 'short_break'
      })
    ).toBe(6 * 60)
    expect(
      computeExtendedBreakTargetSeconds({
        baseMinutes: 40,
        extendMinutes: 10,
        phase: 'short_break'
      })
    ).toBe(45 * 60)
    expect(
      computeExtendedBreakTargetSeconds({
        baseMinutes: 15,
        extendMinutes: 5,
        phase: 'long_break'
      })
    ).toBe(20 * 60)
  })
})
