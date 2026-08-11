import type {
  MindMapStructureClass
} from '../../../../shared/mindmap/mind-map-types'
import { getLayoutStrategy } from '../../../../shared/mindmap/structure-types'
import type {
  MindMapBoundary,
  MindMapCallout,
  MindMapElementStyle,
  MindMapMarker,
  MindMapSheetV2,
  MindMapSummary,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'

/**
 * Pure, deterministic O(n) tree layout for a v2 mind-map sheet.
 *
 * This module has no React / DOM / IPC dependencies so it can be unit-tested
 * in isolation. The layout reads the sheet's `layout.structureClass` to decide
 * the direction children spread from their parent:
 *
 * - `…right`  - all children to the right (+x)
 * - `…left`   - all children to the left (−x)
 * - `…balanced` / `…map` - children alternate right/left so the tree spreads
 *   across both sides of the root (this is the default for new sheets)
 * - `…down` / `…up` - children are placed below/above the parent
 *
 * For the horizontal structures (right / left / balanced / map) the children of
 * a node are vertically centered around the parent's midline so the subtree
 * spreads symmetrically above and below the parent.  For two-sided structures
 * (balanced / map) the left-side and right-side groups are centered
 * independently, matching Xmind's layout at every depth.
 *
 * `collapsed` nodes are still emitted (rendered with a collapse badge) but their
 * descendants are not visited, so collapse hides the subtree with no reflow cost.
 *
 * Node dimensions auto-size to the title text (matching Xmind), while branch
 * indices are computed for per-branch colour assignment.
 */

// ---- text measurement (pure, no DOM) ----
//
// v2 §4.2: Font sizes follow Xmind M01's 2 : 1.43 : 1 tier ratio (28/20/14pt)
// scaled to a 100%-zoom-friendly density:
//   depth 0 (root):   26px/600 → CJK ≈ 26, ASCII ≈ 13.5
//   depth 1 (branch): 16px/500 → CJK ≈ 16, ASCII ≈ 8.5
//   deeper:           13px/500 → CJK ≈ 13, ASCII ≈ 7
// The measurement constants MUST stay in sync with the font-size values in
// mindmap.css (v2 canvas section). If you change one, change the other.

/** Depth-specific character widths for text measurement. */
function charWidthsForDepth(depth: number): { cjk: number; ascii: number } {
  if (depth === 0) return { cjk: 26, ascii: 13.5 }
  if (depth === 1) return { cjk: 16, ascii: 8.5 }
  return { cjk: 13, ascii: 7 }
}

/** Depth-specific horizontal padding. */
function paddingForDepth(depth: number): number {
  if (depth === 0) return 36
  if (depth === 1) return 32
  return 24
}

/** Single-line node height per depth (root 56 / branch 42 / deeper 34). */
function baseHeightForDepth(depth: number): number {
  if (depth === 0) return 56
  if (depth === 1) return 42
  return 34
}

/** Wrapped-line advance per depth; base height = line height + Y padding. */
function lineHeightForDepth(depth: number): number {
  if (depth === 0) return 34
  if (depth === 1) return 22
  return 18
}

const NODE_MIN_WIDTH = 72
const NODE_MAX_WIDTH = 360

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0)
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

function measureNodeWidth(title: string, depth: number): number {
  if (!title) return NODE_MIN_WIDTH
  const { cjk, ascii } = charWidthsForDepth(depth)
  let textWidth = 0
  for (const char of title) {
    textWidth += isCJK(char) ? cjk : ascii
  }
  const paddingX = paddingForDepth(depth)
  return Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, textWidth + paddingX))
}

function measureNodeHeight(title: string, width: number, depth: number): number {
  const baseHeight = baseHeightForDepth(depth)
  if (!title) return baseHeight
  const paddingX = paddingForDepth(depth)
  const { ascii } = charWidthsForDepth(depth)
  const innerWidth = width - paddingX
  const charsPerLine = Math.max(1, Math.floor(innerWidth / ascii))
  const lines = Math.max(1, Math.ceil(title.length / charsPerLine))
  const paddingY = baseHeight - lineHeightForDepth(depth)
  return Math.max(baseHeight, lines * lineHeightForDepth(depth) + paddingY)
}

// ---- layout types ----

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
  /** Whether the topic has a non-empty note (for note indicator badge). */
  hasNote?: boolean
  /** Small, accessible XMind-style marker badges attached to the topic. */
  markers?: MindMapMarker[]
  /** Text labels attached to the topic. */
  labels?: string[]
  /** Branch index for colour assignment (0 for root, 0-based for first-level children, inherited by descendants). */
  branchIndex: number
  /** Shape override from topic style or theme. */
  shape?: string
  /** Number of descendants hidden when this node is collapsed (for badge display). */
  hiddenDescendantCount?: number
  /** Full style override (fill, stroke, textColor, font, etc.). */
  style?: MindMapTopicStyleOverride
  /** Planning metadata for task info display. */
  taskStatus?: string
  progress?: number
  priority?: number
}

