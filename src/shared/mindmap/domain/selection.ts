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

/** Minimal line geometry needed to hit-test a marquee against a connector. */
export type MindMapSelectionLineBounds = {
  id: string
  /** Screen-space points the rendered path travels between. */
  points: ReadonlyArray<{ x: number; y: number }>
}

/**
 * Select lines whose rendered path crosses a marquee rectangle.
 *
 * A connector is treated as swept by the box when any segment of its polyline
 * intersects the rectangle, or its bounding box sits fully inside the marquee
 * (so a tight drag that surrounds a short line still catches it). The marquee
 * is normalized internally so dragging in any direction works. Results retain
 * the supplied line order and are de-duplicated.
 */
export function selectMindMapLinesInRectangle(
  lines: readonly MindMapSelectionLineBounds[],
  rect: MindMapSelectionRect
): string[] {
  const left = Math.min(rect.left, rect.right)
  const right = Math.max(rect.left, rect.right)
  const top = Math.min(rect.top, rect.bottom)
  const bottom = Math.max(rect.top, rect.bottom)
  const hits: string[] = []
  for (const line of lines) {
    const points = line.points
    if (points.length === 0) continue
    // Quick reject: if the line's bounding box does not overlap the marquee,
    // none of its segments can cross it.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    if (maxX < left || minX > right || maxY < top || minY > bottom) continue
    // Bounding box fully inside the marquee -> swept regardless of shape.
    if (minX >= left && maxX <= right && minY >= top && maxY <= bottom) {
      hits.push(line.id)
      continue
    }
    // Otherwise any segment crossing the rectangle counts.
    let crossed = false
    for (let i = 1; i < points.length; i += 1) {
      if (segmentIntersectsRect(points[i - 1]!, points[i]!, left, top, right, bottom)) {
        crossed = true
        break
      }
    }
    // A zero-length / single-point line falls back to its bounding box test.
    if (!crossed && points.length === 1) {
      const p = points[0]!
      if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) crossed = true
    }
    if (crossed) hits.push(line.id)
  }
  return uniqueSelectionIds(hits)
}

/** Liang–Barsky style segment/axis-aligned-rectangle intersection test. */
function segmentIntersectsRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  left: number,
  top: number,
  right: number,
  bottom: number
): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (!clip(-dx, a.x - left)) return false
  if (!clip(dx, right - a.x)) return false
  if (!clip(-dy, a.y - top)) return false
  if (!clip(dy, bottom - a.y)) return false
  return t0 <= t1
}
