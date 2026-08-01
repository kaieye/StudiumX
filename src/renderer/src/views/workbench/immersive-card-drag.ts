export type ImmersiveCardDragPosition = {
  x: number
  y: number
}

export type ImmersiveCardDragRect = {
  left: number
  top: number
  width: number
  height: number
}

export const IMMERSIVE_CARD_SNAP_DISTANCE_PX = 56

export const IMMERSIVE_CARD_ORIGIN: ImmersiveCardDragPosition = { x: 0, y: 0 }

export function getImmersiveCardCenterPosition(input: {
  originRect: ImmersiveCardDragRect
  stageRect: ImmersiveCardDragRect
  scale: { x: number; y: number }
}): ImmersiveCardDragPosition {
  const { originRect, stageRect, scale } = input
  const targetLeft = stageRect.left + (stageRect.width - originRect.width) / 2
  const targetTop = stageRect.top + (stageRect.height - originRect.height) / 2

  return {
    x: (targetLeft - originRect.left) / scale.x,
    y: (targetTop - originRect.top) / scale.y
  }
}


export function constrainImmersiveCardPosition(input: {
  position: ImmersiveCardDragPosition
  originRect: ImmersiveCardDragRect
  stageRect: ImmersiveCardDragRect
  scale: { x: number; y: number }
}): ImmersiveCardDragPosition {
  const { position, originRect, stageRect, scale } = input
  const minimumX = (stageRect.left - originRect.left) / scale.x
  const maximumX = (stageRect.left + stageRect.width - originRect.width - originRect.left) / scale.x
  const minimumY = (stageRect.top - originRect.top) / scale.y
  const maximumY = (stageRect.top + stageRect.height - originRect.height - originRect.top) / scale.y
  const clamp = (value: number, minimum: number, maximum: number): number =>
    minimum > maximum ? (minimum + maximum) / 2 : Math.min(Math.max(value, minimum), maximum)

  return {
    x: clamp(position.x, minimumX, maximumX),
    y: clamp(position.y, minimumY, maximumY)
  }
}

export function snapImmersiveCardPosition(input: {
  position: ImmersiveCardDragPosition
  centerPosition: ImmersiveCardDragPosition
  scale: { x: number; y: number }
  thresholdPx?: number
}): ImmersiveCardDragPosition {
  const { position, centerPosition, scale, thresholdPx = IMMERSIVE_CARD_SNAP_DISTANCE_PX } = input
  const distanceTo = (candidate: ImmersiveCardDragPosition): number =>
    Math.hypot((position.x - candidate.x) * scale.x, (position.y - candidate.y) * scale.y)

  if (distanceTo(IMMERSIVE_CARD_ORIGIN) <= thresholdPx) return IMMERSIVE_CARD_ORIGIN
  if (distanceTo(centerPosition) <= thresholdPx) return centerPosition
  return position
}
