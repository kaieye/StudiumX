import { describe, expect, it } from 'vitest'
import {
  advancePetNotificationProjection,
  createInitialPetNotificationProjectionState,
  dismissPetNotification,
  projectPetNotifications,
  pruneDismissedPetNotifications,
  retainedPetNotificationIds,
  selectHighestPriorityPetNotification,
  selectPetNotifications,
  type PetNotification,
  type PetNotificationCopy,
  type PetNotificationSignals
} from '../../src/renderer/src/views/pet/pet-notifications'


const copy: PetNotificationCopy = {
  waiting: { title: 'Request waiting', detail: 'Answer or approve', actionLabel: 'Handle request' },
  agentRunning: { title: 'Agent running', detail: 'Agent progress', actionLabel: 'View progress' },
  lessonRunning: { title: 'Lesson running', detail: 'Lesson progress', actionLabel: 'View progress' },
  agentReview: { title: 'Agent complete', detail: 'Agent result', actionLabel: 'View result' },
  lessonReview: { title: 'Lesson complete', detail: 'Lesson result', actionLabel: 'View result' },
  agentFailed: { title: 'Agent failed', actionLabel: 'View error' },
  lessonFailed: { title: 'Lesson failed', actionLabel: 'View error' },
  waving: { title: 'Hello', detail: 'Ready to help', actionLabel: 'Start a chat' }
}

function signals(overrides: Partial<PetNotificationSignals> = {}): PetNotificationSignals {
  return {
    now: 1_000,
    enabled: true,
    pendingRequest: null,
    agent: { busy: false },
    lessonGeneration: { busy: false },
    errors: [],
    ...overrides
  }
}

function advance(input: PetNotificationSignals) {
  const state = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), input)
  return { state, notifications: projectPetNotifications(state, input, copy) }
}

function notification(state: PetNotification['state'], createdAt = 1): PetNotification {
  return {
    id: `${state}-${createdAt}`,
    source: state === 'waving' ? 'onboarding' : 'agent',
    state,
    title: state,
    detail: `${state} detail`,
    action: 'open-assistant',
    actionLabel: 'Open',
    createdAt
  }
}

