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

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY)?.matches === true
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
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const pet = getPetDefinition(appearance)
  const atlasStyle = getPetSpriteAtlasStyle(appearance, state, frame)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    if (!media) return
    const handleChange = (event: MediaQueryListEvent): void => setReducedMotion(event.matches)
    setReducedMotion(media.matches)
    media.addEventListener?.('change', handleChange)
    return () => media.removeEventListener?.('change', handleChange)
  }, [])

  useEffect(() => {
    setFrame(0)

    const frames = getPetAnimationFrames(state)
    if (reducedMotion) return
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
  }, [appearance, reducedMotion, state])

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
