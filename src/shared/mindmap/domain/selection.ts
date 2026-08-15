/**
 * Immutable node-selection boundary for the mind-map renderer.
 *
 * Selection is represented as an ordered list of stable topic ids rather than
 * a mutable Set so it can cross renderer seams, be compared in tests, and be
 * serialized by future UI state without leaking mutation. Helpers preserve
 * first-seen order and enforce uniqueness on every returned value.
 */
export type MindMapSelection = readonly string[]

/** Toggle one topic id while preserving the selection's existing order. */
export function toggleMindMapNodeSelection(
  selection: MindMapSelection,
  nodeId: string
): string[] {
  const normalized = uniqueSelectionIds(selection)
  const index = normalized.indexOf(nodeId)
  if (index === -1) return [...normalized, nodeId]
  return normalized.filter((id) => id !== nodeId)
}

/** Select every supplied topic id, preserving order and dropping duplicates. */
export function selectAllMindMapNodes(nodeIds: readonly string[]): string[] {
  return uniqueSelectionIds(nodeIds)
}

/** Return a fresh empty selection without mutating a prior selection. */
export function clearMindMapSelection(): string[] {
  return []
}

/** Check membership without exposing or mutating the selection representation. */
export function isMindMapNodeSelected(
  selection: MindMapSelection,
  nodeId: string
): boolean {
  return selection.includes(nodeId)
}

function uniqueSelectionIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

/** A screen-space rectangle used by the canvas marquee selection gesture. */
export type MindMapSelectionRect = {
  left: number
  top: number
  right: number
  bottom: number
}

/** Minimal node geometry needed to hit-test a marquee without importing layout code. */
export type MindMapSelectionNodeBounds = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Select nodes whose rectangles intersect a marquee rectangle.
 *
 * The rectangle is normalized internally, so dragging in any direction works.
 * Results retain the supplied node order and are de-duplicated.
 */
export function selectMindMapNodesInRectangle(
  nodes: readonly MindMapSelectionNodeBounds[],
  rect: MindMapSelectionRect
): string[] {
  const left = Math.min(rect.left, rect.right)
  const right = Math.max(rect.left, rect.right)
  const top = Math.min(rect.top, rect.bottom)
  const bottom = Math.max(rect.top, rect.bottom)
  return selectAllMindMapNodes(
    nodes
      .filter((node) => {
        const nodeRight = node.x + Math.max(0, node.width)
        const nodeBottom = node.y + Math.max(0, node.height)
        return node.x <= right && nodeRight >= left && node.y <= bottom && nodeBottom >= top
      })
      .map((node) => node.id)
  )
}
