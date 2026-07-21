/**
 * Future-blocks decision sheet (STC-306 / freeze #7).
 * Shown after complete when durable store reports future_blocks_need_decision.
 */

import { CalendarRange, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef } from 'react'
import {
  buildFutureBlocksDecisionSheetModel,
  type FutureBlocksDecisionChoice
} from '../../../../shared/study-planning'

export type FutureBlocksDecisionSheetResult =
  | { choice: FutureBlocksDecisionChoice; reassignTaskId?: string }
  | { choice: 'dismiss' }

export type FutureBlocksDecisionSheetProps = {
  open: boolean
  taskId: string
  taskTitle: string
  futureBlockIds: readonly string[]
  /** Open tasks available for reassign (excluding completed task). */
  reassignCandidates?: readonly { id: string; title: string }[]
  onResolve: (result: FutureBlocksDecisionSheetResult) => void
}

export function FutureBlocksDecisionSheet({
  open,
  taskId,
  taskTitle,
  futureBlockIds,
  reassignCandidates = [],
  onResolve
}: FutureBlocksDecisionSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const model = useMemo(
    () =>
      buildFutureBlocksDecisionSheetModel({
        taskId,
        taskTitle,
        futureBlockIds
      }),
    [taskId, taskTitle, futureBlockIds]
  )

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onResolve({ choice: 'dismiss' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onResolve])

  if (!open) return null

  return (
    <div
      className="workbench-empty-start-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve({ choice: 'dismiss' })
      }}
    >
      <section
        ref={(node) => {
          dialogRef.current = node
        }}
        className="workbench-empty-start-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="workbench-empty-start-header">
          <div className="workbench-empty-start-heading">
            <CalendarRange size={18} aria-hidden />
            <h2 id={titleId}>{model.copy.title}</h2>
          </div>
          <button
            type="button"
            className="workbench-empty-start-icon-btn"
            aria-label={model.copy.dismissLabel}
            onClick={() => onResolve({ choice: 'dismiss' })}
          >
            <X size={16} />
          </button>
        </header>
        <p id={descriptionId} className="workbench-empty-start-description">
          {model.copy.description}
        </p>
        <div className="workbench-empty-start-actions">
          <button
            type="button"
            className="workbench-empty-start-primary"
            onClick={() => onResolve({ choice: 'cancel_blocks' })}
          >
            {model.copy.cancelBlocksLabel}
          </button>
          <button
            type="button"
            className="workbench-empty-start-secondary"
            onClick={() => onResolve({ choice: 'keep_as_review' })}
          >
            {model.copy.keepReviewLabel}
          </button>
          {reassignCandidates.length > 0 ? (
            <button
              type="button"
              className="workbench-empty-start-secondary"
              onClick={() =>
                onResolve({
                  choice: 'reassign',
                  reassignTaskId: reassignCandidates[0]?.id
                })
              }
            >
              {model.copy.reassignLabel}
              {reassignCandidates[0] ? ` → ${reassignCandidates[0].title}` : ''}
            </button>
          ) : null}
          <button
            type="button"
            className="workbench-empty-start-ghost"
            onClick={() => onResolve({ choice: 'dismiss' })}
          >
            {model.copy.dismissLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
