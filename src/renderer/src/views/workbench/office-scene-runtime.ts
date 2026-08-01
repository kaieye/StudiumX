import {
  normalizePetAppearanceId,
  type PetAppearanceId
} from '../../../../shared/teaching-types'
import { formatStudyHours } from '../../study-space/domain'
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
  petImages: Partial<Record<PetAppearanceId, HTMLImageElement>>
  loadingPetImages: Set<PetAppearanceId>
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
  petAppearance?: PetAppearanceId
  status: StudyTimerState
  timerMode: StudyTimerMode
  todayFocusSeconds: number
}

export type OfficeSceneSeatState = {
  userSeatIndex: number
  activeRoomName: string
  connectionLabel: string
  cycleLabel: string
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
  /** Called after the local scene assets have been painted for the first time. */
  onFirstFrameRendered?: () => void
  /** Called when the local scene assets cannot be loaded. */
  onAssetsLoadFailed?: () => void
}

const officeWidth = 64 * 17
const officeHeight = 64 * 14
const stageShift = { x: 0, y: -20 }
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

const deskImageUrl = new URL('../../assets/images/workbench/ref.png', import.meta.url).href

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
  return {
    deskImage,
    petImages: { [appearance]: petImage },
    loadingPetImages: new Set()
  }
}

function ensurePetImage(assets: WorkbenchAssets, appearance: PetAppearanceId): void {
  if (assets.petImages[appearance] || assets.loadingPetImages.has(appearance)) return
  assets.loadingPetImages.add(appearance)
  void loadImage(getPetSpriteSheetUrl(appearance))
    .then((image) => {
      assets.petImages[appearance] = image
    })
    .catch(() => undefined)
    .finally(() => {
      assets.loadingPetImages.delete(appearance)
    })
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

function drawDeskBadge(
  ctx: CanvasRenderingContext2D,
  slot: DeskSlot,
  isSelected: boolean,
  occupant: OfficeSceneSeatOccupant | null
): void {
  if (!isSelected && !occupant) return

  const { x, y, width, height } = slot.hitArea
  const isPeer = occupant?.kind === 'peer'
  // Occupied desks retain their focus badge, but should not be surrounded by a
  // selection-style rectangle. In particular, peers must not look selected.
  const shouldDrawDeskOutline = occupant === null
  ctx.save()
  if (shouldDrawDeskOutline) {
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
  }

  const focusLabel = occupant ? `今日 ${formatStudyHours(occupant.todayFocusSeconds)}h` : '系统分配座位'
  ctx.font = '600 13px system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const badgeWidth = Math.max(88, ctx.measureText(focusLabel).width + 20)
  const badgeHeight = 28
  const badgeX = x + width / 2 - badgeWidth / 2
  const badgeY = y - 20
  roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 13)
  ctx.fillStyle = isSelected
    ? 'rgba(210, 155, 35, 0.95)'
    : isPeer
      ? 'rgba(36, 121, 82, 0.92)'
      : 'rgba(255, 255, 255, 0.95)'
  ctx.fill()
  ctx.fillStyle = occupant ? '#ffffff' : '#3454a8'
  ctx.fillText(focusLabel, x + width / 2, badgeY + badgeHeight / 2)
  ctx.restore()
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  assets: WorkbenchAssets,
  elapsed: number,
  seatState: OfficeSceneSeatState,
  reducedMotion: boolean,
  fallbackPetAppearance: PetAppearanceId
): void {
  ctx.clearRect(0, 0, officeWidth, officeHeight)
  ctx.save()
  ctx.translate(stageShift.x, stageShift.y)

  const depthLayers: Array<{ z: number; draw: () => void }> = []
  for (const slot of deskSlots) {
    const occupant = seatState.occupantsByDeskId.get(slot.id) ?? null
    const isSelected = seatState.userSeatIndex === slot.slotIndex

    drawDeskBadge(ctx, slot, isSelected, occupant)
    drawDeskImage(ctx, assets.deskImage, slot)
    if (occupant) {
      const petAppearance = normalizePetAppearanceId(occupant.petAppearance, fallbackPetAppearance)
      ensurePetImage(assets, petAppearance)
      const petImage = assets.petImages[petAppearance] ?? assets.petImages[fallbackPetAppearance]
      if (!petImage) continue
      const readyPetImage = petImage
      depthLayers.push({
        z: slot.z,
        draw: () => drawSeatedPet(
          ctx,
          readyPetImage,
          slot,
          occupant,
          elapsed,
          reducedMotion
        )
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
  onFirstFrameRendered,
  onAssetsLoadFailed
}: CreateOfficeSceneRuntimeOptions): OfficeSceneRuntime {
  let mounted = false
  let animationFrame: number | null = null
  let seatState = emptySeatState()
  let reducedMotion = false
  let reducedMotionQuery: MediaQueryList | undefined
  let resizeObserver: ResizeObserver | null = null
  let hasRenderedFirstFrame = false

  const syncCanvasAccessibility = (): void => {
    canvas.setAttribute(
      'aria-label',
      `StudiumX 自习室：${seatState.activeRoomName}，系统已自动分配${selectedDeskLabel(seatState)}，${seatState.connectionLabel}，${seatState.cycleLabel}`
    )
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
      drawScene(ctx, assets, time, seatState, reducedMotion, petAppearance)
      ctx.restore()
      if (!hasRenderedFirstFrame) {
        hasRenderedFirstFrame = true
        onFirstFrameRendered?.()
      }
      scheduleFrame(ctx, assets)
    })
  }

  const updateCanvasSize = (): void => fitCanvasToStage(stage, canvas)

  return {
    mount(): void {
      if (mounted) return
      mounted = true
      hasRenderedFirstFrame = false
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

      void loadWorkbenchAssets(petAppearance)
        .then((assets) => {
          if (!mounted) return
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          scheduleFrame(ctx, assets)
        })
        .catch((error: unknown) => {
          if (!mounted) return
          console.error('Failed to load StudiumX workbench assets', error)
          onAssetsLoadFailed?.()
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
    }
  }
}
