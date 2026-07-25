/**
 * Categorical series colors for multi-slice / multi-bar charts
 * (stacked token trends, rank bars, donuts).
 *
 * Morandi set provided for analytics bars:
 * soft ice blue, powder blue, slate blue-gray, mauve gray, blush gray.
 * Deeper echoes keep longer series readable without leaving the family.
 */
const CATEGORICAL = [
  '#DBEFF6',
  '#A8D8E3',
  '#5D7389',
  '#C5B8BF',
  '#E9DFE2',
  // Slightly deeper echoes for series 6+ while staying in the same family.
  '#9FC9D6',
  '#7FA3B5',
  '#6E5F68'
] as const

export function categoricalColor(index: number, _saturation = 68, _lightness = 58): string {
  const safeIndex = ((index % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length
  return CATEGORICAL[safeIndex]
}

export function categoricalSoftColor(index: number): string {
  const base = categoricalColor(index)
  return `color-mix(in srgb, ${base} 22%, #ffffff)`
}
