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
  return {
    axis: 'horizontal',
    direction: toRight ? 1 : -1,
    x1: toRight ? from.x + from.width : from.x,
    y1: fromCenterY,
    x2: toRight ? to.x : to.x + to.width,
    y2: toCenterY
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
  const edge = edgeOrientation(from, to, axis)
  const r = 8

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
