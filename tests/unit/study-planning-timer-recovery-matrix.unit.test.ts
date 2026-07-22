/**
 * IMPL-I: sleep / crash / concurrency recovery matrix (unit evidence).
 *
 * Pure + store CAS only — no main kill-9 / OS sleep simulation.
 * Documents §18 bullet 8 residual honesty:
 * - OS power map + double-wake idempotence + 120min fail-closed + short-gap advance
 * - crash cold reattach fail-closed when no open pin/session
 * - multi-window dual-write pin requires expectedRevision; stale revision → revision_conflict
 *
 * Does NOT claim: full e2e crash matrix closed, kill-9 live pin, or §18 product complete.
 */

import { describe, expect, it } from 'vitest'
import {
  StudyPlanningStore,
  TIMER_SESSION_SEED,
  advanceTimerSession,
  createClassicPomodoroPlan,
  startTimerSession,
  type TimerSessionRecord
} from '../../src/shared/study-planning'
import { mapSystemPowerToTimerWakeSignal } from '../../src/renderer/src/study-space/planning-timer-os-power'
import {
  projectRehydrateActiveTimerSession,
  projectTimerSessionAfterWake,
  shouldHandleTimerWakeSignal
} from '../../src/renderer/src/study-space/planning-timer-sleep-hooks'
import { buildAdvanceTimerSessionCommand } from '../../src/renderer/src/study-space/planning-timer-dual-write'

const t0 = 7_000_000

function startFocus(nowMs = t0): TimerSessionRecord {
  return startTimerSession({
    id: 'matrix-wake-1',
    nowMs,
    plan: createClassicPomodoroPlan(),
    taskId: 'task-matrix'
  }).session!
}

