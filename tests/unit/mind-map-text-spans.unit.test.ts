import { describe, expect, it } from 'vitest'
import {
  applyTextSpanStyle,
  buildStyleSegments,
  hasTextSpans,
  normalizeTextSpans,
  splitTextIntoSegments,
  type MindMapRichText
} from '../../src/shared/mindmap/text-spans'
import type { MindMapTextSpan } from '../../src/shared/mindmap/domain/types'

const RT: MindMapRichText = { text: '', spans: [] }

function segs(segments: ReturnType<typeof buildStyleSegments>): Array<{ start: number; end: number; style: Record<string, unknown> }> {
  return segments.map((s) => ({ start: s.start, end: s.end, style: { ...s.style } }))
}

describe('text-spans algebra', () => {
  it('builds a single empty segment covering the whole text', () => {
    expect(segs(buildStyleSegments(5, []))).toEqual([
      { start: 0, end: 5, style: {} }
    ])
  })

  it('builds disjoint segments from a simple span', () => {
    const segments = buildStyleSegments(6, [{ start: 1, end: 4, bold: true }])
    expect(segs(segments)).toEqual([
      { start: 0, end: 1, style: {} },
      { start: 1, end: 4, style: { bold: true } },
      { start: 4, end: 6, style: {} }
    ])
  })

  it('merges overlapping spans per key', () => {
    const segments = buildStyleSegments(6, [
      { start: 0, end: 4, color: '#ff0000' },
      { start: 2, end: 6, bold: true }
    ])
    expect(segs(segments)).toEqual([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 2, end: 4, style: { color: '#ff0000', bold: true } },
      { start: 4, end: 6, style: { bold: true } }
    ])
  })

  it('clamps spans to the text length and drops invalid ones', () => {
    const normalized = normalizeTextSpans(
      [
        { start: -3, end: 2, bold: true },
        { start: 4, end: 999, color: 'red' },
        { start: 6, end: 4, fontFamily: 'serif' },
        { start: 1, end: 1, fontSize: 12 }
      ],
      6
    )
    expect(normalized).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 4, end: 6, color: 'red' }
    ])
  })

  it('splits text into rendered segments', () => {
    const segments = splitTextIntoSegments('hello', [
      { start: 1, end: 3, bold: true, color: '#00f' }
    ])
    expect(segments).toEqual([
      { start: 0, end: 1, text: 'h', style: {} },
      { start: 1, end: 3, text: 'el', style: { bold: true, color: '#00f' } },
      { start: 3, end: 5, text: 'lo', style: {} }
    ])
  })

  it('applies a style over an empty range without changing spans', () => {
    const before = [{ start: 0, end: 2, bold: true }]
    expect(applyTextSpanStyle('ab', before, 1, 1, { color: 'red' })).toEqual(before)
  })

  it('applies a style over a range, splitting existing runs', () => {
    const text = 'abcdef'
    const spans: MindMapTextSpan[] = [{ start: 0, end: 6, bold: true }]
    const next = applyTextSpanStyle(text, spans, 2, 4, { color: '#f00' })
    expect(next).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, bold: true, color: '#f00' },
      { start: 4, end: 6, bold: true }
    ])
  })

  it('fills gaps between existing spans when applying a style', () => {
    const text = 'abcdef'
    const spans: MindMapTextSpan[] = [
      { start: 0, end: 2, color: 'red' },
      { start: 4, end: 6, color: 'red' }
    ]
    const next = applyTextSpanStyle(text, spans, 1, 5, { bold: true })
    expect(next).toEqual([
      { start: 0, end: 1, color: 'red' },
      { start: 1, end: 2, color: 'red', bold: true },
      { start: 2, end: 4, bold: true },
      { start: 4, end: 5, color: 'red', bold: true },
      { start: 5, end: 6, color: 'red' }
    ])
  })

  it('toggles a style off when the whole range already matches', () => {
    const text = 'abcdef'
    const spans: MindMapTextSpan[] = [{ start: 1, end: 5, bold: true }]
    const next = applyTextSpanStyle(text, spans, 1, 5, { bold: true }, true)
    expect(next).toEqual([])
  })

  it('toggles a style on when only part of the range matches', () => {
    const text = 'abcdef'
    const spans: MindMapTextSpan[] = [{ start: 1, end: 3, bold: true }]
    const next = applyTextSpanStyle(text, spans, 1, 5, { bold: true }, true)
    expect(next).toEqual([{ start: 1, end: 5, bold: true }])
  })

  it('toggling only removes the toggled keys, keeping other keys', () => {
    const text = 'abcd'
    const spans: MindMapTextSpan[] = [{ start: 0, end: 4, bold: true, color: 'red' }]
    const next = applyTextSpanStyle(text, spans, 0, 4, { bold: true }, true)
    expect(next).toEqual([{ start: 0, end: 4, color: 'red' }])
  })

  it('merges adjacent equal spans after an edit', () => {
    const text = 'abcd'
    const spans: MindMapTextSpan[] = [
      { start: 0, end: 2, color: 'red' },
      { start: 2, end: 4, color: 'red' }
    ]
    expect(normalizeTextSpans(spans, 4)).toEqual([{ start: 0, end: 4, color: 'red' }])
  })

  it('drops spans whose style is empty after stripping', () => {
    const text = 'ab'
    const spans: MindMapTextSpan[] = [{ start: 0, end: 2, bold: true }]
    const next = applyTextSpanStyle(text, spans, 0, 2, { bold: true }, true)
    expect(next).toEqual([])
  })

  it('hasTextSpans reports meaningful formatting only', () => {
    expect(hasTextSpans(undefined)).toBe(false)
    expect(hasTextSpans([])).toBe(false)
    expect(hasTextSpans([{ start: 0, end: 2, bold: true }])).toBe(true)
    expect(hasTextSpans([{ start: 2, end: 2, bold: true }])).toBe(false)
  })

  it('keeps RT import alive for typing checks', () => {
    expect(RT.text).toBe('')
  })

  it('treats italic/underline/strikethrough as first-class span keys', () => {
    const text = 'abcd'
    const spans: MindMapTextSpan[] = [
      { start: 0, end: 2, italic: true },
      { start: 2, end: 4, underline: true, strikethrough: true }
    ]
    expect(normalizeTextSpans(spans, 4)).toEqual(spans)
    const next = applyTextSpanStyle(text, spans, 0, 2, { italic: true }, true)
    // Toggling italic off leaves the underline/strikethrough span untouched.
    expect(next).toEqual([
      { start: 2, end: 4, underline: true, strikethrough: true }
    ])
  })

  it('applies and toggles italic over a range', () => {
    const text = 'hello'
    const applied = applyTextSpanStyle(text, [], 1, 4, { italic: true })
    expect(applied).toEqual([{ start: 1, end: 4, italic: true }])
    const toggled = applyTextSpanStyle(text, applied, 1, 4, { italic: true }, true)
    expect(toggled).toEqual([])
  })
})
