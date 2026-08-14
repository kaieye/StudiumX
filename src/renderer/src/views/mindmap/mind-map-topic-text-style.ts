import type { CSSProperties } from 'react'
import type { MindMapTopicStyleOverride } from '../../../../shared/mindmap/domain/types'

const DEFAULT_TOPIC_FONT_SIZE = {
  root: 26,
  branch: 16,
  subtopic: 13
} as const

function defaultFontSize(depth: number): number {
  if (depth === 0) return DEFAULT_TOPIC_FONT_SIZE.root
  if (depth === 1) return DEFAULT_TOPIC_FONT_SIZE.branch
  return DEFAULT_TOPIC_FONT_SIZE.subtopic
}

export function resolveMindMapTopicTextStyle(
  depth: number,
  style: MindMapTopicStyleOverride | undefined
): CSSProperties {
  return {
    fontFamily: style?.fontFamily ?? 'var(--mindmap-theme-font, inherit)',
    fontSize: `${style?.fontSize ?? defaultFontSize(depth)}px`,
    fontWeight: style?.fontWeight ?? (depth === 0 ? '600' : '500'),
    ...(style?.fontStyle ? { fontStyle: style.fontStyle } : {}),
    ...(style?.textDecoration ? { textDecoration: style.textDecoration } : {}),
    ...(style?.textTransform ? { textTransform: style.textTransform } : {}),
    ...(depth === 0 ? { letterSpacing: '0.01em' } : {})
  }
}

export function resolveMindMapTopicTextColor(
  depth: number,
  style: MindMapTopicStyleOverride | undefined
): string {
  if (style?.textColor) return style.textColor
  return depth === 1 ? '#ffffff' : 'var(--mindmap-theme-text, var(--text))'
}
