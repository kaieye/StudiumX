import { useEffect, useState } from 'react'
import type { PetAppearanceId } from '../../../../shared/teaching-types'
import {
  getPetAnimationFrames,
  getPetDefinition,
  getPetSpriteAtlasStyle,
  getPetSpriteDisplayHeight,
  type PetVisualState
} from './pet-animation-catalog'

export {
  BOBA_PET,
  PET_CATALOG,
  PET_SPRITE_CELL_HEIGHT,
  PET_SPRITE_CELL_WIDTH,
  PET_SPRITE_FRAME_COUNT,
  PET_SPRITE_ROW_COUNT,
  PET_VISUAL_STATES,
  getPetDefinition,
  getPetSpriteFrameIndex,
  getPetSpriteRow,
  getPetSpriteSheetUrl
} from './pet-animation-catalog'
export type {
  PetAnimationFrame,
  PetDefinition,
  PetSpriteAtlasStyle,
  PetVisualState
} from './pet-animation-catalog'

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
  const atlasStyle = getPetSpriteAtlasStyle(appearance, state, frame)

  useEffect(() => {
    setFrame(0)

    const frames = getPetAnimationFrames(state)
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
        height: getPetSpriteDisplayHeight(size),
        backgroundImage: `url(${pet.spritesheetUrl})`,
        ...atlasStyle
      }}
    />
  )
}
