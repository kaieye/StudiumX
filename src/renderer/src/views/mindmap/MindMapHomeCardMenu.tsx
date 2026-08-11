import { Copy, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapSummary } from '../../../../shared/mindmap/mind-map-types'

export type MindMapHomeCardMenuState = {
  summary: MindMapSummary
  x: number
  y: number
} | null

type MindMapHomeCardMenuProps = {
  state: MindMapHomeCardMenuState
  onClose: () => void
  onRename: (summary: MindMapSummary) => void
  onRemove: (summary: MindMapSummary) => void | Promise<void>
  onCopy: (summary: MindMapSummary) => void | Promise<void>
}

/**
 * Contextual actions for a map card in the gallery. This is deliberately kept
 * separate from the canvas topic menu: these actions operate on a complete
 * document rather than an individual topic.
 */
export function MindMapHomeCardMenu({
  state,
  onClose,
  onRename,
  onRemove,
  onCopy
}: MindMapHomeCardMenuProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: state?.x ?? 0, y: state?.y ?? 0 })

  useLayoutEffect(() => {
    if (!state) return
    const menu = ref.current
    const margin = 8
    const width = menu?.offsetWidth ?? 184
    const height = menu?.offsetHeight ?? 132
    const next = {
      x: Math.min(Math.max(margin, state.x), Math.max(margin, window.innerWidth - width - margin)),
      y: Math.min(Math.max(margin, state.y), Math.max(margin, window.innerHeight - height - margin))
    }
    setPosition((current) => (current.x === next.x && current.y === next.y ? current : next))
  }, [state])

  useEffect(() => {
    if (!state) return
    const closeWhenOutside = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, state])

  if (!state) return null

  const run = (action: (summary: MindMapSummary) => void | Promise<void>): void => {
    onClose()
    void action(state.summary)
  }

  return (
    <div
      ref={ref}
      className="mindmap-context-menu mindmap-home-card-menu"
      role="menu"
      aria-label={t('mindmap.documentActions')}
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        className="mindmap-context-menu__item"
        role="menuitem"
        onClick={() => run(onRename)}
      >
        <Pencil size={14} aria-hidden="true" />
        {t('mindmap.renameDocument')}
      </button>
      <button
        type="button"
        className="mindmap-context-menu__item"
        role="menuitem"
        onClick={() => run(onCopy)}
      >
        <Copy size={14} aria-hidden="true" />
        {t('mindmap.copyDocument')}
      </button>
      <div className="mindmap-context-menu__divider" />
      <button
        type="button"
        className="mindmap-context-menu__item is-danger"
        role="menuitem"
        onClick={() => run(onRemove)}
      >
        <Trash2 size={14} aria-hidden="true" />
        {t('mindmap.removeDocument')}
      </button>
    </div>
  )
}
