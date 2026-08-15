import { ChevronDown, RotateCcw, Search, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
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
const RECENT_LINE_COLORS_KEY = 'mindmap.recentLineColors'
const MAX_RECENT_COLORS = 8
/**
 * Compact two-row Morandi palette for document backgrounds and branch-line colors.
 *
 * The swatches intentionally mix warm and cool, low-saturation neutrals
 * instead of presenting a long, rainbow-ordered catalogue.
 */
const BACKGROUND_COLOR_PRESETS = [
  '#FFFFFF',
  '#D9CEC2',
  '#A6B8A4',
  '#C6B5A7',
  '#B5C9C7',
  '#B49A8F',
  '#D3CDD9',
  '#9E8F84',
  '#98B0AF',
  '#E8E2D8',
  '#BBC9B7',
  '#A9857C',
  '#D0DDDC',
  '#B9B0C4',
  '#8FA693',
  '#7F9A9A',
  '#9A8DA6',
  '#7F7488'
] as const

function expandHexDigits(digits: string): string {
  return digits.length === 3
    ? digits.split('').map((part) => `${part}${part}`).join('')
    : digits
}

/** The native color well needs an opaque 6-digit value; strip any alpha. */
function hexColorWellValue(color: string): string {
  const match = HEX_COLOR_PATTERN.exec(color)
  if (!match) return DEFAULT_BACKGROUND
  return `#${expandHexDigits(match[1]!).slice(0, 6).toLowerCase()}`
}

/** Current alpha of a hex color as a percentage; defaults to 100%. */
function colorAlphaPercent(color: string): number {
  const match = HEX_COLOR_PATTERN.exec(color)
  if (!match) return 100
  const digits = expandHexDigits(match[1]!)
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
  return Math.round(alpha * 100)
}

/** Rewrite a hex color as 8-digit #RRGGBBAA with the given percentage alpha. */
function colorWithAlpha(color: string, percent: number): string | null {
  const match = HEX_COLOR_PATTERN.exec(color)
  if (!match) return null
  const digits = expandHexDigits(match[1]!).slice(0, 6).toUpperCase()
  const alpha = Math.max(0, Math.min(255, Math.round((percent / 100) * 255)))
  return `#${digits}${alpha.toString(16).padStart(2, '0').toUpperCase()}`
}

function normalizeRecentColor(value: string): string | null {
  if (!HEX_COLOR_PATTERN.test(value)) return null
  const digits = expandHexDigits(HEX_COLOR_PATTERN.exec(value)![1]!)
  const rgb = digits.slice(0, 6).toUpperCase()
  const alpha = digits.length === 8 ? digits.slice(6, 8).toUpperCase() : 'FF'
  // Collapse fully-opaque colors to the familiar 6-digit form; keep any real
  // transparency so opacity-adjusted swatches stay visually distinct.
  return alpha === 'FF' ? `#${rgb}` : `#${rgb}${alpha}`
}

function loadRecentColors(storageKey: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const colors = parsed
      .map((value) => typeof value === 'string' ? normalizeRecentColor(value) : null)
      .filter((value): value is string => value !== null)
    return [...new Set(colors)].slice(0, MAX_RECENT_COLORS)
  } catch {
    return []
  }
}

function recordRecentColor(colors: readonly string[], value: string): string[] {
  const normalized = normalizeRecentColor(value)
  if (!normalized) return [...colors]
  return [
    normalized,
    ...colors.filter((color) => color !== normalized)
  ].slice(0, MAX_RECENT_COLORS)
}

function persistRecentColors(storageKey: string, colors: readonly string[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(colors))
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
        <MindMapThemeColorPicker
          color={background}
          onChange={(value) => applyThemeField({ background: value })}
          label={t('mindmap.themePanel.backgroundColor')}
          recentStorageKey={RECENT_BACKGROUND_COLORS_KEY}
          nativeInputId="mindmap-theme-background-native"
          alphaInputId="mindmap-theme-background-alpha"
          alphaLabel={t('mindmap.themePanel.alphaLabel')}
          alphaInputLabel={t('mindmap.themePanel.alphaInputLabel')}
          alphaUnavailableLabel={t('mindmap.themePanel.alphaUnavailable')}
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

      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.themePanel.lineColor')}</span>
        <MindMapThemeColorPicker
          color={lineColor}
          onChange={(value) => applyThemeField({ lineColor: value })}
          label={t('mindmap.themePanel.lineColor')}
          recentStorageKey={RECENT_LINE_COLORS_KEY}
          nativeInputId="mindmap-theme-line-color-native"
          alphaInputId="mindmap-theme-line-color-alpha"
          alphaLabel={t('mindmap.themePanel.lineColorAlphaLabel')}
          alphaInputLabel={t('mindmap.themePanel.lineColorAlphaInputLabel')}
          alphaUnavailableLabel={t('mindmap.themePanel.lineColorAlphaUnavailable')}
          hexInputLabel={t('mindmap.themePanel.lineColorHex')}
        />
      </div>

    </section>
  )
}

