import {
  Download,
  FileCode,
  FileImage,
  FileText,
  FilePlus2,
  Home,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  ListTree,
  Maximize2,
  Plus,
  Redo2,
  Search,
  Share2,
  Sigma,
  StickyNote,
  Tag,
  Undo2,
  Upload,
  X,
  Braces
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../app-shell/appStore'
import { MindMapAiPanel } from './MindMapAiPanel'
import { MindMapCanvas, type MindMapCanvasViewportAction } from './MindMapCanvas'
import { MindMapHomeLibrary } from './MindMapHomeLibrary'
import {
  MindMapExportFeedback,
  type MindMapExportFeedbackState,
  type MindMapExportFormat
} from './MindMapExportFeedback'
import { MindMapImportCompatibilityReport } from './MindMapImportCompatibilityReport'
import { MindMapSheetTabs } from './MindMapSheetTabs'
import { MindMapUtilityPanel, type MindMapUtilityPanelKind } from './MindMapUtilityPanel'
import { MindMapContextMenu } from './MindMapContextMenu'
import { MindMapTopicPopover, type MindMapTopicPopoverSection } from './MindMapTopicPopover'
import {
  AddChildTopicIcon,
  AddSiblingTopicIcon,
  CollapseAllTopicsIcon,
  ExpandAllTopicsIcon
} from './MindMapToolbarIcons'
import { MindMapZoomControls } from './MindMapZoomControls'
import { useMindMapContextMenu } from './mind-map-context-menu-hook'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapCommand } from '../../../../shared/mindmap/commands'
import type { XmindCompatibilityReport } from '../../../../shared/mindmap/xmind-compatibility'
import { useMindMapKeyboard } from './mind-map-keyboard'
import { DEFAULT_NEW_MIND_MAP_STRUCTURE_CLASS } from './mind-map-create-presets'
import type { MindMapFocusDirection } from './mind-map-keyboard-navigation'
import { nextMindMapFocus } from './mind-map-keyboard-navigation'
import { computeMindMapLayout } from './mind-map-layout'
import {
  mindMapLayoutToSvgInput,
  mindMapResolvedSvgOptions
} from './mind-map-svg-adapter'
import { rasterizeMindMapSvgToPng } from './mind-map-png-export'
import { useMindMapViewStore } from './mind-map-view-store'
import { buildMindMapTextReplacementPatch } from './mind-map-search'
import {
  MIND_MAP_IMPORT_ACCEPT,
  mindMapImportFormatForFileName
} from './mind-map-import-format'
import { canAddSummaryToTopics } from './mind-map-commands'
import './mindmap.css'

/**
 * Mind-map view entry (docs/mindmap/design.md §6.2).
 *
 * The gallery is a focused card library; opening a map switches to the canvas
 * editor, whose contextual tools are exposed on demand from the right side.
 */
