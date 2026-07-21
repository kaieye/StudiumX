/**
 * Categorical series colors for multi-slice charts (donuts, stacked bars).
 * Industrial instrument palette: near-black with restrained green / amber / red
 * status accents, tuned for the white-on-white analytics dashboard.
 */
const CATEGORICAL = [
  '#1a1a1a',
  '#2f9b73',
  '#b57617',
  '#c45772',
  '#4a4a4a',
  '#1f7a5a',
  '#8a5a12',
  '#8a3a4a'
] as const

export function categoricalColor(index: number, _saturation = 68, _lightness = 58): string {
  const safeIndex = ((index % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length
  return CATEGORICAL[safeIndex]
}

export function categoricalSoftColor(index: number): string {
  const base = categoricalColor(index)
  return `color-mix(in srgb, ${base} 18%, #ffffff)`
}
