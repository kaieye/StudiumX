import { useEffect, useRef } from 'react'

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

type CharacterState = {
  id: 'main'
  name: string
  assignedDeskId: DeskId | null
}

const officeWidth = 64 * 17
const officeHeight = 64 * 14
const stageShift = { x: 40, y: -20 }
const canvasOutputScale = 2
const officeScaleBoost = 1.1
const compactScaleBoost = 0.66
const workstationWidth = 64 * 3
const workstationHeight = 64
const chairYOffset = 65
const agentVisualScale = 0.5
const animationFps = 24

const officeTmjUrl = new URL('./assets/marvis/office.tmj', import.meta.url).href
const assetsTsjUrl = new URL('./assets/marvis/assets.tsj', import.meta.url).href

const workstationPositions = [
  { col: 8, row: 2 },
  { col: 12, row: 2 },
  { col: 8, row: 6 },
  { col: 12, row: 6 },
  { col: 8, row: 10 },
  { col: 12, row: 10 }
].map((seat, slotIndex) => ({
  slotIndex,
  x: (seat.col + workstationWidth / 64 / 2) * 64,
  y: (seat.row + workstationHeight / 64 / 2) * 64,
  width: workstationWidth,
  height: workstationHeight
}))

const deskSlots: DeskSlot[] = workstationPositions.map((layout) => ({
  id: `desk-${layout.slotIndex + 1}`,
  label: `桌子 ${layout.slotIndex + 1}`,
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

function drawDeskHitArea(ctx: CanvasRenderingContext2D, slot: DeskSlot, isHovered: boolean, isSelected: boolean): void {
  if (!isHovered && !isSelected) return

  const { x, y, width, height } = slot.hitArea
  ctx.save()
  roundedRect(ctx, x, y, width, height, 18)
  ctx.fillStyle = isSelected ? 'rgba(86, 140, 255, 0.12)' : 'rgba(86, 140, 255, 0.08)'
  ctx.fill()
  ctx.lineWidth = isSelected ? 2 : 1.5
  ctx.strokeStyle = isSelected ? 'rgba(68, 121, 255, 0.82)' : 'rgba(68, 121, 255, 0.46)'
  ctx.stroke()

  ctx.font = '600 13px system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const badgeWidth = Math.max(56, ctx.measureText(slot.label).width + 20)
  const badgeHeight = 26
  const badgeX = x + width / 2 - badgeWidth / 2
  const badgeY = y - 12
  roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 13)
  ctx.fillStyle = isSelected ? 'rgba(68, 121, 255, 0.92)' : 'rgba(255, 255, 255, 0.95)'
  ctx.fill()
  ctx.fillStyle = isSelected ? '#ffffff' : '#3454a8'
  ctx.fillText(isSelected ? '正在工作' : slot.label, x + width / 2, badgeY + badgeHeight / 2)
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
  character: CharacterState,
  hoveredDeskId: DeskId | null
): void {
  ctx.clearRect(0, 0, officeWidth, officeHeight)
  ctx.fillStyle = '#f7f7f7'
  ctx.fillRect(0, 0, officeWidth, officeHeight)

  ctx.save()
  ctx.translate(stageShift.x, stageShift.y)

  const depthLayers: Array<{ z: number; draw: () => void }> = []
  for (const slot of deskSlots) {
    const template = slot.slotIndex === 0 ? assets.workstationBossTemplate : assets.workstationTemplate
    const isSelected = character.assignedDeskId === slot.id
    const isHovered = hoveredDeskId === slot.id

    drawDeskHitArea(ctx, slot, isHovered, isSelected)
    drawTemplateSprites(ctx, assets, template, template.deskSprites, slot, { x: 36, y: -80 })

    if (isSelected) {
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
  const canvasWidth = Math.round(officeWidth * visualScale)
  const canvasHeight = Math.round(officeHeight * visualScale)

  canvas.style.width = `${canvasWidth}px`
  canvas.style.height = `${canvasHeight}px`
  canvas.style.aspectRatio = `${officeWidth} / ${officeHeight}`
  canvas.style.left = stageWidth > visibleWidth ? `${visibleWidth / 2}px` : '50%'
  canvas.style.top = stageHeight > visibleHeight ? `${visibleHeight / 2}px` : '50%'
  canvas.style.transform = 'translate(-50%, -50%)'
}

export function OfficeWorkbench() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const assetsRef = useRef<WorkbenchAssets | null>(null)
  const characterRef = useRef<CharacterState>({ id: 'main', name: 'StudiumX', assignedDeskId: 'desk-1' })
  const hoveredDeskIdRef = useRef<DeskId | null>(null)

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
      deskSlots.find((slot) => slot.id === characterRef.current.assignedDeskId)?.label ?? '未选择桌子'

    const syncCanvasAccessibility = () => {
      canvas.setAttribute('aria-label', `StudiumX 工作区：当前在${selectedDeskLabel()}，使用方向键切换桌子`)
    }

    const selectDesk = (slot: DeskSlot) => {
      characterRef.current = { ...characterRef.current, assignedDeskId: slot.id }
      hoveredDeskIdRef.current = slot.id
      canvas.style.cursor = 'pointer'
      syncCanvasAccessibility()
    }

    const updateHover = (event: MouseEvent) => {
      const slot = findDeskAt(canvasPointToScene(event, canvas))
      hoveredDeskIdRef.current = slot?.id ?? null
      canvas.style.cursor = slot ? 'pointer' : 'default'
    }

    const handleClick = (event: MouseEvent) => {
      const slot = findDeskAt(canvasPointToScene(event, canvas))
      if (!slot) return
      selectDesk(slot)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const currentIndex = deskSlots.findIndex((slot) => slot.id === characterRef.current.assignedDeskId)
      let nextIndex: number | null = null

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % deskSlots.length
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = currentIndex === -1 ? deskSlots.length - 1 : (currentIndex - 1 + deskSlots.length) % deskSlots.length
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = deskSlots.length - 1
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
          drawScene(ctx, assets, time, characterRef.current, hoveredDeskIdRef.current)
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

  return (
    <section className="office-workbench-page" aria-label="工作区">
      <div ref={stageRef} className="office-workbench-stage">
        <canvas
          ref={canvasRef}
          className="office-workbench-canvas"
          aria-label="StudiumX 工作区：当前在桌子 1，使用方向键切换桌子"
          aria-live="polite"
          tabIndex={0}
        />
      </div>
    </section>
  )
}
