import { KeyRound } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  formatStudyDuration,
  studyMemberStatusLabel
} from '../../study-space/domain'
import { useStudySession } from '../../study-space/session/useStudySession'
import type { StudyTimerMode, StudyTimerState } from '../../study-space/types'
import { WorkbenchLeaderboard } from './WorkbenchLeaderboard'
import { WorkbenchPomodoro } from './WorkbenchPomodoro'
import { WorkbenchTasks } from './WorkbenchTasks'

type AtlasFrame = {
  frame: { x: number; y: number; w: number; h: number }
  rotated: boolean
  trimmed: boolean
  spriteSourceSize: { x: number; y: number; w: number; h: number }
  sourceSize: { w: number; h: number }
}

type TextureAtlas = {
  frames: Record<string, AtlasFrame>
  animations?: Record<string, string[]>
  meta?: { scale?: number }
}

type AtlasImage = {
  image: HTMLImageElement
  atlas: TextureAtlas
}

type SheetSpec = {
  imageUrl: string
  atlasUrl: string
}

// 现阶段仍借用 Marvis 的桌子和 working 动画占位；后续替换成 StudiumX 自己的 UI 资源时，
// 优先替换这里的 URL 和 deskSlots 坐标，不再恢复旧演示场景的多角色装饰逻辑。
const sheetSpecs = {
  workstation: {
    imageUrl: new URL('./assets/marvis/img/workstation@2x.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/img/workstation@2x.webp.json', import.meta.url).href
  },
  working: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/working@2x.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/working@2x.webp.json', import.meta.url).href
  }
} satisfies Record<string, SheetSpec>

type SheetKey = keyof typeof sheetSpecs
type SheetMap = Record<SheetKey, AtlasImage>

type TiledObject = {
  id?: number
  name?: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  gid?: number
}

type TiledLayer = {
  name: string
  type: string
  objects?: TiledObject[]
  layers?: TiledLayer[]
  data?: number[]
  width?: number
  height?: number
}

type TiledMap = {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  layers: TiledLayer[]
  tilesets: Array<{ firstgid?: number; source?: string }>
}

type Tileset = {
  tiles?: Array<{
    id?: number
    image?: string
    imagewidth?: number
    imageheight?: number
  }>
}

type TemplateSprite = {
  id: number
  gid: number
  x: number
  y: number
  width: number
  height: number
}

type WorkstationTemplate = {
  chairSprites: TemplateSprite[]
  deskSprites: TemplateSprite[]
  computerSprites: TemplateSprite[]
  computerContainerRect: { x: number; y: number; width: number; height: number } | null
  center: { x: number; y: number }
}

type WorkbenchAssets = {
  sheets: SheetMap
  gidToFrame: Map<number, string>
  workstationTemplate: WorkstationTemplate
  workstationBossTemplate: WorkstationTemplate
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
  characterScale: number
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
  occupantsByDeskId: Map<DeskId, WorkbenchSeatOccupant>
}

const officeWidth = 64 * 17
const officeHeight = 64 * 14
const stageShift = { x: 40, y: -20 }
const canvasOutputScale = 2
const officeScaleBoost = 0.78
const compactScaleBoost = 0.5
const minToolScale = 0.72
const maxToolScale = 1.08
const workstationWidth = 64 * 3
const workstationHeight = 64
const chairYOffset = 65
const agentVisualScale = 0.5
const animationFps = 24
const workbenchSeatCount = 12

const officeTmjUrl = new URL('./assets/marvis/office.tmj', import.meta.url).href
const assetsTsjUrl = new URL('./assets/marvis/assets.tsj', import.meta.url).href

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
  characterScale: agentVisualScale,
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
    occupantsByDeskId: new Map()
  }
}

