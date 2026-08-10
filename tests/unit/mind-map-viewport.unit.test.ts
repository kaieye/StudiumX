import { describe, expect, it } from 'vitest'
import {
  centerMindMapViewport,
  fitMindMapViewport,
  MAX_MIND_MAP_ZOOM,
  MIN_MIND_MAP_ZOOM,
  zoomMindMapViewport
} from '../../src/renderer/src/views/mindmap/mind-map-viewport'

describe('zoomMindMapViewport', () => {
  it('keeps the point under the pointer fixed while zooming', () => {
    const viewport = {
      pan: { x: 100, y: 50 },
      zoom: 1
    }
    const pointer = { x: 250, y: 150 }
    const next = zoomMindMapViewport(viewport, pointer, 2)

    expect(next.zoom).toBe(2)
    expect(next.pan).toEqual({ x: -50, y: -50 })

    const worldPoint = {
      x: (pointer.x - viewport.pan.x) / viewport.zoom,
      y: (pointer.y - viewport.pan.y) / viewport.zoom
    }
    expect(next.pan.x + worldPoint.x * next.zoom).toBe(pointer.x)
    expect(next.pan.y + worldPoint.y * next.zoom).toBe(pointer.y)
  })

  it('clamps zoom and leaves pan unchanged at the clamp edge', () => {
    const minViewport = { pan: { x: 12, y: -8 }, zoom: MIN_MIND_MAP_ZOOM }
    const maxViewport = { pan: { x: 12, y: -8 }, zoom: MAX_MIND_MAP_ZOOM }
    const min = zoomMindMapViewport(minViewport, { x: 300, y: 200 }, 0)
    const max = zoomMindMapViewport(maxViewport, { x: 300, y: 200 }, 100)

    expect(min).toEqual(minViewport)
    expect(max).toEqual(maxViewport)
  })

  it('does not move the viewport for a no-op factor', () => {
    const viewport = { pan: { x: 7, y: 9 }, zoom: 1.5 }
    expect(zoomMindMapViewport(viewport, { x: 200, y: 100 }, 1)).toEqual(viewport)
  })
})

describe('fitMindMapViewport', () => {
  it('fits the full bounds within the viewport and centers the result', () => {
    const bounds = { left: -160, top: 0, right: 320, bottom: 200 }
    const viewport = fitMindMapViewport(bounds, { width: 800, height: 600 }, 48)

    expect(viewport.zoom).toBeCloseTo(704 / 480)
    expect(viewport.pan.x).toBeCloseTo((800 - (bounds.left + bounds.right) * viewport.zoom) / 2)
    expect(viewport.pan.y).toBeCloseTo((600 - (bounds.top + bounds.bottom) * viewport.zoom) / 2)

    const fitted = {
      left: viewport.pan.x + bounds.left * viewport.zoom,
      top: viewport.pan.y + bounds.top * viewport.zoom,
      right: viewport.pan.x + bounds.right * viewport.zoom,
      bottom: viewport.pan.y + bounds.bottom * viewport.zoom
    }
    expect(fitted.left).toBeGreaterThanOrEqual(48 - 1e-8)
    expect(fitted.top).toBeGreaterThanOrEqual(48 - 1e-8)
    expect(fitted.right).toBeLessThanOrEqual(800 - 48 + 1e-8)
    expect(fitted.bottom).toBeLessThanOrEqual(600 - 48 + 1e-8)
  })

  it('normalizes reversed bounds and clamps tiny viewports to a finite minimum zoom', () => {
    const viewport = fitMindMapViewport(
      { left: 100, top: 60, right: 0, bottom: 0 },
      { width: 0, height: 0 },
      48
    )

    expect(viewport.zoom).toBe(MIN_MIND_MAP_ZOOM)
    expect(Number.isFinite(viewport.pan.x)).toBe(true)
    expect(Number.isFinite(viewport.pan.y)).toBe(true)
  })

  it('does not exceed the maximum zoom for a tiny content region', () => {
    const viewport = fitMindMapViewport(
      { left: 20, top: 30, right: 20, bottom: 30 },
      { width: 800, height: 600 },
      48
    )

    expect(viewport.zoom).toBe(MAX_MIND_MAP_ZOOM)
    expect(viewport.pan).toEqual({ x: 340, y: 210 })
  })

  it('centers content without changing a valid requested zoom', () => {
    expect(
      centerMindMapViewport(
        { left: -100, top: 20, right: 300, bottom: 220 },
        { width: 800, height: 600 },
        1.5
      )
    ).toEqual({
      pan: { x: 250, y: 120 },
      zoom: 1.5
    })
  })
})
