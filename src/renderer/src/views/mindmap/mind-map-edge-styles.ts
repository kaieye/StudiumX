import type { MindMapConnectorStyle } from '../../../../shared/mindmap/structure-types'
import type { MindMapLayoutNode } from './mind-map-layout'

/**
 * Edge connector path generators for different line styles (Xmind-inspired).
 *
 * Xmind supports three connector styles:
 * - **curve** (default): smooth cubic bezier, organic and flowing
 * - **elbow**: right-angle with rounded corners, structured and technical
 * - **straight**: direct line, minimalist
 *
 * Tree layouts can grow horizontally (right/left) or vertically (down/up), so
 * each path chooses the nearest edge on the dominant axis between the topic
 * centres. This keeps connectors attached to node borders when a user changes
 * the sheet structure in the inspector.
 */

type EdgeOrientation = {
  axis: 'horizontal' | 'vertical'
  direction: 1 | -1
  x1: number
  y1: number
  x2: number
  y2: number
}

function edgeOrientation(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  forcedAxis?: EdgeOrientation['axis']
): EdgeOrientation {
  const fromCenterX = from.x + from.width / 2
  const fromCenterY = from.y + from.height / 2
  const toCenterX = to.x + to.width / 2
  const toCenterY = to.y + to.height / 2
  const deltaX = toCenterX - fromCenterX
  const deltaY = toCenterY - fromCenterY

  // A vertical structure can still spread children horizontally. Select the
  // dominant axis rather than relying on the sheet structure, which also keeps
  // this helper safe for callers rendering relationship-like geometry.
  if (forcedAxis === 'vertical' || (forcedAxis === undefined && Math.abs(deltaY) > Math.abs(deltaX))) {
    const below = deltaY >= 0
    return {
      axis: 'vertical',
      direction: below ? 1 : -1,
      x1: fromCenterX,
      y1: below ? from.y + from.height : from.y,
      x2: toCenterX,
      y2: below ? to.y : to.y + to.height
    }
  }

  const toRight = deltaX >= 0
  // An underline topic's visible border is its baseline, not the middle of its
  // layout box. Attach horizontal branches to that baseline so an incoming
  // edge, the underline itself, and any outgoing edges read as one continuous
  // branch (matching XMind's underline-topic geometry).
  const fromAnchorY = from.shape === 'underline' ? from.y + from.height : fromCenterY
  const toAnchorY = to.shape === 'underline' ? to.y + to.height : toCenterY
  return {
    axis: 'horizontal',
    direction: toRight ? 1 : -1,
    x1: toRight ? from.x + from.width : from.x,
    y1: fromAnchorY,
    x2: toRight ? to.x : to.x + to.width,
    y2: toAnchorY
  }
}

/** Smooth cubic bezier curve from parent to child (Xmind default). */
export function curveEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  axis?: EdgeOrientation['axis']
): string {
  const edge = edgeOrientation(from, to, axis)
  if (edge.axis === 'vertical') {
    const dy = Math.max(24, Math.abs(edge.y2 - edge.y1))
    const control = Math.min(36, dy / 2)
    return `M ${edge.x1} ${edge.y1} C ${edge.x1} ${edge.y1 + edge.direction * control}, ${edge.x2} ${edge.y2 - edge.direction * control}, ${edge.x2} ${edge.y2}`
  }

  // Keep the bend inside a bounded middle band. Long sibling fans used to
  // reserve 80% of their horizontal span for the second control point, which
  // made each branch bow independently and read as a tangle. Equal, capped
  // tangents preserve the Xmind-style fold while keeping adjacent branches
  // visually parallel.
  const dx = Math.max(24, Math.abs(edge.x2 - edge.x1))
  const control = Math.min(36, dx / 2)
  return `M ${edge.x1} ${edge.y1} C ${edge.x1 + edge.direction * control} ${edge.y1}, ${edge.x2 - edge.direction * control} ${edge.y2}, ${edge.x2} ${edge.y2}`
}

/** Elbow (right-angle) path with rounded corners. */
export function elbowEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  axis?: EdgeOrientation['axis']
): string {
  return elbowEdgePathWithRadius(from, to, axis, 8)
}

/** Elbow variant with a larger corner radius, producing a softer right-angle. */
export function roundedElbowEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  axis?: EdgeOrientation['axis']
): string {
  return elbowEdgePathWithRadius(from, to, axis, 16)
}

