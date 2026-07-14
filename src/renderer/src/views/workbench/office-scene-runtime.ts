import type { PetAppearanceId } from '../../../../shared/teaching-types'
import { studyMemberStatusLabel } from '../../study-space/domain'
import type { StudyTimerMode, StudyTimerState } from '../../study-space/types'
import {
  getPetSpriteFrameIndex,
  getPetSpriteRow,
  getPetSpriteSheetUrl,
  PET_SPRITE_CELL_HEIGHT,
  PET_SPRITE_CELL_WIDTH,
  type PetVisualState
} from '../pet/PetSprite'

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

export type OfficeSceneSeatOccupant = {
  kind: 'self' | 'peer'
  name: string
  status: StudyTimerState
  timerMode: StudyTimerMode
}

export type OfficeSceneSeatState = {
  userSeatIndex: number
  activeRoomName: string
  connectionLabel: string
  cycleLabel: string
  blockedSeatIndexes: ReadonlySet<number>
  occupantsByDeskId: ReadonlyMap<DeskId, OfficeSceneSeatOccupant>
}

export type OfficeSceneRuntime = {
  mount: () => void
  update: (seatState: OfficeSceneSeatState) => void
  dispose: () => void
}

type CreateOfficeSceneRuntimeOptions = {
  stage: HTMLElement
  canvas: HTMLCanvasElement
  petAppearance: PetAppearanceId
  onDeskSelectionIntent: (seatIndex: number) => void
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

function emptySeatState(): OfficeSceneSeatState {
  return {
    userSeatIndex: -1,
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

function petStateForOccupant(occupant: OfficeSceneSeatOccupant): PetVisualState {
  if (occupant.status === 'paused') return 'waiting'
  if (occupant.status === 'running') return occupant.timerMode === 'focus' ? 'running' : 'review'
  return 'idle'
}

function drawSeatedPet(
  ctx: CanvasRenderingContext2D,
  petImage: HTMLImageElement,
  slot: DeskSlot,
  occupant: OfficeSceneSeatOccupant,
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
  occupant: OfficeSceneSeatOccupant | null
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
  seatState: OfficeSceneSeatState,
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

function selectedDeskLabel(seatState: OfficeSceneSeatState): string {
  return deskSlots.find((slot) => slot.slotIndex === seatState.userSeatIndex)?.label ?? '未选择座位'
}

export function createOfficeSceneRuntime({
  stage,
  canvas,
  petAppearance,
  onDeskSelectionIntent
}: CreateOfficeSceneRuntimeOptions): OfficeSceneRuntime {
  let mounted = false
  let animationFrame: number | null = null
  let hoveredDeskId: DeskId | null = null
  let seatState = emptySeatState()
  let reducedMotion = false
  let reducedMotionQuery: MediaQueryList | undefined
  let resizeObserver: ResizeObserver | null = null

  const syncCanvasAccessibility = (): void => {
    canvas.setAttribute(
      'aria-label',
      `StudiumX 自习室：${seatState.activeRoomName}，当前在${selectedDeskLabel(seatState)}，${seatState.connectionLabel}，${seatState.cycleLabel}，使用方向键切换座位`
    )
  }

  const canSelect = (slot: DeskSlot): boolean => {
    if (seatState.blockedSeatIndexes.has(slot.slotIndex)) return false
    return seatState.occupantsByDeskId.get(slot.id)?.kind !== 'peer'
  }

  const selectDesk = (slot: DeskSlot): void => {
    if (!canSelect(slot)) return
    onDeskSelectionIntent(slot.slotIndex)
    hoveredDeskId = slot.id
    canvas.style.cursor = 'pointer'
    syncCanvasAccessibility()
  }

  const updateHover = (event: MouseEvent): void => {
    const slot = findDeskAt(canvasPointToScene(event, canvas))
    hoveredDeskId = slot?.id ?? null
    canvas.style.cursor = slot && canSelect(slot) ? 'pointer' : 'default'
  }

  const handleClick = (event: MouseEvent): void => {
    const slot = findDeskAt(canvasPointToScene(event, canvas))
    if (slot) selectDesk(slot)
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    const currentIndex = deskSlots.findIndex((slot) => slot.slotIndex === seatState.userSeatIndex)
    let nextIndex: number | null = null
    const selectableIndex = (startIndex: number, direction: 1 | -1): number | null => {
      for (let offset = 0; offset < deskSlots.length; offset += 1) {
        const index = (startIndex + offset * direction + deskSlots.length) % deskSlots.length
        if (canSelect(deskSlots[index])) return index
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

  const handlePointerLeave = (): void => {
    hoveredDeskId = null
    canvas.style.cursor = 'default'
  }

  const updateReducedMotion = (event: MediaQueryListEvent): void => {
    reducedMotion = event.matches
  }

  const scheduleFrame = (ctx: CanvasRenderingContext2D, assets: WorkbenchAssets): void => {
    if (!mounted || animationFrame !== null) return
    animationFrame = requestAnimationFrame((time) => {
      animationFrame = null
      if (!mounted) return
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
      drawScene(ctx, assets, time, seatState, hoveredDeskId, reducedMotion)
      ctx.restore()
      scheduleFrame(ctx, assets)
    })
  }

  const updateCanvasSize = (): void => fitCanvasToStage(stage, canvas)

  return {
    mount(): void {
      if (mounted) return
      mounted = true
      updateCanvasSize()
      resizeObserver = new ResizeObserver(updateCanvasSize)
      resizeObserver.observe(stage)
      const tools = stage.querySelector<HTMLElement>('.workbench-tools')
      if (tools) resizeObserver.observe(tools)
      window.addEventListener('resize', updateCanvasSize)

      reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
      reducedMotion = reducedMotionQuery?.matches ?? false
      reducedMotionQuery?.addEventListener('change', updateReducedMotion)

      syncCanvasAccessibility()
      canvas.addEventListener('pointermove', updateHover)
      canvas.addEventListener('click', handleClick)
      canvas.addEventListener('keydown', handleKeyDown)
      canvas.addEventListener('pointerleave', handlePointerLeave)

      void loadWorkbenchAssets(petAppearance)
        .then((assets) => {
          if (!mounted) return
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          scheduleFrame(ctx, assets)
        })
        .catch((error: unknown) => {
          if (mounted) console.error('Failed to load StudiumX workbench assets', error)
        })
    },

    update(nextSeatState: OfficeSceneSeatState): void {
      seatState = nextSeatState
      if (mounted) syncCanvasAccessibility()
    },

    dispose(): void {
      if (!mounted) return
      mounted = false
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      animationFrame = null
      resizeObserver?.disconnect()
      resizeObserver = null
      window.removeEventListener('resize', updateCanvasSize)
      reducedMotionQuery?.removeEventListener('change', updateReducedMotion)
      reducedMotionQuery = undefined
      canvas.removeEventListener('pointermove', updateHover)
      canvas.removeEventListener('click', handleClick)
      canvas.removeEventListener('keydown', handleKeyDown)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      hoveredDeskId = null
      canvas.style.cursor = 'default'
    }
  }
}
