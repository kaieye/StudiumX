import { describe, expect, it, vi } from 'vitest'
import { createMindMapCharacterWidthProbe } from '../../src/renderer/src/views/mindmap/mind-map-char-widths'
import { wrapMindMapTopicTitle } from '../../src/renderer/src/views/mindmap/mind-map-layout'

describe('createMindMapCharacterWidthProbe', () => {
  it('returns null (and the layout keeps its estimates) without a 2D canvas context', () => {
    // jsdom: getContext('2d') is unavailable, mirroring degraded environments.
    expect(createMindMapCharacterWidthProbe('Inter, sans-serif')).toBeNull()

    // Without a probe the pure wrap keeps using the built-in CJK estimate
    // (16px at depth 1), so behaviour is identical to the pre-probe layout.
    expect(wrapMindMapTopicTitle('字'.repeat(21), 360, 1)).toEqual(['字'.repeat(21)])
  })

  it('measures through canvas measureText with the per-depth font shorthand and caches', () => {
    const measureText = vi.fn((text: string) => ({ width: text.length * 17 }))
    const fakeContext = { measureText, font: '' }
    const canvas = document.createElement('canvas')
    const getContext = vi.spyOn(canvas, 'getContext').mockReturnValue(fakeContext as unknown as CanvasRenderingContext2D)
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(canvas)

    try {
      const probe = createMindMapCharacterWidthProbe('Inter, sans-serif')
      expect(probe).not.toBeNull()

      expect(probe!('a', 1)).toBe(17)
      // Root depth applies the 0.01em letter-spacing compensation on top of
      // the measured advance.
      expect(probe!('a', 0)).toBeCloseTo(17.26, 5)
      // Repeated probes hit the cache: one measureText call per (depth, char).
      probe!('a', 1)
      expect(measureText).toHaveBeenCalledTimes(2)

      // The wrap consumes the injected probe: 17px per Latin char at depth 1
      // wraps 22 chars over the 340px line capacity instead of the estimate's
      // 8.5px (single line).
      const lines = wrapMindMapTopicTitle('a'.repeat(22), 360, 1, probe!)
      expect(lines.length).toBe(2)
    } finally {
      createElement.mockRestore()
      getContext.mockRestore()
    }
  })
})