describe('pet notification projection', () => {
  it('selects waiting over failed, review, running, and waving', () => {
    const notifications = [
      notification('waving'),
      notification('running'),
      notification('review'),
      notification('failed'),
      notification('waiting')
    ]

    const order: PetNotification['state'][] = []
    let remaining = notifications
    while (remaining.length > 0) {
      const selected = selectHighestPriorityPetNotification(remaining, {}, 1)
      if (!selected) break
      order.push(selected.state)
      remaining = remaining.filter((item) => item.id !== selected.id)
    }

    expect(order).toEqual(['waiting', 'failed', 'review', 'running', 'waving'])
  })

  it('returns at most three real notifications in priority order for an expanded activity stack', () => {
    const selected = selectPetNotifications([
      notification('waving'),
      notification('running'),
      notification('review'),
      notification('failed'),
      notification('waiting')
    ], {}, 1, 3)

    expect(selected.map((item) => item.state)).toEqual(['waiting', 'failed', 'review'])
  })

  it('projects a pending ask or tool permission as a waiting notification', () => {
    const input = signals({
      pendingRequest: { id: 'ask-1', conversationId: 'pending-1', kind: 'ask' },
      agent: { busy: true, runId: 'pending-1', conversationId: 'pending-1' }
    })
    const { notifications } = advance(input)
    const waiting = notifications.find((item) => item.state === 'waiting')

    expect(waiting).toMatchObject({
      id: 'agent:pending-1:ask-1:waiting',
      source: 'agent',
      sourceId: 'pending-1',
      targetId: 'pending-1',
      action: 'open-conversation'
    })
  })

  it('projects Agent and lesson generation runs as running notifications', () => {
    const input = signals({
      agent: { busy: true, runId: 'agent-run-1', conversationId: 'pending-1' },
      lessonGeneration: { busy: true, runId: 'lesson-run-1' }
    })
    const { notifications } = advance(input)

    expect(notifications.filter((item) => item.state === 'running')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent:agent-run-1:running', source: 'agent' }),
      expect.objectContaining({ id: 'lesson-generation:lesson-run-1:running', source: 'lesson-generation' })
    ]))
  })

  it('projects a successful run as review for about seven seconds', () => {
    const started = signals({
      agent: { busy: true, runId: 'agent-run-1', conversationId: 'pending-1' }
    })
    const runningState = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), started)
    const completed = signals({
      now: 2_000,
      agent: {
        busy: false,
        result: { runId: 'agent-run-1', resultId: 'conversation-result-1', targetId: 'conversation-1' }
      }
    })
    const reviewedState = advancePetNotificationProjection(runningState, completed)
    const review = projectPetNotifications(reviewedState, completed, copy).find((item) => item.state === 'review')

    expect(review).toMatchObject({
      id: 'agent:agent-run-1:review',
      targetId: 'conversation-1',
      expiresAt: 9_000
    })

    const expired = { ...completed, now: 9_001 }
    const expiredState = advancePetNotificationProjection(reviewedState, expired)
    expect(projectPetNotifications(expiredState, expired, copy).some((item) => item.state === 'review')).toBe(false)
  })

  it('does not review an Agent run from an old or mismatched conversation result', () => {
    const started = signals({
      agent: { busy: true, runId: 'agent-run-1', conversationId: 'pending-1' }
    })
    const runningState = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), started)
    const completed = signals({
      now: 2_000,
      agent: {
        busy: false,
        result: { runId: 'agent-run-old', resultId: 'conversation-old', targetId: 'conversation-old' }
      }
    })
    const reviewedState = advancePetNotificationProjection(runningState, completed)

    expect(projectPetNotifications(reviewedState, completed, copy).some((item) => item.state === 'review')).toBe(false)
  })

  it('does not review a canceled Agent run without an explicit result', () => {
    const started = signals({
      agent: { busy: true, runId: 'agent-run-1', conversationId: 'pending-1' }
    })
    const runningState = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), started)
    const canceled = signals({ now: 2_000, agent: { busy: false } })
    const canceledState = advancePetNotificationProjection(runningState, canceled)

    expect(projectPetNotifications(canceledState, canceled, copy).some((item) => item.state === 'review')).toBe(false)
  })

  it('keeps waving for about eight seconds after enabling', () => {
    const enabled = signals({ now: 3_000 })
    const state = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), enabled)
    expect(projectPetNotifications(state, enabled, copy).find((item) => item.state === 'waving')).toMatchObject({
      expiresAt: 11_000
    })

    const expired = { ...enabled, now: 11_001 }
    const expiredState = advancePetNotificationProjection(state, expired)
    expect(projectPetNotifications(expiredState, expired, copy).some((item) => item.state === 'waving')).toBe(false)
  })

  it('does not project an unrelated global error without an explicit Pet operation source', () => {
    const { notifications } = advance(signals())
    expect(notifications.some((item) => item.state === 'failed')).toBe(false)
  })

  it('projects explicitly sourced Agent and lesson-generation errors as failed notifications', () => {
    const input = signals({
      errors: [
        { id: 'agent:run-1:failed', source: 'agent', sourceId: 'run-1', detail: 'Agent broke', createdAt: 10 },
        { id: 'lesson:run-2:failed', source: 'lesson-generation', sourceId: 'run-2', detail: 'Lesson broke', createdAt: 20 }
      ]
    })
    const { notifications } = advance(input)

    expect(notifications.filter((item) => item.state === 'failed')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent:run-1:failed', detail: 'Agent broke' }),
      expect.objectContaining({ id: 'lesson:run-2:failed', detail: 'Lesson broke' })
    ]))
  })

  it('does not create review when a run ends with its explicitly sourced error', () => {
    const started = signals({ lessonGeneration: { busy: true, runId: 'lesson-run-1' } })
    const runningState = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), started)
    const failed = signals({
      now: 2_000,
      lessonGeneration: {
        busy: false,
        result: { runId: 'lesson-run-1', resultId: 'lesson-1', targetId: 'lesson-1.html' }
      },
      errors: [{
        id: 'lesson-generation:lesson-run-1:failed',
        source: 'lesson-generation',
        sourceId: 'lesson-run-1',
        detail: 'No lesson',
        createdAt: 2_000
      }]
    })
    const failedState = advancePetNotificationProjection(runningState, failed)

    expect(projectPetNotifications(failedState, failed, copy).some((item) => item.state === 'review')).toBe(false)
  })

  it('keeps a running notification id stable throughout one lifecycle', () => {
    const firstSignals = signals({ agent: { busy: true, runId: 'agent-run-1', conversationId: 'pending-1' } })
    const firstState = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), firstSignals)
    const secondSignals = { ...firstSignals, now: 2_000 }
    const secondState = advancePetNotificationProjection(firstState, secondSignals)

    expect(secondState.agentRun?.id).toBe('agent:agent-run-1:running')
    expect(secondState.agentRun?.id).toBe(firstState.agentRun?.id)
  })

  it('projects a successful lesson generation as a short-lived review', () => {
    const started = signals({ lessonGeneration: { busy: true, runId: 'lesson-run-1' } })
    const runningState = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), started)
    const completed = signals({
      now: 2_000,
      lessonGeneration: {
        busy: false,
        result: {
          runId: 'lesson-run-1',
          resultId: 'lesson-1',
          targetId: 'courses/physics/lesson-1.html'
        }
      }
    })
    const reviewedState = advancePetNotificationProjection(runningState, completed)

    expect(projectPetNotifications(reviewedState, completed, copy)).toContainEqual(expect.objectContaining({
      id: 'lesson-generation:lesson-run-1:review',
      targetId: 'courses/physics/lesson-1.html',
      action: 'open-lessons'
    }))
  })

  it('does not reuse an old result identity across consecutive runs from the same source', () => {
    const firstStarted = signals({ lessonGeneration: { busy: true, runId: 'lesson-run-1' } })
    const firstRunning = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), firstStarted)
    const firstCompleted = signals({
      now: 2_000,
      lessonGeneration: {
        busy: false,
        result: { runId: 'lesson-run-1', resultId: 'lesson-1', targetId: 'lesson-1.html' }
      }
    })
    const firstReviewed = advancePetNotificationProjection(firstRunning, firstCompleted)
    const secondStarted = signals({
      now: 3_000,
      lessonGeneration: { busy: true, runId: 'lesson-run-2' }
    })
    const secondRunning = advancePetNotificationProjection(firstReviewed, secondStarted)
    const staleCompletion = signals({
      now: 4_000,
      lessonGeneration: {
        busy: false,
        result: { runId: 'lesson-run-1', resultId: 'lesson-1', targetId: 'lesson-1.html' }
      }
    })
    const staleState = advancePetNotificationProjection(secondRunning, staleCompletion)

    expect(projectPetNotifications(staleState, staleCompletion, copy).filter((item) => item.state === 'review'))
      .toEqual([expect.objectContaining({ id: 'lesson-generation:lesson-run-1:review' })])
  })

  it('keeps a long-running waiting or failed notification dismissed beyond a fixed hour', () => {
    const waiting = notification('waiting', 10)
    const failed = notification('failed', 20)
    const dismissed = dismissPetNotification(
      dismissPetNotification({}, waiting, 10),
      failed,
      20
    )

    expect(selectHighestPriorityPetNotification([waiting, failed], dismissed, 3_600_021)).toBeNull()
  })

  it('retains a dismissed waiting identity across a temporary idle projection', () => {
    const active = signals({
      pendingRequest: { id: 'ask-1', conversationId: 'pending-1', kind: 'ask' },
      agent: { busy: true, runId: 'pending-1', conversationId: 'pending-1' }
    })
    const activeState = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), active)
    const waiting = projectPetNotifications(activeState, active, copy).find((item) => item.state === 'waiting')!
    const dismissed = dismissPetNotification({}, waiting, active.now)
    const temporarilyIdle = signals({
      now: 2_000,
      agent: { busy: true, runId: 'pending-1', conversationId: 'pending-1' }
    })
    const idleState = advancePetNotificationProjection(activeState, temporarilyIdle)
    const retained = pruneDismissedPetNotifications(
      dismissed,
      retainedPetNotificationIds(idleState, temporarilyIdle)
    )
    const resumed = { ...active, now: 3_000 }
    const resumedState = advancePetNotificationProjection(idleState, resumed)
    const resumedNotifications = projectPetNotifications(resumedState, resumed, copy)

    expect(selectHighestPriorityPetNotification(resumedNotifications, retained, resumed.now)?.state).not.toBe('waiting')
  })

  it('cleans a dismissed identity after its source lifecycle explicitly ends', () => {
    const active = signals({
      pendingRequest: { id: 'ask-1', conversationId: 'pending-1', kind: 'ask' },
      agent: { busy: true, runId: 'pending-1', conversationId: 'pending-1' }
    })
    const activeState = advancePetNotificationProjection(createInitialPetNotificationProjectionState(), active)
    const waiting = projectPetNotifications(activeState, active, copy).find((item) => item.state === 'waiting')!
    const dismissed = dismissPetNotification({}, waiting, active.now)
    const canceled = signals({ now: 2_000 })
    const endedState = advancePetNotificationProjection(activeState, canceled)

    expect(pruneDismissedPetNotifications(
      dismissed,
      retainedPetNotificationIds(endedState, canceled)
    )).toEqual({})
  })

  it('dismisses by stable notification id so a new notification with the same state is visible', () => {
    const first = notification('waiting', 10)
    const second = notification('waiting', 20)
    const dismissed = dismissPetNotification({}, first, 10)

    expect(selectHighestPriorityPetNotification([first], dismissed, 11)).toBeNull()
    expect(selectHighestPriorityPetNotification([first, second], dismissed, 21)?.id).toBe(second.id)
  })

  it('removes stale dismissed ids during capacity cleanup without evicting live identities', () => {
    const dismissed = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`old-${index}`, index]))
    dismissed['waiting-live'] = 1
    dismissed['failed-live'] = 2

    expect(pruneDismissedPetNotifications(dismissed, ['waiting-live', 'failed-live'])).toEqual({
      'waiting-live': 1,
      'failed-live': 2
    })
  })
})
