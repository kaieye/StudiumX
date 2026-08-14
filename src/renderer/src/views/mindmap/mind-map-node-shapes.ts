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
  | 'quote'
  | 'callout'
  | 'bracket'
  | 'arrow-right'
  | 'arrow-left'
  | 'heart'
  | 'cloud'
  | 'star'
  | 'parallelogram'
  | 'hexagon'

/** The default accepted NodeShape tokens, including legacy aliases. */
export const KNOWN_SHAPE_TOKENS: readonly string[] = [
  'roundedRect',
  'rounded-rect',
  'rect',
  'rectangle',
  'ellipse',
  'oval',
  'diamond',
  'underline',
  'no-shape',
  'none',
  'quote',
  'callout',
  'speech-bubble',
  'bracket',
  'arrow-right',
  'arrow-left',
  'heart',
  'cloud',
  'star',
  'parallelogram',
  'hexagon'
]

const KNOWN_SHAPE_TOKEN_SET = new Set<string>(KNOWN_SHAPE_TOKENS)

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
    case 'quote':
      return 'quote'
    case 'callout':
    case 'speech-bubble':
      return 'callout'
    case 'bracket':
      return 'bracket'
    case 'arrow-right':
      return 'arrow-right'
    case 'arrow-left':
      return 'arrow-left'
    case 'heart':
      return 'heart'
    case 'cloud':
      return 'cloud'
    case 'star':
      return 'star'
    case 'parallelogram':
      return 'parallelogram'
    case 'hexagon':
      return 'hexagon'
    default:
      return 'rounded-rect'
  }
}

export type ShapeResolution = { shape: NodeShape; degraded: boolean }

/**
 * Resolve a style shape string and report whether it is unknown (and therefore
 * degraded to the stable `rounded-rect` fallback). Backward compatible with
 * {@link resolveShape} via {@link ShapeResolution.shape}. Unknown shape tokens
 * are reported instead of silently distorting geometry.
 */
export function resolveShapeWithReport(shape: string | undefined): ShapeResolution {
  const resolved = resolveShape(shape)
  return {
    shape: resolved,
    // `undefined` means "no override" (app/theme default), not degradation.
    // A schema-accepted-but-unsupported token such as `fishbone` (resolved to
    // rounded-rect) is still reported as degraded rather than silently changed.
    degraded: shape !== undefined && !KNOWN_SHAPE_TOKEN_SET.has(shape)
  }
}

/**
 * Stable effective fallback for an unknown shape token. Kept as the exact
 * `rounded-rect` NodeShape the canvas already renders today so the report's
 * "degradedTo" remains truthful.
 */
