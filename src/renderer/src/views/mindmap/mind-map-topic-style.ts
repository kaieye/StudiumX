import type {
  MindMapTheme,
  MindMapTopicStyleOverride
} from '../../../../shared/mindmap/domain/types'
import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'

/** Return the theme style layer inherited by a topic at the given tree depth. */
export function topicStyleLayerForDepth(
  theme: MindMapTheme,
  depth: number
): MindMapTopicStyleOverride | undefined {
  return depth === 0
    ? theme.topicStyles?.central
    : depth === 1
      ? theme.topicStyles?.main
      : theme.topicStyles?.sub
}

/**
 * Resolve the style painted by the canvas.
 *
 * Priority is local topic override > document font override > depth theme layer.
 * Keeping this resolver shared prevents the inspector from reporting a state
 * that differs from what the canvas actually renders.
 */
export function resolveEffectiveTopicStyle(
  nodeStyle: MindMapTopicStyleOverride | undefined,
  theme: MindMapTheme,
  depth: number
): MindMapTopicStyleOverride | undefined {
  const merged = { ...(topicStyleLayerForDepth(theme, depth) ?? {}), ...(nodeStyle ?? {}) }

  if (theme.fontFamily && !nodeStyle?.fontFamily) merged.fontFamily = theme.fontFamily

  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Structural fallback for labels without an explicit or themed alignment.
 * Root and vertical/two-sided structures stay centred; one-sided horizontal
 * trees align text toward their outgoing branch direction.
 */
export function defaultTopicTextAlign(
  structureClass: MindMapStructureClass,
  depth: number
): NonNullable<MindMapTopicStyleOverride['textAlign']> {
  if (depth === 0) return 'center'
  if (structureClass.includes('.left')) return 'right'
  if (structureClass.includes('.right')) return 'left'
  return 'center'
}

/** Normalize legacy CSS keyword weights to the numeric tokens used by the UI. */
export function normalizeTopicFontWeight(fontWeight: string | undefined): string | undefined {
  if (fontWeight === 'normal') return '400'
  if (fontWeight === 'bold') return '700'
  return fontWeight
}

export function isBoldTopicFontWeight(fontWeight: string | undefined): boolean {
  return normalizeTopicFontWeight(fontWeight) === '700'
}

export type MindMapTextDecorationFlag = 'underline' | 'line-through'

/** Return whether a controlled topic-decoration token enables one independent flag. */
export function hasTopicTextDecoration(
  textDecoration: MindMapTopicStyleOverride['textDecoration'],
  flag: MindMapTextDecorationFlag
): boolean {
  return textDecoration?.split(/\s+/).includes(flag) ?? false
}

export function normalizeTopicTextDecoration(
  textDecoration: MindMapTopicStyleOverride['textDecoration']
): NonNullable<MindMapTopicStyleOverride['textDecoration']> {
  const underline = hasTopicTextDecoration(textDecoration, 'underline')
  const lineThrough = hasTopicTextDecoration(textDecoration, 'line-through')
  if (underline && lineThrough) return 'line-through underline'
  if (underline) return 'underline'
  if (lineThrough) return 'line-through'
  return 'none'
}

/** Toggle one decoration without disturbing the other and return the canonical persisted token. */
export function updateTopicTextDecoration(
  textDecoration: MindMapTopicStyleOverride['textDecoration'],
  flag: MindMapTextDecorationFlag,
  enabled: boolean
): NonNullable<MindMapTopicStyleOverride['textDecoration']> {
  const underline = flag === 'underline'
    ? enabled
    : hasTopicTextDecoration(textDecoration, 'underline')
  const lineThrough = flag === 'line-through'
    ? enabled
    : hasTopicTextDecoration(textDecoration, 'line-through')

  return normalizeTopicTextDecoration(
    underline && lineThrough
      ? 'line-through underline'
      : underline
        ? 'underline'
        : lineThrough
          ? 'line-through'
          : 'none'
  )
}
