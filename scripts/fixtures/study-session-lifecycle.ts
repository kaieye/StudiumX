import assert from 'node:assert/strict'

import type { StudySessionFact } from '../../src/shared/teaching-types/analytics'
import { StudySessionLifecycle } from '../../src/renderer/src/study-space/session/study-session-lifecycle'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'
import { resetStudyTimer, switchStudyTimerMode } from '../../src/renderer/src/study-space/session/transitions'

function snapshot(overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    clientId: 'study-client',
    nickname: 'Learner',
    spaceCode: 'PUBLIC',
    presenceRelayUrl: 'wss://broker.emqx.io:8084/mqtt',
    signalId: 'reading',
    modeId: 'free',
    contractText: 'Read chapter',
    contractLocked: true,
    ambientEnabled: true,
    ambientVolume: 0.5,
    roomId: 'silent',
    seatIndex: 0,
    seatClaimedAt: 1,
    timerMode: 'focus',
    timerState: 'idle',
    focusMinutes: 1,
    breakMinutes: 1,
    remainingSeconds: 60,
    todayFocusSeconds: 0,
    todaySessions: 0,
    totalFocusSeconds: 0,
    totalSessions: 0,
    streakDays: 0,
    xp: 0,
    lastStudyDate: '',
    tasks: [{ id: 'task-1', title: 'Read chapter', done: false }],
    ...overrides
  }
}

function clock(start = 0) {
  let now = start
  let sequence = 0
  const lifecycle = new StudySessionLifecycle({
    sample: () => ({ wallMs: now, monotonicMs: now }),
    timeZone: () => 'UTC',
    createFactId: (prefix) => `${prefix}-${sequence++}`
  })
  return { lifecycle, set: (next: number) => { now = next } }
}

function analyticsFacts(result: { intents: Array<{ kind: string; facts?: unknown[] }> }): StudySessionFact[] {
  return result.intents
    .filter((intent): intent is { kind: 'analytics'; facts: StudySessionFact[] } => intent.kind === 'analytics')
    .flatMap((intent) => intent.facts)
    .filter((fact): fact is StudySessionFact => fact.factKind === 'study_session')
}

// Idle -> running creates an active lifecycle and keeps the public timer transition semantics.
{
  const { lifecycle } = clock()
  const started = lifecycle.toggle(snapshot(), { taskId: 'task-1', workspaceId: 'workspace-1', activeModeName: 'Free study' })
  assert.equal(started.snapshot.timerState, 'running')
  assert.equal(started.intents.filter((intent) => intent.kind === 'presence').length, 1)
}

// Reliable sampling advances by elapsed time, not interval count.
{
  const { lifecycle, set } = clock()
  let current = lifecycle.toggle(snapshot(), { activeModeName: 'Free study' }).snapshot
  set(2_500)
  const advanced = lifecycle.advance(current)
  current = advanced.snapshot
  assert.equal(current.remainingSeconds, 58)
  assert.equal(current.todayFocusSeconds, 2)
  assert.equal(current.totalFocusSeconds, 2)
}

// A persisted running timer without in-memory state becomes a legacy, unattributed session.
{
  const { lifecycle, set } = clock()
  let current = snapshot({ timerState: 'running', remainingSeconds: 1 })
  lifecycle.recover(current)
  set(1_000)
  const complete = lifecycle.advance(current)
  const fact = analyticsFacts(complete)[0]!
  assert.equal(complete.completed, true)
  assert.deepEqual(fact.taskAttribution, { kind: 'unattributed', reason: 'legacy_session' })
}

// Explicit task/workspace attribution survives through the terminal analytics fact.
{
  const { lifecycle, set } = clock()
  let current = lifecycle.toggle(snapshot({ remainingSeconds: 1 }), {
    taskId: 'task-1', workspaceId: 'workspace-1', activeModeName: 'Free study'
  }).snapshot
  set(1_000)
  const complete = lifecycle.advance(current)
  const fact = analyticsFacts(complete)[0]!
  assert.deepEqual(fact.taskAttribution, {
    kind: 'explicit', capturedAt: 'session_start', taskId: 'task-1', taskTitleSnapshot: 'Read chapter', workspaceId: 'workspace-1'
  })
}

