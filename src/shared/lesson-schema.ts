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

/**
 * A recommended primary source for the learner to read/watch. Mirrors the
 * teach-skill practice of pointing the user at the highest-trust resource for
 * the lesson's topic.
 */
export const lessonPrimarySourceSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().max(500).optional(),
  note: z.string().max(400).optional()
})
export type LessonPrimarySource = z.infer<typeof lessonPrimarySourceSchema>

export const LESSON_CALLOUT_KINDS = ['criteria', 'pitfall', 'insight'] as const
export type LessonCalloutKind = (typeof LESSON_CALLOUT_KINDS)[number]

/**
 * A stand-alone judgment/pitfall/insight card rendered as an aside, distinct
 * from flowing prose. Use for decision criteria (RAG vs fine-tuning), common
 * mistakes, or non-obvious insights that deserve visual prominence.
 */
export const lessonCalloutSchema = z.object({
  kind: z.enum(LESSON_CALLOUT_KINDS).default('insight'),
  title: z.string().max(120).optional(),
  body: z.string().min(1).max(2000)
})
export type LessonCallout = z.infer<typeof lessonCalloutSchema>

export const lessonPlanSchema = z.object({
  title: z.string().min(1).max(120),
  objective: z.string().min(1).max(400),
  durationMinutes: z.number().int().min(5).max(120),
  sections: z.array(lessonSectionSchema).min(1).max(8),
  keyPoints: z.array(z.string().min(1).max(200)).max(12).default([]),
  quiz: z.array(lessonQuizItemSchema).max(5).default([]),
  flashcards: z.array(lessonFlashcardSchema).max(20).default([]),
  referenceNotes: z.string().max(8000).default(''),
  learningRecordNote: z.string().max(4000).default(''),
  // --- Teach-skill-quality extensions (all optional, backward compatible) ---
  primarySource: lessonPrimarySourceSchema.nullable().optional(),
  followupPrompt: z.string().max(400).optional(),
  interviewAnswer: z.string().max(4000).optional(),
  callouts: z.array(lessonCalloutSchema).max(6).default([]),
  flowDiagram: z.string().max(3000).optional()
})
export type LessonPlan = z.infer<typeof lessonPlanSchema>

export type LessonPlanSource = 'ai' | 'fallback'

/**
 * Post-validation hardening. Zod cannot easily express cross-field bounds
 * (e.g. answer index < choices.length), so clamp here instead of rejecting —
 * a slightly clamped plan is still usable, a rejected one forces fallback.
 */
export function sanitizePlan(plan: LessonPlan): LessonPlan {
  const callouts = plan.callouts
    .filter((item) => item.body.trim().length > 0)
    .slice(0, 6)
  const primarySource = plan.primarySource && plan.primarySource.title.trim()
    ? plan.primarySource
    : undefined
  return {
    ...plan,
    callouts,
    primarySource,
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
