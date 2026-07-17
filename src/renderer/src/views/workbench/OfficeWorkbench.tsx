import { ChevronDown, ChevronUp, Eye, EyeOff, Maximize2, Minimize2, StickyNote, X } from 'lucide-react'
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

// OfficeSceneRuntime owns browser asset loading: new URL('../../../../../ref.png', import.meta.url).
// Its canvas draw loop renders every desk with drawDeskImage(ctx, assets.deskImage, slot).
const workbenchSeatCount = 12
const immersiveVideoUrl = new URL('../../../../../video.mp4', import.meta.url).href
const immersiveCloseFallbackDurationMs = 1_200
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
    startTimerInMode,
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
  const analyticsButtonRef = useRef<HTMLButtonElement | null>(null)
  const immersiveVideoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveCloseTimerRef = useRef<number | null>(null)
  const restoreAnalyticsFocusRef = useRef(false)
  const [openTasksPanelForAnalytics, setOpenTasksPanelForAnalytics] = useState(false)
  const [route, setRoute] = useState<WorkbenchRoute>(() => parseWorkbenchRoute(window.location.search))
  const [immersivePhase, setImmersivePhase] = useState<ImmersivePhase>('closed')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [areRoomCardsHidden, setAreRoomCardsHidden] = useState(false)
  const [isQuickNoteOpen, setIsQuickNoteOpen] = useState(false)
  const [quickNote, setQuickNote] = useState('')
  const [isTaskAddEditorOpen, setIsTaskAddEditorOpen] = useState(false)
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
    setAreRoomCardsHidden(false)
    setIsQuickNoteOpen(false)
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

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await stageRef.current?.requestFullscreen()
      }
    } catch {
      // Fullscreen is controlled by the browser/Electron host and may be unavailable.
    }
  }, [])

  useEffect(() => {
    const syncFullscreenState = (): void => {
      setIsFullscreen(document.fullscreenElement === stageRef.current)
    }
    syncFullscreenState()
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  useEffect(() => {
    if (route !== 'room') {
      clearImmersiveCloseTimer()
      setAreRoomCardsHidden(false)
      setIsQuickNoteOpen(false)
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
      if (isQuickNoteOpen) {
        setIsQuickNoteOpen(false)
        return
      }
      closeImmersive()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeImmersive, immersivePhase, isQuickNoteOpen])

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
            ambientLabel={viewModel.activeRoom.ambient}
            onToggleTimer={toggleTimer}
            onResetTimer={resetTimer}
            onStartTimerInMode={startTimerInMode}
            onToggleAmbientEnabled={toggleAmbientEnabled}
          />
          <WorkbenchTasks
            tasks={snapshot.tasks}
            openTasks={viewModel.openTasks}
            completedTasks={viewModel.completedTasks}
            onToggleTask={toggleTask}
            onRemoveTask={removeTask}
            onOpenSchedule={openTaskSchedule}
            onOpenAddTask={openTaskAddEditor}
            onOpenAnalytics={openStudyAnalytics}
            analyticsButtonRef={analyticsButtonRef}
            defaultOpen={openTasksPanelForAnalytics}
          />
        </div>
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
        <div className={`workbench-immersive-controls${immersivePhase !== 'closed' ? ' is-open' : ''}`}>
          <div className="workbench-immersive-arc-menu" role="group" aria-label="沉浸模式快捷操作">
            <button
              type="button"
              className={`workbench-immersive-arc-action workbench-immersive-arc-action--hide${areRoomCardsHidden ? ' is-active' : ''}`}
              onClick={() => setAreRoomCardsHidden((hidden) => !hidden)}
              aria-pressed={areRoomCardsHidden}
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
              aria-label="快捷记事"
              title="快捷记事"
            >
              <StickyNote size={20} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workbench-immersive-arc-action workbench-immersive-arc-action--fullscreen"
              onClick={() => void toggleFullscreen()}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? '退出全屏' : '进入全屏'}
              title={isFullscreen ? '退出全屏' : '进入全屏'}
            >
              {isFullscreen ? (
                <Minimize2 size={20} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Maximize2 size={20} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          </div>
          <button
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
        </div>
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
