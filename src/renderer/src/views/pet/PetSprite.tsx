import { useEffect, useState } from 'react'
import type { PetAppearanceId } from '../../../../shared/teaching-types'

export type PetVisualState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

const CELL_WIDTH = 48
const CELL_HEIGHT = 52
const FRAME_COUNT = 8

export const PET_SPRITE_CELL_WIDTH = CELL_WIDTH
export const PET_SPRITE_CELL_HEIGHT = CELL_HEIGHT
export const PET_SPRITE_FRAME_COUNT = FRAME_COUNT

const stateRows: Record<PetVisualState, number> = {
  idle: 0,
  'running-right': 1,
  'running-left': 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8
}

const stateFps: Record<PetVisualState, number> = {
  idle: 5,
  'running-right': 12,
  'running-left': 12,
  waving: 9,
  jumping: 12,
  failed: 7,
  waiting: 6,
  running: 10,
  review: 10
}

type PetPalette = {
  outline: string
  outlineSoft: string
  shell: string
  shellLight: string
  shellShadow: string
  screen: string
  screenGlow: string
  accent: string
  cyan: string
  green: string
  red: string
  dust: string
}

const palettes: Record<PetAppearanceId, PetPalette> = {
  classic: {
    outline: '#15171d', outlineSoft: '#292c34', shell: '#eeeae1', shellLight: '#fffaf0',
    shellShadow: '#a9a49b', screen: '#111318', screenGlow: '#2a3039', accent: '#ff8a3d',
    cyan: '#78d8ff', green: '#7ee28c', red: '#ff626b', dust: '#747983'
  },
  mint: {
    outline: '#122321', outlineSoft: '#27423d', shell: '#9be5d1', shellLight: '#d9fff4',
    shellShadow: '#4f9f8b', screen: '#10201e', screenGlow: '#1d4b43', accent: '#ffe075',
    cyan: '#8cfff1', green: '#a9f08e', red: '#ff6f7d', dust: '#5b827a'
  },
  sunset: {
    outline: '#2b1820', outlineSoft: '#51303a', shell: '#ffad76', shellLight: '#ffe0b5',
    shellShadow: '#c65c50', screen: '#27171d', screenGlow: '#633344', accent: '#fff06a',
    cyan: '#7de8ff', green: '#97e58e', red: '#ff526c', dust: '#98605d'
  },
  midnight: {
    outline: '#101421', outlineSoft: '#26304d', shell: '#586b9d', shellLight: '#9cafe2',
    shellShadow: '#303d6e', screen: '#0a0d18', screenGlow: '#1c2850', accent: '#ffd45f',
    cyan: '#6ee7ff', green: '#79e5a2', red: '#ff687e', dust: '#4c5575'
  },
  berry: {
    outline: '#271522', outlineSoft: '#4e2944', shell: '#d783bd', shellLight: '#ffd2ed',
    shellShadow: '#985279', screen: '#21131e', screenGlow: '#552848', accent: '#8ef0cf',
    cyan: '#8be9ff', green: '#99e68c', red: '#ff607b', dust: '#80506f'
  },
  mono: {
    outline: '#101113', outlineSoft: '#303236', shell: '#aeb2b8', shellLight: '#f4f5f6',
    shellShadow: '#666b73', screen: '#090a0b', screenGlow: '#25282d', accent: '#ffffff',
    cyan: '#d9dde2', green: '#bce6c4', red: '#ff6972', dust: '#74777c'
  }
}

let palette = palettes.classic
let activeAppearance: PetAppearanceId = 'classic'
const spriteSheetUrls = new Map<PetAppearanceId, string>()

function block(
  context: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  width = 1,
  height = 1
): void {
  context.fillStyle = color
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height))
}

function drawSpark(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size = 1
): void {
  block(context, color, x, y - size, size, size * 3)
  block(context, color, x - size, y, size * 3, size)
}

function drawQuestion(context: CanvasRenderingContext2D, frame: number): void {
  const y = frame % 4 < 2 ? 3 : 2
  block(context, palette.accent, 39, y, 5, 2)
  block(context, palette.accent, 43, y + 2, 2, 4)
  block(context, palette.accent, 40, y + 6, 4, 2)
  block(context, palette.accent, 40, y + 8, 2, 3)
  block(context, palette.accent, 40, y + 13, 2, 2)
}

