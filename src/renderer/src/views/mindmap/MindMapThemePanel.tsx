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
  MindMapFontPickerProps,
  SAFE_FONTS
} from './mind-map-font-list'
import { useMindMapViewStore } from './mind-map-view-store'

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const DEFAULT_BACKGROUND = '#FFFFFF'
const DEFAULT_LINE_COLOR = '#8E8E93'
const RECENT_BACKGROUND_COLORS_KEY = 'mindmap.recentBackgroundColors'
const MAX_RECENT_BACKGROUND_COLORS = 8
const BACKGROUND_COLOR_PRESETS = [
  '#FFFFFF',
  '#F3F4F6',
  '#D1D5DB',
  '#9CA3AF',
  '#6B7280',
  '#4B5563',
  '#374151',
  '#1F2937',
  '#111827',
  '#FDE047',
  '#FCA5A5',
  '#86EFAC',
  '#5EEAD4',
  '#7DD3FC',
  '#60A5FA',
  '#818CF8',
  '#C084FC',
  '#F0ABFC',
  '#FBBF24',
  '#F87171',
  '#4ADE80',
  '#2DD4BF',
  '#38BDF8',
  '#0EA5E9',
  '#6366F1',
  '#A855F7',
  '#E879F9',
  '#F59E0B',
  '#F97316',
  '#22C55E',
  '#14B8A6',
  '#06B6D4',
  '#0284C7',
  '#4F46E5',
  '#9333EA',
  '#DB2777',
  '#EA580C',
  '#DC2626',
  '#16A34A',
  '#0F766E',
  '#0E7490',
  '#0369A1',
  '#3730A3',
  '#6B21A8',
  '#9D174D'
] as const

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

function normalizeRecentBackgroundColor(value: string): string | null {
  if (!HEX_COLOR_PATTERN.test(value)) return null
  return hexColorWellValue(value).toUpperCase()
}

function loadRecentBackgroundColors(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_BACKGROUND_COLORS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const colors = parsed
      .map((value) => typeof value === 'string' ? normalizeRecentBackgroundColor(value) : null)
      .filter((value): value is string => value !== null)
    return [...new Set(colors)].slice(0, MAX_RECENT_BACKGROUND_COLORS)
  } catch {
    return []
  }
}

function recordRecentBackgroundColor(colors: readonly string[], value: string): string[] {
  const normalized = normalizeRecentBackgroundColor(value)
  if (!normalized) return [...colors]
  return [
    normalized,
    ...colors.filter((color) => color !== normalized)
  ].slice(0, MAX_RECENT_BACKGROUND_COLORS)
}

