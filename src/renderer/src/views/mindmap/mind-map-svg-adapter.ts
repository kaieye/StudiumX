/**
 * Pure renderer-side adapter from the existing layout result to the shared
 * SVG export input. Keeping this seam separate means the serializer does not
 * import renderer types, while the eventual export action can reuse the exact
 * layout already visible on the canvas.
 *
 * The optional `options` argument carries the resolved canvas appearance so
 * the exported artifact and the live canvas share one resolved style instead
 * of a second hardcoded export palette.
 */
import type {
  MindMapSvgExportInput,
  MindMapSvgExportOptions
} from '../../../../shared/mindmap/svg-export'
import type { MindMapElement, MindMapTheme } from '../../../../shared/mindmap/domain/types'
import type { MindMapLayoutResult } from './mind-map-layout'
import { branchColor } from './mind-map-branch-colors'
import { resolveEffectiveTopicStyle } from './mind-map-topic-style'

/** Light fallback used when the theme background is absent or transparent. */
const DEFAULT_EXPORT_BACKGROUND = '#ffffff'

/**
 * Resolve the shared SVG export options from the document theme exactly the
 * way the canvas resolves node appearance, so export does not maintain a
 * second hardcoded palette:
 *
 * - `background` = resolved theme background (transparent/absent -> light default;
 *   opaque 8-digit hex kept, semi-transparent 8-digit hex flattened to solid).
 * - `nodeFill` / `nodeStroke` / `textColor` / `fontFamily` = the resolved
 *   central-topic style (theme.topicStyles.central merged with the document
 *   font override), matching `MindMapCanvas` via `resolveEffectiveTopicStyle`.
 * - `edgeStroke` = the level-1 branch colour via `branchColor(theme, 0)`
 *   (rainbow palette index 0, or `theme.lineColor` when rainbow is disabled).
 *
 * Per-depth branch fills are intentionally kept as one coherent document
 * palette for this L-10 step: the layout nodes carry `branchIndex`, so a
 * per-node style map could be layered on later without changing this contract.
 */
export function mindMapResolvedSvgOptions(theme: MindMapTheme): MindMapSvgExportOptions {
  const central = resolveEffectiveTopicStyle(undefined, theme, 0) ?? {}
  return {
    background: resolveExportBackground(theme.background),
    nodeFill: central.fill,
    nodeStroke: central.stroke,
    textColor: central.textColor ?? theme.textColor,
    edgeStroke: branchColor(theme, 0) ?? undefined,
    fontFamily: central.fontFamily ?? theme.fontFamily
  }
}

function resolveExportBackground(background: string | undefined): string | undefined {
  if (!background || background === 'transparent') return DEFAULT_EXPORT_BACKGROUND
  const opaqueHex = /^#([0-9a-f]{6})ff$/i.exec(background)
  if (opaqueHex) return background
  const alphaHex = /^#([0-9a-f]{6})[0-9a-f]{2}$/i.exec(background)
  if (alphaHex) return `#${alphaHex[1]}`
  return background
}

export function mindMapLayoutToSvgInput(
  title: string,
  layout: MindMapLayoutResult,
  elements: readonly MindMapElement[] = [],
  options?: MindMapSvgExportOptions
): MindMapSvgExportInput {
  const visibleNodeIds = new Set(layout.nodes.map((node) => node.id))
  const relationshipEdges = elements
    .filter((element): element is Extract<MindMapElement, { type: 'relationship' }> => element.type === 'relationship')
    .filter((relationship) => visibleNodeIds.has(relationship.from) && visibleNodeIds.has(relationship.to))
    .map((relationship) => ({
      from: relationship.from,
      to: relationship.to,
      ...(relationship.label !== undefined ? { label: relationship.label } : {})
    }))

  const input: MindMapSvgExportInput = {
    title,
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      collapsed: node.collapsed
    })),
    edges: [
      ...layout.edges.map((edge) => ({
        from: edge.from,
        to: edge.to
      })),
      ...relationshipEdges
    ]
  }
  if (options && Object.keys(options).length > 0) {
    input.options = options
  }
  return input
}
