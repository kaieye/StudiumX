/**
 * Pure span algebra for Xmind-style rich text in mind map labels.
 *
 * The domain keeps the canonical plain text (`topic.title` / `shape.label`)
 * and a list of offset-based `MindMapTextSpan`s. This module contains every
 * mutation/derivation needed by the editor, the canvas renderer and the
 * floating format toolbar:
 *
 * - `buildStyleSegments` / `splitTextIntoSegments`: flatten (possibly
 *   overlapping) spans into disjoint segments covering the whole text, which
 *   both rendering (SVG tspans / foreignObject `<span>`s) and the editor DOM
 *   serialisation consume.
 * - `applyTextSpanStyle`: apply (or toggle) a style over an arbitrary range,
 *   splitting and merging runs as needed.
 *
 * Spans are always stored *normalised*: sorted, disjoint, within `[0, length)`,
 * and never carry an empty style (an empty style is indistinguishable from
 * "no formatting", so it is dropped).
 */
import type { MindMapTextSpan, MindMapTextSpanStyle } from './domain/types'

/** Style keys a `MindMapTextSpanStyle` may carry. */
export const TEXT_SPAN_STYLE_KEYS = [
  'color', 'bold', 'italic', 'underline', 'strikethrough', 'fontFamily', 'fontSize'
] as const

export type MindMapTextSpanStyleKey = (typeof TEXT_SPAN_STYLE_KEYS)[number]

export type MindMapTextSegment = {
  start: number
  end: number
  text: string
  style: MindMapTextSpanStyle
}

type StyleSegment = {
  start: number
  end: number
  style: MindMapTextSpanStyle
}

export function clampTextSpanOffset(offset: number, length: number): number {
  const size = Math.max(0, Math.floor(length))
  return Math.min(size, Math.max(0, Math.floor(offset)))
}

function pickStyle(span: MindMapTextSpan): MindMapTextSpanStyle {
  return {
    ...(span.color !== undefined ? { color: span.color } : {}),
    ...(span.bold !== undefined ? { bold: span.bold } : {}),
    ...(span.italic !== undefined ? { italic: span.italic } : {}),
    ...(span.underline !== undefined ? { underline: span.underline } : {}),
    ...(span.strikethrough !== undefined ? { strikethrough: span.strikethrough } : {}),
    ...(span.fontFamily !== undefined ? { fontFamily: span.fontFamily } : {}),
    ...(span.fontSize !== undefined ? { fontSize: span.fontSize } : {})
  }
}

/** Whether a style object carries any explicit formatting. */
export function hasTextSpanStyle(style: MindMapTextSpanStyle): boolean {
  return (
    style.color !== undefined ||
    style.bold !== undefined ||
    style.italic !== undefined ||
    style.underline !== undefined ||
    style.strikethrough !== undefined ||
    style.fontFamily !== undefined ||
    style.fontSize !== undefined
  )
}

/** Deep equality for two style objects (only the supported keys matter). */
export function textSpanStylesEqual(a: MindMapTextSpanStyle, b: MindMapTextSpanStyle): boolean {
  return TEXT_SPAN_STYLE_KEYS.every((key) => a[key] === b[key])
}

/** Merge a patch over a base style; patch keys win. */
export function mergeTextSpanStyle(
  base: MindMapTextSpanStyle,
  patch: MindMapTextSpanStyle
): MindMapTextSpanStyle {
  return { ...base, ...patch }
}

/** Drop every key present in `patch` from `style`. */
export function stripTextSpanStyle(
  style: MindMapTextSpanStyle,
  patch: MindMapTextSpanStyle
): MindMapTextSpanStyle {
  const next = { ...style }
  for (const key of TEXT_SPAN_STYLE_KEYS) {
    if (patch[key] !== undefined) delete next[key]
  }
  return next
}

/** Whether every key in `patch` matches `style` exactly (used for toggling). */
export function textSpanStyleMatchesPatch(
  style: MindMapTextSpanStyle,
  patch: MindMapTextSpanStyle
): boolean {
  return TEXT_SPAN_STYLE_KEYS.every((key) => {
    const value = patch[key]
    return value === undefined || style[key] === value
  })
}

/**
 * Flatten any span list into disjoint `{ start, end, style }` segments that
 * cover the whole `[0, length)` range. Later spans merge over earlier ones per
 * key, so overlapping input is handled deterministically.
 */
