import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addUserColorScheme,
  DEFAULT_CUSTOM_COLOR_SCHEME_PALETTE,
  deleteUserColorScheme,
  duplicateUserColorScheme,
  EMPTY_COLOR_SCHEME_CATALOG,
  isBuiltInColorSchemeId,
  loadColorSchemeCatalog,
  MAX_RECENT_COLOR_SCHEMES,
  normalizeColorSchemePalette,
  persistColorSchemeCatalog,
  recordRecentColorScheme,
  renameUserColorScheme,
  setUserColorSchemeColors,
  toggleColorSchemeFavorite,
  type ColorSchemeCatalogState,
  type UserColorScheme
} from '../../src/renderer/src/views/mindmap/mind-map-color-scheme-catalog'

const originalState = { ...EMPTY_COLOR_SCHEME_CATALOG }

function catalogWithScheme(): { state: ColorSchemeCatalogState; scheme: UserColorScheme } {
  return addUserColorScheme(
    { ...EMPTY_COLOR_SCHEME_CATALOG },
    'My palette',
    ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF']
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('color scheme catalog pure operations', () => {
  it('adds a custom scheme with a default-sized palette', () => {
    const { state, scheme } = catalogWithScheme()
    expect(state.schemes).toHaveLength(1)
    expect(scheme.name).toBe('My palette')
    expect(scheme.colors).toHaveLength(6)
    expect(scheme.id.startsWith('user-')).toBe(true)
    expect(isBuiltInColorSchemeId(scheme.id)).toBe(false)
    expect(isBuiltInColorSchemeId('dawn')).toBe(true)
  })

  it('normalizes palettes to 5-8 distinct colors, padding a short palette', () => {
    const three = normalizeColorSchemePalette(['#FF0000', '#00FF00', '#0000FF'])
    expect(three.length).toBeGreaterThanOrEqual(5)
    const many = normalizeColorSchemePalette([
      '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999'
    ])
    expect(many).toHaveLength(8)
  })

  it('renames a custom scheme and keeps others untouched', () => {
    const { state, scheme } = catalogWithScheme()
    const renamed = renameUserColorScheme(state, scheme.id, 'Renamed')
    expect(renamed.schemes[0]!.name).toBe('Renamed')
    expect(renamed.schemes[0]!.colors).toEqual(scheme.colors)
  })

  it('updates palette colors', () => {
    const { state, scheme } = catalogWithScheme()
    const { state: updated, scheme: result } = setUserColorSchemeColors(
      state,
      scheme.id,
      ['#123456', '#ABCDEF', '#112233', '#445566', '#778899', '#AABBCC']
    )
    expect(result?.colors).toEqual(['#123456', '#ABCDEF', '#112233', '#445566', '#778899', '#AABBCC'])
    expect(updated.schemes[0]!.colors).toEqual(result?.colors)
  })

  it('duplicates a scheme into a new id with a copy name', () => {
    const { state, scheme } = catalogWithScheme()
    const { state: updated, scheme: copy } = duplicateUserColorScheme(state, scheme.id)
    expect(updated.schemes).toHaveLength(2)
    expect(copy?.id).not.toBe(scheme.id)
    expect(copy?.name).toBe(`${scheme.name} copy`)
    expect(copy?.colors).toEqual(scheme.colors)
  })

  it('deletes a scheme and clears its favorites/recent references', () => {
    let state: ColorSchemeCatalogState = { ...EMPTY_COLOR_SCHEME_CATALOG }
    const { scheme } = addUserColorScheme(state, 'Delete me', [...DEFAULT_CUSTOM_COLOR_SCHEME_PALETTE])
    state = toggleColorSchemeFavorite(state, scheme.id)
    state = recordRecentColorScheme(state, scheme.id)
    expect(state.favorites).toContain(scheme.id)
    expect(state.recent).toContain(scheme.id)

    const after = deleteUserColorScheme(state, scheme.id)
    expect(after.schemes).toHaveLength(0)
    expect(after.favorites).not.toContain(scheme.id)
    expect(after.recent).not.toContain(scheme.id)
  })

  it('toggles favorites on and off', () => {
    let state: ColorSchemeCatalogState = { ...EMPTY_COLOR_SCHEME_CATALOG }
    state = toggleColorSchemeFavorite(state, 'dawn')
    expect(state.favorites).toEqual(['dawn'])
    state = toggleColorSchemeFavorite(state, 'dawn')
    expect(state.favorites).toEqual([])
  })

  it('tracks recent schemes newest-first and caps the list', () => {
    let state: ColorSchemeCatalogState = { ...EMPTY_COLOR_SCHEME_CATALOG }
    for (let i = 0; i < MAX_RECENT_COLOR_SCHEMES + 3; i += 1) {
      state = recordRecentColorScheme(state, `scheme-${i}`)
    }
    expect(state.recent).toHaveLength(MAX_RECENT_COLOR_SCHEMES)
    // Newest first.
    expect(state.recent[0]).toBe(`scheme-${MAX_RECENT_COLOR_SCHEMES + 2}`)
    expect(state.recent).not.toContain('scheme-0')
  })

  it('deduplicates recent entries on re-use', () => {
    let state: ColorSchemeCatalogState = { ...EMPTY_COLOR_SCHEME_CATALOG }
    state = recordRecentColorScheme(state, 'a')
    state = recordRecentColorScheme(state, 'b')
    state = recordRecentColorScheme(state, 'a')
    expect(state.recent).toEqual(['a', 'b'])
  })
})

describe('color scheme catalog localStorage round-trip', () => {
  it('persists and reloads a catalogue with schemes, favorites and recent', () => {
    let state: ColorSchemeCatalogState = { ...EMPTY_COLOR_SCHEME_CATALOG }
    const { state: withScheme, scheme } = addUserColorScheme(
      state,
      'Persisted',
      ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666']
    )
    state = toggleColorSchemeFavorite(withScheme, scheme.id)
    state = recordRecentColorScheme(state, 'dawn')
    state = recordRecentColorScheme(state, scheme.id)

    persistColorSchemeCatalog(state)
    const loaded = loadColorSchemeCatalog()

    expect(loaded.schemes).toHaveLength(1)
    expect(loaded.schemes[0]!.name).toBe('Persisted')
    expect(loaded.schemes[0]!.colors).toHaveLength(6)
    expect(loaded.favorites).toEqual([scheme.id])
    expect(loaded.recent).toEqual([scheme.id, 'dawn'])
  })

  it('ignores malformed persisted data and falls back to empty', () => {
    localStorage.setItem('mindmap.colorSchemes', 'not json {')
    expect(loadColorSchemeCatalog()).toEqual(originalState)

    localStorage.setItem(
      'mindmap.colorSchemes',
      JSON.stringify({ schemes: [{ id: '', name: '', colors: ['red'] }], favorites: ['nope'], recent: [] })
    )
    const loaded = loadColorSchemeCatalog()
    expect(loaded.schemes).toHaveLength(0)
    expect(loaded.favorites).toEqual([])
  })

  it('drops recent/favorite references that no longer resolve', () => {
    localStorage.setItem(
      'mindmap.colorSchemes',
      JSON.stringify({
        schemes: [],
        favorites: ['dawn', 'gone-scheme'],
        recent: ['dawn', 'fire', 'gone-scheme', 'dawn']
      })
    )
    const loaded = loadColorSchemeCatalog()
    expect(loaded.favorites).toEqual(['dawn'])
    // 'gone-scheme' is dropped and the duplicate 'dawn' is removed, order kept.
    expect(loaded.recent).toEqual(['dawn', 'fire'])
  })
})
