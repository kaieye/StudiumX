import { useCallback, useState } from 'react'
import type { MindMapContextMenuActions, MindMapContextMenuState } from './MindMapContextMenu'
import { findTopicInSheet } from './mind-map-commands'
import { useMindMapViewStore } from './mind-map-view-store'

/**
 * Hook that wires the StudiumX-style right-click context menu into MindMapView.
 *
 * Keeps context-menu state out of the already-large MindMapView component and
 * provides a single `contextMenuHandlers` bundle that can be spread onto the
 * canvas and the <MindMapContextMenu> element.
 */

export type MindMapContextMenuInsertActions = Pick<
  MindMapContextMenuActions,
  'insertMarkers' | 'insertNotes' | 'insertFormula' | 'insertLink' | 'insertImage'
>

export function useMindMapContextMenu(
  insertActions: MindMapContextMenuInsertActions
) {
  const addChild = useMindMapViewStore((s) => s.addChild)
  const addSibling = useMindMapViewStore((s) => s.addSibling)
  const insertAbove = useMindMapViewStore((s) => s.insertAbove)
  const outdent = useMindMapViewStore((s) => s.outdent)
  const deleteNode = useMindMapViewStore((s) => s.deleteNode)
  const deleteNodes = useMindMapViewStore((s) => s.deleteNodes)
  const setTopicChildrenCollapsed = useMindMapViewStore((s) => s.setTopicChildrenCollapsed)
  const setSiblingTopicsCollapsed = useMindMapViewStore((s) => s.setSiblingTopicsCollapsed)
  const copyNode = useMindMapViewStore((s) => s.copyNode)
  const cutNode = useMindMapViewStore((s) => s.cutNode)
  const pasteNode = useMindMapViewStore((s) => s.pasteNode)
  const duplicateNode = useMindMapViewStore((s) => s.duplicateNode)
  const copiedTopicStyle = useMindMapViewStore((s) => s.copiedTopicStyle)
  const copyTopicStyle = useMindMapViewStore((s) => s.copyTopicStyle)
  const pasteTopicStyle = useMindMapViewStore((s) => s.pasteTopicStyle)
  const resetTopicStyle = useMindMapViewStore((s) => s.resetTopicStyle)

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
    const topicRef = sheet ? findTopicInSheet(sheet, nodeId) : undefined
    const topic = topicRef?.node
    const parent = topicRef?.parent
    const siblingBranches = parent?.children.filter((candidate) => candidate.children.length > 0) ?? []
    setContextMenu({
      visible: true,
      x,
      y,
      nodeId,
      isRoot: nodeId === sheet?.root.id,
      isCollapsed: topic?.collapsed ?? false,
      hasChildren: (topic?.children.length ?? 0) > 0,
      hasSiblingChildren: parent !== null && parent !== undefined
        && parent.children.length > 1
        && siblingBranches.length > 0,
      siblingChildrenCollapsed: siblingBranches.length > 0
        && siblingBranches.every((candidate) => candidate.collapsed === true)
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
      deleteNode: (nodeId: string) => {
        const selection = useMindMapViewStore.getState().selection
        if (selection.kind === 'topic' && selection.topicIds.length > 1 && selection.topicIds.includes(nodeId)) {
          deleteNodes(selection.topicIds)
        } else {
          deleteNode(nodeId)
        }
      },
      toggleCollapse: (nodeId: string) => {
        const state = useMindMapViewStore.getState()
        const sheet = state.current?.sheets.find((candidate) => candidate.id === state.activeSheetId)
          ?? state.current?.sheets[0]
        const topic = sheet ? findTopicInSheet(sheet, nodeId)?.node : undefined
        if (!topic || topic.children.length === 0) return
        setTopicChildrenCollapsed(nodeId, topic.collapsed !== true)
      },
      toggleSiblingCollapse: (nodeId: string) => {
        const state = useMindMapViewStore.getState()
        const sheet = state.current?.sheets.find((candidate) => candidate.id === state.activeSheetId)
          ?? state.current?.sheets[0]
        const parent = sheet ? findTopicInSheet(sheet, nodeId)?.parent : undefined
        if (!parent) return
        const branches = parent.children.filter((candidate) => candidate.children.length > 0)
        if (branches.length === 0) return
        const allCollapsed = branches.every((candidate) => candidate.collapsed === true)
        setSiblingTopicsCollapsed(nodeId, !allCollapsed)
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
      insertAbove,
      outdent,
      ...insertActions
    }
  }
}