// Pause excludes wall-clock time until resume.
{
  const { lifecycle, set } = clock()
  let current = lifecycle.toggle(snapshot(), { activeModeName: 'Free study' }).snapshot
  set(2_000)
  current = lifecycle.toggle(current, { activeModeName: 'Free study' }).snapshot
  assert.equal(current.timerState, 'paused')
  set(12_000)
  current = lifecycle.toggle(current, { activeModeName: 'Free study' }).snapshot
  set(13_000)
  current = lifecycle.advance(current).snapshot
  assert.equal(current.todayFocusSeconds, 3)
  assert.equal(current.remainingSeconds, 57)
}

// Completion emits durable fact, presence and notification exactly once; later ticks cannot duplicate them.
{
  const { lifecycle, set } = clock()
  let current = lifecycle.toggle(snapshot({ remainingSeconds: 1 }), { activeModeName: 'Free study' }).snapshot
  set(1_000)
  const complete = lifecycle.advance(current)
  current = complete.snapshot
  assert.equal(complete.completed, true)
  assert.equal(analyticsFacts(complete).length, 1)
  assert.equal(complete.intents.filter((intent) => intent.kind === 'presence').length, 1)
  assert.equal(complete.intents.filter((intent) => intent.kind === 'notification').length, 1)
  set(2_000)
  const afterCompletion = lifecycle.advance(current)
  assert.equal(afterCompletion.intents.length, 0)
  assert.equal(afterCompletion.snapshot.totalSessions, 1)
}

// Terminal actions preserve priority: a completion wins over a requested cancel; reset/switch/follow otherwise emit one interruption fact.
{
  const first = clock()
  let current = first.lifecycle.toggle(snapshot({ remainingSeconds: 1 }), { activeModeName: 'Free study' }).snapshot
  first.set(1_000)
  const completedInsteadOfCancel = first.lifecycle.finish(current, 'canceled')
  assert.equal(completedInsteadOfCancel.completed, true)
  assert.equal(analyticsFacts(completedInsteadOfCancel)[0]?.outcome, 'completed')

  const second = clock()
  current = second.lifecycle.toggle(snapshot(), { activeModeName: 'Free study' }).snapshot
  second.set(1_000)
  const canceled = second.lifecycle.finish(current, 'canceled')
  assert.equal(analyticsFacts(canceled)[0]?.outcome, 'canceled')
  const reset = resetStudyTimer({ ...canceled.snapshot, timerState: 'idle' })
  assert.equal(reset.timerState, 'idle')
  assert.equal(reset.remainingSeconds, 60)

  const third = clock()
  current = third.lifecycle.toggle(snapshot(), { activeModeName: 'Free study' }).snapshot
  third.set(1_000)
  const interrupted = third.lifecycle.finish(current, 'interrupted')
  assert.equal(analyticsFacts(interrupted)[0]?.outcome, 'interrupted')
  const switched = switchStudyTimerMode({ ...interrupted.snapshot, timerState: 'idle' }, 'break')
  assert.equal(switched.timerMode, 'break')
  assert.equal(switched.timerState, 'idle')

  const fourth = clock()
  current = fourth.lifecycle.toggle(snapshot(), { activeModeName: 'Free study' }).snapshot
  const followed = fourth.lifecycle.followRoomCycle(current, {
    room: { id: 'silent', name: 'Silent', tone: '', capacity: 1, sessionMinutes: 25, breakMinutes: 5, tags: [], seats: 1, light: '', ambient: '', backdrop: '' },
    phase: 'focus', remainingSeconds: 42, activeModeName: 'Free study'
  })
  assert.equal(analyticsFacts(followed)[0]?.outcome, 'interrupted')
  assert.equal(followed.snapshot.timerState, 'running')
  assert.equal(followed.snapshot.remainingSeconds, 42)
}

// Session fact segments allocate active seconds across midnight by the supplied time zone.
{
  const start = Date.parse('2026-07-14T23:59:59.000Z')
  const { lifecycle, set } = clock(start)
  let current = lifecycle.toggle(snapshot({ remainingSeconds: 3 }), { activeModeName: 'Free study' }).snapshot
  set(start + 3_000)
  const complete = lifecycle.advance(current)
  const dates = analyticsFacts(complete)[0]!.daySegments.map((segment) => segment.localDate)
  assert.deepEqual(dates, ['2026-07-14', '2026-07-15'])
}

console.log('study session lifecycle ok')