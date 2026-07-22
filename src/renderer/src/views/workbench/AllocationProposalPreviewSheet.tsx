/**
 * Allocation proposal preview + confirm sheet (STC-308).
 * Shows allocateTimeWindow output; confirm only via host dual-write.
 */
import { CalendarClock, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { AllocationProposalPreviewModel } from '../../study-space/planning-allocation-proposal-ui'

export type AllocationProposalSheetResult =
  | { choice: 'confirm' }
  | { choice: 'cancel' }

export type AllocationProposalPreviewSheetProps = {
  open: boolean
  model: AllocationProposalPreviewModel | null
  busy?: boolean
  onResolve: (result: AllocationProposalSheetResult) => void
}

export function AllocationProposalPreviewSheet({
  open,
  model,
  busy = false,
  onResolve
}: AllocationProposalPreviewSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busy) onResolve({ choice: 'cancel' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onResolve])

  if (!open || !model) return null

  return (
    <div
      className="workbench-empty-start-backdrop workbench-allocation-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onResolve({ choice: 'cancel' })
      }}
    >
      <section
        ref={(node) => {
          dialogRef.current = node
        }}
        className="workbench-empty-start-sheet workbench-allocation-preview-sheet"
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
              <CalendarClock size={15} aria-hidden="true" /> 排程提案
            </span>
            <h2 id={titleId}>{model.copy.title}</h2>
            <p id={descriptionId}>{model.copy.description}</p>
            <p className="workbench-allocation-preview-meta">{model.copy.metaLine}</p>
          </div>
          <button
            type="button"
            className="workbench-empty-start-sheet__close"
            onClick={() => onResolve({ choice: 'cancel' })}
            aria-label={model.copy.cancelLabel}
            title={model.copy.cancelLabel}
            disabled={busy}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {model.rows.length === 0 ? (
          <p className="workbench-allocation-preview-empty">{model.copy.emptyLabel}</p>
        ) : (
          <ul className="workbench-allocation-preview-list" aria-label="提案时间块">
            {model.rows.map((row) => (
              <li
                key={row.key}
                className={`workbench-allocation-preview-row is-${row.change}${row.kind === 'blank' ? ' is-blank' : ''}`}
              >
                <span className="workbench-allocation-preview-kind">{row.kindLabel}</span>
                <span className="workbench-allocation-preview-time">{row.timeLabel}</span>
                <span className="workbench-allocation-preview-task">
                  {row.taskTitle ?? (row.kind === 'blank' ? '（不写入）' : '无任务')}
                </span>
                <span className="workbench-allocation-preview-badge">
                  {row.change === 'added' ? '新增' : row.kind === 'blank' ? '空档' : '保留'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {model.warnings.length > 0 ? (
          <div className="workbench-allocation-preview-warnings" role="note">
            <strong>{model.copy.warningsTitle}</strong>
            <ul>
              {model.warnings.slice(0, 6).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="workbench-empty-start-sheet__footer">
          <button
            type="button"
            className="workbench-empty-start-sheet__secondary"
            onClick={() => onResolve({ choice: 'cancel' })}
            disabled={busy}
          >
            {model.copy.cancelLabel}
          </button>
          <button
            type="button"
            className="workbench-empty-start-sheet__primary"
            disabled={!model.canConfirm || busy}
            onClick={() => onResolve({ choice: 'confirm' })}
          >
            {busy ? '写入中…' : model.copy.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
