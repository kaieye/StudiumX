import { useCallback, useState } from 'react'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapContextMenuState } from './MindMapContextMenu'
import { useMindMapViewStore } from './mind-map-view-store'

/**
 * Hook that wires the Xmind-style right-click context menu into MindMapView.
 *
 * Keeps context-menu state out of the already-large MindMapView component and
 * provides a single `contextMenuHandlers` bundle that can be spread onto the
 * canvas and the <MindMapContextMenu> element.
 */

export function useMindMapContextMenu() {
  const addChild = useMindMapViewStore((s) => s.addChild)
  const addSibling = useMindMapViewStore((s) => s.addSibling)
  const insertAbove = useMindMapViewStore((s) => s.insertAbove)
  const outdent = useMindMapViewStore((s) => s.outdent)
  const deleteNode = useMindMapViewStore((s) => s.deleteNode)
  const toggleCollapse = useMindMapViewStore((s) => s.toggleCollapse)
  const copyNode = useMindMapViewStore((s) => s.copyNode)
  const cutNode = useMindMapViewStore((s) => s.cutNode)
  const pasteNode = useMindMapViewStore((s) => s.pasteNode)
  const duplicateNode = useMindMapViewStore((s) => s.duplicateNode)
  const setEditingNodeId = useMindMapViewStore((s) => s.setEditingNodeId)

  const [contextMenu, setContextMenu] = useState<MindMapContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null
  })
  const [hasClipboard, setHasClipboard] = useState(false)

  const openContextMenu = useCallback((nodeId: string, x: number, y: number) => {
    const state = useMindMapViewStore.getState()
    const doc = state.current
    const sheetId = state.activeSheetId
    const sheet = doc?.sheets.find((s) => s.id === sheetId) ?? doc?.sheets[0]
    let topic: MindMapTopicV2 | null = null
    if (sheet) {
      topic = findTopic(sheet.root, nodeId)
    }
    setContextMenu({
      visible: true,
      x,
      y,
      nodeId,
      isRoot: nodeId === sheet?.root.id,
      isCollapsed: topic?.collapsed ?? false
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false, nodeId: null }))
  }, [])

  const wrappedCopy = useCallback((nodeId: string) => {
    copyNode(nodeId)
    setHasClipboard(true)
  }, [copyNode])

  const wrappedCut = useCallback((nodeId: string) => {
    cutNode(nodeId)
    setHasClipboard(true)
  }, [cutNode])

  return {
    contextMenu,
    openContextMenu,
    closeContextMenu,
    canPaste: hasClipboard,
    actions: {
      addChild,
      addSibling,
      edit: (nodeId: string) => setEditingNodeId(nodeId),
      deleteNode,
      toggleCollapse,
      copy: wrappedCopy,
      cut: wrappedCut,
      paste: pasteNode,
      duplicate: duplicateNode,
      insertAbove,
      outdent
    }
  }
}

function findTopic(node: MindMapTopicV2, id: string): MindMapTopicV2 | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findTopic(child, id)
    if (found) return found
  }
  return null
}
