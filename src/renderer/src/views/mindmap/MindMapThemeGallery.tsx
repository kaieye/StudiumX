import { useTranslation } from 'react-i18next'
import type { MindMapTheme } from '../../../../shared/mindmap/domain/types'
import { BUILT_IN_THEMES } from '../../../../shared/mindmap/themes/built-in-themes'
import { COLOR_SCHEMES } from '../../../../shared/mindmap/themes/color-schemes'
import { useMindMapViewStore } from './mind-map-view-store'

/**
 * Theme gallery with Xmind-derived built-in themes and color scheme selector.
 *
 * Renders a 96×64 mini SVG preview for each theme showing a center node and
 * 4 branch nodes with the theme's real colors. Applies the selected theme via
 * the `document.apply-theme` command (undoable).
 */

/** Render a 96×64 SVG thumbnail for a theme. */
function renderThemeThumb(theme: MindMapTheme): React.ReactNode {
  const bg = theme.background && theme.background !== 'transparent'
    ? theme.background
    : '#FFFFFF'
  const centerFill = theme.topicStyles?.central?.fill ?? '#333333'
  const centerText = theme.topicStyles?.central?.textColor ?? '#FFFFFF'
  const subFill = theme.topicStyles?.sub?.fill ?? '#F8F7F7'
  const colors = theme.branchColors ?? COLOR_SCHEMES[0]!.colors

  return (
    <svg
      width="96"
      height="64"
      viewBox="0 0 96 64"
      className="mindmap-theme-gallery__thumb"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="96" height="64" fill={bg} rx="6" />
      {/* Center node */}
      <rect x="8" y="24" width="28" height="16" rx="4" fill={centerFill} />
      {/* Branch nodes */}
      {colors.slice(0, 4).map((color, i) => {
        const x = 46
        const y = 6 + i * 14
        return (
          <g key={i}>
            <path
              d={`M 36 32 C 42 32, 42 ${y + 6}, ${x} ${y + 6}`}
              fill="none"
              stroke={color}
              strokeWidth={i === 0 ? 2.5 : 1.5}
            />
            <rect x={x} y={y} width="42" height="12" rx="3" fill={subFill} stroke={color} strokeWidth="0.8" />
          </g>
        )
      })}
      {/* Center text indicator */}
      <text x="22" y="35" textAnchor="middle" fill={centerText} fontSize="7" fontWeight="600">A</text>
    </svg>
  )
}


export function MindMapThemeGallery() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)

  if (!current) return null

  const applyTheme = (theme: MindMapTheme): void => {
    // Preserve the current color scheme unless the theme specifies one.
    const merged: MindMapTheme = {
      ...theme,
      branchColors: current.theme.branchColors ?? theme.branchColors,
      colorSchemeId: current.theme.colorSchemeId ?? theme.colorSchemeId
    }
    dispatchCommand(
      { type: 'document.apply-theme', theme: merged },
      { label: 'Apply mind map theme' }
    )
  }

  const applyColorScheme = (schemeId: string, colors: readonly string[]): void => {
    const merged: MindMapTheme = {
      ...current.theme,
      branchColors: [...colors],
      colorSchemeId: schemeId
    }
    dispatchCommand(
      { type: 'document.apply-theme', theme: merged },
      { label: 'Apply color scheme' }
    )
  }

  return (
    <section className="mindmap-theme-gallery mm-section" aria-labelledby="mindmap-theme-gallery-title">
      {/* Xmind's canvas tab leads with the colour scheme, themes follow. */}
      <div className="mm-section__head">
        <strong>{t('mindmap.colorSchemeTitle', 'Color Scheme')}</strong>
      </div>
      <div className="mindmap-theme-gallery__scheme-row">
        {COLOR_SCHEMES.map((scheme) => (
          <button
            key={scheme.id}
            type="button"
            className={`mindmap-theme-gallery__scheme${current.theme.colorSchemeId === scheme.id ? ' is-active' : ''}`}
            onClick={() => applyColorScheme(scheme.id, scheme.colors)}
            title={t(`mindmap.colorScheme.${scheme.nameKey}`, scheme.id)}
          >
            <span className="mindmap-theme-gallery__scheme-strip">
              {scheme.colors.map((color, i) => (
                <span
                  key={i}
                  className="mindmap-theme-gallery__scheme-dot"
                  style={{ background: color }}
                />
              ))}
            </span>
          </button>
        ))}
      </div>

      <div className="mm-section__head">
        <strong id="mindmap-theme-gallery-title">{t('mindmap.themeGallery.title')}</strong>
      </div>
      <div className="mindmap-theme-gallery__grid">
        {BUILT_IN_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={`mindmap-theme-gallery__preset${current.theme.id === theme.id ? ' is-active' : ''}`}
            onClick={() => applyTheme(theme)}
            title={t(`mindmap.themeGallery.${theme.id}`, theme.name ?? theme.id)}
          >
            {renderThemeThumb(theme)}
            <span className="mindmap-theme-gallery__name">
              {t(`mindmap.themeGallery.${theme.id}`, theme.name ?? theme.id)}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
