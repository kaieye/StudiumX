import { describe, expect, it } from 'vitest'
import {
  computeDueLessonReviews,
  LESSON_REVIEW_DUE_THRESHOLD_MS
} from '../../src/renderer/src/views/pet/lesson-review-due'
import type { LessonSummary, ProgressSummary, ReviewCard } from '../../src/shared/teaching-types'

const NOW = Date.parse('2026-07-16T12:00:00.000Z')
const OLD_CREATED_AT = '2026-07-14T00:00:00.000Z'
const FRESH_CREATED_AT = '2026-07-16T11:30:00.000Z'

function lesson(overrides: Partial<LessonSummary> = {}): LessonSummary {
  return {
    id: '0001',
    title: 'Variables',
    objective: '',
    prompt: '',
    createdAt: OLD_CREATED_AT,
    durationMinutes: 10,
    courseId: 'course-1',
    courseName: 'Course',
    courseRelativePath: 'lessons/course',
    courseAbsolutePath: '/workspace/lessons/course',
    sessionId: 'session-1',
    sessionName: 'Session',
    sessionRelativePath: 'lessons/course/session',
    sessionAbsolutePath: '/workspace/lessons/course/session',
    relativePath: 'lessons/course/session/0001-lesson.html',
    absolutePath: '/workspace/lessons/course/session/0001-lesson.html',
    ...overrides
  }
}

function reviewCard(lessonId: string): ReviewCard {
  return {
    id: `card-${lessonId}`,
    lessonId,
    lessonTitle: 'Variables',
    front: 'front',
    back: 'back',
    provenance: {
      artifactPath: `lessons/course/session/${lessonId}-flashcards.json`,
      artifactCardIndex: 0
    }
  }
}

function progress(byLesson: ProgressSummary['byLesson'] = {}): ProgressSummary {
  return { totalAnswered: 0, correct: 0, byLesson }
}

describe('computeDueLessonReviews', () => {
  it('returns no due lessons when no review cards exist', () => {
    const due = computeDueLessonReviews({
      lessons: [lesson()],
      reviewCards: [],
      progress: progress(),
      now: NOW
    })
    expect(due).toEqual([])
  })

  it('returns no due lessons for a lesson younger than the threshold', () => {
    const due = computeDueLessonReviews({
      lessons: [lesson({ createdAt: FRESH_CREATED_AT })],
      reviewCards: [reviewCard('0001')],
      progress: progress(),
      now: NOW
    })
    expect(due).toEqual([])
  })

  it('marks a never-reviewed lesson as due with the never-reviewed reason', () => {
    const due = computeDueLessonReviews({
      lessons: [lesson()],
      reviewCards: [reviewCard('0001')],
      progress: progress(),
      now: NOW
    })
    expect(due).toEqual([{
      lessonId: '0001',
      lessonTitle: 'Variables',
      lessonRelativePath: 'lessons/course/session/0001-lesson.html',
      reason: 'never-reviewed'
    }])
  })

  it('marks an answered lesson as stale instead of never-reviewed', () => {
    const due = computeDueLessonReviews({
      lessons: [lesson()],
      reviewCards: [reviewCard('0001')],
      progress: progress({ '0001': { answered: 3, correct: 2 } }),
      now: NOW
    })
    expect(due[0]?.reason).toBe('stale')
  })

  it('ignores lessons that have no flashcards even when they are old', () => {
    const due = computeDueLessonReviews({
      lessons: [lesson({ id: '0001' }), lesson({ id: '0002' })],
      reviewCards: [reviewCard('0001')],
      progress: progress(),
      now: NOW
    })
    expect(due).toHaveLength(1)
    expect(due[0]?.lessonId).toBe('0001')
  })

  it('produces a deterministic ordering by lesson id', () => {
    const due = computeDueLessonReviews({
      lessons: [lesson({ id: '0003' }), lesson({ id: '0001' }), lesson({ id: '0002' })],
      reviewCards: [reviewCard('0003'), reviewCard('0001'), reviewCard('0002')],
      progress: progress(),
      now: NOW
    })
    expect(due.map((item) => item.lessonId)).toEqual(['0001', '0002', '0003'])
  })

  it('treats a lesson exactly at the threshold boundary as not yet due', () => {
    const createdAtMs = Date.parse(OLD_CREATED_AT)
    const due = computeDueLessonReviews({
      lessons: [lesson({ createdAt: new Date(NOW - LESSON_REVIEW_DUE_THRESHOLD_MS + 1).toISOString() })],
      reviewCards: [reviewCard('0001')],
      progress: progress(),
      now: NOW
    })
    expect(due).toEqual([])
    void createdAtMs
  })

  it('skips lessons with an unparseable createdAt', () => {
    const due = computeDueLessonReviews({
      lessons: [lesson({ createdAt: 'not-a-date' })],
      reviewCards: [reviewCard('0001')],
      progress: progress(),
      now: NOW
    })
    expect(due).toEqual([])
  })
})
