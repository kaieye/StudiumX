import { ChevronLeft, ChevronRight, Copy, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { MindMapDocumentV2 } from '../../../../shared/mindmap/domain/types'

/** Sheet lifecycle bar: switch / rename / copy / reorder / delete. */
type MindMapSheetTabsProps = {
  document: MindMapDocumentV2
  activeSheetId: string | null
  onActivate: (sheetId: string) => void
  onRename: (sheetId: string, title: string) => void
  onDuplicate: (sheetId: string) => void
  onRemove: (sheetId: string) => void
  onReorder: (sheetId: string, toIndex: number) => void
}

export function MindMapSheetTabs({
  document,
  activeSheetId,
  onActivate,
  onRename,
  onDuplicate,
  onRemove,
  onReorder
}: MindMapSheetTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const beginRename = (sheetId: string, title: string): void => {
    setRenamingId(sheetId)
    setDraft(title)
  }

  const commitRename = (sheetId: string): void => {
    const title = draft.trim()
    setRenamingId(null)
    if (title) onRename(sheetId, title)
  }

  const focusSheet = (index: number): void => {
    const sheet = document.sheets[index]
    if (!sheet) return
    onActivate(sheet.id)
    globalThis.document.getElementById(sheetTabId(sheet.id))?.focus()
  }

  return (
    <div
      className="mindmap-sheet-tabs"
      role="tablist"
      aria-label="Sheets"
      aria-orientation="horizontal"
    >
      {document.sheets.map((sheet, index) => {
        const isActive = sheet.id === activeSheetId
        const canRemove = document.sheets.length > 1
        return (
          <div
            key={sheet.id}
            className={`mindmap-sheet-tab-wrap${isActive ? ' is-active' : ''}`}
          >
            {isActive && index > 0 ? (
              <button
                type="button"
                className="icon-button mindmap-sheet-tab-move"
                title="Move sheet left"
                aria-label="Move sheet left"
                onClick={() => onReorder(sheet.id, index - 1)}
              >
                <ChevronLeft size={13} />
              </button>
            ) : null}
            {renamingId === sheet.id ? (
              <form
                className="mindmap-sheet-tab-rename"
                onSubmit={(event) => {
                  event.preventDefault()
                  commitRename(sheet.id)
                }}
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setRenamingId(null)
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
                <button type="submit" className="icon-button" aria-label="Save sheet name">
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Cancel sheet rename"
                  onClick={() => setRenamingId(null)}
                >
                  <X size={12} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                role="tab"
                id={sheetTabId(sheet.id)}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`mindmap-sheet-tab${isActive ? ' is-active' : ''}`}
                onClick={() => onActivate(sheet.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    focusSheet((index + 1) % document.sheets.length)
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    focusSheet((index - 1 + document.sheets.length) % document.sheets.length)
                  } else if (event.key === 'Home') {
                    event.preventDefault()
                    focusSheet(0)
                  } else if (event.key === 'End') {
                    event.preventDefault()
                    focusSheet(document.sheets.length - 1)
                  }
                }}
              >
                {sheet.title}
              </button>
            )}
            {isActive && renamingId !== sheet.id ? (
              <>
                <button
                  type="button"
                  className="icon-button mindmap-sheet-tab-action"
                  title="Rename sheet"
                  aria-label={`Rename sheet ${sheet.title}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    beginRename(sheet.id, sheet.title)
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="icon-button mindmap-sheet-tab-action"
                  title="Duplicate sheet"
                  aria-label={`Duplicate sheet ${sheet.title}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onDuplicate(sheet.id)
                  }}
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  className="icon-button mindmap-sheet-tab-action mindmap-sheet-tab-action--danger"
                  title="Delete sheet"
                  aria-label={`Delete sheet ${sheet.title}`}
                  disabled={!canRemove}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (canRemove) onRemove(sheet.id)
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </>
            ) : null}
            {isActive && index < document.sheets.length - 1 ? (
              <button
                type="button"
                className="icon-button mindmap-sheet-tab-move"
                title="Move sheet right"
                aria-label="Move sheet right"
                onClick={() => onReorder(sheet.id, index + 1)}
              >
                <ChevronRight size={13} />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function sheetTabId(sheetId: string): string {
  return `mindmap-sheet-tab-${sheetId}`
}
