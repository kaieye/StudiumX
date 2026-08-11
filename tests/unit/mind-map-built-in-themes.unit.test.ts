import { describe, expect, it } from 'vitest'
import { BUILT_IN_THEMES, getBuiltInTheme } from '../../src/shared/mindmap/themes/built-in-themes'
import { DAWN_COLORS } from '../../src/shared/mindmap/themes/color-schemes'

describe('BUILT_IN_THEMES (full Xmind catalogue)', () => {
  it('loads all 43 themes from the Xmind catalogue', () => {
    expect(BUILT_IN_THEMES).toHaveLength(43)
  })

  it('produces unique ids for every theme', () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('preserves the six previously-migrated theme ids (backward compat)', () => {
    const ids = new Set(BUILT_IN_THEMES.map((t) => t.id))
    for (const id of ['snowbrush', 'classic', 'business', 'light', 'fresh', 'party']) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('includes newly-migrated themes', () => {
    const ids = new Set(BUILT_IN_THEMES.map((t) => t.id))
    expect(ids.has('sketch')).toBe(true)
    expect(ids.has('blackboard')).toBe(true)
    expect(ids.has('deep-forest')).toBe(true)
    expect(ids.has('shallow-sea')).toBe(true)
    expect(ids.has('elegant')).toBe(true)
    expect(ids.has('night-sky')).toBe(true)
  })

  it('applies the Dawn color scheme to every theme', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.colorSchemeId).toBe('dawn')
      expect(theme.rainbowBranches).toBe(true)
      expect(theme.branchColors).toEqual([...DAWN_COLORS])
    }
  })

  it('sets a human-readable display name (not the internal Xmind id)', () => {
    const snowbrush = getBuiltInTheme('snowbrush')
    expect(snowbrush?.name).toBe('Snowbrush')
    const blackboard = getBuiltInTheme('blackboard')
    expect(blackboard?.name).toBe('Blackboard')
  })

  it('getBuiltInTheme returns undefined for unknown ids', () => {
    expect(getBuiltInTheme('nonexistent')).toBeUndefined()
  })
})
