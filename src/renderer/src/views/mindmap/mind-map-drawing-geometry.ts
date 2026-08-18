import type { MindMapDrawingShape, MindMapPoint } from '../../../../shared/mindmap/domain/types'

export type MindMapDrawRect = {
  x: number
  y: number
  width: number
  height: number
}

/** Handles exposed by the selected free-shape bounding box. */
export type MindMapShapeResizeHandle =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'

/** Minimum useful size for a shape gesture in document pixels. */
export const MIND_MAP_SHAPE_MINIMUM_SIZE = 8

/**
 * A selected shape should remain large enough for its label and resize handles.
 * This is deliberately independent from the smaller threshold used while first
 * drawing a shape. Existing/imported shapes smaller than this remain valid:
 * their current dimension is their effective floor until the user enlarges it.
 */
export const MIND_MAP_SHAPE_EDIT_MINIMUM_SIZE = 24

/** Normalize a drag in any direction into a positive canvas rectangle. */
export function normalizeMindMapDrawRect(
  start: MindMapPoint,
  end: MindMapPoint,
  minimumSize = 0
): MindMapDrawRect {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.max(minimumSize, Math.abs(end.x - start.x))
  const height = Math.max(minimumSize, Math.abs(end.y - start.y))
  return { x, y, width, height }
}

/** Return the SVG path for a free-form drawing shape. */
export function mindMapDrawingShapePath(
  shape: MindMapDrawingShape,
  rect: MindMapDrawRect
): string {
  const { x, y, width, height } = rect
  const right = x + width
  const bottom = y + height
  const cx = x + width / 2
  const cy = y + height / 2

  switch (shape) {
    case 'rect':
      return `M ${x} ${y} H ${right} V ${bottom} H ${x} Z`
    case 'rounded-rect': {
      const radius = Math.min(width, height, 18) * 0.18
      return `M ${x + radius} ${y} H ${right - radius} Q ${right} ${y} ${right} ${y + radius} V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${x + radius} Q ${x} ${bottom} ${x} ${bottom - radius} V ${y + radius} Q ${x} ${y} ${x + radius} ${y} Z`
    }
    case 'ellipse': {
      return `M ${cx - width / 2} ${cy} A ${width / 2} ${height / 2} 0 1 0 ${cx + width / 2} ${cy} A ${width / 2} ${height / 2} 0 1 0 ${cx - width / 2} ${cy} Z`
    }
    case 'diamond':
      return `M ${cx} ${y} L ${right} ${cy} L ${cx} ${bottom} L ${x} ${cy} Z`
    case 'parallelogram': {
      const skew = Math.min(width * 0.22, Math.max(8, height * 0.45))
      return `M ${x + skew} ${y} H ${right} L ${right - skew} ${bottom} H ${x} Z`
    }
    case 'hexagon': {
      const inset = Math.min(width * 0.22, Math.max(8, width / 4))
      return `M ${x + inset} ${y} H ${right - inset} L ${right} ${cy} L ${right - inset} ${bottom} H ${x + inset} L ${x} ${cy} Z`
    }
  }
}

/** Extract the rectangle used by the shape snap/render layers. */
export function mindMapShapeBounds(
  position: MindMapPoint,
  width: number,
  height: number
): MindMapDrawRect {
  return { x: position.x, y: position.y, width, height }
}

/** Translate a shape rectangle without changing its dimensions. */
export function translateMindMapDrawRect(
  rect: MindMapDrawRect,
  delta: MindMapPoint
): MindMapDrawRect {
  return {
    x: rect.x + delta.x,
    y: rect.y + delta.y,
    width: rect.width,
    height: rect.height
  }
}

/**
 * Resize a rectangle from one of its bounding-box handles.
 *
 * `delta` is measured from the pointer position at the beginning of the
 * interaction, so each preview derives from the same initial rectangle. That
 * prevents accumulated rounding drift and keeps the opposite edge fixed, just
 * like a normal select-tool resize interaction.
 */
export function resizeMindMapDrawRect(
  rect: MindMapDrawRect,
  handle: MindMapShapeResizeHandle,
  delta: MindMapPoint,
  minimumSize = MIND_MAP_SHAPE_EDIT_MINIMUM_SIZE
): MindMapDrawRect {
  const minimum = Math.max(0, minimumSize)
  // Do not make a small valid shape jump in size merely because a resize
  // handle was pressed. It may grow freely, but it cannot shrink below its
  // existing dimension until it has crossed the normal editing minimum.
  const minimumWidth = Math.min(minimum, rect.width)
  const minimumHeight = Math.min(minimum, rect.height)
  let x = rect.x
  let y = rect.y
  let width = rect.width
  let height = rect.height

  if (handle.includes('w')) {
    width = Math.max(minimumWidth, rect.width - delta.x)
    x = rect.x + rect.width - width
  } else if (handle.includes('e')) {
    width = Math.max(minimumWidth, rect.width + delta.x)
  }

  if (handle.includes('n')) {
    height = Math.max(minimumHeight, rect.height - delta.y)
    y = rect.y + rect.height - height
  } else if (handle.includes('s')) {
    height = Math.max(minimumHeight, rect.height + delta.y)
  }

  return { x, y, width, height }
}