function ensureWorkbenchRouteParam(): void {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('workbench')) return
    params.set('workbench', '1')
    const search = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
  } catch {
    // URL sync is only for refresh/share behavior; the workbench still runs without it.
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

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}`)
  return (await response.json()) as T
}

async function loadSheet(spec: SheetSpec): Promise<AtlasImage> {
  const [image, atlas] = await Promise.all([loadImage(spec.imageUrl), loadJson<TextureAtlas>(spec.atlasUrl)])
  return { image, atlas }
}

async function loadWorkbenchAssets(): Promise<WorkbenchAssets> {
  const [officeTmj, tileset, sheetEntries] = await Promise.all([
    loadJson<TiledMap>(officeTmjUrl),
    loadJson<Tileset>(assetsTsjUrl),
    Promise.all(
      (Object.entries(sheetSpecs) as Array<[SheetKey, SheetSpec]>).map(async ([key, spec]) => {
        const sheet = await loadSheet(spec)
        return [key, sheet] as const
      })
    )
  ])

  const sheets = Object.fromEntries(sheetEntries) as SheetMap
  const firstGid = officeTmj.tilesets[0]?.firstgid ?? 1
  const gidToFrame = new Map<number, string>()
  for (const tile of tileset.tiles ?? []) {
    const image = tile.image ?? ''
    const frameName = image.split('/').pop()
    if (frameName) gidToFrame.set(firstGid + (tile.id ?? 0), frameName)
  }

  const workstationTemplate = parseWorkstationTemplate(officeTmj.layers, 'workstation')
  const workstationBossTemplate = parseWorkstationTemplate(officeTmj.layers, 'workstation_boss')
  if (!workstationTemplate || !workstationBossTemplate) {
    throw new Error('Missing Marvis workstation templates')
  }

  return { sheets, gidToFrame, workstationTemplate, workstationBossTemplate }
}

function findLayer(layers: TiledLayer[], name: string, type?: string): TiledLayer | null {
  for (const layer of layers) {
    if (layer.name === name && (!type || layer.type === type)) return layer
    if (layer.type === 'group' && layer.layers) {
      const child = findLayer(layer.layers, name, type)
      if (child) return child
    }
  }
  return null
}

function parseSpriteObjects(layer: TiledLayer | null): TemplateSprite[] {
  return (layer?.objects ?? [])
    .filter((object) => object.gid !== undefined)
    .map((object) => {
      const width = object.width ?? 0
      const height = object.height ?? 0
      return {
        id: object.id ?? 0,
        gid: object.gid ?? 0,
        x: object.x ?? 0,
        y: (object.y ?? 0) - height,
        width,
        height
      }
    })
}

function parseWorkstationTemplate(layers: TiledLayer[], groupName: string): WorkstationTemplate | null {
  const group = findLayer(layers, groupName, 'group')
  if (!group?.layers) return null

  const chairLayer = findLayer(group.layers, 'chair', 'objectgroup')
  const deskLayer = findLayer(group.layers, 'desk', 'objectgroup')
  const computerLayer = findLayer(group.layers, 'computer', 'objectgroup')
  const chairSprites = parseSpriteObjects(chairLayer)
  const deskSprites = parseSpriteObjects(deskLayer)
  const computerSprites = parseSpriteObjects(computerLayer)
  const computerContainer = (computerLayer?.objects ?? []).find((object) => object.gid === undefined && object.name === 'container')
  const computerContainerRect = computerContainer
    ? {
        x: computerContainer.x ?? 0,
        y: computerContainer.y ?? 0,
        width: computerContainer.width ?? 0,
        height: computerContainer.height ?? 0
      }
    : null
  const center = computeTemplateCenter([...chairSprites, ...deskSprites, ...computerSprites], computerContainerRect)
  return { chairSprites, deskSprites, computerSprites, computerContainerRect, center }
}

function computeTemplateCenter(
  sprites: TemplateSprite[],
  rect: { x: number; y: number; width: number; height: number } | null
): { x: number; y: number } {
  const bounds = [
    ...sprites.map((sprite) => ({
      x1: sprite.x,
      y1: sprite.y,
      x2: sprite.x + sprite.width,
      y2: sprite.y + sprite.height
    })),
    ...(rect
      ? [
          {
            x1: rect.x,
            y1: rect.y,
            x2: rect.x + rect.width,
            y2: rect.y + rect.height
          }
        ]
      : [])
  ]

  if (!bounds.length) return { x: 0, y: 0 }
  const minX = Math.min(...bounds.map((bound) => bound.x1))
  const minY = Math.min(...bounds.map((bound) => bound.y1))
  const maxX = Math.max(...bounds.map((bound) => bound.x2))
  const maxY = Math.max(...bounds.map((bound) => bound.y2))
  return { x: minX + (maxX - minX) / 2, y: minY + (maxY - minY) / 2 }
}

function animationFrames(sheet: AtlasImage, animationName: string): string[] {
  const frames = sheet.atlas.animations?.[animationName]
  if (frames?.length) return frames
  return Object.keys(sheet.atlas.frames).sort()
}

function pickFrame(sheet: AtlasImage, animationName: string, elapsed: number, fps = animationFps): string | null {
  const frames = animationFrames(sheet, animationName)
  if (!frames.length) return null
  const index = Math.floor((elapsed / 1000) * fps) % frames.length
  return frames[index] ?? null
}

function atlasScale(atlas: TextureAtlas): number {
  return atlas.meta?.scale && atlas.meta.scale > 0 ? atlas.meta.scale : 1
}

function currentDevicePixelScale(ctx: CanvasRenderingContext2D): number {
  const transform = ctx.getTransform()
  const scale = Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d))
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

function roundToDevicePixel(value: number, pixelScale: number): number {
  return Math.round(value * pixelScale) / pixelScale
}

function logicalFrameSize(sheet: AtlasImage, frameName: string): { width: number; height: number } | null {
  const frame = sheet.atlas.frames[frameName]
  if (!frame) return null
  const scale = atlasScale(sheet.atlas)
  return {
    width: frame.sourceSize.w / scale,
    height: frame.sourceSize.h / scale
  }
}

function drawAtlasFrame(
  ctx: CanvasRenderingContext2D,
  atlasImage: AtlasImage,
  frameName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  opacity = 1
): void {
  const entry = atlasImage.atlas.frames[frameName]
  if (!entry) return

  const { frame, spriteSourceSize, sourceSize } = entry
  const scale = atlasScale(atlasImage.atlas)
  const logicalSourceWidth = sourceSize.w / scale
  const logicalSourceHeight = sourceSize.h / scale
  const logicalSpriteX = spriteSourceSize.x / scale
  const logicalSpriteY = spriteSourceSize.y / scale
  const logicalSpriteWidth = spriteSourceSize.w / scale
  const logicalSpriteHeight = spriteSourceSize.h / scale
  const scaleX = width / logicalSourceWidth
  const scaleY = height / logicalSourceHeight
  const pixelScale = currentDevicePixelScale(ctx)
  const dx = roundToDevicePixel(x + logicalSpriteX * scaleX, pixelScale)
  const dy = roundToDevicePixel(y + logicalSpriteY * scaleY, pixelScale)
  const dw = roundToDevicePixel(logicalSpriteWidth * scaleX, pixelScale)
  const dh = roundToDevicePixel(logicalSpriteHeight * scaleY, pixelScale)

  ctx.save()
  ctx.globalAlpha *= opacity
  if (entry.rotated) {
    ctx.translate(dx, dy + dh)
    ctx.rotate(-Math.PI / 2)
    ctx.drawImage(atlasImage.image, frame.x, frame.y, frame.h, frame.w, 0, 0, dh, dw)
  } else {
    ctx.drawImage(atlasImage.image, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh)
  }
  ctx.restore()
}

function worldSpritePosition(
  template: WorkstationTemplate,
  sprite: TemplateSprite,
  slot: { x: number; y: number },
  pivot: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: slot.x - pivot.x + sprite.x - template.center.x,
    y: slot.y - pivot.y + sprite.y - template.center.y
  }
}

function drawTemplateSprites(
  ctx: CanvasRenderingContext2D,
  assets: WorkbenchAssets,
  template: WorkstationTemplate,
  sprites: TemplateSprite[],
  slot: { x: number; y: number },
  pivot: { x: number; y: number }
): void {
  for (const sprite of sprites) {
    const frameName = assets.gidToFrame.get(sprite.gid)
    if (!frameName) continue
    const position = worldSpritePosition(template, sprite, slot, pivot)
    drawAtlasFrame(ctx, assets.sheets.workstation, frameName, position.x, position.y, sprite.width, sprite.height)
  }
}

function drawAnimatedCharacter(
  ctx: CanvasRenderingContext2D,
  sheet: AtlasImage,
  animationName: string,
  x: number,
  y: number,
  elapsed: number,
  scale = agentVisualScale,
  pivotY = 30,
  fps = animationFps
): void {
  const frameName = pickFrame(sheet, animationName, elapsed, fps)
  if (!frameName) return
  const size = logicalFrameSize(sheet, frameName)
  if (!size) return

  const width = size.width * scale
  const height = size.height * scale
  const dx = x - width / 2
  const dy = y - height / 2 - pivotY * scale
  drawAtlasFrame(ctx, sheet, frameName, dx, dy, width, height)
}

function drawWorkingCharacter(ctx: CanvasRenderingContext2D, assets: WorkbenchAssets, slot: DeskSlot, elapsed: number): void {
  drawAnimatedCharacter(ctx, assets.sheets.working, 'working', slot.seat.x, slot.seat.y, elapsed, slot.characterScale)
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
  hoveredDeskId: DeskId | null
): void {
  ctx.clearRect(0, 0, officeWidth, officeHeight)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, officeWidth, officeHeight)

  ctx.save()
  ctx.translate(stageShift.x, stageShift.y)

  const depthLayers: Array<{ z: number; draw: () => void }> = []
  for (const slot of deskSlots) {
    const template = slot.slotIndex === 0 ? assets.workstationBossTemplate : assets.workstationTemplate
    const occupant = seatState.occupantsByDeskId.get(slot.id) ?? null
    const isSelected = seatState.userSeatIndex === slot.slotIndex
    const isHovered = hoveredDeskId === slot.id

    drawDeskHitArea(ctx, slot, isHovered, isSelected, occupant)
    drawTemplateSprites(ctx, assets, template, template.deskSprites, slot, { x: 36, y: -80 })

    if (occupant) {
      depthLayers.push({
        z: slot.z,
        draw: () => drawWorkingCharacter(ctx, assets, slot, elapsed)
      })
    }
    depthLayers.push({
      z: slot.y + chairYOffset,
      draw: () => drawTemplateSprites(ctx, assets, template, template.chairSprites, slot, { x: 34, y: -80 })
    })
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

  const baseScale = Math.min(visibleWidth / officeWidth, visibleHeight / officeHeight)
  const scaleBoost = visibleWidth <= 720 ? compactScaleBoost : officeScaleBoost
  const visualScale = baseScale * scaleBoost
  const toolScale = Math.min(maxToolScale, Math.max(minToolScale, baseScale))
  const canvasWidth = Math.round(officeWidth * visualScale)
  const canvasHeight = Math.round(officeHeight * visualScale)

  stage.parentElement?.style.setProperty('--workbench-tools-scale', toolScale.toFixed(4))
  stage.parentElement?.style.setProperty('--workbench-tools-layout-height', `${(100 / toolScale).toFixed(4)}%`)
  canvas.style.width = `${canvasWidth}px`
  canvas.style.height = `${canvasHeight}px`
  canvas.style.aspectRatio = `${officeWidth} / ${officeHeight}`
  canvas.style.left = stageWidth > visibleWidth ? `${visibleWidth / 2}px` : '50%'
  canvas.style.top = stageHeight > visibleHeight ? `${visibleHeight / 2}px` : '50%'
  canvas.style.transform = 'translate(-50%, -50%)'
}

type OfficeWorkbenchProps = {
  showNotification: (title: string, body: string) => Promise<void>
}

export function OfficeWorkbench({ showNotification }: OfficeWorkbenchProps) {
  const {
    snapshot,
    presence,
    viewModel,
    joinSpace,
    chooseSeat,
    toggleTimer,
    resetTimer,
    switchTimerMode,
    updateTimerPreset,
    toggleAmbientEnabled,
    addTask,
    toggleTask,
    removeDoneTasks
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
  const [spaceDraft, setSpaceDraft] = useState('')
  const workbenchUserSeatIndex = viewModel.userSeat < workbenchSeatCount ? viewModel.userSeat : -1
  const occupantsByDeskId = new Map<DeskId, WorkbenchSeatOccupant>()

  if (workbenchUserSeatIndex >= 0) {
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
    userSeatIndex: workbenchUserSeatIndex,
    activeRoomName: viewModel.activeRoom.name,
    connectionLabel: viewModel.connectionLabel,
    cycleLabel: `${viewModel.roomCycle.phase === 'focus' ? '专注中' : '休息中'} · ${formatStudyDuration(viewModel.roomCycle.remainingSeconds)}`,
    occupantsByDeskId
  }
  chooseSeatRef.current = chooseSeat

  useEffect(() => {
    ensureWorkbenchRouteParam()
  }, [])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
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
      canvas.style.cursor = slot && occupant?.kind !== 'peer' ? 'pointer' : 'default'
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
          if (occupant?.kind !== 'peer') return index
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
      canvas.style.cursor = 'default'
    }
  }, [])

  useEffect(() => {
    let canceled = false
    let animationFrame = 0

    async function run() {
      try {
        const assets = await loadWorkbenchAssets()
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
          drawScene(ctx, assets, time, seatStateRef.current, hoveredDeskIdRef.current)
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
      assetsRef.current = null
    }
  }, [])

  const handleJoinSpace = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    joinSpace(spaceDraft)
    setSpaceDraft('')
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
      </div>
      <aside className="workbench-tools" aria-label="自习工具">
        <form className="workbench-space-join" onSubmit={handleJoinSpace}>
          <KeyRound size={14} />
          <input
            value={spaceDraft}
            onChange={(event) => setSpaceDraft(event.target.value)}
            placeholder="输入空间码"
            aria-label="加入在线自习空间码"
            maxLength={18}
          />
          <button type="submit">加入</button>
        </form>
        <WorkbenchLeaderboard members={viewModel.roomMembers} presenceStatus={presence.status} />
        <WorkbenchPomodoro
          snapshot={snapshot}
          timerProgress={viewModel.timerProgress}
          ambientLabel={viewModel.activeRoom.ambient}
          onToggleTimer={toggleTimer}
          onResetTimer={resetTimer}
          onSwitchTimerMode={switchTimerMode}
          onUpdateTimerPreset={updateTimerPreset}
          onToggleAmbientEnabled={toggleAmbientEnabled}
        />
        <WorkbenchTasks
          tasks={snapshot.tasks}
          currentTask={viewModel.currentTask}
          openTasks={viewModel.openTasks}
          completedTasks={viewModel.completedTasks}
          onAddTask={addTask}
          onToggleTask={toggleTask}
          onRemoveDoneTasks={removeDoneTasks}
        />
      </aside>
    </section>
  )
}
