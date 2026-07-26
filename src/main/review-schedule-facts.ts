/**
 * Read-only adapter: LearningSessionLedger scan → spaced-review schedule facts (ADR-0154).
 *
 * Derives per-item review history from typed lesson interaction evidence that
 * already lives in canonical sessions. No writes, no settlement authority, no
 * invented facts: only items with at least one recorded attempt (or a lesson
 * anchor supplied by the ledger snapshot) enter the schedule.
 */

import {
  normalizeLessonInteraction,
  type LessonInteraction
} from '../shared/teaching-types/lesson-interaction'
import type { LearningSessionScanResult } from '../shared/teaching-types/learning-session'
import {
  deriveReviewSchedule,
  flashcardRatingToCorrect,
  type ReviewHistoryEntry,
  type ReviewItemKind,
  type ReviewSchedule,
  type ReviewScheduleItemInput
} from '../shared/review-scheduler'

export type DeriveReviewScheduleFromScanInput = {
  scan: Pick<LearningSessionScanResult, 'canonicalSessions'>
  /** Caller supplies time explicitly; the projection itself stays deterministic. */
  now: string
  dueLimit?: number
}

/**
 * Project review schedule facts from a ledger scan. Evidence identity rules
 * mirror the evaluator's conservative posture: malformed interactions are
 * skipped (fail-soft), never guessed.
 */
export function deriveReviewScheduleFromScan(
  input: DeriveReviewScheduleFromScanInput
): ReviewSchedule {
  const byItem = new Map<string, { input: ReviewScheduleItemInput; history: ReviewHistoryEntry[] }>()

  for (const session of input.scan.canonicalSessions) {
    if (session.readOnly) continue
    const lessonId = session.lessonRef?.lessonId
    if (!lessonId) continue

    for (const event of session.events) {
      const interaction = tryNormalize(event.payload?.lessonInteraction)
      if (!interaction) continue
      if (interaction.sessionId !== session.id || interaction.lessonId !== lessonId) continue

      const observed = reviewObservation(interaction)
      if (!observed) continue

      const key = `${lessonId}${interaction.itemId}${observed.kind}`
      const existing = byItem.get(key)
      if (existing) {
        existing.history.push(observed.entry)
        continue
      }
      byItem.set(key, {
        input: {
          itemId: interaction.itemId,
          lessonId,
          kind: observed.kind,
          anchorAt: session.createdAt,
          history: []
        },
        history: [observed.entry]
      })
    }
  }

  const items: ReviewScheduleItemInput[] = [...byItem.values()].map((entry) => ({
    ...entry.input,
    history: entry.history
  }))

  return deriveReviewSchedule({ items, now: input.now, ...(input.dueLimit !== undefined ? { dueLimit: input.dueLimit } : {}) })
}

function tryNormalize(value: unknown): LessonInteraction | null {
  if (!value) return null
  try {
    return normalizeLessonInteraction(value)
  } catch {
    return null
  }
}

function reviewObservation(
  interaction: LessonInteraction
): { kind: ReviewItemKind; entry: ReviewHistoryEntry } | null {
  if (interaction.kind === 'quiz_answered') {
    return {
      kind: 'quiz',
      entry: { observedAt: interaction.observedAt, correct: interaction.correct }
    }
  }
  if (interaction.kind === 'flashcard_rated') {
    return {
      kind: 'flashcard',
      entry: { observedAt: interaction.observedAt, correct: flashcardRatingToCorrect(interaction.rating) }
    }
  }
  return null
}
