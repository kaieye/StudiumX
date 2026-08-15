import { useCallback, useState } from 'react'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapContextMenuState } from './MindMapContextMenu'
import { useMindMapViewStore } from './mind-map-view-store'
import type { MindMapQuickStylePreset } from '../../../../shared/mindmap/quick-styles'

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
  const deleteNodes = useMindMapViewStore((s) => s.deleteNodes)
  const toggleCollapse = useMindMapViewStore((s) => s.toggleCollapse)
  const toggleCollapseNodes = useMindMapViewStore((s) => s.toggleCollapseNodes)
  const copyNode = useMindMapViewStore((s) => s.copyNode)
  const cutNode = useMindMapViewStore((s) => s.cutNode)
  const pasteNode = useMindMapViewStore((s) => s.pasteNode)
  const duplicateNode = useMindMapViewStore((s) => s.duplicateNode)
  const copiedTopicStyle = useMindMapViewStore((s) => s.copiedTopicStyle)
  const copyTopicStyle = useMindMapViewStore((s) => s.copyTopicStyle)
  const pasteTopicStyle = useMindMapViewStore((s) => s.pasteTopicStyle)
  const resetTopicStyle = useMindMapViewStore((s) => s.resetTopicStyle)
  const applyQuickStyle = useMindMapViewStore((s) => s.applyQuickStyle)
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
    canPasteStyle: copiedTopicStyle !== null,
    actions: {
      addChild,
      addSibling,
      edit: (nodeId: string) => setEditingNodeId(nodeId),
      deleteNode: (nodeId: string) => {
        const selection = useMindMapViewStore.getState().selection
        if (selection.kind === 'topic' && selection.topicIds.length > 1 && selection.topicIds.includes(nodeId)) {
          deleteNodes(selection.topicIds)
        } else {
          deleteNode(nodeId)
        }
      },
      toggleCollapse: (nodeId: string) => {
        const selection = useMindMapViewStore.getState().selection
        if (selection.kind === 'topic' && selection.topicIds.length > 1 && selection.topicIds.includes(nodeId)) {
          toggleCollapseNodes(selection.topicIds)
        } else {
          toggleCollapse(nodeId)
        }
      },
      copy: wrappedCopy,
      cut: wrappedCut,
      paste: pasteNode,
      duplicate: duplicateNode,
      copyStyle: copyTopicStyle,
      pasteStyle: (nodeId: string) => {
        const selection = useMindMapViewStore.getState().selection
        const topicIds = selection.kind === 'topic' && selection.topicIds.includes(nodeId)
          ? selection.topicIds
          : [nodeId]
        pasteTopicStyle(topicIds)
      },
      resetStyle: (nodeId: string) => {
        const selection = useMindMapViewStore.getState().selection
        const topicIds = selection.kind === 'topic' && selection.topicIds.includes(nodeId)
          ? selection.topicIds
          : [nodeId]
        resetTopicStyle(topicIds)
      },
      applyQuickStyle: (nodeId: string, preset: MindMapQuickStylePreset) => {
        const selection = useMindMapViewStore.getState().selection
        const topicIds = selection.kind === 'topic' && selection.topicIds.includes(nodeId)
          ? selection.topicIds
          : [nodeId]
        applyQuickStyle(topicIds, preset)
      },
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
