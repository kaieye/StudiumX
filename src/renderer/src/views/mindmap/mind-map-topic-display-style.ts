import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'
import type { MindMapTheme, MindMapTopicStyleOverride } from '../../../../shared/mindmap/domain/types'
import { resolveShape } from './mind-map-node-shapes'
import { defaultTopicTextAlign, resolveEffectiveTopicStyle } from './mind-map-topic-style'

const LIGHT_APPEARANCE = {
  surface: '#FFFFFF',
  text: '#24324A',
  subtopicFill: '#F8F7F7'
} as const

const DARK_APPEARANCE = {
  surface: '#18181B',
  text: '#F2F2F3',
  subtopicFill: '#29292C'
} as const

export const DEFAULT_TOPIC_FONT_FAMILY = 'Inter, "SF Pro Text", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, -apple-system, sans-serif'

export type MindMapTopicDisplayStyle = {
  shape: string
  fill: string
  fillPattern: NonNullable<MindMapTopicStyleOverride['fillPattern']>
  stroke: string
  borderStyle: NonNullable<MindMapTopicStyleOverride['borderStyle']>
  borderWidth: number
  textColor: string
  fontFamily: string
  fontSize: number
  fontWeight: string
  textTransform: NonNullable<MindMapTopicStyleOverride['textTransform']>
  textAlign: NonNullable<MindMapTopicStyleOverride['textAlign']>
  widthMode: NonNullable<MindMapTopicStyleOverride['widthMode']>
  structureClass: MindMapStructureClass
}

type MindMapTopicDisplayStyleOptions = {
  branchColor: string | null
  structureClass: MindMapStructureClass
  darkAppearance: boolean
}

/**
 * Resolve the concrete values a topic currently presents on the canvas.
 *
 * Topic-local and depth-theme values use the same precedence as the canvas.
 * The remaining fallbacks mirror the canvas CSS so inspector controls describe
 * what learners can see instead of where an unset field came from.
 */
export function resolveTopicDisplayStyle(
  nodeStyle: MindMapTopicStyleOverride | undefined,
  theme: MindMapTheme,
  depth: number,
  options: MindMapTopicDisplayStyleOptions
): MindMapTopicDisplayStyle {
  const style = resolveEffectiveTopicStyle(nodeStyle, theme, depth) ?? {}
  const appearance = options.darkAppearance ? DARK_APPEARANCE : LIGHT_APPEARANCE
  const structureClass = nodeStyle?.structureClass ?? options.structureClass
  const borderStyle = style.borderStyle
    ?? (style.stroke !== undefined || depth === 0 ? 'solid' : 'none')
  // The canvas currently resolves shape from a topic-local override only.
  // Keep the inspector aligned with that rendered default rather than exposing
  // theme.shape before the renderer consumes it.
  const shape = resolveShape(nodeStyle?.shape)

  return {
    shape: shape === 'no-shape' ? 'none' : shape,
    fill: style.fill
      ?? (depth === 1 && options.branchColor ? options.branchColor : undefined)
      ?? (depth === 0 ? appearance.surface : appearance.subtopicFill),
    fillPattern: style.fillPattern ?? 'solid',
    stroke: style.stroke
      ?? (style.borderStyle ? theme.lineColor ?? '#8E8E93' : undefined)
      ?? (depth === 0 ? theme.lineColor ?? appearance.text : undefined)
      ?? options.branchColor
      ?? '#8E8E93',
    borderStyle,
    borderWidth: style.borderWidth ?? 2,
    textColor: style.textColor
      ?? (depth === 1 ? '#FFFFFF' : theme.textColor ?? appearance.text),
    fontFamily: style.fontFamily ?? DEFAULT_TOPIC_FONT_FAMILY,
    fontSize: style.fontSize ?? (depth === 0 ? 26 : depth === 1 ? 16 : 13),
    fontWeight: style.fontWeight ?? (depth === 0 ? '600' : '500'),
    textTransform: style.textTransform ?? 'none',
    textAlign: style.textAlign ?? defaultTopicTextAlign(structureClass, depth),
    // Width sizing is applied by the layout before theme styles reach the
    // canvas, so only a topic-local fixed width can affect the rendered node.
    widthMode: nodeStyle?.widthMode ?? 'auto',
    structureClass
  }
}
