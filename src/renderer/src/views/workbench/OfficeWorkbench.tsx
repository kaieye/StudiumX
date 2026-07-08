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
}

type AtlasImage = {
  image: HTMLImageElement
  atlas: TextureAtlas
}

type SheetSpec = {
  imageUrl: string
  atlasUrl: string
}

const sheetSpecs = {
  workstation: {
    imageUrl: new URL('./assets/marvis/img/workstation.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/img/workstation.webp.json', import.meta.url).href
  },
  agent: {
    imageUrl: new URL('./assets/marvis/img/agent.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/img/agent.webp.json', import.meta.url).href
  },
  working: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/working.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/working.webp.json', import.meta.url).href
  },
  standby: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/standby.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/standby.webp.json', import.meta.url).href
  },
  talkingOnSeat: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/talking_on_seat.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/talking_on_seat.webp.json', import.meta.url).href
  },
  peek: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/peek.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/peek.webp.json', import.meta.url).href
  },
  sleeping: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/sleeping.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/sleeping.webp.json', import.meta.url).href
  },
  screenWorkingMain: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_main.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_main.webp.json', import.meta.url).href
  },
  screenWorkingApk: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_apk_use.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_apk_use.webp.json', import.meta.url).href
  },
  screenWorkingFile: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_file_use.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_file_use.webp.json', import.meta.url).href
  },
  screenWorkingWin: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_win_use.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_win_use.webp.json', import.meta.url).href
  },
  screenWorkingSearch: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_search_or_browser_use.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_working_search_or_browser_use.webp.json', import.meta.url).href
  },
  screenPlaying1: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_playing1.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_playing1.webp.json', import.meta.url).href
  },
  screenPlaying2: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_playing2.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_playing2.webp.json', import.meta.url).href
  },
  screenPlaying3: {
    imageUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_playing3.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/agent/fc_screen_playing3.webp.json', import.meta.url).href
  },
  catWalk: {
    imageUrl: new URL('./assets/marvis/spritesheet/cat/fc_cat_walk_h.webp', import.meta.url).href,
    atlasUrl: new URL('./assets/marvis/spritesheet/cat/fc_cat_walk_h.webp.json', import.meta.url).href
  }
} as const satisfies Record<string, SheetSpec>

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

type AgentType = 'main' | 'App Agent' | 'File Agent' | 'Computer Agent' | 'Browser Agent' | 'Search Agent'

type AgentConfig = {
  type: AgentType
  displayName: string
  subtitle: string
  status: string
  slotIndex: number
  actionSheet: SheetKey
  actionAnimation: string
  nameFrame: string
  screenSheet: SheetKey
  bubble?: string
  mode: 'working' | 'idle' | 'slacking'
}

const officeWidth = 64 * 17
const officeHeight = 64 * 14
const stageShift = { x: 40, y: -20 }
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

const agentConfigs: AgentConfig[] = [
  {
    type: 'main',
    displayName: 'Marvis',
    subtitle: 'Team Leader',
    status: '统筹中',
    slotIndex: 0,
    actionSheet: 'working',
    actionAnimation: 'working',
    nameFrame: 'name_main.png',
    screenSheet: 'screenWorkingMain',
    bubble: '整理任务',
    mode: 'working'
  },
  {
    type: 'App Agent',
    displayName: 'App Agent',
    subtitle: 'APP操作专员',
    status: '执行中',
    slotIndex: 1,
    actionSheet: 'working',
    actionAnimation: 'working',
    nameFrame: 'name_App Agent.png',
    screenSheet: 'screenWorkingApk',
    mode: 'working'
  },
  {
    type: 'File Agent',
    displayName: 'File Agent',
    subtitle: '数字资产管家',
    status: '归档中',
    slotIndex: 2,
    actionSheet: 'talkingOnSeat',
    actionAnimation: 'talking_on_seat',
    nameFrame: 'name_File Agent.png',
    screenSheet: 'screenWorkingFile',
    bubble: '文件已归类',
    mode: 'working'
  },
  {
    type: 'Computer Agent',
    displayName: 'Computer Agent',
    subtitle: '电脑系统运维',
    status: '待命',
    slotIndex: 3,
    actionSheet: 'standby',
    actionAnimation: 'standby',
    nameFrame: 'name_Computer Agent.png',
    screenSheet: 'screenWorkingWin',
    mode: 'idle'
  },
  {
    type: 'Browser Agent',
    displayName: 'Browser Agent',
    subtitle: '网页交互专员',
    status: '摸鱼中',
    slotIndex: 4,
    actionSheet: 'peek',
    actionAnimation: 'peek',
    nameFrame: 'name_Browser Agent.png',
    screenSheet: 'screenPlaying1',
    bubble: '先看一眼',
    mode: 'slacking'
  },
  {
    type: 'Search Agent',
    displayName: 'Search Agent',
    subtitle: '搜索专家',
    status: '休息',
    slotIndex: 5,
    actionSheet: 'sleeping',
    actionAnimation: 'sleeping',
    nameFrame: 'name_Search Agent.png',
    screenSheet: 'screenWorkingSearch',
    mode: 'idle'
  }
]

