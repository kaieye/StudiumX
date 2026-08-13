import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_MIND_MAP_THEME,
  type MindMapTheme
} from '../../../../shared/mindmap/domain/types'
import { COLOR_SCHEMES, getColorScheme } from '../../../../shared/mindmap/themes/color-schemes'
import { isManagedMindMapFontFamily } from './mind-map-font-provenance'
import {
  findMindMapThemeReadabilityIssues,
  formatMindMapContrastRatio
} from './mind-map-theme-readability'
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
const LIGHT_THEME_ENVIRONMENT = {
  surfaceColor: '#FFFFFF',
  textColor: '#24324A',
  subtopicFillColor: '#F8F7F7'
} as const
const DARK_THEME_ENVIRONMENT = {
  surfaceColor: '#18181B',
  textColor: '#F2F2F3',
  subtopicFillColor: '#29292C'
} as const

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

const FONT_OPTIONS = [
  { value: '', labelKey: 'systemFont' },
  { value: 'Inter, system-ui, sans-serif', labelKey: 'sansFont' },
  {
    value: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    labelKey: 'cjkSansFont'
  },
  {
    value: '"Noto Serif CJK SC", "Songti SC", SimSun, serif',
    labelKey: 'cjkSerifFont'
  },
  {
    value: 'ui-serif, Georgia, "Times New Roman", serif',
    labelKey: 'serifFont'
  },
  {
    value: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    labelKey: 'monoFont'
  }
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
  const branchColors = current.theme.branchColors ?? getColorScheme(current.theme.colorSchemeId).colors
  const documentFont = current.theme.fontFamily ?? ''
  const hasUnlistedDocumentFont = Boolean(
    documentFont && !FONT_OPTIONS.some((option) => option.value === documentFont)
  )
  const documentFontMayFallback = Boolean(
    documentFont && !isManagedMindMapFontFamily(documentFont)
  )
  const isDarkAppearance = document.documentElement.dataset.resolvedTheme === 'dark'
  const readabilityIssues = findMindMapThemeReadabilityIssues(
    current.theme,
    isDarkAppearance ? DARK_THEME_ENVIRONMENT : LIGHT_THEME_ENVIRONMENT
  )
  const readabilityLayers = [...new Set(readabilityIssues.map((issue) => issue.layer))]

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
        <label className="mm-row__label" htmlFor="mindmap-theme-font">
          {t('mindmap.themePanel.fontFamily')}
        </label>
        <select
          id="mindmap-theme-font"
          className="mm-select"
          value={current.theme.fontFamily ?? ''}
          onChange={(event) => applyThemeField({ fontFamily: event.currentTarget.value || undefined })}
        >
          {hasUnlistedDocumentFont ? (
            <option value={documentFont}>{t('mindmap.topicStyle.importedFont', { font: documentFont })}</option>
          ) : null}
          {FONT_OPTIONS.map((option) => (
            <option key={option.labelKey} value={option.value}>
              {t(`mindmap.themePanel.${option.labelKey}`)}
            </option>
          ))}
        </select>
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

      {rainbowBranches ? (
        <div className="mm-row mm-row--stack">
          <label className="mm-row__label" htmlFor="mindmap-theme-branch-palette">
            {t('mindmap.themePanel.branchPalette')}
          </label>
          <div className="mindmap-theme-palette-row">
            <span className="mindmap-theme-palette-row__preview" aria-hidden="true">
              {branchColors.map((color, index) => (
                <span key={`${color}-${index}`} style={{ background: color }} />
              ))}
            </span>
            <select
              id="mindmap-theme-branch-palette"
              className="mm-select"
              value={COLOR_SCHEMES.some((scheme) => scheme.id === current.theme.colorSchemeId) ? current.theme.colorSchemeId : ''}
              onChange={(event) => {
                const scheme = COLOR_SCHEMES.find((candidate) => candidate.id === event.currentTarget.value)
                if (scheme) {
                  applyThemeField({ colorSchemeId: scheme.id, branchColors: [...scheme.colors] })
                }
              }}
            >
              <option value="" disabled>{t('mindmap.themePanel.customPalette')}</option>
              {COLOR_SCHEMES.map((scheme) => (
                <option key={scheme.id} value={scheme.id}>
                  {t(`mindmap.colorScheme.${scheme.nameKey}`, scheme.id)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
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
      )}

      {readabilityIssues.length > 0 ? (
        <aside
          className="mindmap-theme-readability-warning"
          role="status"
          aria-label={t('mindmap.themePanel.readabilityWarningLabel')}
        >
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            <strong>{t('mindmap.themePanel.readabilityWarningTitle')}</strong>
            <small>
              {t('mindmap.themePanel.readabilityWarningBody', {
                layers: readabilityLayers
                  .map((layer) => t(`mindmap.themePanel.readabilityLayers.${layer}`))
                  .join(', '),
                ratio: formatMindMapContrastRatio(
                  Math.min(...readabilityIssues.map((issue) => issue.contrastRatio))
                )
              })}
            </small>
          </span>
        </aside>
      ) : null}

    </section>
  )
}

function themesEqual(left: MindMapTheme, right: MindMapTheme): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
