/**
 * Stale-session reconcile sheet (STC-206 remainder / freeze #5).
 * When TimerSession gap > 120 min: confirm_all / truncate / discard / later.
 * Escape / dismiss → later (keeps needs_reconcile; no silent credit).
 */

import { AlertTriangle, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef } from 'react'
import {
  buildReconcileSheetModel,
  type ReconcileSheetAction,
  type TimerSessionRecord
} from '../../../../shared/study-planning'

export type ReconcileSheetResult =
  | { action: 'confirm_all' }
  | { action: 'truncate_to_target' }
  | { action: 'discard_gap' }
  | { action: 'later' }

export type ReconcileSheetProps = {
  open: boolean
  session: Pick<
    TimerSessionRecord,
    | 'id'
    | 'state'
    | 'phase'
    | 'clockMode'
    | 'pendingReconcileSeconds'
    | 'accumulatedActiveSeconds'
    | 'targetSeconds'
  > | null
  /** Optional override when event gap differs from pending (tests). */
  gapSeconds?: number
  onResolve: (result: ReconcileSheetResult) => void
}

export function ReconcileSheet({ open, session, gapSeconds, onResolve }: ReconcileSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const model = useMemo(() => {
    if (!session) {
      return buildReconcileSheetModel({
        session: {
          id: 'pending',
          state: 'needs_reconcile',
          phase: 'focus',
          clockMode: 'countdown',
          pendingReconcileSeconds: gapSeconds ?? 0,
          accumulatedActiveSeconds: 0,
          targetSeconds: 25 * 60
        },
        ...(gapSeconds !== undefined ? { gapSeconds } : {})
      })
    }
    return buildReconcileSheetModel({
      session,
      ...(gapSeconds !== undefined ? { gapSeconds } : {})
    })
  }, [session, gapSeconds])

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

  const resolve = (action: ReconcileSheetAction): void => {
    if (action === 'confirm_all') onResolve({ action: 'confirm_all' })
    else if (action === 'truncate_to_target') onResolve({ action: 'truncate_to_target' })
    else if (action === 'discard_gap') onResolve({ action: 'discard_gap' })
    else onResolve({ action: 'later' })
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
        className="workbench-empty-start-sheet workbench-reconcile-sheet"
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
              <AlertTriangle size={15} aria-hidden="true" /> 中断
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

        <div className="workbench-empty-start-sheet__actions" role="group" aria-label="中断处理选项">
          <button
            type="button"
            className="workbench-empty-start-sheet__action is-recommended"
            onClick={() => resolve('confirm_all')}
          >
            <strong>{model.copy.confirmAllLabel}</strong>
            <small>{model.copy.confirmAllDetail}</small>
          </button>
          <button
            type="button"
            className="workbench-empty-start-sheet__action"
            onClick={() => resolve('truncate_to_target')}
          >
            <strong>{model.copy.truncateLabel}</strong>
            <small>{model.copy.truncateDetail}</small>
          </button>
          <button
            type="button"
            className="workbench-empty-start-sheet__action"
            onClick={() => resolve('discard_gap')}
          >
            <strong>{model.copy.discardLabel}</strong>
            <small>{model.copy.discardDetail}</small>
          </button>
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
