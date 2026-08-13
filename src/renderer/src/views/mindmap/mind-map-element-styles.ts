import type {
  MindMapElementArrowShape,
  MindMapElementLinePattern,
  MindMapElementLineShape,
  MindMapElementOutlineShape
} from '../../../../shared/mindmap/domain/types'

/**
 * Renderer-side geometry helpers for advanced non-topic element styling.
 *
 * These are pure SVG string/fragment helpers mirroring the XMind vocabulary:
 * relationship connector shapes (`org.xmind.relationshipShape.*`), endpoint
 * arrows (`org.xmind.arrowShape.*`), line patterns
 * (`solid/dash/dot/dash-dot/dash-dot-dot`) and container outlines
 * (boundary/summary/callout shapes). The canvas consumes these together with
 * `MindMapElementStyle` so every declared field has a visual consequence.
 */

export type ElementPathPoint = { x: number; y: number }

function controlOffset(shape: MindMapElementLineShape | undefined, dx: number): number {
  switch (shape) {
    case 'straight':
      return 0
    case 'angled':
    case 'flexible-angled':
      return Math.abs(dx) * 0.5
    case 'zigzag':
    case 'flexible-zigzag':
      return Math.abs(dx) * 0.28
    case 'flexible-curved':
      return Math.abs(dx) * 0.72
    case 'curved':
    default:
      return Math.abs(dx) * 0.5
  }
}

/**
 * Relationship connector path for one of the XMind relationship shapes.
 * All shapes keep their endpoints on the topic borders.
 */
