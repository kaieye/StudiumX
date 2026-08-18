import { describe, expect, it } from 'vitest'
import {
  MIND_MAP_SHAPE_EDIT_MINIMUM_SIZE,
  MIND_MAP_SHAPE_MINIMUM_SIZE,
  mindMapDrawingShapePath,
  mindMapShapeBounds,
  normalizeMindMapDrawRect,
  resizeMindMapDrawRect,
  translateMindMapDrawRect
} from '../../src/renderer/src/views/mindmap/mind-map-drawing-geometry'

describe('mind map drawing geometry', () => {
  it('normalizes drags in every direction into a top-left rectangle', () => {
    expect(normalizeMindMapDrawRect({ x: 10, y: 20 }, { x: 70, y: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 60
    })
    expect(normalizeMindMapDrawRect({ x: 70, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 60
    })
    expect(normalizeMindMapDrawRect({ x: 70, y: 20 }, { x: 10, y: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 60
    })
    expect(normalizeMindMapDrawRect({ x: 10, y: 80 }, { x: 70, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 60
    })
  })

  it('enforces a useful minimum size for click-like gestures', () => {
    expect(normalizeMindMapDrawRect(
      { x: 42, y: 24 },
      { x: 42, y: 24 },
      MIND_MAP_SHAPE_MINIMUM_SIZE
    )).toEqual({
      x: 42,
      y: 24,
      width: MIND_MAP_SHAPE_MINIMUM_SIZE,
      height: MIND_MAP_SHAPE_MINIMUM_SIZE
    })

    expect(normalizeMindMapDrawRect(
      { x: 100, y: 100 },
      { x: 96, y: 112 },
      8
    )).toEqual({
      x: 96,
      y: 100,
      width: 8,
      height: 12
    })
  })

  it('builds a rectangular path from the normalized bounds', () => {
    expect(mindMapDrawingShapePath('rect', {
      x: 10,
      y: 20,
      width: 40,
      height: 30
    })).toBe('M 10 20 H 50 V 50 H 10 Z')
  })

  it('uses the expected vertices for polygonal drawing shapes', () => {
    const rect = { x: 10, y: 20, width: 40, height: 30 }

    expect(mindMapDrawingShapePath('diamond', rect)).toBe(
      'M 30 20 L 50 35 L 30 50 L 10 35 Z'
    )
    expect(mindMapDrawingShapePath('parallelogram', rect)).toContain(
      'M 18.8 20 H 50 L 41.2 50 H 10 Z'
    )
    expect(mindMapDrawingShapePath('hexagon', rect)).toContain(
      'M 18.8 20 H 41.2 L 50 35 L 41.2 50 H 18.8 L 10 35 Z'
    )
  })

  it('uses curves for rounded rectangles and arcs for ellipses', () => {
    const rect = { x: 10, y: 20, width: 40, height: 30 }
    const roundedPath = mindMapDrawingShapePath('rounded-rect', rect)
    const ellipsePath = mindMapDrawingShapePath('ellipse', rect)

    expect(roundedPath).toMatch(/^M [^ ]+ 20 H [^ ]+ Q /)
    expect(roundedPath).toMatch(/ V [^ ]+ Q /)
    expect(roundedPath.match(/Q/g)).toHaveLength(4)
    expect(roundedPath.endsWith(' Z')).toBe(true)
    expect(ellipsePath).toContain('A 20 15 0 1 0 50 35')
    expect(ellipsePath).toContain('A 20 15 0 1 0 10 35')
    expect(ellipsePath.endsWith(' Z')).toBe(true)
  })

  it('returns shape bounds without changing the supplied position or dimensions', () => {
    const position = { x: -12, y: 36 }

    expect(mindMapShapeBounds(position, 128, 72)).toEqual({
      x: -12,
      y: 36,
      width: 128,
      height: 72
    })
  })

  it('translates an existing shape without changing its dimensions', () => {
    const rect = { x: 10, y: 20, width: 100, height: 60 }

    expect(translateMindMapDrawRect(rect, { x: 12, y: -5 })).toEqual({
      x: 22,
      y: 15,
      width: 100,
      height: 60
    })
  })

  it('resizes from a north-west handle while keeping the opposite edges fixed', () => {
    const rect = { x: 10, y: 20, width: 100, height: 60 }
    const resized = resizeMindMapDrawRect(rect, 'nw', { x: 20, y: 10 })

    expect(resized).toEqual({ x: 30, y: 30, width: 80, height: 50 })
    expect(resized.x + resized.width).toBe(rect.x + rect.width)
    expect(resized.y + resized.height).toBe(rect.y + rect.height)
  })

  it('keeps an existing small shape stable until the user actually enlarges it', () => {
    const rect = { x: 10, y: 20, width: 8, height: 12 }

    expect(resizeMindMapDrawRect(rect, 'se', { x: 0, y: 0 })).toEqual(rect)
    expect(resizeMindMapDrawRect(rect, 'se', { x: 32, y: 24 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 36
    })
  })

  it('clamps a resize to the editable minimum while preserving the fixed edges', () => {
    const rect = { x: 10, y: 20, width: 100, height: 60 }
    const resized = resizeMindMapDrawRect(rect, 'nw', { x: 10_000, y: 10_000 })

    expect(resized).toEqual({
      x: 110 - MIND_MAP_SHAPE_EDIT_MINIMUM_SIZE,
      y: 80 - MIND_MAP_SHAPE_EDIT_MINIMUM_SIZE,
      width: MIND_MAP_SHAPE_EDIT_MINIMUM_SIZE,
      height: MIND_MAP_SHAPE_EDIT_MINIMUM_SIZE
    })
    expect(resized.x + resized.width).toBe(rect.x + rect.width)
    expect(resized.y + resized.height).toBe(rect.y + rect.height)
  })
})
