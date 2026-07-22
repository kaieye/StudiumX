/**
 * Timer plan catalog list (STC-501/502 depth).
 * Thin UI only — pure rows from planning-timer-plan-catalog-ui.
 */
import { Check, Copy, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  listTimerPlanCatalogRows,
  type TimerPlanCatalogRow
} from '../../study-space/planning-timer-plan-catalog-ui'

export type StudyTimerPlanCatalogSectionProps = {
  userPlans: readonly {
    id: string
    name: string
    focusMinutes: number
    breakMinutes: number
    simulationStartTime: string
    simulationEndTime: string
  }[]
  defaultTimerPlanId?: string | null
  onApply: (planId: string) => void
  onCopy?: (planId: string) => void
  onRemove?: (planId: string) => void
  onRename?: (planId: string, name: string) => boolean
  onSetDefault?: (planId: string) => void
}

export function StudyTimerPlanCatalogSection({
  userPlans,
  defaultTimerPlanId = null,
  onApply,
  onCopy,
  onRemove,
  onRename,
  onSetDefault
}: StudyTimerPlanCatalogSectionProps) {
  const rows = listTimerPlanCatalogRows({
    userPlans,
    defaultTimerPlanId,
    includeBuiltins: true
  })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const startRename = (row: TimerPlanCatalogRow): void => {
    if (!row.canRename || !onRename) return
    setRenamingId(row.id)
    setRenameDraft(row.name)
  }

  const commitRename = (): void => {
    if (!renamingId || !onRename) {
      setRenamingId(null)
      return
    }
    const ok = onRename(renamingId, renameDraft)
    if (ok) setRenamingId(null)
  }

  return (
    <div className="workbench-pomodoro-saved-plans" aria-label="时钟方案目录">
      <span>方案目录</span>
      {rows.length > 0 ? (
        <ul>
          {rows.map((row) => (
            <li
              key={row.id}
              className={`workbench-pomodoro-plan-row${row.readonly ? ' is-builtin' : ''}${row.isDefault ? ' is-default' : ''}`}
            >
              {renamingId === row.id ? (
                <div className="workbench-pomodoro-rename-row">
                  <input
                    type="text"
                    aria-label={`重命名方案：${row.name}`}
                    value={renameDraft}
                    maxLength={24}
                    autoFocus
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                  <button type="button" className="workbench-pomodoro-plan-action" onClick={commitRename} aria-label="确认重命名">
                    <Check size={14} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="workbench-pomodoro-saved-plan"
                  onClick={() => onApply(row.id)}
                  onDoubleClick={() => startRename(row)}
                  title={row.readonly ? '系统方案（只读，可复制）' : '点击应用；双击重命名'}
                >
                  <strong>
                    {row.name}
                    {row.readonly ? <em className="workbench-pomodoro-plan-badge">系统</em> : null}
                    {row.isDefault ? <em className="workbench-pomodoro-plan-badge is-default">默认</em> : null}
                  </strong>
                  <small>
                    {row.summary}
                    {row.kind === 'builtin' ? '' : ` · ${row.simulationStartTime}–${row.simulationEndTime}`}
                  </small>
                </button>
              )}
              <div className="workbench-pomodoro-plan-actions">
                {onSetDefault && !row.isDefault ? (
                  <button
                    type="button"
                    className="workbench-pomodoro-plan-action"
                    onClick={() => onSetDefault(row.id)}
                    aria-label={`设为默认：${row.name}`}
                    title="设为默认"
                  >
                    <Star size={14} aria-hidden="true" />
                  </button>
                ) : null}
                {onCopy && row.canCopy ? (
                  <button
                    type="button"
                    className="workbench-pomodoro-plan-action workbench-pomodoro-copy-plan"
                    onClick={() => onCopy(row.id)}
                    aria-label={`复制方案：${row.name}`}
                    title="复制为自定义"
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                ) : null}
                {onRemove && row.canDelete ? (
                  <button
                    type="button"
                    className="workbench-pomodoro-plan-action workbench-pomodoro-remove-plan"
                    onClick={() => onRemove(row.id)}
                    aria-label={`删除方案：${row.name}`}
                    title="删除方案"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>系统方案与保存后的自定义方案会显示在这里。</p>
      )}
    </div>
  )
}
