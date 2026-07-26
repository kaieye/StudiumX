import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_DUE_LIMIT,
  REVIEW_INTERVAL_LADDER_DAYS,
  deriveReviewSchedule,
  flashcardRatingToCorrect,
  type ReviewScheduleItemInput
} from '../../src/shared/review-scheduler'

const NOW = '2026-07-26T12:00:00.000Z'

function item(overrides: Partial<ReviewScheduleItemInput> = {}): ReviewScheduleItemInput {
  return {
    itemId: 'quiz-1',
    lessonId: 'lesson-1',
    kind: 'quiz',
    anchorAt: '2026-07-24T12:00:00.000Z',
    history: [],
    ...overrides
  }
}

describe('deriveReviewSchedule (ADR-0154)', () => {
  it('makes a new item due one base interval after its anchor', () => {
    const schedule = deriveReviewSchedule({ items: [item()], now: NOW })

    expect(schedule.dueCount).toBe(1)
    expect(schedule.dueNow[0]).toMatchObject({
      state: 'due',
      successStreak: 0,
      intervalIndex: 0,
      nextDueAt: '2026-07-25T12:00:00.000Z'
    })
  })

  it('keeps a fresh new item unscheduled until the base interval passes', () => {
    const schedule = deriveReviewSchedule({
      items: [item({ anchorAt: '2026-07-26T11:00:00.000Z' })],
      now: NOW
    })

    expect(schedule.dueCount).toBe(0)
    expect(schedule.items[0]!.state).toBe('new')
  })

  it('climbs the interval ladder with a success streak', () => {
    const schedule = deriveReviewSchedule({
      items: [item({
        history: [
          { observedAt: '2026-07-20T00:00:00.000Z', correct: true },
          { observedAt: '2026-07-21T00:00:00.000Z', correct: true }
        ]
      })],
      now: NOW
    })

    expect(schedule.items[0]).toMatchObject({
      successStreak: 2,
      intervalIndex: 1,
      nextDueAt: '2026-07-24T00:00:00.000Z',
      state: 'due'
    })
  })

  it('caps the interval index at the top of the ladder', () => {
    const history = Array.from({ length: REVIEW_INTERVAL_LADDER_DAYS.length + 3 }, (_, index) => ({
      observedAt: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      correct: true
    }))
    const schedule = deriveReviewSchedule({ items: [item({ history })], now: NOW })

    expect(schedule.items[0]!.intervalIndex).toBe(REVIEW_INTERVAL_LADDER_DAYS.length - 1)
  })

  it('lapses on an incorrect latest attempt and falls back to the base interval', () => {
    const schedule = deriveReviewSchedule({
      items: [item({
        history: [
          { observedAt: '2026-07-20T00:00:00.000Z', correct: true },
          { observedAt: '2026-07-25T00:00:00.000Z', correct: false }
        ]
      })],
      now: NOW
    })

    expect(schedule.items[0]).toMatchObject({
      state: 'lapsed',
      successStreak: 0,
      intervalIndex: 0,
      nextDueAt: '2026-07-26T00:00:00.000Z'
    })
    expect(schedule.dueCount).toBe(1)
  })

  it('applies the due limit deterministically, most overdue first', () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item({ itemId: `quiz-${index}`, anchorAt: `2026-07-${10 + index}T00:00:00.000Z` })
    )
    const first = deriveReviewSchedule({ items, now: NOW })
    const second = deriveReviewSchedule({ items, now: NOW })

    expect(first).toEqual(second)
    expect(first.dueCount).toBe(8)
    expect(first.dueNow).toHaveLength(DEFAULT_REVIEW_DUE_LIMIT)
    expect(first.dueNow[0]!.itemId).toBe('quiz-0')
  })

  it('excludes invalid timestamps instead of inventing time facts', () => {
    const schedule = deriveReviewSchedule({
      items: [
        item({ anchorAt: 'not-a-date' }),
        item({ itemId: 'quiz-2', history: [{ observedAt: 'garbage', correct: true }], anchorAt: 'also-bad' })
      ],
      now: NOW
    })

    expect(schedule.items).toHaveLength(0)
  })

  it('maps flashcard ratings onto the shared correctness axis', () => {
    expect(flashcardRatingToCorrect('again')).toBe(false)
    expect(flashcardRatingToCorrect('hard')).toBe(true)
    expect(flashcardRatingToCorrect('good')).toBe(true)
    expect(flashcardRatingToCorrect('easy')).toBe(true)
  })
})
