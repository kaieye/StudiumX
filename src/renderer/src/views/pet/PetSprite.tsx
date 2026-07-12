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
  robot: {
    outline: '#15171d', outlineSoft: '#292c34', shell: '#eeeae1', shellLight: '#fffaf0',
    shellShadow: '#a9a49b', screen: '#111318', screenGlow: '#2a3039', accent: '#ff8a3d',
    cyan: '#78d8ff', green: '#7ee28c', red: '#ff626b', dust: '#747983'
  },
  cat: {
    outline: '#17151d', outlineSoft: '#34303f', shell: '#34313c', shellLight: '#f3eef8',
    shellShadow: '#25232c', screen: '#17151d', screenGlow: '#4d4658', accent: '#e98dbd',
    cyan: '#8fe5ff', green: '#8ee6a1', red: '#ff6978', dust: '#77717f'
  },
  owl: {
    outline: '#172033', outlineSoft: '#33415d', shell: '#64769b', shellLight: '#f1e3bd',
    shellShadow: '#3d4d70', screen: '#111827', screenGlow: '#33415d', accent: '#e9b949',
    cyan: '#7ddff6', green: '#7ed99a', red: '#ff6b76', dust: '#727b91'
  },
  sprout: {
    outline: '#163128', outlineSoft: '#31594b', shell: '#7ecf9d', shellLight: '#c7f2d5',
    shellShadow: '#4d9f76', screen: '#142b24', screenGlow: '#31594b', accent: '#f0c95c',
    cyan: '#8de7e3', green: '#9bea81', red: '#ff7079', dust: '#648a79'
  },
  fox: {
    outline: '#301a18', outlineSoft: '#5e3931', shell: '#db7548', shellLight: '#ffe1b8',
    shellShadow: '#984630', screen: '#241513', screenGlow: '#5e3931', accent: '#68c7c1',
    cyan: '#82e3ee', green: '#8cdd8c', red: '#ff5f69', dust: '#95665a'
  },
  penguin: {
    outline: '#111827', outlineSoft: '#344054', shell: '#26364a', shellLight: '#f5f7fa',
    shellShadow: '#172333', screen: '#0d1420', screenGlow: '#344054', accent: '#f0a54a',
    cyan: '#6ddcf4', green: '#82d99a', red: '#ff6876', dust: '#6c7888'
  }
}

let palette = palettes.robot
let activeAppearance: PetAppearanceId = 'robot'
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

function drawCharacterEyes(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  leftX: number,
  rightX: number,
  y: number
): void {
  if (state === 'failed') {
    for (const x of [leftX, rightX]) {
      block(context, palette.red, x, y, 2, 2)
      block(context, palette.red, x + 2, y + 2, 2, 2)
      block(context, palette.red, x + 2, y, 2, 2)
      block(context, palette.red, x, y + 2, 2, 2)
    }
    return
  }

  if (state === 'review') {
    block(context, palette.outline, leftX, y + 2, 4, 1)
    block(context, palette.outline, rightX, y + 2, 4, 1)
    block(context, palette.outline, leftX + 1, y + 3, 2, 1)
    block(context, palette.outline, rightX + 1, y + 3, 2, 1)
    return
  }

  if (state === 'waiting') {
    block(context, palette.outline, leftX, y, 4, 4)
    block(context, palette.outline, rightX, y, 4, 4)
    block(context, palette.shellLight, leftX + 1, y, 1, 1)
    block(context, palette.shellLight, rightX + 1, y, 1, 1)
    return
  }

  const blinking = state === 'idle' && (frame === 5 || frame === 6)
  if (blinking) {
    block(context, palette.outline, leftX, y + 2, 4, 1)
    block(context, palette.outline, rightX, y + 2, 4, 1)
    return
  }

  const eyeColor = state === 'running' ? palette.cyan : palette.outline
  block(context, eyeColor, leftX + (state === 'running' ? frame % 2 : 0), y, 3, 4)
  block(context, eyeColor, rightX - (state === 'running' ? frame % 2 : 0), y, 3, 4)
  block(context, palette.shellLight, leftX + 1, y, 1, 1)
  block(context, palette.shellLight, rightX + 1, y, 1, 1)
}

function drawCharacterFeet(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number,
  color = palette.outline
): void {
  const running = state === 'running-right' || state === 'running-left'
  const phase = frame % 4 < 2
  const leftX = state === 'jumping' ? 15 : running && phase ? 12 : 15
  const rightX = state === 'jumping' ? 28 : running && !phase ? 31 : 28
  const footY = state === 'jumping' ? 42 + y : 44 + y
  block(context, color, leftX, footY, 8, 4)
  block(context, color, rightX, footY, 8, 4)
}

