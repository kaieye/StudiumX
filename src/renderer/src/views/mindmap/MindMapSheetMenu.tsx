import { Copy, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type MindMapSheetMenuState = {
  sheetId: string
  title: string
  x: number
  y: number
} | null

type MindMapSheetMenuProps = {
  state: MindMapSheetMenuState
  canRemove: boolean
  onClose: () => void
  onRename: (sheetId: string) => void
  onDuplicate: (sheetId: string) => void
  onRemove: (sheetId: string) => void
}

/**
 * Contextual lifecycle actions for a sheet.  Sheet controls deliberately live
 * here rather than beside every title so the sheet strip remains compact.
 */
export function MindMapSheetMenu({
  state,
  canRemove,
  onClose,
  onRename,
  onDuplicate,
  onRemove
}: MindMapSheetMenuProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: state?.x ?? 0, y: state?.y ?? 0 })

  useLayoutEffect(() => {
    if (!state) return
    const menu = ref.current
    const margin = 8
    const width = menu?.offsetWidth || 184
    const height = menu?.offsetHeight || 132
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

  const run = (action: (sheetId: string) => void): void => {
    onClose()
    action(state.sheetId)
  }

  return (
    <div
      ref={ref}
      className="mindmap-context-menu mindmap-sheet-menu"
      role="menu"
      aria-label={t('mindmap.sheetActions', { title: state.title })}
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        className="mindmap-context-menu__item"
        role="menuitem"
        onClick={() => run(onRename)}
      >
        <Pencil size={14} aria-hidden="true" />
        {t('mindmap.renameSheet')}
      </button>
      <button
        type="button"
        className="mindmap-context-menu__item"
        role="menuitem"
        onClick={() => run(onDuplicate)}
      >
        <Copy size={14} aria-hidden="true" />
        {t('mindmap.duplicateSheet')}
      </button>
      <div className="mindmap-context-menu__divider" />
      <button
        type="button"
        className="mindmap-context-menu__item is-danger"
        role="menuitem"
        disabled={!canRemove}
        onClick={() => run(onRemove)}
      >
        <Trash2 size={14} aria-hidden="true" />
        {t('mindmap.removeSheet')}
      </button>
    </div>
  )
}