export function MindMapView() {
  const { t } = useTranslation()
  const activeWorkspace = useAppStore((s) => s.appState?.activeWorkspace)
  const library = useMindMapViewStore((s) => s.library)
  const scope = useMindMapViewStore((s) => s.scope)
  const current = useMindMapViewStore((s) => s.current)
  const selectedNodeId = useMindMapViewStore((s) => s.selectedNodeId)
  const activeSheetId = useMindMapViewStore((s) => s.activeSheetId)
  const editingNodeId = useMindMapViewStore((s) => s.editingNodeId)
  const loadDocuments = useMindMapViewStore((s) => s.loadDocuments)
  const loadLibrary = useMindMapViewStore((s) => s.loadLibrary)
  const setScope = useMindMapViewStore((s) => s.setScope)
  const openDocument = useMindMapViewStore((s) => s.openDocument)
  const createDocument = useMindMapViewStore((s) => s.createDocument)
  const closeDocument = useMindMapViewStore((s) => s.closeDocument)
  const deleteDocument = useMindMapViewStore((s) => s.deleteDocument)
  const renameDocumentById = useMindMapViewStore((s) => s.renameDocumentById)
  const duplicateDocument = useMindMapViewStore((s) => s.duplicateDocument)
  const renameDocument = useMindMapViewStore((s) => s.renameDocument)
  const newSheet = useMindMapViewStore((s) => s.newSheet)
  const renameSheet = useMindMapViewStore((s) => s.renameSheet)
  const duplicateSheet = useMindMapViewStore((s) => s.duplicateSheet)
  const removeSheet = useMindMapViewStore((s) => s.removeSheet)
  const addChild = useMindMapViewStore((s) => s.addChild)
  const addSibling = useMindMapViewStore((s) => s.addSibling)
  const outdent = useMindMapViewStore((s) => s.outdent)
  const insertAbove = useMindMapViewStore((s) => s.insertAbove)
  const deleteNode = useMindMapViewStore((s) => s.deleteNode)
  const deleteNodes = useMindMapViewStore((s) => s.deleteNodes)
  const addSummary = useMindMapViewStore((s) => s.addSummary)
  const toggleCollapse = useMindMapViewStore((s) => s.toggleCollapse)
  const toggleCollapseNodes = useMindMapViewStore((s) => s.toggleCollapseNodes)
  const collapseAll = useMindMapViewStore((s) => s.collapseAll)
  const expandAll = useMindMapViewStore((s) => s.expandAll)
  const copyNode = useMindMapViewStore((s) => s.copyNode)
  const cutNode = useMindMapViewStore((s) => s.cutNode)
  const pasteNode = useMindMapViewStore((s) => s.pasteNode)
  const duplicateNode = useMindMapViewStore((s) => s.duplicateNode)
  const selection = useMindMapViewStore((s) => s.selection)
  const copyTopicStyle = useMindMapViewStore((s) => s.copyTopicStyle)
  const pasteTopicStyle = useMindMapViewStore((s) => s.pasteTopicStyle)
  const resetTopicStyle = useMindMapViewStore((s) => s.resetTopicStyle)
  const undo = useMindMapViewStore((s) => s.undo)
  const redo = useMindMapViewStore((s) => s.redo)
  const setEditingNodeId = useMindMapViewStore((s) => s.setEditingNodeId)
  const selectTopic = useMindMapViewStore((s) => s.selectTopic)
  const flushForExport = useMindMapViewStore((s) => s.flushForExport)
  const dispatchCommand = useMindMapViewStore((s) => s.dispatchCommand)
  const addImage = useMindMapViewStore((s) => s.addImage)
  const inspectorOpen = useMindMapViewStore((s) => s.inspectorOpen)
  const toggleInspector = useMindMapViewStore((s) => s.toggleInspector)

  const activeSheet = current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0]

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [exportFeedback, setExportFeedback] = useState<MindMapExportFeedbackState | null>(null)
  const [importCompatibilityReport, setImportCompatibilityReport] =
    useState<XmindCompatibilityReport | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [insertMenuOpen, setInsertMenuOpen] = useState(false)
  const [utilityPanel, setUtilityPanel] = useState<MindMapUtilityPanelKind | null>(null)
  const [viewportAction, setViewportAction] = useState<MindMapCanvasViewportAction | null>(null)
  const viewportActionIdRef = useRef(0)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [canvasViewportRevision, setCanvasViewportRevision] = useState(0)
  const [topicPopover, setTopicPopover] = useState<{ nodeId: string; section: MindMapTopicPopoverSection } | null>(null)
  const handleCanvasViewportChange = useCallback(() => {
    setCanvasViewportRevision((value) => value + 1)
  }, [])

  // Markers, notes, formulas and links are edited in a canvas-adjacent
  // floating popover so each insert action opens a focused card next to the
  // target node instead of sending the user to the side inspector.
  const openTopicPopover = (section: MindMapTopicPopoverSection, nodeId: string | null = selectedNodeId): void => {
    setUtilityPanel(null)
    if (nodeId) setTopicPopover({ nodeId, section })
  }

  // Inserting an image goes straight to the native file picker and attaches
  // the chosen asset to the target topic — no intermediate panel. Images are
  // managed (removed / repositioned) directly on the canvas once placed.
  const handleInsertImage = async (nodeId: string | null = selectedNodeId): Promise<void> => {
    if (!current || !nodeId || !activeWorkspace) return
    try {
      const result = await window.teachingSystem?.importMindMapAsset({
        workspaceId: activeWorkspace.id,
        id: current.id
      })
      if (!result || result.canceled) return
      dispatchCommand(
        { type: 'asset.create', asset: result.asset },
        { label: 'Add image asset' }
      )
      addImage(result.asset.id, { topicId: nodeId })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const {
    contextMenu,
    openContextMenu,
    closeContextMenu,
    canPaste,
    canPasteStyle,
    actions: contextMenuActions
  } = useMindMapContextMenu({
    insertMarkers: (nodeId) => openTopicPopover('markers', nodeId),
    insertNotes: (nodeId) => openTopicPopover('note', nodeId),
    insertFormula: (nodeId) => openTopicPopover('formula', nodeId),
    insertLink: (nodeId) => openTopicPopover('link', nodeId),
    insertImage: (nodeId) => void handleInsertImage(nodeId)
  })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const creatingRef = useRef(false)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const insertMenuRef = useRef<HTMLDivElement | null>(null)

  const triggerViewportAction = (
    action: Exclude<MindMapCanvasViewportAction, { type: 'navigate' }>['type']
  ): void => {
    viewportActionIdRef.current += 1
    setViewportAction({ id: viewportActionIdRef.current, type: action })
  }

  useMindMapKeyboard(
    current !== null,
    editingNodeId !== null,
    {
      insertChild: () => {
        if (selectedNodeId !== null) addChild(selectedNodeId)
      },
      insertSibling: () => {
        if (selectedNodeId !== null) addSibling(selectedNodeId)
      },
      outdent: () => {
        if (selectedNodeId !== null) outdent(selectedNodeId)
      },
      insertAbove: () => {
        if (selectedNodeId !== null) insertAbove(selectedNodeId)
      },
      toggleCollapse: () => {
        if (selection.kind === 'topic' && selection.topicIds.length > 1) toggleCollapseNodes(selection.topicIds)
        else if (selectedNodeId !== null) toggleCollapse(selectedNodeId)
      },
      remove: () => {
        if (selection.kind === 'topic' && selection.topicIds.length > 1) deleteNodes(selection.topicIds)
        else if (selectedNodeId !== null) deleteNode(selectedNodeId)
      },
      edit: () => {
        if (selectedNodeId !== null) setEditingNodeId(selectedNodeId)
      },
      undo: () => undo(),
      redo: () => redo(),
      copy: () => {
        if (selectedNodeId !== null) copyNode(selectedNodeId)
      },
      cut: () => {
        if (selectedNodeId !== null) cutNode(selectedNodeId)
      },
      paste: () => {
        if (selectedNodeId !== null) pasteNode(selectedNodeId)
      },
      duplicate: () => {
        if (selectedNodeId !== null) duplicateNode(selectedNodeId)
      },
      copyStyle: () => {
        if (selectedNodeId !== null) copyTopicStyle(selectedNodeId)
      },
      pasteStyle: () => {
        if (selection.kind === 'topic') pasteTopicStyle(selection.topicIds)
      },
      resetStyle: () => {
        if (selection.kind === 'topic') resetTopicStyle(selection.topicIds)
      },
      moveFocus: (direction: MindMapFocusDirection) => {
        const sheet = current?.sheets.find((candidate) => candidate.id === activeSheetId) ?? current?.sheets[0]
        if (!sheet) return
        const nextNodeId = nextMindMapFocus(computeMindMapLayout(sheet).nodes, selectedNodeId, direction)
        if (nextNodeId !== null) selectTopic(nextNodeId)
      },
      toggleInspector
    }
  )

  useEffect(() => {
    setNotice(null)
    setImportCompatibilityReport(null)
    void loadDocuments()
    void loadLibrary()
  }, [loadDocuments, loadLibrary, activeWorkspace?.id])

  // Close the import/export menu when clicking anywhere outside it, instead of
  // requiring a second click on the trigger to dismiss it.
  useEffect(() => {
    if (!exportMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [exportMenuOpen])

  // Close the insert (add to topic) menu when clicking anywhere outside it.
  useEffect(() => {
    if (!insertMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!insertMenuRef.current?.contains(event.target as Node)) {
        setInsertMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [insertMenuOpen])

  if (!activeWorkspace) {
    return (
      <div className="mindmap-view">
        <div className="mindmap-empty">{t('mindmap.noWorkspace')}</div>
      </div>
    )
  }

  const handleCreate = async (): Promise<void> => {
    if (creatingRef.current) return
    creatingRef.current = true
    setNotice(null)
    setCreateError(null)
    setCreating(true)
    try {
      const created = await createDocument(
        t('mindmap.newDocument'),
        DEFAULT_NEW_MIND_MAP_STRUCTURE_CLASS
      )
      // XMind starts a new map in an editable root topic. Keep the same low
      // friction flow while still creating a valid, persisted document first.
      const root = created.sheets[0]?.root
      if (root) {
        selectTopic(root.id)
        setEditingNodeId(root.id)
      }
    } catch (error) {
      setCreateError(
        error instanceof Error && error.message
          ? error.message
          : t('mindmap.createDialog.createFailed')
      )
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const handleImport = async (file: File | null): Promise<void> => {
    if (!file) return
    const path = (file as File & { path?: string }).path
    if (!path) {
      setNotice(t('mindmap.importRequiresDesktopPath'))
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    const format = mindMapImportFormatForFileName(file.name || path)
    if (!format) {
      setNotice(t('mindmap.unsupportedImportFormat'))
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setNotice(null)
    setImportCompatibilityReport(null)
    setExportFeedback(null)
    setBusy(true)
    try {
      const payload = { workspaceId: activeWorkspace.id, sourcePath: path }
      const doc =
        format === 'markdown'
          ? await window.teachingSystem?.importMindMapMarkdown(payload)
          : format === 'opml'
            ? await window.teachingSystem?.importMindMapOpml(payload)
            : await window.teachingSystem?.importMindMapXmind(payload)
      if (doc) {
        await openDocument(doc.id)
        await loadDocuments()
        const importedReport =
          format === 'xmind' && 'compatibilityReport' in doc ? doc.compatibilityReport : null
        setImportCompatibilityReport(
          isXmindCompatibilityReport(importedReport) ? importedReport : null
        )
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const startExport = (format: MindMapExportFormat): void => {
    setNotice(null)
    setExportFeedback({ status: 'exporting', format })
    setBusy(true)
  }

  const completeExport = (format: MindMapExportFormat, path: string | undefined): void => {
    setExportFeedback(
      path
        ? { status: 'success', format, path }
        : { status: 'error', format }
    )
  }

  const failExport = (format: MindMapExportFormat, error?: unknown): void => {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
    setExportFeedback({ status: 'error', format, ...(message ? { message } : {}) })
  }

  const pickExportDirectory = async (format: MindMapExportFormat): Promise<string | null> => {
    const picked = await window.teachingSystem?.pickDirectory()
    if (!picked) {
      failExport(format)
      return null
    }
    if (picked.canceled) {
      setExportFeedback({ status: 'cancelled', format })
      return null
    }
    if (!picked.path) {
      failExport(format)
      return null
    }
    return picked.path
  }

  const handleExport = async (): Promise<void> => {
    if (!current) return
    const format: MindMapExportFormat = 'xmind'
    startExport(format)
    try {
      const destinationDirectory = await pickExportDirectory(format)
      if (!destinationDirectory) return
      const snapshot = await flushForExport()
      if (!snapshot) {
        failExport(format, t('mindmap.exportNotReady'))
        return
      }
      const result = await window.teachingSystem?.exportMindMapXmind({
        workspaceId: activeWorkspace.id,
        destinationDirectory,
        ...snapshot
      })
      completeExport(format, result?.path)
    } catch (error) {
      failExport(format, error)
    } finally {
      setBusy(false)
    }
  }

  const handleMarkdownExport = async (): Promise<void> => {
    if (!current) return
    const format: MindMapExportFormat = 'markdown'
    startExport(format)
    try {
      const destinationDirectory = await pickExportDirectory(format)
      if (!destinationDirectory) return
      const snapshot = await flushForExport()
      if (!snapshot) {
        failExport(format, t('mindmap.exportNotReady'))
        return
      }
      const result = await window.teachingSystem?.exportMindMapMarkdown({
        workspaceId: activeWorkspace.id,
        destinationDirectory,
        ...snapshot
      })
      completeExport(format, result?.path)
    } catch (error) {
      failExport(format, error)
    } finally {
      setBusy(false)
    }
  }

  const handleOpmlExport = async (): Promise<void> => {
    if (!current) return
    const format: MindMapExportFormat = 'opml'
    startExport(format)
    try {
      const destinationDirectory = await pickExportDirectory(format)
      if (!destinationDirectory) return
      const snapshot = await flushForExport()
      if (!snapshot) {
        failExport(format, t('mindmap.exportNotReady'))
        return
      }
      const result = await window.teachingSystem?.exportMindMapOpml({
        workspaceId: activeWorkspace.id,
        destinationDirectory,
        ...snapshot
      })
      completeExport(format, result?.path)
    } catch (error) {
      failExport(format, error)
    } finally {
      setBusy(false)
    }
  }

  const handleSvgExport = async (): Promise<void> => {
    if (!current) return
    const format: MindMapExportFormat = 'svg'
    startExport(format)
    try {
      const destinationDirectory = await pickExportDirectory(format)
      if (!destinationDirectory) return
      const snapshot = await flushForExport()
      if (!snapshot) {
        failExport(format, t('mindmap.exportNotReady'))
        return
      }

      // Read the store again after the flush so the layout and proof refer to
      // the same current document/sheet, not a pre-flush React closure.
      const state = useMindMapViewStore.getState()
      const latest = state.current
      const sheet = latest?.sheets.find((candidate) => candidate.id === state.activeSheetId) ?? latest?.sheets[0]
      if (!latest || latest.id !== snapshot.id || !sheet) {
        failExport(format, t('mindmap.exportNotReady'))
        return
      }

      const input = mindMapLayoutToSvgInput(
        sheet.title,
        computeMindMapLayout(sheet),
        sheet.elements,
        mindMapResolvedSvgOptions(latest.theme)
      )
      const result = await window.teachingSystem?.exportMindMapSvg({
        workspaceId: activeWorkspace.id,
        destinationDirectory,
        sheetId: sheet.id,
        input,
        ...snapshot
      })
      completeExport(format, result?.path)
    } catch (error) {
      failExport(format, error)
    } finally {
      setBusy(false)
    }
  }

  const handlePngExport = async (): Promise<void> => {
    if (!current) return
    const format: MindMapExportFormat = 'png'
    startExport(format)
    try {
      const destinationDirectory = await pickExportDirectory(format)
      if (!destinationDirectory) return
      const snapshot = await flushForExport()
      if (!snapshot) {
        failExport(format, t('mindmap.exportNotReady'))
        return
      }

      const state = useMindMapViewStore.getState()
      const latest = state.current
      const sheet = latest?.sheets.find((candidate) => candidate.id === state.activeSheetId) ?? latest?.sheets[0]
      if (!latest || latest.id !== snapshot.id || !sheet) {
        failExport(format, t('mindmap.exportNotReady'))
        return
      }

      const input = mindMapLayoutToSvgInput(
        sheet.title,
        computeMindMapLayout(sheet),
        sheet.elements,
        mindMapResolvedSvgOptions(latest.theme)
      )
      const raster = await rasterizeMindMapSvgToPng(input)
      const result = await window.teachingSystem?.exportMindMapPng({
        workspaceId: activeWorkspace.id,
        destinationDirectory,
        sheetId: sheet.id,
        input,
        ...raster,
        ...snapshot
      })
      completeExport(format, result?.path)
    } catch (error) {
      failExport(format, error)
    } finally {
      setBusy(false)
    }
  }

  const handleMoveNode = (topicId: string, toParentId: string): void => {
    if (!activeSheet) return
    dispatchCommand(
      { type: 'topic.move', sheetId: activeSheet.id, topicId, toParentId },
      { label: 'Drag-reparent topic' }
    )
  }

  const activateSheet = (sheetId: string): void => {
    const sheet = current?.sheets.find((candidate) => candidate.id === sheetId)
    if (!sheet) return
    // A selection belongs to a sheet. Reset it to the new root so the outline,
    // canvas and keyboard commands never keep pointing at the previous sheet.
    useMindMapViewStore.setState({ activeSheetId: sheetId })
    selectTopic(sheet.root.id)
  }

  const selectAndRevealMindMapNode = (nodeId: string): void => {
    if (!activeSheet) return
    const path = findMindMapTopicPath(activeSheet.root, nodeId)
    if (!path) return
    const commands: MindMapCommand[] = path
      .slice(0, -1)
      .filter((topic) => topic.collapsed === true)
      .map((topic) => ({
        type: 'topic.update',
        sheetId: activeSheet.id,
        topicId: topic.id,
        patch: { collapsed: false }
      }))
    if (commands.length > 0) {
      dispatchCommand(
        { type: 'transaction', commands },
        { label: 'Reveal mind map search result' }
      )
    }
    selectTopic(nodeId)
  }

  const replaceMindMapText = (nodeId: string, query: string, replacement: string): void => {
    if (!activeSheet) return
    const topic = findMindMapTopic(activeSheet.root, nodeId)
    const patch = topic ? buildMindMapTextReplacementPatch(topic, query, replacement) : null
    if (!patch) return
    dispatchCommand(
      { type: 'topic.update', sheetId: activeSheet.id, topicId: nodeId, patch },
      { label: 'Replace mind map text' }
    )
  }

  const replaceAllMindMapText = (nodeIds: string[], query: string, replacement: string): void => {
    if (!activeSheet) return
    const commands = nodeIds
      .map((nodeId): MindMapCommand | null => {
        const topic = findMindMapTopic(activeSheet.root, nodeId)
        const patch = topic ? buildMindMapTextReplacementPatch(topic, query, replacement) : null
        return patch
          ? { type: 'topic.update', sheetId: activeSheet.id, topicId: nodeId, patch }
          : null
      })
      .filter((command): command is MindMapCommand => command !== null)
    if (commands.length === 0) return
    dispatchCommand(
      { type: 'transaction', commands },
      { label: 'Replace all mind map text' }
    )
  }

  const handleAddChild = (): void => {
    if (selectedNodeId) {
      addChild(selectedNodeId)
      return
    }
    if (activeSheet) addChild(activeSheet.root.id)
  }

  const handleAddSibling = (): void => {
    if (selectedNodeId) addSibling(selectedNodeId)
  }

  const handleAddTopicFromCanvas = (): void => {
    handleAddChild()
  }

  // A node summary accepts sibling ranges or multiple selected topics across branches.
  const canAddSummary =
    activeSheet !== undefined &&
    selection.kind === 'topic' &&
    canAddSummaryToTopics(activeSheet, selection.topicIds)

  const handleAddSummary = (): void => {
    if (selection.kind === 'topic' && selection.topicIds.length > 0) {
      addSummary(selection.topicIds, t('mindmap.addSummary'))
    }
  }

  const closeUtilityPanel = (): void => {
    // Open the inspector before removing the utility body when the utility was
    // opened from the collapsed rail. This keeps the shell expanded throughout
    // the hand-off instead of briefly animating through a collapsed state.
    if (!inspectorOpen) toggleInspector()
    setUtilityPanel(null)
  }

  const toggleUtilityPanel = (panel: MindMapUtilityPanelKind): void => {
    if (utilityPanel === panel) {
      closeUtilityPanel()
      return
    }

    // Utility views reuse the inspector shell so the header actions stay
    // available above the tool. Keep the inspector's persisted open state
    // unchanged; closing the utility can then restore the regular body.
    setUtilityPanel(panel)
  }

  const toggleInspectorPanel = (): void => {
    if (utilityPanel !== null) {
      // If the utility was opened while the inspector was expanded, the
      // header collapse action should still collapse it. If it was already
      // collapsed, dismissing the utility keeps it collapsed. Toggle first so
      // the regular inspector body never flashes during the hand-off.
      if (inspectorOpen) toggleInspector()
      setUtilityPanel(null)
      return
    }
    toggleInspector()
  }

  const returnToGallery = (): void => {
    setUtilityPanel(null)
    setExportMenuOpen(false)
    closeContextMenu()
    void closeDocument()
  }

  const folder = scope && scope !== 'home' ? scope : null

  if (!current) {
    return (
      <div className="mindmap-view mindmap-view--home">
        <MindMapHomeLibrary
          library={library}
          folder={folder}
          creating={creating}
          createError={createError}
          onCreate={handleCreate}
          onOpenDocument={openDocument}
          onOpenFolder={setScope}
          onBackToLibrary={() => void setScope('home')}
          onRenameDocument={renameDocumentById}
          onDeleteDocument={deleteDocument}
          onCopyDocument={duplicateDocument}
        />
      </div>
    )
  }

  return (
    <div className="mindmap-view mindmap-view--editor">
      <div className="mindmap-stage">
        {/* The return affordance stays deliberately quiet so the map remains
            the visual focus; all contextual tools live at the top right. */}
        <div className="mindmap-stage__identity">
          <button
            type="button"
            className="mindmap-stage__home"
            onClick={returnToGallery}
            title={t('mindmap.backToGallery')}
            aria-label={t('mindmap.backToGallery')}
          >
            <Home size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="mindmap-floating-toolbar" role="toolbar" aria-label={t('mindmap.viewTitle')}>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current}
            onClick={undo}
            data-tooltip={t('mindmap.toolbar.undo')}
            aria-label={t('mindmap.undo')}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current}
            onClick={redo}
            data-tooltip={t('mindmap.toolbar.redo')}
            aria-label={t('mindmap.redo')}
          >
            <Redo2 size={16} />
          </button>
          <span className="mindmap-floating-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="mindmap-floating-toolbar__btn mindmap-floating-toolbar__btn--structure"
            disabled={!current}
            onClick={collapseAll}
            data-tooltip={t('mindmap.toolbar.collapseLevel')}
            aria-label={t('mindmap.collapseLastLevel')}
          >
            <CollapseAllTopicsIcon />
          </button>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn mindmap-floating-toolbar__btn--structure"
            disabled={!current}
            onClick={expandAll}
            data-tooltip={t('mindmap.toolbar.expandLevel')}
            aria-label={t('mindmap.expandNextLevel')}
          >
            <ExpandAllTopicsIcon />
          </button>
          <span className="mindmap-floating-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="mindmap-floating-toolbar__btn mindmap-floating-toolbar__btn--node-action"
            disabled={!current || !selectedNodeId}
            onClick={handleAddTopicFromCanvas}
            data-tooltip={t('mindmap.toolbar.addChild')}
            aria-label={t('mindmap.addChild')}
          >
            <AddChildTopicIcon />
          </button>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn mindmap-floating-toolbar__btn--node-action"
            disabled={!current || !selectedNodeId}
            onClick={handleAddSibling}
            data-tooltip={t('mindmap.toolbar.addSibling')}
            aria-label={t('mindmap.addSibling')}
          >
            <AddSiblingTopicIcon />
          </button>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn mindmap-floating-toolbar__btn--node-action"
            disabled={!current || !canAddSummary}
            onClick={handleAddSummary}
            data-tooltip={t('mindmap.toolbar.addSummary')}
            aria-label={t('mindmap.addSummary')}
          >
            <Braces size={16} />
          </button>
          <span className="mindmap-floating-toolbar__divider" aria-hidden="true" />
          <div ref={insertMenuRef} className="mindmap-insert-dropdown">
            <button
              type="button"
              className="mindmap-floating-toolbar__btn"
              disabled={!current || !selectedNodeId}
              onClick={() => setInsertMenuOpen((value) => !value)}
              data-tooltip={t('mindmap.toolbar.addContent')}
              aria-label={t('mindmap.addToTopic')}
              aria-haspopup="menu"
              aria-expanded={insertMenuOpen}
            >
              <Plus size={16} />
            </button>
            {insertMenuOpen ? (
              <div className="mindmap-insert-dropdown__menu" role="menu">
                <button
                  type="button"
                  className="mindmap-insert-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    openTopicPopover('markers')
                    setInsertMenuOpen(false)
                  }}
                >
                  <Tag size={14} /> {t('mindmap.markersPanel.title')}
                </button>
                <button
                  type="button"
                  className="mindmap-insert-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    openTopicPopover('note')
                    setInsertMenuOpen(false)
                  }}
                >
                  <StickyNote size={14} /> {t('mindmap.notesPanel.title')}
                </button>
                <div className="mindmap-insert-dropdown__divider" aria-hidden="true" />
                <button
                  type="button"
                  className="mindmap-insert-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    openTopicPopover('formula')
                    setInsertMenuOpen(false)
                  }}
                >
                  <Sigma size={14} /> {t('mindmap.contentPanel.formula')}
                </button>
                <button
                  type="button"
                  className="mindmap-insert-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    openTopicPopover('link')
                    setInsertMenuOpen(false)
                  }}
                >
                  <Link2 size={14} /> {t('mindmap.contentPanel.links')}
                </button>
                <button
                  type="button"
                  className="mindmap-insert-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    setInsertMenuOpen(false)
                    void handleInsertImage()
                  }}
                >
                  <ImagePlus size={14} /> {t('mindmap.contentPanel.images')}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {notice ? (
          <div className="mindmap-notice">
            <span>{notice}</span>
            <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label={t('mindmap.cancel')}>
              <X size={13} />
            </button>
          </div>
        ) : null}

        {exportFeedback ? (
          <MindMapExportFeedback
            state={exportFeedback}
            onDismiss={() => setExportFeedback(null)}
          />
        ) : null}

        {importCompatibilityReport ? (
          <MindMapImportCompatibilityReport
            report={importCompatibilityReport}
            onDismiss={() => setImportCompatibilityReport(null)}
          />
        ) : null}

        <>
            <MindMapCanvas
              document={current}
              activeSheetIndex={Math.max(0, current.sheets.findIndex((s) => s.id === activeSheetId))}
              onActiveSheetChange={() => undefined}
              viewportAction={viewportAction}
              onZoomChange={setZoomLevel}
              onViewportChange={handleCanvasViewportChange}
              onContextMenu={openContextMenu}
              onMoveNode={handleMoveNode}
              onOpenNote={(nodeId) => setTopicPopover({ nodeId, section: 'note' })}
            />
            <MindMapTopicPopover
              nodeId={topicPopover?.nodeId ?? null}
              section={topicPopover?.section ?? 'note'}
              positionRevision={canvasViewportRevision}
              onClose={() => setTopicPopover(null)}
            />
            <div className="mindmap-sheet-dock">
              <MindMapSheetTabs
                document={current}
                activeSheetId={activeSheetId}
                onActivate={activateSheet}
                onRename={renameSheet}
                onDuplicate={duplicateSheet}
                onRemove={removeSheet}
              />
              <button
                type="button"
                className="mindmap-sheet-dock__add"
                disabled={!current}
                onClick={newSheet}
                title={t('mindmap.newSheet')}
                aria-label={t('mindmap.newSheet')}
              >
                <FilePlus2 size={14} />
              </button>
            </div>
            <div className="mindmap-status-bar">
              <span className="mindmap-status-bar__count">
                {t('mindmap.topicCount', { count: computeMindMapLayout(current.sheets.find((s) => s.id === activeSheetId) ?? current.sheets[0]).nodes.length })}
              </span>
              <span className="mindmap-status-bar__divider" aria-hidden="true" />
              <MindMapZoomControls
                zoom={zoomLevel}
                onZoomIn={() => triggerViewportAction('zoom-in')}
                onZoomOut={() => triggerViewportAction('zoom-out')}
                onFit={() => triggerViewportAction('fit')}
              />
              <span className="mindmap-status-bar__divider" aria-hidden="true" />
              <button
                type="button"
                className="mindmap-status-bar__btn"
                onClick={() => triggerViewportAction('fit')}
                title={t('mindmap.fitCanvas')}
                aria-label={t('mindmap.fitCanvas')}
              >
                <Maximize2 size={14} />
              </button>
            </div>
            <MindMapContextMenu
              state={contextMenu}
              actions={contextMenuActions}
              canPaste={canPaste}
              canPasteStyle={canPasteStyle}
              isCollapsed={contextMenu.isCollapsed ?? false}
              isRoot={contextMenu.isRoot ?? false}
              onClose={closeContextMenu}
            />
        </>
      </div>

      <MindMapAiPanel
        open={inspectorOpen || utilityPanel !== null}
        onToggle={toggleInspectorPanel}
        documentTitle={current.title}
        onRenameDocument={renameDocument}
        utilityControl={(
          <div className="mindmap-inspector-utility" role="toolbar" aria-label={t('mindmap.viewTitle')}>
            <button
              type="button"
              className={`mindmap-inspector-header-button icon-button${utilityPanel === 'search' ? ' is-active' : ''}`}
              onClick={() => toggleUtilityPanel('search')}
              title={t('mindmap.search')}
              aria-label={t('mindmap.search')}
              aria-pressed={utilityPanel === 'search'}
            >
              <Search size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`mindmap-inspector-header-button icon-button${utilityPanel === 'outline' ? ' is-active' : ''}`}
              onClick={() => toggleUtilityPanel('outline')}
              title={t('mindmap.outline')}
              aria-label={t('mindmap.outline')}
              aria-pressed={utilityPanel === 'outline'}
            >
              <ListTree size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        utilityContent={utilityPanel && activeSheet ? (
          <MindMapUtilityPanel
            panel={utilityPanel}
            sheet={activeSheet}
            selectedNodeId={selectedNodeId}
            onClose={closeUtilityPanel}
            onSelect={selectAndRevealMindMapNode}
            onToggleCollapse={toggleCollapse}
            onReplace={replaceMindMapText}
            onReplaceAll={replaceAllMindMapText}
          />
        ) : null}
        importExportControl={(
          <div ref={exportMenuRef} className="mindmap-export-dropdown">
            <button
              type="button"
              className="mindmap-inspector-header-button icon-button"
              disabled={busy}
              onClick={() => setExportMenuOpen((value) => !value)}
              title={t('mindmap.share')}
              aria-label={t('mindmap.share')}
              aria-expanded={exportMenuOpen}
            >
              <Share2 size={14} aria-hidden="true" />
            </button>
            {exportMenuOpen ? (
              <div className="mindmap-export-dropdown__menu" role="menu">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={MIND_MAP_IMPORT_ACCEPT}
                  hidden
                  onChange={(event) => {
                    void handleImport(event.currentTarget.files?.[0] ?? null)
                    setExportMenuOpen(false)
                  }}
                />
                <button
                  type="button"
                  className="mindmap-export-dropdown__item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} /> {t('mindmap.import')}
                </button>
                <div className="mindmap-export-dropdown__divider" />
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy} onClick={() => { void handleExport(); setExportMenuOpen(false) }}>
                  <Download size={14} /> {t('mindmap.exportXmind')}
                </button>
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy} onClick={() => { void handleMarkdownExport(); setExportMenuOpen(false) }}>
                  <FileText size={14} /> {t('mindmap.exportMarkdown')}
                </button>
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy} onClick={() => { void handleOpmlExport(); setExportMenuOpen(false) }}>
                  <FileCode size={14} /> {t('mindmap.exportOpml')}
                </button>
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy} onClick={() => { void handleSvgExport(); setExportMenuOpen(false) }}>
                  <ImageIcon size={14} /> {t('mindmap.exportSvg')}
                </button>
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy} onClick={() => { void handlePngExport(); setExportMenuOpen(false) }}>
                  <FileImage size={14} /> {t('mindmap.exportPng')}
                </button>
              </div>
            ) : null}
          </div>
        )}
      />
    </div>
  )
}

function findMindMapTopicPath(node: MindMapTopicV2, id: string, path: MindMapTopicV2[] = []): MindMapTopicV2[] | null {
  const nextPath = [...path, node]
  if (node.id === id) return nextPath
  for (const child of node.children) {
    const found = findMindMapTopicPath(child, id, nextPath)
    if (found) return found
  }
  return null
}

function findMindMapTopic(node: MindMapTopicV2, id: string): MindMapTopicV2 | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findMindMapTopic(child, id)
    if (found) return found
  }
  return null
}

function isXmindCompatibilityReport(value: unknown): value is XmindCompatibilityReport {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return ['preserved', 'approximated', 'dropped', 'warnings'].every((key) =>
    Array.isArray(record[key])
  )
}
