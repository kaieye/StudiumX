/**
 * Batch classify sheet (STC-408).
 * One category for many inbox tasks; Escape / cancel dismiss without write.
 */

import { Tags, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  buildBatchClassifySheetModel,
  resolveClassificationCategoryId,
  type ClassificationPromptCategory
} from '../../../../shared/study-planning'

export type BatchClassifySheetResult =
  | { action: 'classify'; categoryId: string; taskIds: string[] }
  | { action: 'cancel' }

export type BatchClassifySheetProps = {
  open: boolean
  tasks: readonly { id: string; title: string }[]
  taskIds: readonly string[]
  categories: readonly ClassificationPromptCategory[]
  onResolve: (result: BatchClassifySheetResult) => void
}

export function BatchClassifySheet({
  open,
  tasks,
  taskIds,
  categories,
  onResolve
}: BatchClassifySheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const model = useMemo(
    () =>
      buildBatchClassifySheetModel({
        tasks,
        taskIds,
        categories
      }),
    [tasks, taskIds, categories]
  )
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedCategoryId(null)
  }, [open, taskIds])

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onResolve({ action: 'cancel' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onResolve])

  if (!open) return null

  const submit = (): void => {
    const id = resolveClassificationCategoryId(model.categories, selectedCategoryId)
    if (!id || model.taskIds.length === 0) return
    onResolve({ action: 'classify', categoryId: id, taskIds: model.taskIds.slice() })
  }

  return (
    <div
      className="workbench-empty-start-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve({ action: 'cancel' })
      }}
    >
      <section
        ref={(node) => {
          dialogRef.current = node
        }}
        className="workbench-empty-start-sheet workbench-batch-classify-sheet"
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
              <Tags size={15} aria-hidden="true" /> 批量归类
            </span>
            <h2 id={titleId}>{model.copy.title}</h2>
            <p id={descriptionId}>{model.copy.description}</p>
          </div>
          <button
            type="button"
            className="workbench-empty-start-sheet__close"
            aria-label={model.copy.cancelLabel}
            title={model.copy.cancelLabel}
            onClick={() => onResolve({ action: 'cancel' })}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {model.selectedCount === 0 ? (
          <p className="workbench-empty-start-sheet__hint">{model.copy.emptyTasksHint}</p>
        ) : (
          <ul className="workbench-batch-classify-task-preview" aria-label="待归类任务">
            {model.tasks.slice(0, 8).map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
            {model.tasks.length > 8 ? (
              <li className="workbench-batch-classify-task-preview__more">
                另有 {model.tasks.length - 8} 项…
              </li>
            ) : null}
          </ul>
        )}

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
            onClick={() => onResolve({ action: 'cancel' })}
          >
            {model.copy.cancelLabel}
          </button>
          <button
            type="button"
            className="workbench-empty-start-sheet__primary"
            disabled={
              model.selectedCount === 0 ||
              !resolveClassificationCategoryId(model.categories, selectedCategoryId)
            }
            onClick={submit}
          >
            {model.copy.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
