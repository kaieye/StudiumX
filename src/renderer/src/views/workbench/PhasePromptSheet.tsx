/**
 * Phase prompt sheet (STC-205 remainder).
 * After focus countdown completes with breakPolicy ask:
 * start break / extend + start / skip / later.
 * Escape / dismiss → later (does not forge rest completion).
 */

import { Coffee, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef } from 'react'
import {
  buildPhasePromptSheetModel,
  type TimerSessionRecord
} from '../../../../shared/study-planning'

export type PhasePromptSheetResult =
  | { action: 'start_break' }
  | { action: 'skip_break' }
  | { action: 'later' }
  | { action: 'extend_and_start'; extendMinutes: number }

export type PhasePromptSheetProps = {
  open: boolean
  /** Completed focus segment (planSnapshot + focusRound). */
  completed: Pick<
    TimerSessionRecord,
    'planSnapshot' | 'focusRoundInPlan' | 'phase' | 'state'
  > | null
  onResolve: (result: PhasePromptSheetResult) => void
}

export function PhasePromptSheet({ open, completed, onResolve }: PhasePromptSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const model = useMemo(() => {
    if (!completed) {
      return buildPhasePromptSheetModel({
        completed: {
          planSnapshot: null,
          focusRoundInPlan: 1,
          phase: 'focus',
          state: 'completed'
        }
      })
    }
    return buildPhasePromptSheetModel({ completed })
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
        className="workbench-empty-start-sheet workbench-phase-prompt-sheet"
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
              <Coffee size={15} aria-hidden="true" /> 休息
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

        <div className="workbench-empty-start-sheet__actions" role="group" aria-label="休息选项">
          <button
            type="button"
            className="workbench-empty-start-sheet__action is-recommended"
            onClick={() => onResolve({ action: 'start_break' })}
          >
            <strong>{model.copy.startBreakLabel}</strong>
            <small>{model.copy.startBreakDetail}</small>
          </button>
          <div
            className="workbench-phase-prompt-extend"
            role="group"
            aria-label={model.copy.extendAndStartLabel}
          >
            <p className="workbench-phase-prompt-extend__hint">
              <strong>{model.copy.extendAndStartLabel}</strong>
              <small>{model.copy.extendAndStartDetail}</small>
            </p>
            <div className="workbench-phase-prompt-extend__buttons">
              {model.extendMinuteOptions.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="workbench-empty-start-sheet__action workbench-phase-prompt-extend__btn"
                  onClick={() => onResolve({ action: 'extend_and_start', extendMinutes: minutes })}
                >
                  <strong>+{minutes} 分钟</strong>
                  <small>
                    共 {model.nextBreakMinutes + minutes} 分钟{model.nextPhase === 'long_break' ? '长休息' : '短休息'}
                  </small>
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="workbench-empty-start-sheet__action"
            onClick={() => onResolve({ action: 'skip_break' })}
          >
            <strong>{model.copy.skipBreakLabel}</strong>
            <small>{model.copy.skipBreakDetail}</small>
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
