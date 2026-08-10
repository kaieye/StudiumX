import { Copy, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_MIND_MAP_THEME,
  type MindMapTheme
} from '../../../../shared/mindmap/domain/types'
import { useMindMapViewStore } from './mind-map-view-store'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Small document-theme surface for the v2 model.
 *
 * Copy is an explicit local clipboard action (the theme contains no secrets),
 * while reset is a normal `document.apply-theme` command so it participates in
 * the existing undo/redo and revisioned persistence path.
 */
export function MindMapThemePanel() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const [copyState, setCopyState] = useState<CopyState>('idle')

  if (!current) return null

  const themeName = current.theme.name || current.theme.id
  const isDefaultTheme = themesEqual(current.theme, DEFAULT_MIND_MAP_THEME)

  const copyTheme = async (): Promise<void> => {
    const payload = JSON.stringify(current.theme, null, 2)
    try {
      await writeClipboardText(payload)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const resetTheme = (): void => {
    if (isDefaultTheme) return
    setCopyState('idle')
    dispatchCommand(
      { type: 'document.apply-theme', theme: DEFAULT_MIND_MAP_THEME },
      { label: 'Reset mind map theme' }
    )
  }

  return (
    <section className="mindmap-theme-panel" aria-labelledby="mindmap-theme-panel-title">
      <div className="mindmap-theme-panel__head">
        <strong id="mindmap-theme-panel-title">{t('mindmap.themePanel.title')}</strong>
        <span title={themeName}>{themeName}</span>
      </div>
      <div className="mindmap-theme-panel__body">
        <code>{current.theme.id}</code>
        <div className="mindmap-theme-panel__actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => void copyTheme()}
            title={t('mindmap.themePanel.copy')}
          >
            <Copy size={13} aria-hidden="true" />
            {copyState === 'copied'
              ? t('mindmap.themePanel.copied')
              : copyState === 'failed'
                ? t('mindmap.themePanel.copyFailed')
                : t('mindmap.themePanel.copy')}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={isDefaultTheme}
            onClick={resetTheme}
            title={t('mindmap.themePanel.reset')}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {t('mindmap.themePanel.reset')}
          </button>
        </div>
        <span className="mindmap-theme-panel__status" aria-live="polite">
          {copyState === 'copied'
            ? t('mindmap.themePanel.copiedStatus')
            : copyState === 'failed'
              ? t('mindmap.themePanel.copyFailedStatus')
              : isDefaultTheme
                ? t('mindmap.themePanel.defaultStatus')
                : t('mindmap.themePanel.customStatus')}
        </span>
      </div>
    </section>
  )
}

function themesEqual(left: MindMapTheme, right: MindMapTheme): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function writeClipboardText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // Fall through to the local DOM copy path below.
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard copy was denied')
  } finally {
    document.body.removeChild(textarea)
  }
}
