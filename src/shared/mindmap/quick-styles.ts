import type { MindMapTopicStyleOverride } from './domain/types'

/**
 * Visual-only topic quick styles. These presets intentionally never touch
 * planning metadata, labels, notes, or the canonical topic title.
 */
export type MindMapQuickStylePreset =
  | 'default'
  | 'important'
  | 'very-important'
  | 'strikethrough'

/** Stable, high-contrast visual tokens used by the built-in quick styles. */
export const MIND_MAP_QUICK_STYLE_TOKENS = {
  important: {
    fill: '#FFF3BF',
    textColor: '#6B4E00',
    fontWeight: '700'
  },
  veryImportant: {
    fill: '#FFD6D6',
    textColor: '#8B1E1E',
    fontWeight: '700',
    borderStyle: 'solid',
    borderWidth: 2
  }
} as const satisfies Record<string, Partial<MindMapTopicStyleOverride>>

/**
 * Apply one visual quick style to a topic-local style snapshot.
 *
 * Important and very-important intentionally update only their visual emphasis
 * fields, preserving unrelated local formatting. Strikethrough likewise
 * preserves fill, shape, typography and layout overrides. Default is the
 * explicit reset action and removes the complete local style snapshot so the
 * topic returns to theme/structure inheritance.
 */
export function applyMindMapQuickStyle(
  current: MindMapTopicStyleOverride | undefined,
  preset: MindMapQuickStylePreset
): MindMapTopicStyleOverride | null {
  if (preset === 'default') return null

  const next: MindMapTopicStyleOverride = { ...(current ?? {}) }
  if (preset === 'important') {
    Object.assign(next, MIND_MAP_QUICK_STYLE_TOKENS.important)
  } else if (preset === 'very-important') {
    Object.assign(next, MIND_MAP_QUICK_STYLE_TOKENS.veryImportant)
  } else {
    // Keep an existing underline when adding the independent strikethrough flag.
    next.textDecoration = next.textDecoration?.split(/\s+/).includes('underline')
      ? 'line-through underline'
      : 'line-through'
  }
  return Object.keys(next).length > 0 ? next : null
}
