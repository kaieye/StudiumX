/**
 * Pure renderer-side adapter from the existing layout result to the shared
 * SVG export input. Keeping this seam separate means the serializer does not
 * import renderer types, while the eventual export action can reuse the exact
 * layout already visible on the canvas.
 */
import type { MindMapSvgExportInput } from '../../../../shared/mindmap/svg-export'
import type { MindMapElement } from '../../../../shared/mindmap/domain/types'
import type { MindMapLayoutResult } from './mind-map-layout'

export function mindMapLayoutToSvgInput(
  title: string,
  layout: MindMapLayoutResult,
  elements: readonly MindMapElement[] = []
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

  return {
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
}
