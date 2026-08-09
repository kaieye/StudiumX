import {
  ChevronDown,
  ChevronUp,
  Download,
  FilePlus2,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../app-shell/appStore'
import { MindMapAiPanel } from './MindMapAiPanel'
import { MindMapCanvas } from './MindMapCanvas'
import { useMindMapViewStore } from './mind-map-view-store'
import './mindmap.css'

/**
 * Mind-map view entry (docs/mindmap/design.md §6.2).
 *
 * Three panes: a document list on the left, the editable SVG canvas in the
 * center, and the AI generation panel on the right. A toolbar row carries
 * sheet / rename / collapse / import / export actions.
 */
export function MindMapView() {
  const { t } = useTranslation()
  const activeWorkspace = useAppStore((s) => s.appState?.activeWorkspace)
  const documents = useMindMapViewStore((s) => s.documents)
  const current = useMindMapViewStore((s) => s.current)
  const loadDocuments = useMindMapViewStore((s) => s.loadDocuments)
  const openDocument = useMindMapViewStore((s) => s.openDocument)
  const createDocument = useMindMapViewStore((s) => s.createDocument)
  const deleteDocument = useMindMapViewStore((s) => s.deleteDocument)
  const renameDocument = useMindMapViewStore((s) => s.renameDocument)
  const newSheet = useMindMapViewStore((s) => s.newSheet)
  const collapseAll = useMindMapViewStore((s) => s.collapseAll)
  const expandAll = useMindMapViewStore((s) => s.expandAll)

  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setNotice(null)
    setActiveSheetIndex(0)
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
    await renameDocument(title)
  }

  const handleImport = async (file: File | null): Promise<void> => {
    if (!file) return
    const path = (file as File & { path?: string }).path
    if (!path) {
      setNotice('Import requires a desktop file path')
      return
    }
    setBusy(true)
    try {
      const doc = await window.teachingSystem?.importMindMapXmind({
        workspaceId: activeWorkspace.id,
        sourcePath: path
      })
      if (doc) {
        useMindMapViewStore.setState({ current: doc, selectedNodeId: doc.sheets[0]?.root.id ?? null })
        await loadDocuments()
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleExport = async (): Promise<void> => {
    if (!current) return
    setBusy(true)
    try {
      const picked = await window.teachingSystem?.pickDirectory()
      if (!picked || picked.canceled || !picked.path) return
      const result = await window.teachingSystem?.exportMindMapXmind({
        workspaceId: activeWorkspace.id,
        id: current.id,
        destinationDirectory: picked.path
      })
      setNotice(result?.path ? `Exported: ${result.path}` : 'Export failed')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
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
        <div className="mindmap-list__body">
          {documents.length === 0 ? (
            <div className="mindmap-list__empty">{t('mindmap.emptyState')}</div>
          ) : (
            documents.map((doc) => {
              const isCurrent = current?.id === doc.id
              return (
                <div
                  key={doc.id}
                  className={`mindmap-list__item${isCurrent ? ' is-active' : ''}`}
                  onClick={() => void openDocument(doc.id)}
                >
                  <span className="mindmap-list__item-title">{doc.title || t('mindmap.newDocument')}</span>
                  <span className="mindmap-list__item-meta">
                    {doc.sheetCount} {t('mindmap.layout')}
                  </span>
                  <button
                    type="button"
                    className="icon-button mindmap-list__item-delete"
                    aria-label={t('mindmap.deleteDocument')}
                    title={t('mindmap.deleteDocument')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void deleteDocument(doc.id)
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })
          )}
        </div>
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
              onClick={() => void newSheet()}
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".xmind"
              hidden
              onChange={(event) => void handleImport(event.currentTarget.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              title={t('mindmap.importXmind')}
            >
              <Upload size={14} />
              {t('mindmap.importXmind')}
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

        {current ? (
          <>
            <div className="mindmap-sheet-tabs">
              {current.sheets.map((sheet, index) => (
                <button
                  key={sheet.id}
                  type="button"
                  className={`mindmap-sheet-tab${index === activeSheetIndex ? ' is-active' : ''}`}
                  onClick={() => setActiveSheetIndex(index)}
                >
                  {sheet.title}
                </button>
              ))}
            </div>
            <MindMapCanvas
              document={current}
              activeSheetIndex={activeSheetIndex}
              onActiveSheetChange={setActiveSheetIndex}
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