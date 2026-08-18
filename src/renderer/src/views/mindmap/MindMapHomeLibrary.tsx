import { Folder, Home, Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  MindMapCardPreview,
  MindMapSummary
} from '../../../../shared/mindmap/mind-map-types'
import {
  type MindMapLibrary,
  type MindMapLibraryWorkspace
} from '../../../../shared/teaching-types/mindmap'
import { MindMapHomeCardMenu, type MindMapHomeCardMenuState } from './MindMapHomeCardMenu'
import { branchColorForKey } from './mind-map-branch-colors'
import { computeMindMapLayout, type MindMapLayoutResult } from './mind-map-layout'

/**
 * Home-page mind-map library (docs/mindmap/design.md §6.2).
 *
 * The home surface shows, top to bottom:
 *   1. a search box,
 *   2. four most-recently-edited preview cards (across the home location and
 *      every workspace folder),
 *   3. a section of workspace folders plus all mind-map cards (home cards and
 *      every workspace's cards flattened together).
 *
 * Double-clicking a folder switches to that workspace's folder view, rendered
 * by the same component in "folder mode". Opening any card or creating a new
 * map enters the editor.
 */
export function MindMapHomeLibrary({
  library,
  folder,
  creating,
  createError,
  onCreate,
  onOpenDocument,
  onOpenFolder,
  onBackToLibrary,
  onRenameDocument,
  onDeleteDocument,
  onCopyDocument
}: {
  library: MindMapLibrary | null
  /** The currently browsed workspace folder, or null for the home page. */
  folder: string | null
  creating: boolean
  createError: string | null
  onCreate: () => void | Promise<void>
  onOpenDocument: (id: string) => void | Promise<void>
  onOpenFolder: (workspaceId: string) => void | Promise<void>
  onBackToLibrary: () => void | Promise<void>
  onRenameDocument: (id: string, title: string) => void | Promise<void>
  onDeleteDocument: (id: string) => void | Promise<void>
  onCopyDocument: (id: string, title: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [cardMenu, setCardMenu] = useState<MindMapHomeCardMenuState>(null)
  const [renamingDocument, setRenamingDocument] = useState<MindMapSummary | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // In folder mode the card set is just that folder's documents; in home mode
  // it is every card flattened (home + all workspaces).
  const allDocuments = useMemo<MindMapSummary[]>(() => {
    if (!library) return []
    if (folder) {
      const entry = library.workspaces.find((item) => item.workspaceId === folder)
      return entry ? entry.documents : []
    }
    return [
      ...library.home,
      ...library.workspaces.flatMap((item) => item.documents)
    ]
  }, [library, folder])

  const visibleDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return allDocuments
    return allDocuments.filter((summary) =>
      (summary.title || t('mindmap.newDocument')).toLocaleLowerCase().includes(normalizedQuery)
    )
  }, [allDocuments, query, t])

  // Most recently edited cards across the whole library (home mode only).
  const recentDocuments = useMemo(() => {
    if (!library) return []
    return [...library.home, ...library.workspaces.flatMap((item) => item.documents)]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, 4)
  }, [library])

  // `listMindMapLibrary` already carries a first-sheet card projection. Keep
  // the gallery synchronous and reserve readMindMap for actually opening a
  // document, so cards do not appear to load after a fixed IPC round trip.
  const previews = useMemo(
    () => Object.fromEntries(
      allDocuments.flatMap((summary) => summary.preview ? [[summary.id, summary.preview] as const] : [])
    ),
    [allDocuments]
  )

  const startRename = (summary: MindMapSummary): void => {
    setCardMenu(null)
    setRenamingDocument(summary)
    setRenameDraft(summary.title || t('mindmap.newDocument'))
  }

  const cancelRename = (): void => {
    setRenamingDocument(null)
    setRenameDraft('')
  }

  const commitRename = async (): Promise<void> => {
    const target = renamingDocument
    if (!target) return
    const title = renameDraft.trim()
    if (!title || title === (target.title || t('mindmap.newDocument'))) {
      cancelRename()
      return
    }
    await onRenameDocument(target.id, title)
    cancelRename()
  }

  const setRenameDraftFor = (_id: string, value: string): void => {
    setRenameDraft(value)
  }

  const copyDocument = (summary: MindMapSummary): void | Promise<void> => {
    const title = summary.title || t('mindmap.newDocument')
    return onCopyDocument(summary.id, t('mindmap.copyOf', { title }))
  }

  return (
    <section className="mindmap-home" aria-label={t('mindmap.recentMaps')}>
      <div className="mindmap-home__header">
        <div className="mindmap-home__search" role="search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('mindmap.homeSearchPlaceholder')}
            aria-label={t('mindmap.homeSearchPlaceholder')}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('mindmap.cancel')}
              title={t('mindmap.cancel')}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {createError ? (
        <p className="mindmap-home__hint" role="alert">
          {createError}
        </p>
      ) : null}

      {folder ? (
        // ---- Folder view: that workspace's mind maps only ----
        <>
        <button
          type="button"
          className="mindmap-stage__home mindmap-folder__back"
          onClick={() => void onBackToLibrary()}
          title={t('mindmap.backToLibrary')}
          aria-label={t('mindmap.backToLibrary')}
        >
          <Home size={18} aria-hidden="true" />
        </button>
        <MindMapCardGrid
          documents={visibleDocuments}
          previews={previews}
          creating={creating}
          emptyLabel={t('mindmap.emptyFolder')}
          onCreate={onCreate}
          onOpenDocument={onOpenDocument}
          onRenameDocument={setRenameDraftFor}
          onContextMenu={(summary, x, y) => setCardMenu({ summary, x, y })}
          renamingDocument={renamingDocument}
          renameDraft={renameDraft}
          onStartRename={startRename}
          onCancelRename={cancelRename}
          onCommitRename={commitRename}
        />
        </>
      ) : (
        // ---- Home page: recent-4, then folders + all cards ----
        <>
          {recentDocuments.length > 0 ? (
            <div className="mindmap-home__section">
              <h2 className="mindmap-home__section-title">
                {t('mindmap.recentlyEdited')}
              </h2>
              <MindMapCardGrid
                documents={recentDocuments}
                previews={previews}
                creating={false}
                onOpenDocument={onOpenDocument}
                onRenameDocument={setRenameDraftFor}
                onContextMenu={(summary, x, y) => setCardMenu({ summary, x, y })}
                renamingDocument={renamingDocument}
                renameDraft={renameDraft}
                onStartRename={startRename}
                onCancelRename={cancelRename}
                onCommitRename={commitRename}
              />
            </div>
          ) : null}

          <div className="mindmap-home__section">
            <h2 className="mindmap-home__section-title">{t('mindmap.allMaps')}</h2>
            <div className="mindmap-home__grid">
              {/* New-map card first, then workspace folders, then all cards. */}
              <button
                type="button"
                className="mindmap-home-card mindmap-home-card--new"
                onClick={() => void onCreate()}
                disabled={creating}
                aria-busy={creating}
                aria-label={t('mindmap.newDocument')}
              >
                <span className="mindmap-home-card__preview mindmap-home-card__preview--new">
                  <Plus size={42} strokeWidth={1.25} aria-hidden="true" />
                </span>
                <span className="mindmap-home-card__title">{t('mindmap.newDocument')}</span>
              </button>
              {library?.workspaces.map((entry) => (
                <FolderCard
                  key={entry.workspaceId}
                  entry={entry}
                  onOpenFolder={onOpenFolder}
                />
              ))}
              {visibleDocuments.map((summary) => {
                  const title = summary.title || t('mindmap.newDocument')
                  return (
                    <article
                      className="mindmap-home-card"
                      key={summary.id}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setCardMenu({ summary, x: event.clientX, y: event.clientY })
                      }}
                    >
                      <button
                        type="button"
                        className="mindmap-home-card__preview-button"
                        onClick={() => void onOpenDocument(summary.id)}
                        aria-label={title}
                      >
                        <span className="mindmap-home-card__preview">
                          <MindMapPreview preview={previews[summary.id]} title={title} />
                        </span>
                      </button>
                      <div className="mindmap-home-card__title-slot">
                        <span className="mindmap-home-card__title">{title}</span>
                      </div>
                    </article>
                  )
                })}
            </div>
          </div>
        </>
      )}

      <MindMapHomeCardMenu
        state={cardMenu}
        onClose={() => setCardMenu(null)}
        onRename={startRename}
        onRemove={(summary) => onDeleteDocument(summary.id)}
        onCopy={copyDocument}
      />
    </section>
  )
}

