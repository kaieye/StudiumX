import { X } from 'lucide-react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectPendingAsk, selectPendingToolPermission } from '../../agent-conversation-state'
import { MAX_PET_SIZE, MIN_PET_SIZE } from '../../../../shared/teaching-types'
import { useAppStore } from '../../app-shell/appStore'
import '../../styles/pet-context-menu.css'
import { PetAssistantDialog } from './PetAssistantDialog'
import {
  PET_POSITION_STORAGE_KEY,
  cancelPetDrag,
  clampPetContextMenuPlacement,
  clampPetPlacement,
  clampPetSize,
  derivePetAttention,
  finishPetDrag,
  finishPetResize,
  movePetDrag,
  movePetResize,
  parseStoredPetPlacement,
  petSurfaceSize,
  serializePetPlacement,
  shouldDismissPetContextMenu,
  shouldRestorePetFocusAfterContextMenuDismissal,
  startPetDrag,
  startPetResize,
  type PetDragSession,
  type PetResizeSession,
  type PetPlacement
} from './pet-interaction'
import { PetSprite } from './PetSprite'

type PetContextMenuPosition = PetPlacement
type ContextMenuDismissalReason = 'escape' | 'outside-pointer' | 'scroll' | 'viewport-change' | 'window-blur'

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function petSize(element: HTMLElement | null) {
  return { width: element?.offsetWidth ?? 150, height: element?.offsetHeight ?? 130 }
}

function storedPosition(): PetPlacement | null {
  try {
    return parseStoredPetPlacement(window.localStorage.getItem(PET_POSITION_STORAGE_KEY))
  } catch {
    return null
  }
}

function persistPosition(position: PetPlacement): void {
  try {
    window.localStorage.setItem(PET_POSITION_STORAGE_KEY, serializePetPlacement(position))
  } catch {
    // The pet remains movable when browser storage is unavailable.
  }
}

