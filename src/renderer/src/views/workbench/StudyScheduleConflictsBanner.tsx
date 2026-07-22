/**
 * Thin STC-707 week-plan conflict list banner.
 * Pure model lives in planning-schedule-conflicts-ui; host owns dismiss state.
 *
 * Product-signal (shipped default capability): when resolvePreview + onApplyResolve
 * are provided, always offer two-step "预览错开" → "确认应用".
 * Apply is disabled/hidden when preview empty or all targets locked.
 * Never auto-applies on mount or detect (silent auto-stagger forbidden).
 */

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type {
  ScheduleConflictResolvePreview,
  ScheduleConflictsBannerModel
} from '../../study-space/planning-schedule-conflicts-ui'
import type { ProposedBlockMove } from '../../../../shared/study-planning'

export type StudyScheduleConflictsBannerProps = {
  model: ScheduleConflictsBannerModel
  onDismiss: () => void
  /**
   * Open the week chip editor for one side of a conflict.
   * Prefer blockId so multi-block tasks target the overlapping row.
   */
  onOpenBlock?: (input: { taskId: string | null; blockId: string }) => void
  /**
   * Pure preview (ready/unavailable). Product-signal: host wires this whenever
   * conflicts + planning context exist (shipped default capability).
   * When absent, resolve CTA is hidden (list-only / no context path).
   */
  resolvePreview?: ScheduleConflictResolvePreview | null
  /**
   * Explicit user confirm → host applies unlocked moves with expectedRevision CAS.
   * Never called unless user clicked 确认应用 after 预览错开 (no silent apply).
   */
  onApplyResolve?: (moves: readonly ProposedBlockMove[]) => void | Promise<void>
  /** Optional busy flag while sequential upserts run. */
  resolveApplying?: boolean
}

