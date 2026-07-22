/**
 * Empty-start sheet UI (STC-401 cutover C).
 * Pick task / quick_start / unattributed — never silent first-open bind.
 */

import { Timer, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  buildEmptyStartSheetModel,
  normalizeQuickStartTitle,
  type EmptyStartChoice,
  type EmptyStartPolicy,
  type EmptyStartSheetTask
} from '../../../../shared/study-planning'

export type EmptyStartSheetResult =
  | { choice: 'pick_task'; taskId: string }
  | { choice: 'quick_start'; title: string }
  | { choice: 'unattributed' }
  | { choice: 'cancel' }

export type EmptyStartSheetProps = {
  open: boolean
  policy?: EmptyStartPolicy
  openTasks: readonly EmptyStartSheetTask[]
  onResolve: (result: EmptyStartSheetResult) => void
  now?: Date
}

export function EmptyStartSheet({
  open,
  policy = 'remember_quick_start',
  openTasks,
  onResolve,
  now
}: EmptyStartSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const model = useMemo(
    () =>
      buildEmptyStartSheetModel({
        policy,
        openTasks,
        ...(now ? { now } : {})
      }),
    [policy, openTasks, now]
  )
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [quickTitle, setQuickTitle] = useState(model.defaultQuickStartTitle)
  const [mode, setMode] = useState<'menu' | 'pick' | 'quick'>('menu')

  useEffect(() => {
    if (!open) return
    setSelectedTaskId(null)
    setQuickTitle(model.defaultQuickStartTitle)
    setMode('menu')
  }, [open, model.defaultQuickStartTitle])

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onResolve({ choice: 'cancel' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onResolve])

  if (!open) return null

  const submitPick = (): void => {
    if (!selectedTaskId) return
    onResolve({ choice: 'pick_task', taskId: selectedTaskId })
  }

  const submitQuick = (): void => {
    onResolve({
      choice: 'quick_start',
      title: normalizeQuickStartTitle(quickTitle, now ?? new Date())
    })
  }

  return (
    <div
      className="workbench-empty-start-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve({ choice: 'cancel' })
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
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="workbench-empty-start-sheet__header">
          <div>
            <span className="workbench-empty-start-sheet__eyebrow">
              <Timer size={15} aria-hidden="true" /> 专注启动
            </span>
            <h2 id={titleId}>{model.copy.title}</h2>
            <p id={descriptionId}>{model.copy.description}</p>
          </div>
          <button
            type="button"
            className="workbench-empty-start-sheet__close"
            onClick={() => onResolve({ choice: 'cancel' })}
            aria-label="关闭"
            title="关闭"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {mode === 'menu' ? (
          <div className="workbench-empty-start-sheet__actions" role="group" aria-label="启动方式">
            {model.hasOpenTasks ? (
              <button
                type="button"
                className={`workbench-empty-start-sheet__action${model.recommended === 'pick_task' ? ' is-recommended' : ''}`}
                onClick={() => setMode('pick')}
                aria-label={model.copy.pickTaskLabel}
              >
                <strong aria-hidden="true">{model.copy.pickTaskLabel}</strong>
                <small>从当前开放任务中显式选择，不静默绑定第一条。</small>
              </button>
            ) : null}
            <button
              type="button"
              className={`workbench-empty-start-sheet__action${model.recommended === 'quick_start' ? ' is-recommended' : ''}`}
              onClick={() => setMode('quick')}
              aria-label={model.copy.quickStartLabel}
            >
              <strong aria-hidden="true">{model.copy.quickStartLabel}</strong>
              <small>创建归入「其他」的临时任务，立即可见并与本次计时共用 ID。</small>
            </button>
            <button
              type="button"
              className="workbench-empty-start-sheet__action"
              onClick={() => onResolve({ choice: 'unattributed' })}
              aria-label={model.copy.unattributedLabel}
            >
              <strong aria-hidden="true">{model.copy.unattributedLabel}</strong>
              <small>时间不计入任务占比；可稍后归类分析。</small>
            </button>
            <button
              type="button"
              className="workbench-empty-start-sheet__cancel"
              onClick={() => onResolve({ choice: 'cancel' })}
            >
              {model.copy.cancelLabel}
            </button>
          </div>
        ) : null}

        {mode === 'pick' ? (
          <div className="workbench-empty-start-sheet__pick">
            {model.openTasks.length === 0 ? (
              <p className="workbench-empty-start-sheet__hint">{model.copy.emptyTasksHint}</p>
            ) : (
              <ul className="workbench-empty-start-sheet__task-list" role="listbox" aria-label="开放任务">
                {model.openTasks.map((task) => {
                  const selected = selectedTaskId === task.id
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`workbench-empty-start-sheet__task${selected ? ' is-selected' : ''}`}
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        {task.title}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="workbench-empty-start-sheet__footer">
              <button type="button" className="workbench-empty-start-sheet__secondary" onClick={() => setMode('menu')}>
                返回
              </button>
              <button
                type="button"
                className="workbench-empty-start-sheet__primary"
                disabled={!selectedTaskId}
                onClick={submitPick}
              >
                用所选任务开始
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'quick' ? (
          <div className="workbench-empty-start-sheet__quick">
            <label className="workbench-empty-start-sheet__field">
              <span>{model.copy.quickStartTitleLabel}</span>
              <input
                value={quickTitle}
                onChange={(event) => setQuickTitle(event.target.value)}
                maxLength={80}
                autoFocus
                placeholder={model.defaultQuickStartTitle}
              />
            </label>
            <div className="workbench-empty-start-sheet__footer">
              <button type="button" className="workbench-empty-start-sheet__secondary" onClick={() => setMode('menu')}>
                返回
              </button>
              <button type="button" className="workbench-empty-start-sheet__primary" onClick={submitQuick}>
                创建并开始
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

/** Adapter: map sheet result to EmptyStartChoice for policy resolver. */
export function emptyStartSheetResultToChoice(
  result: EmptyStartSheetResult
): EmptyStartChoice | null {
  if (result.choice === 'cancel') return null
  if (result.choice === 'pick_task') return 'pick_task'
  if (result.choice === 'quick_start') return 'quick_start'
  return 'unattributed'
}
