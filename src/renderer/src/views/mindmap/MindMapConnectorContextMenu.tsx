import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'

/** Viewport coordinates and the connector targeted by a right-click. */
export type MindMapConnectorContextMenuState = {
  connectorId: string
  x: number
  y: number
} | null

type MindMapConnectorContextMenuProps = {
  state: MindMapConnectorContextMenuState
  onClose: () => void
  onDelete: (connectorId: string) => void
}

/**
 * Small, focused context menu for free connectors.  It intentionally shares
 * the existing mind-map menu classes so its placement, focus treatment and
 * dark-theme surface remain consistent with node menus.
 */
export function MindMapConnectorContextMenu({
  state,
  onClose,
  onDelete
}: MindMapConnectorContextMenuProps) {
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
      className="mindmap-context-menu mindmap-connector-context-menu"
      role="menu"
      aria-label={t('mindmap.elementStyle.types.connector', { defaultValue: 'Connector' })}
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        className="mindmap-context-menu__item is-danger"
        role="menuitem"
        onClick={() => {
          onDelete(state.connectorId)
          onClose()
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
        {t('mindmap.elementStyle.delete', { defaultValue: 'Delete connector' })}
      </button>
    </div>
  )
}
