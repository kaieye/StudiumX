import { ChevronDown, RotateCcw, Search, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_MIND_MAP_THEME,
  type MindMapTheme
} from '../../../../shared/mindmap/domain/types'
import { isManagedMindMapFontFamily } from './mind-map-font-provenance'
import {
  filterFontCatalogue,
  FontCatalogueEntry,
  fontEntryLabel,
  loadRecentFonts,
  MindMapFontPickerProps,
  RECENT_FONTS_KEY,
  recordRecentFont,
  SAFE_FONTS
} from './mind-map-font-list'
import { useMindMapViewStore } from './mind-map-view-store'

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const DEFAULT_BACKGROUND = '#FFFFFF'
const RECENT_BACKGROUND_COLORS_KEY = 'mindmap.recentBackgroundColors'
const MAX_RECENT_BACKGROUND_COLORS = 8

/**
 * The locale catalogs declare the recent-color label with a single-brace
 * placeholder (`Recent color {color}`), while i18next only interpolates
 * `{{...}}` by default. Resolve the value regardless of catalog shape.
 */
function interpolateRecentColorLabel(label: string, color: string): string {
  return label.replace('{color}', color)
}
const DEFAULT_LINE_COLOR = '#8E8E93'
function expandHexDigits(digits: string): string {
  return digits.length === 3
    ? digits.split('').map((part) => `${part}${part}`).join('')
    : digits
}

/** The native color well needs an opaque 6-digit value; strip any alpha. */
function hexColorWellValue(background: string): string {
  const match = HEX_COLOR_PATTERN.exec(background)
  if (!match) return DEFAULT_BACKGROUND
  return `#${expandHexDigits(match[1]!).slice(0, 6).toLowerCase()}`
}

/** Current alpha of a hex background as a percentage; defaults to 100%. */
function backgroundAlphaPercent(background: string): number {
  const match = HEX_COLOR_PATTERN.exec(background)
  if (!match) return 100
  const digits = expandHexDigits(match[1]!)
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
  return Math.round(alpha * 100)
}

/** Rewrite a hex background as 8-digit #RRGGBBAA with the given percentage alpha. */
function backgroundWithAlpha(background: string, percent: number): string | null {
  const match = HEX_COLOR_PATTERN.exec(background)
  if (!match) return null
  const digits = expandHexDigits(match[1]!).slice(0, 6).toUpperCase()
  const alpha = Math.max(0, Math.min(255, Math.round((percent / 100) * 255)))
  return `#${digits}${alpha.toString(16).padStart(2, '0').toUpperCase()}`
}

function loadRecentBackgroundColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_BACKGROUND_COLORS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const colors = parsed
      .filter((value): value is string => typeof value === 'string' && HEX_COLOR_PATTERN.test(value))
      .map((color) => color.toUpperCase())
    return [...new Set(colors)].slice(0, MAX_RECENT_BACKGROUND_COLORS)
  } catch {
    // localStorage may be unavailable or hold malformed data; start empty.
    return []
  }
}

function persistRecentBackgroundColors(colors: readonly string[]): void {
  try {
    localStorage.setItem(RECENT_BACKGROUND_COLORS_KEY, JSON.stringify(colors))
  } catch {
    // localStorage may be unavailable; the in-memory list still works.
  }
}

const BACKGROUND_PRESETS = [
  { id: 'transparent', value: 'transparent' },
  { id: 'white', value: '#FFFFFF' },
  { id: 'slate', value: '#F8FAFC' },
  { id: 'warm', value: '#FFF7ED' },
  { id: 'mint', value: '#F0FDF4' }
] as const

/**
 * Document-theme controls. Every mutation uses one `document.apply-theme`
 * command so undo/redo and revisioned persistence stay on the canonical lane.
 */
