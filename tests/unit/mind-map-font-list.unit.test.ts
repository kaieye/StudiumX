import { describe, expect, it } from 'vitest'
import {
  clearRecentFonts,
  filterFontCatalogue,
  loadRecentFonts,
  MAX_RECENT_FONTS,
  RECENT_FONTS_KEY,
  recordRecentFont,
  SAFE_FONTS,
  SAFE_FONT_STACKS,
  type FontCatalogueEntry
} from '../../src/renderer/src/views/mindmap/mind-map-font-list'

const labelOf = (entry: FontCatalogueEntry): string => entry.label ?? entry.labelKey ?? ''

describe('mind-map font catalogue', () => {
  it('keeps the curated catalogue stable, unique and non-empty', () => {
    expect(SAFE_FONTS.length).toBeGreaterThan(10)
    const ids = SAFE_FONTS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of SAFE_FONTS) {
      expect(entry.stack.trim().length).toBeGreaterThan(0)
      expect(SAFE_FONT_STACKS).toContain(entry.stack)
    }
  })

  it('mirrors the stacks already offered by the app controls', () => {
    expect(SAFE_FONTS).toContainEqual(
      expect.objectContaining({
        stack: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      })
    )
    expect(SAFE_FONTS).toContainEqual(
      expect.objectContaining({
        stack: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif'
      })
    )
    expect(SAFE_FONTS).toContainEqual(
      expect.objectContaining({
        stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      })
    )
  })

  it('filters by label or stack, case-insensitive, and returns everything for an empty query', () => {
    expect(filterFontCatalogue(SAFE_FONTS, '', labelOf)).toHaveLength(SAFE_FONTS.length)
    expect(filterFontCatalogue(SAFE_FONTS, '   ', labelOf)).toHaveLength(SAFE_FONTS.length)

    const mono = filterFontCatalogue(SAFE_FONTS, 'mono', labelOf)
    expect(mono.length).toBeGreaterThan(0)
    expect(mono.every((entry) => entry.category === 'mono')).toBe(true)

    const cjk = filterFontCatalogue(SAFE_FONTS, 'CJK', labelOf)
    expect(cjk.length).toBeGreaterThan(0)
    expect(cjk.every((entry) => entry.category === 'cjk')).toBe(true)
  })

  it('matches against the raw stack text as well as the label', () => {
    const inter = filterFontCatalogue(SAFE_FONTS, 'Inter', labelOf)
    expect(inter.length).toBeGreaterThan(0)
    // matches via stack even when the literal label does not contain the query
    const consolas = filterFontCatalogue(SAFE_FONTS, 'Consolas', labelOf)
    expect(consolas.length).toBeGreaterThanOrEqual(1)
    expect(consolas.every((entry) => entry.stack.includes('Consolas'))).toBe(true)
  })
})

describe('mind-map recent fonts storage', () => {
  it('records most-recent-first and caps at the maximum', () => {
    const recent = ['A', 'B', 'C']
    const next = recordRecentFont(recent, 'D')
    expect(next).toEqual(['D', 'A', 'B', 'C'])
    expect(recent).toEqual(['A', 'B', 'C']) // pure: input untouched

    const full = Array.from({ length: MAX_RECENT_FONTS }, (_, index) => `font-${index}`)
    expect(recordRecentFont(full, 'new-font')).toHaveLength(MAX_RECENT_FONTS)
    expect(recordRecentFont(full, 'new-font')[0]).toBe('new-font')
    expect(recordRecentFont(full, 'new-font')![MAX_RECENT_FONTS - 1]).not.toBe('font-0')
  })

  it('dedupes on record and ignores empty stacks', () => {
    expect(recordRecentFont(['A', 'B'], 'B')).toEqual(['B', 'A'])
    expect(recordRecentFont(['A', 'B'], '   ')).toEqual(['A', 'B'])
    expect(recordRecentFont([], ' ')).toEqual([])
  })

  it('loads, validates and dedupes persisted values; empty/malformed storage starts clean', () => {
    const storage = {
      getItem: (key: string): string | null => {
        if (key === RECENT_FONTS_KEY) return JSON.stringify([' A ', 'B', 'A', 42, 'C', ''])
        return null
      }
    }
    expect(loadRecentFonts(storage)).toEqual(['A', 'B', 'C'])

    expect(loadRecentFonts({ getItem: () => null })).toEqual([])
    expect(loadRecentFonts({ getItem: () => '{not json' })).toEqual([])
    expect(loadRecentFonts({ getItem: () => '{"a":1}' })).toEqual([])
  })

  it('caps loaded fonts at the maximum and tolerates a throwing storage', () => {
    const many = Array.from({ length: 20 }, (_, index) => `font-${index}`)
    expect(loadRecentFonts({ getItem: () => JSON.stringify(many) })).toHaveLength(MAX_RECENT_FONTS)

    const throwing: Storage = {
      getItem() {
        throw new Error('quota')
      },
      removeItem() {
        throw new Error('quota')
      },
      setItem() {
        throw new Error('quota')
      },
      clear() {},
      key: () => null,
      length: 0
    }
    expect(loadRecentFonts(throwing)).toEqual([])
    expect(() => clearRecentFonts(throwing)).not.toThrow()
  })

  it('clears the persisted key', () => {
    const removed: string[] = []
    clearRecentFonts({ removeItem: (key) => removed.push(key) })
    expect(removed).toEqual([RECENT_FONTS_KEY])
  })
})