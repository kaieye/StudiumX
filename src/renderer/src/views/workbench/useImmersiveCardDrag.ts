import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import {
  constrainImmersiveCardPosition,
  getImmersiveCardCenterPosition,
  snapImmersiveCardPosition,
  type ImmersiveCardDragPosition,
  type ImmersiveCardDragRect
} from './immersive-card-drag'

const LONG_PRESS_DELAY_MS = 360
const PRE_DRAG_MOVE_TOLERANCE_PX = 8

const INITIAL_POSITION: ImmersiveCardDragPosition = { x: 0, y: 0 }

type ActivePress = {
  pointerId: number
  startX: number
  startY: number
  pointerOffsetX: number
  pointerOffsetY: number
  originRect: ImmersiveCardDragRect
  stageRect: ImmersiveCardDragRect
  scale: { x: number; y: number }
  element: HTMLElement
}

function toDragRect(rect: DOMRect): ImmersiveCardDragRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function isFormControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'))
}

/**
 * Enables a long-press drag interaction for a floating study-room card.
 * Positions are intentionally ephemeral: leaving immersive mode restores the
 * card to its normal rail position.
 */
export function useImmersiveCardDrag(enabled: boolean): {
  dragStyle: CSSProperties
  isDragging: boolean
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onPointerUp: (event: PointerEvent<HTMLElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  onClickCapture: (event: MouseEvent<HTMLElement>) => void
} {
  const pressRef = useRef<ActivePress | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const positionRef = useRef<ImmersiveCardDragPosition>(INITIAL_POSITION)
  const draggingRef = useRef(false)
  const suppressClickRef = useRef(false)
  const [position, setPosition] = useState<ImmersiveCardDragPosition>(INITIAL_POSITION)
  const [isDragging, setIsDragging] = useState(false)

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const finishDrag = useCallback((event?: PointerEvent<HTMLElement>) => {
    clearLongPressTimer()
    const press = pressRef.current
    if (draggingRef.current && press) {
      event?.preventDefault()
      event?.stopPropagation()
      if (press.element.hasPointerCapture(press.pointerId)) {
        press.element.releasePointerCapture(press.pointerId)
      }
      suppressClickRef.current = true
    }
    pressRef.current = null
    draggingRef.current = false
    setIsDragging(false)
  }, [clearLongPressTimer])

  useEffect(() => {
    if (enabled) return
    clearLongPressTimer()
    pressRef.current = null
    draggingRef.current = false
    positionRef.current = INITIAL_POSITION
    setPosition(INITIAL_POSITION)
    setIsDragging(false)
  }, [clearLongPressTimer, enabled])

  useEffect(() => () => clearLongPressTimer(), [clearLongPressTimer])

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || isFormControl(event.target)) return

    const element = event.currentTarget
    const stage = element.closest<HTMLElement>('.office-workbench-stage')
    if (!stage) return

    const rect = element.getBoundingClientRect()
    const scale = {
      x: element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1,
      y: element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1
    }
    const safeScale = {
      x: Number.isFinite(scale.x) && scale.x > 0 ? scale.x : 1,
      y: Number.isFinite(scale.y) && scale.y > 0 ? scale.y : 1
    }
    const currentPosition = positionRef.current
    const originRect = {
      left: rect.left - currentPosition.x * safeScale.x,
      top: rect.top - currentPosition.y * safeScale.y,
      width: rect.width,
      height: rect.height
    }

    const press: ActivePress = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top,
      originRect,
      stageRect: toDragRect(stage.getBoundingClientRect()),
      scale: safeScale,
      element
    }
    pressRef.current = press
    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      if (pressRef.current !== press) return
      draggingRef.current = true
      setIsDragging(true)
      element.setPointerCapture(press.pointerId)
    }, LONG_PRESS_DELAY_MS)
  }, [clearLongPressTimer, enabled])

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const press = pressRef.current
    if (!press || press.pointerId !== event.pointerId) return

    if (!draggingRef.current) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > PRE_DRAG_MOVE_TOLERANCE_PX) {
        clearLongPressTimer()
        pressRef.current = null
      }
      return
    }

    event.preventDefault()
    const rawPosition = {
      x: (event.clientX - press.pointerOffsetX - press.originRect.left) / press.scale.x,
      y: (event.clientY - press.pointerOffsetY - press.originRect.top) / press.scale.y
    }
    const boundedPosition = constrainImmersiveCardPosition({
      position: rawPosition,
      originRect: press.originRect,
      stageRect: press.stageRect,
      scale: press.scale
    })
    const centerPosition = getImmersiveCardCenterPosition({
      originRect: press.originRect,
      stageRect: press.stageRect,
      scale: press.scale
    })
    const nextPosition = snapImmersiveCardPosition({
      position: boundedPosition,
      centerPosition,
      scale: press.scale
    })
    positionRef.current = nextPosition
    setPosition(nextPosition)
  }, [clearLongPressTimer])

  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
  }, [])

  return {
    dragStyle: {
      '--immersive-card-drag-x': `${position.x}px`,
      '--immersive-card-drag-y': `${position.y}px`
    } as CSSProperties,
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onClickCapture
  }
}
