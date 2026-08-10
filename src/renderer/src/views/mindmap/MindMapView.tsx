import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Download,
  FileCode,
  FilePlus2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Upload,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { MindMapThemePanel } from './MindMapThemePanel'
import { MindMapTopicStyleInspector } from './MindMapTopicStyleInspector'
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
  const collapseAll = useMindMapViewStore((s) => s.collapseAll)
  const expandAll = useMindMapViewStore((s) => s.expandAll)
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

  const selectedSourceRef: MindMapSourceRef | null = (() => {
    if (!current || !activeSheetId || !selectedNodeId) return null
    const sheet = current.sheets.find((candidate) => candidate.id === activeSheetId)
    return sheet ? findMindMapTopic(sheet.root, selectedNodeId)?.sourceRefs?.[0] ?? null : null
  })()

  const activeSheet = current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0]

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [exportFeedback, setExportFeedback] = useState<MindMapExportFeedbackState | null>(null)
  const [importCompatibilityReport, setImportCompatibilityReport] =
    useState<XmindCompatibilityReport | null>(null)
  const [viewportAction, setViewportAction] = useState<MindMapCanvasViewportAction | null>(null)
  const viewportActionIdRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const triggerViewportAction = (type: MindMapCanvasViewportAction['type']): void => {
    viewportActionIdRef.current += 1
    setViewportAction({ id: viewportActionIdRef.current, type })
  }

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

  const openSelectedSource = async (): Promise<void> => {
    if (!selectedSourceRef) return
    await openMindMapSourceRef(selectedSourceRef)
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
      }
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

  const handleCreate = async (): Promise<void> => {
    setCreating(true)
    setTitleDraft('')
    try {
      await createDocument('')
    } finally {
      setCreating(false)
    }
  }

  const commitCreate = async (): Promise<void> => {
    const title = titleDraft.trim() || t('mindmap.newDocument')
    setCreating(false)
    await createDocument(title)
  }

  const commitRename = async (): Promise<void> => {
    const title = titleDraft.trim()
    setRenaming(false)
    if (!current || !title) return
    renameDocument(title)
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

  return (
    <div className="mindmap-view">
      <div className="mindmap-list">
        <div className="mindmap-list__head">
          <strong>{t('mindmap.viewTitle')}</strong>
          <button
            type="button"
            className="icon-button"
            disabled={creating}
            onClick={() => void handleCreate()}
            title={t('mindmap.newDocument')}
            aria-label={t('mindmap.newDocument')}
          >
            {creating ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
          </button>
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
            <MindMapSearchPanel
              root={activeSheet.root}
              selectedNodeId={selectedNodeId}
              onSelect={selectAndRevealMindMapNode}
              onReplace={replaceMindMapText}
              onReplaceAll={replaceAllMindMapText}
            />
            <MindMapSourcePanel
              root={activeSheet.root}
              selectedNodeId={selectedNodeId}
              onSelect={selectAndRevealMindMapNode}
              onOpenSource={(sourceRef) => void openMindMapSourceRef(sourceRef)}
              workspaceId={activeWorkspace?.id ?? null}
              documentId={current?.id ?? null}
              onSourceRefreshApplied={adoptSourceRefresh}
            />
            <MindMapOutline
              sheet={activeSheet}
              selectedNodeId={selectedNodeId}
              onSelect={(nodeId) => useMindMapViewStore.setState({ selectedNodeId: nodeId })}
              onToggleCollapse={toggleCollapse}
            />
            <MindMapTopicStyleInspector />
            <MindMapThemePanel />
          </>
        ) : null}
      </div>

      <div className="mindmap-stage">
        <div className="mindmap-toolbar">
          <div className="mindmap-toolbar__group">
            <button
              type="button"
              className="ghost-button"
              disabled={!current}
              onClick={() => setRenaming(true)}
              title={t('mindmap.renameDocument')}
            >
              <Pencil size={14} />
              {t('mindmap.renameDocument')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!current}
              onClick={newSheet}
              title={t('mindmap.newSheet')}
            >
              <FilePlus2 size={14} />
              {t('mindmap.newSheet')}
            </button>
          </div>
          <div className="mindmap-toolbar__group">
            <button
              type="button"
              className="ghost-button"
              disabled={!current}
              onClick={collapseAll}
              title={t('mindmap.collapseAll')}
            >
              <ChevronDown size={14} />
              {t('mindmap.collapseAll')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!current}
              onClick={expandAll}
              title={t('mindmap.expandAll')}
            >
              <ChevronUp size={14} />
              {t('mindmap.expandAll')}
            </button>
          </div>
          <div className="mindmap-toolbar__group">
            <button
              type="button"
              className="ghost-button"
              disabled={!current || !selectedSourceRef}
              onClick={() => void openSelectedSource()}
              title={t('mindmap.openSource')}
            >
              <FolderOpen size={14} />
              {t('mindmap.openSource')}
            </button>
          </div>
          <div className="mindmap-toolbar__group">
            <button
              type="button"
              className="ghost-button"
              disabled={!current}
              onClick={() => triggerViewportAction('fit')}
              title={t('mindmap.fitCanvas')}
            >
              <Maximize2 size={14} />
              {t('mindmap.fitCanvas')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!current}
              onClick={() => triggerViewportAction('actual')}
              title={t('mindmap.actualSize')}
            >
              <RotateCcw size={14} />
              {t('mindmap.actualSize')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!current}
              onClick={() => triggerViewportAction('center')}
              title={t('mindmap.centerCanvas')}
            >
              <Crosshair size={14} />
              {t('mindmap.centerCanvas')}
            </button>
          </div>
          <div className="mindmap-toolbar__group">
            <input
              ref={fileInputRef}
              type="file"
              accept={MIND_MAP_IMPORT_ACCEPT}
              hidden
              onChange={(event) => void handleImport(event.currentTarget.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              title={t('mindmap.importFormats')}
            >
              <Upload size={14} />
              {t('mindmap.import')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy || !current}
              onClick={() => void handleExport()}
              title={t('mindmap.exportXmind')}
            >
              <Download size={14} />
              {t('mindmap.exportXmind')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy || !current}
              onClick={() => void handleMarkdownExport()}
              title={t('mindmap.exportMarkdown')}
            >
              <FileText size={14} />
              {t('mindmap.exportMarkdown')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy || !current}
              onClick={() => void handleOpmlExport()}
              title={t('mindmap.exportOpml')}
            >
              <FileCode size={14} />
              {t('mindmap.exportOpml')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy || !current}
              onClick={() => void handleSvgExport()}
              title={t('mindmap.exportSvg')}
            >
              <ImageIcon size={14} />
              {t('mindmap.exportSvg')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy || !current}
              onClick={() => void handlePngExport()}
              title={t('mindmap.exportPng')}
            >
              <ImageIcon size={14} />
              {t('mindmap.exportPng')}
            </button>
          </div>
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
              defaultValue={current.title}
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
            <MindMapSheetTabs
              document={current}
              activeSheetId={activeSheetId}
              onActivate={activateSheet}
              onRename={renameSheet}
              onDuplicate={duplicateSheet}
              onRemove={removeSheet}
              onReorder={reorderSheet}
            />
            <MindMapCanvas
              document={current}
              activeSheetIndex={Math.max(0, current.sheets.findIndex((s) => s.id === activeSheetId))}
              onActiveSheetChange={() => undefined}
              viewportAction={viewportAction}
            />
          </>
        ) : (
          <div className="mindmap-empty">
            <FolderOpen size={22} aria-hidden="true" />
            <p>{t('mindmap.emptyState')}</p>
          </div>
        )}
      </div>

      <MindMapAiPanel />
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
