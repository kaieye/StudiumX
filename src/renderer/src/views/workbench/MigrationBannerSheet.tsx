/**
 * V1 → canonical migration banner / confirm sheet (cutover B UX).
 * Confirm only; host runs dry-run + import_migration_commit.
 */

import { HardDriveDownload, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { MigrationBannerModel } from '../../study-space/planning-migration-banner'

export type MigrationBannerSheetResult =
  | { choice: 'confirm' }
  | { choice: 'dismiss' }
  | { choice: 'later' }

export type MigrationBannerSheetProps = {
  open: boolean
  model: MigrationBannerModel | null
  busy?: boolean
  errorMessage?: string | null
  onResolve: (result: MigrationBannerSheetResult) => void
}

export function MigrationBannerSheet({
  open,
  model,
  busy = false,
  errorMessage = null,
  onResolve
}: MigrationBannerSheetProps) {
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
      className="workbench-empty-start-backdrop workbench-migration-banner-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onResolve({ choice: 'later' })
      }}
    >
      <section
        ref={(node) => {
          dialogRef.current = node
        }}
        className="workbench-empty-start-sheet workbench-migration-banner-sheet"
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
              <HardDriveDownload size={15} aria-hidden="true" /> {model.copy.eyebrow}
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

        <ul className="workbench-migration-banner-list" aria-label="迁移摘要">
          <li className="workbench-migration-banner-row">
            <span className="workbench-migration-banner-label">任务</span>
            <span className="workbench-migration-banner-value">{model.summary.taskCount}</span>
          </li>
          <li className="workbench-migration-banner-row">
            <span className="workbench-migration-banner-label">日程块</span>
            <span className="workbench-migration-banner-value">{model.summary.scheduleBlockCount}</span>
          </li>
          <li className="workbench-migration-banner-row">
            <span className="workbench-migration-banner-label">计时方案</span>
            <span className="workbench-migration-banner-value">{model.summary.timerPlanCount}</span>
          </li>
          {model.summary.suggestedWindowCount > 0 ? (
            <li className="workbench-migration-banner-row is-hint">
              <span className="workbench-migration-banner-label">模拟时段（仅建议）</span>
              <span className="workbench-migration-banner-value">
                {model.summary.suggestedWindowCount}
              </span>
            </li>
          ) : null}
        </ul>

        <p className="workbench-empty-start-sheet__hint">
          写入工作区文件为唯一权威；localStorage 源数据不会自动删除（≥30 天或手动清除）。
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
