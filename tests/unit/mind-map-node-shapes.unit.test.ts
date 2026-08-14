import { describe, expect, it } from 'vitest'
import {
  FALLBACK_NODE_SHAPE,
  KNOWN_SHAPE_TOKENS,
  resolveShape,
  resolveShapeWithReport
} from '../../src/renderer/src/views/mindmap/mind-map-node-shapes'

describe('resolveShapeWithReport (unknown shape degradation)', () => {
  it('keeps resolveShape backward compatible for every accepted token', () => {
    for (const token of KNOWN_SHAPE_TOKENS) {
      expect(resolveShapeWithReport(token).shape).toBe(resolveShape(token))
    }
    expect(resolveShapeWithReport(undefined).shape).toBe(resolveShape(undefined))
  })

  it('resolves every accepted token without degradation', () => {
    for (const token of KNOWN_SHAPE_TOKENS) {
      const resolved = resolveShapeWithReport(token)
      expect(resolved.degraded).toBe(false)
      expect(resolved.shape).toBe(resolveShape(token))
    }
  })

  it('flags unknown shape tokens as degraded with the stable rounded-rect fallback', () => {
    const unknown = [
      'squiggle',
      'triangle-bounce',
      'org.xmind.topicShape.customPetal',
      'starburst',
      'octagon',
      ' ',
      'rounded-square-with-notch'
    ]
    for (const token of unknown) {
      const resolved = resolveShapeWithReport(token)
      expect(resolved.degraded, `expected ${JSON.stringify(token)} to degrade`).toBe(true)
      expect(resolved.shape).toBe('rounded-rect')
      expect(resolved.shape).toBe(FALLBACK_NODE_SHAPE)
    }
  })

  it('treats an absent shape as the app default, not a degradation', () => {
    expect(resolveShapeWithReport(undefined)).toEqual({ shape: 'rounded-rect', degraded: false })
  })

  it('flags the schema-accepted-but-unsupported fishbone token as degraded', () => {
    // `fishbone` is a valid persisted schema token but has no dedicated node
    // shape in the renderer, so it resolves to the stable rounded-rect fallback
    // and must be reported rather than silently distorted.
    const resolved = resolveShapeWithReport('fishbone')
    expect(resolved.degraded).toBe(true)
    expect(resolved.shape).toBe('rounded-rect')
  })

  it('exports a stable, frozen accepted token list', () => {
    expect(Array.isArray(KNOWN_SHAPE_TOKENS)).toBe(true)
    expect(KNOWN_SHAPE_TOKENS).toContain('rounded-rect')
    expect(KNOWN_SHAPE_TOKENS).toContain('hexagon')
    expect(new Set(KNOWN_SHAPE_TOKENS).size).toBe(KNOWN_SHAPE_TOKENS.length)
  })
})
