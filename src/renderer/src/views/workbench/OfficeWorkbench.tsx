import { ChartColumn } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PetAppearanceId } from '../../../../shared/teaching-types'
import { useAppStore } from '../../app-shell/appStore'
import {
  formatStudyDuration,
  formatStudySeatLabel,
  studyMemberStatusLabel
} from '../../study-space/domain'
import { useStudySession } from '../../study-space/session/useStudySession'
import type { StudyTimerMode, StudyTimerState } from '../../study-space/types'
import {
  getPetSpriteFrameIndex,
  getPetSpriteRow,
  getPetSpriteSheetUrl,
  PET_SPRITE_CELL_HEIGHT,
  PET_SPRITE_CELL_WIDTH,
  type PetVisualState
} from '../pet/PetSprite'
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

type WorkbenchAssets = {
  deskImage: HTMLImageElement
  petImage: HTMLImageElement
}

type DeskId = `desk-${number}`

type DeskSlot = {
  id: DeskId
  label: string
  slotIndex: number
  x: number
  y: number
  width: number
  height: number
  hitArea: { x: number; y: number; width: number; height: number }
  seat: { x: number; y: number }
  z: number
}

type WorkbenchSeatOccupant = {
  kind: 'self' | 'peer'
  name: string
  status: StudyTimerState
  timerMode: StudyTimerMode
}

type WorkbenchSeatState = {
  userSeatIndex: number
  activeRoomName: string
  connectionLabel: string
  cycleLabel: string
  blockedSeatIndexes: Set<number>
  occupantsByDeskId: Map<DeskId, WorkbenchSeatOccupant>
}

const officeWidth = 64 * 17
const officeHeight = 64 * 14
const stageShift = { x: 40, y: -20 }
const canvasOutputScale = 2
const officeScaleBoost = 0.78
const compactScaleBoost = 0.5
const minToolScale = 1
const maxToolScale = 1.22
const toolRailWidth = 316
const toolRailMinWidth = 270
const compactToolRailWidth = 228
const toolSceneGap = 20
const workstationWidth = 64 * 3
const workstationHeight = 64
const chairYOffset = 65
const seatedPetWidth = 96
const seatedPetBottomOffset = 36
const workbenchSeatCount = 12

const deskImageUrl = new URL('../../../../../ref.png', import.meta.url).href

const workstationPositions = [
  { col: 1, row: 2 },
  { col: 5, row: 2 },
  { col: 9, row: 2 },
  { col: 13, row: 2 },
  { col: 1, row: 6 },
  { col: 5, row: 6 },
  { col: 9, row: 6 },
  { col: 13, row: 6 },
  { col: 1, row: 10 },
  { col: 5, row: 10 },
  { col: 9, row: 10 },
  { col: 13, row: 10 }
].map((seat, slotIndex) => ({
  slotIndex,
  x: (seat.col + workstationWidth / 64 / 2) * 64,
  y: (seat.row + workstationHeight / 64 / 2) * 64,
  width: workstationWidth,
  height: workstationHeight
}))

const deskSlots: DeskSlot[] = workstationPositions.map((layout) => ({
  id: `desk-${layout.slotIndex + 1}`,
  label: `座位 ${layout.slotIndex + 1}`,
  slotIndex: layout.slotIndex,
  x: layout.x,
  y: layout.y,
  width: layout.width,
  height: layout.height,
  hitArea: {
    x: layout.x - layout.width / 2,
    y: layout.y - 88,
    width: layout.width,
    height: layout.height + chairYOffset + 42
  },
  seat: {
    x: layout.x,
    y: layout.y + 64
  },
  z: layout.y + 64
}))

function deskIdForSeatIndex(seatIndex: number): DeskId {
  return `desk-${seatIndex + 1}` as DeskId
}