export function AppPet() {
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings.pet)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const generating = useAppStore((state) => state.generating)
  const agentChatBusy = useAppStore((state) => state.agentChatBusy)
  const error = useAppStore((state) => state.error)
  const agentTurns = useAppStore((state) => state.agentTurns)
  const pendingConversation = useAppStore((state) => state.pendingAgentConversation)
  const petRef = useRef<HTMLDivElement>(null)
  const mascotRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<PetDragSession | null>(null)
  const resizeRef = useRef<PetResizeSession | null>(null)
  const wasBusyRef = useRef(false)
  const wasEnabledRef = useRef(settings.enabled)
  const [position, setPosition] = useState<PetPlacement | null>(() => storedPosition())
  const [dragDirection, setDragDirection] = useState<'left' | 'right' | null>(null)
  const [displaySize, setDisplaySize] = useState(settings.size)
  const [hovered, setHovered] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<PetContextMenuPosition | null>(null)
  const [introVisible, setIntroVisible] = useState(settings.enabled)
  const [reviewVisible, setReviewVisible] = useState(false)

  const pendingTurns = pendingConversation?.turns ?? agentTurns
  const pendingStreamId = pendingConversation?.summary.id ?? null
  const waiting = useMemo(() => {
    if (!pendingStreamId) return false
    return Boolean(
      selectPendingAsk(pendingTurns, pendingStreamId) ||
      selectPendingToolPermission(pendingTurns, pendingStreamId)
    )
  }, [pendingStreamId, pendingTurns])
  const busy = generating || agentChatBusy

  useEffect(() => {
    if (!settings.enabled) {
      wasEnabledRef.current = false
      setIntroVisible(false)
      return
    }
    if (!wasEnabledRef.current) setIntroVisible(true)
    wasEnabledRef.current = true
    const timer = window.setTimeout(() => setIntroVisible(false), 8_000)
    return () => window.clearTimeout(timer)
  }, [settings.enabled])

  useEffect(() => {
    if (resizeRef.current) return
    setDisplaySize(settings.size)
    setPosition((current) => current
      ? clampPetPlacement(current, viewport(), petSurfaceSize(settings.size))
      : null)
  }, [settings.size])

  useEffect(() => {
    let timer = 0
    if (busy) {
      setReviewVisible(false)
    } else if (wasBusyRef.current && !waiting && !error) {
      setReviewVisible(true)
      timer = window.setTimeout(() => setReviewVisible(false), 7_000)
    }
    wasBusyRef.current = busy
    return () => window.clearTimeout(timer)
  }, [busy, error, waiting])

  useEffect(() => {
    const handleResize = (): void => {
      setPosition((current) => current ? clampPetPlacement(current, viewport(), petSize(petRef.current)) : null)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()

    const dismissContextMenu = (reason: ContextMenuDismissalReason, pointerIsInsideMenu?: boolean): void => {
      if (!shouldDismissPetContextMenu({ reason, pointerIsInsideMenu })) return
      setContextMenu(null)
      if (shouldRestorePetFocusAfterContextMenuDismissal(reason)) mascotRef.current?.focus()
    }
    const handleDocumentPointerDown = (event: PointerEvent): void => {
      dismissContextMenu('outside-pointer', Boolean(menuRef.current?.contains(event.target as Node)))
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismissContextMenu('escape')
    }
    const handleScroll = (): void => dismissContextMenu('scroll')
    const handleResize = (): void => dismissContextMenu('viewport-change')
    const handleWindowBlur = (): void => dismissContextMenu('window-blur')

    document.addEventListener('pointerdown', handleDocumentPointerDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [contextMenu])

  const attention = derivePetAttention({
    waiting,
    failed: Boolean(error),
    reviewVisible,
    busy,
    introVisible,
    hovered,
    dragDirection,
    showStatusBubble: settings.showStatusBubble
  })

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const root = petRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    dragRef.current = startPetDrag(
      event.pointerId,
      { x: event.clientX, y: event.clientY },
      { x: rect.left, y: rect.top }
    )
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const update = movePetDrag(
      drag,
      event.pointerId,
      { x: event.clientX, y: event.clientY },
      viewport(),
      petSize(petRef.current)
    )
    dragRef.current = update.session
    if (!update.placement) return
    if (update.direction) setDragDirection(update.direction)
    setPosition(update.placement)
  }

  const persistCurrentPosition = (): void => {
    setPosition((current) => {
      if (current) persistPosition(current)
      return current
    })
  }

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const outcome = finishPetDrag(drag, event.pointerId)
    if (outcome === 'ignore') return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragDirection(null)
    if (outcome === 'persist-placement') persistCurrentPosition()
    else setAssistantOpen(true)
  }

  const handleMascotKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const isActivationKey = event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space'
    if (!isActivationKey) return
    // Handle both native button keys explicitly. Besides avoiding a page scroll
    // for Space, this remains reliable in embedded browser environments that do
    // not synthesize the button click during keyboard interaction.
    event.preventDefault()
    setAssistantOpen(true)
  }

  const handleMascotClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    // Pointer activation is settled in onPointerUp so dragging cannot turn into
    // an assistant launch. Keep a detail-0 fallback for programmatic or
    // assistive-technology clicks that do not have a preceding key event.
    if (event.detail !== 0) return
    setAssistantOpen(true)
  }

  const closeAssistant = (): void => {
    setAssistantOpen(false)
    window.requestAnimationFrame(() => mascotRef.current?.focus())
  }

  const cancelPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const outcome = cancelPetDrag(drag, event.pointerId)
    if (outcome === 'ignore') return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragDirection(null)
    if (outcome === 'persist-placement') persistCurrentPosition()
  }

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (event.button !== 0) return
    resizeRef.current = startPetResize(event.pointerId, event.clientX, displaySize)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    const resize = resizeRef.current
    if (!resize) return
    const update = movePetResize(resize, event.pointerId, event.clientX)
    resizeRef.current = update.session
    if (update.size === null) return
    const nextSize = update.size
    setDisplaySize(nextSize)
    setPosition((current) => current
      ? clampPetPlacement(current, viewport(), petSurfaceSize(nextSize))
      : null)
  }

  const finishResize = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    const resize = resizeRef.current
    if (!resize) return
    const result = finishPetResize(resize, event.pointerId)
    if (result.outcome === 'ignore') return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeRef.current = null
    if (result.outcome === 'persist-size') void updateSettings({ pet: { size: result.size } })
  }

  const cancelResize = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeRef.current = null
    setDisplaySize(settings.size)
    setPosition((current) => current
      ? clampPetPlacement(current, viewport(), petSurfaceSize(settings.size))
      : null)
  }

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>): void => {
    const step = event.shiftKey ? 16 : 8
    const nextSize = event.key === 'Home'
      ? MIN_PET_SIZE
      : event.key === 'End'
        ? MAX_PET_SIZE
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? displaySize - step
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? displaySize + step
            : null
    if (nextSize === null) return
    event.preventDefault()
    const normalized = clampPetSize(nextSize)
    setDisplaySize(normalized)
    setPosition((current) => current
      ? clampPetPlacement(current, viewport(), petSurfaceSize(normalized))
      : null)
    void updateSettings({ pet: { size: normalized } })
  }

  const handleContextMenu = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = null
    setDragDirection(null)
    const rect = event.currentTarget.getBoundingClientRect()
    const anchorX = event.clientX || rect.right - 8
    const anchorY = event.clientY || rect.bottom - 8
    setContextMenu(clampPetContextMenuPlacement({ x: anchorX, y: anchorY }, viewport()))
  }

  const closePet = (): void => {
    setContextMenu(null)
    setAssistantOpen(false)
    void updateSettings({ pet: { enabled: false } })
  }

  if (!settings.enabled) return null

  const surface = petSurfaceSize(displaySize)
  const petStyle = {
    '--pet-size': `${displaySize}px`,
    '--pet-height': `${surface.height - 12}px`,
    '--pet-bubble-offset-x': `${Math.round((displaySize * 82) / 112)}px`,
    '--pet-bubble-offset-y': `${Math.round(((surface.height - 12) * 100) / 121)}px`,
    width: surface.width,
    height: surface.height,
    ...(position ? { left: position.x, top: position.y } : {})
  } as CSSProperties

  return (
    <>
      <PetAssistantDialog
        open={assistantOpen}
        petName={settings.displayName}
        onClose={closeAssistant}
      />
      <div
        ref={petRef}
        className={`app-pet${position ? ' is-positioned' : ''}${position && position.x < 260 ? ' is-left-edge' : ''}`}
        data-state={attention.baseState}
        style={petStyle}
      >
        {attention.showBubble ? (
          <div className="app-pet-bubble" role="status">
            <span>
              <strong>{settings.displayName}</strong>
              <small>{t(`resources.pets.states.${attention.baseState}`)}</small>
            </span>
            <button
              type="button"
              aria-label={t('resources.pets.hide')}
              title={t('resources.pets.hide')}
              onClick={() => void updateSettings({ pet: { enabled: false } })}
            >
              <X size={12} />
            </button>
          </div>
        ) : null}
        <button
          ref={mascotRef}
          className="app-pet-mascot"
          type="button"
          aria-label={t('resources.pets.overlayAria', { name: settings.displayName })}
          aria-haspopup="dialog"
          aria-controls="pet-assistant-dialog"
          aria-expanded={assistantOpen}
          title={t(`resources.pets.states.${attention.baseState}`)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={cancelPointer}
          onKeyDown={handleMascotKeyDown}
          onClick={handleMascotClick}
          onContextMenu={handleContextMenu}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <PetSprite
            appearance={settings.appearance}
            label={settings.displayName}
            size={displaySize}
            state={attention.visualState}
          />
        </button>
        <span
          className="app-pet-resize-handle"
          role="slider"
          tabIndex={0}
          aria-label={t('resources.pets.resizeAria')}
          aria-valuemin={MIN_PET_SIZE}
          aria-valuemax={MAX_PET_SIZE}
          aria-valuenow={displaySize}
          title={t('resources.pets.resizeAria')}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={cancelResize}
        />
      </div>
      {contextMenu ? (
        <div
          ref={menuRef}
          className="app-pet-context-menu"
          role="menu"
          aria-label={t('resources.pets.title')}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={closePet}>
            <X size={14} aria-hidden="true" />
            <span>{t('resources.pets.close')}</span>
          </button>
        </div>
      ) : null}
    </>
  )
}