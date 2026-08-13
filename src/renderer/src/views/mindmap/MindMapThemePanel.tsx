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

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const DEFAULT_BACKGROUND = '#FFFFFF'
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

  const commitHexDraft = (field: 'background' | 'lineColor'): void => {
    const draft = field === 'background' ? backgroundDraft : lineColorDraft
    if (HEX_COLOR_PATTERN.test(draft)) {
      applyThemeField({ [field]: draft.toUpperCase() })
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
            value={background === 'transparent' ? DEFAULT_BACKGROUND : background}
            onChange={(event) => applyThemeField({ background: event.currentTarget.value.toUpperCase() })}
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
                onClick={() => applyThemeField({ background: preset.value })}
                style={preset.value === 'transparent' ? undefined : { background: preset.value }}
              >
                {preset.value === 'transparent' ? <X size={11} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
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