export function buildStyleSegments(
  length: number,
  spans: readonly MindMapTextSpan[]
): Array<{ start: number; end: number; style: MindMapTextSpanStyle }> {
  const size = Math.max(0, Math.floor(length))
  let segments: StyleSegment[] = [{ start: 0, end: size, style: {} }]

  for (const raw of spans) {
    const start = clampTextSpanOffset(raw.start, size)
    const end = clampTextSpanOffset(raw.end, size)
    if (end <= start) continue
    const style = pickStyle(raw)
    if (!hasTextSpanStyle(style)) continue

    const next: StyleSegment[] = []
    for (const segment of segments) {
      if (segment.end <= start || segment.start >= end) {
        next.push(segment)
        continue
      }
      // Segment overlaps [start, end): split and merge the intersection.
      if (segment.start < start) next.push({ ...segment, end: start })
      const intersection = {
        start: Math.max(segment.start, start),
        end: Math.min(segment.end, end),
        style: mergeTextSpanStyle(segment.style, style)
      }
      if (intersection.end > intersection.start) next.push(intersection)
      if (segment.end > end) next.push({ ...segment, start: end })
    }
    segments = next
  }

  return segments
}

/**
 * Convert disjoint segments back into a normalised span list (sorted, disjoint,
 * empty styles dropped, adjacent equal styles merged).
 */
export function segmentsToTextSpans(segments: readonly StyleSegment[]): MindMapTextSpan[] {
  const spans: MindMapTextSpan[] = []
  for (const segment of segments) {
    if (segment.end <= segment.start) continue
    if (!hasTextSpanStyle(segment.style)) continue
    const last = spans[spans.length - 1]
    if (
      last !== undefined &&
      last.end === segment.start &&
      textSpanStylesEqual(pickStyle(last), segment.style)
    ) {
      last.end = segment.end
      continue
    }
    spans.push({ start: segment.start, end: segment.end, ...segment.style })
  }
  return spans
}

/** Normalise a raw span list against a text length (safe for persistence). */
export function normalizeTextSpans(
  spans: readonly MindMapTextSpan[],
  textLength: number
): MindMapTextSpan[] {
  return segmentsToTextSpans(buildStyleSegments(textLength, spans))
}

/**
 * Split `text` into disjoint rendered segments. Segments outside any span
 * carry an empty style (they inherit the base text style).
 */
export function splitTextIntoSegments(
  text: string,
  spans: readonly MindMapTextSpan[]
): MindMapTextSegment[] {
  return buildStyleSegments(text.length, spans).map((segment) => ({
    ...segment,
    text: text.slice(segment.start, segment.end)
  }))
}

/** Split segments at the given offset points so ranges align with boundaries. */
function splitSegmentsAt(
  segments: StyleSegment[],
  points: readonly number[]
): StyleSegment[] {
  let result = segments
  for (const point of points) {
    if (point <= 0) continue
    const next: StyleSegment[] = []
    for (const segment of result) {
      if (segment.start < point && point < segment.end) {
        next.push({ ...segment, end: point })
        next.push({ start: point, end: segment.end, style: segment.style })
      } else {
        next.push(segment)
      }
    }
    result = next
  }
  return result
}

/**
 * Apply `patch` over `[start, end)` of `text`, returning the new normalised
 * span list. When `toggle` is true and every character in the range already
 * carries the patch style, the style is removed instead (bold toggle
 * behaviour).
 */
export function applyTextSpanStyle(
  text: string,
  spans: readonly MindMapTextSpan[],
  start: number,
  end: number,
  patch: MindMapTextSpanStyle,
  toggle = false
): MindMapTextSpan[] {
  const length = text.length
  const from = clampTextSpanOffset(start, length)
  const to = clampTextSpanOffset(end, length)
  if (to <= from) return normalizeTextSpans(spans, length)

  const segments = splitSegmentsAt(buildStyleSegments(length, spans), [from, to])
  const covered = segments.filter((segment) => segment.start >= from && segment.end <= to)

  let shouldRemove = false
  if (toggle && covered.length > 0) {
    shouldRemove = covered.every((segment) => textSpanStyleMatchesPatch(segment.style, patch))
  }

  const next = segments.map((segment) => {
    if (segment.start < from || segment.end > to) return segment
    const style = shouldRemove
      ? stripTextSpanStyle(segment.style, patch)
      : mergeTextSpanStyle(segment.style, patch)
    return { ...segment, style }
  })

  return segmentsToTextSpans(next)
}

/** Whether a span list carries any meaningful formatting. */
export function hasTextSpans(spans: readonly MindMapTextSpan[] | undefined): boolean {
  if (!spans || spans.length === 0) return false
  return spans.some((span) => span.end > span.start && hasTextSpanStyle(pickStyle(span)))
}

/** A plain-text + spans bundle used by the editor and the canvas. */
export type MindMapRichText = {
  text: string
  spans: MindMapTextSpan[]
}

export function emptyMindMapRichText(): MindMapRichText {
  return { text: '', spans: [] }
}
