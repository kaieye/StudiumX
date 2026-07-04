/**
 * Lesson style themes shared by the main process (workspace scaffolding /
 * apply-style IPC) and the renderer (resources page style gallery preview).
 *
 * Theme implementations live in `lesson-style-themes/<style>.ts` so each
 * resources-page style can evolve independently while this file remains the
 * stable public API for existing imports.
 */

import { BLUEPRINT_STYLE } from './lesson-style-themes/blueprint'
import { CHALKBOARD_STYLE } from './lesson-style-themes/chalkboard'
import { CLASSIC_STYLE } from './lesson-style-themes/classic'
import { EDITORIAL_STYLE } from './lesson-style-themes/editorial'
import { MANUSCRIPT_STYLE } from './lesson-style-themes/manuscript'
import { MONO_STYLE } from './lesson-style-themes/mono'
import { NIGHTFALL_STYLE } from './lesson-style-themes/nightfall'
import { PAPER_STYLE } from './lesson-style-themes/paper'
import { POSTER_STYLE } from './lesson-style-themes/poster'
import { TERMINAL_STYLE } from './lesson-style-themes/terminal'
import { VIVID_STYLE } from './lesson-style-themes/vivid'
import { DEFAULT_LESSON_STYLE_ID, LESSON_STYLE_IDS } from './lesson-style-themes/types'
import type { LessonStyleDefinition, LessonStyleId } from './lesson-style-themes/types'

export { buildLessonCss } from './lesson-style-themes/base'
export { LESSON_FLASHCARD_CSS, LESSON_FLASHCARD_JS, LESSON_QUIZ_JS } from './lesson-style-themes/assets'
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
export { DEFAULT_LESSON_STYLE_ID, LESSON_STYLE_IDS }
export type { LessonStyleDefinition, LessonStyleId, LessonStyleTokens } from './lesson-style-themes/types'

export const LESSON_STYLES: readonly LessonStyleDefinition[] = [
  MANUSCRIPT_STYLE,
  CHALKBOARD_STYLE,
  EDITORIAL_STYLE,
  BLUEPRINT_STYLE,
  POSTER_STYLE,
  CLASSIC_STYLE,
  NIGHTFALL_STYLE,
  PAPER_STYLE,
  VIVID_STYLE,
  MONO_STYLE,
  TERMINAL_STYLE
]

export function isLessonStyleId(value: unknown): value is LessonStyleId {
  return typeof value === 'string' && (LESSON_STYLE_IDS as readonly string[]).includes(value)
}

export function normalizeLessonStyleId(value: unknown): LessonStyleId {
  return isLessonStyleId(value) ? value : DEFAULT_LESSON_STYLE_ID
}

export function lessonStyleCss(styleId: unknown): string {
  const id = normalizeLessonStyleId(styleId)
  return LESSON_STYLES.find((style) => style.id === id)!.css
}
