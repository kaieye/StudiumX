import { ArrowLeft, BellRing, Check, MousePointer2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_PET_SIZE,
  MIN_PET_SIZE,
  type TeachingSettingsPatch
} from '../../../../shared/teaching-types'
import { useAppStore } from '../../app-shell/appStore'
import { PET_QUIET_MODE_DURATIONS_MS } from '../pet/pet-notifications'
import {
  PET_CATALOG,
  PET_VISUAL_STATES,
  PetSprite,
  type PetVisualState
} from '../pet/PetSprite'

type PreviewDragSession = {
  pointerId: number
  startX: number
  lastX: number
  startOffset: number
  moved: boolean
  maxOffset: number
}

export function PetLibrary({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation()
  const settings = useAppStore((state) => state.settings.pet)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [displayName, setDisplayName] = useState(settings.displayName)
  const [petSize, setPetSize] = useState(settings.size)
  const [previewState, setPreviewState] = useState<PetVisualState>('idle')
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<PreviewDragSession | null>(null)
  const suppressClickRef = useRef(false)
  const lastCommittedPetSizeRef = useRef(settings.size)

  useEffect(() => setDisplayName(settings.displayName), [settings.displayName])
  useEffect(() => {
    setPetSize(settings.size)
    lastCommittedPetSizeRef.current = settings.size
  }, [settings.size])

  const selectedPet = PET_CATALOG.find((pet) => pet.id === settings.appearance)
  const selectedPetName = selectedPet?.displayName ?? t('resources.pets.defaultName')
  // Built-in pet names (plus the legacy pre-0.0.6 default) read as "the default"
  // rather than a user customization, so selecting a pet renames it accordingly.
  const builtInPetNames = new Set<string>([
    ...PET_CATALOG.map((pet) => pet.displayName),
    '小搭档'
  ])

  useEffect(() => {
    const quietUntil = settings.notificationPreferences.quietUntil
    setNow(Date.now())
    if (quietUntil === null || quietUntil <= Date.now()) return
    const timer = window.setTimeout(() => setNow(Date.now()), quietUntil - Date.now() + 50)
    return () => window.clearTimeout(timer)
  }, [settings.notificationPreferences.quietUntil])

  const saveDisplayName = (): void => {
    const normalized = displayName.trim().slice(0, 24) || selectedPetName
    setDisplayName(normalized)
    if (normalized !== settings.displayName) void updateSettings({ pet: { displayName: normalized } })
  }

  const savePetSize = (size: number): void => {
    const normalized = Math.min(MAX_PET_SIZE, Math.max(MIN_PET_SIZE, Math.round(size)))
    setPetSize(normalized)
    if (normalized === settings.size || normalized === lastCommittedPetSizeRef.current) return
    lastCommittedPetSizeRef.current = normalized
    void updateSettings({ pet: { size: normalized } })
  }

  // Drag the mascot left/right: the pet follows the cursor while the running
  // direction tracks the *instantaneous* movement, so reversing feels snappy.
  const handleMascotPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const stage = stageRef.current
    const maxOffset = stage
      ? Math.max(0, (stage.clientWidth - event.currentTarget.offsetWidth) / 2 - 24)
      : 140
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      startOffset: dragOffset,
      moved: false,
      maxOffset
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handleMascotPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const totalDx = event.clientX - drag.startX
    if (Math.abs(totalDx) >= 4) drag.moved = true
    if (!drag.moved) return
    const clamped = Math.max(
      -drag.maxOffset,
      Math.min(drag.maxOffset, drag.startOffset + totalDx)
    )
    setDragOffset(clamped)
    const delta = event.clientX - drag.lastX
    if (delta >= 1) setPreviewState('running-right')
    else if (delta <= -1) setPreviewState('running-left')
    drag.lastX = event.clientX
  }

  const handleMascotPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragging(false)
    // A pointer interaction always follows pointerup with a click; suppress it
    // so mouse users don't double-trigger. Keyboard activation skips pointerup
    // entirely and still reaches onClick below.
    suppressClickRef.current = true
    if (drag.moved) {
      setDragOffset(0)
      setPreviewState('idle')
    } else {
      setPreviewState('waving')
    }
  }

  const notificationPreferences = settings.notificationPreferences
  const quietModeActive = notificationPreferences.quietUntil !== null
    && notificationPreferences.quietUntil > now
  const quietUntilLabel = quietModeActive
    ? new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(
      notificationPreferences.quietUntil!
    )
    : ''

  const updateNotificationPreferences = (
    patch: NonNullable<NonNullable<TeachingSettingsPatch['pet']>['notificationPreferences']>
  ): void => {
    void updateSettings({ pet: { notificationPreferences: patch } })
  }

  const startQuietMode = (durationMs: number): void => {
    const quietUntil = Date.now() + durationMs
    setNow(Date.now())
    updateNotificationPreferences({ quietUntil })
  }

  const handleMascotClick = (): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setPreviewState('waving')
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
        <div
          className={`pet-preview-stage${dragging ? ' is-dragging' : ''}`}
          data-appearance={settings.appearance}
          ref={stageRef}
          style={{ '--drag-x': `${dragOffset}px` } as CSSProperties}
        >
          <div className="pet-preview-bubble" data-state={previewState}>
            <strong>{displayName || selectedPetName}</strong>
            <span>{t(`resources.pets.states.${previewState}`)}</span>
          </div>
          <button
            className="pet-preview-mascot"
            type="button"
            aria-label={t('resources.pets.previewAria', { name: displayName || selectedPetName })}
            onClick={handleMascotClick}
            onPointerDown={handleMascotPointerDown}
            onPointerMove={handleMascotPointerMove}
            onPointerUp={handleMascotPointerUp}
            onPointerCancel={handleMascotPointerUp}
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
          <div
            role="group"
            aria-label={t('resources.pets.previewStates')}
            onPointerLeave={() => setPreviewState('idle')}
          >
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

          <label className="pet-setting-field pet-size-setting">
            <span>
              <span>{t('resources.pets.sizeLabel')}</span>
              <output>{petSize}px</output>
            </span>
            <input
              type="range"
              min={MIN_PET_SIZE}
              max={MAX_PET_SIZE}
              step={8}
              value={petSize}
              aria-label={t('resources.pets.sizeLabel')}
              onChange={(event) => setPetSize(Number(event.currentTarget.value))}
              onPointerUp={(event) => savePetSize(Number(event.currentTarget.value))}
              onKeyUp={(event) => savePetSize(Number(event.currentTarget.value))}
              onBlur={(event) => savePetSize(Number(event.currentTarget.value))}
            />
            <small>{t('resources.pets.sizeDetail')}</small>
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
            <Check size={18} />
          </div>
          <div className="pet-appearance-grid" aria-label={t('resources.pets.appearanceTitle')}>
            {PET_CATALOG.map((pet) => {
              const selected = settings.appearance === pet.id
              return (
                <button
                  key={pet.id}
                  className={`pet-appearance-option${selected ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={selected}
                  title={pet.description}
                  onClick={() => {
                    // Unless the user has typed a custom name, the pet name follows
                    // the currently selected pet.
                    const nextDisplayName =
                      displayName.trim() === '' || builtInPetNames.has(displayName)
                        ? pet.displayName
                        : displayName
                    setDisplayName(nextDisplayName)
                    void updateSettings({ pet: { appearance: pet.id, displayName: nextDisplayName } })
                  }}
                >
                  <span className="pet-appearance-preview" aria-hidden="true">
                    <PetSprite appearance={pet.id} label="" size={96} state="idle" />
                  </span>
                  <strong>{pet.displayName}</strong>
                  {selected ? <Check size={13} aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        </section>

        <section className="pet-settings-card pet-notification-settings-card">
          <div className="pet-settings-card__head">
            <div>
              <h2>{t('resources.pets.notificationPreferences.title')}</h2>
              <p>{t('resources.pets.notificationPreferences.detail')}</p>
            </div>
            <BellRing size={18} aria-hidden="true" />
          </div>

          <div className="pet-notification-settings">
            <div className="pet-notification-settings__toggles">
              <label className="pet-setting-row">
                <span>
                  <strong>{t('resources.pets.notificationPreferences.actionableOnly.label')}</strong>
                  <small>{t('resources.pets.notificationPreferences.actionableOnly.detail')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationPreferences.actionableOnly}
                  onChange={(event) => updateNotificationPreferences({ actionableOnly: event.currentTarget.checked })}
                />
              </label>
              <label className="pet-setting-row">
                <span>
                  <strong>{t('resources.pets.notificationPreferences.showRunning.label')}</strong>
                  <small>{t('resources.pets.notificationPreferences.showRunning.detail')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationPreferences.showRunning}
                  onChange={(event) => updateNotificationPreferences({ showRunning: event.currentTarget.checked })}
                />
              </label>
              <label className="pet-setting-row">
                <span>
                  <strong>{t('resources.pets.notificationPreferences.showReview.label')}</strong>
                  <small>{t('resources.pets.notificationPreferences.showReview.detail')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationPreferences.showReview}
                  onChange={(event) => updateNotificationPreferences({ showReview: event.currentTarget.checked })}
                />
              </label>
              <label className="pet-setting-row">
                <span>
                  <strong>{t('resources.pets.notificationPreferences.showWaving.label')}</strong>
                  <small>{t('resources.pets.notificationPreferences.showWaving.detail')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationPreferences.showWaving}
                  onChange={(event) => updateNotificationPreferences({ showWaving: event.currentTarget.checked })}
                />
              </label>
            </div>

            <fieldset className="pet-notification-settings__sources">
              <legend>{t('resources.pets.notificationPreferences.sources.title')}</legend>
              <p>{t('resources.pets.notificationPreferences.sources.detail')}</p>
              <label>
                <input
                  type="checkbox"
                  checked={notificationPreferences.sources.agent}
                  onChange={(event) => updateNotificationPreferences({
                    sources: { agent: event.currentTarget.checked }
                  })}
                />
                <span>{t('resources.pets.notificationPreferences.sources.agent')}</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={notificationPreferences.sources.lessonGeneration}
                  onChange={(event) => updateNotificationPreferences({
                    sources: { lessonGeneration: event.currentTarget.checked }
                  })}
                />
                <span>{t('resources.pets.notificationPreferences.sources.lessonGeneration')}</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={notificationPreferences.sources.lessonReview}
                  onChange={(event) => updateNotificationPreferences({
                    sources: { lessonReview: event.currentTarget.checked }
                  })}
                />
                <span>{t('resources.pets.notificationPreferences.sources.lessonReview')}</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={notificationPreferences.sources.onboarding}
                  onChange={(event) => updateNotificationPreferences({
                    sources: { onboarding: event.currentTarget.checked }
                  })}
                />
                <span>{t('resources.pets.notificationPreferences.sources.onboarding')}</span>
              </label>
            </fieldset>

            <div className="pet-notification-settings__quiet">
              <div>
                <strong>{t('resources.pets.notificationPreferences.quiet.title')}</strong>
                <small>
                  {quietModeActive
                    ? t('resources.pets.notificationPreferences.quiet.active', { time: quietUntilLabel })
                    : t('resources.pets.notificationPreferences.quiet.detail')}
                </small>
              </div>
              <div className="pet-notification-settings__quiet-actions">
                {quietModeActive ? (
                  <button
                    type="button"
                    onClick={() => updateNotificationPreferences({ quietUntil: null })}
                  >
                    {t('resources.pets.notificationPreferences.quiet.end')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startQuietMode(PET_QUIET_MODE_DURATIONS_MS.thirtyMinutes)}
                    >
                      {t('resources.pets.notificationPreferences.quiet.thirtyMinutes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => startQuietMode(PET_QUIET_MODE_DURATIONS_MS.oneHour)}
                    >
                      {t('resources.pets.notificationPreferences.quiet.oneHour')}
                    </button>
                  </>
                )}
              </div>
            </div>

            <p className="pet-notification-settings__critical-note">
              {t('resources.pets.notificationPreferences.criticalNote')}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