function persistRecentBackgroundColors(colors: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENT_BACKGROUND_COLORS_KEY, JSON.stringify(colors))
  } catch {
    // localStorage may be unavailable; keep the in-memory list usable.
  }
}

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
  const [lineColorDraft, setLineColorDraft] = useState(lineColor)

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

  const commitLineColorDraft = (): void => {
    if (HEX_COLOR_PATTERN.test(lineColorDraft)) {
      applyThemeField({ lineColor: lineColorDraft.toUpperCase() })
      return
    }
    setLineColorDraft(lineColor)
  }

  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commitLineColorDraft()
    event.currentTarget.blur()
  }

  return (
    <section className="mindmap-theme-panel mm-section" aria-labelledby="mindmap-theme-panel-title">
      <div className="mm-section__head">
        <strong id="mindmap-theme-panel-title">{t('mindmap.themePanel.title')}</strong>
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

      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.themePanel.backgroundColor')}</span>
        <MindMapBackgroundPicker
          background={background}
          onChange={(value) => applyThemeField({ background: value })}
        />
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
              onBlur={commitLineColorDraft}
              onKeyDown={commitOnEnter}
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

/**
 * Compact background-color control: a rounded rectangular swatch opens a
 * preset palette, native color well and opacity slider. The swatch always
 * reflects the current background (including alpha).
 */
function MindMapBackgroundPicker({
  background,
  onChange
}: {
  background: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [recentColors, setRecentColors] = useState<string[]>(loadRecentBackgroundColors)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const label = t('mindmap.themePanel.backgroundColor')
  const swatchStyle: CSSProperties = background === 'transparent'
    ? {
        backgroundImage: 'linear-gradient(135deg, transparent 45%, #dc2626 46%, #dc2626 54%, transparent 55%)',
        backgroundColor: '#ffffff'
      }
    : { background: background }
  const selectedPreset = background === 'transparent' || backgroundAlphaPercent(background) !== 100
    ? null
    : hexColorWellValue(background).toUpperCase()
  const alphaPercent = backgroundAlphaPercent(background)
  const alphaUnavailable = background === 'transparent'

  const commitBackground = (value: string): void => {
    onChange(value)
    setRecentColors((previous) => {
      const next = recordRecentBackgroundColor(previous, value)
      if (next.length === previous.length && next.every((color, index) => color === previous[index])) {
        return previous
      }
      persistRecentBackgroundColors(next)
      return next
    })
  }

  const applyAlpha = (percent: number): void => {
    const next = backgroundWithAlpha(background, Math.max(0, Math.min(100, percent)))
    if (next) commitBackground(next)
  }

  const clearRecentColors = (): void => {
    setRecentColors([])
    try {
      window.localStorage.removeItem(RECENT_BACKGROUND_COLORS_KEY)
    } catch {
      // The visible list is already cleared when localStorage is unavailable.
    }
  }

  return (
    <div ref={rootRef} className="mindmap-theme-bg-picker">
      <button
        ref={triggerRef}
        type="button"
        className="mindmap-theme-bg-picker__swatch"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('mindmap.themePanel.backgroundColor')}
        title={t('mindmap.themePanel.backgroundColor')}
        style={swatchStyle}
        onClick={() => setOpen((previous) => !previous)}
      />
      {open ? (
        <div
          className="mindmap-theme-bg-picker__popover"
          role="dialog"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              triggerRef.current?.focus()
            }
          }}
        >
          <div
            className="mindmap-theme-bg-picker__presets"
            role="group"
            aria-label={t('mindmap.themePanel.presetColors')}
          >
            {BACKGROUND_COLOR_PRESETS.map((color) => {
              const selected = selectedPreset === color
              return (
                <button
                  key={color}
                  type="button"
                  className={selected ? 'is-selected' : undefined}
                  aria-label={`${t('mindmap.themePanel.presetColor')} ${color}`}
                  aria-pressed={selected}
                  title={color}
                  style={{ backgroundColor: color }}
                  onClick={() => commitBackground(color)}
                />
              )
            })}
          </div>
          <div className="mindmap-theme-bg-picker__controls">
            <div className="mindmap-theme-bg-picker__row">
              <label className="mm-row__label" htmlFor="mindmap-theme-background-native">
                {t('mindmap.themePanel.backgroundColor')}
              </label>
              <input
                id="mindmap-theme-background-native"
                type="color"
                aria-label={t('mindmap.themePanel.backgroundColor')}
                value={hexColorWellValue(background)}
                onChange={(event) => commitBackground(event.currentTarget.value.toUpperCase())}
              />
            </div>
            <div className="mindmap-theme-bg-picker__alpha">
              <label className="mindmap-theme-bg-picker__alpha-label" htmlFor="mindmap-theme-background-alpha">
                {t('mindmap.themePanel.alpha')}
              </label>
              <span className="mindmap-theme-alpha-row__control">
                <input
                  id="mindmap-theme-background-alpha"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={alphaUnavailable}
                  aria-label={t('mindmap.themePanel.alphaLabel')}
                  aria-description={alphaUnavailable
                    ? t('mindmap.themePanel.alphaUnavailable')
                    : undefined}
                  title={t('mindmap.themePanel.alphaLabel')}
                  value={alphaPercent}
                  style={{
                    background: `linear-gradient(to right, var(--accent, #438eff) 0 ${alphaPercent}%, color-mix(in srgb, var(--text) 14%, transparent) ${alphaPercent}% 100%)`
                  }}
                  onChange={(event) => applyAlpha(Number(event.currentTarget.value))}
                />
                <label
                  className="mindmap-theme-alpha-row__value"
                  aria-label={t('mindmap.themePanel.alphaInputLabel')}
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    disabled={alphaUnavailable}
                    aria-label={t('mindmap.themePanel.alphaInputLabel')}
                    value={alphaPercent}
                    onChange={(event) => {
                      if (!Number.isNaN(event.currentTarget.valueAsNumber)) {
                        applyAlpha(event.currentTarget.valueAsNumber)
                      }
                    }}
                  />
                  <span aria-hidden="true">%</span>
                </label>
              </span>
            </div>
          </div>
          <div className="mindmap-theme-bg-picker__recent">
            <div className="mindmap-theme-bg-picker__recent-head">
              <span>{t('mindmap.themePanel.recentColors')}</span>
              {recentColors.length > 0 ? (
                <button
                  type="button"
                  className="mindmap-theme-bg-picker__recent-clear"
                  aria-label={t('mindmap.themePanel.clearRecent')}
                  title={t('mindmap.themePanel.clearRecent')}
                  onClick={clearRecentColors}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {recentColors.length > 0 ? (
              <div
                className="mindmap-theme-bg-picker__recent-colors"
                role="group"
                aria-label={t('mindmap.themePanel.recentColors')}
              >
                {recentColors.map((color) => {
                  const selected = selectedPreset === color
                  return (
                    <button
                      key={color}
                      type="button"
                      className={selected ? 'is-selected' : undefined}
                      aria-label={`${t('mindmap.themePanel.recentColorLabel')} ${color}`}
                      aria-pressed={selected}
                      title={color}
                      style={{ backgroundColor: color }}
                      onClick={() => commitBackground(color)}
                    />
                  )
                })}
              </div>
            ) : (
              <span className="mindmap-theme-bg-picker__recent-empty">
                {t('mindmap.themePanel.noRecentColors')}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
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
  allLabel = 'All fonts'
}: MindMapFontPickerProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

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
    onSelect(stack)
    closeAndRestoreFocus()
  }

  const allEntries = matching

  const systemShown = Boolean(
    systemLabel &&
    (normalizedQuery === '' || systemLabel.toLocaleLowerCase().includes(normalizedQuery))
  )
  const systemSelected = systemShown && (value === undefined || value === '')
  const hasResults = systemShown || allEntries.length > 0

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
              {systemShown || allEntries.length > 0 ? (
                <div className="mindmap-font-picker__group">
                  <span className="mindmap-topic-shape-picker__category-label">
                    {allLabel}
                  </span>
                  <div
                    className="mindmap-topic-shape-picker__category"
                    style={FONT_GROUP_CATEGORY_STYLE}
                  >
                    {systemShown ? (
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
                    ) : null}
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
