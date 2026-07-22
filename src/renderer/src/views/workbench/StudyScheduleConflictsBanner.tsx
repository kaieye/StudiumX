/**
 * Thin STC-707 week-plan conflict list banner.
 * Pure model lives in planning-schedule-conflicts-ui; host owns dismiss state.
 */

import { AlertTriangle, X } from 'lucide-react'
import type { ScheduleConflictsBannerModel } from '../../study-space/planning-schedule-conflicts-ui'

export type StudyScheduleConflictsBannerProps = {
  model: ScheduleConflictsBannerModel
  onDismiss: () => void
  /**
   * Open the week chip editor for one side of a conflict.
   * Prefer blockId so multi-block tasks target the overlapping row.
   */
  onOpenBlock?: (input: { taskId: string | null; blockId: string }) => void
}

export function StudyScheduleConflictsBanner({
  model,
  onDismiss,
  onOpenBlock
}: StudyScheduleConflictsBannerProps) {
  if (model.kind !== 'conflicts' || model.conflictCount <= 0) return null

  const hasLocked = model.pairs.some((p) => p.aLocked || p.bLocked)

  return (
    <section
      className="study-schedule-conflicts-banner"
      role="region"
      aria-label={model.copy.eyebrow}
      data-conflict-count={model.conflictCount}
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
    </section>
  )
}
