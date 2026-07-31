import { ChevronDown, ChevronUp, Eye, EyeOff, Image, Maximize2, Minimize2, StickyNote, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app-shell/appStore'
import {
  formatStudyDuration,
  formatStudySeatLabel,
  randomStudySpaceCode
} from '../../study-space/domain'
import { useStudySession } from '../../study-space/session/useStudySession'
import {
  createOfficeSceneRuntime,
  type OfficeSceneRuntime,
  type OfficeSceneSeatOccupant,
  type OfficeSceneSeatState
} from './office-scene-runtime'
import { useImmersiveFocusTimerFace } from './ImmersiveFocusTimerScene'
import { ImmersiveSceneLayer, ImmersiveScenePlane } from './ImmersiveSceneLayer'
import {
  IMMERSIVE_CLOSE_FALLBACK_DURATION_MS,
  type ImmersivePhase
} from './immersive-scene-types'
import { useImmersiveCustomMedia } from './useImmersiveCustomMedia'
import { useDialogAsk } from './useDialogAsk'
import { ImmersiveScenePicker } from './ImmersiveScenePicker'
import { ClockDisplay } from './immersive-clock-display'
import { WorkbenchLeaderboard } from './WorkbenchLeaderboard'
import { useStudyRoomPresence } from '../../sync/study-room-presence'
import { useSyncState } from '../../sync/sync-store'
import type { SyncStudyRoomMember } from '../../sync/sync-api-client'
import type { StudyRoomMember } from '../../study-space/viewModel'
import { normalizePetAppearanceId } from '../../../../shared/teaching-types'
import { readBrowserNotificationPermission } from '../../study-space/planning-notification-host'
import { WorkbenchPomodoro } from './WorkbenchPomodoro'
import { EmptyStartSheet, type EmptyStartSheetResult } from './EmptyStartSheet'
import type {
  ClassificationPromptAskAnswer,
  PhasePromptAskAnswer,
  ReconcileAskAnswer,
  EmptyStartAskAnswer,
  EmptyStartPolicy,
  FutureBlocksAskAnswer
} from '../../study-space/session/useStudySession'
import { FutureBlocksDecisionSheet, type FutureBlocksDecisionSheetResult } from './FutureBlocksDecisionSheet'
import {
  ClassificationPromptSheet,
  type ClassificationPromptSheetResult
} from './ClassificationPromptSheet'
import {
  PhasePromptSheet,
  type PhasePromptSheetResult
} from './PhasePromptSheet'
import {
  ReconcileSheet,
  type ReconcileSheetResult
} from './ReconcileSheet'
import type { TimerSessionRecord } from '../../../../shared/study-planning'
import {
  BatchClassifySheet,
  type BatchClassifySheetResult
} from './BatchClassifySheet'
import { MigrationBannerSheet, type MigrationBannerSheetResult } from './MigrationBannerSheet'
import { V1AuthorityDemoteSheet, type V1AuthorityDemoteSheetResult } from './V1AuthorityDemoteSheet'
import { buildV1DemoteBannerModel } from '../../study-space/planning-v1-authority-demote'
import { buildMigrationBannerModel } from '../../study-space/planning-migration-banner'
import { listStudyTaskCategories } from '../../study-space/taskCategories'
import { WorkbenchTasks } from './WorkbenchTasks'
import { WorkbenchMusicPlayer } from './WorkbenchMusicPlayer'
import { StudyTaskSchedulePage } from './StudyTaskSchedulePage'
import { StudyAnalyticsPage, type StudyAnalyticsPageProps } from './analytics/StudyAnalyticsPage'
import {
  navigateWorkbenchRoute,
  parseWorkbenchRoute,
  type WorkbenchRoute
} from './workbenchRoute'
import './workbench-analytics-entry.css'

type DeskId = `desk-${number}`

// OfficeSceneRuntime owns browser asset loading: new URL('../../assets/images/workbench/ref.png', import.meta.url).
// Its canvas draw loop renders every desk with drawDeskImage(ctx, assets.deskImage, slot).
const workbenchSeatCount = 12
const clockRefreshIntervalMs = 1_000

function deskIdForSeatIndex(seatIndex: number): DeskId {
  return `desk-${seatIndex + 1}`
}

type OfficeWorkbenchProps = {
  showNotification: (title: string, body: string) => Promise<void>
}

export type WorkbenchAnalyticsPageProps = StudyAnalyticsPageProps

const WorkbenchAnalyticsPage = StudyAnalyticsPage

/**
 * Map a server-side study-room member (phone / other devices) into the
 * desktop leaderboard/scene shape. The server-provided identity fields are
 * authoritative for public room display; relay-only fields get neutral values.
 */
function mapServerMemberToRoomMember(member: SyncStudyRoomMember): StudyRoomMember {
  return {
    clientId: `server:${member.userId}`,
    roomId: 'silent',
    spaceCode: '',
    nickname: member.nickname?.trim() || '匿名同学',
    petAppearance: normalizePetAppearanceId(member.petAppearance),
    signalId: 'practice',
    seatIndex: -1,
    seatClaimedAt: 0,
    status: member.status === 'studying' ? 'running' : 'idle',
    timerMode: 'focus',
    focusMinutes: 0,
    todayFocusSeconds: member.focusSecondsToday ?? 0,
    todaySessions: 0,
    streakDays: 0,
    updatedAt: Date.now(),
    isSelf: false
  }
}

/** Translate the local timer state/mode into the server presence status vocabulary. */
function deriveServerPresenceStatus(
  timerState: 'idle' | 'running' | 'paused',
  timerMode: 'focus' | 'break'
): 'studying' | 'break' | 'idle' {
  if (timerState === 'running' && timerMode === 'focus') return 'studying'
  if (timerMode === 'break' && timerState !== 'idle') return 'break'
  return 'idle'
}

/**
 * Merge server-backed members into the relay-based leaderboard.
 *
 * Additive only: server members whose nickname is not already present locally
 * are appended, then the combined list is re-sorted by today's focus. The
 * server's own self row is skipped (the local self row is authoritative).
 * Returns the local list unchanged when there is nothing to merge, so the
 * leaderboard is fully inert when sync is not logged in.
 */
function mergeServerMembers(
  local: StudyRoomMember[],
  server: SyncStudyRoomMember[],
  authenticatedNickname?: string | null
): StudyRoomMember[] {
  const serverSelf = server.find((member) => member.isSelf)
  const withAuthenticatedSelfName = local.map((member) => {
    if (!member.isSelf) return member
    return {
      ...member,
      nickname: serverSelf?.nickname?.trim() || authenticatedNickname?.trim() || member.nickname,
      petAppearance: serverSelf
        ? normalizePetAppearanceId(serverSelf.petAppearance, member.petAppearance)
        : member.petAppearance
    }
  })
  if (server.length === 0) return withAuthenticatedSelfName
  const seen = new Set(withAuthenticatedSelfName.map((member) => member.nickname))
  const added: StudyRoomMember[] = []
  for (const member of server) {
    if (member.isSelf) continue
    const nickname = member.nickname?.trim() || '匿名同学'
    if (seen.has(nickname)) continue
    seen.add(nickname)
    added.push(mapServerMemberToRoomMember(member))
  }
  if (added.length === 0) return withAuthenticatedSelfName
  return [...withAuthenticatedSelfName, ...added].sort(
    (left, right) => right.todayFocusSeconds - left.todayFocusSeconds
  )
}

export function OfficeWorkbench({ showNotification }: OfficeWorkbenchProps) {
  const petAppearance = useAppStore((state) => state.settings.pet.appearance)
  const workspaceRoot = useAppStore((state) => state.appState.activeWorkspace?.rootPath ?? null)
  const emptyStartDialog = useDialogAsk<EmptyStartPolicy | null, EmptyStartSheetResult>()
  const futureBlocksDialog = useDialogAsk<
    { taskId: string; taskTitle: string; futureBlockIds: string[] },
    FutureBlocksDecisionSheetResult
  >()
  const classificationDialog = useDialogAsk<
    { taskId: string; taskTitle: string },
    ClassificationPromptSheetResult
  >()
  const phasePromptDialog = useDialogAsk<{ completed: TimerSessionRecord }, PhasePromptSheetResult>()
  const reconcileDialog = useDialogAsk<
    { session: TimerSessionRecord; gapSeconds: number },
    ReconcileSheetResult
  >()
  const [batchClassifyOpen, setBatchClassifyOpen] = useState(false)
  const [batchClassifyTaskIds, setBatchClassifyTaskIds] = useState<string[]>([])

  const askEmptyStart = useCallback((policy: EmptyStartPolicy): Promise<EmptyStartAskAnswer | null> => {
    void policy
    return emptyStartDialog.ask(policy).then((result) => {
      if (result.choice === 'cancel') {
        return null
      }
      if (result.choice === 'pick_task') {
        return { choice: 'pick_task', taskId: result.taskId }
      }
      if (result.choice === 'quick_start') {
        return { choice: 'quick_start', title: result.title }
      }
      return { choice: 'unattributed' }
    })
  }, [emptyStartDialog.ask])

  const handleEmptyStartResolve = useCallback(
    (result: EmptyStartSheetResult) => {
      emptyStartDialog.resolve(result)
    },
    [emptyStartDialog.resolve]
  )

  const askFutureBlocks = useCallback(
    (input: {
      taskId: string
      taskTitle: string
      futureBlockIds: string[]
    }): Promise<FutureBlocksAskAnswer | null> => {
      return futureBlocksDialog.ask(input).then((result) => {
        if (result.choice === 'dismiss') {
          return { decision: 'dismiss' }
        }
        return {
          decision: result.choice,
          ...(result.choice === 'reassign' && result.reassignTaskId
            ? { reassignTaskId: result.reassignTaskId }
            : {})
        }
      })
    },
    [futureBlocksDialog.ask]
  )

  const handleFutureBlocksResolve = useCallback(
    (result: FutureBlocksDecisionSheetResult) => {
      futureBlocksDialog.resolve(result)
    },
    [futureBlocksDialog.resolve]
  )

  const askClassificationPrompt = useCallback(
    (input: { taskId: string; taskTitle: string }): Promise<ClassificationPromptAskAnswer | null> => {
      return classificationDialog.ask(input).then((result) => {
        if (result.action === 'classify') {
          return { action: 'classify', categoryId: result.categoryId }
        }
        return { action: result.action }
      })
    },
    [classificationDialog.ask]
  )

  const handleClassificationPromptResolve = useCallback(
    (result: ClassificationPromptSheetResult) => {
      classificationDialog.resolve(result)
    },
    [classificationDialog.resolve]
  )

  const askPhasePrompt = useCallback(
    (input: { completed: TimerSessionRecord }): Promise<PhasePromptAskAnswer | null> => {
      return phasePromptDialog.ask(input).then((result) => {
        if (result.action === 'extend_and_start') {
          return { action: 'extend_and_start', extendMinutes: result.extendMinutes }
        }
        return { action: result.action }
      })
    },
    [phasePromptDialog.ask]
  )

  const handlePhasePromptResolve = useCallback(
    (result: PhasePromptSheetResult) => {
      phasePromptDialog.resolve(result)
    },
    [phasePromptDialog.resolve]
  )

  const askReconcile = useCallback(
    (input: {
      session: TimerSessionRecord
      gapSeconds: number
    }): Promise<ReconcileAskAnswer | null> => {
      return reconcileDialog.ask(input).then((result) => ({ action: result.action }))
    },
    [reconcileDialog.ask]
  )

  const handleReconcileResolve = useCallback(
    (result: ReconcileSheetResult) => {
      reconcileDialog.resolve(result)
    },
    [reconcileDialog.resolve]
  )

  // STC-601/605 live signals for lifecycle notifications (read by getter at dispatch time).
  const notificationHostLiveRef = useRef({
    fullscreen: false,
    notificationsEnabled: true as boolean,
    quietUntilMs: null as number | null,
    systemPermission: 'default' as 'granted' | 'denied' | 'default' | 'unsupported'
  })
  const notificationsEnabled = useAppStore((state) => state.settings.notifications.enabled)
  const quietUntilMs = useAppStore((state) => state.settings.pet.notificationPreferences.quietUntil)

  const {
    snapshot,
    presence,
    viewModel,
    selectedTaskId,
    selectTask,
    joinSpace,
    toggleTimer,
    resetTimer,
    startTimerInMode,
    saveTimerPlan,
    applyTimerPlan,
    removeTimerPlan,
    copyTimerPlan,
    renameTimerPlan,
    setDefaultTimerPlan,
    defaultTimerPlanId,
    emptyStartPolicy,
    emptyStartCategoryId,
    setEmptyStartCategoryIdPreference,
    addScheduledTask,
    updateTask,
    toggleTask,
    removeTask,
    batchClassifyTasks,
    scheduleBlocks,
    canonicalCategories,
    activeTimerSession,
    extendActiveTimerTarget,
    migrationOffer,
    migrationBusy,
    migrationError,
    confirmMigrationOffer,
    dismissMigrationOffer,
    v1DemoteOffer,
    v1DemoteBusy,
    v1DemoteError,
    confirmV1DemoteOffer,
    dismissV1DemoteOffer
  } = useStudySession({
    showNotification,
    openFocusTheater: () => {},
    workspaceRoot,
    onEmptyStartAsk: askEmptyStart,
    onFutureBlocksNeedDecision: askFutureBlocks,
    onClassificationPromptAsk: askClassificationPrompt,
    onPhasePromptAsk: askPhasePrompt,
    onReconcileAsk: askReconcile,
    getNotificationHostContext: () => notificationHostLiveRef.current
  })

  // STC sync: join a server-backed study room so phone + desktop share one
  // leaderboard. It only adds server members on top of local relay peers.
  const syncState = useSyncState()
  const studyRoomPresence = useStudyRoomPresence({
    roomId: snapshot.spaceCode,
    nickname: syncState.user?.nickname ?? snapshot.nickname,
    avatarUrl: syncState.user?.avatarUrl,
    petAppearance,
    focusSecondsToday: snapshot.todayFocusSeconds,
    status: deriveServerPresenceStatus(snapshot.timerState, snapshot.timerMode),
    active: Boolean(syncState.accessToken),
    onAssignedRoom: joinSpace
  })
  const leaderboardMembers = mergeServerMembers(
    viewModel.roomMembers,
    studyRoomPresence.members,
    syncState.user?.nickname
  )

  const handleEnterRandomSpace = useCallback(() => {
    const fallbackRoomId = randomStudySpaceCode()
    void (async () => {
      const roomId = await studyRoomPresence.assignAndJoinRoom({
        fallbackRoomId,
        currentRoomId: snapshot.spaceCode,
      })
      // When offline or the assignment request fails, preserve the previous
      // local-only behaviour rather than blocking the room switcher.
      const selectedRoomId = roomId ?? fallbackRoomId
      if (selectedRoomId !== snapshot.spaceCode) joinSpace(selectedRoomId)
    })()
  }, [joinSpace, snapshot.spaceCode, studyRoomPresence])

  const openBatchClassify = useCallback((taskIds: string[]) => {
    const ids = taskIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
    if (ids.length === 0) return
    setBatchClassifyTaskIds(ids)
    setBatchClassifyOpen(true)
  }, [])

  const handleBatchClassifyResolve = useCallback(
    (result: BatchClassifySheetResult) => {
      setBatchClassifyOpen(false)
      setBatchClassifyTaskIds([])
      if (result.action !== 'classify') return
      batchClassifyTasks(result.taskIds, result.categoryId)
    },
    [batchClassifyTasks]
  )

  const handleMigrationBannerResolve = useCallback(
    (result: MigrationBannerSheetResult) => {
      if (result.choice === 'confirm') {
        void confirmMigrationOffer()
        return
      }
      dismissMigrationOffer(result.choice === 'dismiss' ? 'dismiss' : 'later')
    },
    [confirmMigrationOffer, dismissMigrationOffer]
  )

  const handleV1DemoteSheetResolve = useCallback(
    (result: V1AuthorityDemoteSheetResult) => {
      if (result.choice === 'confirm') {
        void confirmV1DemoteOffer()
        return
      }
      dismissV1DemoteOffer(result.choice === 'dismiss' ? 'dismiss' : 'later')
    },
    [confirmV1DemoteOffer, dismissV1DemoteOffer]
  )
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<OfficeSceneRuntime | null>(null)
  const analyticsButtonRef = useRef<HTMLButtonElement | null>(null)
  const immersiveToggleRef = useRef<HTMLButtonElement | null>(null)
  const fullscreenButtonRef = useRef<HTMLButtonElement | null>(null)
  const immersiveCloseTimerRef = useRef<number | null>(null)
  const immersivePhaseRef = useRef<ImmersivePhase>('closed')
  const immersiveCloseRequestedRef = useRef(false)
  const fullscreenWasActiveRef = useRef(false)
  const fullscreenTransitionRef = useRef(false)
  const fullscreenReturnFocusRef = useRef<HTMLElement | null>(null)
  const suppressFullscreenFocusRestoreRef = useRef(false)
  const restoreAnalyticsFocusRef = useRef(false)
  const routeRef = useRef<WorkbenchRoute>(parseWorkbenchRoute(window.location.search))
  const isWorkbenchMountedRef = useRef(true)
  const [openTasksPanelForAnalytics, setOpenTasksPanelForAnalytics] = useState(false)
  const [route, setRoute] = useState<WorkbenchRoute>(() => parseWorkbenchRoute(window.location.search))
  const [immersivePhase, setImmersivePhase] = useState<ImmersivePhase>('closed')
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [areRoomCardsHidden, setAreRoomCardsHidden] = useState(false)
  const [isQuickNoteOpen, setIsQuickNoteOpen] = useState(false)
  const [isScenePickerOpen, setIsScenePickerOpen] = useState(false)
  const {
    immersiveScene,
    customImmersiveMediaList,
    editingCustomSceneId,
    customSceneNameDraft,
    isSceneDropActive,
    sceneFileInputRef,
    setIsSceneDropActive,
    setCustomSceneNameDraft,
    setEditingCustomSceneId,
    applyCustomImmersiveMedia,
    selectImmersiveScene,
    removeCustomImmersiveMedia,
    startCustomSceneNameEditing,
    finishCustomSceneNameEditing
  } = useImmersiveCustomMedia()
  const [clockState, setClockState] = useState(() => ({
    current: new Date(),
    previous: null as Date | null
  }))
  const [quickNote, setQuickNote] = useState('')
  const [isTaskAddEditorOpen, setIsTaskAddEditorOpen] = useState(false)
  const [isImmersiveArcPointerActive, setIsImmersiveArcPointerActive] = useState(false)
  const [isImmersiveArcFocusActive, setIsImmersiveArcFocusActive] = useState(false)

  useEffect(() => {
    notificationHostLiveRef.current = {
      fullscreen: isFullscreen,
      notificationsEnabled,
      quietUntilMs,
      systemPermission: readBrowserNotificationPermission()
    }
  }, [isFullscreen, notificationsEnabled, quietUntilMs])

  const workbenchUserSeatIndex = viewModel.userSeat < workbenchSeatCount ? viewModel.userSeat : -1
  const clockTime = clockState.current
  const occupantsByDeskId = new Map<DeskId, OfficeSceneSeatOccupant>()

  if (!viewModel.userSeatConflict && workbenchUserSeatIndex >= 0) {
    occupantsByDeskId.set(deskIdForSeatIndex(workbenchUserSeatIndex), {
      kind: 'self',
      name: snapshot.nickname,
      petAppearance,
      status: snapshot.timerState,
      timerMode: snapshot.timerMode,
      todayFocusSeconds: snapshot.todayFocusSeconds
    })
  }
  viewModel.peersBySeat.forEach((peer, seatIndex) => {
    if (seatIndex >= workbenchSeatCount) return
    const deskId = deskIdForSeatIndex(seatIndex)
    if (occupantsByDeskId.has(deskId)) return
    occupantsByDeskId.set(deskId, {
      kind: 'peer',
      name: peer.nickname,
      petAppearance: peer.petAppearance,
      status: peer.status,
      timerMode: peer.timerMode,
      todayFocusSeconds: peer.todayFocusSeconds
    })
  })
  // Server-only peers (for example a phone user) do not have a public-relay
  // seat claim. Show them in the remaining desks so their own selected pet is
  // still represented in the shared self-study room.
  let nextServerSeat = 0
  for (const member of leaderboardMembers) {
    if (member.isSelf || member.seatIndex >= 0) continue
    while (nextServerSeat < workbenchSeatCount && occupantsByDeskId.has(deskIdForSeatIndex(nextServerSeat))) {
      nextServerSeat += 1
    }
    if (nextServerSeat >= workbenchSeatCount) break
    occupantsByDeskId.set(deskIdForSeatIndex(nextServerSeat), {
      kind: 'peer',
      name: member.nickname,
      petAppearance: member.petAppearance,
      status: member.status,
      timerMode: member.timerMode,
      todayFocusSeconds: member.todayFocusSeconds
    })
    nextServerSeat += 1
  }
  const seatState: OfficeSceneSeatState = {
    userSeatIndex: viewModel.userSeatConflict ? -1 : workbenchUserSeatIndex,
    activeRoomName: viewModel.activeRoom.name,
    connectionLabel: viewModel.connectionLabel,
    cycleLabel: `${viewModel.roomCycle.phase === 'focus' ? '专注中' : '休息中'} · ${formatStudyDuration(viewModel.roomCycle.remainingSeconds)}`,
    occupantsByDeskId
  }

  routeRef.current = route

  useEffect(() => {
    isWorkbenchMountedRef.current = true
    return () => {
      isWorkbenchMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    navigateWorkbenchRoute(route, 'replace')
  }, [])

  useEffect(() => {
    const refreshClock = (): void => {
      setClockState((clock) => ({ current: new Date(), previous: clock.current }))
    }
    const millisecondsUntilNextTick = clockRefreshIntervalMs - (Date.now() % clockRefreshIntervalMs)
    let intervalId: number | undefined
    const timeoutId = window.setTimeout(() => {
      refreshClock()
      intervalId = window.setInterval(refreshClock, clockRefreshIntervalMs)
    }, millisecondsUntilNextTick)

    return () => {
      window.clearTimeout(timeoutId)
      if (intervalId !== undefined) window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = parseWorkbenchRoute(window.location.search)
      setRoute((currentRoute) => {
        if (currentRoute === 'analytics' && nextRoute === 'room') {
          restoreAnalyticsFocusRef.current = true
          setOpenTasksPanelForAnalytics(true)
        }
        return nextRoute
      })
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (route !== 'room' || !restoreAnalyticsFocusRef.current) return
    restoreAnalyticsFocusRef.current = false
    analyticsButtonRef.current?.focus({ preventScroll: true })
    setOpenTasksPanelForAnalytics(false)
  }, [route])

  const openTaskSchedule = (): void => {
    navigateWorkbenchRoute('schedule')
    setRoute('schedule')
  }

  const openTaskAddEditor = (): void => {
    setIsTaskAddEditorOpen(true)
  }

  const closeTaskAddEditor = (): void => {
    setIsTaskAddEditorOpen(false)
  }

  const closeTaskSchedule = (): void => {
    navigateWorkbenchRoute('room', 'replace')
    setRoute('room')
  }

  const openStudyAnalytics = (): void => {
    navigateWorkbenchRoute('analytics')
    setRoute('analytics')
  }

  const closeStudyAnalytics = (): void => {
    restoreAnalyticsFocusRef.current = true
    setOpenTasksPanelForAnalytics(true)
    navigateWorkbenchRoute('room', 'replace')
    setRoute('room')
  }

  useEffect(() => {
    if (route !== 'room') return
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return

    const runtime = createOfficeSceneRuntime({
      stage,
      canvas,
      petAppearance
    })
    runtimeRef.current = runtime
    runtime.mount()
    runtime.update(seatState)

    return () => {
      runtime.dispose()
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [route, petAppearance])

  useEffect(() => {
    runtimeRef.current?.update(seatState)
  }, [seatState])

  const clearImmersiveCloseTimer = useCallback((): void => {
    if (immersiveCloseTimerRef.current === null) return
    window.clearTimeout(immersiveCloseTimerRef.current)
    immersiveCloseTimerRef.current = null
  }, [])

  const focusImmersiveControl = useCallback((target: HTMLElement | null): void => {
    window.requestAnimationFrame(() => {
      if (!target?.isConnected) return
      target.focus({ preventScroll: true })
    })
  }, [])

  const resetImmersiveArc = useCallback((): void => {
    setIsImmersiveArcPointerActive(false)
    setIsImmersiveArcFocusActive(false)
  }, [])

  const immersiveFocusTimerFace = useImmersiveFocusTimerFace({
    snapshot,
    defaultTimerPlanId,
    activeTimerSession,
    timerProgress: viewModel.timerProgress
  })

  const openImmersive = useCallback((): void => {
    clearImmersiveCloseTimer()
    immersiveCloseRequestedRef.current = false
    immersivePhaseRef.current = 'open'
    setImmersivePhase('open')
    // Do not force the fan open or closed: pointer/focus handlers already own expand state.
  }, [clearImmersiveCloseTimer])

  const finishImmersiveClose = useCallback((): void => {
    clearImmersiveCloseTimer()
    if (!isWorkbenchMountedRef.current || routeRef.current !== 'room') return
    if (immersivePhaseRef.current !== 'closing') return
    immersivePhaseRef.current = 'closed'
    setImmersivePhase('closed')
    focusImmersiveControl(immersiveToggleRef.current)
  }, [clearImmersiveCloseTimer, focusImmersiveControl])

  const clearFullscreenSession = useCallback((options?: { suppressFocusRestore?: boolean }): void => {
    fullscreenWasActiveRef.current = false
    fullscreenTransitionRef.current = false
    fullscreenReturnFocusRef.current = null
    suppressFullscreenFocusRestoreRef.current = options?.suppressFocusRestore ?? false
    setIsFullscreen(false)
  }, [])

  const beginImmersiveClose = useCallback((): void => {
    // Ignore late async completions after route leave / unmount.
    if (!isWorkbenchMountedRef.current || routeRef.current !== 'room') return
    if (immersivePhaseRef.current === 'closed') return

    clearImmersiveCloseTimer()
    immersiveCloseRequestedRef.current = false
    immersivePhaseRef.current = 'closing'
    setAreRoomCardsHidden(false)
    setIsQuickNoteOpen(false)
    setIsScenePickerOpen(false)
    resetImmersiveArc()
    setImmersivePhase('closing')
    immersiveCloseTimerRef.current = window.setTimeout(
      finishImmersiveClose,
      IMMERSIVE_CLOSE_FALLBACK_DURATION_MS
    )
  }, [clearImmersiveCloseTimer, finishImmersiveClose, resetImmersiveArc])

  const closeImmersive = useCallback((): void => {
    if (immersivePhaseRef.current !== 'open' || immersiveCloseRequestedRef.current) return

    const stage = stageRef.current
    const ownsFullscreen = (
      document.fullscreenElement != null &&
      stage != null &&
      document.fullscreenElement === stage
    )

    if (ownsFullscreen) {
      // Share the transition lock with toggleFullscreen so enter/exit cannot race.
      if (fullscreenTransitionRef.current) return
      immersiveCloseRequestedRef.current = true
      suppressFullscreenFocusRestoreRef.current = true
      fullscreenTransitionRef.current = true
      void document.exitFullscreen()
        .then(() => {
          fullscreenTransitionRef.current = false
          beginImmersiveClose()
        })
        .catch(() => {
          immersiveCloseRequestedRef.current = false
          suppressFullscreenFocusRestoreRef.current = false
          fullscreenTransitionRef.current = false
          if (!isWorkbenchMountedRef.current || routeRef.current !== 'room') return
          focusImmersiveControl(fullscreenButtonRef.current)
        })
      return
    }

    beginImmersiveClose()
  }, [beginImmersiveClose, focusImmersiveControl])

  const toggleImmersive = (): void => {
    if (immersivePhase === 'closed') {
      openImmersive()
    } else if (immersivePhase === 'open') {
      closeImmersive()
    }
  }

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    if (fullscreenTransitionRef.current) return
    const stage = stageRef.current
    if (!stage || routeRef.current !== 'room') return

    fullscreenTransitionRef.current = true
    try {
      if (document.fullscreenElement != null && document.fullscreenElement === stage) {
        await document.exitFullscreen()
      } else {
        const activeElement = document.activeElement
        fullscreenReturnFocusRef.current = activeElement instanceof HTMLElement
          ? activeElement
          : fullscreenButtonRef.current
        suppressFullscreenFocusRestoreRef.current = false
        await stage.requestFullscreen()
      }
    } catch {
      fullscreenReturnFocusRef.current = null
      // Fullscreen is controlled by the browser/Electron host and may be unavailable.
      // Keep immersive mode intact; the exit control remains reachable via hover/focus.
      if (
        document.fullscreenElement != null &&
        document.fullscreenElement === stageRef.current
      ) {
        focusImmersiveControl(fullscreenButtonRef.current)
      }
    } finally {
      fullscreenTransitionRef.current = false
    }
  }, [focusImmersiveControl])

  useEffect(() => {
    const syncFullscreenState = (): void => {
      const fullscreenElement = document.fullscreenElement
      const stage = stageRef.current
      // Ownership requires a real fullscreen element. Never treat null === null
      // (common after stage unmount / route leave) as still owning fullscreen.
      const stageOwnsFullscreen = (
        fullscreenElement != null &&
        stage != null &&
        fullscreenElement === stage
      )
      const stagePreviouslyOwnedFullscreen = fullscreenWasActiveRef.current
      // Ignore duplicate fullscreenchange events that do not change ownership.
      if (stageOwnsFullscreen === stagePreviouslyOwnedFullscreen) return

      fullscreenWasActiveRef.current = stageOwnsFullscreen
      setIsFullscreen(stageOwnsFullscreen)

      if (stageOwnsFullscreen) {
        // Do not pin the fan open after entering fullscreen. A click leaves focus on
        // the button; blur it so the arc collapses with pointer leave like peers.
        if (document.activeElement === fullscreenButtonRef.current) {
          fullscreenButtonRef.current?.blur()
        }
        setIsImmersiveArcFocusActive(false)
        return
      }

      if (suppressFullscreenFocusRestoreRef.current) {
        suppressFullscreenFocusRestoreRef.current = false
        fullscreenReturnFocusRef.current = null
        return
      }

      // Leaving fullscreen: keep the fan hover/focus gated (no forced pin).
      fullscreenReturnFocusRef.current = null
      setIsImmersiveArcFocusActive(false)
    }
    syncFullscreenState()
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [focusImmersiveControl])

  useEffect(() => {
    if (route !== 'room') {
      // Capture ownership before clearing local flags so exit still runs after unmount.
      const fullscreenElement = document.fullscreenElement
      const ownedFullscreen = (
        fullscreenElement != null && (
          (stageRef.current != null && fullscreenElement === stageRef.current) ||
          fullscreenWasActiveRef.current
        )
      )

      clearImmersiveCloseTimer()
      immersiveCloseRequestedRef.current = false
      immersivePhaseRef.current = 'closed'
      setAreRoomCardsHidden(false)
      setIsQuickNoteOpen(false)
      setIsScenePickerOpen(false)
      resetImmersiveArc()
      setImmersivePhase('closed')
      // Always clear React fullscreen state/refs on leave (success, auto-exit, or reject).
      clearFullscreenSession({ suppressFocusRestore: ownedFullscreen })

      if (ownedFullscreen) {
        void document.exitFullscreen()
          .then(() => {
            clearFullscreenSession()
          })
          .catch(() => {
            // Keep the local session clean even when the host rejects exit.
            clearFullscreenSession()
            immersiveCloseRequestedRef.current = false
          })
      }
    }
  }, [clearFullscreenSession, clearImmersiveCloseTimer, resetImmersiveArc, route])

  useEffect(() => {
    if (immersivePhase !== 'open') return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (
        document.fullscreenElement != null &&
        stageRef.current != null &&
        document.fullscreenElement === stageRef.current
      ) return
      event.preventDefault()
      if (isScenePickerOpen) {
        setIsScenePickerOpen(false)
        return
      }
      if (isQuickNoteOpen) {
        setIsQuickNoteOpen(false)
        return
      }
      closeImmersive()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeImmersive, immersivePhase, isQuickNoteOpen, isScenePickerOpen])

  useEffect(() => clearImmersiveCloseTimer, [clearImmersiveCloseTimer])

  // Arc actions (including fullscreen) are hover/focus gated in both room and
  // immersive modes so the bottom of the stage stays clear when the pointer leaves.
  const isImmersiveArcActive =
    isImmersiveArcPointerActive || isImmersiveArcFocusActive

  if (route === 'analytics') {
    return (
      <section className="office-workbench-page workbench-analytics-route" aria-label="学习分析">
        <WorkbenchAnalyticsPage onBack={closeStudyAnalytics} />
      </section>
    )
  }

  if (route === 'schedule') {
    return (
      <section className="office-workbench-page" aria-label="任务详情">
        <StudyTaskSchedulePage
          tasks={snapshot.tasks}
          openTasks={viewModel.openTasks}
          completedTasks={viewModel.completedTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={selectTask}
          onAddScheduledTask={addScheduledTask}
          onUpdateTask={updateTask}
          onToggleTask={toggleTask}
          onRemoveTask={removeTask}
          onBack={closeTaskSchedule}
          scheduleBlocks={scheduleBlocks}
          planningContext={{
            workspaceRoot,
            api:
              typeof window !== 'undefined'
                ? (window.teachingSystem as import('../../study-space/planning-client').StudyPlanningApi | undefined) ?? null
                : null
          }}
          canonicalCategories={canonicalCategories}
        />
      </section>
    )
  }

  return (
    <section className="office-workbench-page" aria-label="自习室">
      <div
        ref={stageRef}
        className={`office-workbench-stage${immersivePhase !== 'closed' ? ' is-immersive' : ''}${areRoomCardsHidden ? ' are-room-cards-hidden' : ''}`}
      >
        <canvas
          ref={canvasRef}
          className="office-workbench-canvas"
          aria-label="StudiumX 自习室：系统已自动分配座位"
          aria-live="polite"
        />
        <WorkbenchLeaderboard
          members={leaderboardMembers}
          presenceStatus={presence.status}
          spaceCode={snapshot.spaceCode}
          onEnterRandomSpace={handleEnterRandomSpace}
          onJoinSpace={joinSpace}
        />
        <div className="workbench-tools" role="group" aria-label="自习工具">
          {viewModel.userSeatConflict ? (
            <div className="workbench-seat-alert" role="status">
              {viewModel.nextAvailableSeat === null
                ? '当前座位已被更早入座的同学占用，房间暂无空座。'
                : `座位冲突，正在换到 ${formatStudySeatLabel(viewModel.nextAvailableSeat)}。`}
            </div>
          ) : null}
          <WorkbenchPomodoro
            snapshot={snapshot}
            timerProgress={viewModel.timerProgress}
            selectedTaskId={selectedTaskId}
            defaultTimerPlanId={defaultTimerPlanId}
            emptyStartCategoryId={emptyStartCategoryId}
            emptyStartCategoryOptions={(canonicalCategories ?? listStudyTaskCategories()).map((c) => ({
              value: c.id,
              label: c.name
            }))}
            activeTimerSession={activeTimerSession}
            onToggleTimer={toggleTimer}
            onResetTimer={resetTimer}
            onStartTimerInMode={startTimerInMode}
            onSaveTimerPlan={saveTimerPlan}
            onApplyTimerPlan={applyTimerPlan}
            onRemoveTimerPlan={removeTimerPlan}
            onCopyTimerPlan={copyTimerPlan}
            onRenameTimerPlan={renameTimerPlan}
            onSetDefaultTimerPlan={setDefaultTimerPlan}
            onEmptyStartCategoryIdChange={setEmptyStartCategoryIdPreference}
            onExtendActiveTimer={(minutes) => {
              extendActiveTimerTarget({ addMinutes: minutes })
            }}
          />
          <WorkbenchTasks
            tasks={snapshot.tasks}
            openTasks={viewModel.openTasks}
            completedTasks={viewModel.completedTasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={selectTask}
            onToggleTask={toggleTask}
            onRemoveTask={removeTask}
            onOpenSchedule={openTaskSchedule}
            onOpenAddTask={openTaskAddEditor}
            onOpenAnalytics={openStudyAnalytics}
            analyticsButtonRef={analyticsButtonRef}
            defaultOpen={openTasksPanelForAnalytics}
            activeTimer={
              selectedTaskId
              && (snapshot.timerState === 'running' || snapshot.timerState === 'paused')
                ? { taskId: selectedTaskId, state: snapshot.timerState }
                : null
            }
            onOpenBatchClassify={openBatchClassify}
          />
        </div>
        <EmptyStartSheet
          open={emptyStartDialog.open}
          policy={emptyStartPolicy}
          openTasks={snapshot.tasks.filter((task) => !task.done).map((task) => ({
            id: task.id,
            title: task.title
          }))}
          onResolve={handleEmptyStartResolve}
        />

      <FutureBlocksDecisionSheet
        open={futureBlocksDialog.open}
        taskId={futureBlocksDialog.payload?.taskId ?? ''}
        taskTitle={futureBlocksDialog.payload?.taskTitle ?? ''}
        futureBlockIds={futureBlocksDialog.payload?.futureBlockIds ?? []}
        reassignCandidates={snapshot.tasks
          .filter((t) => !t.done && t.id !== futureBlocksDialog.payload?.taskId)
          .map((t) => ({ id: t.id, title: t.title }))}
        onResolve={handleFutureBlocksResolve}
      />

      <ClassificationPromptSheet
        open={classificationDialog.open}
        taskId={classificationDialog.payload?.taskId ?? ''}
        taskTitle={classificationDialog.payload?.taskTitle ?? ''}
        categories={listStudyTaskCategories().map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color
        }))}
        onResolve={handleClassificationPromptResolve}
      />

      <PhasePromptSheet
        open={phasePromptDialog.open}
        completed={phasePromptDialog.payload?.completed ?? null}
        onResolve={handlePhasePromptResolve}
      />

      <ReconcileSheet
        open={reconcileDialog.open}
        session={reconcileDialog.payload?.session ?? null}
        gapSeconds={reconcileDialog.payload?.gapSeconds ?? 0}
        onResolve={handleReconcileResolve}
      />

      <BatchClassifySheet
        open={batchClassifyOpen}
        tasks={snapshot.tasks.map((t) => ({ id: t.id, title: t.title }))}
        taskIds={batchClassifyTaskIds}
        categories={listStudyTaskCategories().map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color
        }))}
        onResolve={handleBatchClassifyResolve}
      />

      <MigrationBannerSheet
        open={Boolean(migrationOffer)}
        model={
          migrationOffer
            ? buildMigrationBannerModel({
                summary: migrationOffer.summary,
                busy: migrationBusy
              })
            : null
        }
        busy={migrationBusy}
        errorMessage={migrationError}
        onResolve={handleMigrationBannerResolve}
      />

      <V1AuthorityDemoteSheet
        open={Boolean(v1DemoteOffer)}
        model={
          v1DemoteOffer
            ? buildV1DemoteBannerModel({
                summary: v1DemoteOffer,
                busy: v1DemoteBusy
              })
            : null
        }
        busy={v1DemoteBusy}
        errorMessage={v1DemoteError}
        onResolve={handleV1DemoteSheetResolve}
      />

        {isTaskAddEditorOpen ? (
          <div className="office-workbench-task-add-overlay">
            <StudyTaskSchedulePage
              tasks={snapshot.tasks}
              openTasks={viewModel.openTasks}
              completedTasks={viewModel.completedTasks}
              onAddScheduledTask={addScheduledTask}
              onUpdateTask={updateTask}
              onToggleTask={toggleTask}
              onRemoveTask={removeTask}
              onBack={closeTaskAddEditor}
              openAddEditorOnMount
              showAddEditorOnly
              onEditorDismiss={closeTaskAddEditor}
              scheduleBlocks={scheduleBlocks}
              planningContext={{
                workspaceRoot,
                api:
                  typeof window !== 'undefined'
                    ? (window.teachingSystem as import('../../study-space/planning-client').StudyPlanningApi | undefined) ?? null
                    : null
              }}
              canonicalCategories={canonicalCategories}
                    />
          </div>
        ) : null}
        <div className="workbench-music-dock">
          <WorkbenchMusicPlayer />
        </div>
        <ImmersiveSceneLayer
          immersivePhase={immersivePhase}
          onCloseAnimationEnd={finishImmersiveClose}
        >
          <ImmersiveScenePlane
            immersiveScene={immersiveScene}
            customImmersiveMediaList={customImmersiveMediaList}
            clockTime={clockTime}
            previousClockTime={clockState.previous}
            focusTimerFace={immersiveFocusTimerFace}
            timerMode={snapshot.timerMode}
            renderClock={(time, previousTime) => (
              <ClockDisplay time={time} previousTime={previousTime} />
            )}
          />
        </ImmersiveSceneLayer>
        <div
          className={`workbench-immersive-controls${immersivePhase !== 'closed' ? ' is-open' : ''}${isFullscreen ? ' is-fullscreen' : ''}`}
          onPointerEnter={() => setIsImmersiveArcPointerActive(true)}
          onPointerLeave={(event) => {
            setIsImmersiveArcPointerActive(false)
            // Pointer-driven collapse: residual click-focus must not keep the fan latched.
            const active = document.activeElement
            if (active instanceof HTMLElement && event.currentTarget.contains(active)) {
              active.blur()
            }
            setIsImmersiveArcFocusActive(false)
          }}
          onFocusCapture={() => {
            setIsImmersiveArcFocusActive(true)
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsImmersiveArcFocusActive(false)
            }
          }}
        >
          <button
            ref={immersiveToggleRef}
            type="button"
            className="workbench-immersive-toggle"
            onClick={toggleImmersive}
            aria-controls="workbench-immersive-layer"
            aria-expanded={immersivePhase !== 'closed'}
            aria-label={immersivePhase !== 'closed' ? '收起沉浸模式' : '进入沉浸模式'}
            title={immersivePhase !== 'closed' ? '收起沉浸模式' : '进入沉浸模式'}
          >
            {immersivePhase !== 'closed' ? (
              <ChevronDown size={48} strokeWidth={1.9} aria-hidden="true" />
            ) : (
              <ChevronUp size={48} strokeWidth={1.9} aria-hidden="true" />
            )}
          </button>
          <div
            id="workbench-immersive-arc-menu"
            className={`workbench-immersive-arc-menu${isImmersiveArcActive ? ' is-active' : ''}`}
            role="group"
            aria-label="沉浸模式快捷操作"
            aria-hidden={!isImmersiveArcActive}
          >
            <button
              type="button"
              className={`workbench-immersive-arc-action workbench-immersive-arc-action--hide${areRoomCardsHidden ? ' is-active' : ''}`}
              onClick={() => setAreRoomCardsHidden((hidden) => !hidden)}
              aria-pressed={areRoomCardsHidden}
              aria-hidden={!isImmersiveArcActive}
              tabIndex={isImmersiveArcActive ? 0 : -1}
              aria-label={areRoomCardsHidden ? '显示自习室卡片' : '隐藏自习室卡片'}
              title={areRoomCardsHidden ? '显示自习室卡片' : '隐藏自习室卡片'}
            >
              {areRoomCardsHidden ? (
                <Eye size={20} strokeWidth={2} aria-hidden="true" />
              ) : (
                <EyeOff size={20} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className={`workbench-immersive-arc-action workbench-immersive-arc-action--note${isQuickNoteOpen ? ' is-active' : ''}`}
              onClick={() => setIsQuickNoteOpen((open) => !open)}
              aria-pressed={isQuickNoteOpen}
              aria-hidden={!isImmersiveArcActive}
              tabIndex={isImmersiveArcActive ? 0 : -1}
              aria-label="快捷记事"
              title="快捷记事"
            >
              <StickyNote size={20} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`workbench-immersive-arc-action workbench-immersive-arc-action--scene${isScenePickerOpen ? ' is-active' : ''}`}
              onClick={() => setIsScenePickerOpen(true)}
              aria-pressed={isScenePickerOpen}
              aria-hidden={!isImmersiveArcActive}
              tabIndex={isImmersiveArcActive ? 0 : -1}
              aria-label="选择场景"
              title="选择场景"
            >
              <Image size={20} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              ref={fullscreenButtonRef}
              type="button"
              className="workbench-immersive-arc-action workbench-immersive-arc-action--fullscreen"
              onClick={() => void toggleFullscreen()}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? '退出全屏' : '进入全屏'}
              title={isFullscreen ? '退出全屏' : '进入全屏'}
              tabIndex={isImmersiveArcActive ? 0 : -1}
            >
              {isFullscreen ? (
                <Minimize2 size={20} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Maximize2 size={20} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        {isScenePickerOpen ? (
          <ImmersiveScenePicker
            clockTime={clockTime}
            previousClockTime={clockState.previous}
            immersiveScene={immersiveScene}
            customImmersiveMediaList={customImmersiveMediaList}
            editingCustomSceneId={editingCustomSceneId}
            customSceneNameDraft={customSceneNameDraft}
            isSceneDropActive={isSceneDropActive}
            sceneFileInputRef={sceneFileInputRef}
            focusTimerFace={immersiveFocusTimerFace}
            onClose={() => setIsScenePickerOpen(false)}
            onSelectScene={selectImmersiveScene}
            onApplyFiles={(files) => {
              for (const file of files) applyCustomImmersiveMedia(file)
            }}
            setIsSceneDropActive={setIsSceneDropActive}
            setCustomSceneNameDraft={setCustomSceneNameDraft}
            setEditingCustomSceneId={setEditingCustomSceneId}
            startCustomSceneNameEditing={startCustomSceneNameEditing}
            finishCustomSceneNameEditing={finishCustomSceneNameEditing}
            removeCustomImmersiveMedia={removeCustomImmersiveMedia}
          />
        ) : null}
        {isQuickNoteOpen ? (
          <aside className="workbench-quick-note" aria-label="快捷记事">
            <div className="workbench-quick-note__header">
              <div>
                <StickyNote size={18} aria-hidden="true" />
                <strong>快捷记事</strong>
              </div>
              <button
                type="button"
                className="workbench-quick-note__close"
                onClick={() => setIsQuickNoteOpen(false)}
                aria-label="关闭快捷记事"
                title="关闭"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <textarea
              className="workbench-quick-note__input"
              value={quickNote}
              onChange={(event) => setQuickNote(event.target.value)}
              placeholder="记录这一刻的想法…"
              aria-label="快捷记事内容"
              autoFocus
            />
          </aside>
        ) : null}
      </div>
    </section>
  )
}
