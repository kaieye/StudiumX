import { useEffect, useState } from 'react'
import type { PetAppearanceId } from '../../../../shared/teaching-types'
import bobaManifestJson from '../../assets/pets/boba/pet.json'

export const PET_VISUAL_STATES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review'
] as const

export type PetVisualState = (typeof PET_VISUAL_STATES)[number]

type PetManifest = {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
  spriteVersionNumber?: 1 | 2
}

type SpriteFrame = {
  columnIndex: number
  frameDurationMs: number
}

const bobaManifest = bobaManifestJson as PetManifest
const bobaSpritesheetUrl = new URL('../../assets/pets/boba/spritesheet.webp', import.meta.url).href

// Codex treats a custom pet without spriteVersionNumber as a v1 8x9 atlas.
// Version 2 keeps the same nine animation rows and adds two look-direction rows.
export const BOBA_PET = {
  ...bobaManifest,
  spriteVersionNumber: bobaManifest.spriteVersionNumber ?? 1,
  spritesheetUrl: bobaSpritesheetUrl
} as const

const CELL_WIDTH = 192
const CELL_HEIGHT = 208
const FRAME_COUNT = 8
const STANDARD_ROW_COUNT = 9
const SPRITE_ROW_COUNT = BOBA_PET.spriteVersionNumber === 2 ? 11 : STANDARD_ROW_COUNT

export const PET_SPRITE_CELL_WIDTH = CELL_WIDTH
export const PET_SPRITE_CELL_HEIGHT = CELL_HEIGHT
export const PET_SPRITE_FRAME_COUNT = FRAME_COUNT
export const PET_SPRITE_ROW_COUNT = SPRITE_ROW_COUNT

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

function rowFrames(
  count: number,
  frameDurationMs: number,
  finalFrameDurationMs: number
): readonly SpriteFrame[] {
  return Array.from({ length: count }, (_, columnIndex) => ({
    columnIndex,
    frameDurationMs: columnIndex === count - 1 ? finalFrameDurationMs : frameDurationMs
  }))
}

// These frame counts and timings mirror the local Codex avatar renderer.
const idleFrames: readonly SpriteFrame[] = [
  { columnIndex: 0, frameDurationMs: 1680 },
  { columnIndex: 1, frameDurationMs: 660 },
  { columnIndex: 2, frameDurationMs: 660 },
  { columnIndex: 3, frameDurationMs: 840 },
  { columnIndex: 4, frameDurationMs: 840 },
  { columnIndex: 5, frameDurationMs: 1920 }
]

const stateFrames: Record<PetVisualState, readonly SpriteFrame[]> = {
  idle: idleFrames,
  'running-right': rowFrames(8, 120, 220),
  'running-left': rowFrames(8, 120, 220),
  waving: rowFrames(4, 140, 280),
  jumping: rowFrames(5, 140, 280),
  failed: rowFrames(8, 140, 240),
  waiting: rowFrames(6, 150, 260),
  running: rowFrames(6, 120, 220),
  review: rowFrames(6, 150, 280)
}

export function getPetSpriteSheetUrl(_appearance?: PetAppearanceId): string {
  return BOBA_PET.spritesheetUrl
}

export function getPetSpriteRow(state: PetVisualState): number {
  return stateRows[state]
}

export function getPetSpriteFrameIndex(
  state: PetVisualState,
  elapsedMs: number,
  reducedMotion = false
): number {
  const frames = stateFrames[state]
  if (reducedMotion || frames.length === 1) return frames[0]?.columnIndex ?? 0

  const cycleDuration = frames.reduce((total, frame) => total + frame.frameDurationMs, 0)
  let remaining = ((elapsedMs % cycleDuration) + cycleDuration) % cycleDuration
  for (const frame of frames) {
    if (remaining < frame.frameDurationMs) return frame.columnIndex
    remaining -= frame.frameDurationMs
  }
  return frames.at(-1)?.columnIndex ?? 0
}

function spritePosition(frame: number, row: number): string {
  const x = (frame / (FRAME_COUNT - 1)) * 100
  const y = (row / (SPRITE_ROW_COUNT - 1)) * 100
  return `${x}% ${y}%`
}

export function PetSprite({
  appearance: _appearance,
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
  const height = Math.round((size * CELL_HEIGHT) / CELL_WIDTH)

  useEffect(() => {
    setFrame(0)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reducedMotion) return

    const frames = stateFrames[state]
    let canceled = false
    let frameCursor = 0
    let timer = 0

    const scheduleNextFrame = (): void => {
      const current = frames[frameCursor] ?? frames[0]
      if (!current) return
      timer = window.setTimeout(() => {
        if (canceled) return
        frameCursor = (frameCursor + 1) % frames.length
        setFrame(frames[frameCursor]?.columnIndex ?? 0)
        scheduleNextFrame()
      }, current.frameDurationMs)
    }

    scheduleNextFrame()
    return () => {
      canceled = true
      window.clearTimeout(timer)
    }
  }, [state])

  return (
    <span
      className={`pet-sprite${className ? ` ${className}` : ''}`}
      data-appearance="boba"
      data-frame={frame}
      data-sprite-version={BOBA_PET.spriteVersionNumber}
      data-state={state}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{
        width: size,
        height,
        backgroundImage: `url(${BOBA_PET.spritesheetUrl})`,
        backgroundPosition: spritePosition(frame, stateRows[state]),
        backgroundSize: `${FRAME_COUNT * 100}% ${SPRITE_ROW_COUNT * 100}%`
      }}
    />
  )
}