export type MindMapLayoutEdge = {
  from: string
  to: string
  /** Branch index for edge colouring. */
  branchIndex: number
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

/** A boundary enclosing a topic subtree, projected into layout coordinates. */
export type MindMapLayoutBoundary = {
  id: string
  topicId: string
  label?: string
  style?: MindMapElementStyle
  x: number
  y: number
  width: number
  height: number
}

export type MindMapLayoutResult = {
  nodes: MindMapLayoutNode[]
  edges: MindMapLayoutEdge[]
  relationships: MindMapLayoutRelationship[]
  callouts: MindMapLayoutCallout[]
  summaries: MindMapLayoutSummary[]
  boundaries: MindMapLayoutBoundary[]
}

// ---- layout constants (kept for tests / external consumers) ----

export const MIND_MAP_NODE_WIDTH = 160
export const MIND_MAP_NODE_HEIGHT = 40
/** Horizontal gap between the edge of a parent and the edge of its child.
 * @deprecated Use {@link horizontalGapForDepth} for depth-aware spacing. */
export const MIND_MAP_HORIZONTAL_GAP = 80
/** Vertical gap between sibling subtrees.
 * @deprecated Use {@link verticalGapForDepth} for depth-aware spacing. */
export const MIND_MAP_VERTICAL_GAP = 16

/**
 * Horizontal gap between a parent's right edge and its child's left edge,
 * varying by depth to match Xmind Snowbrush spacing (wider near the root,
 * tighter for deeper levels). MUST stay in sync with CSS font-size values.
 */
export function horizontalGapForDepth(depth: number): number {
  return depth === 0 ? 64 : 44
}

/** Vertical gap between sibling subtrees, varying by depth (Xmind-style). */
export function verticalGapForDepth(depth: number): number {
  return depth === 0 ? 24 : 10
}

/**
 * Resolve the sheet's sibling spacing override, or `null` when the sheet has
 * no explicit `spacing` configured (meaning depth-based defaults apply).
 */
function effectiveVerticalGap(sheet: MindMapSheetV2): number | null {
  const configured = sheet.layout.spacing
  if (configured === undefined || !Number.isFinite(configured)) return null
  const base = Math.max(4, configured)
  return sheet.layout.compact === true ? Math.max(4, base * 0.6) : base
}

/** Count all descendants (recursive, ignoring collapsed state) for badge display. */
function countDescendants(node: MindMapTopicV2): number {
  let count = 0
  for (const child of node.children) {
    count += 1 + countDescendants(child)
  }
  return count
}

// ---- layout algorithm ----

/** Direction (in x units) applied to each child index for a given structure.
 *
 * Balanced structures alternate right/left **at the root only** — deeper
 * topics stay on their branch's side (Xmind behaviour). Without this, the
 * second child of a right-side branch would swing back toward the root and
 * overlap it.
 */
function childDirections(
  structureClass: MindMapStructureClass,
  childCount: number,
  depth: number,
  inheritedSide: 1 | -1
): number[] {
  const strategy = getLayoutStrategy(structureClass)
  if (strategy === 'horizontal-left') {
    return new Array<number>(childCount).fill(-1)
  }
  if (strategy === 'balanced') {
    if (depth > 0) {
      return new Array<number>(childCount).fill(inheritedSide)
    }
    return Array.from({ length: childCount }, (_, index) => (index % 2 === 0 ? 1 : -1))
  }
  return new Array<number>(childCount).fill(1)
}

function isVerticalStructure(structureClass: MindMapStructureClass): boolean {
  const strategy = getLayoutStrategy(structureClass)
  return strategy === 'vertical-down' || strategy === 'vertical-up'
}

/** Horizontal extent used by the vertical (down/up) structures. */
function subtreeWidth(
  node: MindMapTopicV2,
  sizes: Map<string, { width: number; height: number }>,
  depth: number,
  gapOverride: number | null
): number {
  const size = sizes.get(node.id)
  const nodeWidth = size?.width ?? MIND_MAP_NODE_WIDTH
  if (node.collapsed || node.children.length === 0) return nodeWidth
  const siblingGap = gapOverride ?? verticalGapForDepth(depth)
  let total = siblingGap
  for (const child of node.children) {
    total += subtreeWidth(child, sizes, depth + 1, gapOverride) + siblingGap
  }
  return Math.max(nodeWidth, total)
}

/** Total vertical extent of a node and its (expanded) descendants. */
function subtreeHeight(
  node: MindMapTopicV2,
  sizes: Map<string, { width: number; height: number }>,
  depth: number,
  gapOverride: number | null
): number {
  const size = sizes.get(node.id)
  const nodeHeight = size?.height ?? MIND_MAP_NODE_HEIGHT
  if (node.collapsed || node.children.length === 0) return nodeHeight
  const siblingGap = gapOverride ?? verticalGapForDepth(depth)
  let total = siblingGap
  for (const child of node.children) {
    total += subtreeHeight(child, sizes, depth + 1, gapOverride) + siblingGap
  }
  return Math.max(nodeHeight, total)
}

/** Pre-compute auto-sized dimensions for every node in the tree. */
function precomputeSizes(
  node: MindMapTopicV2,
  sizes: Map<string, { width: number; height: number }>,
  depth: number,
  emptyTitleFallback?: string
): void {
  // Untitled topics are rendered with a placeholder label (G3), so they are
  // measured as that placeholder rather than collapsing to the bare minimum.
  const measuredTitle = node.title || emptyTitleFallback || ''
  const width = measureNodeWidth(measuredTitle, depth)
  const height = measureNodeHeight(measuredTitle, width, depth)
  sizes.set(node.id, { width, height })
  for (const child of node.children) {
    precomputeSizes(child, sizes, depth + 1, emptyTitleFallback)
  }
}

function assignLayout(
  node: MindMapTopicV2,
  centerX: number,
  topY: number,
  depth: number,
  branchIndex: number,
  inheritedStructureClass: MindMapStructureClass,
  sizes: Map<string, { width: number; height: number }>,
  gapOverride: number | null,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
  /** Which side of the root this branch lives on (balanced layouts). */
  inheritedSide: 1 | -1 = 1
): void {
  const structureClass = node.style?.structureClass ?? inheritedStructureClass
  const isCollapsed = node.collapsed === true
  const size = sizes.get(node.id) ?? { width: MIND_MAP_NODE_WIDTH, height: MIND_MAP_NODE_HEIGHT }
  const width = size.width
  const height = size.height
  const hGap = horizontalGapForDepth(depth)
  const vGap = gapOverride ?? verticalGapForDepth(depth)

  nodes.push({
    id: node.id,
    title: node.title,
    x: centerX - width / 2,
    y: topY,
    width,
    height,
    depth,
    collapsed: isCollapsed,
    ...(node.note ? { note: node.note, hasNote: true } : {}),
    ...(node.markers && node.markers.length > 0
      ? {
          markers: node.markers.map(({ id, symbol, label }) => ({
            id,
            symbol,
            ...(label !== undefined ? { label } : {})
          }))
        }
      : {}),
    ...(node.labels && node.labels.length > 0 ? { labels: [...node.labels] } : {}),
    branchIndex,
    ...(node.style?.shape ? { shape: node.style.shape } : {}),
    ...(node.style ? { style: node.style } : {}),
    ...(node.planning?.taskStatus ? { taskStatus: node.planning.taskStatus } : {}),
    ...(node.planning?.progress !== undefined ? { progress: node.planning.progress } : {}),
    ...(node.planning?.priority !== undefined ? { priority: node.planning.priority } : {})
  })

  if (isCollapsed) {
    const lastNode = nodes[nodes.length - 1]
    if (lastNode) lastNode.hiddenDescendantCount = countDescendants(node)
  }

  if (isCollapsed || node.children.length === 0) return

  if (isVerticalStructure(structureClass)) {
    const childWidths = node.children.map((child) => subtreeWidth(child, sizes, depth + 1, gapOverride))
    const totalWidth = childWidths.reduce((sum, childWidth) => sum + childWidth, 0) +
      Math.max(0, node.children.length - 1) * vGap
    let childLeft = centerX - totalWidth / 2
    const isDown = getLayoutStrategy(structureClass) === 'vertical-down'
    const childY = isDown
      ? topY + height + hGap
      : topY - hGap

    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index]
      const childSize = sizes.get(child.id) ?? { width: MIND_MAP_NODE_WIDTH, height: MIND_MAP_NODE_HEIGHT }
      const childWidth = childWidths[index] ?? childSize.width
      const childCenterX = childLeft + childWidth / 2
      const childTopY = isDown
        ? childY
        : childY - childSize.height
      const childBranchIndex = depth === 0 ? index : branchIndex
      edges.push({ from: node.id, to: child.id, branchIndex: childBranchIndex })
      assignLayout(
        child,
        childCenterX,
        childTopY,
        depth + 1,
        childBranchIndex,
        structureClass,
        sizes,
        gapOverride,
        nodes,
        edges
      )
      childLeft += childWidth + vGap
    }
    return
  }

  const directions = childDirections(structureClass, node.children.length, depth, inheritedSide)
  // Use the max child width so siblings align in a column (Xmind style).
  let maxChildWidth = 0
  for (const child of node.children) {
    const childSize = sizes.get(child.id)
    if (childSize && childSize.width > maxChildWidth) maxChildWidth = childSize.width
  }
  if (maxChildWidth === 0) maxChildWidth = MIND_MAP_NODE_WIDTH
  const childStepX = width / 2 + hGap + maxChildWidth / 2

  // Pre-compute each child's subtree height once (reused for centering and
  // spacing) so we don't traverse subtrees twice.
  const childHeights = node.children.map((child) =>
    subtreeHeight(child, sizes, depth + 1, gapOverride)
  )
  // For two-sided structures (balanced / map) the children alternate
  // right/left.  Center each side independently around the parent's vertical
  // midline so the subtree spreads symmetrically on both sides at every
  // depth, matching Xmind's balanced layout.  Without this, left and right
  // children share one vertical stream and each side drifts off-center as
  // more siblings are added.
  const isTwoSided =
    directions.some((d) => d > 0) && directions.some((d) => d < 0)
  const sides = isTwoSided ? ([1, -1] as const) : [directions[0] ?? 1]
  for (const side of sides) {
    const sideIndices: number[] = []
    for (let i = 0; i < node.children.length; i += 1) {
      if (directions[i] === side) sideIndices.push(i)
    }
    if (sideIndices.length === 0) continue

    // Center this side's children around the parent's vertical midline.
    const sideExtent =
      sideIndices.reduce((sum, i) => sum + childHeights[i]!, 0) +
      Math.max(0, sideIndices.length - 1) * vGap
    let cursor = topY + height / 2 - sideExtent / 2
    for (const index of sideIndices) {
      const child = node.children[index]!
      const childHeight = childHeights[index]!
      const childCenterX = centerX + directions[index] * childStepX
      // Assign branch index: first-level children get their own index, descendants inherit.
      const childBranchIndex = depth === 0 ? index : branchIndex
      edges.push({ from: node.id, to: child.id, branchIndex: childBranchIndex })
      assignLayout(
        child,
        childCenterX,
        cursor,
        depth + 1,
        childBranchIndex,
        structureClass,
        sizes,
        gapOverride,
        nodes,
        edges,
        (directions[index] ?? 1) >= 0 ? 1 : -1
      )
      cursor += childHeight + vGap
    }
  }
}

