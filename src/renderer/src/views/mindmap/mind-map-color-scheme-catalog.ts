import {
  COLOR_SCHEMES,
  getColorSchemeCategory,
  type MindMapColorSchemeCategory
} from '../../../../shared/mindmap/themes/color-schemes'

export { getColorSchemeCategory, type MindMapColorSchemeCategory }

/**
 * User color-scheme catalogue (user state, NOT teaching authority).
 *
 * Holds user-created custom color schemes plus user-preference favorites and
 * recent lists. This is purely cosmetic/preference state local to the renderer
 * and is persisted to localStorage; it is never treated as teaching evidence,
 * never auto-injected, and never auto-applied to a document.
 *
 * Applying a scheme still flows through the canonical `document.apply-theme`
 * command, and the resolved palette is written into the document theme's
 * `branchColors` so deleting a scheme never blanks an open document.
 */

export const COLOR_SCHEME_CATALOG_KEY = 'mindmap.colorSchemes'
export const MAX_RECENT_COLOR_SCHEMES = 6
export const MAX_PALETTE_COLORS = 8
export const MIN_PALETTE_COLORS = 5
export const EDITOR_PALETTE_COLORS = 6

/** Default 6-color palette used when creating a fresh custom scheme. */
export const DEFAULT_CUSTOM_COLOR_SCHEME_PALETTE: readonly string[] = [
  '#FF6B6B',
  '#FF9F69',
  '#97D3B6',
  '#88E2D7',
  '#6FD0F9',
  '#E18BEE'
]

export type UserColorScheme = {
  /** Stable unique identifier (built-in schemes are identified by their id). */
  id: string
  /** Display name shown in the picker and editor. */
  name: string
  /** 5–8 opaque branch colors. */
  colors: string[]
  createdAt: number
  updatedAt: number
}

export type ColorSchemeCatalogState = {
  /** User-created custom schemes (built-in schemes are not stored here). */
  schemes: UserColorScheme[]
  /** ids of favorited schemes (built-in or custom), pinned first in the picker. */
  favorites: string[]
  /** ids of recently used schemes (built-in or custom), newest first, capped. */
  recent: string[]
}

export const EMPTY_COLOR_SCHEME_CATALOG: ColorSchemeCatalogState = {
  schemes: [],
  favorites: [],
  recent: []
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function isBuiltInColorSchemeId(id: string): boolean {
  return COLOR_SCHEMES.some((scheme) => scheme.id === id)
}

export function isUserColorSchemeId(id: string): boolean {
  return !isBuiltInColorSchemeId(id)
}

export function createUserColorSchemeId(): string {
  return `user-${crypto.randomUUID()}`
}

function sanitizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return HEX_COLOR_PATTERN.test(value) ? value.toUpperCase() : null
}

function sanitizePalette(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const colors = value.map(sanitizeColor).filter((color): color is string => color !== null)
  return [...new Set(colors)]
}

/** Normalize a palette to 5–8 distinct opaque colors, padding/truncating as needed. */
export function normalizeColorSchemePalette(colors: readonly string[]): string[] {
  const distinct = sanitizePalette(colors)
  if (distinct.length === 0) return [...DEFAULT_CUSTOM_COLOR_SCHEME_PALETTE]
  if (distinct.length < MIN_PALETTE_COLORS) {
    const pad = DEFAULT_CUSTOM_COLOR_SCHEME_PALETTE.filter(
      (color) => !distinct.includes(color)
    )
    distinct.push(...pad)
  }
  return distinct.slice(0, MAX_PALETTE_COLORS)
}

function sanitizeSchemeId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null
  return value
}

export function sanitizeColorSchemeCatalog(raw: unknown): ColorSchemeCatalogState {
  if (raw === null || typeof raw !== 'object') return { ...EMPTY_COLOR_SCHEME_CATALOG }
  const candidate = raw as { schemes?: unknown; favorites?: unknown; recent?: unknown }
  const schemes = Array.isArray(candidate.schemes) ? candidate.schemes : []
  const parsedSchemes: UserColorScheme[] = []
  for (const entry of schemes) {
    if (entry === null || typeof entry !== 'object') continue
    const scheme = entry as { id?: unknown; name?: unknown; colors?: unknown; createdAt?: unknown; updatedAt?: unknown }
    const id = sanitizeSchemeId(scheme.id)
    const name = typeof scheme.name === 'string' ? scheme.name.trim().slice(0, 80) : ''
    if (!id || !name) continue
    const colors = sanitizePalette(scheme.colors)
    if (colors.length < MIN_PALETTE_COLORS) continue
    parsedSchemes.push({
      id,
      name,
      colors: colors.slice(0, MAX_PALETTE_COLORS),
      createdAt: typeof scheme.createdAt === 'number' ? scheme.createdAt : Date.now(),
      updatedAt: typeof scheme.updatedAt === 'number' ? scheme.updatedAt : Date.now()
    })
  }
  const existingIds = new Set(parsedSchemes.map((scheme) => scheme.id))
  const isResolvableId = (id: string | null): id is string =>
    id !== null && (existingIds.has(id) || isBuiltInColorSchemeId(id))
  const favorites = Array.isArray(candidate.favorites)
    ? [...new Set(candidate.favorites.map(sanitizeSchemeId).filter(isResolvableId))]
    : []
  const recent = Array.isArray(candidate.recent)
    ? [...new Set(candidate.recent.map(sanitizeSchemeId).filter(isResolvableId))].slice(0, MAX_RECENT_COLOR_SCHEMES)
    : []
  return { schemes: parsedSchemes, favorites, recent }
}

