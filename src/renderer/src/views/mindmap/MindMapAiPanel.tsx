import { Loader2, Sparkles, X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMindMapViewStore } from './mind-map-view-store'

/**
 * AI-assisted mind-map generation panel (docs/mindmap/design.md §6.5).
 *
 * Collects a topic/prompt, drives the async `generate` action, shows a live
 * streaming preview while generating, and surfaces errors with a retry affordance.
 */
export function MindMapAiPanel() {
  const { t } = useTranslation()
  const aiPrompt = useMindMapViewStore((s) => s.aiPrompt)
  const setAiPrompt = useMindMapViewStore((s) => s.setAiPrompt)
  const generating = useMindMapViewStore((s) => s.generating)
  const streamText = useMindMapViewStore((s) => s.streamText)
  const error = useMindMapViewStore((s) => s.error)
  const generate = useMindMapViewStore((s) => s.generate)

  const canSubmit = !generating && aiPrompt.trim().length > 0

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    void generate(aiPrompt)
  }

  return (
    <aside className="mindmap-ai-panel" aria-label={t('mindmap.aiTitle')}>
      <div className="mindmap-ai-panel__head">
        <Sparkles size={16} aria-hidden="true" />
        <strong>{t('mindmap.aiTitle')}</strong>
      </div>
      <form className="mindmap-ai-panel__form" onSubmit={onSubmit}>
        <label className="mindmap-ai-panel__label" htmlFor="mindmap-ai-prompt">
          {t('mindmap.aiPromptLabel')}
        </label>
        <textarea
          id="mindmap-ai-prompt"
          className="mindmap-ai-panel__input"
          value={aiPrompt}
          onChange={(event) => setAiPrompt(event.currentTarget.value)}
          placeholder={t('mindmap.aiPromptPlaceholder')}
          rows={4}
          disabled={generating}
        />
        <div className="mindmap-ai-panel__actions">
          {generating ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => useMindMapViewStore.setState({ generating: false })}
            >
              <X size={15} />
              {t('mindmap.aiCancel')}
            </button>
          ) : (
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              <Sparkles size={15} />
              {t('mindmap.aiGenerate')}
            </button>
          )}
        </div>
      </form>

      {generating ? (
        <div className="mindmap-ai-panel__stream" role="status" aria-live="polite">
          <Loader2 size={14} className="spin" aria-hidden="true" />
          <span>{t('mindmap.aiStreaming')}</span>
          {streamText ? <p className="mindmap-ai-panel__stream-text">{streamText}</p> : null}
        </div>
      ) : null}

      {error ? (
        <div className="mindmap-ai-panel__error" role="alert">
          <span>{t('mindmap.aiError')}</span>
          <p>{error}</p>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void generate(aiPrompt || '')}
            disabled={generating}
          >
            {t('mindmap.retry')}
          </button>
        </div>
      ) : null}
    </aside>
  )
}