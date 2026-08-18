import { Plus, Search, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  MindMapCardPreview,
  MindMapSummary
} from '../../../../shared/mindmap/mind-map-types'
import {
  MindMapHomeCardMenu,
  type MindMapHomeCardMenuState
} from './MindMapHomeCardMenu'
import { MindMapPreview } from './mind-map-preview-render'

type MindMapHomeGalleryProps = {
  documents: readonly MindMapSummary[]
  workspaceId: string
  creating: boolean
  createError: string | null
  onCreate: () => void | Promise<void>
  onOpenDocument: (id: string) => void | Promise<void>
  onRenameDocument: (id: string, title: string) => void | Promise<void>
  onDeleteDocument: (id: string) => void | Promise<void>
  onCopyDocument: (id: string, title: string) => void | Promise<void>
}

/**
 * Legacy gallery surface shown while no map is open. Card previews come from
 * the list projection and never mutate the editor's currently-open document.
 */
export function MindMapHomeGallery({
  documents,
  workspaceId: _workspaceId,
  creating,
  createError,
  onCreate,
  onOpenDocument,
  onRenameDocument,
  onDeleteDocument,
  onCopyDocument
}: MindMapHomeGalleryProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [cardMenu, setCardMenu] = useState<MindMapHomeCardMenuState>(null)
  const [renamingDocument, setRenamingDocument] = useState<MindMapSummary | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renamingDocumentIdRef = useRef<string | null>(null)
  const committingRenameIdsRef = useRef(new Set<string>())

  const visibleDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return documents
    return documents.filter((summary) =>
      (summary.title || t('mindmap.newDocument')).toLocaleLowerCase().includes(normalizedQuery)
    )
  }, [documents, query, t])

  const previews = useMemo<Record<string, MindMapCardPreview>>(
    () => Object.fromEntries(
      documents.flatMap((summary) => summary.preview ? [[summary.id, summary.preview] as const] : [])
    ),
    [documents]
  )

  const startRename = (summary: MindMapSummary): void => {
    setCardMenu(null)
    renamingDocumentIdRef.current = summary.id
    setRenamingDocument(summary)
    setRenameDraft(summary.title || t('mindmap.newDocument'))
  }

  const cancelRename = (id?: string): void => {
    if (id && renamingDocumentIdRef.current !== id) return
    renamingDocumentIdRef.current = null
    setRenamingDocument(null)
    setRenameDraft('')
  }

  const commitRename = async (): Promise<void> => {
    const target = renamingDocument
    if (!target || committingRenameIdsRef.current.has(target.id)) return

    const title = renameDraft.trim()
    if (!title || title === (target.title || t('mindmap.newDocument'))) {
      cancelRename(target.id)
      return
    }

    committingRenameIdsRef.current.add(target.id)
    try {
      await onRenameDocument(target.id, title)
    } finally {
      committingRenameIdsRef.current.delete(target.id)
      // A user can start editing another card while this file update completes.
      // Do not close that newer edit when this older save settles.
      cancelRename(target.id)
    }
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
      <div className="mindmap-home__grid">
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

        {visibleDocuments.map((summary) => {
          const title = summary.title || t('mindmap.newDocument')
          const isRenaming = renamingDocument?.id === summary.id
          return (
            <article
              className={`mindmap-home-card${isRenaming ? ' mindmap-home-card--renaming' : ''}`}
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
                {isRenaming ? (
                  <input
                    autoFocus
                    className="mindmap-home-card__title-input"
                    value={renameDraft}
                    placeholder={t('mindmap.enterTitle')}
                    onChange={(event) => setRenameDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRename(summary.id)
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      }
                    }}
                    onBlur={() => void commitRename()}
                    aria-label={t('mindmap.renameDocument')}
                  />
                ) : (
                  <button
                    type="button"
                    className="mindmap-home-card__title mindmap-home-card__title-button"
                    onClick={() => startRename(summary)}
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