function drawFace(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  block(context, palette.outline, 12, 14 + y, 24, 14)
  block(context, palette.screenGlow, 14, 16 + y, 20, 10)
  block(context, palette.screen, 15, 17 + y, 18, 8)

  if (state === 'failed') {
    block(context, palette.red, 17, 19 + y, 2, 2)
    block(context, palette.red, 20, 21 + y, 2, 2)
    block(context, palette.red, 20, 19 + y, 2, 2)
    block(context, palette.red, 17, 21 + y, 2, 2)
    block(context, palette.red, 27, 19 + y, 2, 2)
    block(context, palette.red, 30, 21 + y, 2, 2)
    block(context, palette.red, 30, 19 + y, 2, 2)
    block(context, palette.red, 27, 21 + y, 2, 2)
    return
  }

  if (state === 'review') {
    block(context, palette.green, 17, 19 + y, 4, 2)
    block(context, palette.green, 28, 19 + y, 4, 2)
    block(context, palette.green, 21, 23 + y, 7, 1)
    block(context, palette.green, 22, 24 + y, 5, 1)
    return
  }

  if (state === 'waiting') {
    block(context, palette.accent, 18, 18 + y, 3, 3)
    block(context, palette.accent, 28, 18 + y, 3, 3)
    block(context, palette.shellLight, 19, 18 + y)
    block(context, palette.shellLight, 29, 18 + y)
    return
  }

  if (state === 'running') {
    const scan = frame % 5
    block(context, palette.cyan, 17 + scan, 19 + y, 4, 2)
    block(context, palette.cyan, 28 - scan, 19 + y, 4, 2)
    return
  }

  const blinking = state === 'idle' && (frame === 5 || frame === 6)
  if (blinking) {
    block(context, palette.cyan, 17, 21 + y, 5)
    block(context, palette.cyan, 28, 21 + y, 5)
  } else {
    block(context, palette.cyan, 18, 19 + y, 3, 3)
    block(context, palette.cyan, 28, 19 + y, 3, 3)
    block(context, palette.shellLight, 19, 19 + y)
    block(context, palette.shellLight, 29, 19 + y)
  }
}

function drawAntenna(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  if (state === 'failed') {
    block(context, palette.outline, 25, 6 + y, 7, 2)
    block(context, palette.outline, 30, 8 + y, 3, 3)
    block(context, palette.red, 31, 9 + y)
    return
  }

  if (activeAppearance === 'mint') {
    block(context, palette.outline, 8, 6 + y, 7, 6)
    block(context, palette.shell, 10, 7 + y, 4, 4)
    block(context, palette.outline, 33, 6 + y, 7, 6)
    block(context, palette.shell, 34, 7 + y, 4, 4)
    return
  }

  if (activeAppearance === 'sunset') {
    block(context, palette.outline, 15, 3 + y, 3, 7)
    block(context, palette.accent, 14, 1 + y, 5, 3)
    block(context, palette.outline, 30, 3 + y, 3, 7)
    block(context, palette.accent, 29, 1 + y, 5, 3)
    return
  }

  if (activeAppearance === 'midnight') {
    block(context, palette.outline, 23, 4 + y, 3, 6)
    drawSpark(context, 24, 2 + y, palette.accent, 1)
    return
  }

  if (activeAppearance === 'berry') {
    block(context, palette.outline, 8, 6 + y, 7, 7)
    block(context, palette.shellLight, 10, 8 + y, 3, 3)
    block(context, palette.outline, 33, 6 + y, 7, 7)
    block(context, palette.shellLight, 35, 8 + y, 3, 3)
    return
  }

  if (activeAppearance === 'mono') {
    block(context, palette.outline, 13, 6 + y, 22, 4)
    block(context, palette.shellLight, 17, 4 + y, 14, 3)
    return
  }

  block(context, palette.outline, 23, 4 + y, 3, 6)
  block(context, palette.outline, 21, 1 + y, 7, 4)
  block(context, palette.accent, 23, 2 + y, 3, 2)
  if (state === 'running' && frame % 2 === 0) block(context, palette.cyan, 24, y, 1, 1)
}

function drawLegs(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  const running = state === 'running-right' || state === 'running-left'
  const tucked = state === 'jumping'
  const phase = frame % 4 < 2 ? 0 : 1

  if (tucked) {
    block(context, palette.outline, 14, 40 + y, 9, 5)
    block(context, palette.shellShadow, 16, 40 + y, 5, 2)
    block(context, palette.outline, 27, 40 + y, 9, 5)
    block(context, palette.shellShadow, 29, 40 + y, 5, 2)
    return
  }

  const leftX = running ? (phase ? 12 : 17) : 15
  const rightX = running ? (phase ? 30 : 25) : 28
  const leftY = running && phase ? y + 42 : y + 41
  const rightY = running && !phase ? y + 42 : y + 41
  block(context, palette.outline, leftX, leftY, 7, 7)
  block(context, palette.shellShadow, leftX + 2, leftY, 3, 5)
  block(context, palette.outline, leftX - 2, leftY + 6, 10, 3)
  block(context, palette.outline, rightX, rightY, 7, 7)
  block(context, palette.shellShadow, rightX + 2, rightY, 3, 5)
  block(context, palette.outline, rightX - 1, rightY + 6, 10, 3)
}

