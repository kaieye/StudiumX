import { ArrowLeft, Bell, Check, MousePointer2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../app-shell/appStore'
import { PetSprite, type PetVisualState } from '../pet/PetSprite'

const previewStates: PetVisualState[] = ['idle', 'running', 'waiting', 'failed', 'review']

export function PetLibrary({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings.pet)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [displayName, setDisplayName] = useState(settings.displayName)
  const [previewState, setPreviewState] = useState<PetVisualState>('waving')
  const [hovered, setHovered] = useState(false)

  useEffect(() => setDisplayName(settings.displayName), [settings.displayName])

  const saveDisplayName = (): void => {
    const normalized = displayName.trim().slice(0, 24) || t('resources.pets.defaultName')
    setDisplayName(normalized)
    if (normalized !== settings.displayName) void updateSettings({ pet: { displayName: normalized } })
  }

  const visibleState = hovered ? 'jumping' : previewState

  return (
    <div className="pet-library-page">
      <button className="resource-back-button" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        {t('resources.home.back')}
      </button>

      <div className="resource-style-head pet-library-head">
        <div>
          <span className="pet-library-eyebrow">{t('resources.pets.eyebrow')}</span>
          <h1>{t('resources.pets.title')}</h1>
          <p>{t('resources.pets.detail')}</p>
        </div>
        <span className={`pet-enabled-pill${settings.enabled ? ' is-enabled' : ''}`}>
          {settings.enabled ? <Check size={13} /> : null}
          {settings.enabled ? t('resources.pets.enabled') : t('resources.pets.disabled')}
        </span>
      </div>

      <section className="pet-preview-card">
        <div className="pet-preview-stage">
          <div className="pet-preview-bubble" data-state={visibleState}>
            <strong>{displayName || t('resources.pets.defaultName')}</strong>
            <span>{t(`resources.pets.states.${visibleState}`)}</span>
          </div>
          <button
            className="pet-preview-mascot"
            type="button"
            aria-label={t('resources.pets.previewAria', { name: displayName })}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onClick={() => setPreviewState('waving')}
          >
            <PetSprite label={displayName} size={224} state={visibleState} />
          </button>
          <span className="pet-preview-shadow" aria-hidden="true" />
        </div>

        <div className="pet-preview-controls">
          <span>{t('resources.pets.previewStates')}</span>
          <div role="group" aria-label={t('resources.pets.previewStates')}>
            {previewStates.map((state) => (
              <button
                key={state}
                className={previewState === state && !hovered ? 'is-active' : undefined}
                type="button"
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
          <div className="pet-settings-card__head">
            <div>
              <h2>{t('resources.pets.settingsTitle')}</h2>
              <p>{t('resources.pets.settingsDetail')}</p>
            </div>
            <Sparkles size={18} />
          </div>

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

        <section className="pet-settings-card pet-behavior-card">
          <div className="pet-settings-card__head">
            <div>
              <h2>{t('resources.pets.behaviorTitle')}</h2>
              <p>{t('resources.pets.behaviorDetail')}</p>
            </div>
            <Bell size={18} />
          </div>
          <ol>
            {(['waiting', 'failed', 'review', 'running', 'idle'] as const).map((state, index) => (
              <li key={state} data-state={state}>
                <span>{index + 1}</span>
                <div>
                  <strong>{t(`resources.pets.stateLabels.${state}`)}</strong>
                  <small>{t(`resources.pets.priority.${state}`)}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="pet-implementation-note">
        <strong>{t('resources.pets.implementationTitle')}</strong>
        <p>{t('resources.pets.implementationDetail')}</p>
      </section>
    </div>
  )
}
