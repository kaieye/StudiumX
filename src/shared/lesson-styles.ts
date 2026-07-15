/**
 * Lesson style themes shared by the main process (workspace scaffolding /
 * apply-style IPC) and the renderer (resources page style gallery preview).
 *
 * Theme implementations live in `lesson-style-themes/<style>.ts`. The style
 * registry owns their ordering and lookup policy; this file remains the stable
 * public API for existing imports.
 */

import { lessonStyleRegistry } from './lesson-style-registry'
import type { LessonStyleId } from './lesson-style-themes/types'

export { buildLessonCss } from './lesson-style-themes/base'
export {
  LESSON_INTERACTION_SOURCE,
  LESSON_MARKUP_CLASSES,
  LESSON_MARKUP_DATA_ATTRIBUTES,
  LESSON_MARKUP_DATASET_KEYS,
  LESSON_MARKUP_SELECTORS
} from './lesson-style-themes/contract'
export { LESSON_FLASHCARD_CSS, LESSON_FLASHCARD_JS, LESSON_QUIZ_JS } from './lesson-style-themes/assets'
export {
  PREVIEW_LESSON_INTERACTION_MESSAGE,
  PREVIEW_LESSON_INTERACTION_SOURCE,
  type PreviewLessonInteractionIntent
} from './preview-markdown-bridge'
export { BLUEPRINT_CSS, BLUEPRINT_STYLE, BLUEPRINT_TOKENS } from './lesson-style-themes/blueprint'
export { CHALKBOARD_CSS, CHALKBOARD_STYLE, CHALKBOARD_TOKENS } from './lesson-style-themes/chalkboard'
export { CLASSIC_STYLE, CLASSIC_TOKENS } from './lesson-style-themes/classic'
export { EDITORIAL_CSS, EDITORIAL_STYLE, EDITORIAL_TOKENS } from './lesson-style-themes/editorial'
export { MANUSCRIPT_CSS, MANUSCRIPT_STYLE, MANUSCRIPT_TOKENS } from './lesson-style-themes/manuscript'
export { MONO_STYLE, MONO_TOKENS } from './lesson-style-themes/mono'
export { NIGHTFALL_STYLE, NIGHTFALL_TOKENS } from './lesson-style-themes/nightfall'
export { PAPER_STYLE, PAPER_TOKENS } from './lesson-style-themes/paper'
export { POSTER_CSS, POSTER_STYLE, POSTER_TOKENS } from './lesson-style-themes/poster'
export { TERMINAL_STYLE, TERMINAL_TOKENS } from './lesson-style-themes/terminal'
export { VIVID_STYLE, VIVID_TOKENS } from './lesson-style-themes/vivid'
export { DEFAULT_LESSON_STYLE_ID, LESSON_STYLE_IDS } from './lesson-style-themes/types'
export type { LessonStyleDefinition, LessonStyleId, LessonStyleTokens } from './lesson-style-themes/types'

/** Ordered gallery and application definitions supplied by the shared registry. */
export const LESSON_STYLES = lessonStyleRegistry.styles

export function isLessonStyleId(value: unknown): value is LessonStyleId {
  return lessonStyleRegistry.isStyleId(value)
}

export function normalizeLessonStyleId(value: unknown): LessonStyleId {
  return lessonStyleRegistry.normalize(value)
}

export function lessonStyleCss(styleId: unknown): string {
  return lessonStyleRegistry.css(styleId)
}
