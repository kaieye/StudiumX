import type { ReactNode } from 'react'
import type { NodeShape } from './mind-map-node-shapes'
import {
  XMIND_ARROW_PATHS,
  XMIND_CONNECTOR_PATHS,
  XMIND_LINE_PATTERN_PATHS,
  XMIND_LINE_SHAPE_PATHS,
  XMIND_NODE_SHAPE_PATHS,
  XMIND_OUTLINE_SHAPE_PATHS,
  type XmindIconDef
} from './mind-map-xmind-icon-paths'

/**
 * Small graphical glyphs used inside the shape / border / branch pickers.
 *
 * Xmind renders each option in these menus as a miniature drawing of the
 * shape rather than a bare text label. These components reproduce Xmind's own
 * filled vector assets (see `mind-map-xmind-icon-paths.ts`) so the pickers
 * show the exact same icons, drawn with `currentColor` to inherit the theme.
 */

type GlyphProps = {
  size?: number
  viewBox?: string
  children: ReactNode
}

function Glyph({ size = 26, viewBox = '0 0 32 32', children }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      aria-hidden="true"
      className="mindmap-shape-glyph"
    >
      {children}
    </svg>
  )
}

function FilledPaths({ def, size }: { def: XmindIconDef; size?: number }) {
  return (
    <Glyph size={size} viewBox={def.viewBox}>
      {def.d.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </Glyph>
  )
}

/**
 * Glyph for a node (topic) shape. Shapes without a direct XMind counterpart
 * (`none`, `callout`) fall back to clear stroke approximations so every option
 * still has a concrete picture.
 */
export function NodeShapeIcon({ shape, size = 26 }: { shape: NodeShape | 'none'; size?: number }) {
  if (shape === 'none' || shape === 'no-shape') {
    return (
      <Glyph size={size}>
        <rect x={5} y={8} width={22} height={16} rx={4} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="3 3" />
      </Glyph>
    )
  }
  if (shape === 'callout') {
    return (
      <Glyph size={size}>
        <path
          d="M9 7 h14 a5 5 0 0 1 5 5 v6 a5 5 0 0 1 -5 5 h-8 l-4 4 v-4 h-2 a5 5 0 0 1 -5 -5 v-6 a5 5 0 0 1 5 -5 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      </Glyph>
    )
  }
  const def = XMIND_NODE_SHAPE_PATHS[shape] ?? XMIND_NODE_SHAPE_PATHS['rounded-rect']
  return <FilledPaths def={def} size={size} />
}

/** Glyph for a boundary / summary / callout outline shape. */
export function OutlineShapeIcon({ shape, size = 26 }: { shape: string; size?: number }) {
  const def = XMIND_OUTLINE_SHAPE_PATHS[shape]
  if (def) return <FilledPaths def={def} size={size} />
  // `ellipse` and `bracket` are not boundary shapes in XMind's catalogue, so
  // fall back to the closest topic-shape glyph to keep the option visual.
  const fallback = shape === 'ellipse' || shape === 'bracket'
    ? XMIND_NODE_SHAPE_PATHS[shape === 'ellipse' ? 'ellipse' : 'bracket']
    : XMIND_OUTLINE_SHAPE_PATHS['rounded-rectangle']
  return <FilledPaths def={fallback} size={size} />
}

/** Glyph for a relationship line shape (element style). */
export function LineShapeIcon({ shape, size = 28 }: { shape: string; size?: number }) {
  const def = XMIND_LINE_SHAPE_PATHS[shape]
  if (def) return <FilledPaths def={def} size={size} />
  return <FilledPaths def={XMIND_LINE_SHAPE_PATHS['curved']} size={size} />
}

/** Glyph for a canvas branch connector style (lineStyle). */
export function ConnectorStyleIcon({ style, size = 28 }: { style: string; size?: number }) {
  const def = XMIND_CONNECTOR_PATHS[style]
  if (def) return <FilledPaths def={def} size={size} />
  return <FilledPaths def={XMIND_CONNECTOR_PATHS['curve']} size={size} />
}

/** Glyph for a line stroke pattern (solid / dash / dot / hand-drawn …). */
export function LinePatternIcon({ pattern, size = 26 }: { pattern: string; size?: number }) {
  const def = XMIND_LINE_PATTERN_PATHS[pattern]
  if (def) return <FilledPaths def={def} size={size} />
  return <FilledPaths def={XMIND_LINE_PATTERN_PATHS['solid']} size={size} />
}

/** Glyph for a relationship endpoint arrow shape. */
export function ArrowShapeIcon({ shape, size = 26 }: { shape: string; size?: number }) {
  const def = XMIND_ARROW_PATHS[shape]
  if (def) return <FilledPaths def={def} size={size} />
  return <FilledPaths def={XMIND_ARROW_PATHS['triangle']} size={size} />
}
