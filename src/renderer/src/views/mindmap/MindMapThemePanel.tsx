import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_MIND_MAP_THEME,
  type MindMapTheme
} from '../../../../shared/mindmap/domain/types'
import { useMindMapViewStore } from './mind-map-view-store'

/**
 * Document-theme rows for the inspector's canvas tab (plan v2 §3 G19).
 *
 * Xmind-style row layout: label on the left, control on the right. Every
 * change goes through `document.apply-theme` so it participates in the
 * existing undo/redo and revisioned persistence path.
 */
export function MindMapThemePanel() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)

  if (!current) return null

  const isDefaultTheme = themesEqual(current.theme, DEFAULT_MIND_MAP_THEME)

  const resetTheme = (): void => {
    if (isDefaultTheme) return
    dispatchCommand(
      { type: 'document.apply-theme', theme: DEFAULT_MIND_MAP_THEME },
      { label: 'Reset mind map theme' }
    )
  }

  /** Apply a single theme field via document.apply-theme (undoable). */
  const applyThemeField = (patch: Partial<MindMapTheme>): void => {
    const merged: MindMapTheme = { ...current.theme, ...patch }
    dispatchCommand(
      { type: 'document.apply-theme', theme: merged },
      { label: 'Update mind map theme' }
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
        <label className="mm-row__label" htmlFor="mindmap-theme-background">
          {t('mindmap.themePanel.backgroundColor')}
        </label>
        <input
          id="mindmap-theme-background"
          type="color"
          className="mm-color-well"
          value={current.theme.background ?? '#FFFFFF'}
          onChange={(event) => applyThemeField({ background: event.currentTarget.value })}
        />
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
          <option value="">{t('mindmap.themePanel.systemFont')}</option>
          <option value={'ui-serif, Georgia, "Times New Roman", serif'}>Serif</option>
          <option value="ui-monospace, SFMono-Regular, Menlo, monospace">Monospace</option>
        </select>
      </div>

      <label className="mm-row mm-row--switch">
        <span className="mm-row__label">{t('mindmap.themePanel.rainbowBranches')}</span>
        <span className="mm-switch">
          <input
            type="checkbox"
            checked={current.theme.rainbowBranches !== false}
            onChange={(event) => applyThemeField({ rainbowBranches: event.currentTarget.checked })}
          />
          <span className="mm-switch__track" aria-hidden="true" />
        </span>
      </label>
    </section>
  )
}

function themesEqual(left: MindMapTheme, right: MindMapTheme): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
