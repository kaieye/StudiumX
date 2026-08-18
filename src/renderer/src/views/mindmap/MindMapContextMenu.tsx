import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ImagePlus, Link2, Sigma, StickyNote, Tag } from 'lucide-react'

/**
 * Right-click context menu for mind-map nodes (StudiumX-style).
 *
 * Shows common operations: add child/sibling, edit, delete, collapse,
 * copy/cut/paste/duplicate, and style clipboard actions.
 */
export type MindMapContextMenuState = {
  visible: boolean
  x: number
  y: number
  nodeId: string | null
  isRoot?: boolean
  isCollapsed?: boolean
  hasChildren?: boolean
  hasSiblingChildren?: boolean
  siblingChildrenCollapsed?: boolean
}

export type MindMapContextMenuActions = {
  addChild: (nodeId: string) => void
  addSibling: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
  toggleCollapse: (nodeId: string) => void
  toggleSiblingCollapse: (nodeId: string) => void
  copy: (nodeId: string) => void
  cut: (nodeId: string) => void
  paste: (parentId: string) => void
  duplicate: (nodeId: string) => void
  copyStyle: (nodeId: string) => void
  pasteStyle: (nodeId: string) => void
  resetStyle: (nodeId: string) => void
  insertAbove: (nodeId: string) => void
  outdent: (nodeId: string) => void
  insertMarkers: (nodeId: string) => void
  insertNotes: (nodeId: string) => void
  insertFormula: (nodeId: string) => void
  insertLink: (nodeId: string) => void
  insertImage: (nodeId: string) => void
}

type MindMapContextMenuProps = {
  state: MindMapContextMenuState
  actions: MindMapContextMenuActions
  canPaste: boolean
  canPasteStyle: boolean
  isCollapsed: boolean
  isRoot: boolean
  onClose: () => void
}