function emptyWorkbenchSeatState(): WorkbenchSeatState {
  return {
    userSeatIndex: 0,
    activeRoomName: '自习室',
    connectionLabel: '本机席位',
    cycleLabel: '',
    blockedSeatIndexes: new Set(),
    occupantsByDeskId: new Map()
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

async function loadWorkbenchAssets(appearance: PetAppearanceId): Promise<WorkbenchAssets> {
  const [deskImage, petImage] = await Promise.all([
    loadImage(deskImageUrl),
    loadImage(getPetSpriteSheetUrl(appearance))
  ])
  return { deskImage, petImage }
}

function drawDeskImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, slot: DeskSlot): void {
  const size = slot.width
  ctx.drawImage(image, slot.x - size / 2, slot.y - size * 0.45, size, size)
}

function petStateForOccupant(occupant: WorkbenchSeatOccupant): PetVisualState {
  if (occupant.status === 'paused') return 'waiting'
  if (occupant.status === 'running') {
    return occupant.timerMode === 'focus' ? 'running' : 'review'
  }
  return 'idle'
}

function drawSeatedPet(
  ctx: CanvasRenderingContext2D,
  petImage: HTMLImageElement,
  slot: DeskSlot,
  occupant: WorkbenchSeatOccupant,
  elapsed: number,
  reducedMotion: boolean
): void {
  const state = petStateForOccupant(occupant)
  const frame = getPetSpriteFrameIndex(state, elapsed, reducedMotion)
  const width = seatedPetWidth
  const height = Math.round((width * PET_SPRITE_CELL_HEIGHT) / PET_SPRITE_CELL_WIDTH)
  const dx = slot.seat.x - width / 2
  const dy = slot.seat.y - height + seatedPetBottomOffset

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(
    petImage,
    frame * PET_SPRITE_CELL_WIDTH,
    getPetSpriteRow(state) * PET_SPRITE_CELL_HEIGHT,
    PET_SPRITE_CELL_WIDTH,
    PET_SPRITE_CELL_HEIGHT,
    dx,
    dy,
    width,
    height
  )
  ctx.restore()
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function drawDeskHitArea(
  ctx: CanvasRenderingContext2D,
  slot: DeskSlot,
  isHovered: boolean,
  isSelected: boolean,
  occupant: WorkbenchSeatOccupant | null
): void {
  if (!isHovered && !isSelected && !occupant) return

  const { x, y, width, height } = slot.hitArea
  const isPeer = occupant?.kind === 'peer'
  ctx.save()
  roundedRect(ctx, x, y, width, height, 18)
  ctx.fillStyle = isSelected
    ? 'rgba(242, 199, 92, 0.16)'
    : isPeer
      ? 'rgba(36, 161, 108, 0.12)'
      : 'rgba(86, 140, 255, 0.08)'
  ctx.fill()
  ctx.lineWidth = isSelected || occupant ? 2 : 1.5
  ctx.strokeStyle = isSelected
    ? 'rgba(210, 155, 35, 0.88)'
    : isPeer
      ? 'rgba(36, 161, 108, 0.68)'
      : 'rgba(68, 121, 255, 0.46)'
  ctx.stroke()

  ctx.font = '600 13px system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const statusLabel = occupant
    ? `${occupant.kind === 'self' ? '我' : occupant.name.slice(0, 6)} · ${studyMemberStatusLabel(occupant.status, occupant.timerMode)}`
    : slot.label
  const badgeWidth = Math.max(64, ctx.measureText(statusLabel).width + 20)
  const badgeHeight = 26
  const badgeX = x + width / 2 - badgeWidth / 2
  const badgeY = y - 12
  roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 13)
  ctx.fillStyle = isSelected
    ? 'rgba(210, 155, 35, 0.95)'
    : isPeer
      ? 'rgba(36, 121, 82, 0.92)'
      : 'rgba(255, 255, 255, 0.95)'
  ctx.fill()
  ctx.fillStyle = occupant ? '#ffffff' : '#3454a8'
  ctx.fillText(statusLabel, x + width / 2, badgeY + badgeHeight / 2)
  ctx.restore()
}

function findDeskAt(point: { x: number; y: number }): DeskSlot | null {
  for (const slot of [...deskSlots].reverse()) {
    const { x, y, width, height } = slot.hitArea
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) return slot
  }
  return null
}

