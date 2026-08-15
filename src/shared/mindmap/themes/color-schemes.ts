/**
 * Color schemes for mind-map branch coloring.
 *
 * These are decoupled from themes: a user can pick any theme + any color scheme
 * independently (a warm palette works on any theme background).
 *
 * Each scheme is a curated 6-color **branch palette** whose colors stay legible
 * as solid chips with white text on a light canvas. Each palette is designed to
 * evoke its display name (e.g. the 朝霞/dawn palette uses warm sunrise tones).
 *
 * Each scheme has 6 colors. Branch indices wrap around.
 */

export type MindMapColorSchemeCategory = 'recommended' | 'classic' | 'custom'

/** Category of a bundled scheme; user-created schemes are always `'custom'`. */
export type MindMapBuiltInColorSchemeCategory = 'recommended' | 'classic'

export type MindMapColorScheme = {
  /** Stable identifier (e.g. 'dawn'). */
  id: string
  /** i18n key suffix for display, e.g. 'dawn' -> `mindmap.colorScheme.dawn`. */
  nameKey: string
  /** 6 branch colors. */
  colors: readonly string[]
  /** Curated category used to group the picker (recommended/classic). */
  category: MindMapBuiltInColorSchemeCategory
}

/** 朝霞 (dawn) — warm sunrise tones; the default color scheme. */
export const DAWN_COLORS = [
  '#FF8E72',
  '#FFB199',
  '#FF7B8A',
  '#F4A3C1',
  '#FFC47A',
  '#E8764F'
] as const

/** 斑斓 (painter) — vibrant, multicolored. */
export const PAINTER_COLORS = [
  '#FF5D5D',
  '#FFA63D',
  '#FFD43B',
  '#69DB7C',
  '#4DABF7',
  '#B197FC'
] as const

/** 怀旧 (vintage) — muted, nostalgic tones. */
export const VINTAGE_COLORS = [
  '#C9A26D',
  '#A97C50',
  '#8A9A5B',
  '#6D8A8A',
  '#B08D57',
  '#7A6A5B'
] as const

/** 烈焰 (fire) — blazing flame. */
export const FIRE_COLORS = [
  '#FF4D2E',
  '#FF7A1A',
  '#FF9E2C',
  '#E63B2E',
  '#C0261E',
  '#8F1D12'
] as const

/** 深海 (deep sea) — deep blues and teals. */
export const DEEP_SEA_COLORS = [
  '#0A3D62',
  '#1B6CA8',
  '#2196B7',
  '#0F5E7A',
  '#123A5C',
  '#63C7D9'
] as const

/** 翠绿 (emerald) — fresh greens. */
export const GREEN_TEA_COLORS = [
  '#2E7D32',
  '#43A047',
  '#66BB6A',
  '#1B5E20',
  '#81C784',
  '#34A853'
] as const

/** All built-in color schemes. */
export const COLOR_SCHEMES: readonly MindMapColorScheme[] = [
  { id: 'dawn', nameKey: 'dawn', colors: DAWN_COLORS, category: 'recommended' },
  { id: 'painter', nameKey: 'painter', colors: PAINTER_COLORS, category: 'classic' },
  { id: 'vintage', nameKey: 'vintage', colors: VINTAGE_COLORS, category: 'classic' },
  { id: 'fire', nameKey: 'fire', colors: FIRE_COLORS, category: 'classic' },
  { id: 'deep-sea', nameKey: 'deepSea', colors: DEEP_SEA_COLORS, category: 'recommended' },
  { id: 'green-tea', nameKey: 'greenTea', colors: GREEN_TEA_COLORS, category: 'recommended' }
]

/**
 * Look up a color scheme by id.
 * Falls back to "dawn" when the id is missing or unknown (documents saved
 * with a retired scheme id keep their stored branchColors regardless).
 */
export function getColorScheme(id: string | undefined): MindMapColorScheme {
  if (id) {
    const found = COLOR_SCHEMES.find((s) => s.id === id)
    if (found) return found
  }
  return COLOR_SCHEMES[0]!
}

/**
 * Resolve the category for a color-scheme entry id.
 * Built-in schemes return their curated category; any unknown / user-created
 * scheme id (custom catalogue) resolves to `'custom'`.
 */
export function getColorSchemeCategory(id: string | undefined): MindMapColorSchemeCategory {
  if (id) {
    const found = COLOR_SCHEMES.find((s) => s.id === id)
    if (found) return found.category
  }
  return 'custom'
}
