import type {
  MindMapNode,
  MindMapSheet,
  MindMapStructureClass
} from '../../../../shared/mindmap/mind-map-types'

/**
 * Pure, deterministic O(n) tree layout for a mind-map sheet.
 *
 * This module has no React / DOM / IPC dependencies so it can be unit-tested
 * in isolation. The layout reads the sheet's `structureClass` to decide the
 * direction children spread from their parent:
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
}

export type MindMapLayoutEdge = {
  from: string
  to: string
}

export type MindMapLayoutResult = {
  nodes: MindMapLayoutNode[]
  edges: MindMapLayoutEdge[]
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
function subtreeHeight(node: MindMapNode): number {
  if (node.collapsed || node.children.length === 0) return MIND_MAP_NODE_HEIGHT
  let total = MIND_MAP_VERTICAL_GAP
  for (const child of node.children) {
    total += subtreeHeight(child) + MIND_MAP_VERTICAL_GAP
  }
  return Math.max(MIND_MAP_NODE_HEIGHT, total)
}

function assignLayout(
  node: MindMapNode,
  centerX: number,
  topY: number,
  depth: number,
  inheritedStructureClass: MindMapStructureClass,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[]
): void {
  const structureClass = node.structureClass ?? inheritedStructureClass
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
    note: node.note
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

export function computeMindMapLayout(sheet: MindMapSheet): MindMapLayoutResult {
  const nodes: MindMapLayoutNode[] = []
  const edges: MindMapLayoutEdge[] = []
  assignLayout(sheet.root, 0, 0, 0, sheet.structureClass, nodes, edges)
  return { nodes, edges }
}