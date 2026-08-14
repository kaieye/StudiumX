import { describe, expect, it } from 'vitest'
import {
  filterFontCatalogue,
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