export function MindMapContextMenu({
  state,
  actions,
  canPaste,
  canPasteStyle,
  isCollapsed,
  isRoot,
  onClose
}: MindMapContextMenuProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: state.x, y: state.y })
  const [insertSubmenuOpen, setInsertSubmenuOpen] = useState(false)
  const [submenuPosition, setSubmenuPosition] = useState({ x: 0, y: 0 })
  const submenuTriggerRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  const hoverTimerRef = useRef<number | null>(null)

  const clearHoverTimer = (): void => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  const scheduleCloseSubmenu = (): void => {
    clearHoverTimer()
    hoverTimerRef.current = window.setTimeout(() => {
      setInsertSubmenuOpen(false)
      hoverTimerRef.current = null
    }, 120)
  }

  const openSubmenu = (): void => {
    clearHoverTimer()
    const rect = submenuTriggerRef.current?.getBoundingClientRect()
    if (rect) {
      // Position the portal submenu just right of the trigger, aligned to the
      // trigger's top, using viewport coordinates (position: fixed).
      setSubmenuPosition({ x: rect.right + 4, y: rect.top - 6 })
    }
    setInsertSubmenuOpen(true)
  }

  useEffect(() => {
    if (!state.visible) {
      setInsertSubmenuOpen(false)
      clearHoverTimer()
    }
  }, [state.visible])

  useEffect(() => clearHoverTimer, [])

  // StudiumX keeps the menu inside the application window.  Browser context-menu
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
      // The insert submenu is rendered via a portal on document.body, so it is
      // not a descendant of the menu element. Include it when deciding whether
      // a mousedown happened outside the open menu.
      const insideMenu = ref.current?.contains(event.target as Node) === true
      const insideSubmenu = submenuRef.current?.contains(event.target as Node) === true
      if (!insideMenu && !insideSubmenu) {
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
    <>
    <div
      ref={ref}
      className="mindmap-context-menu mindmap-node-context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <div className="mindmap-context-menu__group">
        {menuItem(t('mindmap.addChild'), () => actions.addChild(nodeId))}
        {menuItem(t('mindmap.addSibling'), () => actions.addSibling(nodeId), { disabled: isRoot })}
        {menuItem(t('mindmap.insertAbove'), () => actions.insertAbove(nodeId), { disabled: isRoot })}
        {menuItem(t('mindmap.outdent'), () => actions.outdent(nodeId), { disabled: isRoot })}
      </div>
      <div className="mindmap-context-menu__group">
        <div
          ref={submenuTriggerRef}
          className="mindmap-context-menu__item mindmap-context-menu__item--submenu"
          role="menuitem"
          tabIndex={0}
          aria-haspopup="menu"
          aria-expanded={insertSubmenuOpen}
          onMouseEnter={openSubmenu}
          onMouseLeave={scheduleCloseSubmenu}
          onClick={() => (insertSubmenuOpen ? setInsertSubmenuOpen(false) : openSubmenu())}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              if (insertSubmenuOpen) setInsertSubmenuOpen(false)
              else openSubmenu()
            }
          }}
        >
          <span>{t('mindmap.insertToNode')}</span>
          <ChevronRight size={13} aria-hidden="true" />
        </div>
      </div>
      <div className="mindmap-context-menu__divider" />
      <div className="mindmap-context-menu__group">
        {menuItem(t('mindmap.copyStyle'), () => actions.copyStyle(nodeId))}
        {menuItem(t('mindmap.pasteStyle'), () => actions.pasteStyle(nodeId), { disabled: !canPasteStyle })}
        {menuItem(t('mindmap.resetStyle'), () => actions.resetStyle(nodeId))}
      </div>
      <div className="mindmap-context-menu__divider" />
      <div className="mindmap-context-menu__group">
        {menuItem(
          isCollapsed ? t('mindmap.expandCurrentChildren') : t('mindmap.collapseCurrentChildren'),
          () => actions.toggleCollapse(nodeId),
          { disabled: state.hasChildren === false }
        )}
        {menuItem(
          state.siblingChildrenCollapsed
            ? t('mindmap.expandSiblingChildren')
            : t('mindmap.collapseSiblingChildren'),
          () => actions.toggleSiblingCollapse(nodeId),
          { disabled: state.hasSiblingChildren === false }
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

    {insertSubmenuOpen ? createPortal(
      <div
        ref={submenuRef}
        className="mindmap-context-menu__submenu"
        role="menu"
        style={{ left: submenuPosition.x, top: submenuPosition.y }}
        onMouseEnter={clearHoverTimer}
        onMouseLeave={scheduleCloseSubmenu}
      >
        <button
          type="button"
          className="mindmap-context-menu__item mindmap-context-menu__submenu-item"
          role="menuitem"
          onClick={() => {
            actions.insertMarkers(nodeId)
            onClose()
          }}
        >
          <Tag size={13} aria-hidden="true" /> {t('mindmap.markersPanel.title')}
        </button>
        <button
          type="button"
          className="mindmap-context-menu__item mindmap-context-menu__submenu-item"
          role="menuitem"
          onClick={() => {
            actions.insertNotes(nodeId)
            onClose()
          }}
        >
          <StickyNote size={13} aria-hidden="true" /> {t('mindmap.notesPanel.title')}
        </button>
        <div className="mindmap-context-menu__divider" aria-hidden="true" />
        <button
          type="button"
          className="mindmap-context-menu__item mindmap-context-menu__submenu-item"
          role="menuitem"
          onClick={() => {
            actions.insertFormula(nodeId)
            onClose()
          }}
        >
          <Sigma size={13} aria-hidden="true" /> {t('mindmap.contentPanel.formula')}
        </button>
        <button
          type="button"
          className="mindmap-context-menu__item mindmap-context-menu__submenu-item"
          role="menuitem"
          onClick={() => {
            actions.insertLink(nodeId)
            onClose()
          }}
        >
          <Link2 size={13} aria-hidden="true" /> {t('mindmap.contentPanel.links')}
        </button>
        <button
          type="button"
          className="mindmap-context-menu__item mindmap-context-menu__submenu-item"
          role="menuitem"
          onClick={() => {
            actions.insertImage(nodeId)
            onClose()
          }}
        >
          <ImagePlus size={13} aria-hidden="true" /> {t('mindmap.contentPanel.images')}
        </button>
      </div>,
      document.body
    ) : null}
    </>
  )
}
