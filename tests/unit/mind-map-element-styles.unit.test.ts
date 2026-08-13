import { describe, expect, it } from 'vitest'
import {
  elementLineDashArray,
  elementOutlinePath,
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
        'M 0 0 C 100 0, 100 80, 200 80'
      )
      expect(relationshipElementPath(from, to, 'angled')).toBe(
        'M 0 0 L 100 0 L 100 80 L 200 80'
      )
      expect(relationshipElementPath(from, to, 'flexible-angled')).toBe(
        'M 0 0 L 100 0 L 100 80 L 200 80'
      )
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

    it('uses the 10×10 viewBox coordinate space', () => {
      expect(relationshipArrowMarkerPath('dot')).toContain('a 3 3')
      expect(relationshipArrowMarkerPath('square')).toContain('L 9 9')
      expect(relationshipArrowMarkerPath('triangle')).toBe('M 0 0 L 10 5 L 0 10 Z')
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