function drawRobot(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  drawBody(context, state, frame, y)
}

function drawCat(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  const waving = state === 'waving'
  const failedDrop = state === 'failed' ? 2 : 0
  const tailLift = frame % 4 < 2 ? 0 : 2

  block(context, palette.outline, 36, 29 + y, 7, 6)
  block(context, palette.shell, 40, 24 + y - tailLift, 5, 10)
  block(context, palette.outline, 42, 20 + y - tailLift, 4, 8)
  drawCharacterFeet(context, state, frame, y)

  block(context, palette.outline, 13, 27 + y, 23, 18)
  block(context, palette.shell, 15, 28 + y, 19, 15)
  block(context, palette.shellLight, 20, 32 + y, 9, 9)

  if (waving) {
    const pawY = frame % 4 < 2 ? 13 : 16
    block(context, palette.outline, 35, pawY + y, 7, 15)
    block(context, palette.shell, 37, pawY + 2 + y, 3, 10)
    block(context, palette.shellLight, 37, pawY + y, 4, 4)
  } else {
    const armDrop = state === 'failed' ? 4 : 0
    block(context, palette.outline, 8, 29 + y + armDrop, 7, 12)
    block(context, palette.outline, 34, 29 + y + armDrop, 7, 12)
    block(context, palette.shell, 10, 31 + y + armDrop, 3, 7)
    block(context, palette.shell, 36, 31 + y + armDrop, 3, 7)
  }

  block(context, palette.outline, 10, 7 + y + failedDrop, 9, 9)
  block(context, palette.outline, 29, 7 + y + failedDrop, 9, 9)
  block(context, palette.shell, 12, 9 + y + failedDrop, 5, 5)
  block(context, palette.shell, 31, 9 + y + failedDrop, 5, 5)
  block(context, palette.outline, 9, 12 + y + failedDrop, 30, 19)
  block(context, palette.shell, 11, 13 + y + failedDrop, 26, 17)
  block(context, palette.shellLight, 18, 23 + y + failedDrop, 12, 6)

  block(context, palette.accent, 13, 9 + y + failedDrop, 22, 2)
  block(context, palette.accent, 7, 14 + y + failedDrop, 4, 9)
  block(context, palette.accent, 37, 14 + y + failedDrop, 4, 9)
  drawCharacterEyes(context, state, frame, 15, 29, 17 + y + failedDrop)
  block(context, palette.outline, 23, 24 + y + failedDrop, 3, 2)
}

function drawOwl(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  const wingLift = state === 'waving' ? (frame % 4 < 2 ? 10 : 13) : 26
  drawCharacterFeet(context, state, frame, y, palette.accent)

  block(context, palette.outline, 10, 18 + y, 29, 27)
  block(context, palette.shell, 12, 20 + y, 25, 23)
  block(context, palette.shellLight, 18, 27 + y, 13, 14)
  block(context, palette.outline, 5, 27 + y, 8, 14)
  block(context, palette.shellShadow, 7, 29 + y, 5, 9)
  block(context, palette.outline, 36, wingLift + y, 8, state === 'waving' ? 18 : 14)
  block(context, palette.shellShadow, 37, wingLift + 2 + y, 5, state === 'waving' ? 12 : 9)

  block(context, palette.outline, 12, 7 + y, 7, 7)
  block(context, palette.outline, 30, 7 + y, 7, 7)
  block(context, palette.outline, 10, 10 + y, 29, 21)
  block(context, palette.shell, 12, 11 + y, 25, 18)
  block(context, palette.shellLight, 13, 14 + y, 11, 11)
  block(context, palette.shellLight, 25, 14 + y, 11, 11)
  drawCharacterEyes(context, state, frame, 17, 29, 17 + y)
  block(context, palette.accent, 23, 23 + y, 5, 4)

  block(context, palette.outline, 17, 33 + y, 16, 10)
  block(context, palette.accent, 19, 34 + y, 12, 7)
  block(context, palette.shellLight, 24, 34 + y, 1, 7)
}