function elbowEdgePathWithRadius(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  axis: EdgeOrientation['axis'] | undefined,
  r: number
): string {
  const edge = edgeOrientation(from, to, axis)

  if (edge.axis === 'vertical') {
    if (edge.x1 === edge.x2) return `M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2}`
    const midY = edge.y1 + (edge.y2 - edge.y1) / 2
    const radius = Math.min(r, Math.abs(edge.y2 - edge.y1) / 2, Math.abs(edge.x2 - edge.x1) / 2)
    if (radius <= 0) return `M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2}`
    const turn = edge.direction
    return `M ${edge.x1} ${edge.y1} L ${edge.x1} ${midY - turn * radius} Q ${edge.x1} ${midY}, ${edge.x1 + (edge.x2 >= edge.x1 ? radius : -radius)} ${midY} L ${edge.x2 - (edge.x2 >= edge.x1 ? radius : -radius)} ${midY} Q ${edge.x2} ${midY}, ${edge.x2} ${midY + turn * radius} L ${edge.x2} ${edge.y2}`
  }

  const direction = edge.direction
  const midX = edge.x1 + (edge.x2 - edge.x1) / 2
  const dy = edge.y2 - edge.y1
  const turn = dy >= 0 ? 1 : -1
  const radius = Math.min(r, Math.abs(edge.x2 - edge.x1) / 2, Math.abs(dy) / 2)
  if (radius <= 0) return `M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2}`
  return `M ${edge.x1} ${edge.y1} L ${midX - direction * radius} ${edge.y1} Q ${midX} ${edge.y1}, ${midX} ${edge.y1 + turn * radius} L ${midX} ${edge.y2 - turn * radius} Q ${midX} ${edge.y2}, ${midX + direction * radius} ${edge.y2} L ${edge.x2} ${edge.y2}`
}

/**
 * Bight connector: an elbow whose middle segment carries a small square
 * pocket (a "bight"), a distinct Xmind-influenced branch language. The pocket
 * is sized from the horizontal span so it stays visible even when the child
 * sits level with the parent (where a vertical-only clamp would collapse it).
 */
export function bightEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  axis?: EdgeOrientation['axis']
): string {
  const edge = edgeOrientation(from, to, axis)
  const n = 10

  if (edge.axis === 'vertical') {
    const midX = edge.x1 + (edge.x2 - edge.x1) / 2
    const midY = edge.y1 + (edge.y2 - edge.y1) / 2
    const notch = Math.min(n, Math.abs(edge.y2 - edge.y1) / 4)
    const sign = edge.x2 >= edge.x1 ? 1 : -1
    return `M ${edge.x1} ${edge.y1} L ${midX} ${edge.y1} L ${midX} ${midY - notch} ` +
      `L ${midX + sign * notch} ${midY - notch} L ${midX + sign * notch} ${midY + notch} ` +
      `L ${midX} ${midY + notch} L ${midX} ${edge.y2} L ${edge.x2} ${edge.y2}`
  }

  const midX = edge.x1 + (edge.x2 - edge.x1) / 2
  const midY = edge.y1 + (edge.y2 - edge.y1) / 2
  const notch = Math.min(n, Math.abs(edge.x2 - edge.x1) / 4)
  const sign = edge.y2 >= edge.y1 ? 1 : -1
  return `M ${edge.x1} ${edge.y1} L ${edge.x1} ${midY} L ${midX - notch} ${midY} ` +
    `L ${midX - notch} ${midY + sign * notch} L ${midX + notch} ${midY + sign * notch} ` +
    `L ${midX + notch} ${midY} L ${edge.x2} ${midY} L ${edge.x2} ${edge.y2}`
}

/**
 * Fold connector: a two-step Z-fold (double elbow) with a horizontal shelf.
 * The shelf sits roughly centred between the two endpoints but always keeps a
 * minimum excursion from each, so a child level with its parent still renders
 * a visible fold instead of collapsing to a straight line.
 */
export function foldEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  axis?: EdgeOrientation['axis']
): string {
  const edge = edgeOrientation(from, to, axis)
  const step = 16

  if (edge.axis === 'vertical') {
    const midY = edge.y1 + (edge.y2 - edge.y1) / 2
    const vstep = Math.min(step, Math.abs(edge.y2 - edge.y1) / 4)
    const shelfX = shelfBetween(edge.x1, edge.x2, Math.min(step, Math.abs(edge.x2 - edge.x1) / 4))
    return `M ${edge.x1} ${edge.y1} L ${edge.x1} ${midY - vstep} L ${shelfX} ${midY - vstep} ` +
      `L ${shelfX} ${midY + vstep} L ${edge.x2} ${midY + vstep} L ${edge.x2} ${edge.y2}`
  }

  const midX = edge.x1 + (edge.x2 - edge.x1) / 2
  const shelfY = shelfBetween(edge.y1, edge.y2, Math.min(step, Math.abs(edge.x2 - edge.x1) / 4))
  return `M ${edge.x1} ${edge.y1} L ${midX - step} ${edge.y1} L ${midX - step} ${shelfY} ` +
    `L ${midX + step} ${shelfY} L ${midX + step} ${edge.y2} L ${edge.x2} ${edge.y2}`
}

