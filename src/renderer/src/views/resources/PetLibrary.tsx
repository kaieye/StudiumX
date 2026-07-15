import { ArrowLeft, Check, MousePointer2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PET_SIZE, MIN_PET_SIZE } from '../../../../shared/teaching-types'
import { useAppStore } from '../../app-shell/appStore'
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
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings.pet)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [displayName, setDisplayName] = useState(settings.displayName)
  const [petSize, setPetSize] = useState(settings.size)
  const [previewState, setPreviewState] = useState<PetVisualState>('idle')
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<PreviewDragSession | null>(null)
  const suppressClickRef = useRef(false)
  const lastCommittedPetSizeRef = useRef(settings.size)

  useEffect(() => setDisplayName(settings.displayName), [settings.displayName])
  useEffect(() => {
    setPetSize(settings.size)
    lastCommittedPetSizeRef.current = settings.size
  }, [settings.size])

  const saveDisplayName = (): void => {
    const normalized = displayName.trim().slice(0, 24) || t('resources.pets.defaultName')
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
            <strong>{displayName || t('resources.pets.defaultName')}</strong>
            <span>{t(`resources.pets.states.${previewState}`)}</span>
          </div>
          <button
            className="pet-preview-mascot"
            type="button"
            aria-label={t('resources.pets.previewAria', { name: displayName })}
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
                  onClick={() => void updateSettings({ pet: { appearance: pet.id } })}
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
      </div>
    </div>
  )
}
