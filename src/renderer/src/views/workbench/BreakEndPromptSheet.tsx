/**
 * Break-end prompt sheet (STC-205 remainder / §10.3).
 * After rest countdown completes: start next focus / wrap_up / later.
 * Escape / dismiss → later (does not auto-start focus).
 */

import { Flag, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef } from 'react'
import {
  buildBreakEndPromptSheetModel,
  type TimerSessionRecord
} from '../../../../shared/study-planning'

export type BreakEndPromptSheetResult =
  | { action: 'start_focus' }
  | { action: 'wrap_up' }
  | { action: 'later' }

export type BreakEndPromptSheetProps = {
  open: boolean
  /** Completed break segment (planSnapshot + focusRound). */
  completed: Pick<
    TimerSessionRecord,
    'planSnapshot' | 'focusRoundInPlan' | 'phase' | 'state'
  > | null
  onResolve: (result: BreakEndPromptSheetResult) => void
}

export function BreakEndPromptSheet({ open, completed, onResolve }: BreakEndPromptSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const model = useMemo(() => {
    if (!completed) {
      return buildBreakEndPromptSheetModel({
        completed: {
          planSnapshot: null,
          focusRoundInPlan: 1,
          phase: 'short_break',
          state: 'completed'
        }
      })
    }
    return buildBreakEndPromptSheetModel({ completed })
  }, [completed])

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
        className="workbench-empty-start-sheet workbench-break-end-prompt-sheet"
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
              <Flag size={15} aria-hidden="true" /> 下一段
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

        <div className="workbench-empty-start-sheet__actions" role="group" aria-label="休息结束后选项">
          <button
            type="button"
            className="workbench-empty-start-sheet__action is-recommended"
            onClick={() => onResolve({ action: 'start_focus' })}
          >
            <strong>{model.copy.startFocusLabel}</strong>
            <small>{model.copy.startFocusDetail}</small>
          </button>
          {model.offerWrapUp ? (
            <button
              type="button"
              className="workbench-empty-start-sheet__action"
              onClick={() => onResolve({ action: 'wrap_up' })}
            >
              <strong>{model.copy.wrapUpLabel}</strong>
              <small>{model.copy.wrapUpDetail}</small>
            </button>
          ) : null}
          <button
            type="button"
            className="workbench-empty-start-sheet__cancel"
            onClick={() => onResolve({ action: 'later' })}
          >
            {model.copy.laterLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
