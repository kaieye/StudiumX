import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'

/** Viewport coordinates and the drawn shape targeted by a right-click. */
export type MindMapShapeContextMenuState = {
  shapeId: string
  x: number
  y: number
} | null

type MindMapShapeContextMenuProps = {
  state: MindMapShapeContextMenuState
  onClose: () => void
  onDelete: (shapeId: string) => void
}

/**
 * Small, focused context menu for freely drawn canvas shapes. It intentionally
 * shares the existing mind-map menu classes so its placement, focus treatment
 * and dark-theme surface remain consistent with node and connector menus.
 */
export function MindMapShapeContextMenu({
  state,
  onClose,
  onDelete
}: MindMapShapeContextMenuProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x: state?.x ?? 0, y: state?.y ?? 0 })

  useLayoutEffect(() => {
    if (!state) return
    const menu = ref.current
    const margin = 8
    const width = menu?.offsetWidth ?? 180
    const height = menu?.offsetHeight ?? 44
    const next = {
      x: Math.min(Math.max(margin, state.x), Math.max(margin, window.innerWidth - width - margin)),
      y: Math.min(Math.max(margin, state.y), Math.max(margin, window.innerHeight - height - margin))
    }
    setPosition((current) => current.x === next.x && current.y === next.y ? current : next)
  }, [state])

  useEffect(() => {
    if (!state) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, state])

  if (!state) return null

  return (
    <div
      ref={ref}
      className="mindmap-context-menu mindmap-shape-context-menu"
      role="menu"
      aria-label={t('mindmap.elementStyle.types.shape', { defaultValue: 'Shape' })}
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        className="mindmap-context-menu__item is-danger"
        role="menuitem"
        onClick={() => {
          onDelete(state.shapeId)
          onClose()
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
        {t('mindmap.elementStyle.delete', { defaultValue: 'Delete shape' })}
      </button>
    </div>
  )
}
