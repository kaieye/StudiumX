import { DEFAULT_TOPIC_FONT_FAMILY } from './mind-map-topic-display-style'

/**
 * A curated catalogue of safe, widely available font stacks plus the app's own
 * defaults, with search + recent-use helpers (checklist C-02) and per-option
 * preview data consumed by the shared `MindMapFontPicker` component (C-06).
 *
 * This is intentionally NOT an OS-level font-installation probe: the renderer
 * cannot reliably tell whether a requested family is installed. We offer
 * conservative web-safe stacks and the app's built-in CJK-safe choices, and
 * preserve any unlisted imported/custom stack verbatim (see
 * `mind-map-font-provenance.ts` for the "may fall back" contract).
 */

export type FontCategory = 'system' | 'sans' | 'serif' | 'mono' | 'cjk'

export type FontCatalogueEntry = {
  /** Stable id used for React keys and for equality in the managed set. */
  id: string
  /** CSS font-family stack. An empty stack is NOT allowed in SAFE_FONTS. */
  stack: string
  /** Existing i18n key (namespace-agnostic path passed to `t`). */
  labelKey?: string
  /** Stable literal label used when no i18n key exists (e.g. real font names). */
  label?: string
  category: FontCategory
}

export const MAX_RECENT_FONTS = 6
export const RECENT_FONTS_KEY = 'mindmap.recentFonts'

/**
 * App defaults and web-safe stacks. Stacks mirror the document/topic controls
 * (`MindMapThemePanel`, `MindMapTopicStyleInspector`) plus a small set of
 * well-known safe families, so the searchable list is consistent with what the
 * app already offers and flags as managed.
 */
export const SAFE_FONTS: readonly FontCatalogueEntry[] = [
  {
    id: 'app-default',
    stack: DEFAULT_TOPIC_FONT_FAMILY,
    labelKey: 'mindmap.topicStyle.fontAppDefault',
    category: 'sans'
  },
  {
    id: 'system-ui',
    stack: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    labelKey: 'mindmap.topicStyle.fontSystem',
    category: 'system'
  },
  {
    id: 'inter',
    stack: 'Inter, system-ui, sans-serif',
    labelKey: 'mindmap.themePanel.sansFont',
    category: 'sans'
  },
  {
    id: 'arial',
    stack: 'Arial, Helvetica, sans-serif',
    labelKey: 'mindmap.topicStyle.fontSans',
    category: 'sans'
  },
  {
    id: 'segoe',
    stack: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    label: 'Segoe UI',
    category: 'sans'
  },
  {
    id: 'verdana',
    stack: 'Verdana, Geneva, sans-serif',
    label: 'Verdana',
    category: 'sans'
  },
  {
    id: 'trebuchet',
    stack: "'Trebuchet MS', 'Segoe UI', Helvetica, sans-serif",
    label: 'Trebuchet MS',
    category: 'sans'
  },
  {
    id: 'tahoma',
    stack: 'Tahoma, Geneva, Verdana, sans-serif',
    label: 'Tahoma',
    category: 'sans'
  },
  {
    id: 'cjk-sans',
    stack: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    labelKey: 'mindmap.topicStyle.fontCjkSans',
    category: 'cjk'
  },
  {
    id: 'cjk-serif',
    stack: '"Noto Serif CJK SC", "Songti SC", SimSun, serif',
    labelKey: 'mindmap.topicStyle.fontCjkSerif',
    category: 'cjk'
  },
  {
    id: 'ui-serif',
    stack: 'ui-serif, Georgia, "Times New Roman", serif',
    labelKey: 'mindmap.topicStyle.fontSerif',
    category: 'serif'
  },
  {
    id: 'georgia',
    stack: "Georgia, 'Times New Roman', serif",
    label: 'Georgia',
    category: 'serif'
  },
  {
    id: 'times',
    stack: "'Times New Roman', Times, serif",
    label: 'Times New Roman',
    category: 'serif'
  },
  {
    id: 'palatino',
    stack: "Palatino Linotype, 'Book Antiqua', Palatino, serif",
    label: 'Palatino',
    category: 'serif'
  },
  {
    id: 'mono',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    labelKey: 'mindmap.topicStyle.fontMono',
    category: 'mono'
  },
  {
    id: 'mono-menlo',
    stack: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    label: 'Menlo',
    category: 'mono'
  },
  {
    id: 'courier',
    stack: "'Courier New', Courier, monospace",
    label: 'Courier New',
    category: 'mono'
  },
  {
    id: 'consolas',
    stack: "Consolas, 'Andale Mono', monospace",
    label: 'Consolas',
    category: 'mono'
  }
]

/** All non-empty stacks in the catalogue; used to extend the managed set. */
export const SAFE_FONT_STACKS: readonly string[] = SAFE_FONTS.map((entry) => entry.stack)

/** Resolve a catalogue entry's display/search label from i18n or literal. */
export function fontEntryLabel(
  entry: FontCatalogueEntry,
  t: (key: string) => string
): string {
  return entry.label ?? t(entry.labelKey ?? '')
}

/**
 * Filter the catalogue by a query, matching the translated label or the raw
 * stack, case-insensitively. Pure and unit-testable.
 */
export function filterFontCatalogue(
  entries: readonly FontCatalogueEntry[],
  query: string,
  labelOf: (entry: FontCatalogueEntry) => string
): FontCatalogueEntry[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...entries]
  return entries.filter((entry) => {
    const label = labelOf(entry).toLocaleLowerCase()
    const stack = entry.stack.toLocaleLowerCase()
    return label.includes(normalized) || stack.includes(normalized)
  })
}

/**
 * Record a recently used font stack, most-recent first, deduped and capped.
 * Pure: returns a new array and never mutates the input.
 */
export function recordRecentFont(
  recent: readonly string[],
  stack: string,
  max = MAX_RECENT_FONTS
): string[] {
  const normalized = stack.trim()
  if (!normalized) return [...recent]
  return [normalized, ...recent.filter((existing) => existing !== normalized)].slice(0, max)
}

/** Load and validate persisted recent fonts from a storage backend. */
export function loadRecentFonts(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = storage.getItem(RECENT_FONTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const fonts = parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    return [...new Set(fonts)].slice(0, MAX_RECENT_FONTS)
  } catch {
    // localStorage may be unavailable or hold malformed data; start empty.
    return []
  }
}

/** Clear persisted recent fonts from a storage backend. */
export function clearRecentFonts(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(RECENT_FONTS_KEY)
  } catch {
    // localStorage may be unavailable; the in-memory list is already cleared.
  }
}

/**
 * Props for the shared `MindMapFontPicker` component (defined in
 * `MindMapThemePanel.tsx` so the JSX lives in a `.tsx` module; this project
 * restricts JSX to `.tsx` files).
 */
export type MindMapFontPickerProps = {
  /** Current font stack ('' or undefined means no concrete selection). */
  value?: string
  /** Label shown on the trigger for the current value. */
  currentLabel: string
  /** Accessible name for the trigger and the popover. */
  ariaLabel: string
  /** Called with the selected stack; '' selects the system entry when shown. */
  onSelect: (stack: string | undefined) => void
  /** When true, show a "System" entry (empty stack) at the top of All. */
  systemLabel?: string
  /** When true, show a "clear override" entry that calls onSelect(undefined). */
  showClearItem?: boolean
  clearLabel?: string
  searchPlaceholder?: string
  searchLabel?: string
  noResultsLabel?: string
  recentLabel?: string
  allLabel?: string
}
