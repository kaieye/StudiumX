import type { LessonSummary, ProgressSummary, ReviewCard } from '../../../../shared/teaching-types'

/**
 * Real "due for review" projection for lessons.
 *
 * A lesson is due when it has at least one review card (flashcards) AND its
 * `createdAt` is at least {@link LESSON_REVIEW_DUE_THRESHOLD_MS} in the past.
 * The `reason` distinguishes lessons the learner has never answered
 * (`never-reviewed`) from lessons that have been answered at least once but
 * are still old enough to refresh (`stale`).
 *
 * This is a pure function of real workspace data: lesson summaries, review
 * cards, and aggregate progress. It does not read the filesystem, does not
 * consult the (currently unwired) learning-session ledger, and does not
 * mutate its inputs. Callers are responsible for fetching the data.
 */

export type DueLessonReason = 'never-reviewed' | 'stale'

export type DueLessonReview = {
  lessonId: string
  lessonTitle: string
  lessonRelativePath: string
  reason: DueLessonReason
}

/** A lesson becomes due for review once it is at least one day old. */
export const LESSON_REVIEW_DUE_THRESHOLD_MS = 24 * 60 * 60 * 1000

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

  const due: DueLessonReview[] = []
  for (const lesson of input.lessons) {
    if (!lessonsWithCards.has(lesson.id)) continue
    const createdAtMs = Date.parse(lesson.createdAt)
    if (Number.isNaN(createdAtMs)) continue
    if (input.now - createdAtMs < LESSON_REVIEW_DUE_THRESHOLD_MS) continue
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
