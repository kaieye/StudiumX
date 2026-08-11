import type { MindMapLayoutNode } from './mind-map-layout'

/**
 * Node shape rendering utilities.
 *
 * Xmind supports several node shapes. This module provides SVG path / element
 * generators for each, so the canvas can render the appropriate shape based on
 * the topic's style override or the document theme.
 */

export type NodeShape =
  | 'rounded-rect'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'underline'
  | 'no-shape'

/** Map a style shape string to a NodeShape. */
export function resolveShape(shape: string | undefined): NodeShape {
  switch (shape) {
    case 'rect':
    case 'rectangle':
      return 'rect'
    case 'ellipse':
    case 'oval':
      return 'ellipse'
    case 'diamond':
      return 'diamond'
    case 'underline':
      return 'underline'
    case 'no-shape':
    case 'none':
      return 'no-shape'
    default:
      return 'rounded-rect'
  }
}

export type ShapeElement = {
  tag: 'rect' | 'ellipse' | 'path' | 'line'
  attrs: Record<string, string | number>
}

/**
 * Generate the SVG element(s) for a node shape.
 *
 * Returns an object describing the SVG element and its attributes so the
 * canvas component can render it without shape-specific logic.
 */
export function shapeElement(
  node: MindMapLayoutNode,
  shape: NodeShape
): ShapeElement {
  const { x, y, width, height } = node

  switch (shape) {
    case 'rect':
      return {
        tag: 'rect',
        attrs: {
          x,
          y,
          width,
          height,
          rx: 0,
          ry: 0
        }
      }

    case 'ellipse':
      return {
        tag: 'ellipse',
        attrs: {
          cx: x + width / 2,
          cy: y + height / 2,
          rx: width / 2,
          ry: height / 2
        }
      }

    case 'diamond': {
      const cx = x + width / 2
      const cy = y + height / 2
      const dw = width / 2
      const dh = height / 2
      return {
        tag: 'path',
        attrs: {
          d: `M ${cx} ${cy - dh} L ${cx + dw} ${cy} L ${cx} ${cy + dh} L ${cx - dw} ${cy} Z`
        }
      }
    }

    case 'underline':
      return {
        tag: 'line',
        attrs: {
          x1: x,
          y1: y + height,
          x2: x + width,
          y2: y + height
        }
      }

    case 'no-shape':
      // No shape: return a transparent rect as a placeholder for hit-testing
      return {
        tag: 'rect',
        attrs: {
          x,
          y,
          width,
          height,
          rx: 0,
          ry: 0,
          fill: 'transparent',
          stroke: 'none'
        }
      }

    case 'rounded-rect':
    default:
      return {
        tag: 'rect',
        attrs: {
          x,
          y,
          width,
          height,
          rx: Math.min(12, height / 2),
          ry: Math.min(12, height / 2)
        }
      }
  }
}

/**
 * Default shape for a node at a given depth.
 *
 * Root uses a pill/ellipse-like shape, branches use rounded rects,
 * deeper nodes use plain rounded rects.
 */
export function defaultShapeForDepth(depth: number): NodeShape {
  if (depth === 0) return 'rounded-rect'
  return 'rounded-rect'
}