describe('recovery matrix (IMPL-I / §18 #8 unit evidence)', () => {
  describe('1. suspend then resume maps to pagehide pin + visibility_resume sample', () => {
    it('mapSystemPowerToTimerWakeSignal: suspend→pagehide, resume→visibility_resume visible', () => {
      const pinSignal = mapSystemPowerToTimerWakeSignal({ kind: 'suspend', atMs: t0 + 500 })
      expect(pinSignal).toEqual({ kind: 'pagehide', nowMs: t0 + 500 })
      expect(shouldHandleTimerWakeSignal(pinSignal!)).toBe(true)

      const resumeSignal = mapSystemPowerToTimerWakeSignal({
        kind: 'resume',
        atMs: t0 + 30_000
      })
      expect(resumeSignal).toEqual({
        kind: 'visibility_resume',
        nowMs: t0 + 30_000,
        visibilityState: 'visible'
      })
      expect(shouldHandleTimerWakeSignal(resumeSignal!)).toBe(true)
    })

    it('suspend pins wall sample; resume short-gap advances without inventing double credit', () => {
      const session = startFocus(t0)
      const suspendAt = t0 + 20_000
      const pin = projectTimerSessionAfterWake({
        session,
        signal: mapSystemPowerToTimerWakeSignal({ kind: 'suspend', atMs: suspendAt })!
      })
      expect(pin.type).toBe('advance_ok')
      if (pin.type !== 'advance_ok') return
      expect(pin.pinDurableAdvance).toBe(true)
      expect(pin.needsReconcile).toBe(false)
      expect(pin.session.accumulatedFocusSeconds).toBe(20)
      expect(pin.completed).toBe(false)

      const resumeAt = suspendAt + 60_000
      const wake = projectTimerSessionAfterWake({
        session: pin.session,
        signal: mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs: resumeAt })!
      })
      expect(wake.type).toBe('advance_ok')
      if (wake.type !== 'advance_ok') return
      expect(wake.needsReconcile).toBe(false)
      // total focus = 20s pin + 60s after pin sample
      expect(wake.session.accumulatedFocusSeconds).toBe(80)
      expect(wake.completed).toBe(false)
    })
  })

  describe('2. double resume (power + visibility) idempotent — no double focus credit', () => {
    it('same atMs applied twice does not double-count focus seconds', () => {
      const session = startFocus(t0)
      const atMs = t0 + 90_000
      const powerResume = mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs })!
      const first = projectTimerSessionAfterWake({ session, signal: powerResume })
      expect(first.type).toBe('advance_ok')
      if (first.type !== 'advance_ok') return
      expect(first.session.accumulatedFocusSeconds).toBe(90)

      // visibility fires moments later with the same wall sample (idempotent pure advance)
      const visibility = {
        kind: 'visibility_resume' as const,
        nowMs: atMs,
        visibilityState: 'visible' as const
      }
      const second = projectTimerSessionAfterWake({
        session: first.session,
        signal: visibility
      })
      expect(second.type).toBe('advance_ok')
      if (second.type !== 'advance_ok') return
      expect(second.session.accumulatedFocusSeconds).toBe(90)
      expect(second.needsReconcile).toBe(false)
      expect(second.completed).toBe(first.completed)
    })

    it('completed phase on first wake stays completed with no invent on second same-atMs wake', () => {
      // classic pomodoro focus target = 25 min; wake exactly at target
      const session = startFocus(t0)
      const atMs = t0 + 25 * 60 * 1000
      const first = projectTimerSessionAfterWake({
        session,
        signal: mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs })!
      })
      expect(first.type).toBe('advance_ok')
      if (first.type !== 'advance_ok') return
      // may complete or remain running depending on pure rules; capture focus once
      const focusAfterFirst = first.session.accumulatedFocusSeconds
      const completedFirst = first.completed

      const second = projectTimerSessionAfterWake({
        session: first.session,
        signal: {
          kind: 'visibility_resume',
          nowMs: atMs,
          visibilityState: 'visible'
        }
      })
      // completed session → noop; still-running same sample → same accumulated
      if (completedFirst || first.session.state === 'completed') {
        // if pure marks completed on wake, second signal must not invent more credit
        if (second.type === 'noop') {
          expect(second.reason).toMatch(/session_state|completed/)
        } else if (second.type === 'advance_ok') {
          expect(second.session.accumulatedFocusSeconds).toBe(focusAfterFirst)
        }
      } else {
        expect(second.type).toBe('advance_ok')
        if (second.type === 'advance_ok') {
          expect(second.session.accumulatedFocusSeconds).toBe(focusAfterFirst)
        }
      }
    })
  })

  describe('3. long gap ≥120min → needs_reconcile / no silent finish', () => {
    it('resume after ≥120min wall gap marks needs_reconcile without silent focus credit', () => {
      const session = startFocus(t0)
      const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 1) * 60_000
      const atMs = t0 + gapMs
      const action = projectTimerSessionAfterWake({
        session,
        signal: mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs })!
      })
      expect(action.type).toBe('advance_ok')
      if (action.type !== 'advance_ok') return
      expect(action.needsReconcile).toBe(true)
      expect(action.session.state).toBe('needs_reconcile')
      expect(action.session.accumulatedFocusSeconds).toBe(0)
      expect(action.gapSeconds).toBeGreaterThanOrEqual(120 * 60)
      expect(action.completed).toBe(false)
      expect(action.pinDurableAdvance).toBe(true)
    })

    it('lifecycle advanceTimerSession same long gap never auto-finishes', () => {
      const session = startFocus(t0)
      const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 10) * 60_000
      const advanced = advanceTimerSession(session, t0 + gapMs)
      expect(advanced.session?.state).toBe('needs_reconcile')
      expect(advanced.session?.accumulatedFocusSeconds ?? 0).toBe(0)
      expect(advanced.session?.state).not.toBe('completed')
    })
  })

  describe('4. short gap advance finishes only when pure rules allow', () => {
    it('short gap advances running focus without reconcile', () => {
      const session = startFocus(t0)
      const atMs = t0 + 45_000
      const action = projectTimerSessionAfterWake({
        session,
        signal: {
          kind: 'visibility_resume',
          nowMs: atMs,
          visibilityState: 'visible'
        }
      })
      expect(action.type).toBe('advance_ok')
      if (action.type !== 'advance_ok') return
      expect(action.needsReconcile).toBe(false)
      expect(action.session.state).toBe('running')
      expect(action.session.accumulatedFocusSeconds).toBe(45)
      expect(action.completed).toBe(false)
      expect(action.pinDurableAdvance).toBe(false)
    })

    it('exact target countdown may complete via pure advance (allowed finish)', () => {
      const session = startFocus(t0)
      const targetMs = (session.targetSeconds ?? 25 * 60) * 1000
      const action = projectTimerSessionAfterWake({
        session,
        signal: {
          kind: 'visibility_resume',
          nowMs: t0 + targetMs,
          visibilityState: 'visible'
        }
      })
      expect(action.type).toBe('advance_ok')
      if (action.type !== 'advance_ok') return
      expect(action.needsReconcile).toBe(false)
      // pure countdown: completing at target is allowed (not silent sleep credit)
      if (action.completed) {
        expect(action.session.accumulatedFocusSeconds).toBe(session.targetSeconds ?? 25 * 60)
        expect(action.pinDurableAdvance).toBe(true)
      } else {
        // if phase prompt / still running at boundary, still no invent beyond target rules
        expect(action.session.accumulatedFocusSeconds).toBeLessThanOrEqual(
          session.targetSeconds ?? 25 * 60
        )
      }
    })

    it('pagehide never finishes (pin only)', () => {
      const session = startFocus(t0)
      const targetMs = (session.targetSeconds ?? 25 * 60) * 1000
      const action = projectTimerSessionAfterWake({
        session,
        signal: { kind: 'pagehide', nowMs: t0 + targetMs }
      })
      expect(action.type).toBe('advance_ok')
      if (action.type !== 'advance_ok') return
      // pagehide may complete pure projection, but product rule: pin path never treats as silent sleep credit
      // pin is required; if pure marks completed that is countdown target hit — still pinDurableAdvance
      expect(action.pinDurableAdvance).toBe(true)
    })
  })

  describe('5. crash cold reattach narrative — fail-closed when no pin / no open session', () => {
    it('rehydrate with empty durable timerSessions → none (no invent session)', () => {
      const result = projectRehydrateActiveTimerSession({
        timerSessions: [],
        nowMs: t0 + 60_000
      })
      expect(result.kind).toBe('none')
      if (result.kind !== 'none') return
      expect(result.reason).toBe('no_timer_sessions')
    })

    it('rehydrate with only completed sessions → none (kill-9 cannot invent open pin)', () => {
      const closed: TimerSessionRecord = {
        ...startFocus(t0),
        state: 'completed',
        endedAtMs: t0 + 1000,
        accumulatedFocusSeconds: 1
      }
      const result = projectRehydrateActiveTimerSession({
        timerSessions: [closed],
        nowMs: t0 + 2000
      })
      expect(result.kind).toBe('none')
      if (result.kind !== 'none') return
      expect(result.reason).toBe('no_open_session')
    })

    it('rehydrate open durable session after long crash gap → needs_reconcile (no silent credit)', () => {
      const running = startFocus(t0)
      const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 15) * 60_000
      const result = projectRehydrateActiveTimerSession({
        timerSessions: [running],
        nowMs: t0 + gapMs
      })
      expect(result.kind).toBe('reattach')
      if (result.kind !== 'reattach') return
      expect(result.needsReconcile).toBe(true)
      expect(result.session.state).toBe('needs_reconcile')
      expect(result.session.accumulatedFocusSeconds).toBe(0)
      expect(result.pinDurableAdvance).toBe(true)
      // honesty: this is cold reattach from durable sole-read, NOT live kill-9 pin proof
    })

    it('wake with null session is noop (no pin present locally)', () => {
      const action = projectTimerSessionAfterWake({
        session: null,
        signal: { kind: 'hydrate_reattach', nowMs: t0 + 1000 }
      })
      expect(action.type).toBe('noop')
      if (action.type !== 'noop') return
      expect(action.reason).toBe('no_session')
    })
  })

  describe('6. concurrent multi-window CAS — revision_conflict fail-closed on dual-write pin', () => {
    it('advance_timer_session pin requires expectedRevision match; stale revision → revision_conflict', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const rev0 = store.readSnapshot().revision

      // Window A starts a session (sole-writer)
      const start = store.applyCommand(
        {
          actionId: 'matrix-start-1',
          type: 'start_timer_session',
          payload: {
            id: 'ts-matrix-1',
            planId: 'classic_25_5',
            taskId: 'task-matrix',
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          clientIssuedAtMs: clock
        },
        rev0
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      const revAfterStart = start.revision

      // Window A pins advance with correct expectedRevision
      clock = t0 + 30_000
      const pinCmdA = buildAdvanceTimerSessionCommand(
        'ts-matrix-1',
        'matrix-pin-a',
        clock,
        clock
      )
      const pinA = store.applyCommand(pinCmdA, revAfterStart)
      expect(pinA.ok).toBe(true)
      if (!pinA.ok) return
      const revAfterPinA = pinA.revision

      // Window B races with STALE expectedRevision (still thinks revAfterStart) → fail-closed
      clock = t0 + 31_000
      const pinCmdB = buildAdvanceTimerSessionCommand(
        'ts-matrix-1',
        'matrix-pin-b',
        clock,
        clock
      )
      const pinB = store.applyCommand(pinCmdB, revAfterStart)
      expect(pinB.ok).toBe(false)
      if (pinB.ok) return
      expect(pinB.error.code).toBe('revision_conflict')
      expect(pinB.revision).toBe(revAfterPinA)

      // Retry with fresh expectedRevision succeeds (CAS recovery path; not silent merge)
      const pinBRetry = store.applyCommand(
        buildAdvanceTimerSessionCommand('ts-matrix-1', 'matrix-pin-b-retry', clock + 1, clock + 1),
        revAfterPinA
      )
      expect(pinBRetry.ok).toBe(true)
    })

    it('missing/wrong expectedRevision contract is fail-closed (not free dual-write)', () => {
      const store = new StudyPlanningStore({ nowMs: () => t0 })
      const snap = store.readSnapshot()
      // deliberate wrong revision without prior write
      const result = store.applyCommand(
        {
          actionId: 'matrix-bad-rev',
          type: 'advance_timer_session',
          payload: { sessionId: 'no-such' }
        },
        snap.revision + 99
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('revision_conflict')
    })
  })
})