export function MindMapThemePanel() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const background = current?.theme.background ?? DEFAULT_BACKGROUND
  const lineColor = current?.theme.lineColor ?? DEFAULT_LINE_COLOR
  const [backgroundDraft, setBackgroundDraft] = useState(background)
  const [lineColorDraft, setLineColorDraft] = useState(lineColor)
  const [recentColors, setRecentColors] = useState<string[]>(loadRecentBackgroundColors)

  useEffect(() => setBackgroundDraft(background), [background])
  useEffect(() => setLineColorDraft(lineColor), [lineColor])

  if (!current) return null

  const isDefaultTheme = themesEqual(current.theme, DEFAULT_MIND_MAP_THEME)
  const rainbowBranches = current.theme.rainbowBranches !== false
  const documentFont = current.theme.fontFamily ?? ''
  const documentFontEntry = documentFont
    ? SAFE_FONTS.find((entry) => entry.stack === documentFont)
    : undefined
  const documentFontLabel = documentFont === ''
    ? t('mindmap.themePanel.systemFont')
    : documentFontEntry
      ? fontEntryLabel(documentFontEntry, t)
      : t('mindmap.topicStyle.importedFont', { font: documentFont })
  const documentFontMayFallback = Boolean(
    documentFont && !isManagedMindMapFontFamily(documentFont)
  )
  const applyThemeField = (patch: Partial<MindMapTheme>, label = 'Update mind map theme'): void => {
    dispatchCommand(
      { type: 'document.apply-theme', theme: { ...current.theme, ...patch } },
      { label }
    )
  }

  const resetTheme = (): void => {
    if (isDefaultTheme) return
    dispatchCommand(
      { type: 'document.apply-theme', theme: DEFAULT_MIND_MAP_THEME },
      { label: 'Reset mind map theme' }
    )
  }

  const recordRecentBackground = (value: string): void => {
    if (!HEX_COLOR_PATTERN.test(value)) return
    const normalized = value.toUpperCase()
    const next = [
      normalized,
      ...recentColors.filter((color) => color.toUpperCase() !== normalized)
    ].slice(0, MAX_RECENT_BACKGROUND_COLORS)
    setRecentColors(next)
    persistRecentBackgroundColors(next)
  }

  const applyBackground = (value: string): void => {
    applyThemeField({ background: value })
    recordRecentBackground(value)
  }

  const clearRecentBackgroundColors = (): void => {
    setRecentColors([])
    try {
      localStorage.removeItem(RECENT_BACKGROUND_COLORS_KEY)
    } catch {
      // localStorage may be unavailable; the in-memory list is already cleared.
    }
  }

  const commitHexDraft = (field: 'background' | 'lineColor'): void => {
    const draft = field === 'background' ? backgroundDraft : lineColorDraft
    if (HEX_COLOR_PATTERN.test(draft)) {
      const value = draft.toUpperCase()
      if (field === 'background') applyBackground(value)
      else applyThemeField({ [field]: value })
      return
    }
    if (field === 'background') setBackgroundDraft(background)
    else setLineColorDraft(lineColor)
  }

  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>, field: 'background' | 'lineColor'): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commitHexDraft(field)
    event.currentTarget.blur()
  }

  return (
    <section className="mindmap-theme-panel mm-section" aria-labelledby="mindmap-theme-panel-title">
      <div className="mm-section__head">
        <div>
          <strong id="mindmap-theme-panel-title">{t('mindmap.themePanel.title')}</strong>
          <span className="mm-section__hint">{t('mindmap.themePanel.documentScope')}</span>
        </div>
        <button
          type="button"
          className="mm-section__action"
          disabled={isDefaultTheme}
          onClick={resetTheme}
          title={t('mindmap.themePanel.reset')}
          aria-label={t('mindmap.themePanel.reset')}
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
      </div>

      <div className="mm-row mm-row--stack">
        <span className="mm-row__label">{t('mindmap.themePanel.backgroundColor')}</span>
        <div className="mindmap-theme-color-editor">
          <input
            id="mindmap-theme-background"
            type="color"
            className="mm-color-well"
            aria-label={t('mindmap.themePanel.backgroundColor')}
            value={hexColorWellValue(background)}
            onChange={(event) => applyBackground(event.currentTarget.value.toUpperCase())}
          />
          <input
            className="mindmap-theme-color-editor__hex"
            aria-label={t('mindmap.themePanel.backgroundHex')}
            value={backgroundDraft}
            onChange={(event) => setBackgroundDraft(event.currentTarget.value)}
            onBlur={() => commitHexDraft('background')}
            onKeyDown={(event) => commitOnEnter(event, 'background')}
            spellCheck={false}
          />
          <button
            type="button"
            className={`mindmap-theme-color-editor__clear${background === 'transparent' ? ' is-selected' : ''}`}
            aria-pressed={background === 'transparent'}
            onClick={() => applyThemeField({ background: 'transparent' })}
          >
            <X size={12} aria-hidden="true" />
            {t('mindmap.themePanel.transparent')}
          </button>
        </div>
        <div className="mm-row mindmap-theme-alpha-row">
          <label className="mm-row__label" htmlFor="mindmap-theme-background-alpha">
            {t('mindmap.themePanel.alpha')}
          </label>
          <span className="mindmap-theme-alpha-row__control">
            <input
              id="mindmap-theme-background-alpha"
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={background === 'transparent'}
              aria-label={t('mindmap.themePanel.alphaLabel')}
              aria-description={background === 'transparent'
                ? t('mindmap.themePanel.alphaUnavailable')
                : undefined}
              title={t('mindmap.themePanel.alphaLabel')}
              value={backgroundAlphaPercent(background)}
              onChange={(event) => {
                const next = backgroundWithAlpha(background, Number(event.currentTarget.value))
                if (next) applyThemeField({ background: next })
              }}
            />
            <output
              className="mindmap-theme-alpha-row__value"
              htmlFor="mindmap-theme-background-alpha"
            >
              {backgroundAlphaPercent(background)}%
            </output>
          </span>
        </div>
        <div className="mindmap-theme-presets" role="group" aria-label={t('mindmap.themePanel.backgroundPresets')}>
          {BACKGROUND_PRESETS.map((preset) => {
            const selected = background.toUpperCase() === preset.value.toUpperCase()
            return (
              <button
                key={preset.id}
                type="button"
                className={selected ? 'is-selected' : ''}
                aria-label={t(`mindmap.themePanel.backgroundPresetNames.${preset.id}`)}
                aria-pressed={selected}
                onClick={() => applyBackground(preset.value)}
                style={preset.value === 'transparent' ? undefined : { background: preset.value }}
              >
                {preset.value === 'transparent' ? <X size={11} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
        {recentColors.length > 0 ? (
          <div className="mindmap-theme-recent-row">
            <span className="mm-row__label">{t('mindmap.themePanel.recentColors')}</span>
            <div className="mindmap-theme-recent-row__controls">
              <div
                className="mindmap-theme-presets"
                role="group"
                aria-label={t('mindmap.themePanel.recentColors')}
              >
                {recentColors.map((color) => {
                  const selected = background.toUpperCase() === color
                  return (
                    <button
                      key={color}
                      type="button"
                      className={selected ? 'is-selected' : ''}
                      aria-label={interpolateRecentColorLabel(
                        t('mindmap.themePanel.recentColor', { color }),
                        color
                      )}
                      aria-pressed={selected}
                      onClick={() => applyBackground(color)}
                      style={{ background: color }}
                    />
                  )
                })}
              </div>
              <button
                type="button"
                className="mindmap-theme-color-editor__clear"
                title={t('mindmap.themePanel.clearRecent')}
                aria-label={t('mindmap.themePanel.clearRecent')}
                onClick={clearRecentBackgroundColors}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.themePanel.fontFamily')}</span>
        <MindMapFontPicker
          value={documentFont || undefined}
          currentLabel={documentFontLabel}
          ariaLabel={t('mindmap.themePanel.fontFamily')}
          systemLabel={t('mindmap.themePanel.systemFont')}
          onSelect={(stack) => applyThemeField({ fontFamily: stack || undefined })}
          searchPlaceholder="Search fonts…"
          searchLabel="Search fonts"
          noResultsLabel="No fonts found."
          recentLabel="Recent"
          allLabel="All fonts"
        />
        {documentFontMayFallback ? (
          <span className="mindmap-topic-style__font-warning" role="status">
            {t('mindmap.topicStyle.fontMayFallback')}
          </span>
        ) : null}
      </div>

      <label className="mm-row mm-row--switch">
        <span className="mm-row__label">
          {t('mindmap.themePanel.rainbowBranches')}
          <small>{t('mindmap.themePanel.branchColorPreserved')}</small>
        </span>
        <span className="mm-switch">
          <input
            type="checkbox"
            aria-label={t('mindmap.themePanel.rainbowBranches')}
            checked={rainbowBranches}
            onChange={(event) => applyThemeField({ rainbowBranches: event.currentTarget.checked })}
          />
          <span className="mm-switch__track" aria-hidden="true" />
        </span>
      </label>

      {!rainbowBranches ? (
        <div className="mm-row">
          <label className="mm-row__label" htmlFor="mindmap-theme-line-color">
            {t('mindmap.themePanel.lineColor')}
          </label>
          <div className="mindmap-theme-color-editor">
            <input
              id="mindmap-theme-line-color"
              type="color"
              className="mm-color-well"
              value={lineColor}
              onChange={(event) => applyThemeField({ lineColor: event.currentTarget.value.toUpperCase() })}
            />
            <input
              className="mindmap-theme-color-editor__hex"
              aria-label={t('mindmap.themePanel.lineColorHex')}
              value={lineColorDraft}
              onChange={(event) => setLineColorDraft(event.currentTarget.value)}
              onBlur={() => commitHexDraft('lineColor')}
              onKeyDown={(event) => commitOnEnter(event, 'lineColor')}
              spellCheck={false}
            />
          </div>
        </div>
      ) : null}

    </section>
  )
}

function themesEqual(left: MindMapTheme, right: MindMapTheme): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const FONT_PICKER_OPTIONS_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  marginTop: '8px',
  maxHeight: '260px',
  overflowY: 'auto'
}

const FONT_GROUP_CATEGORY_STYLE: CSSProperties = {
  display: 'block'
}

/**
 * A searchable font picker with recent-use, keyboard navigation and
 * per-option font previews (checklist C-02 / C-06). Long lists scroll within
 * the popover via pure CSS (`max-height` + `overflow-y`) rather than a
 * virtualization library, which is sufficient for the curated catalogue size.
 */
export function MindMapFontPicker({
  value,
  currentLabel,
  ariaLabel,
  onSelect,
  systemLabel,
  showClearItem = false,
  clearLabel = 'Clear field override',
  searchPlaceholder = 'Search fonts…',
  searchLabel = 'Search fonts',
  noResultsLabel = 'No fonts found.',
  recentLabel = 'Recent',
  allLabel = 'All fonts'
}: MindMapFontPickerProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>(() => loadRecentFonts(window.localStorage))

  const labelOf = (entry: FontCatalogueEntry): string => fontEntryLabel(entry, t)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matching = filterFontCatalogue(SAFE_FONTS, normalizedQuery, labelOf)

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const closeAndRestoreFocus = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const commit = (stack: string | undefined): void => {
    if (stack) {
      const next = recordRecentFont(recent, stack)
      setRecent(next)
      try {
        window.localStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(next))
      } catch {
        // localStorage may be unavailable; the in-memory list still works.
      }
    }
    onSelect(stack)
    closeAndRestoreFocus()
  }

  const recentStacks = recent.filter((stack) => stack.length > 0)
  const recentEntries = recentStacks
    .map((stack) => matching.find((entry) => entry.stack === stack))
    .filter((entry): entry is FontCatalogueEntry => entry !== undefined)
  const allEntries = matching.filter((entry) => !recentStacks.includes(entry.stack))

  const systemShown = Boolean(
    systemLabel &&
    (normalizedQuery === '' || systemLabel.toLocaleLowerCase().includes(normalizedQuery))
  )
  const systemSelected = systemShown && (value === undefined || value === '')
  const hasResults = systemShown || recentEntries.length > 0 || allEntries.length > 0

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndRestoreFocus()
      return
    }
    if (event.key === 'Enter') {
      const active = document.activeElement as HTMLElement | null
      if (active?.getAttribute('role') === 'option') {
        event.preventDefault()
        active.click()
        return
      }
      const first = optionsRef.current?.querySelector<HTMLElement>('[role="option"]')
      if (first) {
        event.preventDefault()
        first.click()
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const options = [
      ...(optionsRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    ]
    if (options.length === 0) return
    event.preventDefault()
    const activeIndex = options.indexOf(document.activeElement as HTMLElement)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const startingIndex = activeIndex === -1 ? (direction > 0 ? -1 : 0) : activeIndex
    options[(startingIndex + direction + options.length) % options.length]?.focus()
  }

  const renderOption = (entry: FontCatalogueEntry): ReactNode => {
    const selected = value !== undefined && value === entry.stack
    return (
      <button
        key={entry.id}
        type="button"
        role="option"
        aria-selected={selected}
        aria-description={selected ? t('mindmap.topicStyle.selected') : undefined}
        className={selected ? 'is-active' : ''}
        onClick={() => commit(entry.stack)}
        style={{ fontFamily: entry.stack }}
      >
        {labelOf(entry)}
      </button>
    )
  }

  return (
    <div ref={rootRef} className="mindmap-topic-shape-picker" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="mindmap-topic-shape-picker__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${ariaLabel} ${currentLabel}`}
        onClick={() => {
          setQuery('')
          setOpen((previous) => !previous)
        }}
      >
        <span className="mindmap-topic-shape-picker__value" style={{ fontFamily: value || undefined }}>
          {currentLabel}
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id="mindmap-font-picker-options"
          className="mindmap-topic-shape-picker__popover"
          role="dialog"
          aria-label={ariaLabel}
        >
          <label className="mindmap-topic-shape-picker__search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchLabel}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          {!hasResults ? (
            <p className="mindmap-topic-shape-picker__empty" role="status">
              {noResultsLabel}
            </p>
          ) : (
            <div
              ref={optionsRef}
              className="mindmap-font-picker__options"
              role="listbox"
              aria-label={ariaLabel}
              style={FONT_PICKER_OPTIONS_STYLE}
            >
              {showClearItem && value !== undefined && value !== '' ? (
                <div
                  className="mindmap-topic-shape-picker__category"
                  style={FONT_GROUP_CATEGORY_STYLE}
                >
                  <button
                    type="button"
                    role="option"
                    onClick={() => commit(undefined)}
                  >
                    {clearLabel}
                  </button>
                </div>
              ) : null}
              {systemShown ? (
                <div
                  className="mindmap-topic-shape-picker__category"
                  style={FONT_GROUP_CATEGORY_STYLE}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={systemSelected}
                    aria-description={systemSelected ? t('mindmap.topicStyle.selected') : undefined}
                    className={systemSelected ? 'is-active' : ''}
                    onClick={() => commit('')}
                  >
                    {systemLabel}
                  </button>
                </div>
              ) : null}
              {recentEntries.length > 0 ? (
                <div className="mindmap-font-picker__group">
                  <span className="mindmap-topic-shape-picker__category-label">
                    {recentLabel}
                  </span>
                  <div
                    className="mindmap-topic-shape-picker__category"
                    style={FONT_GROUP_CATEGORY_STYLE}
                  >
                    {recentEntries.map(renderOption)}
                  </div>
                </div>
              ) : null}
              {allEntries.length > 0 ? (
                <div className="mindmap-font-picker__group">
                  <span className="mindmap-topic-shape-picker__category-label">
                    {allLabel}
                  </span>
                  <div
                    className="mindmap-topic-shape-picker__category"
                    style={FONT_GROUP_CATEGORY_STYLE}
                  >
                    {allEntries.map(renderOption)}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
