import type {
  MindMapStructureClass
} from '../../../../shared/mindmap/mind-map-types'
import {
  getConnectorStyle,
  getLayoutGeometry,
  type LayoutGeometry,
  type MindMapConnectorStyle
} from '../../../../shared/mindmap/structure-types'
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
  /** Connector attachment axis dictated by the structure layout. */
  axis: 'horizontal' | 'vertical'
  /** Family-specific connector language; omitted for the default curve. */
  connectorStyle?: MindMapConnectorStyle
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
  const strategy = getLayoutGeometry(structureClass)
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
  const strategy = getLayoutGeometry(structureClass)
  return strategy === 'vertical-down' || strategy === 'vertical-up'
}

function pushEdge(
  edges: MindMapLayoutEdge[],
  from: string,
  to: string,
  branchIndex: number,
  structureClass: MindMapStructureClass
): void {
  const geometry = getLayoutGeometry(structureClass)
  const connectorStyle = getConnectorStyle(structureClass)
  const axis =
    geometry === 'vertical-down' ||
    geometry === 'vertical-up' ||
    geometry === 'timeline-vertical' ||
    geometry === 'matrix-rows' ||
    geometry === 'matrix-columns'
      ? 'vertical'
      : 'horizontal'
  edges.push({
    from,
    to,
    branchIndex,
    axis,
    ...(connectorStyle === 'curve' ? {} : { connectorStyle })
  })
}

type LayoutBounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type MindMapLayoutChildPlan = {
  index: number
  plan: MindMapLayoutPlan
  /** Offset from the parent's top-centre anchor. */
  offsetX: number
  offsetY: number
}

type MindMapLayoutPlan = {
  node: MindMapTopicV2
  structureClass: MindMapStructureClass
  size: { width: number; height: number }
  collapsed: boolean
  /** Bounds relative to this topic's top-centre anchor. */
  bounds: LayoutBounds
  children: MindMapLayoutChildPlan[]
}

function boundsForSize(size: { width: number; height: number }): LayoutBounds {
  return {
    left: -size.width / 2,
    top: 0,
    right: size.width / 2,
    bottom: size.height,
    width: size.width,
    height: size.height
  }
}

function translateBounds(bounds: LayoutBounds, offsetX: number, offsetY: number): LayoutBounds {
  return {
    left: bounds.left + offsetX,
    top: bounds.top + offsetY,
    right: bounds.right + offsetX,
    bottom: bounds.bottom + offsetY,
    width: bounds.width,
    height: bounds.height
  }
}

