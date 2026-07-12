import { ArrowLeft, Check, MousePointer2, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PET_APPEARANCE_IDS } from '../../../../shared/teaching-types'
import { useAppStore } from '../../app-shell/appStore'
import { PET_VISUAL_STATES, PetSprite, type PetVisualState } from '../pet/PetSprite'

export function PetLibrary({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings.pet)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [displayName, setDisplayName] = useState(settings.displayName)
  const [previewState, setPreviewState] = useState<PetVisualState>('idle')

  useEffect(() => setDisplayName(settings.displayName), [settings.displayName])

  const saveDisplayName = (): void => {
    const normalized = displayName.trim().slice(0, 24) || t('resources.pets.defaultName')
    setDisplayName(normalized)
    if (normalized !== settings.displayName) void updateSettings({ pet: { displayName: normalized } })
  }

  return (
    <div className="pet-library-page">
      <div className="pet-library-toolbar">
        <button className="resource-back-button" type="button" onClick={onBack}>
          <ArrowLeft size={15} />
          {t('resources.home.back')}
        </button>
        <span className={`pet-enabled-pill${settings.enabled ? ' is-enabled' : ''}`}>
          {settings.enabled ? <Check size={13} /> : null}
          {settings.enabled ? t('resources.pets.enabled') : t('resources.pets.disabled')}
        </span>
      </div>

      <section className="pet-preview-card">
        <div className="pet-preview-stage" data-appearance={settings.appearance}>
          <div className="pet-preview-bubble" data-state={previewState}>
            <strong>{displayName || t('resources.pets.defaultName')}</strong>
            <span>{t(`resources.pets.states.${previewState}`)}</span>
          </div>
          <button
            className="pet-preview-mascot"
            type="button"
            aria-label={t('resources.pets.previewAria', { name: displayName })}
            onClick={() => setPreviewState('waving')}
          >
            <PetSprite
              appearance={settings.appearance}
              label={displayName}
              size={224}
              state={previewState}
            />
          </button>
          <span className="pet-preview-shadow" aria-hidden="true" />
        </div>

        <div className="pet-preview-controls">
          <span>{t('resources.pets.previewStates')}</span>
          <div role="group" aria-label={t('resources.pets.previewStates')}>
            {PET_VISUAL_STATES.map((state) => (
              <button
                key={state}
                className={previewState === state ? 'is-active' : undefined}
                data-state={state}
                type="button"
                onPointerEnter={() => setPreviewState(state)}
                onFocus={() => setPreviewState(state)}
                onClick={() => setPreviewState(state)}
              >
                {t(`resources.pets.stateLabels.${state}`)}
              </button>
            ))}
          </div>
          <small>
            <MousePointer2 size={13} />
            {t('resources.pets.hoverHint')}
          </small>
        </div>
      </section>

      <div className="pet-settings-grid">
        <section className="pet-settings-card">
          <label className="pet-setting-row">
            <span>
              <strong>{t('resources.pets.enableLabel')}</strong>
              <small>{t('resources.pets.enableDetail')}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => void updateSettings({ pet: { enabled: event.currentTarget.checked } })}
            />
          </label>

          <label className="pet-setting-field">
            <span>{t('resources.pets.nameLabel')}</span>
            <input
              type="text"
              value={displayName}
              maxLength={24}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              onBlur={saveDisplayName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </label>

          <label className="pet-setting-row">
            <span>
              <strong>{t('resources.pets.bubbleLabel')}</strong>
              <small>{t('resources.pets.bubbleDetail')}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.showStatusBubble}
              onChange={(event) => void updateSettings({ pet: { showStatusBubble: event.currentTarget.checked } })}
            />
          </label>
        </section>

        <section className="pet-settings-card pet-appearance-card">
          <div className="pet-settings-card__head">
            <div>
              <h2>{t('resources.pets.appearanceTitle')}</h2>
              <p>{t('resources.pets.appearanceDetail')}</p>
            </div>
            <Palette size={18} />
          </div>
          <div className="pet-appearance-grid" role="group" aria-label={t('resources.pets.appearanceTitle')}>
            {PET_APPEARANCE_IDS.map((appearance) => (
              <button
                key={appearance}
                className={settings.appearance === appearance ? 'is-selected' : undefined}
                type="button"
                aria-pressed={settings.appearance === appearance}
                onClick={() => void updateSettings({ pet: { appearance } })}
              >
                <span className="pet-appearance-preview" aria-hidden="true">
                  <PetSprite appearance={appearance} label="" size={62} state="idle" />
                </span>
                <strong>{t(`resources.pets.appearances.${appearance}`)}</strong>
                {settings.appearance === appearance ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="pet-implementation-note">
        <strong>{t('resources.pets.implementationTitle')}</strong>
        <p>{t('resources.pets.implementationDetail')}</p>
      </section>
    </div>
  )
}