/**
 * Rounded fold connector: a fold path with softened corners so the two-step
 * shelf reads as continuous rather than sharply stepped. Corners are rounded
 * by a generic polyline helper that always rounds toward the fold and clamps
 * the radius to half each segment, so it is correct for above/below children
 * and never collapses for a level child.
 */
export function roundedFoldEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  axis?: EdgeOrientation['axis']
): string {
  const edge = edgeOrientation(from, to, axis)
  const step = 16
  const r = 6

  if (edge.axis === 'vertical') {
    const midY = edge.y1 + (edge.y2 - edge.y1) / 2
    const vstep = Math.min(step, Math.abs(edge.y2 - edge.y1) / 4)
    const shelfX = shelfBetween(edge.x1, edge.x2, Math.min(step, Math.abs(edge.x2 - edge.x1) / 4))
    const points: Array<[number, number]> = [
      [edge.x1, edge.y1],
      [edge.x1, midY - vstep],
      [shelfX, midY - vstep],
      [shelfX, midY + vstep],
      [edge.x2, midY + vstep],
      [edge.x2, edge.y2]
    ]
    return roundedPolylinePath(points, r)
  }

  const midX = edge.x1 + (edge.x2 - edge.x1) / 2
  const shelfY = shelfBetween(edge.y1, edge.y2, Math.min(step, Math.abs(edge.x2 - edge.x1) / 4))
  const points: Array<[number, number]> = [
    [edge.x1, edge.y1],
    [midX - step, edge.y1],
    [midX - step, shelfY],
    [midX + step, shelfY],
    [midX + step, edge.y2],
    [edge.x2, edge.y2]
  ]
  return roundedPolylinePath(points, r)
}

/**
 * Emit an SVG path through `points`, rounding each interior corner with a
 * quadratic curve of radius `r`. The radius is clamped to half the shorter
 * adjacent segment so the corner never overshoots, regardless of direction.
 */