function themesEqual(left: MindMapTheme, right: MindMapTheme): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Shared document-theme color control. A rounded rectangular swatch opens the
 * same portaled palette, native color well, opacity slider, and recent-color
 * section for both the canvas background and the unified branch-line color.
 */
function MindMapThemeColorPicker({
  color,
  onChange,
  label,
  recentStorageKey,
  nativeInputId,
  alphaInputId,
  alphaLabel,
  alphaInputLabel,
  alphaUnavailableLabel,
  hexInputLabel
}: {
  color: string
  onChange: (value: string) => void
  label: string
  recentStorageKey: string
  nativeInputId: string
  alphaInputId: string
  alphaLabel: string
  alphaInputLabel: string
  alphaUnavailableLabel: string
  hexInputLabel?: string
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const nativeColorDraftRef = useRef<string | null>(null)
  const committedHexRef = useRef<string | null>(null)
  const [open, setOpen] = useState(false)
  const [hexDraft, setHexDraft] = useState(color)
  const [recentColors, setRecentColors] = useState<string[]>(() => loadRecentColors(recentStorageKey))
  // The popover is portaled to `document.body` so it can overlay the mind-map
  // canvas instead of being clipped by the inspector's scroll container
  // (`mindmap-inspector-tab-content` has `overflow-y: auto`; `mindmap-ai-panel`
  // has `overflow: hidden`). It is positioned with `position: fixed` relative
  // to the swatch trigger and clamped to the viewport.
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null)

  useEffect(() => setHexDraft(color), [color])

  const positionPopover = useCallback((): void => {
    const popover = popoverRef.current
    const trigger = triggerRef.current
    if (!popover || !trigger) return
    // Measure the rendered popover so viewport clamping uses its true size.
    const { width, height } = popover.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const viewportPadding = 8
    const gap = 6
    // Align the popover's right edge with the swatch's right edge, mirroring
    // the old `right: 0` alignment.
    let left = triggerRect.right - width
    let top = triggerRect.bottom + gap
    // Prefer opening downward; flip above the trigger when it would otherwise
    // overflow the bottom of the viewport.
    if (top + height > window.innerHeight - viewportPadding) {
      top = triggerRect.top - height - gap
    }
    top = Math.max(viewportPadding, top)
    left = Math.min(
      Math.max(left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    )
    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      right: 'auto',
      zIndex: 1000
    })
  }, [])

  // Position the portaled popover and keep it glued to the swatch while open
  // (the inspector scrolls and the window can be resized).
  useLayoutEffect(() => {
    if (!open) return
    positionPopover()
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return
      positionPopover()
    }
    window.addEventListener('resize', positionPopover)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', positionPopover)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open, positionPopover])

  // Reload the recent list from storage each time the popover opens. The
  // picker stays mounted across open/close, and a reorder persisted for the
  // next session (recent-swatch switch) should only take effect on the next
  // open, never reshuffling the list while it is open.
  useEffect(() => {
    if (open) setRecentColors(loadRecentColors(recentStorageKey))
  }, [open, recentStorageKey])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const swatchStyle: CSSProperties = color === 'transparent'
    ? {
        backgroundImage: 'linear-gradient(135deg, transparent 45%, #dc2626 46%, #dc2626 54%, transparent 55%)',
        backgroundColor: '#ffffff'
      }
    : { background: color }
  // Normalized form of the current color, used to highlight the matching
  // swatch (preset or recent). Unlike the raw 6-digit form, it also matches an
  // opacity-adjusted 8-digit recent color as selected.
  const selectedColor = normalizeRecentColor(color)
  const alphaPercent = colorAlphaPercent(color)
  const alphaUnavailable = color === 'transparent'

  const rememberRecentColor = (value: string): void => {
    // Base the update on the persisted list (not the possibly-stale visible
    // state) so a recent-swatch reorder persisted for the next open is not
    // clobbered by a later commit in the same session.
    const next = recordRecentColor(loadRecentColors(recentStorageKey), value)
    persistRecentColors(recentStorageKey, next)
    setRecentColors(next)
  }

  const commitColor = (value: string): void => {
    onChange(value)
    rememberRecentColor(value)
  }

  const selectRecentColor = (value: string): void => {
    onChange(value)
    // Switching among recent swatches should not reshuffle the visible list
    // while the popover stays open; persist the reorder so the next open shows
    // this swatch at the front.
    persistRecentColors(recentStorageKey, recordRecentColor(recentColors, value))
  }

  const previewNativeColor = (value: string): void => {
    const normalized = value.toUpperCase()
    nativeColorDraftRef.current = normalized
    onChange(normalized)
  }

  const commitNativeColor = (value: string): void => {
    const normalized = value.toUpperCase()
    const pending = nativeColorDraftRef.current
    nativeColorDraftRef.current = null
    if (pending || normalized !== hexColorWellValue(color).toUpperCase()) {
      rememberRecentColor(pending ?? normalized)
    }
  }

  const commitHexDraft = (): void => {
    if (HEX_COLOR_PATTERN.test(hexDraft)) {
      const normalized = hexDraft.toUpperCase()
      committedHexRef.current = normalized
      commitColor(normalized)
      return
    }
    setHexDraft(color)
  }

  const applyAlpha = (percent: number): void => {
    const next = colorWithAlpha(color, Math.max(0, Math.min(100, percent)))
    // Opacity is a refinement of the current color, not a new color choice.
    // Keep the recent row stable while the slider is being adjusted.
    if (next) onChange(next)
  }

  const commitAlpha = (): void => {
    // A finished opacity adjustment is a distinct color choice: once the
    // slider is released (or the input loses focus), record the resulting
    // 8-digit color as a recent swatch instead of only previewing it.
    rememberRecentColor(color)
  }

  const clearRecentColors = (): void => {
    setRecentColors([])
    try {
      window.localStorage.removeItem(recentStorageKey)
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
        aria-label={label}
        title={label}
        style={swatchStyle}
        onClick={() => setOpen((previous) => !previous)}
      />
      {open ? createPortal((
        <div
          ref={popoverRef}
          className="mindmap-theme-bg-picker__popover"
          style={popoverStyle ?? undefined}
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
              const selected = selectedColor === color
              return (
                <button
                  key={color}
                  type="button"
                  className={selected ? 'is-selected' : undefined}
                  aria-label={`${t('mindmap.themePanel.presetColor')} ${color}`}
                  aria-pressed={selected}
                  title={color}
                  style={{ background: color }}
                  onClick={() => commitColor(color)}
                />
              )
            })}
          </div>
          <div className="mindmap-theme-bg-picker__controls">
            <div className="mindmap-theme-bg-picker__row">
              <label className="mm-row__label" htmlFor={nativeInputId}>
                {label}
              </label>
              <span className="mindmap-theme-bg-picker__row-controls">
                <input
                  id={nativeInputId}
                  type="color"
                  aria-label={label}
                  value={hexColorWellValue(color)}
                  onChange={(event) => previewNativeColor(event.currentTarget.value)}
                  onBlur={(event) => commitNativeColor(event.currentTarget.value)}
                />
                {hexInputLabel ? (
                  <input
                    className="mindmap-theme-color-editor__hex"
                    aria-label={hexInputLabel}
                    value={hexDraft}
                    onChange={(event) => setHexDraft(event.currentTarget.value)}
                    onBlur={() => {
                      const normalized = HEX_COLOR_PATTERN.test(hexDraft)
                        ? hexDraft.toUpperCase()
                        : null
                      if (normalized && committedHexRef.current === normalized) {
                        committedHexRef.current = null
                        setHexDraft(normalized)
                        return
                      }
                      committedHexRef.current = null
                      commitHexDraft()
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      commitHexDraft()
                      event.currentTarget.blur()
                    }}
                    spellCheck={false}
                  />
                ) : null}
              </span>
            </div>
            <div className="mindmap-theme-bg-picker__alpha">
              <label className="mindmap-theme-bg-picker__alpha-label" htmlFor={alphaInputId}>
                {t('mindmap.themePanel.alpha')}
              </label>
              <span className="mindmap-theme-alpha-row__control">
                <input
                  id={alphaInputId}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={alphaUnavailable}
                  aria-label={alphaLabel}
                  aria-description={alphaUnavailable
                    ? alphaUnavailableLabel
                    : undefined}
                  title={alphaLabel}
                  value={alphaPercent}
                  style={{
                    background: `linear-gradient(to right, var(--accent, #438eff) 0 ${alphaPercent}%, color-mix(in srgb, var(--text) 14%, transparent) ${alphaPercent}% 100%)`
                  }}
                  onChange={(event) => applyAlpha(Number(event.currentTarget.value))}
                  onPointerUp={commitAlpha}
                  onBlur={commitAlpha}
                />
                <label
                  className="mindmap-theme-alpha-row__value"
                  aria-label={alphaInputLabel}
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    disabled={alphaUnavailable}
                    aria-label={alphaInputLabel}
                    value={alphaPercent}
                    onChange={(event) => {
                      if (!Number.isNaN(event.currentTarget.valueAsNumber)) {
                        applyAlpha(event.currentTarget.valueAsNumber)
                      }
                    }}
                    onBlur={commitAlpha}
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
                  const selected = selectedColor === color
                  return (
                    <button
                      key={color}
                      type="button"
                      className={selected ? 'is-selected' : undefined}
                      aria-label={`${t('mindmap.themePanel.recentColorLabel')} ${color}`}
                      aria-pressed={selected}
                      title={color}
                      style={{ background: color }}
                      onClick={() => selectRecentColor(color)}
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
      ), document.body) : null}
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
  noResultsLabel = 'No fonts found.'
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
