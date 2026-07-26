import { describe, expect, it } from 'vitest'
import { deriveReviewScheduleFromScan } from '../../src/main/review-schedule-facts'

const NOW = '2026-07-26T12:00:00.000Z'
const DIGEST = 'a'.repeat(64)

function quizInteraction(eventId: string, observedAt: string, correct: boolean, itemId = 'quiz-1') {
  return {
    schemaVersion: 1,
    eventId,
    kind: 'quiz_answered',
    workspaceId: 'workspace-1',
    courseId: 'course-1',
    sessionId: 'session-1',
    lessonId: 'lesson-1',
    itemId,
    attempt: 1,
    observedAt,
    artifactDigest: DIGEST,
    surface: 'lesson_preview',
    selectedOptionIds: ['a'],
    correct
  }
}

function canonicalSession(events: Array<{ payload: { lessonInteraction: unknown } }>, overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    readOnly: false,
    createdAt: '2026-07-20T00:00:00.000Z',
    lessonRef: { lessonId: 'lesson-1' },
    events,
    ...overrides
  } as never
}

describe('deriveReviewScheduleFromScan (ADR-0154)', () => {
  it('derives per-item history from typed quiz evidence in canonical sessions', () => {
    const scan = {
      canonicalSessions: [canonicalSession([
        { payload: { lessonInteraction: quizInteraction('e1', '2026-07-20T01:00:00.000Z', true) } },
        { payload: { lessonInteraction: quizInteraction('e2', '2026-07-21T01:00:00.000Z', true) } },
        { payload: { lessonInteraction: { bogus: true } } }
      ])]
    }

    const schedule = deriveReviewScheduleFromScan({ scan, now: NOW })

    expect(schedule.items).toHaveLength(1)
    expect(schedule.items[0]).toMatchObject({ successStreak: 2, intervalIndex: 1 })
    expect(schedule.dueCount).toBe(1)
  })

  it('folds flashcard ratings into the same correctness axis', () => {
    const flashcard = {
      ...quizInteraction('e1', '2026-07-20T01:00:00.000Z', false, 'flashcard-1'),
      kind: 'flashcard_rated',
      rating: 'again'
    } as Record<string, unknown>
    delete flashcard.selectedOptionIds
    delete flashcard.correct

    const schedule = deriveReviewScheduleFromScan({
      scan: { canonicalSessions: [canonicalSession([{ payload: { lessonInteraction: flashcard } }])] },
      now: NOW
    })

    expect(schedule.items[0]).toMatchObject({ kind: 'flashcard', state: 'lapsed' })
  })

  it('skips read-only sessions and identity-mismatched interactions (fail-soft)', () => {
    const foreign = quizInteraction('e1', '2026-07-20T01:00:00.000Z', true)
    foreign.sessionId = 'other-session'

    const schedule = deriveReviewScheduleFromScan({
      scan: {
        canonicalSessions: [
          canonicalSession([{ payload: { lessonInteraction: quizInteraction('e2', '2026-07-20T02:00:00.000Z', true) } }], { readOnly: true }),
          canonicalSession([{ payload: { lessonInteraction: foreign } }])
        ]
      },
      now: NOW
    })

    expect(schedule.items).toHaveLength(0)
  })
})
