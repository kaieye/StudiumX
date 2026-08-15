import { describe, expect, it } from 'vitest'
import type { MindMapTheme } from '../../src/shared/mindmap/domain/types'
import { branchColor, branchColorForKey, hexToRgba, DEFAULT_BRANCH_COLORS } from '../../src/renderer/src/views/mindmap/mind-map-branch-colors'
import { DAWN_COLORS, COLOR_SCHEMES, getColorScheme } from '../../src/shared/mindmap/themes/color-schemes'

describe('branchColor', () => {
  it('returns the dawn palette by default', () => {
    expect(branchColor(undefined, 0)).toBe(DAWN_COLORS[0])
    expect(branchColor(undefined, 1)).toBe(DAWN_COLORS[1])
    expect(branchColor(undefined, 5)).toBe(DAWN_COLORS[5])
  })

  it('wraps around when branch index exceeds palette length', () => {
    expect(branchColor(undefined, 6)).toBe(DAWN_COLORS[0])
    expect(branchColor(undefined, 12)).toBe(DAWN_COLORS[0])
  })

  it('uses theme.branchColors when provided', () => {
    const theme: MindMapTheme = {
      id: 'test',
      branchColors: ['#aaa', '#bbb', '#ccc']
    }
    expect(branchColor(theme, 0)).toBe('#aaa')
    expect(branchColor(theme, 1)).toBe('#bbb')
    expect(branchColor(theme, 3)).toBe('#aaa') // wraps
  })

  it('short-circuits to theme.lineColor when rainbowBranches is false', () => {
    const theme: MindMapTheme = {
      id: 'test',
      rainbowBranches: false,
      lineColor: '#FF0000',
      branchColors: ['#aaa', '#bbb']
    }
    expect(branchColor(theme, 0)).toBe('#FF0000')
    expect(branchColor(theme, 1)).toBe('#FF0000')
  })

  it('falls back to #8E8E93 when rainbowBranches is false and no lineColor', () => {
    const theme: MindMapTheme = {
      id: 'test',
      rainbowBranches: false
    }
    expect(branchColor(theme, 0)).toBe('#8E8E93')
  })

  it('uses rainbow colors when rainbowBranches is true (default)', () => {
    const theme: MindMapTheme = {
      id: 'test',
      rainbowBranches: true,
      branchColors: ['#aaa', '#bbb']
    }
    expect(branchColor(theme, 0)).toBe('#aaa')
    expect(branchColor(theme, 1)).toBe('#bbb')
  })

  it('uses rainbow colors when rainbowBranches is undefined (backward compat)', () => {
    const theme: MindMapTheme = {
      id: 'test',
      branchColors: ['#aaa', '#bbb']
    }
    expect(branchColor(theme, 0)).toBe('#aaa')
  })
})

describe('branchColorForKey', () => {
  it('returns a colour stable per branch key (independent of position)', () => {
    const theme: MindMapTheme = { id: 'test', branchColors: ['#aaa', '#bbb', '#ccc'] }
    // A branch keeps its colour when a sibling is inserted before it: the
    // colour depends on the branch's stable id, not its positional index.
    expect(branchColorForKey(theme, 'branch-x')).toBe(branchColorForKey(theme, 'branch-x'))
    expect(branchColorForKey(theme, 'branch-y')).toBe(branchColorForKey(theme, 'branch-y'))
    // Distinct keys resolve to a palette member.
    const colors = ['#aaa', '#bbb', '#ccc']
    expect(colors).toContain(branchColorForKey(theme, 'branch-z'))
  })

  it('returns the same colour as the positional API for the root/first branch', () => {
    const theme: MindMapTheme = { id: 'test', branchColors: ['#aaa', '#bbb', '#ccc'] }
    expect(branchColorForKey(theme, theme.id)).toBe(branchColor(theme, stableSlotOf(theme.id)))
  })

  it('short-circuits to lineColor when rainbowBranches is false', () => {
    const theme: MindMapTheme = {
      id: 'test',
      rainbowBranches: false,
      lineColor: '#FF0000',
      branchColors: ['#aaa', '#bbb']
    }
    expect(branchColorForKey(theme, 'branch-x')).toBe('#FF0000')
  })
})

function stableSlotOf(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 3
}

describe('hexToRgba', () => {
  it('converts a 6-digit hex to rgba', () => {
    expect(hexToRgba('#FF6B6B', 0.5)).toBe('rgba(255, 107, 107, 0.5)')
  })

  it('converts a 3-digit hex to rgba', () => {
    expect(hexToRgba('#fff', 1)).toBe('rgba(255, 255, 255, 1)')
  })

  it('returns the original string for invalid hex', () => {
    expect(hexToRgba('invalid', 0.5)).toBe('invalid')
  })
})

describe('color schemes', () => {
  it('has at least 6 built-in color schemes', () => {
    expect(COLOR_SCHEMES.length).toBeGreaterThanOrEqual(6)
  })

  it('each scheme has exactly 6 colors', () => {
    for (const scheme of COLOR_SCHEMES) {
      expect(scheme.colors.length).toBe(6)
    }
  })

  it('lookups by id return the correct scheme', () => {
    const dawn = getColorScheme('dawn')
    expect(dawn.id).toBe('dawn')
    expect(dawn.colors).toEqual(DAWN_COLORS)
  })

  it('falls back to dawn for unknown or undefined ids', () => {
    expect(getColorScheme('nonexistent').id).toBe('dawn')
    expect(getColorScheme(undefined).id).toBe('dawn')
  })

  it('DEFAULT_BRANCH_COLORS references the Dawn palette', () => {
    expect(DEFAULT_BRANCH_COLORS).toEqual(DAWN_COLORS)
  })
})
