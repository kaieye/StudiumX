/**
 * Categorical series colors for multi-slice charts (donuts, stacked bars).
 * Values are HSL triples so a slice can borrow the same hue for a soft fill.
 * The sequence is tuned for legibility over the translucent analytics cards in
 * both light and dark themes; it wraps if a series exceeds its length.
 */
const CATEGORICAL_HUES = [214, 262, 152, 28, 340, 190, 48, 122] as const

export function categoricalColor(index: number, saturation = 68, lightness = 58): string {
  const hue = CATEGORICAL_HUES[((index % CATEGORICAL_HUES.length) + CATEGORICAL_HUES.length) % CATEGORICAL_HUES.length]
  return `hsl(${hue} ${saturation}% ${lightness}%)`
}

export function categoricalSoftColor(index: number): string {
  return categoricalColor(index, 62, 88)
}