function drawArms(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  if (state === 'waving') {
    const handY = frame % 4 < 2 ? 7 : 10
    block(context, palette.outline, 5, 22 + y, 6, 13)
    block(context, palette.shellShadow, 7, 24 + y, 2, 8)
    block(context, palette.outline, 38, 14 + y, 5, 14)
    block(context, palette.outline, 40, handY + y, 5, 9)
    block(context, palette.shell, 40, handY + 1 + y, 3, 6)
    block(context, palette.accent, 44, handY - 2 + y, 2, 2)
    return
  }

  if (state === 'review') {
    block(context, palette.outline, 4, 13 + y, 6, 15)
    block(context, palette.shell, 6, 14 + y, 2, 11)
    block(context, palette.outline, 38, 13 + y, 6, 15)
    block(context, palette.shell, 40, 14 + y, 2, 11)
    return
  }

  if (state === 'jumping') {
    block(context, palette.outline, 3, 19 + y, 9, 5)
    block(context, palette.shell, 5, 20 + y, 6, 2)
    block(context, palette.outline, 36, 19 + y, 9, 5)
    block(context, palette.shell, 37, 20 + y, 6, 2)
    return
  }

  if (state === 'waiting') {
    block(context, palette.outline, 5, 22 + y, 6, 12)
    block(context, palette.shellShadow, 7, 24 + y, 2, 8)
    block(context, palette.outline, 37, 22 + y, 6, 12)
    block(context, palette.shellShadow, 39, 24 + y, 2, 8)
    block(context, palette.outline, 18, 34 + y, 6, 5)
    block(context, palette.outline, 25, 34 + y, 6, 5)
    block(context, palette.accent, 23, 36 + y, 3, 2)
    return
  }

  if (state === 'running-right' || state === 'running-left') {
    const phase = frame % 4 < 2
    block(context, palette.outline, phase ? 4 : 6, 22 + y, 7, 10)
    block(context, palette.outline, phase ? 39 : 37, 20 + y, 7, 11)
    block(context, palette.shellShadow, phase ? 41 : 39, 22 + y, 2, 6)
    return
  }

  const failedDrop = state === 'failed' ? 4 : 0
  block(context, palette.outline, 5, 22 + y + failedDrop, 6, 13)
  block(context, palette.shellShadow, 7, 24 + y + failedDrop, 2, 8)
  block(context, palette.outline, 37, 22 + y + failedDrop, 6, 13)
  block(context, palette.shellShadow, 39, 24 + y + failedDrop, 2, 8)
}

function drawBody(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  drawLegs(context, state, frame, y)
  drawArms(context, state, frame, y)

  block(context, palette.outline, 13, 30 + y, 22, 14)
  block(context, palette.shellShadow, 15, 32 + y, 18, 10)
  block(context, palette.shell, 17, 32 + y, 14, 8)
  block(context, palette.screen, 18, 34 + y, 12, 5)
  block(context, palette.accent, 20, 35 + y, 2, 1)
  block(context, palette.accent, 21, 36 + y, 2, 1)
  block(context, palette.accent, 20, 37 + y, 2, 1)
  block(context, palette.shellLight, 25, 37 + y, 4, 1)

  block(context, palette.outline, 9, 8 + y, 30, 3)
  block(context, palette.outline, 7, 11 + y, 34, 20)
  block(context, palette.outline, 9, 31 + y, 30, 4)
  block(context, palette.shell, 10, 10 + y, 28, 3)
  block(context, palette.shellLight, 9, 13 + y, 30, 12)
  block(context, palette.shell, 9, 25 + y, 30, 4)
  block(context, palette.shellShadow, 11, 29 + y, 26, 3)
  block(context, palette.outlineSoft, 7, 18 + y, 2, 8)
  block(context, palette.outlineSoft, 39, 18 + y, 2, 8)

  drawFace(context, state, frame, y)
  drawAntenna(context, state, frame, y)
}