function canvasPointToScene(event: MouseEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * officeWidth - stageShift.x,
    y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * officeHeight - stageShift.y
  }
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  assets: WorkbenchAssets,
  elapsed: number,
  seatState: WorkbenchSeatState,
  hoveredDeskId: DeskId | null,
  reducedMotion: boolean
): void {
  ctx.clearRect(0, 0, officeWidth, officeHeight)

  ctx.save()
  ctx.translate(stageShift.x, stageShift.y)

  const depthLayers: Array<{ z: number; draw: () => void }> = []
  for (const slot of deskSlots) {
    const occupant = seatState.occupantsByDeskId.get(slot.id) ?? null
    const isSelected = seatState.userSeatIndex === slot.slotIndex
    const isHovered = hoveredDeskId === slot.id

    drawDeskHitArea(ctx, slot, isHovered, isSelected, occupant)
    drawDeskImage(ctx, assets.deskImage, slot)

    if (occupant) {
      depthLayers.push({
        z: slot.z,
        draw: () => drawSeatedPet(ctx, assets.petImage, slot, occupant, elapsed, reducedMotion)
      })
    }
  }

  depthLayers.sort((a, b) => a.z - b.z)
  for (const layer of depthLayers) layer.draw()

  ctx.restore()
}

function fitCanvasToStage(stage: HTMLElement, canvas: HTMLCanvasElement): void {
  const stageWidth = stage.clientWidth
  const stageHeight = stage.clientHeight
  const stageRect = stage.getBoundingClientRect()
  const visibleWidth = Math.min(stageWidth, Math.max(1, window.innerWidth - Math.max(0, stageRect.left)))
  const visibleHeight = Math.min(stageHeight, Math.max(1, window.innerHeight - Math.max(0, stageRect.top)))
  if (visibleWidth <= 0 || visibleHeight <= 0) return

  const compactLayout = visibleWidth <= 720
  const toolRailBaseWidth = compactLayout
    ? compactToolRailWidth
    : Math.min(toolRailWidth, Math.max(toolRailMinWidth, visibleWidth * 0.22))
  const fullBaseScale = Math.min(visibleWidth / officeWidth, visibleHeight / officeHeight)
  const scaleBoost = compactLayout ? compactScaleBoost : officeScaleBoost
  const unblockedVisualScale = fullBaseScale * scaleBoost
  const toolToSceneScale = compactLayout ? 1.18 : 1.08
  const scaleSafetyWidth = officeWidth + toolRailBaseWidth * toolToSceneScale * 2
  const gapSafetyWidth = toolSceneGap * 2
  const safeVisualScale = Math.max(0.1, (visibleWidth - gapSafetyWidth) / scaleSafetyWidth)
  let visualScale = Math.min(unblockedVisualScale, safeVisualScale)
  let toolScale = Math.min(maxToolScale, Math.max(minToolScale, visualScale * toolToSceneScale))
  let toolLayoutHeight = visibleHeight / toolScale
  let canvasCenterX = visibleWidth / 2
  const tools = stage.querySelector<HTMLElement>('.workbench-tools')
  if (tools) {
    const toolStyle = window.getComputedStyle(tools)
    const toolTop = Number.parseFloat(toolStyle.top) || 0
    const availableToolHeight = Math.max(1, visibleHeight - toolTop * 2)
    const toolContentHeight = Math.max(1, tools.scrollHeight + Math.max(24, tools.children.length * 10))
    toolScale = Math.min(toolScale, Math.max(minToolScale, availableToolHeight / toolContentHeight))
    toolLayoutHeight = availableToolHeight / toolScale

    const toolRight = Number.parseFloat(toolStyle.right) || 0
    const toolVisualWidth = tools.offsetWidth * toolScale
    const sceneAvailableWidth = Math.max(1, visibleWidth - toolRight - toolVisualWidth - toolSceneGap)
    visualScale = Math.min(visualScale, sceneAvailableWidth / officeWidth)

    // The tool cards are a floating overlay, not a column reserved beside the
    // room. Center the room against the full visible stage so the furniture
    // does not remain visually left-biased when the cards are present.
    canvasCenterX = visibleWidth / 2
  }
  const canvasWidth = Math.round(officeWidth * visualScale)
  const canvasHeight = Math.round(officeHeight * visualScale)

  stage.style.setProperty('--workbench-tools-scale', toolScale.toFixed(4))
  stage.style.setProperty('--workbench-tools-layout-height', `${toolLayoutHeight.toFixed(2)}px`)
  stage.style.setProperty('--workbench-tools-gap', `${Math.min(34, Math.max(10, 12 / toolScale)).toFixed(2)}px`)
  canvas.style.width = `${canvasWidth}px`
  canvas.style.height = `${canvasHeight}px`
  canvas.style.aspectRatio = `${officeWidth} / ${officeHeight}`
  canvas.style.left = `${canvasCenterX}px`
  canvas.style.top = stageHeight > visibleHeight ? `${visibleHeight / 2}px` : '50%'
  canvas.style.transform = 'translate(-50%, -50%)'
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
    addTask,
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
  const assetsRef = useRef<WorkbenchAssets | null>(null)
  const seatStateRef = useRef<WorkbenchSeatState>(emptyWorkbenchSeatState())
  const chooseSeatRef = useRef(chooseSeat)
  const hoveredDeskIdRef = useRef<DeskId | null>(null)
  const analyticsFabRef = useRef<HTMLButtonElement | null>(null)
  const restoreAnalyticsFabFocusRef = useRef(false)
  const [route, setRoute] = useState<WorkbenchRoute>(() => parseWorkbenchRoute(window.location.search))
  const workbenchUserSeatIndex = viewModel.userSeat < workbenchSeatCount ? viewModel.userSeat : -1
  const occupantsByDeskId = new Map<DeskId, WorkbenchSeatOccupant>()

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
  seatStateRef.current = {
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

  const openTaskSchedule = (): void => {
    navigateWorkbenchRoute('schedule')
    setRoute('schedule')
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
    restoreAnalyticsFabFocusRef.current = true
    navigateWorkbenchRoute('room', 'replace')
    setRoute('room')
  }

  useEffect(() => {
    if (route !== 'room') return
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return

    const updateCanvasSize = () => fitCanvasToStage(stage, canvas)
    updateCanvasSize()

    const resizeObserver = new ResizeObserver(updateCanvasSize)
    resizeObserver.observe(stage)
    window.addEventListener('resize', updateCanvasSize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateCanvasSize)
    }
  }, [route])

  useEffect(() => {
    if (route !== 'room') return
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return
    fitCanvasToStage(stage, canvas)
  }, [route, snapshot.tasks.length, viewModel.completedTasks, viewModel.openTasks, viewModel.userSeatConflict])

  useEffect(() => {
    if (route !== 'room') return
    const canvas = canvasRef.current
    if (!canvas) return

    const selectedDeskLabel = () =>
      deskSlots.find((slot) => slot.slotIndex === seatStateRef.current.userSeatIndex)?.label ?? '未选择座位'

    const syncCanvasAccessibility = () => {
      const seatState = seatStateRef.current
      canvas.setAttribute(
        'aria-label',
        `StudiumX 自习室：${seatState.activeRoomName}，当前在${selectedDeskLabel()}，${seatState.connectionLabel}，${seatState.cycleLabel}，使用方向键切换座位`
      )
    }

    const selectDesk = (slot: DeskSlot) => {
      const isBlocked = seatStateRef.current.blockedSeatIndexes.has(slot.slotIndex)
      if (isBlocked) return
      const occupant = seatStateRef.current.occupantsByDeskId.get(slot.id)
      if (occupant?.kind === 'peer') return
      chooseSeatRef.current(slot.slotIndex)
      hoveredDeskIdRef.current = slot.id
      canvas.style.cursor = 'pointer'
      syncCanvasAccessibility()
    }

    const updateHover = (event: MouseEvent) => {
      const slot = findDeskAt(canvasPointToScene(event, canvas))
      hoveredDeskIdRef.current = slot?.id ?? null
      const occupant = slot ? seatStateRef.current.occupantsByDeskId.get(slot.id) : null
      const isBlocked = slot ? seatStateRef.current.blockedSeatIndexes.has(slot.slotIndex) : false
      canvas.style.cursor = slot && !isBlocked && occupant?.kind !== 'peer' ? 'pointer' : 'default'
    }

    const handleClick = (event: MouseEvent) => {
      const slot = findDeskAt(canvasPointToScene(event, canvas))
      if (!slot) return
      selectDesk(slot)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const currentIndex = deskSlots.findIndex((slot) => slot.slotIndex === seatStateRef.current.userSeatIndex)
      let nextIndex: number | null = null
      const selectableIndex = (startIndex: number, direction: 1 | -1): number | null => {
        for (let offset = 0; offset < deskSlots.length; offset += 1) {
          const index = (startIndex + offset * direction + deskSlots.length) % deskSlots.length
          const occupant = seatStateRef.current.occupantsByDeskId.get(deskSlots[index].id)
          const isBlocked = seatStateRef.current.blockedSeatIndexes.has(deskSlots[index].slotIndex)
          if (!isBlocked && occupant?.kind !== 'peer') return index
        }
        return null
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = selectableIndex(currentIndex === -1 ? 0 : currentIndex + 1, 1)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = selectableIndex(currentIndex === -1 ? deskSlots.length - 1 : currentIndex - 1, -1)
      } else if (event.key === 'Home') {
        nextIndex = selectableIndex(0, 1)
      } else if (event.key === 'End') {
        nextIndex = selectableIndex(deskSlots.length - 1, -1)
      }

      if (nextIndex === null) return
      event.preventDefault()
      selectDesk(deskSlots[nextIndex])
    }

    const handlePointerLeave = () => {
      hoveredDeskIdRef.current = null
      canvas.style.cursor = 'default'
    }

    syncCanvasAccessibility()
    canvas.addEventListener('pointermove', updateHover)
    canvas.addEventListener('click', handleClick)
    canvas.addEventListener('keydown', handleKeyDown)
    canvas.addEventListener('pointerleave', handlePointerLeave)

    return () => {
      canvas.removeEventListener('pointermove', updateHover)
      canvas.removeEventListener('click', handleClick)
      canvas.removeEventListener('keydown', handleKeyDown)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      hoveredDeskIdRef.current = null
      canvas.style.cursor = 'default'
    }
  }, [route])

  useEffect(() => {
    if (route !== 'room') return
    let canceled = false
    let animationFrame = 0
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let reducedMotion = reducedMotionQuery?.matches ?? false
    const updateReducedMotion = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches
    }
    reducedMotionQuery?.addEventListener('change', updateReducedMotion)

    async function run() {
      try {
        const assets = await loadWorkbenchAssets(petAppearance)
        if (canceled) return
        assetsRef.current = assets

        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        const render = (time: number) => {
          const rect = canvas.getBoundingClientRect()
          const visualScale = rect.width > 0 ? rect.width / officeWidth : 1
          const outputScale = Math.max(window.devicePixelRatio || 1, canvasOutputScale)
          const renderScale = visualScale * outputScale
          const nextWidth = Math.max(1, Math.round(officeWidth * renderScale))
          const nextHeight = Math.max(1, Math.round(officeHeight * renderScale))
          if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
            canvas.width = nextWidth
            canvas.height = nextHeight
          }
          ctx.save()
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0)
          drawScene(ctx, assets, time, seatStateRef.current, hoveredDeskIdRef.current, reducedMotion)
          ctx.restore()
          animationFrame = requestAnimationFrame(render)
        }

        animationFrame = requestAnimationFrame(render)
      } catch (error) {
        console.error('Failed to load StudiumX workbench assets', error)
      }
    }

    void run()
    return () => {
      canceled = true
      cancelAnimationFrame(animationFrame)
      reducedMotionQuery?.removeEventListener('change', updateReducedMotion)
      assetsRef.current = null
    }
  }, [petAppearance, route])

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
      <div ref={stageRef} className="office-workbench-stage">
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
            onAddTask={addTask}
            onToggleTask={toggleTask}
            onRemoveTask={removeTask}
            onOpenSchedule={openTaskSchedule}
          />
        </div>
      </div>
    </section>
  )
}