function FolderCard({
  entry,
  onOpenFolder
}: {
  entry: MindMapLibraryWorkspace
  onOpenFolder: (workspaceId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="mindmap-home-card mindmap-folder-card"
      onDoubleClick={() => void onOpenFolder(entry.workspaceId)}
      onClick={() => void onOpenFolder(entry.workspaceId)}
      title={t('mindmap.openFolder')}
      aria-label={`${t('mindmap.openFolder')}: ${entry.name}`}
    >
      <span className="mindmap-home-card__preview">
        <Folder size={44} strokeWidth={1.1} aria-hidden="true" />
      </span>
      <span className="mindmap-home-card__title mindmap-folder-card__name">
        {entry.name}
      </span>
    </button>
  )
}

function MindMapCardGrid({
  documents,
  previews,
  creating,
  onCreate,
  onOpenDocument,
  onRenameDocument,
  onContextMenu,
  emptyLabel,
  renamingDocument,
  renameDraft,
  onStartRename,
  onCancelRename,
  onCommitRename
}: {
  documents: readonly MindMapSummary[]
  previews: Record<string, MindMapCardPreview>
  creating: boolean
  onCreate?: () => void | Promise<void>
  onOpenDocument: (id: string) => void | Promise<void>
  onRenameDocument: (id: string, title: string) => void | Promise<void>
  onContextMenu: (summary: MindMapSummary, x: number, y: number) => void
  emptyLabel?: string
  renamingDocument: MindMapSummary | null
  renameDraft: string
  onStartRename: (summary: MindMapSummary) => void
  onCancelRename: () => void
  onCommitRename: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <div className="mindmap-home__grid">
      {onCreate ? (
        <button
          type="button"
          className="mindmap-home-card mindmap-home-card--new"
          onClick={() => void onCreate()}
          disabled={creating}
          aria-busy={creating}
          aria-label={t('mindmap.newDocument')}
        >
          <span className="mindmap-home-card__preview mindmap-home-card__preview--new">
            <Plus size={42} strokeWidth={1.25} aria-hidden="true" />
          </span>
          <span className="mindmap-home-card__title">{t('mindmap.newDocument')}</span>
        </button>
      ) : null}

      {documents.length === 0 && emptyLabel ? (
        <p className="mindmap-home__empty">{emptyLabel}</p>
      ) : null}

      {documents.map((summary) => {
        const title = summary.title || t('mindmap.newDocument')
        const isRenaming = renamingDocument?.id === summary.id
        return (
          <article
            className={`mindmap-home-card${isRenaming ? ' mindmap-home-card--renaming' : ''}`}
            key={summary.id}
            onContextMenu={(event) => {
              event.preventDefault()
              onContextMenu(summary, event.clientX, event.clientY)
            }}
          >
            <button
              type="button"
              className="mindmap-home-card__preview-button"
              onClick={() => void onOpenDocument(summary.id)}
              aria-label={title}
            >
              <span className="mindmap-home-card__preview">
                <MindMapPreview preview={previews[summary.id]} title={title} />
              </span>
            </button>
            <div className="mindmap-home-card__title-slot">
              {isRenaming ? (
                <input
                  autoFocus
                  className="mindmap-home-card__title-input"
                  value={renameDraft}
                  placeholder={t('mindmap.enterTitle')}
                  onChange={(event) => onRenameDocument(summary.id, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      onCancelRename()
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  }}
                  onBlur={() => void onCommitRename()}
                  aria-label={t('mindmap.renameDocument')}
                />
              ) : (
                <button
                  type="button"
                  className="mindmap-home-card__title mindmap-home-card__title-button"
                  onClick={() => onStartRename(summary)}
                  aria-label={`${t('mindmap.renameDocument')}: ${title}`}
                >
                  {title}
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

type MindMapPreviewProps = {
  preview?: MindMapCardPreview
  title: string
}

function MindMapPreview({ preview, title }: MindMapPreviewProps) {
  const sheet = preview
    ? {
        id: 'preview-sheet',
        title,
        root: preview.root,
        elements: [],
        layout: preview.layout
      }
    : null
  const layout = useMemo(() => (sheet ? computeMindMapLayout(sheet) : null), [sheet])
  if (!layout || layout.nodes.length === 0) {
    return <PreviewPlaceholder title={title} />
  }
  return <PreviewSvg preview={preview!} title={title} layout={layout} />
}

function PreviewPlaceholder({ title }: { title: string }) {
  return (
    <svg className="mindmap-home-card__svg" viewBox="0 0 328 204" role="img" aria-label={title}>
      <rect x="103" y="78" width="122" height="48" rx="10" fill="#fff" stroke="#438eff" strokeWidth="2" />
      <text x="164" y="103" textAnchor="middle" dominantBaseline="central" fill="#2854d8" fontSize="16" fontWeight="600">
        {title || '思维导图'}
      </text>
    </svg>
  )
}

function PreviewSvg({
  preview,
  title,
  layout
}: {
  preview: MindMapCardPreview
  title: string
  layout: MindMapLayoutResult
}) {
  const nodes = layout.nodes
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + node.width))
  const maxY = Math.max(...nodes.map((node) => node.y + node.height))
  const padding = 28
  const viewBox = `${minX - padding} ${minY - padding} ${Math.max(180, maxX - minX + padding * 2)} ${Math.max(120, maxY - minY + padding * 2)}`

  return (
    <svg className="mindmap-home-card__svg" viewBox={viewBox} role="img" aria-label={title}>
      <g className="mindmap-home-card__edges">
        {layout.edges.map((edge) => {
          const from = nodeById.get(edge.from)
          const to = nodeById.get(edge.to)
          if (!from || !to) return null
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x + from.width / 2}
              y1={from.y + from.height / 2}
              x2={to.x + to.width / 2}
              y2={to.y + to.height / 2}
              stroke={branchColorForKey(preview.theme, edge.branchKey) ?? '#6b82ee'}
              strokeWidth={Math.max(1.5, 3 - edge.branchIndex * 0.25)}
              strokeLinecap="round"
            />
          )
        })}
      </g>
      {nodes.map((node) => {
        const fill = node.depth === 1 ? branchColorForKey(preview.theme, node.branchKey) ?? '#3157dd' : node.depth === 0 ? '#fff' : '#f5f5f7'
        const text = node.depth === 1 ? '#fff' : node.depth === 0 ? '#2854d8' : '#343434'
        return (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={Math.min(10, node.height / 2)}
              fill={fill}
              stroke={node.depth === 0 ? '#438eff' : 'none'}
              strokeWidth={node.depth === 0 ? 1.5 : 0}
            />
            <text
              x={node.x + node.width / 2}
              y={node.y + node.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill={text}
              fontSize={node.depth === 0 ? 18 : node.depth === 1 ? 12 : 9}
              fontWeight={node.depth < 2 ? 600 : 500}
            >
              {node.title || ' '}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
