/**
 * V1 dual-authority demote confirm sheet (ADR-0129 / 0130 §5.1).
 * Separate from MigrationBannerSheet — erase only after explicit confirm + backup.
 */

import { Archive, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { V1DemoteBannerModel } from '../../study-space/planning-v1-authority-demote'

export type V1AuthorityDemoteSheetResult =
  | { choice: 'confirm' }
  | { choice: 'dismiss' }
  | { choice: 'later' }

export type V1AuthorityDemoteSheetProps = {
  open: boolean
  model: V1DemoteBannerModel | null
  busy?: boolean
  errorMessage?: string | null
  onResolve: (result: V1AuthorityDemoteSheetResult) => void
}

export function V1AuthorityDemoteSheet({
  open,
  model,
  busy = false,
  errorMessage = null,
  onResolve
}: V1AuthorityDemoteSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busy) onResolve({ choice: 'later' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onResolve])

  if (!open || !model) return null

  return (
    <div
      className="workbench-empty-start-backdrop workbench-v1-demote-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onResolve({ choice: 'later' })
      }}
    >
      <section
        ref={(node) => {
          dialogRef.current = node
        }}
        className="workbench-empty-start-sheet workbench-v1-demote-sheet"
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
              <Archive size={15} aria-hidden="true" /> {model.copy.eyebrow}
            </span>
            <h2 id={titleId}>{model.copy.title}</h2>
            <p id={descriptionId}>{model.copy.description}</p>
            <p className="workbench-migration-banner-meta">{model.copy.metaLine}</p>
          </div>
          <button
            type="button"
            className="workbench-empty-start-sheet__close"
            onClick={() => onResolve({ choice: 'later' })}
            aria-label={model.copy.laterLabel}
            title={model.copy.laterLabel}
            disabled={busy}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <ul className="workbench-migration-banner-list" aria-label="本地权威缓存摘要">
          <li className="workbench-migration-banner-row">
            <span className="workbench-migration-banner-label">任务缓存</span>
            <span className="workbench-migration-banner-value">{model.summary.taskCount}</span>
          </li>
          <li className="workbench-migration-banner-row">
            <span className="workbench-migration-banner-label">计时方案</span>
            <span className="workbench-migration-banner-value">{model.summary.timerPlanCount}</span>
          </li>
          <li className="workbench-migration-banner-row">
            <span className="workbench-migration-banner-label">分类缓存</span>
            <span className="workbench-migration-banner-value">{model.summary.categoryCount}</span>
          </li>
        </ul>

        <p className="workbench-empty-start-sheet__hint">{model.copy.backupHint}</p>
        <p className="workbench-empty-start-sheet__hint">
          此操作与「迁移到工作区」分开；迁移成功后不会自动擦除 localStorage。
        </p>

        {errorMessage ? (
          <p className="workbench-migration-banner-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {busy ? (
          <p className="workbench-migration-banner-busy" aria-live="polite">
            {model.copy.busyLabel}
          </p>
        ) : null}

        <footer className="workbench-empty-start-sheet__footer">
          <button
            type="button"
            className="workbench-empty-start-sheet__secondary"
            onClick={() => onResolve({ choice: 'dismiss' })}
            disabled={busy}
          >
            {model.copy.dismissLabel}
          </button>
          <button
            type="button"
            className="workbench-empty-start-sheet__primary"
            onClick={() => onResolve({ choice: 'confirm' })}
            disabled={busy || !model.canConfirm}
          >
            {model.copy.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