const staticFurniture = [
  { name: 'water_bar', frameName: 'water_bar.png', x: 12, y: 60 },
  { name: 'treadmill', frameName: 'treadmill.png', x: 12, y: 296 },
  { name: 'toilet', frameName: 'toilet.png', x: 12, y: 574 }
]

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
  const scaleX = width / sourceSize.w
  const scaleY = height / sourceSize.h
  const dx = x + spriteSourceSize.x * scaleX
  const dy = y + spriteSourceSize.y * scaleY
  const dw = spriteSourceSize.w * scaleX
  const dh = spriteSourceSize.h * scaleY

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

function worldRectPosition(
  template: WorkstationTemplate,
  rect: { x: number; y: number },
  slot: { x: number; y: number },
  pivot: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: slot.x - pivot.x + rect.x - template.center.x,
    y: slot.y - pivot.y + rect.y - template.center.y
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

function drawStaticFurniture(ctx: CanvasRenderingContext2D, assets: WorkbenchAssets): void {
  for (const furniture of staticFurniture) {
    const frame = assets.sheets.workstation.atlas.frames[furniture.frameName]
    if (!frame) continue
    drawAtlasFrame(
      ctx,
      assets.sheets.workstation,
      furniture.frameName,
      furniture.x,
      furniture.y,
      frame.sourceSize.w,
      frame.sourceSize.h
    )
  }
}

function drawScreen(
  ctx: CanvasRenderingContext2D,
  assets: WorkbenchAssets,
  template: WorkstationTemplate,
  slot: { x: number; y: number },
  agent: AgentConfig,
  elapsed: number
): void {
  const rect = template.computerContainerRect
  if (!rect) return

  const shellPosition = worldRectPosition(template, { x: rect.x - 2, y: rect.y - 2 }, slot, { x: 36, y: -81 })
  drawAtlasFrame(ctx, assets.sheets.workstation, 'screen.png', shellPosition.x, shellPosition.y, 77, 48)

  const screenPosition = worldRectPosition(template, rect, slot, { x: 36, y: -81 })
  if (agent.mode === 'idle') {
    const idleFrame = agent.type === 'main' ? 'screen_on.png' : 'screen_img.png'
    drawAtlasFrame(ctx, assets.sheets.workstation, idleFrame, screenPosition.x, screenPosition.y, rect.width, rect.height)
    return
  }

  const sheet = assets.sheets[agent.screenSheet]
  const animationName = animationNameForSheet(agent.screenSheet)
  const frameName = pickFrame(sheet, animationName, elapsed)
  if (frameName) drawAtlasFrame(ctx, sheet, frameName, screenPosition.x, screenPosition.y, rect.width, rect.height)
}

function animationNameForSheet(sheet: SheetKey): string {
  switch (sheet) {
    case 'screenWorkingMain':
      return 'fc_screen_working_main'
    case 'screenWorkingApk':
      return 'fc_screen_working_apk_use'
    case 'screenWorkingFile':
      return 'fc_screen_working_file_use'
    case 'screenWorkingWin':
      return 'fc_screen_working_win_use'
    case 'screenWorkingSearch':
      return 'fc_screen_working_search_or_browser_use'
    case 'screenPlaying1':
      return 'fc_screen_playing1'
    case 'screenPlaying2':
      return 'fc_screen_playing2'
    case 'screenPlaying3':
      return 'fc_screen_playing3'
    case 'catWalk':
      return 'fc_cat_walk_h'
    default:
      return sheet
  }
}

function drawAgent(ctx: CanvasRenderingContext2D, assets: WorkbenchAssets, agent: AgentConfig, x: number, y: number, elapsed: number): void {
  const sheet = assets.sheets[agent.actionSheet]
  const frameName = pickFrame(sheet, agent.actionAnimation, elapsed)
  if (!frameName) return

  const width = 534 * agentVisualScale
  const height = 400 * agentVisualScale
  const dx = x - width / 2
  const dy = y - height / 2 - 30 * agentVisualScale
  drawAtlasFrame(ctx, sheet, frameName, dx, dy, width, height)
}

function drawAgentName(ctx: CanvasRenderingContext2D, assets: WorkbenchAssets, agent: AgentConfig, x: number, y: number): void {
  const sheet = assets.sheets.agent
  const frame = sheet.atlas.frames[agent.nameFrame]
  if (!frame) return
  const width = frame.sourceSize.w
  const height = frame.sourceSize.h
  drawAtlasFrame(ctx, sheet, agent.nameFrame, x - width / 2, y - 114, width, height)
}

function drawBubble(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.save()
  ctx.font = '500 13px system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  const paddingX = 10
  const width = Math.max(72, ctx.measureText(text).width + paddingX * 2)
  const height = 28
  const bx = x - width / 2
  const by = y - 152
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 3
  roundedRect(ctx, bx, by, width, height, 14)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.beginPath()
  ctx.moveTo(x - 5, by + height - 1)
  ctx.lineTo(x + 5, by + height - 1)
  ctx.lineTo(x, by + height + 6)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#1f1f1f'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, by + height / 2)
  ctx.restore()
}

function drawCat(ctx: CanvasRenderingContext2D, assets: WorkbenchAssets, elapsed: number): void {
  const sheet = assets.sheets.catWalk
  const frameName = pickFrame(sheet, 'fc_cat_walk_h', elapsed, 18)
  if (!frameName) return
  const x = 392 + Math.sin(elapsed / 1800) * 46
  const y = 820
  drawAtlasFrame(ctx, sheet, frameName, x - 267 - 4, y - 400 + 80, 534, 400)
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

function drawScene(ctx: CanvasRenderingContext2D, assets: WorkbenchAssets, elapsed: number): void {
  ctx.clearRect(0, 0, officeWidth, officeHeight)
  ctx.fillStyle = '#f7f7f7'
  ctx.fillRect(0, 0, officeWidth, officeHeight)

  ctx.save()
  ctx.translate(stageShift.x, stageShift.y)

  const agentLayer: Array<{ z: number; draw: () => void }> = []
  for (const layout of workstationPositions) {
    const agent = agentConfigs.find((item) => item.slotIndex === layout.slotIndex)
    const template = layout.slotIndex === 0 ? assets.workstationBossTemplate : assets.workstationTemplate

    drawTemplateSprites(ctx, assets, template, template.deskSprites, layout, { x: 36, y: -80 })
    if (agent) {
      agentLayer.push({
        z: layout.y,
        draw: () => drawScreen(ctx, assets, template, layout, agent, elapsed)
      })
      agentLayer.push({
        z: layout.y + 64,
        draw: () => drawAgent(ctx, assets, agent, layout.x, layout.y + 64, elapsed)
      })
    }
    agentLayer.push({
      z: layout.y + chairYOffset,
      draw: () => drawTemplateSprites(ctx, assets, template, template.chairSprites, layout, { x: 34, y: -80 })
    })
  }

  drawStaticFurniture(ctx, assets)
  agentLayer.push({ z: 788, draw: () => drawCat(ctx, assets, elapsed) })
  agentLayer.sort((a, b) => a.z - b.z)
  for (const layer of agentLayer) layer.draw()

  for (const agent of agentConfigs) {
    const layout = workstationPositions[agent.slotIndex]
    if (!layout) continue
    drawAgentName(ctx, assets, agent, layout.x, layout.y + 64)
    if (agent.bubble) drawBubble(ctx, agent.bubble, layout.x, layout.y + 64)
  }

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
          const dpr = window.devicePixelRatio || 1
          const nextWidth = Math.round(officeWidth * dpr)
          const nextHeight = Math.round(officeHeight * dpr)
          if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
            canvas.width = nextWidth
            canvas.height = nextHeight
          }
          ctx.save()
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          drawScene(ctx, assets, time)
          ctx.restore()
          animationFrame = requestAnimationFrame(render)
        }

        animationFrame = requestAnimationFrame(render)
      } catch (error) {
        console.error('Failed to load Marvis workbench assets', error)
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
          aria-label="Marvis 办公室工作区场景"
        />
      </div>
    </section>
  )
}
