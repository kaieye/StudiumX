import { X } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectPendingAsk, selectPendingToolPermission } from '../../agent-conversation-state'
import { useAppStore } from '../../app-shell/appStore'
import { PetSprite, type PetVisualState } from './PetSprite'

const PET_POSITION_KEY = 'studiumx-pet-position-v1'
const EDGE_GAP = 14

type PetPosition = { x: number; y: number }

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
  const dragRef = useRef<DragSession | null>(null)
  const wasBusyRef = useRef(false)
  const [position, setPosition] = useState<PetPosition | null>(() => storedPosition())
  const [dragState, setDragState] = useState<PetVisualState | null>(null)
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
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
  const showBubble = settings.showStatusBubble && (expanded || baseState !== 'idle')

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
      setExpanded((current) => !current)
    }
  }

  if (!settings.enabled) return null

  return (
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
        className="app-pet-mascot"
        type="button"
        aria-label={t('resources.pets.overlayAria', { name: settings.displayName })}
        title={t(`resources.pets.states.${baseState}`)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
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
  )
}
