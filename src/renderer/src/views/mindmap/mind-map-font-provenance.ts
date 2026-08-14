import type {
  MindMapDocumentV2,
  MindMapSheetV2,
  MindMapTheme,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'
import { SAFE_FONT_STACKS } from './mind-map-font-list'
import { topicStyleLayerForDepth } from './mind-map-topic-style'
import { resolveShapeWithReport } from './mind-map-node-shapes'
import { resolveLinePatternWithReport } from './mind-map-edge-styles'

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

/**
 * Font stacks deliberately offered by the current document/topic controls.
 * Derived from the searchable font catalogue so a stack chosen in the picker
 * is never mis-flagged as an unmanaged import.
 */
const MANAGED_FONT_FAMILIES = new Set(SAFE_FONT_STACKS)

function normalizedFontFamily(fontFamily: string | undefined): string | undefined {
  const normalized = fontFamily?.trim()
  return normalized || undefined
}

/** Whether a requested stack is intentionally managed by a native font control. */
export function isManagedMindMapFontFamily(fontFamily: string | undefined): boolean {
  const normalized = normalizedFontFamily(fontFamily)
  return normalized !== undefined && MANAGED_FONT_FAMILIES.has(normalized)
}

/**
 * Effective font stack the canvas will request for a document that carries no
 * per-topic override. Returns undefined when every layer resolves to the app
 * CSS default. Conservative: an unmanaged stack is preserved verbatim and may
 * fall back per CSS rules — the helper never claims OS font detection.
 */
export function effectiveDocumentFontStack(
  theme: MindMapTheme
): { fontFamily?: string; mayFallback: boolean } {
  const themeLayerSource = Object.values(theme.topicStyles ?? {})
    .filter((style): style is MindMapTopicStyleOverride => Boolean(style?.fontFamily))
    .map((style) => normalizedFontFamily(style.fontFamily))
  const candidates = [
    normalizedFontFamily(theme.fontFamily),
    ...themeLayerSource
  ].filter((value): value is string => value !== undefined)
  const fontFamily = candidates[0]
  return {
    fontFamily,
    mayFallback: fontFamily !== undefined && !isManagedMindMapFontFamily(fontFamily)
  }
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

/**
 * One value-free compatibility finding for a document/sheet that requested a
 * shape or branch line-pattern token the renderer does not support, or a font
 * stack outside the managed set. The `path` is a stable property path into the
 * document (e.g. `sheets[0].root.children[1].style.shape`); `degradedTo` is the
 * stable fallback token actually rendered. Font findings are conservative
 * warnings (`mayFallback: true`) and never claim OS font detection.
 */
export type MindMapDegradationFinding = {
  /** Stable dotted path into the document/sheet (value-free, index-based). */
  path: string
  /** The style field that did not resolve to its requested token. */
  field: 'shape' | 'linePattern' | 'fontFamily'
  /** Stable fallback token the renderer actually uses (e.g. `rounded-rect`). */
  degradedTo: string
  /** True only for font findings: conservative "may fall back" warning. */
  mayFallback?: boolean
}

function walkTopicDegradations(
  topic: MindMapTopicV2,
  path: string,
  out: MindMapDegradationFinding[]
): void {
  const style = topic.style
  if (style?.shape !== undefined) {
    const resolved = resolveShapeWithReport(style.shape)
    if (resolved.degraded) {
      out.push({
        path: `${path}.style.shape`,
        field: 'shape',
        degradedTo: resolved.shape
      })
    }
  }
  if (style?.fontFamily !== undefined && !isManagedMindMapFontFamily(style.fontFamily)) {
    out.push({
      path: `${path}.style.fontFamily`,
      field: 'fontFamily',
      degradedTo: 'css-stack-fallback',
      mayFallback: true
    })
  }
  topic.children.forEach((child, index) => {
    walkTopicDegradations(child, `${path}.children[${index}]`, out)
  })
}

/**
 * Walk one sheet (topic tree + layout + theme layer defaults) and return the
 * value-free list of style degradations. Never throws, even for pathological
 * documents; unknown tokens fall back to stable renderer defaults and are
 * reported here instead of silently distorting.
 */
export function resolveSheetDegradations(
  sheet: MindMapSheetV2,
  theme: MindMapTheme,
  sheetIndex: number
): MindMapDegradationFinding[] {
  const out: MindMapDegradationFinding[] = []
  const base = `sheets[${sheetIndex}]`

  if (sheet.layout.linePattern !== undefined) {
    const resolved = resolveLinePatternWithReport(sheet.layout.linePattern)
    if (resolved.degraded) {
      out.push({
        path: `${base}.layout.linePattern`,
        field: 'linePattern',
        degradedTo: 'solid'
      })
    }
  }

  // Theme layer defaults also contribute a default shape / font per depth. Only
  // flag explicit theme-layer fonts/shapes that the renderer cannot honour.
  const layers: Array<[string, MindMapTopicStyleOverride | undefined]> = [
    ['central', theme.topicStyles?.central],
    ['main', theme.topicStyles?.main],
    ['sub', theme.topicStyles?.sub]
  ]
  for (const [layerName, layer] of layers) {
    if (layer?.shape !== undefined) {
      const resolved = resolveShapeWithReport(layer.shape)
      if (resolved.degraded) {
        out.push({
          path: `${base}.theme.topicStyles.${layerName}.shape`,
          field: 'shape',
          degradedTo: resolved.shape
        })
      }
    }
    if (layer?.fontFamily !== undefined && !isManagedMindMapFontFamily(layer.fontFamily)) {
      out.push({
        path: `${base}.theme.topicStyles.${layerName}.fontFamily`,
        field: 'fontFamily',
        degradedTo: 'css-stack-fallback',
        mayFallback: true
      })
    }
  }

  if (theme.shape !== undefined) {
    const resolved = resolveShapeWithReport(theme.shape)
    if (resolved.degraded) {
      out.push({ path: `${base}.theme.shape`, field: 'shape', degradedTo: resolved.shape })
    }
  }
  if (theme.fontFamily !== undefined && !isManagedMindMapFontFamily(theme.fontFamily)) {
    out.push({
      path: `${base}.theme.fontFamily`,
      field: 'fontFamily',
      degradedTo: 'css-stack-fallback',
      mayFallback: true
    })
  }

  walkTopicDegradations(sheet.root, `${base}.root`, out)
  return out
}

/**
 * Walk a whole document and return the stable, value-free degradation list for
 * unknown shapes, branch line-patterns and unmanaged font stacks across every
 * sheet. The document always "opens": this resolver never throws and every
 * unknown token falls back to a stable renderer default (reported here).
 */
export function resolveDocumentDegradations(
  document: MindMapDocumentV2
): MindMapDegradationFinding[] {
  const out: MindMapDegradationFinding[] = []
  document.sheets.forEach((sheet, index) => {
    out.push(...resolveSheetDegradations(sheet, document.theme, index))
  })
  return out
}
