import { describe, expect, it } from 'vitest'
import {
  constrainImmersiveCardPosition,
  getImmersiveCardCenterPosition,
  IMMERSIVE_CARD_ORIGIN,
  snapImmersiveCardPosition
} from '../../src/renderer/src/views/workbench/immersive-card-drag'

describe('immersive focus timer card drag', () => {
  const originRect = { left: 900, top: 32, width: 280, height: 54 }
  const stageRect = { left: 0, top: 0, width: 1200, height: 800 }
  const scale = { x: 1, y: 1 }

  it('places the card center at the center of the immersive study-room stage', () => {
    expect(getImmersiveCardCenterPosition({ originRect, stageRect, scale })).toEqual({
      x: -440,
      y: 341
    })
  })


  it('keeps free dragging inside the immersive study-room stage', () => {
    expect(
      constrainImmersiveCardPosition({
        position: { x: -1_000, y: 1_000 },
        originRect,
        stageRect,
        scale
      })
    ).toEqual({ x: -900, y: 714 })
  })

  it('snaps near the original top-right placement', () => {
    expect(
      snapImmersiveCardPosition({
        position: { x: 24, y: -18 },
        centerPosition: { x: -440, y: 341 },
        scale
      })
    ).toEqual(IMMERSIVE_CARD_ORIGIN)
  })

  it('snaps near the center placement but leaves unrelated positions untouched', () => {
    const centerPosition = { x: -440, y: 341 }
    expect(
      snapImmersiveCardPosition({
        position: { x: -404, y: 327 },
        centerPosition,
        scale
      })
    ).toEqual(centerPosition)
    expect(
      snapImmersiveCardPosition({
        position: { x: -180, y: 130 },
        centerPosition,
        scale
      })
    ).toEqual({ x: -180, y: 130 })
  })
})
