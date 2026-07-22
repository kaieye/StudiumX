/**
 * IMPL-Q: sleep / crash / concurrent recovery product-path matrix (unit evidence).
 *
 * Composes real recovery helpers end-to-end (power map → wake project → durable
 * store CAS advance / rehydrate / reconcile) — not isolated pure slices alone.
 *
 * Coverage (brief must-implement):
 * 1. Suspend/resume signal → STC-206 wake: no double-count of pre-pin wall as focus.
 * 2. Crash mid-focus proxy: cold rehydrate prefers durable TimerSession; no dup segments.
 * 3. Kill-9 proxy: abrupt stop without clean flush → last durable pin only; fail-closed.
 * 4. Multi-window thrash proxy: expectedRevision CAS; loser does not clobber winner.
 * 5. Retry idempotency: repeated wake / same actionId does not double-apply elapsed.
 *
 * Honesty: this is **e2e-proxy** (in-process product path). Real Electron kill-9 /
 * multi-process thrash Playwright remains open — see roadmap residual #8.
 * Does NOT claim §18 product complete.
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
  projectTimerSessionAfterWake
} from '../../src/renderer/src/study-space/planning-timer-sleep-hooks'
import {
  buildAdvanceTimerSessionCommand,
  buildReconcileStaleSessionCommand,
  buildStartTimerSessionCommand
} from '../../src/renderer/src/study-space/planning-timer-dual-write'

const t0 = 9_000_000
const SESSION_ID = 'pp-ts-1'
const TASK_ID = 'task-pp'

function startLocalFocus(nowMs = t0, id = SESSION_ID): TimerSessionRecord {
  return startTimerSession({
    id,
    nowMs,
    plan: createClassicPomodoroPlan(),
    taskId: TASK_ID
  }).session!
}

/**
 * Product-path helper: map OS power → wake project → optional durable advance pin.
 * Mirrors useStudySession handleTimerWakeSignal → dualWriteAdvance path (in-process).
 */
function productWakeAndMaybePin(input: {
  store: StudyPlanningStore
  session: TimerSessionRecord
  power: { kind: 'suspend' | 'resume'; atMs: number }
  expectedRevision: number
  actionId: string
}): {
  wake: ReturnType<typeof projectTimerSessionAfterWake>
  pinResult: ReturnType<StudyPlanningStore['applyCommand']> | null
  session: TimerSessionRecord
  revision: number
} {
  const signal = mapSystemPowerToTimerWakeSignal(input.power)!
  const wake = projectTimerSessionAfterWake({
    session: input.session,
    signal
  })
  if (wake.type !== 'advance_ok') {
    return {
      wake,
      pinResult: null,
      session: input.session,
      revision: input.expectedRevision
    }
  }

  let pinResult: ReturnType<StudyPlanningStore['applyCommand']> | null = null
  let revision = input.expectedRevision
  let durableSession = wake.session

  if (wake.pinDurableAdvance) {
    pinResult = input.store.applyCommand(
      buildAdvanceTimerSessionCommand(
        wake.session.id,
        input.actionId,
        input.power.atMs,
        input.power.atMs
      ),
      input.expectedRevision
    )
    if (pinResult.ok) {
      revision = pinResult.revision
      const fromStore = pinResult.snapshot.timerSessions.find((s) => s.id === wake.session.id)
      if (fromStore) durableSession = fromStore
    }
  }

  return { wake, pinResult, session: durableSession, revision }
}

