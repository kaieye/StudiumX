import { ChevronDown, Shapes } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapDrawingShape as SharedMindMapDrawingShape } from '../../../../shared/mindmap/domain/types'
import { NodeShapeIcon } from './mind-map-shape-icons'

/**
 * Shapes that can be selected from the drawing-tool palette.
 *
 * These deliberately reuse the existing topic-shape vocabulary so the toolbar
 * previews match the rest of the mind-map design system. The canvas drawing
 * interaction consumes this intent separately; this component owns only the
 * transient toolbar/menu UI.
 */
export type MindMapDrawingShape = SharedMindMapDrawingShape

type MindMapDrawingShapeOption = Readonly<{
  shape: MindMapDrawingShape
  labelKey:
    | 'shapeRect'
    | 'shapeRoundedRect'
    | 'shapeEllipse'
    | 'shapeDiamond'
    | 'shapeParallelogram'
    | 'shapeHexagon'
}>

export const MIND_MAP_DRAWING_SHAPE_OPTIONS: readonly MindMapDrawingShapeOption[] = [
  { shape: 'rect', labelKey: 'shapeRect' },
  { shape: 'rounded-rect', labelKey: 'shapeRoundedRect' },
  { shape: 'ellipse', labelKey: 'shapeEllipse' },
  { shape: 'diamond', labelKey: 'shapeDiamond' },
  { shape: 'parallelogram', labelKey: 'shapeParallelogram' },
  { shape: 'hexagon', labelKey: 'shapeHexagon' }
]

type MindMapShapeToolProps = Readonly<{
  disabled?: boolean
  /** The currently armed drawing shape, when a parent owns the interaction state. */
  activeShape?: MindMapDrawingShape | null
  /** Called when the user arms the default rectangle or chooses another shape. */
  onShapeChange?: (shape: MindMapDrawingShape) => void
}>

const LONG_PRESS_DELAY_MS = 450

/**
 * Compact drawing-shape toolbar control.
 *
 * A normal click arms the default rectangle. Holding the same control opens a
 * palette of additional shapes; ArrowDown and the context-menu gesture offer
 * keyboard/pointer alternatives to the hold gesture. It intentionally does
 * not own canvas pointer handling or persistence.
 */
export function MindMapShapeTool({
  disabled = false,
  activeShape,
  onShapeChange
}: MindMapShapeToolProps) {
  const { t } = useTranslation()
  const [uncontrolledShape, setUncontrolledShape] = useState<MindMapDrawingShape | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)
  const suppressNextClickRef = useRef(false)

  const selectedShape = activeShape === undefined ? uncontrolledShape : activeShape

  const labelForShape = (shape: MindMapDrawingShape): string => {
    const option = MIND_MAP_DRAWING_SHAPE_OPTIONS.find((candidate) => candidate.shape === shape)
    return t(`mindmap.topicStyle.${option?.labelKey ?? 'shapeRect'}`)
  }

  const clearLongPressTimer = (): void => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const chooseShape = (shape: MindMapDrawingShape): void => {
    if (activeShape === undefined) setUncontrolledShape(shape)
    onShapeChange?.(shape)
    setMenuOpen(false)
    triggerRef.current?.focus()
  }

  const openMenu = (): void => {
    if (!disabled) setMenuOpen(true)
  }

  const beginLongPress = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    // A few WebView/test PointerEvent shims omit `button`; treat that as the
    // normal primary-pointer gesture rather than making long-press unusable.
    if (disabled || (event.button !== 0 && event.button !== undefined)) return
    clearLongPressTimer()
    longPressTriggeredRef.current = false
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      longPressTriggeredRef.current = true
      suppressNextClickRef.current = true
      openMenu()
    }, LONG_PRESS_DELAY_MS)
  }

  const endLongPress = (): void => {
    clearLongPressTimer()
    if (longPressTriggeredRef.current) {
      // Browser click synthesis follows pointer-up. Leave the suppression in
      // place for that click, then release it if the platform did not emit one.
      window.setTimeout(() => {
        longPressTriggeredRef.current = false
        suppressNextClickRef.current = false
      }, 0)
    }
  }

  const cancelLongPress = (): void => {
    clearLongPressTimer()
    longPressTriggeredRef.current = false
  }

  const handleTriggerClick = (): void => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }
    chooseShape('rounded-rect')
  }

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openMenu()
    } else if (event.key === 'Escape') {
      setMenuOpen(false)
    }
  }

  useEffect(() => {
    return () => clearLongPressTimer()
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const closeWhenPointerLeavesTool = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      triggerRef.current?.focus()
    }

    window.addEventListener('pointerdown', closeWhenPointerLeavesTool)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeWhenPointerLeavesTool)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  useEffect(() => {
    if (disabled) setMenuOpen(false)
  }, [disabled])

  const triggerLabel = selectedShape
    ? `${t('mindmap.topicStyle.shapeLabel')}: ${labelForShape(selectedShape)}`
    : t('mindmap.topicStyle.shapeLabel')

  return (
    <div ref={rootRef} className="mindmap-shape-tool">
      <button
        ref={triggerRef}
        type="button"
        className={`mindmap-floating-toolbar__btn${selectedShape ? ' is-active' : ''}`}
        disabled={disabled}
        onClick={handleTriggerClick}
        onPointerDown={beginLongPress}
        onPointerUp={endLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onContextMenu={(event) => {
          event.preventDefault()
          cancelLongPress()
          openMenu()
        }}
        onKeyDown={handleTriggerKeyDown}
        data-tooltip={t('mindmap.topicStyle.shapeLabel')}
        aria-label={triggerLabel}
        aria-pressed={selectedShape !== null}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <Shapes size={16} aria-hidden="true" />
        <ChevronDown size={8} className="mindmap-floating-toolbar__submenu-chevron" aria-hidden="true" />
      </button>

      {menuOpen ? (
        <div className="mindmap-shape-tool__menu" role="menu" aria-label={t('mindmap.topicStyle.shapePicker')}>
          {MIND_MAP_DRAWING_SHAPE_OPTIONS.map((option) => {
            const label = t(`mindmap.topicStyle.${option.labelKey}`)
            const selected = option.shape === selectedShape
            return (
              <button
                key={option.shape}
                type="button"
                className={`mindmap-shape-tool__option${selected ? ' is-selected' : ''}`}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => chooseShape(option.shape)}
              >
                <NodeShapeIcon shape={option.shape} size={25} />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