export function StudyScheduleConflictsBanner({
  model,
  onDismiss,
  onOpenBlock,
  resolvePreview,
  onApplyResolve,
  resolveApplying = false
}: StudyScheduleConflictsBannerProps) {
  const [previewOpen, setPreviewOpen] = useState(false)

  if (model.kind !== 'conflicts' || model.conflictCount <= 0) return null

  const hasLocked = model.pairs.some((p) => p.aLocked || p.bLocked)
  const canPreview = Boolean(resolvePreview && onApplyResolve)
  const previewReady = resolvePreview?.kind === 'ready' && (resolvePreview.moves?.length ?? 0) > 0
  const summaries = resolvePreview?.moveSummaries ?? []

  const handlePreviewClick = (): void => {
    if (!canPreview) return
    setPreviewOpen(true)
  }

  const handleCancelPreview = (): void => {
    setPreviewOpen(false)
  }

  const handleConfirmApply = (): void => {
    if (!previewReady || !onApplyResolve || !resolvePreview?.moves?.length) return
    void Promise.resolve(onApplyResolve(resolvePreview.moves)).finally(() => {
      setPreviewOpen(false)
    })
  }

  return (
    <section
      className="study-schedule-conflicts-banner"
      role="region"
      aria-label={model.copy.eyebrow}
      data-conflict-count={model.conflictCount}
      data-resolve-preview={previewOpen ? 'open' : 'closed'}
    >
      <header className="study-schedule-conflicts-banner__header">
        <div className="study-schedule-conflicts-banner__title-row">
          <span className="study-schedule-conflicts-banner__eyebrow">
            <AlertTriangle size={15} aria-hidden="true" />
            {model.copy.eyebrow}
          </span>
          <button
            type="button"
            className="study-schedule-conflicts-banner__dismiss"
            onClick={onDismiss}
            aria-label={model.copy.dismissLabel}
            title={model.copy.dismissLabel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <h2 className="study-schedule-conflicts-banner__title">{model.copy.title}</h2>
        <p className="study-schedule-conflicts-banner__description">{model.copy.description}</p>
        {model.copy.resolveRespectNote ? (
          <p
            className="study-schedule-conflicts-banner__respect-note"
            data-testid="schedule-conflicts-respect-note"
          >
            {model.copy.resolveRespectNote}
          </p>
        ) : null}
        {hasLocked ? (
          <p className="study-schedule-conflicts-banner__locked-hint">{model.copy.lockedHint}</p>
        ) : null}
      </header>

      <ul className="study-schedule-conflicts-banner__list" aria-label="冲突列表">
        {model.pairs.map((pair) => {
          const openA = (): void => {
            onOpenBlock?.({ taskId: pair.aTaskId, blockId: pair.aId })
          }
          const openB = (): void => {
            onOpenBlock?.({ taskId: pair.bTaskId, blockId: pair.bId })
          }
          return (
            <li key={pair.pairKey} className="study-schedule-conflicts-banner__row">
              <button
                type="button"
                className="study-schedule-conflicts-banner__side"
                onClick={openA}
                disabled={!onOpenBlock || !pair.aTaskId}
                title={pair.aTitle}
              >
                <strong className="study-schedule-conflicts-banner__side-title">
                  {pair.aTitle}
                  {pair.aLocked ? ' · 锁定' : ''}
                </strong>
                <span className="study-schedule-conflicts-banner__side-time">{pair.aTimeLabel}</span>
              </button>
              <span className="study-schedule-conflicts-banner__vs" aria-hidden="true">
                重叠
              </span>
              <button
                type="button"
                className="study-schedule-conflicts-banner__side"
                onClick={openB}
                disabled={!onOpenBlock || !pair.bTaskId}
                title={pair.bTitle}
              >
                <strong className="study-schedule-conflicts-banner__side-title">
                  {pair.bTitle}
                  {pair.bLocked ? ' · 锁定' : ''}
                </strong>
                <span className="study-schedule-conflicts-banner__side-time">{pair.bTimeLabel}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {model.copy.moreLabel ? (
        <p className="study-schedule-conflicts-banner__more">{model.copy.moreLabel}</p>
      ) : null}

      {canPreview ? (
        <div className="study-schedule-conflicts-banner__resolve">
          {!previewOpen ? (
            <button
              type="button"
              className="study-schedule-conflicts-banner__resolve-cta"
              onClick={handlePreviewClick}
              disabled={resolveApplying}
              data-testid="schedule-conflicts-preview-resolve"
            >
              {model.copy.previewResolveLabel || resolvePreview?.previewLabel || '预览错开'}
            </button>
          ) : (
            <div
              className="study-schedule-conflicts-banner__resolve-panel"
              role="group"
              aria-label="错开预览"
              data-testid="schedule-conflicts-resolve-panel"
            >
              <p className="study-schedule-conflicts-banner__resolve-summary">
                {previewReady
                  ? resolvePreview?.reasonMessage
                  : resolvePreview?.reasonMessage || model.copy.resolveUnavailableHint}
              </p>
              {previewReady && summaries.length > 0 ? (
                <ul className="study-schedule-conflicts-banner__resolve-moves">
                  {summaries.map((line, index) => (
                    <li key={`${index}:${line}`}>{line}</li>
                  ))}
                </ul>
              ) : null}
              <div className="study-schedule-conflicts-banner__resolve-actions">
                <button
                  type="button"
                  className="study-schedule-conflicts-banner__resolve-cancel"
                  onClick={handleCancelPreview}
                  disabled={resolveApplying}
                >
                  {model.copy.cancelResolveLabel || resolvePreview?.cancelLabel || '取消'}
                </button>
                {previewReady ? (
                  <button
                    type="button"
                    className="study-schedule-conflicts-banner__resolve-apply"
                    onClick={handleConfirmApply}
                    disabled={resolveApplying}
                    data-testid="schedule-conflicts-apply-resolve"
                  >
                    {resolveApplying
                      ? '应用中…'
                      : model.copy.applyResolveLabel || resolvePreview?.applyLabel || '确认应用'}
                  </button>
                ) : null}
              </div>
              {!previewReady ? (
                <p
                  className="study-schedule-conflicts-banner__resolve-unavailable"
                  data-testid="schedule-conflicts-resolve-unavailable"
                >
                  {resolvePreview?.reasonMessage || model.copy.resolveUnavailableHint}
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