export const FALLBACK_NODE_SHAPE: NodeShape = 'rounded-rect'

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

    case 'quote': {
      // Rounded rect with a quotation-mark notch in the top-left corner.
      const r = Math.min(12, height / 2)
      const d = Math.min(22, width / 3)
      return {
        tag: 'path',
        attrs: {
          d: `M ${x + d} ${y} Q ${x + r} ${y} ${x + r} ${y + r} L ${x + r} ${y + d} ` +
            `L ${x} ${y + d} L ${x} ${y + height - r} Q ${x} ${y + height} ${x + r} ${y + height} ` +
            `L ${x + width - r} ${y + height} Q ${x + width} ${y + height} ${x + width} ${y + height - r} ` +
            `L ${x + width} ${y + r} Q ${x + width} ${y} ${x + width - r} ${y} Z`
        }
      }
    }

    case 'callout': {
      // Rounded rect with a speech-bubble tail at the bottom-left.
      const r = Math.min(12, height / 2)
      const tail = Math.min(18, width / 4)
      return {
        tag: 'path',
        attrs: {
          d: `M ${x + r} ${y} Q ${x} ${y} ${x} ${y + r} L ${x} ${y + height - r} ` +
            `Q ${x} ${y + height} ${x + r} ${y + height} L ${x + width - r} ${y + height} ` +
            `Q ${x + width} ${y + height} ${x + width} ${y + height - r} L ${x + width} ${y + r} ` +
            `Q ${x + width} ${y} ${x + width - r} ${y} L ${x + tail} ${y} L ${x + tail / 2} ${y - tail / 2} Z`
        }
      }
    }

    case 'bracket': {
      // Left-facing square bracket, open on the right.
      const hw = Math.min(10, height / 2)
      return {
        tag: 'path',
        attrs: {
          d: `M ${x + hw} ${y} L ${x + hw} ${y + height} L ${x + width} ${y + height} ` +
            `M ${x + hw} ${y} L ${x + width} ${y} M ${x + hw} ${y + height / 2} L ${x + width} ${y + height / 2}`
        }
      }
    }

    case 'arrow-right': {
      const cy = y + height / 2
      const head = Math.min(22, width / 2)
      return {
        tag: 'path',
        attrs: {
          d: `M ${x} ${y} L ${x + width - head} ${y} L ${x + width} ${cy} L ${x + width - head} ${y + height} ` +
            `L ${x} ${y + height} Z`
        }
      }
    }

    case 'arrow-left': {
      const cy = y + height / 2
      const head = Math.min(22, width / 2)
      return {
        tag: 'path',
        attrs: {
          d: `M ${x + width} ${y} L ${x + head} ${y} L ${x} ${cy} L ${x + head} ${y + height} ` +
            `L ${x + width} ${y + height} Z`
        }
      }
    }

    case 'heart': {
      const cx = x + width / 2
      const w = width / 2
      const h = height * 0.42
      return {
        tag: 'path',
        attrs: {
          d: `M ${cx} ${y + height} C ${x - w * 0.9} ${y + h * 0.6} ${x - w * 0.5} ${y} ${cx} ${y + h * 0.5} ` +
            `C ${x + width * 0.5} ${y} ${x + width * 0.9} ${y + h * 0.6} ${cx} ${y + height} Z`
        }
      }
    }

    case 'cloud': {
      const cx = x + width / 2
      const cy = y + height / 2
      const r = Math.min(width, height) * 0.3
      return {
        tag: 'path',
        attrs: {
          d: `M ${cx} ${y + height} ` +
            `A ${r * 1.1} ${r * 1.1} 0 0 1 ${x + width} ${cy + r * 0.4} ` +
            `A ${r * 0.9} ${r * 0.9} 0 0 0 ${cx + r * 0.6} ${cy - r * 0.8} ` +
            `A ${r} ${r} 0 0 0 ${cx - r * 0.8} ${cy - r * 0.6} ` +
            `A ${r * 0.9} ${r * 0.9} 0 0 0 ${x} ${cy + r * 0.3} ` +
            `A ${r * 1.1} ${r * 1.1} 0 0 1 ${cx} ${y + height} Z`
        }
      }
    }

    case 'star': {
      const cx = x + width / 2
      const cy = y + height / 2
      const outer = Math.min(width, height) / 2
      const inner = outer * 0.4
      const points: string[] = []
      for (let i = 0; i < 10; i += 1) {
        const radius = i % 2 === 0 ? outer : inner
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        points.push(`${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`)
      }
      return { tag: 'path', attrs: { d: `M ${points.join(' L ')} Z` } }
    }

    case 'parallelogram': {
      const skew = Math.min(24, width * 0.2)
      return {
        tag: 'path',
        attrs: {
          d: `M ${x + skew} ${y} L ${x + width} ${y} L ${x + width - skew} ${y + height} L ${x} ${y + height} Z`
        }
      }
    }

    case 'hexagon': {
      const cx = x + width / 2
      const cy = y + height / 2
      const sw = Math.min(24, width * 0.25)
      return {
        tag: 'path',
        attrs: {
          d: `M ${cx - sw} ${y} L ${cx + sw} ${y} L ${x + width} ${cy} L ${cx + sw} ${y + height} ` +
            `L ${cx - sw} ${y + height} L ${x} ${cy} Z`
        }
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
