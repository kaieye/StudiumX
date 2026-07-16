import { Bell, BellOff, ChevronDown, ChevronUp, MessageCircle, RotateCcw, Ruler, X } from 'lucide-react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectPendingAsk, selectPendingToolPermission } from '../../agent-conversation-state'
import { DEFAULT_PET_SIZE, MAX_PET_SIZE, MIN_PET_SIZE, type LessonSummary } from '../../../../shared/teaching-types'
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
  resolvePetActivityFocusAfterRemoval,
  resolvePetActivityNavigation,
  resolvePetBubbleLayout,
  petSurfaceSize,
  serializePetPlacement,
  shouldDismissPetContextMenu,
  shouldRestorePetFocusAfterContextMenuDismissal,
  startPetDrag,
  startPetResize,
  type PetDragSession,
  type PetResizeSession,
  type PetPlacement,
  type PetBubbleLayout
} from './pet-interaction'
import { PetSprite } from './PetSprite'
import { computeDueLessonReviews } from './lesson-review-due'
import {
  advancePetNotificationProjection,
  createInitialPetNotificationProjectionState,
  dismissPetNotification,
  projectPetNotifications,
  projectPetNotificationVisibility,
  pruneDismissedPetNotifications,
  retainedPetNotificationIds,
  selectPetNotifications,
  type DismissedPetNotifications,
  type PetNotification,
  type PetNotificationCopy,
  type PetNotificationSignals
} from './pet-notifications'

const EMPTY_LESSONS: LessonSummary[] = []

type PetContextMenuPosition = PetPlacement
type ContextMenuDismissalReason = 'escape' | 'outside-pointer' | 'scroll' | 'viewport-change' | 'window-blur'

type PetBubbleCssLayout = Pick<PetBubbleLayout, 'horizontal' | 'vertical'> & {
  left: number
  top: number
  maxWidth: number
  maxHeight: number
}