export function relationshipElementPath(
  from: ElementPathPoint,
  to: ElementPathPoint,
  shape: MindMapElementLineShape = 'curved'
): string {
  const toRight = to.x >= from.x
  const midX = from.x + (to.x - from.x) / 2
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const cx1 = shape === 'straight' || shape === 'angled' || shape === 'flexible-angled'
    ? toRight ? from.x + dx * 0.5 : from.x - dx * 0.5
    : toRight ? from.x + controlOffset(shape, dx) : from.x - controlOffset(shape, dx)
  const cx2 = shape === 'straight' || shape === 'angled' || shape === 'flexible-angled'
    ? toRight ? to.x - dx * 0.5 : to.x + dx * 0.5
    : toRight ? to.x - controlOffset(shape, dx) : to.x + controlOffset(shape, dx)

  if (shape === 'zigzag' || shape === 'flexible-zigzag') {
    const segments = 4
    const points: string[] = [`M ${from.x} ${from.y}`]
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments
      const px = from.x + (to.x - from.x) * t
      const saw = i % 2 === 0 ? dy * 0.22 : -dy * 0.22
      const py = shape === 'flexible-zigzag' && i < segments
        ? from.y + (to.y - from.y) * t + saw
        : i === segments ? to.y : from.y + (to.y - from.y) * t + saw
      points.push(`L ${px} ${py}`)
    }
    return `${points.join(' ')} L ${to.x} ${to.y}`
  }

  if (shape === 'angled' || shape === 'flexible-angled') {
    return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`
  }

  // Curved family: cubic bezier with symmetric controls.
  return `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`
}

/**
 * Marker path fragment for one endpoint arrow shape (10×10 viewBox).
 * `none` returns undefined so the canvas simply omits the marker.
 */
export function relationshipArrowMarkerPath(
  arrow: MindMapElementArrowShape | undefined
): string | undefined {
  switch (arrow) {
    case 'dot':
      return 'M 2 5 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0'
    case 'triangle':
    case 'spearhead':
      return 'M 0 0 L 10 5 L 0 10 Z'
    case 'square':
      return 'M 1 1 L 9 1 L 9 9 L 1 9 Z'
    case 'diamond':
      return 'M 5 0 L 10 5 L 5 10 L 0 5 Z'
    case 'herringbone':
      return 'M 1 1 L 8 5 L 1 9 M 4 1 L 11 5 L 4 9'
    case 'double-arrow':
      return 'M 0 0 L 6 5 L 0 10 M 10 0 L 4 5 L 10 10'
    case 'anti-triangle':
      return 'M 10 0 L 0 5 L 10 10 Z'
    case 'attached':
      return 'M 0 0 L 6 5 L 0 10 M 6 0 L 12 5 L 6 10'
    case 'hook':
      return 'M 1 1 C 6 1 9 3 8 8 L 8 5 M 8 5 L 5 8'
    case 'none':
    default:
      return undefined
  }
}

/** Dash array for an element line pattern (SVG user units). */
export function elementLineDashArray(pattern: MindMapElementLinePattern | undefined): string | undefined {
  switch (pattern) {
    case 'dash':
      return '6 4'
    case 'dot':
      return '1 4'
    case 'dash-dot':
      return '6 3 1 3'
    case 'dash-dot-dot':
      return '6 3 1 3 1 3'
    case 'solid':
    default:
      return undefined
  }
}

export type ElementOutlineRect = { x: number; y: number; width: number; height: number }

/**
 * Boundary/summary/callout container outlines. The default remains the
 * rounded-rectangle/brace used before the typed field existed.
 */
export function elementOutlinePath(
  rect: ElementOutlineRect,
  shape: MindMapElementOutlineShape | undefined
): string {
  const { x, y, width, height } = rect
  const r = Math.min(12, Math.max(4, Math.min(width, height) * 0.12))
  switch (shape) {
    case 'rectangle':
      return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`
    case 'ellipse': {
      const cx = x + width / 2
      const cy = y + height / 2
      const rx = width / 2
      const ry = height / 2
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`
    }
    case 'polygon': {
      const inset = Math.min(10, Math.max(3, Math.min(width, height) * 0.1))
      return [
        `M ${x + inset} ${y}`,
        `L ${x + width - inset} ${y}`,
        `L ${x + width} ${y + height * 0.42}`,
        `L ${x + width - inset} ${y + height}`,
        `L ${x + inset} ${y + height}`,
        `L ${x} ${y + height * 0.42}`,
        'Z'
      ].join(' ')
    }
    case 'scallops': {
      const count = Math.max(2, Math.floor(width / 18))
      const step = width / count
      const h = Math.min(7, height * 0.09)
      const top = [`M ${x} ${y + h}`]
      for (let i = 0; i < count; i += 1) {
        const cx = x + step * i + step / 2
        top.push(`Q ${cx} ${y - h} ${x + step * (i + 1)} ${y + h}`)
      }
      top.push(`L ${x + width} ${y + height - h}`)
      for (let i = count - 1; i >= 0; i -= 1) {
        const cx = x + step * i + step / 2
        top.push(`Q ${cx} ${y + height + h} ${x + step * i} ${y + height - h}`)
      }
      top.push('Z')
      return top.join(' ')
    }
    case 'waves': {
      const count = Math.max(2, Math.floor(width / 16))
      const step = width / count
      const top = [`M ${x} ${y + 4}`]
      for (let i = 0; i < count; i += 1) {
        const cx = x + step * i + step / 2
        const sign = i % 2 === 0 ? -1 : 1
        top.push(`Q ${cx} ${y + 4 + sign * 6} ${x + step * (i + 1)} ${y + 4}`)
      }
      top.push(`L ${x + width} ${y + height - 4}`)
      for (let i = count - 1; i >= 0; i -= 1) {
        const cx = x + step * i + step / 2
        const sign = i % 2 === 0 ? -1 : 1
        top.push(`Q ${cx} ${y + height - 4 + sign * 6} ${x + step * i} ${y + height - 4}`)
      }
      top.push('Z')
      return top.join(' ')
    }
    case 'tension': {
      const inset = Math.min(14, Math.max(4, Math.min(width, height) * 0.14))
      return [
        `M ${x} ${y + inset}`,
        `Q ${x} ${y} ${x + inset} ${y}`,
        `L ${x + width - inset} ${y}`,
        `Q ${x + width} ${y} ${x + width} ${y + inset}`,
        `L ${x + width} ${y + height - inset}`,
        `Q ${x + width} ${y + height} ${x + width - inset} ${y + height}`,
        `L ${x + inset} ${y + height}`,
        `Q ${x} ${y + height} ${x} ${y + height - inset}`,
        'Z'
      ].join(' ')
    }
    case 'bracket': {
      const inset = Math.min(10, Math.max(4, Math.min(width, height) * 0.1))
      return [
        `M ${x} ${y + inset}`,
        `L ${x} ${y}`,
        `L ${x + inset} ${y}`,
        `M ${x + width - inset} ${y}`,
        `L ${x + width} ${y}`,
        `L ${x + width} ${y + inset}`,
        `M ${x + width} ${y + height - inset}`,
        `L ${x + width} ${y + height}`,
        `L ${x + width - inset} ${y + height}`,
        `M ${x + inset} ${y + height}`,
        `L ${x} ${y + height}`,
        `L ${x} ${y + height - inset}`
      ].join(' ')
    }
    case 'rounded-rectangle':
    default:
      return [
        `M ${x + r} ${y}`,
        `L ${x + width - r} ${y}`,
        `Q ${x + width} ${y} ${x + width} ${y + r}`,
        `L ${x + width} ${y + height - r}`,
        `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
        `L ${x + r} ${y + height}`,
        `Q ${x} ${y + height} ${x} ${y + height - r}`,
        `L ${x} ${y + r}`,
        `Q ${x} ${y} ${x + r} ${y}`,
        'Z'
      ].join(' ')
  }
}
