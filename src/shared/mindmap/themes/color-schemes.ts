/**
 * Color schemes (Xmind "multi-line colors") for mind-map branch coloring.
 *
 * These are decoupled from themes: a user can pick any theme + any color scheme
 * independently (Xmind's "Dawn" palette works on any theme background).
 *
 * Every palette below is verbatim from Xmind's scheme table
 * (`renderer/787.js`, enum + `const c={[l.Dawn]:[...]}`), and the display
 * names match Xmind's zh-CN locale. Xmind ships 43 schemes; we bundle the
 * subset that works as a **branch palette** — schemes whose six colors all
 * stay legible as solid chips with white text on a light canvas. Several
 * Xmind schemes lead with near-white seeds (they double as generative theme
 * inputs there) and are intentionally not bundled.
 *
 * Each scheme has 6 colors. Branch indices wrap around.
 */

export type MindMapColorScheme = {
  /** Stable identifier (e.g. 'dawn'). */
  id: string
  /** i18n key suffix for display, e.g. 'dawn' -> `mindmap.colorScheme.dawn`. */
  nameKey: string
  /** 6 branch colors. */
  colors: readonly string[]
}

/** Xmind "Dawn" (晨曦) — the default color scheme. */
export const DAWN_COLORS = [
  '#FF6B6B',
  '#FF9F69',
  '#97D3B6',
  '#88E2D7',
  '#6FD0F9',
  '#E18BEE'
] as const

/** Xmind "Painter" palette. */
export const PAINTER_COLORS = [
  '#EE4634',
  '#B58D26',
  '#33A86D',
  '#41A499',
  '#4876EB',
  '#535AD1'
] as const

/** Xmind "Vintage" (复古) palette. */
export const VINTAGE_COLORS = [
  '#E9C46A',
  '#F4A261',
  '#DC856F',
  '#A4705E',
  '#2A9D8F',
  '#264653'
] as const

/** Xmind "Fire" (壁炉) palette. */
export const FIRE_COLORS = [
  '#FDD29A',
  '#F9A655',
  '#FC901A',
  '#E04B51',
  '#A4564C',
  '#6D3B37'
] as const

/** Xmind "DeepSea" (海洋) palette. */
export const DEEP_SEA_COLORS = [
  '#B4F2FD',
  '#6EE2FD',
  '#3BB6E3',
  '#135CAE',
  '#01206A',
  '#000D2D'
] as const

/** Xmind "GreenTea" (绿茶) palette. */
export const GREEN_TEA_COLORS = [
  '#D6D9C3',
  '#b6ad90',
  '#579360',
  '#656d4a',
  '#265834',
  '#1F2B1D'
] as const

/** All built-in color schemes. */
export const COLOR_SCHEMES: readonly MindMapColorScheme[] = [
  { id: 'dawn', nameKey: 'dawn', colors: DAWN_COLORS },
  { id: 'painter', nameKey: 'painter', colors: PAINTER_COLORS },
  { id: 'vintage', nameKey: 'vintage', colors: VINTAGE_COLORS },
  { id: 'fire', nameKey: 'fire', colors: FIRE_COLORS },
  { id: 'deep-sea', nameKey: 'deepSea', colors: DEEP_SEA_COLORS },
  { id: 'green-tea', nameKey: 'greenTea', colors: GREEN_TEA_COLORS }
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
