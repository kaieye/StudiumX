import type { MindMapTheme } from '../../../../shared/mindmap/domain/types'
import { DAWN_COLORS } from '../../../../shared/mindmap/themes/color-schemes'

/**
 * Branch colour palette inspired by StudiumX's default theme.
 *
 * Each first-level branch gets a distinct colour. Descendants inherit their
 * branch ancestor's colour for visual grouping.
 */
/**
 * Default branch colors - StudiumX "Dawn" (晨曦) multi-line color scheme.
 * Now sourced from the shared color-schemes table (P4).
 */
export const DEFAULT_BRANCH_COLORS: readonly string[] = DAWN_COLORS

/**
 * Resolve the branch colour for a given branch index from the document theme.
 *
 * Falls back to `DEFAULT_BRANCH_COLORS` when the theme omits `branchColors`.
 * The palette wraps around if the index exceeds the palette length.
 */
export function branchColor(
  theme: MindMapTheme | undefined,
  branchIndex: number
): string | null {
  // P2 §5.3: When rainbowBranches is explicitly false, use a single line color.
  if (theme?.rainbowBranches === false) {
    return theme.lineColor ?? '#8E8E93'
  }
  return paletteColor(theme, branchIndex)
}

/**
 * Deterministic, stable FNV-1a-style hash of a branch's stable id.
 *
 * Used so a first-level branch keeps the same colour even when a sibling is
 * inserted above/before it (which would otherwise shift its positional index
 * and re-colour every following branch).
 */
function stableBranchHash(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Resolve a branch colour that is stable per-branch (keyed by the top-level
 * branch's topic id) rather than per-positional-index. Inserting or moving a
 * sibling no longer re-colours existing branches.
 */
export function branchColorForKey(
  theme: MindMapTheme | undefined,
  branchKey: string
): string | null {
  // P2 §5.3: When rainbowBranches is explicitly false, use a single line color.
  if (theme?.rainbowBranches === false) {
    return theme.lineColor ?? '#8E8E93'
  }
  return paletteColor(theme, stableBranchHash(branchKey))
}

/** Pick a palette colour for a raw slot (index or stable hash), wrapping around. */
function paletteColor(theme: MindMapTheme | undefined, slot: number): string | null {
  const palette = theme?.branchColors
  if (palette && palette.length > 0) {
    return palette[slot % palette.length] ?? null
  }
  return DEFAULT_BRANCH_COLORS[slot % DEFAULT_BRANCH_COLORS.length] ?? null
}

/**
 * Soft background tint derived from a branch colour (for branch nodes).
 *
 * Uses CSS `color-mix` via inline style if available, or a fallback with
 * reduced opacity.
 */
export function branchFillColor(color: string | null): string | null {
  if (!color) return null
  return color
}

/**
 * Convert a hex colour to an rgba string with the given alpha.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  if (fullHex.length !== 6) return hex
  const r = parseInt(fullHex.slice(0, 2), 16)
  const g = parseInt(fullHex.slice(2, 4), 16)
  const b = parseInt(fullHex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