/** Optional knobs for {@link computeMindMapLayout}. */
export type MindMapLayoutOptions = {
  /**
   * Measure untitled topics as this string (the renderer's placeholder label)
   * so empty nodes don't collapse into tiny blank chips. Export/minimap
   * callers omit it and keep the bare minimum width.
   */
  emptyTitleFallback?: string
}

export function computeMindMapLayout(
  sheet: MindMapSheetV2,
  options?: MindMapLayoutOptions
): MindMapLayoutResult {
  const nodes: MindMapLayoutNode[] = []
  const edges: MindMapLayoutEdge[] = []
  const sizes = new Map<string, { width: number; height: number }>()
  precomputeSizes(sheet.root, sizes, 0, options?.emptyTitleFallback)
  const gapOverride = effectiveVerticalGap(sheet)

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
    0,
    sheet.layout.structureClass,
    sizes,
    gapOverride,
    nodes,
    edges
  )

  // Compute boundary rectangles from layout nodes.
  const boundaries = sheet.elements
    .filter((element): element is MindMapBoundary => element.type === 'boundary')
    .map(({ id, topicId, children, label, style }) => {
      const targetIds = children ?? [topicId]
      const targetNodes = nodes.filter((n) => targetIds.includes(n.id))
      if (targetNodes.length === 0) {
        const single = nodes.find((n) => n.id === topicId)
        if (!single) return null
        const padding = 16
        return {
          id,
          topicId,
          ...(label !== undefined ? { label } : {}),
          ...(style !== undefined ? { style } : {}),
          x: single.x - padding,
          y: single.y - padding,
          width: single.width + padding * 2,
          height: single.height + padding * 2
        }
      }
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const n of targetNodes) {
        left = Math.min(left, n.x)
        top = Math.min(top, n.y)
        right = Math.max(right, n.x + n.width)
        bottom = Math.max(bottom, n.y + n.height)
      }
      const padding = 16
      return {
        id,
        topicId,
        ...(label !== undefined ? { label } : {}),
        ...(style !== undefined ? { style } : {}),
        x: left - padding,
        y: top - padding,
        width: right - left + padding * 2,
        height: bottom - top + padding * 2
      }
    })
    .filter((b): b is MindMapLayoutBoundary => b !== null)

  return { nodes, edges, relationships, callouts, summaries, boundaries }
}
