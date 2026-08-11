import {
  ChevronUp,
        Crosshair,
  Download,
  GitBranch,
  Home,
  FileCode,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  ListPlus,
  Loader2,
  Maximize2,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Redo2,
    Share2,
  StickyNote,
  Tag,
  Undo2,
  Upload,
  X
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../app-shell/appStore'
import { MindMapAiPanel } from './MindMapAiPanel'
import { MindMapCanvas, type MindMapCanvasViewportAction } from './MindMapCanvas'
import { MindMapDocumentList } from './MindMapDocumentList'
import {
  MindMapExportFeedback,
  type MindMapExportFeedbackState,
  type MindMapExportFormat
} from './MindMapExportFeedback'
import { MindMapImportCompatibilityReport } from './MindMapImportCompatibilityReport'
import { MindMapOutline } from './MindMapOutline'
import { MindMapSearchPanel } from './MindMapSearchPanel'
import { MindMapSheetTabs } from './MindMapSheetTabs'
import { MindMapSourcePanel } from './MindMapSourcePanel'
import { MindMapContextMenu } from './MindMapContextMenu'
import { MindMapZoomControls } from './MindMapZoomControls'
import { MindMapMinimap } from './MindMapMinimap'
import { useMindMapContextMenu } from './mind-map-context-menu-hook'
import type { MindMapSourceRef, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapCommand } from '../../../../shared/mindmap/commands'
import type { XmindCompatibilityReport } from '../../../../shared/mindmap/xmind-compatibility'
import type { MindMapSourceRefreshApplyResult } from '../../../../shared/teaching-types/mindmap'
import { useMindMapKeyboard } from './mind-map-keyboard'
import type { MindMapFocusDirection } from './mind-map-keyboard-navigation'
import { nextMindMapFocus } from './mind-map-keyboard-navigation'
import { computeMindMapLayout } from './mind-map-layout'
import { mindMapLayoutToSvgInput } from './mind-map-svg-adapter'
import { rasterizeMindMapSvgToPng } from './mind-map-png-export'
import { useMindMapViewStore } from './mind-map-view-store'
import { buildMindMapTextReplacementPatch } from './mind-map-search'
import {
  MIND_MAP_IMPORT_ACCEPT,
  mindMapImportFormatForFileName
} from './mind-map-import-format'
import './mindmap.css'

/**
 * Mind-map view entry (docs/mindmap/design.md §6.2).
 *
 * Three panes: a document list on the left, the editable SVG canvas in the
 * center, and the AI generation panel on the right. A toolbar row carries
 * sheet / rename / collapse / import / export actions, and a sheet bar below
 * it drives the full sheet lifecycle (switch / rename / copy / reorder / delete).
 */
export function MindMapView() {
  const { t } = useTranslation()
  const activeWorkspace = useAppStore((s) => s.appState?.activeWorkspace)
  const openMindMapSource = useAppStore((s) => s.openMindMapSource)
  const documents = useMindMapViewStore((s) => s.documents)
  const current = useMindMapViewStore((s) => s.current)
  const selectedNodeId = useMindMapViewStore((s) => s.selectedNodeId)
  const activeSheetId = useMindMapViewStore((s) => s.activeSheetId)
  const editingNodeId = useMindMapViewStore((s) => s.editingNodeId)
  const loadDocuments = useMindMapViewStore((s) => s.loadDocuments)
  const openDocument = useMindMapViewStore((s) => s.openDocument)
  const adoptCommittedDocument = useMindMapViewStore((s) => s.adoptCommittedDocument)
  const createDocument = useMindMapViewStore((s) => s.createDocument)
  const deleteDocument = useMindMapViewStore((s) => s.deleteDocument)
  const renameDocument = useMindMapViewStore((s) => s.renameDocument)
  const newSheet = useMindMapViewStore((s) => s.newSheet)
  const renameSheet = useMindMapViewStore((s) => s.renameSheet)
  const duplicateSheet = useMindMapViewStore((s) => s.duplicateSheet)
  const removeSheet = useMindMapViewStore((s) => s.removeSheet)
  const reorderSheet = useMindMapViewStore((s) => s.reorderSheet)
  const addChild = useMindMapViewStore((s) => s.addChild)
  const addSibling = useMindMapViewStore((s) => s.addSibling)
  const outdent = useMindMapViewStore((s) => s.outdent)
  const insertAbove = useMindMapViewStore((s) => s.insertAbove)
  const deleteNode = useMindMapViewStore((s) => s.deleteNode)
  const toggleCollapse = useMindMapViewStore((s) => s.toggleCollapse)
  const copyNode = useMindMapViewStore((s) => s.copyNode)
  const cutNode = useMindMapViewStore((s) => s.cutNode)
  const pasteNode = useMindMapViewStore((s) => s.pasteNode)
  const duplicateNode = useMindMapViewStore((s) => s.duplicateNode)
  const undo = useMindMapViewStore((s) => s.undo)
  const redo = useMindMapViewStore((s) => s.redo)
  const setEditingNodeId = useMindMapViewStore((s) => s.setEditingNodeId)
  const flushForExport = useMindMapViewStore((s) => s.flushForExport)
  const dispatchCommand = useMindMapViewStore((s) => s.dispatchCommand)
  const inspectorOpen = useMindMapViewStore((s) => s.inspectorOpen)
  const toggleInspector = useMindMapViewStore((s) => s.toggleInspector)
  const setInspectorTab = useMindMapViewStore((s) => s.setInspectorTab)

  const activeSheet = current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0]

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [exportFeedback, setExportFeedback] = useState<MindMapExportFeedbackState | null>(null)
  const [importCompatibilityReport, setImportCompatibilityReport] =
    useState<XmindCompatibilityReport | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const [searchCollapsed, setSearchCollapsed] = useState(true)
  const [sourceCollapsed, setSourceCollapsed] = useState(true)
  // P1 §4.5: whole-list collapse, persisted to localStorage so reopen restores the choice.
  const [listCollapsed, setListCollapsed] = useState(() => {
    try {
      return localStorage.getItem('mindmap.listCollapsed') === 'true'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('mindmap.listCollapsed', String(listCollapsed))
    } catch {
      // localStorage may be unavailable (private mode / sandbox); state still works in-memory.
    }
  }, [listCollapsed])
  const [viewportAction, setViewportAction] = useState<MindMapCanvasViewportAction | null>(null)
  const viewportActionIdRef = useRef(0)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [viewportRect, setViewportRect] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const { contextMenu, openContextMenu, closeContextMenu, canPaste, actions: contextMenuActions } = useMindMapContextMenu()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const triggerViewportAction = (
    action:
      | Exclude<MindMapCanvasViewportAction, { type: 'navigate' }>['type']
      | { type: 'navigate'; x: number; y: number }
  ): void => {
    viewportActionIdRef.current += 1
    setViewportAction(
      typeof action === 'string'
        ? { id: viewportActionIdRef.current, type: action }
        : { id: viewportActionIdRef.current, ...action }
    )
  }

  const handleViewportChange = useCallback(
    (next: { x: number; y: number; width: number; height: number }) => {
      setViewportRect(next)
    },
    []
  )

  const openMindMapSourceRef = async (sourceRef: MindMapSourceRef): Promise<void> => {
    const result = await openMindMapSource(sourceRef, activeWorkspace?.id)
    if (!result.ok) {
      setNotice(
        result.reason === 'invalid_target'
          ? t('mindmap.sourceInvalid')
          : t('mindmap.sourceUnavailable')
      )
    } else {
      setNotice(null)
    }
  }

  const adoptSourceRefresh = (
    result: Extract<MindMapSourceRefreshApplyResult, { ok: true }>
  ): void => {
    adoptCommittedDocument(result.document, {
      inverse: result.inverse,
      label: t('mindmap.sourceRefresh.applyLabel')
    })
    setNotice(t('mindmap.sourceRefresh.applied', { count: result.appliedSourceIds.length }))
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
        if (selectedNodeId !== null) toggleCollapse(selectedNodeId)
      },
      remove: () => {
        if (selectedNodeId !== null) deleteNode(selectedNodeId)
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
      moveFocus: (direction: MindMapFocusDirection) => {
        const sheet = current?.sheets.find((candidate) => candidate.id === activeSheetId) ?? current?.sheets[0]
        if (!sheet) return
        const nextNodeId = nextMindMapFocus(computeMindMapLayout(sheet).nodes, selectedNodeId, direction)
        if (nextNodeId !== null) useMindMapViewStore.setState({ selectedNodeId: nextNodeId })
      },
      toggleInspector
    }
  )

  useEffect(() => {
    setNotice(null)
    setImportCompatibilityReport(null)
    void loadDocuments()
  }, [loadDocuments, activeWorkspace?.id])

  if (!activeWorkspace) {
    return (
      <div className="mindmap-view">
        <div className="mindmap-empty">{t('mindmap.noWorkspace')}</div>
      </div>
    )
  }

  const handleCreate = (): void => {
    // Opening the form and creating the document are two separate steps.  The
    // create IPC contract requires a non-empty title, so calling
    // `createDocument('')` here makes the request fail before the user ever
    // gets a chance to enter one (and immediately closes the form).
    setNotice(null)
    setTitleDraft('')
    setCreating(true)
  }

  const commitCreate = async (): Promise<void> => {
    const title = titleDraft.trim() || t('mindmap.newDocument')
    setCreating(false)
    await createDocument(title)
    // XMind starts a new map in an editable root topic. Keep the same low
    // friction flow while still creating a valid, persisted document first.
    const created = useMindMapViewStore.getState().current
    const root = created?.sheets[0]?.root
    if (root) {
      useMindMapViewStore.setState({ selectedNodeId: root.id, editingNodeId: root.id })
    }
  }

  const commitRename = async (): Promise<void> => {
    const title = titleDraft.trim() || current?.title || ''
    setRenaming(false)
    if (!current || !title) return
    renameDocument(title)
  }

  const openRename = (): void => {
    if (!current) return
    setTitleDraft(current.title)
    setRenaming(true)
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
        sheet.elements
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
        sheet.elements
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
    useMindMapViewStore.setState({
      activeSheetId: sheetId,
      selectedNodeId: sheet.root.id,
      editingNodeId: null
    })
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
    useMindMapViewStore.setState({ selectedNodeId: nodeId })
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

  // G10: markers/notes live inside the inspector's style tab — the toolbar
  // buttons open that tab and bring the section into view.
  const openInspectorSection = (section: 'markers' | 'notes'): void => {
    if (!inspectorOpen) toggleInspector()
    setInspectorTab('style')
    requestAnimationFrame(() => {
      document
        .getElementById(`mindmap-inspector-${section}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }

  return (
    <div className="mindmap-view">
      <div className={`mindmap-list${listCollapsed ? ' is-collapsed' : ''}`}>
        <div className="mindmap-list__head">
          <strong>{t('mindmap.viewTitle')}</strong>
          <div className="mindmap-list__head-actions">
            <button
              type="button"
              className="icon-button"
              disabled={creating}
              onClick={handleCreate}
              title={t('mindmap.newDocument')}
              aria-label={t('mindmap.newDocument')}
            >
              {creating ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
            </button>
            <button
              type="button"
              className="icon-button mindmap-list__collapse"
              onClick={() => setListCollapsed((v) => !v)}
              title={listCollapsed ? t('mindmap.expandList') : t('mindmap.collapseList')}
              aria-label={listCollapsed ? t('mindmap.expandList') : t('mindmap.collapseList')}
              aria-expanded={!listCollapsed}
            >
              <PanelLeft size={15} />
            </button>
          </div>
        </div>
        {creating ? (
          <form
            className="mindmap-list__create"
            onSubmit={(event) => {
              event.preventDefault()
              void commitCreate()
            }}
          >
            <input
              autoFocus
              value={titleDraft}
              placeholder={t('mindmap.enterTitle')}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreating(false)
              }}
            />
            <button type="submit" className="icon-button" aria-label={t('mindmap.save')}>
              <ChevronUp size={14} />
            </button>
          </form>
        ) : null}
        <MindMapDocumentList
          documents={documents}
          currentDocumentId={current?.id ?? null}
          onOpenDocument={openDocument}
          onDeleteDocument={deleteDocument}
        />
        {activeSheet ? (
          <>
            <details className="mindmap-list__collapsible" open={!searchCollapsed} onToggle={(e) => setSearchCollapsed(!e.currentTarget.open)}>
              <summary className="mindmap-list__collapsible-head">
                {t('mindmap.search')}
              </summary>
              <MindMapSearchPanel
                root={activeSheet.root}
                selectedNodeId={selectedNodeId}
                onSelect={selectAndRevealMindMapNode}
                onReplace={replaceMindMapText}
                onReplaceAll={replaceAllMindMapText}
              />
            </details>
            <details className="mindmap-list__collapsible" open={!sourceCollapsed} onToggle={(e) => setSourceCollapsed(!e.currentTarget.open)}>
              <summary className="mindmap-list__collapsible-head">
                {t('mindmap.sources')}
              </summary>
              <MindMapSourcePanel
                root={activeSheet.root}
                selectedNodeId={selectedNodeId}
                onSelect={selectAndRevealMindMapNode}
                onOpenSource={(sourceRef) => void openMindMapSourceRef(sourceRef)}
                workspaceId={activeWorkspace?.id ?? null}
                documentId={current?.id ?? null}
                onSourceRefreshApplied={adoptSourceRefresh}
              />
            </details>
            <MindMapOutline
              sheet={activeSheet}
              selectedNodeId={selectedNodeId}
              onSelect={(nodeId) => useMindMapViewStore.setState({ selectedNodeId: nodeId })}
              onToggleCollapse={toggleCollapse}
            />
          </>
        ) : null}
      </div>

      <div className="mindmap-stage">
        {/* G9: the old full-width header bar is gone — identity (top-left) and
            actions (top-right) float over the canvas like Xmind's chrome. */}
        <div className="mindmap-stage__identity">
          <button
            type="button"
            className="mindmap-stage__home"
            onClick={() => triggerViewportAction('center')}
            title={t('mindmap.centerCanvas')}
            aria-label={t('mindmap.centerCanvas')}
          >
            <Home size={16} aria-hidden="true" />
          </button>
          <div className="mindmap-stage__titles">
            <strong>{current?.title || t('mindmap.viewTitle')}</strong>
            {activeSheet ? <span>/ {activeSheet.title}</span> : null}
          </div>
          <span className="mindmap-stage__save-state" title={t('mindmap.localSave')} aria-label={t('mindmap.localSave')} />
        </div>
        <div className="mindmap-stage__header-actions">
          <button
            type="button"
            className="mindmap-stage__header-button"
            disabled={!current}
            onClick={openRename}
            title={t('mindmap.renameDocument')}
            aria-label={t('mindmap.renameDocument')}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
          <div className="mindmap-export-dropdown">
            <button
              type="button"
              className="mindmap-stage__header-button"
              disabled={busy || !current}
              onClick={() => setExportMenuOpen((v) => !v)}
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
                  onChange={(event) => { void handleImport(event.currentTarget.files?.[0] ?? null); setExportMenuOpen(false) }}
                />
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy} onClick={() => { fileInputRef.current?.click() }}>
                  <Upload size={14} /> {t('mindmap.import')}
                </button>
                <div className="mindmap-export-dropdown__divider" />
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy || !current} onClick={() => { void handleExport(); setExportMenuOpen(false) }}>
                  <Download size={14} /> {t('mindmap.exportXmind')}
                </button>
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy || !current} onClick={() => { void handleMarkdownExport(); setExportMenuOpen(false) }}>
                  <FileText size={14} /> {t('mindmap.exportMarkdown')}
                </button>
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy || !current} onClick={() => { void handleOpmlExport(); setExportMenuOpen(false) }}>
                  <FileCode size={14} /> {t('mindmap.exportOpml')}
                </button>
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy || !current} onClick={() => { void handleSvgExport(); setExportMenuOpen(false) }}>
                  <ImageIcon size={14} /> {t('mindmap.exportSvg')}
                </button>
                <button type="button" className="mindmap-export-dropdown__item" role="menuitem" disabled={busy || !current} onClick={() => { void handlePngExport(); setExportMenuOpen(false) }}>
                  <FileImage size={14} /> {t('mindmap.exportPng')}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={`mindmap-stage__header-button${inspectorOpen ? ' is-active' : ''}`}
            disabled={!current}
            onClick={toggleInspector}
            title={t('mindmap.inspector.title')}
            aria-label={t('mindmap.inspector.title')}
            aria-pressed={inspectorOpen}
          >
            <PanelRight size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="mindmap-floating-toolbar" role="toolbar" aria-label={t('mindmap.viewTitle')}>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current}
            onClick={undo}
            title={t('mindmap.undo')}
            aria-label={t('mindmap.undo')}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current}
            onClick={redo}
            title={t('mindmap.redo')}
            aria-label={t('mindmap.redo')}
          >
            <Redo2 size={16} />
          </button>
          <span className="mindmap-floating-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current || !selectedNodeId}
            onClick={handleAddTopicFromCanvas}
            title={`${t('mindmap.addChild')} (Tab)`}
            aria-label={t('mindmap.addChild')}
          >
            <GitBranch size={16} />
          </button>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current || !selectedNodeId}
            onClick={handleAddSibling}
            title={`${t('mindmap.addSibling')} (Enter)`}
            aria-label={t('mindmap.addSibling')}
          >
            <ListPlus size={16} />
          </button>
          <span className="mindmap-floating-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current || !selectedNodeId}
            onClick={() => setNotice(t('mindmap.addRelationship') + ' - coming soon')}
            title={t('mindmap.addRelationship')}
            aria-label={t('mindmap.addRelationship')}
          >
            <Crosshair size={16} />
          </button>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current || !selectedNodeId}
            onClick={() => openInspectorSection('markers')}
            title={t('mindmap.markersPanel.title')}
            aria-label={t('mindmap.markersPanel.title')}
          >
            <Tag size={16} />
          </button>
          <button
            type="button"
            className="mindmap-floating-toolbar__btn"
            disabled={!current || !selectedNodeId}
            onClick={() => openInspectorSection('notes')}
            title={t('mindmap.notesPanel.title')}
            aria-label={t('mindmap.notesPanel.title')}
          >
            <StickyNote size={16} />
          </button>
        </div>

        {renaming && current ? (
          <form
            className="mindmap-rename"
            onSubmit={(event) => {
              event.preventDefault()
              void commitRename()
            }}
          >
            <input
              autoFocus
              value={titleDraft}
              placeholder={t('mindmap.enterTitle')}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenaming(false)
              }}
            />
            <button type="submit" className="ghost-button">
              {t('mindmap.save')}
            </button>
            <button type="button" className="ghost-button" onClick={() => setRenaming(false)}>
              <X size={14} />
              {t('mindmap.cancel')}
            </button>
          </form>
        ) : null}

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

        {current ? (
          <>
            <MindMapCanvas
              document={current}
              activeSheetIndex={Math.max(0, current.sheets.findIndex((s) => s.id === activeSheetId))}
              onActiveSheetChange={() => undefined}
              viewportAction={viewportAction}
              onZoomChange={setZoomLevel}
              onViewportChange={handleViewportChange}
              onContextMenu={openContextMenu}
              onMoveNode={handleMoveNode}
            />
            <div className="mindmap-sheet-pill">
              <MindMapSheetTabs
                document={current}
                activeSheetId={activeSheetId}
                onActivate={activateSheet}
                onRename={renameSheet}
                onDuplicate={duplicateSheet}
                onRemove={removeSheet}
                onReorder={reorderSheet}
              />
              <button
                type="button"
                className="mindmap-sheet-pill__add"
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
            <MindMapMinimap
              document={current}
              activeSheetId={activeSheetId}
              viewport={viewportRect}
              onNavigate={(x, y) => triggerViewportAction({ type: 'navigate', x, y })}
            />
            <MindMapContextMenu
              state={contextMenu}
              actions={contextMenuActions}
              canPaste={canPaste}
              isCollapsed={contextMenu.isCollapsed ?? false}
              isRoot={contextMenu.isRoot ?? false}
              onClose={closeContextMenu}
            />
          </>
        ) : (
          <div className="mindmap-empty">
            <FolderOpen size={22} aria-hidden="true" />
            <p>{t('mindmap.emptyState')}</p>
            <button
              type="button"
              className="mindmap-empty__action"
              disabled={creating}
              onClick={handleCreate}
            >
              <Plus size={15} aria-hidden="true" />
              {t('mindmap.newDocument')}
            </button>
          </div>
        )}
      </div>

      <MindMapAiPanel open={inspectorOpen} onToggle={toggleInspector} />
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
