import { ChartColumn, ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app-shell/appStore'
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
import { WorkbenchTasks } from './WorkbenchTasks'
import { StudyTaskSchedulePage } from './StudyTaskSchedulePage'
import { StudyAnalyticsPage, type StudyAnalyticsPageProps } from './analytics/StudyAnalyticsPage'
import {
  navigateWorkbenchRoute,
  parseWorkbenchRoute,
  type WorkbenchRoute
} from './workbenchRoute'
import './workbench-analytics-entry.css'

type DeskId = `desk-${number}`

// OfficeSceneRuntime owns browser asset loading: new URL('../../../../../ref.png', import.meta.url).
// Its canvas draw loop renders every desk with drawDeskImage(ctx, assets.deskImage, slot).
const workbenchSeatCount = 12
const immersiveVideoUrl = new URL('../../../../../video.mp4', import.meta.url).href
const immersiveCloseFallbackDurationMs = 1_700
type ImmersivePhase = 'closed' | 'open' | 'closing'

function deskIdForSeatIndex(seatIndex: number): DeskId {
  return `desk-${seatIndex + 1}`
}

type OfficeWorkbenchProps = {
  showNotification: (title: string, body: string) => Promise<void>
}

export type WorkbenchAnalyticsPageProps = StudyAnalyticsPageProps

const WorkbenchAnalyticsPage = StudyAnalyticsPage

export function OfficeWorkbench({ showNotification }: OfficeWorkbenchProps) {
  const petAppearance = useAppStore((state) => state.settings.pet.appearance)
  const {
    snapshot,
    presence,
    viewModel,
    joinSpace,
    enterRandomSpace,
    chooseSeat,
    toggleTimer,
    resetTimer,
    switchTimerMode,
    toggleAmbientEnabled,
    addScheduledTask,
    updateTask,
    toggleTask,
    removeTask
  } = useStudySession({
    showNotification,
    openFocusTheater: () => {}
  })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<OfficeSceneRuntime | null>(null)
  const chooseSeatRef = useRef(chooseSeat)
  const analyticsFabRef = useRef<HTMLButtonElement | null>(null)
  const immersiveVideoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveCloseTimerRef = useRef<number | null>(null)
  const restoreAnalyticsFabFocusRef = useRef(false)
  const [route, setRoute] = useState<WorkbenchRoute>(() => parseWorkbenchRoute(window.location.search))
  const [immersivePhase, setImmersivePhase] = useState<ImmersivePhase>('closed')
  const [openScheduleAddEditor, setOpenScheduleAddEditor] = useState(false)
  const workbenchUserSeatIndex = viewModel.userSeat < workbenchSeatCount ? viewModel.userSeat : -1
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

  useEffect(() => {
    navigateWorkbenchRoute(route, 'replace')
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = parseWorkbenchRoute(window.location.search)
      setRoute((currentRoute) => {
        if (currentRoute === 'analytics' && nextRoute === 'room') {
          restoreAnalyticsFabFocusRef.current = true
        }
        return nextRoute
      })
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (route !== 'room' || !restoreAnalyticsFabFocusRef.current) return
    restoreAnalyticsFabFocusRef.current = false
    analyticsFabRef.current?.focus({ preventScroll: true })
  }, [route])

  const openTaskSchedule = (openAddEditor = false): void => {
    setOpenScheduleAddEditor(openAddEditor)
    navigateWorkbenchRoute('schedule')
    setRoute('schedule')
  }

  const closeTaskSchedule = (): void => {
    setOpenScheduleAddEditor(false)
    navigateWorkbenchRoute('room', 'replace')
    setRoute('room')
  }

  const openStudyAnalytics = (): void => {
    navigateWorkbenchRoute('analytics')
    setRoute('analytics')
  }

  const closeStudyAnalytics = (): void => {
    restoreAnalyticsFabFocusRef.current = true
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

  const openImmersive = useCallback((): void => {
    clearImmersiveCloseTimer()
    setImmersivePhase('open')
  }, [clearImmersiveCloseTimer])

  const finishImmersiveClose = useCallback((): void => {
    clearImmersiveCloseTimer()
    setImmersivePhase((currentPhase) =>
      currentPhase === 'closing' ? 'closed' : currentPhase
    )
  }, [clearImmersiveCloseTimer])

  const closeImmersive = useCallback((): void => {
    clearImmersiveCloseTimer()
    setImmersivePhase('closing')
    immersiveCloseTimerRef.current = window.setTimeout(
      finishImmersiveClose,
      immersiveCloseFallbackDurationMs
    )
  }, [clearImmersiveCloseTimer, finishImmersiveClose])

  const toggleImmersive = (): void => {
    if (immersivePhase === 'closed') openImmersive()
    else if (immersivePhase === 'open') closeImmersive()
  }

  useEffect(() => {
    if (route !== 'room') {
      clearImmersiveCloseTimer()
      setImmersivePhase('closed')
      return
    }

    const video = immersiveVideoRef.current
    if (!video) return
    if (immersivePhase !== 'closed') {
      void video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [clearImmersiveCloseTimer, immersivePhase, route])

  useEffect(() => {
    if (immersivePhase !== 'open') return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeImmersive()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeImmersive, immersivePhase])

  useEffect(() => clearImmersiveCloseTimer, [clearImmersiveCloseTimer])

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
          onAddScheduledTask={addScheduledTask}
          onUpdateTask={updateTask}
          onToggleTask={toggleTask}
          onRemoveTask={removeTask}
          onBack={closeTaskSchedule}
          openAddEditorOnMount={openScheduleAddEditor}
        />
      </section>
    )
  }

  return (
    <section className="office-workbench-page" aria-label="自习室">
      <div ref={stageRef} className={`office-workbench-stage${immersivePhase !== 'closed' ? ' is-immersive' : ''}`}>
        <canvas
          ref={canvasRef}
          className="office-workbench-canvas"
          aria-label="StudiumX 自习室：当前在座位 1，使用方向键切换座位"
          aria-live="polite"
          tabIndex={0}
        />
        <button
          ref={analyticsFabRef}
          type="button"
          className="workbench-analytics-fab"
          onClick={openStudyAnalytics}
          aria-label="打开学习分析"
        >
          <ChartColumn size={19} strokeWidth={2.1} aria-hidden="true" />
          <span>学习分析</span>
        </button>
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
            ambientLabel={viewModel.activeRoom.ambient}
            onToggleTimer={toggleTimer}
            onResetTimer={resetTimer}
            onSwitchTimerMode={switchTimerMode}
            onToggleAmbientEnabled={toggleAmbientEnabled}
          />
          <WorkbenchTasks
            tasks={snapshot.tasks}
            openTasks={viewModel.openTasks}
            completedTasks={viewModel.completedTasks}
            onToggleTask={toggleTask}
            onRemoveTask={removeTask}
            onOpenSchedule={openTaskSchedule}
          />
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
            <video
              ref={immersiveVideoRef}
              className="workbench-immersive-video"
              src={immersiveVideoUrl}
              muted
              loop
              playsInline
              preload="auto"
            />
            <div className="workbench-immersive-vignette" aria-hidden="true" />
          </div>
        </div>
        <button
          type="button"
          className={`workbench-immersive-toggle${immersivePhase !== 'closed' ? ' is-open' : ''}`}
          onClick={toggleImmersive}
          aria-controls="workbench-immersive-layer"
          aria-expanded={immersivePhase !== 'closed'}
          aria-label={immersivePhase !== 'closed' ? '收起沉浸模式' : '展开沉浸模式'}
          title={immersivePhase !== 'closed' ? '收起沉浸模式' : '展开沉浸模式'}
        >
          {immersivePhase !== 'closed' ? (
            <ChevronDown size={48} strokeWidth={1.9} aria-hidden="true" />
          ) : (
            <ChevronUp size={48} strokeWidth={1.9} aria-hidden="true" />
          )}
        </button>
      </div>
    </section>
  )
}
