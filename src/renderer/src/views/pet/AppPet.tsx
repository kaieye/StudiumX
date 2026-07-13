import { X } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectPendingAsk, selectPendingToolPermission } from '../../agent-conversation-state'
import { useAppStore } from '../../app-shell/appStore'
import '../../styles/pet-context-menu.css'
import { PetAssistantDialog } from './PetAssistantDialog'
import { PetSprite, type PetVisualState } from './PetSprite'

const PET_POSITION_KEY = 'studiumx-pet-position-v1'
const EDGE_GAP = 14
const CONTEXT_MENU_GAP = 8
const CONTEXT_MENU_WIDTH = 172
const CONTEXT_MENU_HEIGHT = 48

type PetPosition = { x: number; y: number }
type PetContextMenuPosition = { x: number; y: number }

type DragSession = {
  pointerId: number
  startX: number
  startY: number
  startLeft: number
  startTop: number
  moved: boolean
}

function storedPosition(): PetPosition | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PET_POSITION_KEY) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Record<string, unknown>
    return typeof candidate.x === 'number' && typeof candidate.y === 'number'
      ? { x: candidate.x, y: candidate.y }
      : null
  } catch {
    return null
  }
}

function clampPosition(position: PetPosition, element: HTMLElement | null): PetPosition {
  const width = element?.offsetWidth ?? 150
  const height = element?.offsetHeight ?? 130
  return {
    x: Math.min(Math.max(EDGE_GAP, position.x), Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP)),
    y: Math.min(Math.max(EDGE_GAP, position.y), Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP))
  }
}

function clampContextMenuPosition(x: number, y: number): PetContextMenuPosition {
  return {
    x: Math.min(
      Math.max(CONTEXT_MENU_GAP, x),
      Math.max(CONTEXT_MENU_GAP, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_GAP)
    ),
    y: Math.min(
      Math.max(CONTEXT_MENU_GAP, y),
      Math.max(CONTEXT_MENU_GAP, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_GAP)
    )
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
  const dragRef = useRef<DragSession | null>(null)
  const wasBusyRef = useRef(false)
  const [position, setPosition] = useState<PetPosition | null>(() => storedPosition())
  const [dragState, setDragState] = useState<PetVisualState | null>(null)
  const [hovered, setHovered] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<PetContextMenuPosition | null>(null)
  const [introVisible, setIntroVisible] = useState(true)
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
    const timer = window.setTimeout(() => setIntroVisible(false), 8_000)
    return () => window.clearTimeout(timer)
  }, [])

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
      setPosition((current) => current ? clampPosition(current, petRef.current) : null)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()

    const handleDocumentPointerDown = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setContextMenu(null)
      mascotRef.current?.focus()
    }
    const dismissContextMenu = (): void => setContextMenu(null)

    document.addEventListener('pointerdown', handleDocumentPointerDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', dismissContextMenu, true)
    window.addEventListener('resize', dismissContextMenu)
    window.addEventListener('blur', dismissContextMenu)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', dismissContextMenu, true)
      window.removeEventListener('resize', dismissContextMenu)
      window.removeEventListener('blur', dismissContextMenu)
    }
  }, [contextMenu])

  const baseState: PetVisualState = waiting
    ? 'waiting'
    : error
      ? 'failed'
      : reviewVisible
        ? 'review'
        : busy
          ? 'running'
          : introVisible
            ? 'waving'
            : 'idle'
  const visualState = dragState ?? (hovered && baseState === 'idle' ? 'jumping' : baseState)
  const showBubble = settings.showStatusBubble && baseState !== 'idle'

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const root = petRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.hypot(dx, dy) >= 4) drag.moved = true
    if (!drag.moved) return
    setDragState(dx < 0 ? 'running-left' : 'running-right')
    setPosition(clampPosition({ x: drag.startLeft + dx, y: drag.startTop + dy }, petRef.current))
  }

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragState(null)
    if (drag.moved) {
      setPosition((current) => {
        if (current) window.localStorage.setItem(PET_POSITION_KEY, JSON.stringify(current))
        return current
      })
    } else {
      setAssistantOpen(true)
    }
  }

  const handleContextMenu = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = null
    setDragState(null)
    const rect = event.currentTarget.getBoundingClientRect()
    const anchorX = event.clientX || rect.right - CONTEXT_MENU_GAP
    const anchorY = event.clientY || rect.bottom - CONTEXT_MENU_GAP
    setContextMenu(clampContextMenuPosition(anchorX, anchorY))
  }

  const closePet = (): void => {
    setContextMenu(null)
    setAssistantOpen(false)
    void updateSettings({ pet: { enabled: false } })
  }

  if (!settings.enabled) return null

  return (
    <>
      <PetAssistantDialog
        open={assistantOpen}
        petName={settings.displayName}
        onClose={() => setAssistantOpen(false)}
      />
      <div
        ref={petRef}
        className={`app-pet${position ? ' is-positioned' : ''}${position && position.x < 260 ? ' is-left-edge' : ''}`}
        data-state={baseState}
        style={position ? { left: position.x, top: position.y } : undefined}
      >
        {showBubble ? (
          <div className="app-pet-bubble" role="status">
            <span>
              <strong>{settings.displayName}</strong>
              <small>{t(`resources.pets.states.${baseState}`)}</small>
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
          aria-haspopup="menu"
          aria-expanded={Boolean(contextMenu)}
          title={t(`resources.pets.states.${baseState}`)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onContextMenu={handleContextMenu}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <PetSprite
            appearance={settings.appearance}
            label={settings.displayName}
            size={112}
            state={visualState}
          />
        </button>
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
