/**
 * Built-in mind-map themes derived from Xmind's Snowbrush theme catalogue.
 *
 * Each theme is converted at module-load time from the original Xmind JSON
 * (stored in `./xmind/*.json`) via {@link fromXmindTheme}. Only style
 * parameters (colours, font sizes, weights, line widths) are extracted -
 * these are non-copyrightable functional parameters, not Xmind's fonts or
 * images.
 *
 * The full catalogue (43 themes across map / logic / brace / org / tree /
 * timeline / fishbone / matrix layout families) is loaded eagerly via Vite's
 * `import.meta.glob` and ordered by Xmind's `themes.json` index.
 */

import type { MindMapTheme } from '../domain/types'
import { fromXmindTheme } from './from-xmind-theme'
import { DAWN_COLORS } from './color-schemes'

import themeIndex from './xmind/themes.json'

/** Raw shape of a single Xmind theme JSON file. */
interface XmindThemeJson {
  /** Xmind internal id, e.g. "M01". */
  name: string
  content: {
    id: string
    [key: string]: unknown
  }
}

/** Entry in Xmind's themes.json index. */
interface ThemeIndexEntry {
  /** Xmind internal id, e.g. "M01". */
  id: string
  /** Display name, e.g. "Snowbrush". */
  name: string
  /** Layout family: map / logic / brace / org / tree / timeline / fishbone / matrix. */
  template: string
  tid: string
}

/**
 * Eagerly load every Xmind theme JSON.
 * `themes.json` (the index) is filtered out at runtime because it has a
 * different shape (`{ themes: [...] }`) and is imported separately above.
 */
const themeModules = import.meta.glob('./xmind/*.json', { eager: true })

const indexEntries = (themeIndex as { themes: ThemeIndexEntry[] }).themes

/**
 * Convert an Xmind theme display name to a URL-safe slug used as the theme id.
 * e.g. "Classic II" -> "classic-ii", "Night Sky" -> "night-sky".
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Convert an Xmind theme JSON, applying the Dawn color scheme as branch colors. */
function convert(json: XmindThemeJson, id: string, displayName: string): MindMapTheme {
  const theme = fromXmindTheme(
    json as Parameters<typeof fromXmindTheme>[0],
    id
  )
  // Override the internal Xmind id (e.g. "M01") with the human-readable
  // display name (e.g. "Snowbrush") so the gallery fallback is meaningful.
  theme.name = displayName
  // All built-in themes use the Dawn color scheme by default.
  theme.branchColors = [...DAWN_COLORS]
  theme.colorSchemeId = 'dawn'
  theme.rainbowBranches = true
  return theme
}

/** Map of Xmind internal ids (e.g. "M01") to their parsed theme JSON. */
const themeByXmindId = new Map<string, XmindThemeJson>()
for (const [path, mod] of Object.entries(themeModules)) {
  // Skip the themes.json index file (different shape).
  if (path.endsWith('themes.json')) continue
  const candidate = mod as { default?: XmindThemeJson }
  const json: XmindThemeJson = candidate.default ?? (mod as XmindThemeJson)
  themeByXmindId.set(json.name, json)
}

/**
 * All built-in themes, ordered by the Xmind themes.json index.
 *
 * Each theme's id is a slug derived from its display name (e.g. "Snowbrush"
 * -> "snowbrush"), so the six previously-migrated themes keep their ids
 * ("snowbrush", "classic", "business", "light", "fresh", "party") and
 * existing documents continue to match.
 */
export const BUILT_IN_THEMES: readonly MindMapTheme[] = indexEntries.flatMap(
  (entry): MindMapTheme[] => {
    const json = themeByXmindId.get(entry.id)
    if (!json) return []
    return [convert(json, slugify(entry.name), entry.name)]
  }
)

/** Look up a built-in theme by id. */
export function getBuiltInTheme(id: string): MindMapTheme | undefined {
  return BUILT_IN_THEMES.find((t) => t.id === id)
}
