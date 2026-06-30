import { z } from 'zod'
import type { QuizType } from './teaching-types'

/**
 * Structured lesson plan — the contract between the AI provider and the
 * template renderer. The model must return JSON matching this schema; the
 * main process validates with Zod before rendering, and falls back to the
 * local template generator on any validation failure.
 */
export const lessonSectionSchema = z.object({
  heading: z.string().min(1).max(120),
  // Markdown allowed; rendered through a strict allowlist in lesson-renderer.
  body: z.string().min(1).max(8000)
})
export type LessonSection = z.infer<typeof lessonSectionSchema>

export const lessonQuizItemSchema = z.object({
  type: z.enum(['single', 'multi', 'truefalse', 'fill']).default('single'),
  question: z.string().min(1).max(500),
  choices: z.array(z.string().min(1).max(200)).max(6).default([]),
  // single/multi: 0-based indices (multi as comma string or number array);
  // truefalse: 1 = true; fill: normalized expected text.
  answer: z.union([z.number().int().min(0), z.string().max(200), z.array(z.number().int().min(0))]).default(''),
  explanation: z.string().max(600).default('')
})
export type LessonQuizItem = z.infer<typeof lessonQuizItemSchema>

export const lessonFlashcardSchema = z.object({
  front: z.string().min(1).max(400),
  back: z.string().min(1).max(800)
})
export type LessonFlashcard = z.infer<typeof lessonFlashcardSchema>

export const lessonPlanSchema = z.object({
  title: z.string().min(1).max(120),
  objective: z.string().min(1).max(400),
  durationMinutes: z.number().int().min(5).max(120),
  sections: z.array(lessonSectionSchema).min(1).max(8),
  keyPoints: z.array(z.string().min(1).max(200)).max(12).default([]),
  quiz: z.array(lessonQuizItemSchema).max(5).default([]),
  flashcards: z.array(lessonFlashcardSchema).max(20).default([]),
  referenceNotes: z.string().max(8000).default(''),
  learningRecordNote: z.string().max(4000).default('')
})
export type LessonPlan = z.infer<typeof lessonPlanSchema>

export type LessonPlanSource = 'ai' | 'fallback'

/**
 * Post-validation hardening. Zod cannot easily express cross-field bounds
 * (e.g. answer index < choices.length), so clamp here instead of rejecting —
 * a slightly clamped plan is still usable, a rejected one forces fallback.
 */
export function sanitizePlan(plan: LessonPlan): LessonPlan {
  return {
    ...plan,
    quiz: plan.quiz
      .map((item) => {
        if (item.type === 'single' || item.type === 'multi') {
          const indices = Array.isArray(item.answer)
            ? item.answer
            : typeof item.answer === 'number'
              ? [item.answer]
              : String(item.answer)
                  .split(',')
                  .map((part) => Number.parseInt(part.trim(), 10))
                  .filter(Number.isFinite)
          const clamped = indices
            .filter((index) => index >= 0 && index < item.choices.length)
            .slice(0, item.choices.length)
          return {
            ...item,
            answer:
              item.type === 'multi'
                ? clamped.join(',')
                : String(clamped[0] ?? 0)
          }
        }
        return item
      })
      // Drop quiz items that have no usable answer after clamping.
      .filter((item) => {
        if (item.type === 'fill') return String(item.answer).trim().length > 0
        if (item.type === 'truefalse') return true
        return String(item.answer).length > 0
      })
  }
}

/** Coerce a quiz item's raw `type` to the QuizType union (defensive). */
export function coerceQuizType(value: unknown): QuizType {
  return value === 'multi' || value === 'truefalse' || value === 'fill' ? value : 'single'
}