function drawSprout(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  const sway = frame % 4 < 2 ? 0 : 1
  block(context, palette.outline, 22, 3 + y, 4, 8)
  block(context, palette.outline, 14 - sway, 2 + y, 10, 7)
  block(context, palette.shell, 16 - sway, 3 + y, 7, 4)
  block(context, palette.outline, 25 + sway, 1 + y, 10, 8)
  block(context, palette.shellLight, 26 + sway, 3 + y, 7, 4)

  drawCharacterFeet(context, state, frame, y, palette.outline)
  block(context, palette.outline, 9, 14 + y, 31, 30)
  block(context, palette.shell, 11, 15 + y, 27, 27)
  block(context, palette.shellLight, 15, 18 + y, 11, 5)

  if (state === 'waving') {
    const handY = frame % 4 < 2 ? 19 : 22
    block(context, palette.outline, 37, handY + y, 8, 7)
    block(context, palette.shell, 38, handY + 1 + y, 5, 4)
  } else {
    block(context, palette.outline, 6, 29 + y, 6, 8)
    block(context, palette.outline, 37, 29 + y, 6, 8)
  }

  drawCharacterEyes(context, state, frame, 16, 29, 25 + y)
  block(context, palette.outline, 23, 32 + y, 4, 2)
  if (state === 'review') block(context, palette.green, 21, 35 + y, 8, 2)
}

function drawFox(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  const tailY = frame % 4 < 2 ? 28 : 26
  block(context, palette.outline, 34, tailY + y, 12, 13)
  block(context, palette.shell, 36, tailY + 1 + y, 9, 10)
  block(context, palette.shellLight, 41, tailY + 1 + y, 4, 6)
  drawCharacterFeet(context, state, frame, y)

  block(context, palette.outline, 13, 27 + y, 23, 18)
  block(context, palette.shell, 15, 29 + y, 19, 14)
  block(context, palette.shellLight, 20, 33 + y, 10, 9)

  const waveY = frame % 4 < 2 ? 13 : 16
  block(context, palette.outline, 7, 29 + y, 8, 12)
  block(context, palette.shellShadow, 9, 31 + y, 4, 7)
  block(context, palette.outline, 34, (state === 'waving' ? waveY : 29) + y, 8, state === 'waving' ? 16 : 12)
  block(context, palette.shellShadow, 36, (state === 'waving' ? waveY + 2 : 31) + y, 4, state === 'waving' ? 10 : 7)

  block(context, palette.outline, 8, 5 + y, 11, 13)
  block(context, palette.outline, 29, 5 + y, 11, 13)
  block(context, palette.shell, 11, 8 + y, 6, 7)
  block(context, palette.shell, 31, 8 + y, 6, 7)
  block(context, palette.outline, 9, 12 + y, 30, 20)
  block(context, palette.shell, 11, 13 + y, 26, 17)
  block(context, palette.shellLight, 17, 22 + y, 15, 8)
  drawCharacterEyes(context, state, frame, 15, 30, 17 + y)
  block(context, palette.outline, 23, 23 + y, 4, 3)

  block(context, palette.accent, 12, 28 + y, 25, 4)
  block(context, palette.accent, 30, 31 + y, 5, 8)
}

function drawPenguin(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  drawCharacterFeet(context, state, frame, y, palette.accent)
  block(context, palette.outline, 10, 10 + y, 29, 35)
  block(context, palette.shell, 12, 12 + y, 25, 31)
  block(context, palette.shellLight, 17, 21 + y, 15, 20)

  const waveY = frame % 4 < 2 ? 14 : 17
  block(context, palette.outline, 5, 25 + y, 8, 15)
  block(context, palette.shell, 7, 27 + y, 4, 9)
  block(context, palette.outline, 36, (state === 'waving' ? waveY : 25) + y, 8, state === 'waving' ? 20 : 15)
  block(context, palette.shell, 37, (state === 'waving' ? waveY + 2 : 27) + y, 4, state === 'waving' ? 13 : 9)

  block(context, palette.shellLight, 14, 13 + y, 21, 14)
  drawCharacterEyes(context, state, frame, 17, 29, 17 + y)
  block(context, palette.accent, 22, 23 + y, 6, 4)

  block(context, palette.accent, 13, 29 + y, 4, 4)
  block(context, palette.accent, 17, 32 + y, 17, 3)
  block(context, palette.accent, 31, 34 + y, 4, 9)
  block(context, palette.outline, 25, 34 + y, 10, 8)
  block(context, palette.shellLight, 27, 36 + y, 6, 4)
}

type CharacterDrawer = typeof drawRobot

const characterDrawers: Record<PetAppearanceId, CharacterDrawer> = {
  robot: drawRobot,
  cat: drawCat,
  owl: drawOwl,
  sprout: drawSprout,
  fox: drawFox,
  penguin: drawPenguin
}

function drawCharacter(
  context: CanvasRenderingContext2D,
  state: PetVisualState,
  frame: number,
  y: number
): void {
  characterDrawers[activeAppearance](context, state, frame, y)
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
    drawCharacter(context, state, frame, bob)
    context.restore()
    return
  }

  drawStateEffects(context, state, frame, bob)
  drawCharacter(context, state, frame, bob)
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

export function getPetSpriteSheetUrl(appearance: PetAppearanceId = 'robot'): string {
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
  appearance = 'robot',
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
