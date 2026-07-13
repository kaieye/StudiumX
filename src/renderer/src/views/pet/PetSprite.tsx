import { useEffect, useState } from 'react'
import {
  PET_APPEARANCE_IDS,
  type PetAppearanceId
} from '../../../../shared/teaching-types'
import bobaManifestJson from '../../assets/pets/boba/pet.json'
import luluManifestJson from '../../assets/pets/lulu/pet.json'
import shinchanManifestJson from '../../assets/pets/Shinchan/pet.json'
import usagiManifestJson from '../../assets/pets/usagi/pet.json'

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

export type PetDefinition = Omit<PetManifest, 'id' | 'spriteVersionNumber'> & {
  id: PetAppearanceId
  spriteVersionNumber: 1 | 2
  spritesheetUrl: string
}

type SpriteFrame = {
  columnIndex: number
  frameDurationMs: number
}

function createPetDefinition(
  id: PetAppearanceId,
  manifestJson: unknown,
  spritesheetUrl: string
): PetDefinition {
  const manifest = manifestJson as PetManifest
  return {
    ...manifest,
    id,
    spriteVersionNumber: manifest.spriteVersionNumber ?? 1,
    spritesheetUrl
  }
}

const petByAppearance: Record<PetAppearanceId, PetDefinition> = {
  boba: createPetDefinition(
    'boba',
    bobaManifestJson,
    new URL('../../assets/pets/boba/spritesheet.webp', import.meta.url).href
  ),
  'lulu-capybara': createPetDefinition(
    'lulu-capybara',
    luluManifestJson,
    new URL('../../assets/pets/lulu/spritesheet.webp', import.meta.url).href
  ),
  shinchan: createPetDefinition(
    'shinchan',
    shinchanManifestJson,
    new URL('../../assets/pets/Shinchan/spritesheet.webp', import.meta.url).href
  ),
  usagi: createPetDefinition(
    'usagi',
    usagiManifestJson,
    new URL('../../assets/pets/usagi/spritesheet.webp', import.meta.url).href
  )
}

export const PET_CATALOG = PET_APPEARANCE_IDS.map((appearance) => petByAppearance[appearance])
export const BOBA_PET = petByAppearance.boba

const CELL_WIDTH = 192
const CELL_HEIGHT = 208
const FRAME_COUNT = 8
const STANDARD_ROW_COUNT = 9

export const PET_SPRITE_CELL_WIDTH = CELL_WIDTH
export const PET_SPRITE_CELL_HEIGHT = CELL_HEIGHT
export const PET_SPRITE_FRAME_COUNT = FRAME_COUNT
export const PET_SPRITE_ROW_COUNT = STANDARD_ROW_COUNT

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

export function getPetDefinition(appearance: PetAppearanceId = 'boba'): PetDefinition {
  return petByAppearance[appearance] ?? BOBA_PET
}

export function getPetSpriteSheetUrl(appearance: PetAppearanceId = 'boba'): string {
  return getPetDefinition(appearance).spritesheetUrl
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

function spritePosition(frame: number, row: number, rowCount: number): string {
  const x = (frame / (FRAME_COUNT - 1)) * 100
  const y = (row / (rowCount - 1)) * 100
  return `${x}% ${y}%`
}

export function PetSprite({
  appearance = 'boba',
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
  const pet = getPetDefinition(appearance)
  const rowCount = pet.spriteVersionNumber === 2 ? 11 : STANDARD_ROW_COUNT
  const height = Math.round((size * CELL_HEIGHT) / CELL_WIDTH)

  useEffect(() => {
    setFrame(0)

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
  }, [appearance, state])

  return (
    <span
      className={`pet-sprite${className ? ` ${className}` : ''}`}
      data-appearance={pet.id}
      data-frame={frame}
      data-sprite-version={pet.spriteVersionNumber}
      data-state={state}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{
        width: size,
        height,
        backgroundImage: `url(${pet.spritesheetUrl})`,
        backgroundPosition: spritePosition(frame, stateRows[state], rowCount),
        backgroundSize: `${FRAME_COUNT * 100}% ${rowCount * 100}%`
      }}
    />
  )
}
