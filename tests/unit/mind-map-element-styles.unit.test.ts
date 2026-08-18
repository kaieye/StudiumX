import { describe, expect, it } from 'vitest'
import {
  elementLineDashArray,
  elementOutlinePath,
  relationshipArrowMarkerMetrics,
  relationshipArrowMarkerPath,
  relationshipElementPath
} from '../../src/renderer/src/views/mindmap/mind-map-element-styles'

describe('mind map element style geometry helpers', () => {
  describe('relationshipElementPath', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 200, y: 80 }

    it('defaults to a curved cubic bezier with symmetric controls', () => {
      expect(relationshipElementPath(from, to)).toBe(
        'M 0 0 C 100 0, 100 80, 200 80'
      )
    })

    it('renders straight/angled shapes without cubic controls', () => {
      expect(relationshipElementPath(from, to, 'straight')).toBe(
        'M 0 0 L 200 80'
      )
      expect(relationshipElementPath(from, to, 'angled')).toBe(
        'M 0 0 L 100 0 L 100 80 L 200 80'
      )
      expect(relationshipElementPath(from, to, 'flexible-angled')).toBe(
        'M 0 0 L 100 0 L 100 80 L 200 80'
      )
    })

    it('renders one quadratic arc through its draggable middle point', () => {
      const path = relationshipElementPath(from, to, 'curved', {
        curvePoint: { x: 100, y: 36 }
      })

      // For a quadratic Bezier, B(0.5) = (from + 2 * control + to) / 4.
      // A control point at (100, 32) therefore puts the visible midpoint at
      // exactly (100, 36) without joining two independently bending segments.
      expect(path).toBe('M 0 0 Q 100 32, 200 80')
    })

    it('keeps anchored curve entry and exit tangents aligned with their targets', () => {
      const curvePoint = { x: 100, y: 36 }
      const path = relationshipElementPath(from, to, 'curved', {
        curvePoint,
        fromTangent: { x: 0, y: 1 },
        toTangent: { x: 0, y: 1 }
      })
      const segments = path.split(' C ')
      if (segments.length !== 3) throw new Error('expected two cubic curve segments')
      const numbers = (segment: string) => (
        segment.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      )
      const first = numbers(segments[1]!)
      const last = numbers(segments[2]!)

      expect(first).toHaveLength(6)
      expect(last).toHaveLength(6)
      expect(first[0]).toBeCloseTo(from.x)
      expect(first[1]).toBeGreaterThan(from.y)
      expect(first.slice(-2)).toEqual([curvePoint.x, curvePoint.y])
      expect(last[2]).toBeCloseTo(to.x)
      expect(last[3]).toBeLessThan(to.y)
      expect(last.slice(-2)).toEqual([to.x, to.y])
    })

    it('smooths a dragged curve through its actual incoming and outgoing legs', () => {
      const curvePoint = { x: 40, y: 120 }
      const path = relationshipElementPath({ x: 0, y: 0 }, { x: 200, y: 0 }, 'curved', {
        curvePoint,
        fromTangent: { x: 1, y: 0 },
        toTangent: { x: -1, y: 0 }
      })
      const segments = path.split(' C ')
      if (segments.length !== 3) throw new Error('expected two cubic curve segments')
      const numbers = (segment: string) => (
        segment.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      )
      const first = numbers(segments[1]!)
      const last = numbers(segments[2]!)
      const incomingTangent = {
        x: curvePoint.x - first[2]!,
        y: curvePoint.y - first[3]!
      }
      const outgoingTangent = {
        x: last[0]! - curvePoint.x,
        y: last[1]! - curvePoint.y
      }

      // The old implementation algebraically reduced this direction to the
      // direct endpoint vector (horizontal here), ignoring the dragged point.
      expect(incomingTangent.y).toBeGreaterThan(0)
      expect(outgoingTangent.y).toBeGreaterThan(0)
      expect(incomingTangent.x / incomingTangent.y)
        .toBeCloseTo(outgoingTangent.x / outgoingTangent.y, 6)
    })

    it('renders zigzag variants as segmented polylines that reach the target', () => {
      const zigzag = relationshipElementPath(from, to, 'zigzag')
      expect(zigzag.startsWith('M 0 0')).toBe(true)
      expect(zigzag.endsWith(`L ${to.x} ${to.y}`)).toBe(true)
      expect(zigzag.split(' L ').length).toBeGreaterThan(4)

      const flexible = relationshipElementPath(from, to, 'flexible-zigzag')
      expect(flexible.startsWith('M 0 0')).toBe(true)
      expect(flexible.endsWith(`L ${to.x} ${to.y}`)).toBe(true)
    })

    it('keeps left-facing connectors on the left edges', () => {
      const leftTo = { x: 20, y: 60 }
      const d = relationshipElementPath({ x: 200, y: 0 }, leftTo, 'flexible-curved')
      expect(d.startsWith('M 200 0')).toBe(true)
      expect(d).toContain('C 70.4 0')
    })
  })

  describe('relationshipArrowMarkerPath', () => {
    it('returns undefined for none/undefined so the canvas omits markers', () => {
      expect(relationshipArrowMarkerPath(undefined)).toBeUndefined()
      expect(relationshipArrowMarkerPath('none')).toBeUndefined()
    })

    it('returns a fillable marker fragment for every declared arrow', () => {
      for (const arrow of [
        'dot', 'triangle', 'spearhead', 'square', 'diamond',
        'herringbone', 'double-arrow', 'anti-triangle', 'attached', 'hook'
      ] as const) {
        const d = relationshipArrowMarkerPath(arrow)
        expect(typeof d).toBe('string')
        expect(d!.length).toBeGreaterThan(0)
      }
    })

    it('uses compact marker paths in the 10×10 viewBox coordinate space', () => {
      expect(relationshipArrowMarkerPath('dot')).toContain('a 3 3')
      expect(relationshipArrowMarkerPath('square')).toContain('L 9 9')
      expect(relationshipArrowMarkerPath('triangle')).toBe('M 1 1.2 L 9.7 5 L 1 8.8 Z')
      expect(relationshipArrowMarkerPath('spearhead')).toBe('M 1.25 1.35 L 9.5 5 L 1.25 8.65')
    })

    it('keeps marker ink outboard of a snapped target and preserves wide chevrons', () => {
      expect(relationshipArrowMarkerMetrics(undefined)).toBeUndefined()
      expect(relationshipArrowMarkerMetrics('none')).toBeUndefined()
      expect(relationshipArrowMarkerMetrics('dot')).toEqual({ refX: 9 })
      expect(relationshipArrowMarkerMetrics('triangle')).toEqual({
        refX: 10.45,
        markerWidth: 12,
        markerHeight: 12
      })
      expect(relationshipArrowMarkerMetrics('spearhead')).toEqual({ refX: 9, open: true })
      expect(relationshipArrowMarkerMetrics('square')).toEqual({ refX: 10 })
      expect(relationshipArrowMarkerMetrics('hook')).toEqual({ refX: 10, open: true })
      expect(relationshipArrowMarkerMetrics('herringbone')).toEqual({ refX: 12, overflow: 'visible', open: true })
      expect(relationshipArrowMarkerMetrics('attached')).toEqual({ refX: 13, overflow: 'visible', open: true })

      const triangle = relationshipArrowMarkerMetrics('triangle')
      if (!triangle) throw new Error('expected triangle metrics')
      const visibleTipOffset = (9.7 - triangle.refX) * (triangle.markerWidth ?? 8) / 10
      expect(visibleTipOffset).toBeLessThan(0)
    })
  })

  describe('elementLineDashArray', () => {
    it('maps every declared pattern to an SVG dash array', () => {
      expect(elementLineDashArray('dash')).toBe('6 4')
      expect(elementLineDashArray('dot')).toBe('1 4')
      expect(elementLineDashArray('dash-dot')).toBe('6 3 1 3')
      expect(elementLineDashArray('dash-dot-dot')).toBe('6 3 1 3 1 3')
    })

    it('treats solid/undefined as no dash override', () => {
      expect(elementLineDashArray('solid')).toBeUndefined()
      expect(elementLineDashArray(undefined)).toBeUndefined()
    })
  })

  describe('elementOutlinePath', () => {
    const rect = { x: 10, y: 20, width: 120, height: 60 }

    it('defaults to a closed rounded rectangle', () => {
      const d = elementOutlinePath(rect)
      expect(d.endsWith('Z')).toBe(true)
      expect(d).toContain('Q')
    })

    it('renders a plain rectangle for rectangle', () => {
      expect(elementOutlinePath(rect, 'rectangle')).toBe(
        'M 10 20 L 130 20 L 130 80 L 10 80 Z'
      )
    })

    it('renders a closed ellipse for ellipse', () => {
      const d = elementOutlinePath(rect, 'ellipse')
      expect(d.endsWith('Z')).toBe(true)
      expect(d).toContain('a 60 30 0 1 0 120 0')
      expect(d).toContain('a 60 30 0 1 0 -120 0')
    })

    it('renders each decorative shape as a non-empty path', () => {
      for (const shape of ['polygon', 'scallops', 'waves', 'tension', 'bracket'] as const) {
        const d = elementOutlinePath(rect, shape)
        expect(d.length).toBeGreaterThan(0)
      }
    })

    it('renders explicit rounded-rectangle with the shared radius', () => {
      const d = elementOutlinePath(rect, 'rounded-rectangle')
      expect(d).toBe(elementOutlinePath(rect))
    })
  })
})
