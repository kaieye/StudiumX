import type { MindMapCharacterWidthProbe } from './mind-map-layout'

/**
 * Real-text measurement for topic wrapping/sizing.
 *
 * The pure layout estimates per-character advances from a fixed table (CJK
 * glyphs are exactly 1em, so the table is accurate for Chinese text, but Latin
 * advance widths vary several px between fonts). When the estimate drifts
 * below the rendered width the label overflows its node, and while typing the
 * CSS editor wraps/unwraps lines as the estimated node width catches up. This
 * module supplies a canvas-2D `measureText` probe so wrapping, node width,
 * node height and the inline editor all agree with the fonts the browser
 * actually renders.
 *
 * The font shorthands MUST mirror `resolveMindMapTopicTextStyle`'s defaults
 * (26px/600 root, 16px/500 branch, 13px/500 deeper, plus the root's 0.01em
 * letter-spacing). Callers without a 2D canvas (jsdom) get `null` and the
 * layout keeps its built-in estimates.
 */

const DEPTH_FONT_SHORTHANDS = [
  { weight: 600, size: 26, letterSpacing: 26 * 0.01 },
  { weight: 500, size: 16, letterSpacing: 0 },
  { weight: 500, size: 13, letterSpacing: 0 }
] as const

function fontShorthandForDepth(depth: number): (typeof DEPTH_FONT_SHORTHANDS)[number] {
  return DEPTH_FONT_SHORTHANDS[Math.min(depth, DEPTH_FONT_SHORTHANDS.length - 1)]!
}

/**
 * Build a cached per-character advance probe for the given font stack.
 * Returns `null` when canvas 2D is unavailable so callers can fall back to the
 * pure layout estimates.
 */
export function createMindMapCharacterWidthProbe(
  fontFamily: string
): MindMapCharacterWidthProbe | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof ctx.measureText !== 'function') return null

  const cache = new Map<string, number>()
  return (char: string, depth: number): number => {
    const key = `${depth}\u0000${char}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const font = fontShorthandForDepth(depth)
    ctx.font = `${font.weight} ${font.size}px ${fontFamily}`
    const width = ctx.measureText(char).width + font.letterSpacing
    cache.set(key, width)
    return width
  }
}
