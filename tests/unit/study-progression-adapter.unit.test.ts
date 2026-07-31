import { describe, expect, it } from 'vitest'
import { emptyDailyXpProgress } from '../../src/shared/study-progression'
import type {
  StudyActivityFact,
  StudySessionFact
} from '../../src/shared/teaching-types/analytics'
import { applyStudyProgressionAwards } from '../../src/renderer/src/study-space/study-progression'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

const DAY = '2026-07-31'

function snapshot(): StudySnapshot {
  return {
    xp: 0,
    dailyXpProgress: emptyDailyXpProgress(DAY)
  } as StudySnapshot
}

function focusFact(overrides: Partial<StudySessionFact> = {}): StudySessionFact {
  return {
    factVersion: 1,
    factKind: 'study_session',
    id: 'focus-1',
    clientId: 'client-1',
    timerMode: 'focus',
    outcome: 'completed',
    startedAt: '2026-07-31T01:00:00.000Z',
    endedAt: '2026-07-31T01:25:00.000Z',
    recordedAt: '2026-07-31T01:25:00.000Z',
    plannedSeconds: 1_500,
    activeSeconds: 1_500,
    pausedSeconds: 0,
    completedFocusSessions: 1,
    // The reward must be recomputed from the shared rule, not trusted from the fact.
    xpEarned: 9_999,
    context: { modeId: 'free', roomId: 'silent', signalId: 'reading' },
    taskAttribution: { kind: 'unattributed', reason: 'no_task_selected' },
    daySegments: [],
    ...overrides
  }
}

function activityFact(
  id: string,
  activity: StudyActivityFact['activity']
): StudyActivityFact {
  return {
    factVersion: 1,
    factKind: 'study_activity',
    id,
    clientId: 'client-1',
    occurredAt: '2026-07-31T01:25:00.000Z',
    recordedAt: '2026-07-31T01:25:00.000Z',
    localDate: DAY,
    timezoneOffsetMinutes: 0,
    activity
  }
}

describe('study progression analytics-fact adapter', () => {
  it('uses shared focus reward math and does not reward a replayed session fact twice', () => {
    const first = applyStudyProgressionAwards(snapshot(), [focusFact()], DAY)
    expect(first.xp).toBe(50)
    expect(first.dailyXpProgress.bySource.focus_completion).toBe(50)

    const replay = applyStudyProgressionAwards(first, [focusFact()], DAY)
    expect(replay.xp).toBe(50)
    expect(replay.dailyXpProgress.bySource.focus_completion).toBe(50)
  })

  it('rewards one completion per task per day and only correct review answers', () => {
    const completed = activityFact('task-finish-1', {
      kind: 'task_completed',
      before: { taskId: 'task-1', title: 'Algebra', done: false },
      after: { taskId: 'task-1', title: 'Algebra', done: true }
    })
    const repeatedTask = activityFact('task-finish-2', {
      kind: 'task_completed',
      before: { taskId: 'task-1', title: 'Algebra', done: false },
      after: { taskId: 'task-1', title: 'Algebra', done: true }
    })
    const correct = activityFact('review-correct', {
      kind: 'review_answered', workspaceId: 'ws-1', lessonId: 'lesson-1', correct: true
    })
    const incorrect = activityFact('review-incorrect', {
      kind: 'review_answered', workspaceId: 'ws-1', lessonId: 'lesson-1', correct: false
    })

    const next = applyStudyProgressionAwards(snapshot(), [completed, repeatedTask, correct, incorrect], DAY)
    expect(next.xp).toBe(24)
    expect(next.dailyXpProgress.bySource).toEqual({
      focus_completion: 0,
      task_completion: 20,
      review_correct: 4
    })
  })
})
