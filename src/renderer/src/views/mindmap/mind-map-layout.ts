import type {
  MindMapStructureClass
} from '../../../../shared/mindmap/mind-map-types'
import type {
  MindMapCallout,
  MindMapMarker,
  MindMapSheetV2,
  MindMapSummary,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'

/**
 * Pure, deterministic O(n) tree layout for a v2 mind-map sheet.
 *
 * This module has no React / DOM / IPC dependencies so it can be unit-tested
 * in isolation. The layout reads the sheet's `layout.structureClass` to decide
 * the direction children spread from their parent:
 *
 * - `…right`  — all children to the right (+x)
 * - `…left`   — all children to the left (−x)
 * - `…balanced` / `…map` — children alternate right/left so the tree spreads
 *   across both sides of the root
 * - `…down` / `…up` — children are placed to the right (a minimal, deterministic
 *   fallback for these vertical structures; per-node overrides still apply)
 *
 * `collapsed` nodes are still emitted (rendered with a collapse badge) but their
 * descendants are not visited, so collapse hides the subtree with no reflow cost.
 */

export type MindMapLayoutNode = {
  id: string
  title: string
  /** Top-left corner of the node rect (SVG user-space). */
  x: number
  y: number
  width: number
  height: number
  /** 0 = root, increasing away from it. */
  depth: number
  collapsed: boolean
  note?: string
  /** Small, accessible XMind-style marker badges attached to the topic. */
  markers?: MindMapMarker[]
}

export type MindMapLayoutEdge = {
  from: string
  to: string
}

/** A sheet-level relationship connector projected into layout coordinates. */
export type MindMapLayoutRelationship = {
  id: string
  from: string
  to: string
  label?: string
}

/** A topic annotation projected into layout coordinates. */
export type MindMapLayoutCallout = {
  id: string
  topicId: string
  text: string
  position?: { x: number; y: number }
}

/** A sheet-level brace summary projected into layout coordinates. */
export type MindMapLayoutSummary = {
  id: string
  from: string
  to: string
  label?: string
}

export type MindMapLayoutResult = {
  nodes: MindMapLayoutNode[]
  edges: MindMapLayoutEdge[]
  relationships: MindMapLayoutRelationship[]
  callouts: MindMapLayoutCallout[]
  summaries: MindMapLayoutSummary[]
}

export const MIND_MAP_NODE_WIDTH = 160
export const MIND_MAP_NODE_HEIGHT = 40
/** Horizontal gap between the edge of a parent and the edge of its child. */
export const MIND_MAP_HORIZONTAL_GAP = 80
/** Vertical gap between sibling subtrees. */
export const MIND_MAP_VERTICAL_GAP = 16

/** Horizontal center offset of a child relative to its parent's center. */
const CHILD_STEP_X = MIND_MAP_NODE_WIDTH + MIND_MAP_HORIZONTAL_GAP

/** Direction (in x units) applied to each child index for a given structure. */
function childDirections(
  structureClass: MindMapStructureClass,
  childCount: number
): number[] {
  if (structureClass === 'org.xmind.ui.logic.left') {
    return new Array<number>(childCount).fill(-1)
  }
  if (
    structureClass === 'org.xmind.ui.logic.balanced' ||
    structureClass === 'org.xmind.ui.logic.map'
  ) {
    // Alternate right/left, starting right. With ≥2 children both sides appear
    // (negative x for the odd-indexed children), satisfying the balanced layout.
    return Array.from({ length: childCount }, (_, index) => (index % 2 === 0 ? 1 : -1))
  }
  // right / down / up all fan to the right in this minimal layout.
  return new Array<number>(childCount).fill(1)
}

/** Total vertical extent of a node and its (expanded) descendants. */
function subtreeHeight(node: MindMapTopicV2): number {
  if (node.collapsed || node.children.length === 0) return MIND_MAP_NODE_HEIGHT
  let total = MIND_MAP_VERTICAL_GAP
  for (const child of node.children) {
    total += subtreeHeight(child) + MIND_MAP_VERTICAL_GAP
  }
  return Math.max(MIND_MAP_NODE_HEIGHT, total)
}

function assignLayout(
  node: MindMapTopicV2,
  centerX: number,
  topY: number,
  depth: number,
  inheritedStructureClass: MindMapStructureClass,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[]
): void {
  const structureClass = node.style?.structureClass ?? inheritedStructureClass
  const isCollapsed = node.collapsed === true

  nodes.push({
    id: node.id,
    title: node.title,
    x: centerX - MIND_MAP_NODE_WIDTH / 2,
    y: topY,
    width: MIND_MAP_NODE_WIDTH,
    height: MIND_MAP_NODE_HEIGHT,
    depth,
    collapsed: isCollapsed,
    note: node.note,
    ...(node.markers && node.markers.length > 0
      ? {
          markers: node.markers.map(({ id, symbol, label }) => ({
            id,
            symbol,
            ...(label !== undefined ? { label } : {})
          }))
        }
      : {})
  })

  if (isCollapsed || node.children.length === 0) return

  const directions = childDirections(structureClass, node.children.length)
  let childTop = topY
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    const childHeight = subtreeHeight(child)
    const childCenterX = centerX + directions[index] * CHILD_STEP_X
    edges.push({ from: node.id, to: child.id })
    assignLayout(
      child,
      childCenterX,
      childTop,
      depth + 1,
      structureClass,
      nodes,
      edges
    )
    childTop += childHeight + MIND_MAP_VERTICAL_GAP
  }
}

export function computeMindMapLayout(sheet: MindMapSheetV2): MindMapLayoutResult {
  const nodes: MindMapLayoutNode[] = []
  const edges: MindMapLayoutEdge[] = []
  const relationships = sheet.elements
    .filter((element) => element.type === 'relationship')
    .map(({ id, from, to, label }) => ({
      id,
      from,
      to,
      ...(label !== undefined ? { label } : {})
    }))
  const callouts = sheet.elements
    .filter((element): element is MindMapCallout => element.type === 'callout')
    .map(({ id, topicId, text, position }) => ({
      id,
      topicId,
      text,
      ...(position !== undefined ? { position: { ...position } } : {})
    }))
  const summaries = sheet.elements
    .filter((element): element is MindMapSummary => element.type === 'summary')
    .map(({ id, from, to, label }) => ({
      id,
      from,
      to,
      ...(label !== undefined ? { label } : {})
    }))
  assignLayout(
    sheet.root,
    0,
    0,
    0,
    sheet.layout.structureClass,
    nodes,
    edges
  )
  return { nodes, edges, relationships, callouts, summaries }
}
