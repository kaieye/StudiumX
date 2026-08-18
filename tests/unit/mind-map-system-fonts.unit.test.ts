import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetSystemFontEntryCacheForTests,
  useSystemFontEntries
} from '../../src/renderer/src/views/mindmap/mind-map-system-fonts'
import {
  isManagedMindMapFontFamily,
  registerManagedSystemFontStacks
} from '../../src/renderer/src/views/mindmap/mind-map-font-provenance'
import { SAFE_FONTS, SAFE_FONT_STACKS } from '../../src/renderer/src/views/mindmap/mind-map-font-list'
import { renderHook, waitFor } from '@testing-library/react'
import type { SystemFontFamily } from '../../src/shared/teaching-types/system-api'

type WebWithFonts = { teachingSystem: { listSystemFonts: () => Promise<readonly SystemFontFamily[]> } }

function stubListSystemFonts(families: readonly SystemFontFamily[]): void {
  ;(window as unknown as WebWithFonts).teachingSystem = {
    listSystemFonts: vi.fn(async () => families)
  }
}

const sampleSystemFonts: SystemFontFamily[] = [
  { family: 'Academy Engraved LET', value: '"Academy Engraved LET"' },
  { family: 'Comic Sans MS', value: '"Comic Sans MS"' }
]

describe('mind-map system fonts catalogue', () => {
  beforeEach(() => {
    _resetSystemFontEntryCacheForTests()
  })

  it('returns an empty list on the Web lane (listSystemFonts resolves to [])', async () => {
    stubListSystemFonts([])
    const { result } = renderHook(() => useSystemFontEntries())
    await waitFor(() => {
      expect(result.current).toHaveLength(0)
    })
  })

  it('lifts desktop families into catalogue entries with the CSS-ready stack value', async () => {
    stubListSystemFonts(sampleSystemFonts)
    const { result } = renderHook(() => useSystemFontEntries())
    await waitFor(() => {
      expect(result.current.length).toBe(2)
    })
    const academy = result.current.find((entry) => entry.label === 'Academy Engraved LET')
    expect(academy?.stack).toBe('"Academy Engraved LET"')
    expect(academy?.category).toBe('system-installed')
  })

  it('does not duplicate a family already offered by the curated catalogue', async () => {
    // Pick a stack the curated catalogue already offers and feed it back as a
    // system probe result: it must NOT reappear as a system-installed entry.
    const curatedStack = SAFE_FONT_STACKS[0]!
    stubListSystemFonts([
      ...sampleSystemFonts,
      { family: 'Dup', value: curatedStack }
    ])
    const { result } = renderHook(() => useSystemFontEntries())
    await waitFor(() => {
      expect(result.current.some((entry) => entry.id === `sys:${curatedStack}`)).toBe(false)
    })
  })

  it('registers a host-enumerated stack as managed so it is not flagged as may-fallback', () => {
    // Use a value guaranteed not to be in the curated SAFE_FONTS set and not
    // touched by any other test in this file.
    const novelStack = '"Zzz Unregistered Display"'
    expect(SAFE_FONTS.some((entry) => entry.stack === novelStack)).toBe(false)
    expect(isManagedMindMapFontFamily(novelStack)).toBe(false)
    registerManagedSystemFontStacks([novelStack])
    expect(isManagedMindMapFontFamily(novelStack)).toBe(true)
  })
})
