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
import type { LessonStyleDefinition, LessonStyleId } from './lesson-style-themes/types'

/**
 * The ordered style catalog and its lookup policy. Consumers only need the
 * catalog values or the three lookup operations; index construction and
 * catalog validation remain internal to this module.
 */
export class LessonStyleRegistry {
  private readonly stylesById: ReadonlyMap<LessonStyleId, LessonStyleDefinition>
  readonly styles: readonly LessonStyleDefinition[]
  readonly ids: readonly LessonStyleId[]
  readonly defaultId: LessonStyleId

  constructor(styles: readonly LessonStyleDefinition[], defaultId: LessonStyleId) {
    if (styles.length === 0) {
      throw new Error('Lesson style registry requires at least one definition.')
    }

    const stylesById = new Map<LessonStyleId, LessonStyleDefinition>()
    for (const style of styles) {
      if (stylesById.has(style.id)) {
        throw new Error(`Lesson style registry contains duplicate id "${style.id}".`)
      }
      stylesById.set(style.id, style)
    }

    if (!stylesById.has(defaultId)) {
      throw new Error(`Lesson style registry default id "${defaultId}" is not registered.`)
    }

    this.styles = styles
    this.ids = styles.map((style) => style.id)
    this.defaultId = defaultId
    this.stylesById = stylesById
  }

  isStyleId(value: unknown): value is LessonStyleId {
    return typeof value === 'string' && this.stylesById.has(value as LessonStyleId)
  }

  normalize(value: unknown): LessonStyleId {
    return this.isStyleId(value) ? value : this.defaultId
  }

  css(value: unknown): string {
    return this.stylesById.get(this.normalize(value))!.css
  }
}

const orderedLessonStyles = [
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
] as const satisfies readonly LessonStyleDefinition[]

export const DEFAULT_LESSON_STYLE_ID: LessonStyleId = 'classic'

export const lessonStyleRegistry = new LessonStyleRegistry(orderedLessonStyles, DEFAULT_LESSON_STYLE_ID)

/** Ordered definitions retained for callers that render the style gallery. */
export const LESSON_STYLES: readonly LessonStyleDefinition[] = lessonStyleRegistry.styles

/** IDs derived from the ordered registry definitions rather than maintained separately. */
export const LESSON_STYLE_IDS: readonly LessonStyleId[] = lessonStyleRegistry.ids
