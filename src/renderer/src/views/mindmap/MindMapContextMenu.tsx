import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Right-click context menu for mind-map nodes (Xmind-style).
 *
 * Shows common operations: add child/sibling, edit, delete, collapse,
 * copy/cut/paste/duplicate, and quick style actions.
 */
export type MindMapContextMenuState = {
  visible: boolean
  x: number
  y: number
  nodeId: string | null
  isRoot?: boolean
  isCollapsed?: boolean
}

export type MindMapContextMenuActions = {
  addChild: (nodeId: string) => void
  addSibling: (nodeId: string) => void
  edit: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
  toggleCollapse: (nodeId: string) => void
  copy: (nodeId: string) => void
  cut: (nodeId: string) => void
  paste: (parentId: string) => void
  duplicate: (nodeId: string) => void
  insertAbove: (nodeId: string) => void
  outdent: (nodeId: string) => void
}

type MindMapContextMenuProps = {
  state: MindMapContextMenuState
  actions: MindMapContextMenuActions
  canPaste: boolean
  isCollapsed: boolean
  isRoot: boolean
  onClose: () => void
}

export function MindMapContextMenu({
  state,
  actions,
  canPaste,
  isCollapsed,
  isRoot,
  onClose
}: MindMapContextMenuProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: state.x, y: state.y })

  // XMind keeps the menu inside the application window.  Browser context-menu
  // coordinates are viewport coordinates, so clamp after measuring the menu
  // itself instead of allowing the last items to disappear below the stage.
  useLayoutEffect(() => {
    if (!state.visible) return
    const menu = ref.current
    const margin = 8
    const width = menu?.offsetWidth ?? 180
    const height = menu?.offsetHeight ?? 320
    const next = {
      x: Math.min(Math.max(margin, state.x), Math.max(margin, window.innerWidth - width - margin)),
      y: Math.min(Math.max(margin, state.y), Math.max(margin, window.innerHeight - height - margin))
    }
    setPosition((current) => current.x === next.x && current.y === next.y ? current : next)
  }, [state.visible, state.x, state.y])

  useEffect(() => {
    if (!state.visible) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
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
  }, [state.visible, onClose])

  if (!state.visible || !state.nodeId) return null

  const nodeId = state.nodeId
  const menuItem = (label: string, onClick: () => void, opts?: { disabled?: boolean; danger?: boolean; divider?: boolean }) => (
    <button
      type="button"
      className={`mindmap-context-menu__item${opts?.danger ? ' is-danger' : ''}`}
      disabled={opts?.disabled}
      onClick={() => {
        onClick()
        onClose()
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      className="mindmap-context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <div className="mindmap-context-menu__group">
        {menuItem(t('mindmap.addChild'), () => actions.addChild(nodeId))}
        {menuItem(t('mindmap.addSibling'), () => actions.addSibling(nodeId), { disabled: isRoot })}
        {menuItem(t('mindmap.insertAbove'), () => actions.insertAbove(nodeId), { disabled: isRoot })}
        {menuItem(t('mindmap.outdent'), () => actions.outdent(nodeId), { disabled: isRoot })}
      </div>
      <div className="mindmap-context-menu__divider" />
      <div className="mindmap-context-menu__group">
        {menuItem(t('mindmap.edit'), () => actions.edit(nodeId))}
        {menuItem(
          isCollapsed ? t('mindmap.expandTopic', { title: '' }).trim() || t('mindmap.expandAll') : t('mindmap.collapseTopic', { title: '' }).trim() || t('mindmap.collapseAll'),
          () => actions.toggleCollapse(nodeId)
        )}
      </div>
      <div className="mindmap-context-menu__divider" />
      <div className="mindmap-context-menu__group">
        {menuItem(t('mindmap.ctxCopy'), () => actions.copy(nodeId))}
        {menuItem(t('mindmap.ctxCut'), () => actions.cut(nodeId))}
        {menuItem(t('mindmap.ctxPaste'), () => actions.paste(nodeId), { disabled: !canPaste })}
        {menuItem(t('mindmap.ctxDuplicate'), () => actions.duplicate(nodeId))}
      </div>
      <div className="mindmap-context-menu__divider" />
      <div className="mindmap-context-menu__group">
        {menuItem(t('mindmap.deleteNode'), () => actions.deleteNode(nodeId), { danger: true, disabled: isRoot })}
      </div>
    </div>
  )
}
