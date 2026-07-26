import type { LessonSummary, ProgressSummary, ReviewCard } from '../../../../shared/teaching-types'
import {
  deriveReviewSchedule,
  REVIEW_INTERVAL_LADDER_DAYS,
  type ReviewScheduleItemInput
} from '../../../../shared/review-scheduler'

/**
 * Real "due for review" projection for lessons.
 *
 * v2 (ADR-0154): derivation now runs through the shared spaced-review
 * scheduler (`deriveReviewSchedule`) instead of a local ad-hoc threshold, so
 * Pet notifications and the teaching loop share one review-timing authority.
 *
 * Renderer inputs still carry no per-attempt timestamps (that wiring arrives
 * with the canonical snapshot IPC), so each lesson is seeded as a single
 * flashcard-kind item anchored at `createdAt`. With the base ladder interval of
 * one day this reproduces the v1 due semantics exactly; per-item history
 * scheduling activates on adapters that can supply real evidence history
 * (see src/main/review-schedule-facts.ts).
 *
 * This is a pure function of real workspace data: lesson summaries, review
 * cards, and aggregate progress. It does not read the filesystem, does not
 * consult the learning-session ledger, and does not mutate its inputs.
 * Callers are responsible for fetching the data.
 */

export type DueLessonReason = 'never-reviewed' | 'stale'

export type DueLessonReview = {
  lessonId: string
  lessonTitle: string
  lessonRelativePath: string
  reason: DueLessonReason
}

/** A lesson becomes due for review once it is at least one base interval old. */
export const LESSON_REVIEW_DUE_THRESHOLD_MS = REVIEW_INTERVAL_LADDER_DAYS[0]! * 24 * 60 * 60 * 1000

export type ComputeDueLessonReviewsInput = {
  lessons: LessonSummary[]
  reviewCards: ReviewCard[]
  progress: ProgressSummary
  now: number
}

/**
 * Computes the set of lessons that are currently due for review.
 *
 * Identity rules (per docs/pet-next-stage-roadmap.md §3.2):
 * - Driven only by real lesson/review/progress data.
 * - Deterministic ordering by `lessonId`, so repeated projections of the same
 *   domain facts produce the same notification set without re-creating
 *   identities.
 */
export function computeDueLessonReviews(input: ComputeDueLessonReviewsInput): DueLessonReview[] {
  const lessonsWithCards = new Set(
    input.reviewCards.map((card) => card.lessonId).filter((lessonId) => lessonId.length > 0)
  )
  if (lessonsWithCards.size === 0) return []

  const byLessonId = new Map<string, LessonSummary>()
  const items: ReviewScheduleItemInput[] = []
  for (const lesson of input.lessons) {
    if (!lessonsWithCards.has(lesson.id)) continue
    if (Number.isNaN(Date.parse(lesson.createdAt))) continue
    byLessonId.set(lesson.id, lesson)
    items.push({
      itemId: 'lesson-review',
      lessonId: lesson.id,
      kind: 'flashcard',
      anchorAt: lesson.createdAt,
      history: []
    })
  }
  if (items.length === 0) return []

  const schedule = deriveReviewSchedule({
    items,
    now: new Date(input.now).toISOString(),
    // Pet projection lists every due lesson; notification pacing is owned upstream.
    dueLimit: items.length
  })

  const due: DueLessonReview[] = []
  for (const item of schedule.dueNow) {
    const lesson = byLessonId.get(item.lessonId)
    if (!lesson) continue
    const answered = input.progress.byLesson[lesson.id]?.answered ?? 0
    due.push({
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      lessonRelativePath: lesson.relativePath,
      reason: answered > 0 ? 'stale' : 'never-reviewed'
    })
  }

  due.sort((left, right) => left.lessonId.localeCompare(right.lessonId))
  return due
}
