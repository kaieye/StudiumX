import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapDocumentV2 } from '../../../../shared/mindmap/domain/types'
import { MindMapSheetMenu, type MindMapSheetMenuState } from './MindMapSheetMenu'

/** Compact sheet strip: switch with the keyboard, rename on click, manage by context menu. */
type MindMapSheetTabsProps = {
  document: MindMapDocumentV2
  activeSheetId: string | null
  onActivate: (sheetId: string) => void
  onRename: (sheetId: string, title: string) => void
  onDuplicate: (sheetId: string) => void
  onRemove: (sheetId: string) => void
}

export function MindMapSheetTabs({
  document,
  activeSheetId,
  onActivate,
  onRename,
  onDuplicate,
  onRemove
}: MindMapSheetTabsProps) {
  const { t } = useTranslation()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sheetMenu, setSheetMenu] = useState<MindMapSheetMenuState>(null)

  useEffect(() => {
    if (renamingId && !document.sheets.some((sheet) => sheet.id === renamingId)) {
      setRenamingId(null)
    }
    if (sheetMenu && !document.sheets.some((sheet) => sheet.id === sheetMenu.sheetId)) {
      setSheetMenu(null)
    }
  }, [document.sheets, renamingId, sheetMenu])

  const beginRename = (sheetId: string, title: string): void => {
    setSheetMenu(null)
    onActivate(sheetId)
    setRenamingId(sheetId)
    setDraft(title)
  }

  /** Switch to the sheet; only rename when it is already the active sheet. */
  const handleTabClick = (sheet: MindMapDocumentV2['sheets'][number], isActive: boolean): void => {
    if (isActive) {
      beginRename(sheet.id, sheet.title)
    } else {
      onActivate(sheet.id)
    }
  }

  const cancelRename = (): void => {
    setRenamingId(null)
    setDraft('')
  }

  const commitRename = (sheetId: string, previousTitle: string): void => {
    const title = draft.trim()
    setRenamingId(null)
    setDraft('')
    if (title && title !== previousTitle) onRename(sheetId, title)
  }

  const focusSheet = (index: number): void => {
    const sheet = document.sheets[index]
    if (!sheet) return
    onActivate(sheet.id)
    globalThis.document.getElementById(sheetTabId(sheet.id))?.focus()
  }

  return (
    <>
      <div
        className="mindmap-sheet-tabs"
        role="tablist"
        aria-label={t('mindmap.sheets')}
        aria-orientation="horizontal"
      >
        {document.sheets.map((sheet, index) => {
          const isActive = sheet.id === activeSheetId
          return (
            <div
              key={sheet.id}
              className={`mindmap-sheet-tab-wrap${isActive ? ' is-active' : ''}`}
            >
              {renamingId === sheet.id ? (
                <form
                  className="mindmap-sheet-tab-rename"
                  onSubmit={(event) => {
                    event.preventDefault()
                    commitRename(sheet.id, sheet.title)
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    onBlur={() => commitRename(sheet.id, sheet.title)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRename()
                      }
                    }}
                    aria-label={t('mindmap.renameSheet', { title: sheet.title })}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  role="tab"
                  id={sheetTabId(sheet.id)}
                  aria-selected={isActive}
                  aria-haspopup="menu"
                  tabIndex={isActive ? 0 : -1}
                  className={`mindmap-sheet-tab${isActive ? ' is-active' : ''}`}
                  title={t('mindmap.renameSheet', { title: sheet.title })}
                  onClick={() => handleTabClick(sheet, isActive)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setSheetMenu({
                      sheetId: sheet.id,
                      title: sheet.title,
                      x: event.clientX,
                      y: event.clientY
                    })
                  }}
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
                    } else if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleTabClick(sheet, isActive)
                    } else if (
                      event.key === 'ContextMenu' ||
                      (event.shiftKey && event.key === 'F10')
                    ) {
                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      setSheetMenu({
                        sheetId: sheet.id,
                        title: sheet.title,
                        x: rect.left,
                        y: rect.bottom
                      })
                    }
                  }}
                >
                  {sheet.title}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <MindMapSheetMenu
        state={sheetMenu}
        canRemove={document.sheets.length > 1}
        onClose={() => setSheetMenu(null)}
        onRename={(sheetId) => {
          const sheet = document.sheets.find((candidate) => candidate.id === sheetId)
          if (sheet) beginRename(sheet.id, sheet.title)
        }}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  )
}

function sheetTabId(sheetId: string): string {
  return `mindmap-sheet-tab-${sheetId}`
}