function unionBounds(first: LayoutBounds, second: LayoutBounds): LayoutBounds {
  const left = Math.min(first.left, second.left)
  const top = Math.min(first.top, second.top)
  const right = Math.max(first.right, second.right)
  const bottom = Math.max(first.bottom, second.bottom)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function isSpecialGeometry(geometry: LayoutGeometry): boolean {
  return (
    geometry === 'timeline-horizontal' ||
    geometry === 'timeline-vertical' ||
    geometry === 'fishbone-right' ||
    geometry === 'fishbone-left' ||
    geometry === 'matrix-rows' ||
    geometry === 'matrix-columns'
  )
}

/**
 * Build a layout plan before emitting coordinates.  A child plan carries its
 * actual bounds, including any recursively selected structure, so parents can
 * reserve real space instead of guessing from a generic tree estimate.
 */
function createLayoutPlan(
  node: MindMapTopicV2,
  depth: number,
  inheritedStructureClass: MindMapStructureClass,
  sizes: Map<string, { width: number; height: number }>,
  gapOverride: number | null,
  inheritedSide: 1 | -1 = 1
): MindMapLayoutPlan {
  const structureClass = node.style?.structureClass ?? inheritedStructureClass
  const size = sizes.get(node.id) ?? { width: MIND_MAP_NODE_WIDTH, height: MIND_MAP_NODE_HEIGHT }
  const collapsed = node.collapsed === true
  const ownBounds = boundsForSize(size)

  if (collapsed || node.children.length === 0) {
    return { node, structureClass, size, collapsed, bounds: ownBounds, children: [] }
  }

  const geometry = getLayoutGeometry(structureClass)
  if (isSpecialGeometry(geometry)) {
    const special = assignSpecialChildren(
      node,
      depth,
      structureClass,
      size,
      sizes,
      gapOverride,
      geometry
    )
    return {
      node,
      structureClass,
      size,
      collapsed,
      bounds: special.bounds,
      children: special.children
    }
  }

  const hGap = horizontalGapForDepth(depth)
  const vGap = gapOverride ?? verticalGapForDepth(depth)
  const children: MindMapLayoutChildPlan[] = []
  let bounds = ownBounds

  const placeChild = (index: number, plan: MindMapLayoutPlan, offsetX: number, offsetY: number): void => {
    children.push({ index, plan, offsetX, offsetY })
    bounds = unionBounds(bounds, translateBounds(plan.bounds, offsetX, offsetY))
  }

  if (isVerticalStructure(structureClass)) {
    const childPlans = node.children.map((child, index) => ({
      index,
      plan: createLayoutPlan(child, depth + 1, structureClass, sizes, gapOverride)
    }))
    const totalWidth = childPlans.reduce((sum, child) => sum + child.plan.bounds.width, 0) +
      Math.max(0, childPlans.length - 1) * vGap
    let cursorLeft = -totalWidth / 2
    const isDown = geometry === 'vertical-down'

    for (const child of childPlans) {
      const offsetX = cursorLeft - child.plan.bounds.left
      const offsetY = isDown
        ? ownBounds.bottom + hGap - child.plan.bounds.top
        : ownBounds.top - hGap - child.plan.bounds.bottom
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorLeft += child.plan.bounds.width + vGap
    }

    return { node, structureClass, size, collapsed, bounds, children }
  }

  const directions = childDirections(structureClass, node.children.length, depth, inheritedSide)
  const childPlans = node.children.map((child, index) => ({
    index,
    direction: directions[index] === -1 ? -1 : 1 as 1 | -1,
    plan: createLayoutPlan(
      child,
      depth + 1,
      structureClass,
      sizes,
      gapOverride,
      directions[index] === -1 ? -1 : 1
    )
  }))
  const sides = directions.some((direction) => direction > 0) && directions.some((direction) => direction < 0)
    ? ([1, -1] as const)
    : [directions[0] === -1 ? -1 : 1]

  for (const side of sides) {
    const sideChildren = childPlans.filter((child) => child.direction === side)
    const sideExtent = sideChildren.reduce((sum, child) => sum + child.plan.bounds.height, 0) +
      Math.max(0, sideChildren.length - 1) * vGap
    let cursorTop = (ownBounds.top + ownBounds.bottom) / 2 - sideExtent / 2

    for (const child of sideChildren) {
      const offsetX = side === 1
        ? ownBounds.right + hGap - child.plan.bounds.left
        : ownBounds.left - hGap - child.plan.bounds.right
      const offsetY = cursorTop - child.plan.bounds.top
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorTop += child.plan.bounds.height + vGap
    }
  }

  return { node, structureClass, size, collapsed, bounds, children }
}

/**
 * Arrange the structures whose child placement is not a regular tree.  Each
 * descendant is planned first, then packed by its true rectangular bounds.
 * This keeps added topics from entering a sibling's visual space.
 */
function assignSpecialChildren(
  node: MindMapTopicV2,
  depth: number,
  structureClass: MindMapStructureClass,
  size: { width: number; height: number },
  sizes: Map<string, { width: number; height: number }>,
  gapOverride: number | null,
  geometry: LayoutGeometry
): Pick<MindMapLayoutPlan, 'bounds' | 'children'> {
  const ownBounds = boundsForSize(size)
  const hGap = horizontalGapForDepth(depth)
  const vGap = gapOverride ?? verticalGapForDepth(depth)
  const children: MindMapLayoutChildPlan[] = []
  let bounds = ownBounds

  const createChildPlans = (sideForIndex: (index: number) => 1 | -1) =>
    node.children.map((child, index) => ({
      index,
      plan: createLayoutPlan(
        child,
        depth + 1,
        structureClass,
        sizes,
        gapOverride,
        sideForIndex(index)
      )
    }))
  const placeChild = (index: number, plan: MindMapLayoutPlan, offsetX: number, offsetY: number): void => {
    children.push({ index, plan, offsetX, offsetY })
    bounds = unionBounds(bounds, translateBounds(plan.bounds, offsetX, offsetY))
  }
  const parentCenterY = (ownBounds.top + ownBounds.bottom) / 2

  if (geometry === 'timeline-horizontal') {
    const childPlans = createChildPlans((index) => (index % 2 === 0 ? -1 : 1))
    let cursorLeft = ownBounds.right + hGap
    for (const child of childPlans) {
      const isAbove = child.index % 2 === 0
      const offsetX = cursorLeft - child.plan.bounds.left
      const offsetY = isAbove
        ? parentCenterY - vGap - child.plan.bounds.bottom
        : parentCenterY + vGap - child.plan.bounds.top
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorLeft += child.plan.bounds.width + hGap
    }
    return { bounds, children }
  }

  if (geometry === 'timeline-vertical') {
    const childPlans = createChildPlans((index) => (index % 2 === 0 ? 1 : -1))
    let cursorTop = ownBounds.bottom + hGap
    for (const child of childPlans) {
      const side: 1 | -1 = child.index % 2 === 0 ? 1 : -1
      const offsetX = side === 1
        ? ownBounds.right + hGap - child.plan.bounds.left
        : ownBounds.left - hGap - child.plan.bounds.right
      const offsetY = cursorTop - child.plan.bounds.top
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorTop += child.plan.bounds.height + vGap
    }
    return { bounds, children }
  }

  if (geometry === 'fishbone-right' || geometry === 'fishbone-left') {
    const direction: 1 | -1 = geometry === 'fishbone-right' ? -1 : 1
    const childPlans = createChildPlans(() => direction)
    let cursorEdge = direction === 1 ? ownBounds.right + hGap : ownBounds.left - hGap
    for (const child of childPlans) {
      const isAbove = child.index % 2 === 0
      const offsetX = direction === 1
        ? cursorEdge - child.plan.bounds.left
        : cursorEdge - child.plan.bounds.right
      const offsetY = isAbove
        ? parentCenterY - vGap - child.plan.bounds.bottom
        : parentCenterY + vGap - child.plan.bounds.top
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorEdge += direction * (child.plan.bounds.width + hGap)
    }
    return { bounds, children }
  }

  const isColumnMajor = geometry === 'matrix-columns'
  const childPlans = createChildPlans(() => 1)
  const columnCount = Math.max(
    1,
    isColumnMajor ? Math.min(3, childPlans.length) : Math.ceil(Math.sqrt(childPlans.length))
  )
  const rowCount = Math.ceil(childPlans.length / columnCount)
  const cellWidths = new Array<number>(columnCount).fill(0)
  const cellHeights = new Array<number>(rowCount).fill(0)
  for (const child of childPlans) {
    const row = isColumnMajor ? child.index % rowCount : Math.floor(child.index / columnCount)
    const column = isColumnMajor ? Math.floor(child.index / rowCount) : child.index % columnCount
    cellWidths[column] = Math.max(cellWidths[column] ?? 0, child.plan.bounds.width)
    cellHeights[row] = Math.max(cellHeights[row] ?? 0, child.plan.bounds.height)
  }

  const totalGridWidth = cellWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, columnCount - 1) * hGap
  const columnLefts: number[] = []
  let columnLeft = -totalGridWidth / 2
  for (const cellWidth of cellWidths) {
    columnLefts.push(columnLeft)
    columnLeft += cellWidth + hGap
  }
  const rowTops: number[] = []
  let rowTop = ownBounds.bottom + hGap
  for (const cellHeight of cellHeights) {
    rowTops.push(rowTop)
    rowTop += cellHeight + vGap
  }

  for (const child of childPlans) {
    const row = isColumnMajor ? child.index % rowCount : Math.floor(child.index / columnCount)
    const column = isColumnMajor ? Math.floor(child.index / rowCount) : child.index % columnCount
    const cellWidth = cellWidths[column] ?? child.plan.bounds.width
    const cellHeight = cellHeights[row] ?? child.plan.bounds.height
    const cellLeft = columnLefts[column] ?? 0
    const cellTop = rowTops[row] ?? ownBounds.bottom + hGap
    const offsetX = cellLeft + (cellWidth - child.plan.bounds.width) / 2 - child.plan.bounds.left
    const offsetY = cellTop + (cellHeight - child.plan.bounds.height) / 2 - child.plan.bounds.top
    placeChild(child.index, child.plan, offsetX, offsetY)
  }

  return { bounds, children }
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

function emitLayoutPlan(
  plan: MindMapLayoutPlan,
  centerX: number,
  topY: number,
  depth: number,
  branchIndex: number,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[]
): void {
  const { node, size, collapsed, structureClass } = plan

  nodes.push({
    id: node.id,
    title: node.title,
    x: centerX - size.width / 2,
    y: topY,
    width: size.width,
    height: size.height,
    depth,
    collapsed,
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

  if (collapsed) {
    const layoutNode = nodes[nodes.length - 1]
    if (layoutNode) layoutNode.hiddenDescendantCount = countDescendants(node)
    return
  }

  for (const child of plan.children) {
    const childBranchIndex = depth === 0 ? child.index : branchIndex
    pushEdge(edges, node.id, child.plan.node.id, childBranchIndex, structureClass)
    emitLayoutPlan(
      child.plan,
      centerX + child.offsetX,
      topY + child.offsetY,
      depth + 1,
      childBranchIndex,
      nodes,
      edges
    )
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

  const plan = createLayoutPlan(
    sheet.root,
    0,
    sheet.layout.structureClass,
    sizes,
    gapOverride
  )
  emitLayoutPlan(plan, 0, 0, 0, 0, nodes, edges)

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