function samePetBubbleCssLayout(left: PetBubbleCssLayout | null, right: PetBubbleCssLayout): boolean {
  return Boolean(left)
    && left?.left === right.left
    && left.top === right.top
    && left.maxWidth === right.maxWidth
    && left.maxHeight === right.maxHeight
    && left.horizontal === right.horizontal
    && left.vertical === right.vertical
}

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
  const { i18n, t } = useTranslation()
  const settings = useAppStore((state) => state.settings.pet)
  const currentView = useAppStore((state) => state.view)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const generating = useAppStore((state) => state.generating)
  const lessonGenerationRunId = useAppStore((state) => state.lessonGenerationRunId)
  const agentPetNotificationResult = useAppStore((state) => state.agentPetNotificationResult)
  const lessonGenerationPetNotificationResult = useAppStore((state) => state.lessonGenerationPetNotificationResult)
  const agentChatBusy = useAppStore((state) => state.agentChatBusy)
  const petNotificationErrors = useAppStore((state) => state.petNotificationErrors)
  const agentTurns = useAppStore((state) => state.agentTurns)
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const pendingConversation = useAppStore((state) => state.pendingAgentConversation)
  const restorePendingAgentConversation = useAppStore((state) => state.restorePendingAgentConversation)
  const cancelAgentChat = useAppStore((state) => state.cancelAgentChat)
  const loadAgentConversation = useAppStore((state) => state.loadAgentConversation)
  const setOverviewDialogMode = useAppStore((state) => state.setOverviewDialogMode)
  const setView = useAppStore((state) => state.setView)
  const reviewCards = useAppStore((state) => state.reviewCards)
  const progress = useAppStore((state) => state.progress)
  const lessons = useAppStore((state) => state.appState.activeWorkspace?.lessons ?? EMPTY_LESSONS)
  const loadLesson = useAppStore((state) => state.loadLesson)
  const petRef = useRef<HTMLDivElement>(null)
  const mascotRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const activityToggleRef = useRef<HTMLButtonElement>(null)
  const activityStackRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const activityItemRefs = useRef(new Map<string, HTMLDivElement>())
  const previousActivityIdsRef = useRef<string[]>([])
  const focusedActivityIdRef = useRef<string | null>(null)
  const activityHadFocusRef = useRef(false)
  const bubbleHadFocusRef = useRef(false)
  const announcedNotificationKeyRef = useRef<string | null>(null)
  const dragRef = useRef<PetDragSession | null>(null)
  const resizeRef = useRef<PetResizeSession | null>(null)
  const [position, setPosition] = useState<PetPlacement | null>(() => storedPosition())
  const [dragDirection, setDragDirection] = useState<'left' | 'right' | null>(null)
  const [displaySize, setDisplaySize] = useState(settings.size)
  const [hovered, setHovered] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<PetContextMenuPosition | null>(null)
  const [dismissedNotifications, setDismissedNotifications] = useState<DismissedPetNotifications>({})
  const [activityExpanded, setActivityExpanded] = useState(false)
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null)
  const [bubbleLayout, setBubbleLayout] = useState<PetBubbleCssLayout | null>(null)
  const [notificationAnnouncement, setNotificationAnnouncement] = useState({
    key: '',
    text: '',
    politeness: 'polite' as 'polite' | 'assertive'
  })

  const pendingTurns = pendingConversation?.turns ?? agentTurns
  const pendingStreamId = pendingConversation?.summary.id ?? null
  const pendingRequest = useMemo(() => {
    if (!pendingStreamId) return null
    const ask = selectPendingAsk(pendingTurns, pendingStreamId)
    if (ask) return { id: ask.toolCallId, conversationId: pendingStreamId, kind: 'ask' as const }
    const permission = selectPendingToolPermission(pendingTurns, pendingStreamId)
    if (permission) {
      return { id: permission.toolCallId, conversationId: pendingStreamId, kind: 'tool-permission' as const }
    }
    return null
  }, [pendingStreamId, pendingTurns])

  const notificationCopy = useMemo<PetNotificationCopy>(() => ({
    waiting: {
      title: t('resources.pets.notifications.waiting.title'),
      detail: t('resources.pets.notifications.waiting.detail'),
      actionLabel: t('resources.pets.actions.waiting')
    },
    agentRunning: {
      title: t('resources.pets.notifications.agentRunning.title'),
      detail: t('resources.pets.notifications.agentRunning.detail'),
      actionLabel: t('resources.pets.actions.running')
    },
    lessonRunning: {
      title: t('resources.pets.notifications.lessonRunning.title'),
      detail: t('resources.pets.notifications.lessonRunning.detail'),
      actionLabel: t('resources.pets.actions.running')
    },
    agentReview: {
      title: t('resources.pets.notifications.agentReview.title'),
      detail: t('resources.pets.notifications.agentReview.detail'),
      actionLabel: t('resources.pets.actions.review')
    },
    lessonReview: {
      title: t('resources.pets.notifications.lessonReview.title'),
      detail: t('resources.pets.notifications.lessonReview.detail'),
      actionLabel: t('resources.pets.actions.review')
    },
    lessonReviewDue: {
      title: t('resources.pets.notifications.lessonReviewDue.title'),
      detail: t('resources.pets.notifications.lessonReviewDue.detail'),
      actionLabel: t('resources.pets.notifications.lessonReviewDue.actionLabel')
    },
    agentFailed: {
      title: t('resources.pets.notifications.agentFailed.title'),
      actionLabel: t('resources.pets.actions.failed')
    },
    lessonFailed: {
      title: t('resources.pets.notifications.lessonFailed.title'),
      actionLabel: t('resources.pets.actions.failed')
    },
    waving: {
      title: t('resources.pets.notifications.waving.title', { name: settings.displayName }),
      detail: t('resources.pets.notifications.waving.detail'),
      actionLabel: t('resources.pets.actions.waving')
    }
  }), [settings.displayName, t])

  const dueLessonReviews = useMemo(
    () => computeDueLessonReviews({
      lessons,
      reviewCards,
      progress: progress ?? { totalAnswered: 0, correct: 0, byLesson: {} },
      now: Date.now()
    }),
    [lessons, reviewCards, progress]
  )

  const baseNotificationSignals = useMemo<Omit<PetNotificationSignals, 'now'>>(() => ({
    enabled: settings.enabled,
    pendingRequest,
    agent: {
      busy: agentChatBusy,
      runId: pendingConversation?.summary.id,
      conversationId: pendingConversation?.summary.id,
      result: agentPetNotificationResult ?? undefined
    },
    lessonGeneration: {
      busy: generating,
      runId: lessonGenerationRunId ?? undefined,
      result: lessonGenerationPetNotificationResult ?? undefined
    },
    lessonReview: {
      dueLessons: dueLessonReviews
    },
    errors: petNotificationErrors.map((item) => ({
      id: item.id,
      source: item.source,
      sourceId: item.sourceId,
      targetId: item.targetId,
      detail: item.error.detail ?? item.error.message,
      createdAt: item.createdAt
    }))
  }), [
    activeConversationId,
    agentPetNotificationResult,
    agentChatBusy,
    dueLessonReviews,
    generating,
    lessonGenerationRunId,
    lessonGenerationPetNotificationResult,
    pendingConversation?.summary.id,
    pendingRequest,
    petNotificationErrors,
    settings.enabled,
    currentView
  ])
  const [notificationProjection, setNotificationProjection] = useState(() => {
    const now = Date.now()
    return {
      now,
      state: advancePetNotificationProjection(
        createInitialPetNotificationProjectionState(),
        { ...baseNotificationSignals, now }
      )
    }
  })

  useEffect(() => {
    const now = Date.now()
    setNotificationProjection((current) => ({
      now,
      state: advancePetNotificationProjection(current.state, { ...baseNotificationSignals, now })
    }))
    if (!settings.enabled) setDismissedNotifications({})
  }, [baseNotificationSignals, settings.enabled])

  const notificationSignals = useMemo<PetNotificationSignals>(() => ({
    ...baseNotificationSignals,
    now: notificationProjection.now
  }), [baseNotificationSignals, notificationProjection.now])
  const notifications = useMemo(
    () => projectPetNotifications(notificationProjection.state, notificationSignals, notificationCopy),
    [notificationCopy, notificationProjection.state, notificationSignals]
  )
  const retainedNotificationIds = useMemo(
    () => retainedPetNotificationIds(notificationProjection.state, notificationSignals),
    [notificationProjection.state, notificationSignals]
  )
  const presentableNotifications = useMemo(
    () => projectPetNotificationVisibility(
      notifications,
      settings.notificationPreferences,
      notificationProjection.now
    ),
    [notificationProjection.now, notifications, settings.notificationPreferences]
  )
  const visibleNotifications = useMemo(
    () => selectPetNotifications(
      presentableNotifications,
      dismissedNotifications,
      notificationProjection.now
    ),
    [dismissedNotifications, notificationProjection.now, presentableNotifications]
  )
  const notification = visibleNotifications[0] ?? null
  const activityNotifications = visibleNotifications.slice(0, 3)
  const canExpandActivity = visibleNotifications.length > 1
  const activityNotificationIds = activityNotifications.map((item) => item.id)

  useLayoutEffect(() => {
    const previousIds = previousActivityIdsRef.current
    const focusedId = focusedActivityIdRef.current
    const nextActiveId = resolvePetActivityFocusAfterRemoval(
      previousIds,
      activityNotificationIds,
      focusedId ?? activeActivityId
    )
    if (nextActiveId !== activeActivityId) setActiveActivityId(nextActiveId)
    if (
      activityExpanded
      && canExpandActivity
      && activityHadFocusRef.current
      && focusedId
      && !activityNotificationIds.includes(focusedId)
      && nextActiveId
    ) {
      focusedActivityIdRef.current = nextActiveId
      activityItemRefs.current.get(nextActiveId)?.focus()
    }
    previousActivityIdsRef.current = activityNotificationIds
  }, [activeActivityId, activityExpanded, activityNotificationIds.join('\u0000'), canExpandActivity])

  useEffect(() => {
    setDismissedNotifications((current) => pruneDismissedPetNotifications(current, retainedNotificationIds))
  }, [retainedNotificationIds])

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent): void => {
      if (activityStackRef.current?.contains(event.target as Node)) return
      queueMicrotask(() => {
        if (!activityStackRef.current?.contains(document.activeElement)) {
          activityHadFocusRef.current = false
          focusedActivityIdRef.current = null
        }
        if (!bubbleRef.current?.contains(document.activeElement)) bubbleHadFocusRef.current = false
      })
    }
    document.addEventListener('focusin', handleFocusIn)
    return () => document.removeEventListener('focusin', handleFocusIn)
  }, [])

  useLayoutEffect(() => {
    if (!activityExpanded || canExpandActivity) return
    const focusWasInStack = activityHadFocusRef.current
    setActivityExpanded(false)
    if (focusWasInStack) {
      activityHadFocusRef.current = false
      focusedActivityIdRef.current = null
      window.requestAnimationFrame(() => mascotRef.current?.focus())
    }
  }, [activityExpanded, canExpandActivity])

  useEffect(() => {
    const now = Date.now()
    const expirations = notifications.flatMap((item) => item.expiresAt === undefined ? [] : [item.expiresAt])
    const quietUntil = settings.notificationPreferences.quietUntil
    if (quietUntil !== null && quietUntil > now) expirations.push(quietUntil)
    if (expirations.length === 0) return
    const nextExpiration = Math.min(...expirations)
    const timer = window.setTimeout(() => {
      const now = Date.now()
      setNotificationProjection((current) => ({
        now,
        state: advancePetNotificationProjection(current.state, { ...baseNotificationSignals, now })
      }))
    }, Math.max(0, nextExpiration - now) + 1)
    return () => window.clearTimeout(timer)
  }, [baseNotificationSignals, notifications, settings.notificationPreferences.quietUntil])

  useEffect(() => {
    if (settings.enabled) return
    dragRef.current = null
    resizeRef.current = null
    setDragDirection(null)
    setHovered(false)
    setAssistantOpen(false)
    setContextMenu(null)
    setActivityExpanded(false)
    setDisplaySize(settings.size)
  }, [settings.enabled, settings.size])

  useEffect(() => {
    if (resizeRef.current) return
    setDisplaySize(settings.size)
    setPosition((current) => current
      ? clampPetPlacement(current, viewport(), petSurfaceSize(settings.size))
      : null)
  }, [settings.size])

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
      if (event.key === 'Escape') {
        dismissContextMenu('escape')
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
      if (items.length === 0) return
      event.preventDefault()
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1 + items.length) % items.length
            : (currentIndex - 1 + items.length) % items.length
      items[nextIndex]?.focus()
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

  const measureBubbleLayout = useCallback((): void => {
    const root = petRef.current
    const mascot = mascotRef.current
    const bubble = bubbleRef.current
    if (!root || !mascot || !bubble) return
    const rootRect = root.getBoundingClientRect()
    const mascotRect = mascot.getBoundingClientRect()
    const bubbleRect = bubble.getBoundingClientRect()
    const layout = resolvePetBubbleLayout(
      { x: mascotRect.left, y: mascotRect.top, width: mascotRect.width, height: mascotRect.height },
      { width: bubbleRect.width, height: bubbleRect.height },
      viewport()
    )
    const scaleX = rootRect.width > 0 && root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1
    const scaleY = rootRect.height > 0 && root.offsetHeight > 0 ? rootRect.height / root.offsetHeight : 1
    const nextLayout: PetBubbleCssLayout = {
      left: Math.round(((layout.x - rootRect.left) / scaleX) * 100) / 100,
      top: Math.round(((layout.y - rootRect.top) / scaleY) * 100) / 100,
      maxWidth: Math.round((layout.maxWidth / scaleX) * 100) / 100,
      maxHeight: Math.round((layout.maxHeight / scaleY) * 100) / 100,
      horizontal: layout.horizontal,
      vertical: layout.vertical
    }
    setBubbleLayout((current) => samePetBubbleCssLayout(current, nextLayout) ? current : nextLayout)
  }, [])

  const attention = derivePetAttention({
    notificationState: notification?.state ?? null,
    hovered,
    dragDirection,
    showStatusBubble: settings.showStatusBubble
  })
  // The conversation view already exposes the live process, approval and
  // completion states inline. Do not repeat them as a floating pet message.
  const showStatusBubble = currentView !== 'overview' && attention.showBubble && notification !== null

  useEffect(() => {
    if (!showStatusBubble || !notification) {
      setNotificationAnnouncement((current) => current.text ? { ...current, key: '', text: '' } : current)
      return
    }
    const language = i18n.resolvedLanguage ?? i18n.language
    const key = `${language}:${notification.id}:${notification.state}`
    if (announcedNotificationKeyRef.current === key) return
    announcedNotificationKeyRef.current = key
    setNotificationAnnouncement({
      key,
      text: t('resources.pets.activity.announcement', {
        state: t(`resources.pets.stateLabels.${notification.state}`),
        title: notification.title,
        detail: notification.detail
      }),
      politeness: notification.state === 'waiting' || notification.state === 'failed' ? 'assertive' : 'polite'
    })
  }, [i18n.language, i18n.resolvedLanguage, notification, showStatusBubble, t])

  useLayoutEffect(() => {
    if (showStatusBubble || !settings.enabled || !bubbleHadFocusRef.current) return
    bubbleHadFocusRef.current = false
    mascotRef.current?.focus()
  }, [settings.enabled, showStatusBubble])

  useLayoutEffect(() => {
    if (!showStatusBubble) {
      setBubbleLayout(null)
      return
    }
    let frame = 0
    const scheduleMeasurement = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(measureBubbleLayout)
    }
    measureBubbleLayout()
    const observer = new ResizeObserver(scheduleMeasurement)
    if (petRef.current) observer.observe(petRef.current)
    if (mascotRef.current) observer.observe(mascotRef.current)
    if (bubbleRef.current) observer.observe(bubbleRef.current)
    window.addEventListener('resize', scheduleMeasurement)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', scheduleMeasurement)
    }
  }, [activityExpanded, measureBubbleLayout, notification?.detail, notification?.id, notification?.title, showStatusBubble])

  const openAssistant = (): void => {
    setContextMenu(null)
    setAssistantOpen(true)
  }

  const openConversation = (conversationId?: string): void => {
    setContextMenu(null)
    setAssistantOpen(false)
    if (pendingConversation && (!conversationId || pendingConversation.summary.id === conversationId)) {
      restorePendingAgentConversation()
    } else if (conversationId && activeConversationId !== conversationId) {
      void loadAgentConversation(conversationId)
    }
    setOverviewDialogMode('chat')
    setView('agent')
  }

  const handleNotificationAction = (item: PetNotification | null = notification): void => {
    if (!item) return
    if (item.action === 'open-conversation') {
      openConversation(item.targetId)
      return
    }
    if (item.action === 'open-lessons') {
      setContextMenu(null)
      setAssistantOpen(false)
      setView('lessons')
      return
    }
    if (item.action === 'open-lesson') {
      const lesson = lessons.find((entry) => entry.id === item.targetId)
      if (lesson) {
        setContextMenu(null)
        setAssistantOpen(false)
        void loadLesson(lesson)
      }
      return
    }
    if (item.action === 'stop-run') {
      void cancelAgentChat()
      return
    }
    openAssistant()
  }

  const dismissNotification = (item: PetNotification): void => {
    setDismissedNotifications((current) => pruneDismissedPetNotifications(
      dismissPetNotification(current, item, Date.now()),
      retainedNotificationIds
    ))
  }

  const collapseActivityStack = (): void => {
    if (activityToggleRef.current) activityToggleRef.current.focus()
    else mascotRef.current?.focus()
    activityHadFocusRef.current = false
    focusedActivityIdRef.current = null
    setActivityExpanded(false)
  }

  const handleActivityKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      collapseActivityStack()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-pet-notification-id]')
    const nextId = resolvePetActivityNavigation(
      activityNotificationIds,
      item?.dataset.petNotificationId ?? activeActivityId,
      event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
    )
    if (!nextId) return
    event.preventDefault()
    setActiveActivityId(nextId)
    focusedActivityIdRef.current = nextId
    activityHadFocusRef.current = true
    activityItemRefs.current.get(nextId)?.focus()
  }

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

  const closeAssistant = useCallback((options?: { restoreFocus?: boolean }): void => {
    setAssistantOpen(false)
    if (options?.restoreFocus !== false) {
      window.requestAnimationFrame(() => mascotRef.current?.focus())
    }
  }, [])

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

  const resetPetPosition = (): void => {
    setContextMenu(null)
    setPosition(null)
    try {
      window.localStorage.removeItem(PET_POSITION_STORAGE_KEY)
    } catch {
      // Reset still applies to the current session when storage is unavailable.
    }
  }

  const resetPetSize = (): void => {
    setContextMenu(null)
    setDisplaySize(DEFAULT_PET_SIZE)
    setPosition((current) => current
      ? clampPetPlacement(current, viewport(), petSurfaceSize(DEFAULT_PET_SIZE))
      : null)
    void updateSettings({ pet: { size: DEFAULT_PET_SIZE } })
  }

  const toggleStatusBubble = (): void => {
    setContextMenu(null)
    setDismissedNotifications({})
    void updateSettings({ pet: { showStatusBubble: !settings.showStatusBubble } })
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
        className={`app-pet${position ? ' is-positioned' : ''}`}
        data-state={attention.baseState}
        style={petStyle}
      >
        <span
          className="app-pet-live-region"
          role="status"
          aria-live={notificationAnnouncement.politeness}
          aria-atomic="true"
          data-announcement-key={notificationAnnouncement.key || undefined}
        >
          {notificationAnnouncement.text}
        </span>
        {showStatusBubble ? (
          <div
            ref={bubbleRef}
            className={`app-pet-bubble${activityExpanded ? ' is-expanded' : ''}`}
            data-horizontal={bubbleLayout?.horizontal}
            data-vertical={bubbleLayout?.vertical}
            style={bubbleLayout ? {
              left: bubbleLayout.left,
              top: bubbleLayout.top,
              right: 'auto',
              bottom: 'auto',
              maxWidth: bubbleLayout.maxWidth,
              maxHeight: bubbleLayout.maxHeight
            } : undefined}
            onKeyDown={handleActivityKeyDown}
            onFocusCapture={() => { bubbleHadFocusRef.current = true }}
            onBlurCapture={(event) => {
              const nextTarget = event.relatedTarget as Node | null
              if (nextTarget && !event.currentTarget.contains(nextTarget)) bubbleHadFocusRef.current = false
            }}
          >
            <span className="app-pet-bubble-copy">
              <strong>{notification?.title}</strong>
              <small>{notification?.detail}</small>
              <button className="app-pet-bubble-action" type="button" onClick={() => handleNotificationAction()}>
                {notification?.actionLabel}
              </button>
            </span>
            <span className="app-pet-bubble-controls">
              {canExpandActivity ? (
                <button
                  ref={activityToggleRef}
                  className="app-pet-activity-toggle"
                  type="button"
                  aria-expanded={activityExpanded}
                  aria-controls="pet-activity-stack"
                  aria-label={activityExpanded
                    ? t('resources.pets.activity.collapse')
                    : t('resources.pets.activity.expand', { count: Math.min(3, visibleNotifications.length) })}
                  title={activityExpanded
                    ? t('resources.pets.activity.collapse')
                    : t('resources.pets.activity.expand', { count: Math.min(3, visibleNotifications.length) })}
                  onClick={() => setActivityExpanded((current) => !current)}
                >
                  {activityExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              ) : null}
              <button
                className="app-pet-bubble-dismiss"
                type="button"
                aria-label={t('resources.pets.dismissNotification')}
                title={t('resources.pets.dismissNotification')}
                onClick={() => notification && dismissNotification(notification)}
              >
                <X size={12} />
              </button>
            </span>
            {activityExpanded ? (
              <div
                ref={activityStackRef}
                id="pet-activity-stack"
                className="app-pet-activity-stack"
                role="list"
                aria-label={t('resources.pets.activity.label')}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget as Node | null
                  if (!nextTarget || event.currentTarget.contains(nextTarget)) return
                  activityHadFocusRef.current = false
                  focusedActivityIdRef.current = null
                }}
              >
                {activityNotifications.map((item) => (
                  <div
                    className="app-pet-activity-item"
                    role="listitem"
                    tabIndex={activeActivityId === item.id ? 0 : -1}
                    data-pet-notification-id={item.id}
                    key={item.id}
                    ref={(element) => {
                      if (element) activityItemRefs.current.set(item.id, element)
                      else activityItemRefs.current.delete(item.id)
                    }}
                    onFocusCapture={() => {
                      activityHadFocusRef.current = true
                      focusedActivityIdRef.current = item.id
                      setActiveActivityId(item.id)
                    }}
                  >
                    <span className="app-pet-activity-meta">
                      <span>{t(`resources.pets.activity.sources.${item.source}`)}</span>
                      <span>{t(`resources.pets.stateLabels.${item.state}`)}</span>
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                    <span className="app-pet-activity-actions">
                      <button type="button" className="app-pet-bubble-action" onClick={() => handleNotificationAction(item)}>
                        {item.actionLabel}
                      </button>
                      <button
                        type="button"
                        aria-label={t('resources.pets.activity.dismiss', { title: item.title })}
                        title={t('resources.pets.activity.dismiss', { title: item.title })}
                        onClick={() => dismissNotification(item)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
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
          title={notification?.detail ?? t('resources.pets.states.idle')}
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
          <button type="button" role="menuitem" onClick={openAssistant}>
            <MessageCircle size={14} aria-hidden="true" />
            <span>{t('resources.pets.openAssistant')}</span>
          </button>
          <button type="button" role="menuitem" onClick={resetPetPosition}>
            <RotateCcw size={14} aria-hidden="true" />
            <span>{t('resources.pets.resetPosition')}</span>
          </button>
          <button type="button" role="menuitem" onClick={resetPetSize}>
            <Ruler size={14} aria-hidden="true" />
            <span>{t('resources.pets.resetSize')}</span>
          </button>
          <button type="button" role="menuitem" onClick={toggleStatusBubble}>
            {settings.showStatusBubble
              ? <BellOff size={14} aria-hidden="true" />
              : <Bell size={14} aria-hidden="true" />}
            <span>{t(settings.showStatusBubble ? 'resources.pets.hideBubble' : 'resources.pets.showBubble')}</span>
          </button>
          <button className="is-destructive" type="button" role="menuitem" onClick={closePet}>
            <X size={14} aria-hidden="true" />
            <span>{t('resources.pets.close')}</span>
          </button>
        </div>
      ) : null}
    </>
  )
}