function drawStateEffects(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  if (state === 'running-right' || state === 'running-left') {
    block(context, palette.dust, 2, 43, frame % 3 + 2, 2)
    if (frame % 2 === 0) block(context, palette.dust, 6, 48, 3, 1)
  } else if (state === 'jumping') {
    block(context, palette.cyan, 5, 34, 2, 4)
    block(context, palette.cyan, 41, 34, 2, 4)
  } else if (state === 'failed') {
    block(context, palette.red, 43, 11 + y, 2, 7)
    block(context, palette.red, 43, 20 + y, 2, 2)
  } else if (state === 'waiting') {
    drawQuestion(context, frame)
  } else if (state === 'running') {
    const points = [
      [4, 12],
      [43, 16],
      [4, 34],
      [42, 37]
    ] as const
    const active = points[frame % points.length]!
    points.forEach(([x, pointY]) => block(context, palette.outlineSoft, x, pointY, 2, 2))
    block(context, palette.cyan, active[0], active[1], 2, 2)
  } else if (state === 'review') {
    drawSpark(context, 5, 10 + (frame % 2), palette.green)
    drawSpark(context, 42, 7 + ((frame + 1) % 2), palette.accent)
    if (frame % 2 === 0) drawSpark(context, 44, 29, palette.cyan)
  } else if (state === 'waving') {
    block(context, palette.accent, 43, 4 + (frame % 2), 2, 2)
    block(context, palette.accent, 46, 8 + ((frame + 1) % 2), 1, 3)
  }
}

function drawPetFrame(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number
): void {
  const bob = state === 'idle'
    ? [0, 0, 0, -1, -1, 0, 0, 0][frame]!
    : state === 'review'
      ? [-1, -3, -5, -3, -1, -2, -4, -2][frame]!
      : state === 'jumping'
        ? [-1, -4, -7, -9, -9, -7, -4, -1][frame]!
        : state === 'failed'
          ? [2, 3, 3, 4, 4, 3, 3, 2][frame]!
          : state === 'running-right' || state === 'running-left'
            ? [0, -2, -1, -3, 0, -2, -1, -3][frame]!
            : [0, -1, 0, -1, 0, -1, 0, -1][frame]!

  if (state === 'running-left') {
    context.save()
    context.translate(CELL_WIDTH, 0)
    context.scale(-1, 1)
    drawStateEffects(context, state, frame, bob)
    drawBody(context, state, frame, bob)
    context.restore()
    return
  }

  drawStateEffects(context, state, frame, bob)
  drawBody(context, state, frame, bob)
}

function buildSpriteSheet(appearance: PetAppearanceId): string {
  activeAppearance = appearance
  palette = palettes[appearance]
  const canvas = document.createElement('canvas')
  canvas.width = CELL_WIDTH * FRAME_COUNT
  canvas.height = CELL_HEIGHT * Object.keys(stateRows).length
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.imageSmoothingEnabled = false

  for (const [state, row] of Object.entries(stateRows) as [PetVisualState, number][]) {
    for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
      context.save()
      context.translate(frame * CELL_WIDTH, row * CELL_HEIGHT)
      drawPetFrame(context, state, frame)
      context.restore()
    }
  }

  return canvas.toDataURL('image/png')
}

export function getPetSpriteSheetUrl(appearance: PetAppearanceId = 'classic'): string {
  const cached = spriteSheetUrls.get(appearance)
  if (cached) return cached
  const sheetUrl = buildSpriteSheet(appearance)
  spriteSheetUrls.set(appearance, sheetUrl)
  return sheetUrl
}

export function getPetSpriteRow(state: PetVisualState): number {
  return stateRows[state]
}

export function getPetSpriteFrameIndex(
  state: PetVisualState,
  elapsedMs: number,
  reducedMotion = false
): number {
  if (reducedMotion) return 0
  return Math.floor((elapsedMs / 1000) * stateFps[state]) % FRAME_COUNT
}

export function PetSprite({
  appearance = 'classic',
  className,
  label,
  size,
  state
}: {
  appearance?: PetAppearanceId
  className?: string
  label: string
  size: number
  state: PetVisualState
}) {
  const [frame, setFrame] = useState(0)
  const sheetUrl = getPetSpriteSheetUrl(appearance)
  const height = Math.round((size * CELL_HEIGHT) / CELL_WIDTH)

  useEffect(() => {
    setFrame(0)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reducedMotion) return

    let canceled = false
    let timer = 0
    const delay = Math.round(1000 / stateFps[state])
    const advance = (): void => {
      timer = window.setTimeout(() => {
        if (canceled) return
        setFrame((current) => (current + 1) % FRAME_COUNT)
        advance()
      }, delay)
    }
    advance()

    return () => {
      canceled = true
      window.clearTimeout(timer)
    }
  }, [state])

  return (
    <span
      className={`pet-sprite${className ? ` ${className}` : ''}`}
      data-appearance={appearance}
      data-frame={frame}
      data-state={state}
      role="img"
      aria-label={label}
      style={{
        width: size,
        height,
        backgroundImage: sheetUrl ? `url(${sheetUrl})` : undefined,
        backgroundPosition: `${-frame * size}px ${-stateRows[state] * height}px`,
        backgroundSize: `${size * FRAME_COUNT}px ${height * Object.keys(stateRows).length}px`
      }}
    />
  )
}
