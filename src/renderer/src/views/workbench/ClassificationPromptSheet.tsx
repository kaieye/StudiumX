/**
 * Classification prompt sheet (STC-406/407).
 * Non-blocking after complete of an inbox task.
 * Escape / dismiss → later (never rolls back completion).
 */

import { Tags, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  buildClassificationPromptSheetModel,
  resolveClassificationCategoryId,
  type ClassificationPromptCategory
} from '../../../../shared/study-planning'

export type ClassificationPromptSheetResult =
  | { action: 'classify'; categoryId: string }
  | { action: 'keep_inbox' }
  | { action: 'later' }
  | { action: 'never_prompt' }

export type ClassificationPromptSheetProps = {
  open: boolean
  taskId: string
  taskTitle: string
  categories: readonly ClassificationPromptCategory[]
  onResolve: (result: ClassificationPromptSheetResult) => void
}

export function ClassificationPromptSheet({
  open,
  taskId,
  taskTitle,
  categories,
  onResolve
}: ClassificationPromptSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const model = useMemo(
    () =>
      buildClassificationPromptSheetModel({
        taskId,
        taskTitle,
        categories
      }),
    [taskId, taskTitle, categories]
  )
  const [mode, setMode] = useState<'menu' | 'pick'>('menu')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('menu')
    setSelectedCategoryId(null)
  }, [open, taskId])

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onResolve({ action: 'later' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onResolve])

  if (!open) return null

  const submitClassify = (): void => {
    const id = resolveClassificationCategoryId(model.categories, selectedCategoryId)
    if (!id) return
    onResolve({ action: 'classify', categoryId: id })
  }

  return (
    <div
      className="workbench-empty-start-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve({ action: 'later' })
      }}
    >
      <section
        ref={(node) => {
          dialogRef.current = node
        }}
        className="workbench-empty-start-sheet workbench-classification-prompt-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="workbench-empty-start-sheet__header">
          <div>
            <span className="workbench-empty-start-sheet__eyebrow">
              <Tags size={15} aria-hidden="true" /> 归类
            </span>
            <h2 id={titleId}>{model.copy.title}</h2>
            <p id={descriptionId}>{model.copy.description}</p>
          </div>
          <button
            type="button"
            className="workbench-empty-start-sheet__close"
            aria-label={model.copy.laterLabel}
            title={model.copy.laterLabel}
            onClick={() => onResolve({ action: 'later' })}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {mode === 'menu' ? (
          <div className="workbench-empty-start-sheet__actions" role="group" aria-label="归类选项">
            <button
              type="button"
              className="workbench-empty-start-sheet__action is-recommended"
              onClick={() => setMode('pick')}
            >
              <strong>{model.copy.classifyLabel}</strong>
              <small>为已完成任务选择类别，移出收件箱。</small>
            </button>
            <button
              type="button"
              className="workbench-empty-start-sheet__action"
              onClick={() => onResolve({ action: 'keep_inbox' })}
            >
              <strong>{model.copy.keepInboxLabel}</strong>
              <small>继续留在收件箱，可稍后批量归类。</small>
            </button>
            <button
              type="button"
              className="workbench-empty-start-sheet__action"
              onClick={() => onResolve({ action: 'never_prompt' })}
            >
              <strong>{model.copy.neverPromptLabel}</strong>
              <small>写入偏好：完成后不再弹出归类提示。</small>
            </button>
            <button
              type="button"
              className="workbench-empty-start-sheet__cancel"
              onClick={() => onResolve({ action: 'later' })}
            >
              {model.copy.laterLabel}
            </button>
          </div>
        ) : (
          <div className="workbench-classification-prompt-pick">
            {model.categories.length === 0 ? (
              <p className="workbench-empty-start-sheet__hint">{model.copy.emptyCategoriesHint}</p>
            ) : (
              <ul
                className="workbench-empty-start-sheet__task-list"
                role="listbox"
                aria-label={model.copy.categoryListLabel}
              >
                {model.categories.map((category) => {
                  const selected = selectedCategoryId === category.id
                  return (
                    <li key={category.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`workbench-empty-start-sheet__task${selected ? ' is-selected' : ''}`}
                        onClick={() => setSelectedCategoryId(category.id)}
                        style={
                          category.color
                            ? ({ ['--task-category-color']: category.color } as Record<string, string>)
                            : undefined
                        }
                      >
                        {category.color ? (
                          <span
                            className="workbench-classification-prompt-swatch"
                            style={{ background: category.color }}
                            aria-hidden
                          />
                        ) : null}
                        {category.name}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="workbench-empty-start-sheet__footer">
              <button
                type="button"
                className="workbench-empty-start-sheet__secondary"
                onClick={() => {
                  setMode('menu')
                  setSelectedCategoryId(null)
                }}
              >
                {model.copy.backLabel}
              </button>
              <button
                type="button"
                className="workbench-empty-start-sheet__primary"
                disabled={!resolveClassificationCategoryId(model.categories, selectedCategoryId)}
                onClick={submitClassify}
              >
                {model.copy.confirmClassifyLabel}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
