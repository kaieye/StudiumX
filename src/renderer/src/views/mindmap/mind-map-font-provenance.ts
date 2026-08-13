import type {
  MindMapTheme,
  MindMapTopicStyleOverride
} from '../../../../shared/mindmap/domain/types'
import { topicStyleLayerForDepth } from './mind-map-topic-style'

/**
 * The origin of a font family after applying the same precedence as the
 * canvas: local topic override > document font > depth theme layer > app CSS.
 */
export type MindMapFontSource =
  | 'local'
  | 'document'
  | 'theme-layer'
  | 'app-fallback'
  | 'mixed'

export type MindMapResolvedTopicFont = {
  source: MindMapFontSource
  /** Undefined means the canvas will use the application CSS fallback. */
  fontFamily?: string
  /**
   * True when an imported/custom font stack is outside StudiumX's managed
   * choices. This is intentionally not a claim about OS font installation:
   * browsers cannot reliably distinguish a requested family from its fallback
   * in every renderer/runtime.
   */
  mayFallback: boolean
}

export type MindMapTopicFontContext = {
  nodeStyle?: MindMapTopicStyleOverride
  depth: number
}

/** Font stacks deliberately offered by the current document/topic controls. */
const MANAGED_FONT_FAMILIES = new Set([
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  'Arial, Helvetica, sans-serif',
  'Inter, system-ui, sans-serif',
  '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  '"Noto Serif CJK SC", "Songti SC", SimSun, serif',
  "Georgia, 'Times New Roman', serif",
  'ui-serif, Georgia, "Times New Roman", serif',
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  'ui-monospace, SFMono-Regular, Menlo, monospace'
])

function normalizedFontFamily(fontFamily: string | undefined): string | undefined {
  const normalized = fontFamily?.trim()
  return normalized || undefined
}

/** Whether a requested stack is intentionally managed by a native font control. */
export function isManagedMindMapFontFamily(fontFamily: string | undefined): boolean {
  const normalized = normalizedFontFamily(fontFamily)
  return normalized !== undefined && MANAGED_FONT_FAMILIES.has(normalized)
}

/** Resolve font provenance for one topic without changing the persisted style model. */
export function resolveTopicFontProvenance(
  nodeStyle: MindMapTopicStyleOverride | undefined,
  theme: MindMapTheme,
  depth: number
): MindMapResolvedTopicFont {
  const localFont = normalizedFontFamily(nodeStyle?.fontFamily)
  if (localFont) {
    return {
      source: 'local',
      fontFamily: localFont,
      mayFallback: !isManagedMindMapFontFamily(localFont)
    }
  }

  const documentFont = normalizedFontFamily(theme.fontFamily)
  if (documentFont) {
    return {
      source: 'document',
      fontFamily: documentFont,
      mayFallback: !isManagedMindMapFontFamily(documentFont)
    }
  }

  const themeLayerFont = normalizedFontFamily(topicStyleLayerForDepth(theme, depth)?.fontFamily)
  if (themeLayerFont) {
    return {
      source: 'theme-layer',
      fontFamily: themeLayerFont,
      mayFallback: !isManagedMindMapFontFamily(themeLayerFont)
    }
  }

  return { source: 'app-fallback', mayFallback: false }
}

/**
 * Resolve font status for an inspector selection. A mixed source/value is
 * reported explicitly rather than choosing the primary topic's font.
 */
export function resolveSelectedTopicFontProvenance(
  topics: readonly MindMapTopicFontContext[],
  theme: MindMapTheme
): MindMapResolvedTopicFont {
  if (topics.length === 0) return { source: 'app-fallback', mayFallback: false }

  const resolved = topics.map(({ nodeStyle, depth }) =>
    resolveTopicFontProvenance(nodeStyle, theme, depth)
  )
  const [first] = resolved
  if (resolved.every((value) => value.source === first.source && value.fontFamily === first.fontFamily)) {
    return first
  }

  return {
    source: 'mixed',
    mayFallback: resolved.some((value) => value.mayFallback)
  }
}
