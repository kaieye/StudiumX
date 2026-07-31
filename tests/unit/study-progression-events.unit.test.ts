import { describe, expect, it } from 'vitest'
import type { StudySessionFact } from '../../src/shared/teaching-types/analytics'
import {
  claimStudyProgressionFactsEvent,
  dispatchStudyProgressionFacts,
  STUDY_PROGRESSION_FACTS_EVENT
} from '../../src/renderer/src/study-space/study-progression-events'

function focusFact(): StudySessionFact {
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
    xpEarned: 50,
    context: { modeId: 'free', roomId: 'silent', signalId: 'reading' },
    taskAttribution: { kind: 'unattributed', reason: 'no_task_selected' },
    daySegments: []
  }
}

describe('study progression facts event', () => {
  it('lets a mounted study host synchronously claim progression persistence', () => {
    let seenFactId: string | null = null
    const listener = (event: Event) => {
      const detail = claimStudyProgressionFactsEvent(event)
      seenFactId = detail?.facts[0]?.id ?? null
    }
    window.addEventListener(STUDY_PROGRESSION_FACTS_EVENT, listener)
    try {
      expect(dispatchStudyProgressionFacts([focusFact()], '2026-07-31')).toBe(true)
      expect(seenFactId).toBe('focus-1')
    } finally {
      window.removeEventListener(STUDY_PROGRESSION_FACTS_EVENT, listener)
    }
  })

  it('does not mark arbitrary events as handled', () => {
    const event = new Event('unrelated')
    expect(claimStudyProgressionFactsEvent(event)).toBeNull()
  })
})
