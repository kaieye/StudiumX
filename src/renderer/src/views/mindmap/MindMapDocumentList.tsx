import { Trash2 } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapSummary } from '../../../../shared/mindmap/mind-map-types'

type MindMapDocumentListProps = {
  documents: readonly MindMapSummary[]
  currentDocumentId: string | null
  onOpenDocument: (id: string) => void | Promise<void>
  onDeleteDocument: (id: string) => void | Promise<void>
}

/**
 * Keyboard-friendly document switcher for the mind-map sidebar.
 *
 * Documents use a roving tab stop so the sidebar does not add every map to the
 * page tab order. Arrow keys move through the list and activate the document;
 * Enter/Space retain native button activation semantics. Delete is a sibling
 * action rather than a nested button, keeping the document control valid and
 * predictable for assistive technology.
 */
export function MindMapDocumentList({
  documents,
  currentDocumentId,
  onOpenDocument,
  onDeleteDocument
}: MindMapDocumentListProps) {
  const { t } = useTranslation()
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const currentIndex = documents.findIndex((document) => document.id === currentDocumentId)
  const activeIndex = currentIndex >= 0 ? currentIndex : 0

  const focusDocument = (index: number): void => {
    const document = documents[index]
    if (!document) return
    void onOpenDocument(document.id)
    itemRefs.current[document.id]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % documents.length
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + documents.length) % documents.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = documents.length - 1
    }

    if (nextIndex === null || documents.length === 0 || nextIndex === index) return
    event.preventDefault()
    focusDocument(nextIndex)
  }

  return (
    <div className="mindmap-list__body" role="list" aria-label={t('mindmap.documentList')}>
      {documents.length === 0 ? (
        <div className="mindmap-list__empty">{t('mindmap.emptyState')}</div>
      ) : (
        documents.map((document, index) => {
          const isCurrent = currentDocumentId === document.id
          const title = document.title || t('mindmap.newDocument')
          return (
            <div key={document.id} className="mindmap-list__item-row" role="listitem">
              <button
                ref={(element) => {
                  itemRefs.current[document.id] = element
                }}
                type="button"
                className={`mindmap-list__item${isCurrent ? ' is-active' : ''}`}
                aria-label={`${title}, ${document.sheetCount} ${t('mindmap.layout')}`}
                aria-pressed={isCurrent}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => void onOpenDocument(document.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <span className="mindmap-list__item-title">{title}</span>
                <span className="mindmap-list__item-meta">
                  {document.sheetCount} {t('mindmap.layout')}
                </span>
              </button>
              <button
                type="button"
                className="icon-button mindmap-list__item-delete"
                aria-label={`${t('mindmap.deleteDocument')}: ${title}`}
                title={t('mindmap.deleteDocument')}
                onClick={() => void onDeleteDocument(document.id)}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