export function loadColorSchemeCatalog(): ColorSchemeCatalogState {
  try {
    const raw = localStorage.getItem(COLOR_SCHEME_CATALOG_KEY)
    if (!raw) return { ...EMPTY_COLOR_SCHEME_CATALOG }
    return sanitizeColorSchemeCatalog(JSON.parse(raw))
  } catch {
    // localStorage may be unavailable or hold malformed data; start empty.
    return { ...EMPTY_COLOR_SCHEME_CATALOG }
  }
}

export function persistColorSchemeCatalog(state: ColorSchemeCatalogState): void {
  try {
    localStorage.setItem(COLOR_SCHEME_CATALOG_KEY, JSON.stringify(state))
  } catch {
    // localStorage may be unavailable; the in-memory catalogue still works.
  }
}

export function addUserColorScheme(
  state: ColorSchemeCatalogState,
  name: string,
  colors: readonly string[]
): { state: ColorSchemeCatalogState; scheme: UserColorScheme } {
  const now = Date.now()
  const scheme: UserColorScheme = {
    id: createUserColorSchemeId(),
    name: name.trim().slice(0, 80) || 'Untitled scheme',
    colors: normalizeColorSchemePalette(colors),
    createdAt: now,
    updatedAt: now
  }
  return { state: { ...state, schemes: [...state.schemes, scheme] }, scheme }
}

export function renameUserColorScheme(
  state: ColorSchemeCatalogState,
  id: string,
  name: string
): ColorSchemeCatalogState {
  const nextName = name.trim().slice(0, 80)
  if (!nextName) return state
  return {
    ...state,
    schemes: state.schemes.map((scheme) =>
      scheme.id === id ? { ...scheme, name: nextName, updatedAt: Date.now() } : scheme
    )
  }
}

export function setUserColorSchemeColors(
  state: ColorSchemeCatalogState,
  id: string,
  colors: readonly string[]
): { state: ColorSchemeCatalogState; scheme: UserColorScheme | null } {
  const nextColors = normalizeColorSchemePalette(colors)
  const schemes = state.schemes.map((scheme) =>
    scheme.id === id ? { ...scheme, colors: nextColors, updatedAt: Date.now() } : scheme
  )
  return { state: { ...state, schemes }, scheme: schemes.find((scheme) => scheme.id === id) ?? null }
}

export function duplicateUserColorScheme(
  state: ColorSchemeCatalogState,
  id: string
): { state: ColorSchemeCatalogState; scheme: UserColorScheme | null } {
  const source = state.schemes.find((scheme) => scheme.id === id)
  if (!source) return { state, scheme: null }
  const now = Date.now()
  const copy: UserColorScheme = {
    id: createUserColorSchemeId(),
    name: `${source.name} copy`,
    colors: [...source.colors],
    createdAt: now,
    updatedAt: now
  }
  return { state: { ...state, schemes: [...state.schemes, copy] }, scheme: copy }
}

/** Remove a scheme from the catalogue and any favorites/recent references. */
export function deleteUserColorScheme(state: ColorSchemeCatalogState, id: string): ColorSchemeCatalogState {
  return {
    ...state,
    schemes: state.schemes.filter((scheme) => scheme.id !== id),
    favorites: state.favorites.filter((favorite) => favorite !== id),
    recent: state.recent.filter((recent) => recent !== id)
  }
}

export function toggleColorSchemeFavorite(state: ColorSchemeCatalogState, id: string): ColorSchemeCatalogState {
  const favorites = state.favorites.includes(id)
    ? state.favorites.filter((favorite) => favorite !== id)
    : [...state.favorites, id]
  return { ...state, favorites }
}

export function recordRecentColorScheme(state: ColorSchemeCatalogState, id: string): ColorSchemeCatalogState {
  const recent = [id, ...state.recent.filter((recent) => recent !== id)].slice(0, MAX_RECENT_COLOR_SCHEMES)
  return { ...state, recent }
}
