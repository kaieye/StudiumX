import type { ReactNode } from 'react'
import type { NodeShape } from './mind-map-node-shapes'

/**
 * Original graphical glyphs used by the mind-map shape, border, connector, and
 * arrow pickers. They are deliberately composed from basic SVG primitives so
 * the product has its own visual language rather than reusing third-party
 * application artwork.
 */

type GlyphProps = {
  size?: number
  children: ReactNode
}

function Glyph({ size = 26, children }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mindmap-shape-glyph"
    >
      {children}
    </svg>
  )
}

function topicShape(shape: NodeShape | 'none'): ReactNode {
  switch (shape) {
    case 'ellipse':
      return <ellipse cx={16} cy={16} rx={11.5} ry={7.5} fill="none" stroke="currentColor" />
    case 'rect':
      return <rect x={5} y={8} width={22} height={16} rx={2} />
    case 'diamond':
      return <polygon points="16,5 27,16 16,27 5,16" />
    case 'underline':
      return <><path d="M8 10v7a8 8 0 0 0 16 0v-7" /><path d="M6 25h20" /></>
    case 'bracket':
      return <><path d="M11 6H7v20h4" /><path d="M21 6h4v20h-4" /></>
    case 'parallelogram':
      return <polygon points="9,7 27,7 23,25 5,25" />
    case 'hexagon':
      return <polygon points="10,6 22,6 28,16 22,26 10,26 4,16" />
    case 'callout':
      return <path d="M7 8h18a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H16l-5 4v-4H7a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z" />
    case 'none':
    case 'no-shape':
      return <rect x={5} y={8} width={22} height={16} rx={5} strokeDasharray="3 3" />
    case 'rounded-rect':
    default:
      return <rect x={4} y={8} width={24} height={16} rx={7} />
  }
}

/** Glyph for a topic shape. */
export function NodeShapeIcon({ shape, size = 26 }: { shape: NodeShape | 'none'; size?: number }) {
  return <Glyph size={size}>{topicShape(shape)}</Glyph>
}

/** Glyph for a boundary, summary, or callout outline. */
export function OutlineShapeIcon({ shape, size = 26 }: { shape: string; size?: number }) {
  const drawing = (() => {
    switch (shape) {
      case 'rectangle': return <rect x={5} y={7} width={22} height={18} />
      case 'rounded-rectangle': return <rect x={5} y={7} width={22} height={18} rx={5} />
      case 'ellipse': return <ellipse cx={16} cy={16} rx={11} ry={8} />
      case 'polygon': return <polygon points="10,6 23,8 27,18 20,26 8,23 5,13" />
      case 'scallops': return <path d="M8 8c2-3 5 1 8-1s6-2 8 1c3 2 0 5 2 8s-1 6-4 7c-3 2-5-1-8 1s-6 1-8-2c-2-3 1-5-1-8S5 10 8 8Z" />
      case 'waves': return <path d="M5 11c3-4 6 4 9 0s6 4 9 0 5 2 4 5c-3 4-6-4-9 0s-6-4-9 0-5-2-4-5Z" />
      case 'tension': return <path d="M6 8h20l-3 8 3 8H6l3-8-3-8Z" />
      case 'bracket': return <>{topicShape('bracket')}</>
      default: return <rect x={5} y={7} width={22} height={18} rx={5} />
    }
  })()
  return <Glyph size={size}>{drawing}</Glyph>
}

/** Glyph for a relationship line shape. */
export function LineShapeIcon({ shape, size = 28 }: { shape: string; size?: number }) {
  const line = (() => {
    switch (shape) {
      case 'straight': return <path d="M5 22 27 10" />
      case 'angled': return <path d="M5 23h11V10h11" />
      case 'zigzag': return <path d="m5 22 6-9 5 8 5-10 6 4" />
      case 'flexible-curved': return <path d="M5 23c4-12 9 4 13-8 2-6 5-5 9-5" />
      case 'flexible-angled': return <path d="M5 23h6v-7h6v-6h10" />
      case 'flexible-zigzag': return <path d="m5 23 5-8 5 6 5-9 7 3" />
      case 'curved':
      default: return <path d="M5 23c5-13 11-14 22-13" />
    }
  })()
  return <Glyph size={size}>{line}</Glyph>
}

/** Glyph for a branch connector style. */
export function ConnectorStyleIcon({ style, size = 28 }: { style: string; size?: number }) {
  const line = (() => {
    switch (style) {
      case 'straight': return <path d="M5 23 27 10" />
      case 'elbow': return <path d="M5 23h12V10h10" />
      case 'rounded-elbow': return <path d="M5 23h8a4 4 0 0 0 4-4v-5a4 4 0 0 1 4-4h6" />
      case 'bight': return <path d="M5 23c8 0 4-13 13-13h9" />
      case 'fold': return <path d="M5 23h9l4-13h9" />
      case 'rounded-fold': return <path d="M5 23h7a4 4 0 0 0 4-3l2-7a4 4 0 0 1 4-3h5" />
      case 'curve':
      default: return <path d="M5 23c4-10 12-13 22-13" />
    }
  })()
  return <Glyph size={size}>{line}</Glyph>
}

/** Glyph for a line stroke pattern. */
export function LinePatternIcon({ pattern, size = 26 }: { pattern: string; size?: number }) {
  const dashArray = pattern === 'dash' ? '7 4'
    : pattern === 'dot' ? '1 4'
      : pattern === 'dash-dot' ? '7 3 1 3'
        : pattern === 'dash-dot-dot' ? '7 3 1 3 1 3'
          : undefined
  if (pattern === 'hand-drawn-solid') {
    return <Glyph size={size}><path d="M4 18c5-2 8 2 12 0s7 2 12-1" /></Glyph>
  }
  if (pattern === 'hand-drawn-dash') {
    return <Glyph size={size}><path d="M4 18c3-1 4 1 6 0m3 0c3-2 4 1 6 0m3 0c2-1 3 0 6-1" /></Glyph>
  }
  return <Glyph size={size}><path d="M4 16h24" strokeDasharray={dashArray} /></Glyph>
}

/** Glyph for a relationship endpoint arrow shape. */
export function ArrowShapeIcon({ shape, size = 26 }: { shape: string; size?: number }) {
  const endpoint = (() => {
    switch (shape) {
      case 'none': return null
      case 'dot': return <circle cx={24} cy={16} r={3} fill="currentColor" />
      case 'square': return <rect x={20} y={12} width={8} height={8} fill="currentColor" stroke="none" />
      case 'diamond': return <polygon points="24,11 29,16 24,21 19,16" fill="currentColor" stroke="none" />
      case 'spearhead': return <path d="m19 10 9 6-9 6 3-6-3-6Z" fill="currentColor" stroke="none" />
      case 'herringbone': return <path d="m18 10 5 6-5 6m5-12 5 6-5 6" />
      case 'double-arrow': return <><path d="m18 10 7 6-7 6" /><path d="m23 10 7 6-7 6" /></>
      case 'anti-triangle': return <path d="m28 10-9 6 9 6Z" fill="currentColor" stroke="none" />
      case 'attached': return <path d="M24 9v14m-5-7h9" />
      case 'hook': return <path d="M19 10h5a4 4 0 0 1 0 8h-5" />
      case 'triangle':
      default: return <path d="m20 10 8 6-8 6Z" fill="currentColor" stroke="none" />
    }
  })()
  return <Glyph size={size}><path d="M4 16h17" />{endpoint}</Glyph>
}
