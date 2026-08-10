export type MindMapViewportPoint = {
  x: number
  y: number
}

export type MindMapViewportState = {
  pan: MindMapViewportPoint
  zoom: number
}

export type MindMapViewportBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export type MindMapViewportSize = {
  width: number
  height: number
}

export const MIN_MIND_MAP_ZOOM = 0.25
export const MAX_MIND_MAP_ZOOM = 3

function clampZoom(zoom: number): number {
  return Math.min(MAX_MIND_MAP_ZOOM, Math.max(MIN_MIND_MAP_ZOOM, zoom))
}

/**
 * Zoom the canvas around a point in SVG user space.
 *
 * The point under the pointer remains stationary while the scale changes, so
 * wheel zoom does not pull the map toward the top-left corner.
 */
export function zoomMindMapViewport(
  viewport: MindMapViewportState,
  pointer: MindMapViewportPoint,
  factor: number
): MindMapViewportState {
  const currentZoom = clampZoom(viewport.zoom)
  const nextZoom = clampZoom(currentZoom * factor)
  if (nextZoom === currentZoom) {
    return { pan: { ...viewport.pan }, zoom: currentZoom }
  }

  const ratio = nextZoom / currentZoom
  return {
    pan: {
      x: pointer.x - (pointer.x - viewport.pan.x) * ratio,
      y: pointer.y - (pointer.y - viewport.pan.y) * ratio
    },
    zoom: nextZoom
  }
}

/**
 * Compute a camera that fits a set of layout bounds inside a viewport.
 *
 * The result uses the same screen transform as the canvas (`pan + point *
 * zoom`). It is intentionally independent of DOM measurement, so the canvas
 * can decide when/how to obtain its current client size without duplicating
 * fit math. The content is centered after applying the requested padding;
 * zoom remains within the normal canvas limits.
 */
export function fitMindMapViewport(
  bounds: MindMapViewportBounds,
  viewport: MindMapViewportSize,
  padding = 48
): MindMapViewportState {
  const viewportWidth = Math.max(1, viewport.width)
  const viewportHeight = Math.max(1, viewport.height)
  const safePadding = Math.max(0, padding)
  const contentLeft = Math.min(bounds.left, bounds.right)
  const contentRight = Math.max(bounds.left, bounds.right)
  const contentTop = Math.min(bounds.top, bounds.bottom)
  const contentBottom = Math.max(bounds.top, bounds.bottom)
  const contentWidth = Math.max(1, contentRight - contentLeft)
  const contentHeight = Math.max(1, contentBottom - contentTop)
  const availableWidth = Math.max(1, viewportWidth - safePadding * 2)
  const availableHeight = Math.max(1, viewportHeight - safePadding * 2)
  const zoom = clampZoom(Math.min(availableWidth / contentWidth, availableHeight / contentHeight))

  return centerMindMapViewport(
    { left: contentLeft, top: contentTop, right: contentRight, bottom: contentBottom },
    { width: viewportWidth, height: viewportHeight },
    zoom
  )
}

/** Center content at a requested zoom without changing its scale. */
export function centerMindMapViewport(
  bounds: MindMapViewportBounds,
  viewport: MindMapViewportSize,
  zoom: number
): MindMapViewportState {
  const viewportWidth = Math.max(1, viewport.width)
  const viewportHeight = Math.max(1, viewport.height)
  const contentLeft = Math.min(bounds.left, bounds.right)
  const contentRight = Math.max(bounds.left, bounds.right)
  const contentTop = Math.min(bounds.top, bounds.bottom)
  const contentBottom = Math.max(bounds.top, bounds.bottom)
  const safeZoom = clampZoom(zoom)

  return {
    pan: {
      x: (viewportWidth - (contentLeft + contentRight) * safeZoom) / 2,
      y: (viewportHeight - (contentTop + contentBottom) * safeZoom) / 2
    },
    zoom: safeZoom
  }
}