describe('recovery product-path matrix (IMPL-Q / §18 #8 e2e-proxy)', () => {
  describe('1. suspend/resume signal — no double-count of suspended pre-pin wall', () => {
    it('teach:system-power suspend→resume pins once then advances only post-pin delta', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-start-1',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      let rev = start.revision
      let session = start.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(session.accumulatedFocusSeconds).toBe(0)
      expect(session.lastSampleWallMs).toBe(t0)

      // OS suspend after 30s focus — maps to pagehide pin (STC-206)
      clock = t0 + 30_000
      const suspend = productWakeAndMaybePin({
        store,
        session,
        power: { kind: 'suspend', atMs: clock },
        expectedRevision: rev,
        actionId: 'pp-suspend-pin'
      })
      expect(suspend.wake.type).toBe('advance_ok')
      if (suspend.wake.type !== 'advance_ok') return
      expect(suspend.wake.pinDurableAdvance).toBe(true)
      expect(suspend.wake.session.accumulatedFocusSeconds).toBe(30)
      expect(suspend.pinResult?.ok).toBe(true)
      if (!suspend.pinResult?.ok) return
      rev = suspend.revision
      session = suspend.session
      // Durable pin owns lastSampleWallMs at suspend wall — critical for no double-count
      expect(session.lastSampleWallMs).toBe(t0 + 30_000)
      expect(session.accumulatedFocusSeconds).toBe(30)

      // OS resume after 45s wall (short gap) — maps to visibility_resume sample
      clock = t0 + 30_000 + 45_000
      const resume = productWakeAndMaybePin({
        store,
        session,
        power: { kind: 'resume', atMs: clock },
        expectedRevision: rev,
        actionId: 'pp-resume-advance'
      })
      expect(resume.wake.type).toBe('advance_ok')
      if (resume.wake.type !== 'advance_ok') return
      expect(resume.wake.needsReconcile).toBe(false)
      // 30s (pre-suspend pin) + 45s (post-pin only) = 75 — NOT 30+30+45 double-count
      expect(resume.wake.session.accumulatedFocusSeconds).toBe(75)
      expect(resume.wake.session.lastSampleWallMs).toBe(clock)
    })

    it('long suspend gap ≥120min → needs_reconcile without inventing focus minutes', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-start-long',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      let rev = start.revision
      let session = start.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!

      clock = t0 + 10_000
      const pin = productWakeAndMaybePin({
        store,
        session,
        power: { kind: 'suspend', atMs: clock },
        expectedRevision: rev,
        actionId: 'pp-long-suspend'
      })
      expect(pin.pinResult?.ok).toBe(true)
      if (!pin.pinResult?.ok) return
      rev = pin.revision
      session = pin.session
      expect(session.accumulatedFocusSeconds).toBe(10)

      const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 5) * 60_000
      clock = session.lastSampleWallMs + gapMs
      const resume = productWakeAndMaybePin({
        store,
        session,
        power: { kind: 'resume', atMs: clock },
        expectedRevision: rev,
        actionId: 'pp-long-resume'
      })
      expect(resume.wake.type).toBe('advance_ok')
      if (resume.wake.type !== 'advance_ok') return
      expect(resume.wake.needsReconcile).toBe(true)
      expect(resume.wake.session.state).toBe('needs_reconcile')
      // focus frozen at last pin — no silent credit of multi-hour suspend
      expect(resume.wake.session.accumulatedFocusSeconds).toBe(10)
      expect(resume.wake.completed).toBe(false)
      expect(resume.pinResult?.ok).toBe(true)
      if (!resume.pinResult?.ok) return
      const durable = resume.pinResult.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(durable.state).toBe('needs_reconcile')
      expect(durable.accumulatedFocusSeconds).toBe(10)
    })
  })

  describe('2. crash mid-focus — rehydrate prefers durable TimerSession; no dup segments', () => {
    it('after crash proxy, cold reattach advances from durable pin only once', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-crash-start',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      let rev = start.revision

      // Mid-focus pin at +2min (last durable before "crash")
      clock = t0 + 120_000
      const pin = store.applyCommand(
        buildAdvanceTimerSessionCommand(SESSION_ID, 'pp-crash-pin', clock, clock),
        rev
      )
      expect(pin.ok).toBe(true)
      if (!pin.ok) return
      rev = pin.revision
      const durableBeforeCrash = pin.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(durableBeforeCrash.accumulatedFocusSeconds).toBe(120)
      expect(durableBeforeCrash.state).toBe('running')

      // Crash proxy: local UI session dropped; only durable sole-read survives
      const localSessionAfterCrash: TimerSessionRecord | null = null
      const restartNow = t0 + 180_000 // +1min after last pin (short gap)
      const rehydrate = projectRehydrateActiveTimerSession({
        timerSessions: store.readSnapshot().timerSessions,
        nowMs: restartNow,
        localSession: localSessionAfterCrash
      })
      expect(rehydrate.kind).toBe('reattach')
      if (rehydrate.kind !== 'reattach') return
      expect(rehydrate.needsReconcile).toBe(false)
      // 120s durable + 60s post-crash gap only — not 120+120 or invent
      expect(rehydrate.session.accumulatedFocusSeconds).toBe(180)
      expect(rehydrate.session.id).toBe(SESSION_ID)

      // Publish reattach pin once
      if (rehydrate.pinDurableAdvance) {
        const rePin = store.applyCommand(
          buildAdvanceTimerSessionCommand(
            SESSION_ID,
            'pp-crash-reattach-pin',
            restartNow,
            restartNow
          ),
          rev
        )
        expect(rePin.ok).toBe(true)
        if (!rePin.ok) return
        rev = rePin.revision
        const afterPin = rePin.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
        expect(afterPin.accumulatedFocusSeconds).toBe(180)

        // Second rehydrate with same durable should not invent another segment
        const again = projectRehydrateActiveTimerSession({
          timerSessions: rePin.snapshot.timerSessions,
          nowMs: restartNow,
          localSession: null
        })
        expect(again.kind).toBe('reattach')
        if (again.kind !== 'reattach') return
        expect(again.session.accumulatedFocusSeconds).toBe(180)
      }
    })

    it('reconcile sheet path after long crash gap does not duplicate duration on confirm', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-recon-start',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      let rev = start.revision

      clock = t0 + 60_000
      const pin = store.applyCommand(
        buildAdvanceTimerSessionCommand(SESSION_ID, 'pp-recon-pin', clock, clock),
        rev
      )
      expect(pin.ok).toBe(true)
      if (!pin.ok) return
      rev = pin.revision

      // Crash for 3h → cold reattach needs_reconcile
      const gapMs = 3 * 60 * 60 * 1000
      clock = t0 + 60_000 + gapMs
      const rehydrate = projectRehydrateActiveTimerSession({
        timerSessions: store.readSnapshot().timerSessions,
        nowMs: clock
      })
      expect(rehydrate.kind).toBe('reattach')
      if (rehydrate.kind !== 'reattach') return
      expect(rehydrate.needsReconcile).toBe(true)
      expect(rehydrate.session.accumulatedFocusSeconds).toBe(60)

      const pinGap = store.applyCommand(
        buildAdvanceTimerSessionCommand(SESSION_ID, 'pp-recon-gap-pin', clock, clock),
        rev
      )
      expect(pinGap.ok).toBe(true)
      if (!pinGap.ok) return
      rev = pinGap.revision
      expect(pinGap.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!.state).toBe(
        'needs_reconcile'
      )

      // User discard_gap — focus stays at pre-gap pin only
      const discard = store.applyCommand(
        buildReconcileStaleSessionCommand(SESSION_ID, 'discard_gap', 'pp-recon-discard', clock),
        rev
      )
      expect(discard.ok).toBe(true)
      if (!discard.ok) return
      const after = discard.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(after.state).toBe('running')
      expect(after.accumulatedFocusSeconds).toBe(60)
      // lastSampleWallMs jumped to decision time — no invent of 3h gap
      expect(after.lastSampleWallMs).toBe(clock)
    })
  })

  describe('3. kill-9 proxy — last durable pin only; fail-closed invents no minutes', () => {
    it('abrupt stop without clean flush recovers only last dual-write pin', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-k9-start',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      let rev = start.revision

      // Last successful dual-write pin at +40s (simulates pagehide/suspend pin)
      clock = t0 + 40_000
      const lastPin = store.applyCommand(
        buildAdvanceTimerSessionCommand(SESSION_ID, 'pp-k9-last-pin', clock, clock),
        rev
      )
      expect(lastPin.ok).toBe(true)
      if (!lastPin.ok) return
      rev = lastPin.revision
      const pinned = lastPin.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(pinned.accumulatedFocusSeconds).toBe(40)

      // Local ticks after pin were never dual-written (kill-9 before flush)
      // Product path: pure local may show higher, but recovery sole-reads durable
      const unsyncedLocal = advanceTimerSession(pinned, t0 + 95_000).session!
      expect(unsyncedLocal.accumulatedFocusSeconds).toBe(95)
      // Durable still 40 — kill-9 lost the unsynced local sample
      expect(
        store.readSnapshot().timerSessions.find((s) => s.id === SESSION_ID)!.accumulatedFocusSeconds
      ).toBe(40)

      // Cold start after kill-9: rehydrate from durable only (fail-closed)
      const restartAt = t0 + 200_000 // short gap after last pin wall sample
      const rehydrate = projectRehydrateActiveTimerSession({
        timerSessions: store.readSnapshot().timerSessions,
        nowMs: restartAt
      })
      expect(rehydrate.kind).toBe('reattach')
      if (rehydrate.kind !== 'reattach') return
      // Advances from durable lastSample (t0+40s) → restartAt; does NOT invent 95s local
      const expectedFocus = Math.floor((restartAt - (t0 + 40_000)) / 1000) + 40
      expect(rehydrate.session.accumulatedFocusSeconds).toBe(expectedFocus)
      // Unsynced local (95s) was never durable — recovery must not start from it
      expect(rehydrate.session.accumulatedFocusSeconds).not.toBe(95)
      // Base is last pin (40), not the lost local (95)
      expect(expectedFocus).toBe(40 + Math.floor((restartAt - (t0 + 40_000)) / 1000))
    })

    it('kill-9 with no durable open session invents nothing', () => {
      const result = projectRehydrateActiveTimerSession({
        timerSessions: [],
        nowMs: t0 + 60_000
      })
      expect(result.kind).toBe('none')
      if (result.kind !== 'none') return
      expect(result.reason).toBe('no_timer_sessions')
    })

    it('kill-9 after only completed durable sessions invents no open focus', () => {
      const closed: TimerSessionRecord = {
        ...startLocalFocus(t0),
        state: 'completed',
        endedAtMs: t0 + 1000,
        accumulatedFocusSeconds: 1,
        lastSampleWallMs: t0 + 1000
      }
      const result = projectRehydrateActiveTimerSession({
        timerSessions: [closed],
        nowMs: t0 + 5000
      })
      expect(result.kind).toBe('none')
      if (result.kind !== 'none') return
      expect(result.reason).toBe('no_open_session')
    })
  })

  describe('4. multi-window thrash proxy — CAS loser does not clobber winner', () => {
    it('two writers same expectedRevision: only one advance lands; loser revision_conflict', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-mw-start',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      const revShared = start.revision

      // Window A and B both sample independently from same revision (thrash)
      clock = t0 + 50_000
      const cmdA = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        'pp-mw-a',
        clock,
        t0 + 50_000
      )
      const cmdB = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        'pp-mw-b',
        clock + 1,
        t0 + 70_000 // B would invent more if it clobbered
      )

      const winA = store.applyCommand(cmdA, revShared)
      expect(winA.ok).toBe(true)
      if (!winA.ok) return
      const winnerFocus = winA.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
        .accumulatedFocusSeconds
      expect(winnerFocus).toBe(50)

      const loseB = store.applyCommand(cmdB, revShared)
      expect(loseB.ok).toBe(false)
      if (loseB.ok) return
      expect(loseB.error.code).toBe('revision_conflict')
      // Winner state intact — B did not clobber to 70s
      const afterLose = store.readSnapshot().timerSessions.find((s) => s.id === SESSION_ID)!
      expect(afterLose.accumulatedFocusSeconds).toBe(50)
      expect(afterLose.lastSampleWallMs).toBe(t0 + 50_000)
      expect(loseB.revision).toBe(winA.revision)

      // B retries with fresh revision (honest CAS recovery, not silent merge)
      clock = t0 + 70_000
      const retryB = store.applyCommand(
        buildAdvanceTimerSessionCommand(SESSION_ID, 'pp-mw-b-retry', clock, clock),
        winA.revision
      )
      expect(retryB.ok).toBe(true)
      if (!retryB.ok) return
      expect(
        retryB.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!.accumulatedFocusSeconds
      ).toBe(70)
    })

    it('interleaved thrash of three advances: serial CAS preserves monotonic focus', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-mw3-start',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      let rev = start.revision
      const samples = [20_000, 40_000, 55_000]
      let applied = 0
      for (let i = 0; i < samples.length; i++) {
        clock = t0 + samples[i]!
        // Stale attempt with rev-1 when i>0 should fail; correct rev succeeds
        if (i > 0) {
          const stale = store.applyCommand(
            buildAdvanceTimerSessionCommand(
              SESSION_ID,
              `pp-mw3-stale-${i}`,
              clock,
              clock
            ),
            rev - 1
          )
          expect(stale.ok).toBe(false)
          if (!stale.ok) expect(stale.error.code).toBe('revision_conflict')
        }
        const ok = store.applyCommand(
          buildAdvanceTimerSessionCommand(SESSION_ID, `pp-mw3-ok-${i}`, clock, clock),
          rev
        )
        expect(ok.ok).toBe(true)
        if (!ok.ok) return
        rev = ok.revision
        applied = samples[i]! / 1000
        expect(
          ok.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!.accumulatedFocusSeconds
        ).toBe(applied)
      }
      expect(applied).toBe(55)
    })
  })

  describe('5. retry idempotency — repeated wake/reconcile does not double-apply', () => {
    it('same wake atMs applied twice does not double focus seconds', () => {
      const session = startLocalFocus(t0)
      const atMs = t0 + 90_000
      const signal = mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs })!
      const first = projectTimerSessionAfterWake({ session, signal })
      expect(first.type).toBe('advance_ok')
      if (first.type !== 'advance_ok') return
      expect(first.session.accumulatedFocusSeconds).toBe(90)

      const second = projectTimerSessionAfterWake({
        session: first.session,
        signal: {
          kind: 'visibility_resume',
          nowMs: atMs,
          visibilityState: 'visible'
        }
      })
      expect(second.type).toBe('advance_ok')
      if (second.type !== 'advance_ok') return
      expect(second.session.accumulatedFocusSeconds).toBe(90)
    })

    it('same actionId advance is replayed; does not re-apply elapsed on store', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-idemp-start',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      let rev = start.revision

      clock = t0 + 30_000
      const cmd = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        'pp-idemp-advance',
        clock,
        clock
      )
      const first = store.applyCommand(cmd, rev)
      expect(first.ok).toBe(true)
      if (!first.ok) return
      rev = first.revision
      expect(
        first.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!.accumulatedFocusSeconds
      ).toBe(30)

      // Retry same actionId (network/client retry) — replayed, no second advance
      clock = t0 + 99_000
      const replay = store.applyCommand(cmd, rev)
      expect(replay.ok).toBe(true)
      if (!replay.ok) return
      expect(replay.replayed).toBe(true)
      expect(
        store.readSnapshot().timerSessions.find((s) => s.id === SESSION_ID)!
          .accumulatedFocusSeconds
      ).toBe(30)
      // revision must not bump on pure replay
      expect(store.readSnapshot().revision).toBe(rev)
    })

    it('needs_reconcile wake re-entry is idempotent (no invent on repeat)', () => {
      const session = startLocalFocus(t0)
      const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 2) * 60_000
      const atMs = t0 + gapMs
      const first = projectTimerSessionAfterWake({
        session,
        signal: mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs })!
      })
      expect(first.type).toBe('advance_ok')
      if (first.type !== 'advance_ok') return
      expect(first.needsReconcile).toBe(true)
      expect(first.session.accumulatedFocusSeconds).toBe(0)
      const gap = first.gapSeconds

      const second = projectTimerSessionAfterWake({
        session: first.session,
        signal: mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs: atMs + 1000 })!
      })
      expect(second.type).toBe('advance_ok')
      if (second.type !== 'advance_ok') return
      expect(second.needsReconcile).toBe(true)
      expect(second.session.accumulatedFocusSeconds).toBe(0)
      // pending gap not re-expanded into focus
      expect(second.session.state).toBe('needs_reconcile')
      expect(second.gapSeconds).toBe(gap)
    })

    it('product-path: discard_gap then repeated resume does not re-credit discarded wall', () => {
      let clock = t0
      const store = new StudyPlanningStore({ nowMs: () => clock })
      const start = store.applyCommand(
        buildStartTimerSessionCommand(
          {
            sessionId: SESSION_ID,
            planId: 'classic_25_5',
            taskId: TASK_ID,
            targetSeconds: 25 * 60,
            phase: 'focus'
          },
          'pp-disc-start',
          clock
        ),
        store.readSnapshot().revision
      )
      expect(start.ok).toBe(true)
      if (!start.ok) return
      let rev = start.revision

      const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 3) * 60_000
      clock = t0 + gapMs
      const pinGap = store.applyCommand(
        buildAdvanceTimerSessionCommand(SESSION_ID, 'pp-disc-gap', clock, clock),
        rev
      )
      expect(pinGap.ok).toBe(true)
      if (!pinGap.ok) return
      rev = pinGap.revision
      expect(
        pinGap.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!.state
      ).toBe('needs_reconcile')

      const discard = store.applyCommand(
        buildReconcileStaleSessionCommand(SESSION_ID, 'discard_gap', 'pp-disc-1', clock),
        rev
      )
      expect(discard.ok).toBe(true)
      if (!discard.ok) return
      rev = discard.revision
      let session = discard.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(session.accumulatedFocusSeconds).toBe(0)
      expect(session.state).toBe('running')

      // Repeated power resume moments later: only new short delta, not the discarded gap
      clock = clock + 15_000
      const resume = productWakeAndMaybePin({
        store,
        session,
        power: { kind: 'resume', atMs: clock },
        expectedRevision: rev,
        actionId: 'pp-disc-resume'
      })
      expect(resume.wake.type).toBe('advance_ok')
      if (resume.wake.type !== 'advance_ok') return
      expect(resume.wake.needsReconcile).toBe(false)
      expect(resume.wake.session.accumulatedFocusSeconds).toBe(15)
    })
  })
})

