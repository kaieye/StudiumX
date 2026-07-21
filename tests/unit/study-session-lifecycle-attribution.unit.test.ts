import { describe, expect, it } from 'vitest'
import { defaultStudySnapshot, studyRooms } from '@renderer/study-space/constants'
import { StudySessionLifecycle } from '@renderer/study-space/session/study-session-lifecycle'
import type { StudySnapshot } from '@renderer/study-space/types'

function createLifecycle(wallMs = Date.parse('2026-07-21T04:00:00.000Z')) {
  let now = wallMs
  return {
    lifecycle: new StudySessionLifecycle({
      sample: () => ({ wallMs: now, monotonicMs: now - wallMs }),
      timeZone: () => 'Asia/Shanghai',
      createFactId: (prefix, at = now) => prefix + '-' + String(at)
    }),
    tick: (ms = 1_000) => {
      now += ms
    }
  }
}

function baseSnapshot(overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    ...defaultStudySnapshot,
    clientId: 'learner-attribution',
    nickname: 'Tester',
    timerMode: 'focus',
    timerState: 'idle',
    remainingSeconds: 60,
    tasks: [
      { id: 'task-alpha', title: 'Alpha reading', done: false, categoryId: 'study' },
      { id: 'task-beta', title: 'Beta drills', done: false, categoryId: 'exercise' }
    ],
    ...overrides
  }
}

function runUntilComplete(
  lifecycle: StudySessionLifecycle,
  snapshot: StudySnapshot,
  tick: (ms?: number) => void,
  options: { taskId?: string | null; workspaceId?: string } = {}
) {
  let current = snapshot
  for (let i = 0; i < 90; i += 1) {
    tick(1_000)
    const advanced = lifecycle.advance(current, options)
    current = advanced.snapshot
    if (advanced.completed) return advanced
  }
  throw new Error('expected session to complete')
}

describe('StudySessionLifecycle task attribution', () => {
  it('writes explicit task attribution when a focus session starts with taskId', () => {
    const { lifecycle, tick } = createLifecycle()
    const started = lifecycle.toggle(baseSnapshot(), {
      taskId: 'task-alpha',
      workspaceId: 'ws-1',
      activeModeName: '自由自习'
    })
    expect(started.snapshot.timerState).toBe('running')

    const completed = runUntilComplete(lifecycle, started.snapshot, tick, {
      taskId: 'task-alpha',
      workspaceId: 'ws-1'
    })
    const analytics = completed.intents.find((intent) => intent.kind === 'analytics')
    expect(analytics?.kind).toBe('analytics')
    if (analytics?.kind !== 'analytics') return
    const sessionFact = analytics.facts.find((fact) => fact.factKind === 'study_session')
    expect(sessionFact).toMatchObject({
      factKind: 'study_session',
      taskAttribution: {
        kind: 'explicit',
        taskId: 'task-alpha',
        taskTitleSnapshot: 'Alpha reading',
        workspaceId: 'ws-1'
      }
    })
  })

  it('marks sessions unattributed when no task is selected', () => {
    const { lifecycle, tick } = createLifecycle()
    const started = lifecycle.toggle(baseSnapshot(), {
      taskId: null,
      activeModeName: '自由自习'
    })
    expect(started.snapshot.timerState).toBe('running')

    const completed = runUntilComplete(lifecycle, started.snapshot, tick, { taskId: null })
    const analytics = completed.intents.find((intent) => intent.kind === 'analytics')
    expect(analytics?.kind).toBe('analytics')
    if (analytics?.kind !== 'analytics') return
    const sessionFact = analytics.facts.find((fact) => fact.factKind === 'study_session')
    expect(sessionFact).toMatchObject({
      factKind: 'study_session',
      taskAttribution: {
        kind: 'unattributed',
        reason: 'no_task_selected'
      }
    })
  })

  it('keeps explicit attribution when followRoomCycle starts the next focus phase', () => {
    const { lifecycle, tick } = createLifecycle()
    const followed = lifecycle.followRoomCycle(baseSnapshot(), {
      taskId: 'task-beta',
      room: studyRooms[0],
      phase: 'focus',
      remainingSeconds: 60,
      activeModeName: '自由自习'
    })
    expect(followed.snapshot.timerState).toBe('running')

    const completed = runUntilComplete(lifecycle, followed.snapshot, tick, { taskId: 'task-beta' })
    const analytics = completed.intents.find((intent) => intent.kind === 'analytics')
    expect(analytics?.kind).toBe('analytics')
    if (analytics?.kind !== 'analytics') return
    const sessionFact = analytics.facts.find((fact) => fact.factKind === 'study_session')
    expect(sessionFact).toMatchObject({
      factKind: 'study_session',
      taskAttribution: {
        kind: 'explicit',
        taskId: 'task-beta',
        taskTitleSnapshot: 'Beta drills'
      }
    })
  })
})
