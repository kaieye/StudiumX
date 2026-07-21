import { ChevronDown, ChevronUp, Eye, EyeOff, Image, Maximize2, Minimize2, StickyNote, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app-shell/appStore'
import girlVideo from '../../assets/videos/workbench/girl.mp4'
import {
  formatStudyDuration,
  formatStudySeatLabel
} from '../../study-space/domain'
import { useStudySession } from '../../study-space/session/useStudySession'
import {
  createOfficeSceneRuntime,
  type OfficeSceneRuntime,
  type OfficeSceneSeatOccupant,
  type OfficeSceneSeatState
} from './office-scene-runtime'
import { WorkbenchLeaderboard } from './WorkbenchLeaderboard'
import { WorkbenchPomodoro } from './WorkbenchPomodoro'
import { EmptyStartSheet, type EmptyStartSheetResult } from './EmptyStartSheet'
import type { EmptyStartAskAnswer, EmptyStartPolicy, FutureBlocksAskAnswer } from '../../study-space/session/useStudySession'
import { FutureBlocksDecisionSheet, type FutureBlocksDecisionSheetResult } from './FutureBlocksDecisionSheet'
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
const immersiveCloseFallbackDurationMs = 1_200
const clockRefreshIntervalMs = 60_000
type ImmersivePhase = 'closed' | 'open' | 'closing'
type ImmersiveScene = 'clock' | 'girl'

const immersiveSceneLabels: Record<ImmersiveScene, string> = {
  clock: '翻页时钟',
  girl: '女孩自习'
}

function deskIdForSeatIndex(seatIndex: number): DeskId {
  return `desk-${seatIndex + 1}`
}

function ClockFace({ className, value }: { className: string; value: string }) {
  return (
    <span className={`workbench-clock__face ${className}`} aria-hidden="true">
      <span className="workbench-clock__face-value">{value}</span>
    </span>
  )
}

function ClockDigit({ value, previousValue, shouldFlip }: {
  value: string
  previousValue: string
  shouldFlip: boolean
}) {
  return (
    <span className={`workbench-clock__digit${shouldFlip ? ' is-flipping' : ''}`}>
      <ClockFace className="workbench-clock__face--current-top" value={value} />
      <ClockFace className="workbench-clock__face--current-bottom" value={value} />
      {shouldFlip ? (
        <>
          <ClockFace className="workbench-clock__face--previous-top" value={previousValue} />
          <ClockFace className="workbench-clock__face--previous-bottom" value={previousValue} />
          <ClockFace className="workbench-clock__face--next-bottom" value={value} />
        </>
      ) : null}
    </span>
  )
}

function ClockDisplay({ time, previousTime }: { time: Date; previousTime: Date | null }) {
  const hours = String(time.getHours()).padStart(2, '0')
  const minutes = String(time.getMinutes()).padStart(2, '0')
  const previousHours = String(previousTime?.getHours() ?? time.getHours()).padStart(2, '0')
  const previousMinutes = String(previousTime?.getMinutes() ?? time.getMinutes()).padStart(2, '0')
  const digits = [
    { value: hours[0], previousValue: previousHours[0] },
    { value: hours[1], previousValue: previousHours[1] },
    { value: minutes[0], previousValue: previousMinutes[0] },
    { value: minutes[1], previousValue: previousMinutes[1] }
  ]
  // A real flip clock turns every card at the minute boundary—even the digits
  // that retain the same value—so use the refreshed timestamp as the card key.
  const turnKey = time.getTime()
  const shouldFlip = previousTime !== null

  return (
    <time className="workbench-clock__display" dateTime={time.toISOString()} aria-label={`当前时间 ${hours}:${minutes}`}>
      <span className="workbench-clock__pair">
        {digits.slice(0, 2).map((digit, index) => (
          <ClockDigit
            key={`hour-${index}-${turnKey}`}
            value={digit.value}
            previousValue={digit.previousValue}
            shouldFlip={shouldFlip}
          />
        ))}
      </span>
      <span className="workbench-clock__pair">
        {digits.slice(2).map((digit, index) => (
          <ClockDigit
            key={`minute-${index}-${turnKey}`}
            value={digit.value}
            previousValue={digit.previousValue}
            shouldFlip={shouldFlip}
          />
        ))}
      </span>
    </time>
  )
}

type OfficeWorkbenchProps = {
  showNotification: (title: string, body: string) => Promise<void>
}

export type WorkbenchAnalyticsPageProps = StudyAnalyticsPageProps

const WorkbenchAnalyticsPage = StudyAnalyticsPage

export function OfficeWorkbench({ showNotification }: OfficeWorkbenchProps) {
  const petAppearance = useAppStore((state) => state.settings.pet.appearance)
  const workspaceRoot = useAppStore((state) => state.appState.activeWorkspace?.rootPath ?? null)
  const emptyStartPolicy: EmptyStartPolicy = 'ask_every_time'
  const [emptyStartOpen, setEmptyStartOpen] = useState(false)
  const emptyStartResolverRef = useRef<((result: EmptyStartSheetResult) => void) | null>(null)
  const [futureBlocksOpen, setFutureBlocksOpen] = useState(false)
  const [futureBlocksPayload, setFutureBlocksPayload] = useState<{
    taskId: string
    taskTitle: string
    futureBlockIds: string[]
  } | null>(null)
  const futureBlocksResolverRef = useRef<((result: FutureBlocksDecisionSheetResult) => void) | null>(null)

  const askEmptyStart = useCallback((policy: EmptyStartPolicy): Promise<EmptyStartAskAnswer | null> => {
    void policy
    return new Promise((resolve) => {
      emptyStartResolverRef.current = (result) => {
        emptyStartResolverRef.current = null
        setEmptyStartOpen(false)
        if (result.choice === 'cancel') {
          resolve(null)
          return
        }
        if (result.choice === 'pick_task') {
          resolve({ choice: 'pick_task', taskId: result.taskId })
          return
        }
        if (result.choice === 'quick_start') {
          resolve({ choice: 'quick_start', title: result.title })
          return
        }
        resolve({ choice: 'unattributed' })
      }
      setEmptyStartOpen(true)
    })
  }, [])

  const handleEmptyStartResolve = useCallback((result: EmptyStartSheetResult) => {
    emptyStartResolverRef.current?.(result)
  }, [])

  const askFutureBlocks = useCallback(
    (input: {
      taskId: string
      taskTitle: string
      futureBlockIds: string[]
    }): Promise<FutureBlocksAskAnswer | null> => {
      return new Promise((resolve) => {
        futureBlocksResolverRef.current = (result) => {
          futureBlocksResolverRef.current = null
          setFutureBlocksOpen(false)
          setFutureBlocksPayload(null)
          if (result.choice === 'dismiss') {
            resolve({ decision: 'dismiss' })
            return
          }
          resolve({
            decision: result.choice,
            ...(result.choice === 'reassign' && result.reassignTaskId
              ? { reassignTaskId: result.reassignTaskId }
              : {})
          })
        }
        setFutureBlocksPayload(input)
        setFutureBlocksOpen(true)
      })
    },
    []
  )

  const handleFutureBlocksResolve = useCallback((result: FutureBlocksDecisionSheetResult) => {
    futureBlocksResolverRef.current?.(result)
  }, [])

  const {
    snapshot,
    presence,
    viewModel,
    selectedTaskId,
    selectTask,
    joinSpace,
    enterRandomSpace,
    chooseSeat,
    toggleTimer,
    resetTimer,
    startTimerInMode,
    saveTimerPlan,
    applyTimerPlan,
    removeTimerPlan,
    addScheduledTask,
    updateTask,
    toggleTask,
    removeTask
  } = useStudySession({
    showNotification,
    openFocusTheater: () => {},
    workspaceRoot,
    emptyStartPolicy,
    onEmptyStartAsk: askEmptyStart,
    onFutureBlocksNeedDecision: askFutureBlocks
  })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<OfficeSceneRuntime | null>(null)
  const chooseSeatRef = useRef(chooseSeat)
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
  const [immersiveScene, setImmersiveScene] = useState<ImmersiveScene>('clock')
  const [clockState, setClockState] = useState(() => ({
    current: new Date(),
    previous: null as Date | null
  }))
  const [quickNote, setQuickNote] = useState('')
  const [isTaskAddEditorOpen, setIsTaskAddEditorOpen] = useState(false)
  const [isImmersiveArcPointerActive, setIsImmersiveArcPointerActive] = useState(false)
  const [isImmersiveArcFocusActive, setIsImmersiveArcFocusActive] = useState(false)
  const workbenchUserSeatIndex = viewModel.userSeat < workbenchSeatCount ? viewModel.userSeat : -1
  const clockTime = clockState.current
  const occupantsByDeskId = new Map<DeskId, OfficeSceneSeatOccupant>()

  if (!viewModel.userSeatConflict && workbenchUserSeatIndex >= 0) {
    occupantsByDeskId.set(deskIdForSeatIndex(workbenchUserSeatIndex), {
      kind: 'self',
      name: snapshot.nickname,
      status: snapshot.timerState,
      timerMode: snapshot.timerMode
    })
  }
  viewModel.peersBySeat.forEach((peer, seatIndex) => {
    if (seatIndex >= workbenchSeatCount) return
    const deskId = deskIdForSeatIndex(seatIndex)
    if (occupantsByDeskId.has(deskId)) return
    occupantsByDeskId.set(deskId, {
      kind: 'peer',
      name: peer.nickname,
      status: peer.status,
      timerMode: peer.timerMode
    })
  })
  const seatState: OfficeSceneSeatState = {
    userSeatIndex: viewModel.userSeatConflict ? -1 : workbenchUserSeatIndex,
    activeRoomName: viewModel.activeRoom.name,
    connectionLabel: viewModel.connectionLabel,
    cycleLabel: `${viewModel.roomCycle.phase === 'focus' ? '专注中' : '休息中'} · ${formatStudyDuration(viewModel.roomCycle.remainingSeconds)}`,
    blockedSeatIndexes: viewModel.blockedSeatIndexes,
    occupantsByDeskId
  }
  chooseSeatRef.current = chooseSeat

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
    const millisecondsUntilNextMinute = clockRefreshIntervalMs - (Date.now() % clockRefreshIntervalMs)
    let intervalId: number | undefined
    const timeoutId = window.setTimeout(() => {
      refreshClock()
      intervalId = window.setInterval(refreshClock, clockRefreshIntervalMs)
    }, millisecondsUntilNextMinute)

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
      petAppearance,
      onDeskSelectionIntent: (seatIndex) => chooseSeatRef.current(seatIndex)
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

  const openImmersive = useCallback((): void => {
    clearImmersiveCloseTimer()
    immersiveCloseRequestedRef.current = false
    immersivePhaseRef.current = 'open'
    setImmersivePhase('open')
    setIsImmersiveArcFocusActive(true)
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
      immersiveCloseFallbackDurationMs
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
      // Keep immersive mode intact and leave the exit control reachable for retry.
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
        // Pin only the exit control. Clear hover/focus expand state so hide/scene/note
        // do not remain interactive just because focus stayed inside the control group.
        setIsImmersiveArcPointerActive(false)
        setIsImmersiveArcFocusActive(false)
        focusImmersiveControl(fullscreenButtonRef.current)
        return
      }

      if (suppressFullscreenFocusRestoreRef.current) {
        suppressFullscreenFocusRestoreRef.current = false
        fullscreenReturnFocusRef.current = null
        return
      }

      if (immersivePhaseRef.current === 'open' && routeRef.current === 'room') {
        setIsImmersiveArcFocusActive(true)
        const returnFocus = fullscreenReturnFocusRef.current
        focusImmersiveControl(returnFocus?.isConnected ? returnFocus : fullscreenButtonRef.current)
      }
      fullscreenReturnFocusRef.current = null
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

  // Fullscreen only pins the exit control; hide/scene/note stay hover/focus gated
  // so the bottom of the stage does not become a large accidental hit target.
  const isImmersiveArcActive = immersivePhase === 'open' && (
    isImmersiveArcPointerActive || isImmersiveArcFocusActive
  )
  const isImmersiveExitControlActive = isFullscreen || isImmersiveArcActive

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
          aria-label="StudiumX 自习室：当前在座位 1，使用方向键切换座位"
          aria-live="polite"
          tabIndex={0}
        />
        <WorkbenchLeaderboard
          members={viewModel.roomMembers}
          presenceStatus={presence.status}
          spaceCode={snapshot.spaceCode}
          onEnterRandomSpace={enterRandomSpace}
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
            onToggleTimer={toggleTimer}
            onResetTimer={resetTimer}
            onStartTimerInMode={startTimerInMode}
            onSaveTimerPlan={saveTimerPlan}
            onApplyTimerPlan={applyTimerPlan}
            onRemoveTimerPlan={removeTimerPlan}
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
          />
        </div>
        <EmptyStartSheet
          open={emptyStartOpen}
          policy={emptyStartPolicy}
          openTasks={snapshot.tasks.filter((task) => !task.done).map((task) => ({
            id: task.id,
            title: task.title
          }))}
          onResolve={handleEmptyStartResolve}
        />

      <FutureBlocksDecisionSheet
        open={futureBlocksOpen}
        taskId={futureBlocksPayload?.taskId ?? ''}
        taskTitle={futureBlocksPayload?.taskTitle ?? ''}
        futureBlockIds={futureBlocksPayload?.futureBlockIds ?? []}
        reassignCandidates={snapshot.tasks
          .filter((t) => !t.done && t.id !== futureBlocksPayload?.taskId)
          .map((t) => ({ id: t.id, title: t.title }))}
        onResolve={handleFutureBlocksResolve}
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
            />
          </div>
        ) : null}
        <div className="workbench-music-dock">
          <WorkbenchMusicPlayer />
        </div>
        <div
          id="workbench-immersive-layer"
          className={`workbench-immersive-layer${immersivePhase === 'open' ? ' is-open' : immersivePhase === 'closing' ? ' is-closing' : ''}`}
          aria-hidden={immersivePhase === 'closed'}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && immersivePhase === 'closing') {
              finishImmersiveClose()
            }
          }}
        >
          <div className="workbench-immersive-plane">
            {immersiveScene === 'clock' ? (
              <div className="workbench-immersive-clock-scene workbench-clock" aria-hidden="true">
                <ClockDisplay time={clockTime} previousTime={clockState.previous} />
              </div>
            ) : (
              <video
                className="workbench-immersive-video"
                src={girlVideo}
                autoPlay
                loop
                muted
                playsInline
                aria-hidden="true"
              />
            )}
            <div className="workbench-immersive-vignette" aria-hidden="true" />
          </div>
        </div>
        <div
          className={`workbench-immersive-controls${immersivePhase !== 'closed' ? ' is-open' : ''}${isFullscreen ? ' is-fullscreen' : ''}`}
          onPointerEnter={() => setIsImmersiveArcPointerActive(true)}
          onPointerLeave={() => setIsImmersiveArcPointerActive(false)}
          onFocusCapture={(event) => {
            // Fullscreen pins only the exit control. Focusing that control alone
            // must not reveal hide/scene/note and create an invisible hit fan.
            const target = event.target as Node | null
            if (
              document.fullscreenElement != null &&
              stageRef.current != null &&
              document.fullscreenElement === stageRef.current &&
              target === fullscreenButtonRef.current
            ) {
              return
            }
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
            aria-hidden={!isImmersiveExitControlActive}
          >
            <button
              ref={fullscreenButtonRef}
              type="button"
              className="workbench-immersive-arc-action workbench-immersive-arc-action--fullscreen"
              onClick={() => void toggleFullscreen()}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? '退出全屏' : '进入全屏'}
              title={isFullscreen ? '退出全屏' : '进入全屏'}
              tabIndex={isImmersiveExitControlActive ? 0 : -1}
            >
              {isFullscreen ? (
                <Minimize2 size={20} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Maximize2 size={20} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
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
          </div>
        </div>
        {isScenePickerOpen ? (
          <div className="workbench-scene-picker-backdrop" role="presentation" onMouseDown={() => setIsScenePickerOpen(false)}>
            <section
              className="workbench-scene-picker"
              role="dialog"
              aria-modal="true"
              aria-label="选择场景"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="workbench-scene-picker__header">
                <div>
                  <span className="workbench-scene-picker__eyebrow"><Image size={15} aria-hidden="true" /> 沉浸空间</span>
                  <h2>选择场景</h2>
                  <p>选择一个沉浸场景，陪伴你专注学习。</p>
                </div>
                <button
                  type="button"
                  className="workbench-scene-picker__close"
                  onClick={() => setIsScenePickerOpen(false)}
                  aria-label="关闭场景选择"
                  title="关闭"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <p className="workbench-scene-picker__current">当前场景：{immersiveSceneLabels[immersiveScene]}</p>
              <div className="workbench-scene-picker__grid">
                <button
                  type="button"
                  className={`workbench-scene-picker__preset workbench-scene-picker__preset--clock${immersiveScene === 'clock' ? ' is-selected' : ''}`}
                  onClick={() => {
                    setImmersiveScene('clock')
                    setIsScenePickerOpen(false)
                  }}
                  aria-pressed={immersiveScene === 'clock'}
                >
                  <div className="workbench-scene-picker__clock-preview workbench-clock" aria-hidden="true">
                    <ClockDisplay time={clockTime} previousTime={clockState.previous} />
                  </div>
                  <span className="workbench-scene-picker__preset-copy">
                    <strong>翻页时钟</strong>
                    <small>低资源占用的专注时钟</small>
                  </span>
                  {immersiveScene === 'clock' ? <span className="workbench-scene-picker__selected-mark">当前</span> : null}
                </button>
                <button
                  type="button"
                  className={`workbench-scene-picker__preset workbench-scene-picker__preset--girl${immersiveScene === 'girl' ? ' is-selected' : ''}`}
                  onClick={() => {
                    setImmersiveScene('girl')
                    setIsScenePickerOpen(false)
                  }}
                  aria-pressed={immersiveScene === 'girl'}
                >
                  <video
                    className="workbench-scene-picker__video-preview"
                    src={girlVideo}
                    muted
                    loop
                    autoPlay
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                  />
                  <span className="workbench-scene-picker__preset-copy">
                    <strong>女孩自习</strong>
                    <small>girl.mp4 · 沉浸式自习陪伴</small>
                  </span>
                  {immersiveScene === 'girl' ? <span className="workbench-scene-picker__selected-mark">当前</span> : null}
                </button>
              </div>
            </section>
          </div>
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