function roundedPolylinePath(points: Array<[number, number]>, r: number): string {
  const [x0, y0] = points[0]
  let d = `M ${x0} ${y0}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i]
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i + 1]
    const dAx = px - ax
    const dAy = py - ay
    const dBx = bx - px
    const dBy = by - py
    const lenA = Math.hypot(dAx, dAy) || 1
    const lenB = Math.hypot(dBx, dBy) || 1
    const rad = Math.min(r, lenA / 2, lenB / 2)
    const sx = px - (dAx / lenA) * rad
    const sy = py - (dAy / lenA) * rad
    const ex = px + (dBx / lenB) * rad
    const ey = py + (dBy / lenB) * rad
    d += ` L ${sx} ${sy} Q ${px} ${py}, ${ex} ${ey}`
  }
  const [xn, yn] = points[points.length - 1]
  d += ` L ${xn} ${yn}`
  return d
}

/**
 * Pick a shelf coordinate between two endpoints that stays at least
 * `excursion` away from both, falling back to a centred value. Used by the
 * fold / rounded-fold connectors so their step never collapses to a line when
 * the endpoints share the same coordinate.
 */
function shelfBetween(a: number, b: number, excursion: number): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const mid = (a + b) / 2
  const minC = lo + excursion
  const maxC = hi - excursion
  if (minC > maxC) return lo + excursion
  return Math.max(minC, Math.min(maxC, mid))
}

/** Straight line from parent to child. */
export function straightEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  axis?: EdgeOrientation['axis']
): string {
  const edge = edgeOrientation(from, to, axis)
  return `M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2}`
}

/**
 * Timeline connectors retain a straight, legible axis language. The vertical
 * segment is intentionally joined with an elbow rather than a generic curve,
 * so alternating events visibly attach to the chronological spine.
 */
export function timelineEdgePath(from: MindMapLayoutNode, to: MindMapLayoutNode): string {
  return elbowEdgePath(from, to)
}

/**
 * Fishbone connectors use a single diagonal rib. Unlike the ordinary tree
 * curve this preserves the visual direction of the backbone and keeps upper
 * and lower causes visibly symmetrical.
 */
export function fishboneEdgePath(from: MindMapLayoutNode, to: MindMapLayoutNode): string {
  return straightEdgePath(from, to)
}

/** Matrix cells connect through an orthogonal grid-like path. */
export function matrixEdgePath(from: MindMapLayoutNode, to: MindMapLayoutNode): string {
  return elbowEdgePath(from, to)
}

/** Brace maps share a compact orthogonal connector language. */
export function braceEdgePath(from: MindMapLayoutNode, to: MindMapLayoutNode): string {
  return elbowEdgePath(from, to)
}


/** Dash pattern for branch line patterns. `solid` and hand-drawn-solid render continuous. */
export function lineDashPattern(pattern?: string): string | undefined {
  switch (pattern) {
    case 'dash':
    case 'hand-drawn-dash':
      return '6 4'
    default:
      return undefined
  }
}

/**
 * Accepted branch line-pattern tokens, mirroring the persisted layout enum.
 * Anything outside this set is unknown and degrades to the solid fallback.
 */
export const BRANCH_LINE_PATTERN_TOKENS = [
  'solid',
  'dash',
  'hand-drawn-solid',
  'hand-drawn-dash'
] as const

export type LinePatternResolution = { dash: string | undefined; degraded: boolean }

/**
 * Resolve a branch line-pattern token to its dash value and report whether it
 * is unknown (and therefore degraded to the stable solid fallback). Backward
 * compatible with {@link lineDashPattern} via {@link LinePatternResolution.dash}.
 * Unknown tokens keep the exact visual output of the solid fallback while the
 * report records the degradation instead of silently reinterpreting the file.
 */
export function resolveLinePatternWithReport(
  pattern: string | undefined
): LinePatternResolution {
  if (pattern === undefined) return { dash: undefined, degraded: false }
  if (pattern === 'dash' || pattern === 'hand-drawn-dash') {
    return { dash: '6 4', degraded: false }
  }
  if (pattern === 'solid' || pattern === 'hand-drawn-solid') {
    return { dash: undefined, degraded: false }
  }
  // Unknown token: stable solid fallback (same dash as `solid`), reported as
  // degraded instead of silently rendering a different dash than the document
  // requested.
  return { dash: undefined, degraded: true }
}

/**
 * Tapered (Xmind "线条渐细") edge rendered as a closed polygon whose width
 * shrinks from the parent anchor toward the child anchor. Produces a true
 * width taper that a uniform `stroke-width` cannot express.
 */
export function taperedEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  startWidth: number,
  endWidth: number,
  axis?: EdgeOrientation['axis']
): string {
  const edge = edgeOrientation(from, to, axis)
  const w1 = Math.max(0.5, startWidth)
  const w2 = Math.max(0.5, endWidth)
  if (edge.axis === 'vertical') {
    return `M ${edge.x1 - w1 / 2} ${edge.y1} L ${edge.x1 + w1 / 2} ${edge.y1} L ${edge.x2 + w2 / 2} ${edge.y2} L ${edge.x2 - w2 / 2} ${edge.y2} Z`
  }
  return `M ${edge.x1} ${edge.y1 - w1 / 2} L ${edge.x1} ${edge.y1 + w1 / 2} L ${edge.x2} ${edge.y2 + w2 / 2} L ${edge.x2} ${edge.y2 - w2 / 2} Z`
}

type ConnectorPathStyle = MindMapConnectorStyle | 'straight'

/** Resolve the edge path based on the sheet's line style preference. */
export function resolveEdgePath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  lineStyle?: ConnectorPathStyle,
  axis?: EdgeOrientation['axis']
): string {
  switch (lineStyle) {
    case 'elbow':
      return elbowEdgePath(from, to, axis)
    case 'rounded-elbow':
      return roundedElbowEdgePath(from, to, axis)
    case 'bight':
      return bightEdgePath(from, to, axis)
    case 'fold':
      return foldEdgePath(from, to, axis)
    case 'rounded-fold':
      return roundedFoldEdgePath(from, to, axis)
    case 'straight':
      return straightEdgePath(from, to, axis)
    case 'brace':
      return braceEdgePath(from, to)
    case 'timeline':
      return timelineEdgePath(from, to)
    case 'fishbone':
      return fishboneEdgePath(from, to)
    case 'matrix':
      return matrixEdgePath(from, to)
    case 'curve':
    default:
      return curveEdgePath(from, to, axis)
  }
}

/**
 * Determine edge stroke width based on the target node's depth.
 * Xmind uses thicker lines for first-level branches, thinner for deeper nodes.
 */
export function edgeStrokeWidth(depth: number, scale = 1): number {
  // Xmind M01 original values: centralTopic line-width 4 (root→L1) and
  // mainTopic line-width 3 (L1→L2); deeper connections continue the taper at 2.
  const base = depth <= 1 ? 4 : depth === 2 ? 3 : 2
  return base * (Number.isFinite(scale) && scale > 0 ? scale : 1)
}
