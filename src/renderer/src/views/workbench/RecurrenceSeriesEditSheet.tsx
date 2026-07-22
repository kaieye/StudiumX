/**
 * STC-703 recurrence series edit sheet.
 *
 * Full series UI: edit rule (freq/interval fields already modeled), preview
 * window, confirm expand, delete rule. Explicit CTAs only — no auto-expand,
 * no silent task clone, locked overlaps fail-closed via pure expand.
 */
import { CalendarRange, Check, Save, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JsWeekday, RecurrenceRule, ScheduleBlock } from '../../../../shared/study-planning'
import {
  buildRecurrenceRuleFromForm,
  draftFromRecurrenceRule,
  findRecurrenceRuleForTask,
  formatMinutesLabel,
  upsertRecurrenceRuleInList,
  type RecurrenceRuleFormDraft
} from '../../study-space/planning-recurrence-expand'
import {
  buildRecurrenceSeriesEditSheetCopy,
  buildRecurrenceSeriesPreviewModel,
  expandWindowForPreset,
  formatUntilDateInputValue,
  nextRulesAfterDelete,
  parseOptionalPositiveCount,
  parseOptionalUntilDateInput,
  type RecurrenceSeriesPreviewModel,
  type RecurrenceSeriesWindowPreset
} from '../../study-space/planning-recurrence-series-ui'
import type { StudyTaskScheduleInput } from '../../study-space/types'
import { RecurrenceMonthPreview } from './RecurrenceMonthPreview'

const WEEKDAY_LABELS_JS: readonly { value: JsWeekday; label: string }[] = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' }
]

export type RecurrenceSeriesEditSheetProps = {
  open: boolean
  taskId: string
  taskTitle?: string | null
  schedule: StudyTaskScheduleInput
  dtStartMs: number
  weekAnchorMidnightMs: number
  existingBlocks?: readonly ScheduleBlock[] | null
  recurrenceRules?: readonly RecurrenceRule[] | null
  busy?: boolean
  onClose: () => void
  /** Persist full rule list (prefs dual-write). Not expand. */
  onSaveRules?: (rules: readonly RecurrenceRule[]) => Promise<boolean> | boolean
  /** Sequential upsert path only after user confirm. */
  onConfirmExpand?: (blocks: readonly ScheduleBlock[]) => Promise<boolean> | boolean
  onError?: (message: string) => void
}

function minutesOptions(): number[] {
  const out: number[] = []
  for (let m = 0; m <= 24 * 60; m += 15) out.push(m)
  return out
}

function formatOption(minutes: number): string {
  if (minutes === 24 * 60) return '24:00'
  return formatMinutesLabel(minutes)
}

function seedFromSchedule(schedule: StudyTaskScheduleInput): {
  frequency: 'daily' | 'weekly'
  byWeekday: JsWeekday[]
  startMinutes: number
  endMinutes: number
} {
  const mon = schedule.weekday
  const js = ((mon + 1) % 7) as JsWeekday
  return {
    frequency: 'weekly',
    byWeekday: [js],
    startMinutes: schedule.startMinutes,
    endMinutes: schedule.endMinutes
  }
}

export function RecurrenceSeriesEditSheet({
  open,
  taskId,
  taskTitle = null,
  schedule,
  dtStartMs,
  weekAnchorMidnightMs,
  existingBlocks = null,
  recurrenceRules = null,
  busy: hostBusy = false,
  onClose,
  onSaveRules,
  onConfirmExpand,
  onError
}: RecurrenceSeriesEditSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const formId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)

  const existingRule = useMemo(
    () => findRecurrenceRuleForTask(recurrenceRules, taskId),
    [recurrenceRules, taskId]
  )
  const copy = useMemo(
    () =>
      buildRecurrenceSeriesEditSheetCopy({
        taskTitle,
        hasRule: Boolean(existingRule)
      }),
    [taskTitle, existingRule]
  )

  const seed = seedFromSchedule(schedule)
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(
    () => existingRule?.frequency ?? seed.frequency
  )
  const [byWeekday, setByWeekday] = useState<JsWeekday[]>(() => {
    if (existingRule?.byWeekday?.length) return [...existingRule.byWeekday] as JsWeekday[]
    return seed.byWeekday
  })
  const [startMinutes, setStartMinutes] = useState(
    () => existingRule?.startMinutes ?? seed.startMinutes
  )
  const [endMinutes, setEndMinutes] = useState(() => existingRule?.endMinutes ?? seed.endMinutes)
  const [ruleId, setRuleId] = useState<string | undefined>(() => existingRule?.id)
  const [untilDraft, setUntilDraft] = useState(() => formatUntilDateInputValue(existingRule?.untilMs))
  const [countDraft, setCountDraft] = useState(() =>
    existingRule?.count != null && existingRule.count > 0 ? String(existingRule.count) : ''
  )
  const [windowPreset, setWindowPreset] = useState<RecurrenceSeriesWindowPreset>('week')
  const [previewModel, setPreviewModel] = useState<RecurrenceSeriesPreviewModel | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expanding, setExpanding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [savedHint, setSavedHint] = useState(false)

  // Re-seed when sheet opens / task / durable rule changes.
  useEffect(() => {
    if (!open) return
    const rule = findRecurrenceRuleForTask(recurrenceRules, taskId)
    const s = seedFromSchedule(schedule)
    if (rule) {
      const d = draftFromRecurrenceRule(rule)
      setFrequency(d.frequency)
      setByWeekday(d.byWeekday.length > 0 ? ([...d.byWeekday] as JsWeekday[]) : s.byWeekday)
      setStartMinutes(d.startMinutes)
      setEndMinutes(d.endMinutes)
      setRuleId(d.ruleId)
      setUntilDraft(formatUntilDateInputValue(d.untilMs))
      setCountDraft(d.count != null && d.count > 0 ? String(d.count) : '')
    } else {
      setFrequency(s.frequency)
      setByWeekday(s.byWeekday)
      setStartMinutes(s.startMinutes)
      setEndMinutes(s.endMinutes)
      setRuleId(undefined)
      setUntilDraft('')
      setCountDraft('')
    }
    setWindowPreset('week')
    setShowPreview(false)
    setPreviewModel(null)
    setSavedHint(false)
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- schedule seed only on open/task/rule
  }, [open, taskId, recurrenceRules])

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirmDelete) {
          setConfirmDelete(false)
          return
        }
        if (!saving && !expanding && !deleting && !hostBusy) onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, confirmDelete, saving, expanding, deleting, hostBusy, onClose])

  const expandWindow = useMemo(
    () => expandWindowForPreset(weekAnchorMidnightMs, windowPreset),
    [weekAnchorMidnightMs, windowPreset]
  )

  const draft: RecurrenceRuleFormDraft = useMemo(() => {
    const untilMs = parseOptionalUntilDateInput(untilDraft, existingRule?.dtStartMs ?? dtStartMs)
    const count = parseOptionalPositiveCount(countDraft)
    return {
      taskId,
      frequency,
      byWeekday,
      startMinutes,
      endMinutes,
      dtStartMs: existingRule?.dtStartMs ?? dtStartMs,
      untilMs,
      count,
      expandAsLocked: true,
      ruleId: ruleId ?? `recurrence:${taskId}`
    }
  }, [
    taskId,
    frequency,
    byWeekday,
    startMinutes,
    endMinutes,
    dtStartMs,
    ruleId,
    existingRule?.dtStartMs,
    untilDraft,
    countDraft
  ])

  const busy = hostBusy || saving || expanding || deleting

  const clearPreview = (): void => {
    setShowPreview(false)
    setPreviewModel(null)
  }

  const markDirty = (): void => {
    clearPreview()
    setSavedHint(false)
  }

  const toggleWeekday = (day: JsWeekday): void => {
    setByWeekday((current) => {
      if (current.includes(day)) {
        const next = current.filter((d) => d !== day)
        return next.length === 0 ? current : next
      }
      return [...current, day].sort((a, b) => a - b) as JsWeekday[]
    })
    markDirty()
  }

  const runPreview = (): void => {
    const model = buildRecurrenceSeriesPreviewModel({
      draft,
      existingBlocks: existingBlocks ?? [],
      window: expandWindow
    })
    setPreviewModel(model)
    setShowPreview(true)
    if (!model.canConfirm && model.warnings.length > 0) {
      onError?.(model.warnings[0] ?? model.summaryLine)
    }
  }

  const handleSaveRule = (): void => {
    if (!onSaveRules || busy) return
    const rule = buildRecurrenceRuleFromForm(draft)
    const nextList = upsertRecurrenceRuleInList(recurrenceRules ?? [], rule)
    setSaving(true)
    setSavedHint(false)
    Promise.resolve(onSaveRules(nextList))
      .then((ok) => {
        setSaving(false)
        if (ok) {
          setRuleId(rule.id)
          setSavedHint(true)
        } else {
          onError?.('规则保存失败')
        }
      })
      .catch(() => {
        setSaving(false)
        onError?.('规则保存失败')
      })
  }

  const handleConfirmExpand = (): void => {
    if (!onConfirmExpand || !previewModel?.canConfirm || busy) return
    setExpanding(true)
    Promise.resolve(onConfirmExpand(previewModel.preview.applyBlocks))
      .then((ok) => {
        setExpanding(false)
        if (ok) {
          // Re-preview with optimistic existing so skipped-existing updates.
          const refreshed = buildRecurrenceSeriesPreviewModel({
            draft,
            existingBlocks: [
              ...(existingBlocks ?? []),
              ...previewModel.preview.applyBlocks
            ],
            window: expandWindow
          })
          setPreviewModel(refreshed)
        } else {
          onError?.('展开写入失败')
        }
      })
      .catch(() => {
        setExpanding(false)
        onError?.('展开写入失败')
      })
  }

  const handleDeleteRule = (): void => {
    if (!onSaveRules || busy) return
    const id = ruleId ?? existingRule?.id
    if (!id) {
      onError?.('无可删除规则')
      return
    }
    const nextList = nextRulesAfterDelete(recurrenceRules, id)
    setDeleting(true)
    Promise.resolve(onSaveRules(nextList))
      .then((ok) => {
        setDeleting(false)
        setConfirmDelete(false)
        if (ok) {
          setRuleId(undefined)
          setSavedHint(false)
          clearPreview()
        } else {
          onError?.('规则删除失败')
        }
      })
      .catch(() => {
        setDeleting(false)
        onError?.('规则删除失败')
      })
  }

  if (!open) return null

  const minuteOpts = minutesOptions()

  return (
    <div
      className="workbench-empty-start-backdrop study-recurrence-series-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section
        ref={(node) => {
          dialogRef.current = node
        }}
        className="workbench-empty-start-sheet study-recurrence-series-sheet"
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
              <CalendarRange size={15} aria-hidden="true" /> 重复系列
            </span>
            <h2 id={titleId}>{copy.title}</h2>
            <p id={descriptionId}>{copy.description}</p>
            <p className="study-recurrence-series-meta">
              {existingRule ? copy.hasRuleHint : copy.noRuleHint}
              {' · '}
              不会静默克隆任务 · 默认不自动展开
            </p>
          </div>
          <button
            type="button"
            className="workbench-empty-start-sheet__close"
            onClick={() => {
              if (!busy) onClose()
            }}
            aria-label={copy.closeLabel}
            title={copy.closeLabel}
            disabled={busy}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="study-recurrence-series-body">
          <div className="study-schedule-recurrence-row" role="group" aria-label="频率">
            <label>
              <input
                type="radio"
                name={`${formId}-freq`}
                checked={frequency === 'daily'}
                disabled={busy}
                onChange={() => {
                  setFrequency('daily')
                  markDirty()
                }}
              />
              每天
            </label>
            <label>
              <input
                type="radio"
                name={`${formId}-freq`}
                checked={frequency === 'weekly'}
                disabled={busy}
                onChange={() => {
                  setFrequency('weekly')
                  markDirty()
                }}
              />
              每周
            </label>
          </div>

          {frequency === 'weekly' ? (
            <div className="study-schedule-recurrence-weekdays" role="group" aria-label="星期">
              {WEEKDAY_LABELS_JS.map((d) => {
                const on = byWeekday.includes(d.value)
                return (
                  <button
                    key={d.value}
                    type="button"
                    className={`study-schedule-recurrence-day${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => toggleWeekday(d.value)}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="study-schedule-recurrence-times">
            <label>
              开始
              <select
                value={startMinutes}
                aria-label="重复开始时间"
                disabled={busy}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setStartMinutes(next)
                  if (endMinutes <= next) setEndMinutes(Math.min(24 * 60, next + 60))
                  markDirty()
                }}
              >
                {minuteOpts
                  .filter((m) => m < 24 * 60)
                  .map((m) => (
                    <option key={`s-${m}`} value={m}>
                      {formatOption(m)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              结束
              <select
                value={endMinutes}
                aria-label="重复结束时间"
                disabled={busy}
                onChange={(e) => {
                  setEndMinutes(Number(e.target.value))
                  markDirty()
                }}
              >
                {minuteOpts
                  .filter((m) => m > startMinutes)
                  .map((m) => (
                    <option key={`e-${m}`} value={m}>
                      {formatOption(m)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="study-recurrence-series-bounds">
            <label>
              {copy.untilLabel}
              <input
                type="date"
                value={untilDraft}
                disabled={busy}
                aria-label={copy.untilLabel}
                onChange={(e) => {
                  setUntilDraft(e.target.value)
                  markDirty()
                }}
              />
            </label>
            <label>
              {copy.countLabel}
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                placeholder={copy.countNone}
                value={countDraft}
                disabled={busy}
                aria-label={copy.countLabel}
                onChange={(e) => {
                  setCountDraft(e.target.value)
                  markDirty()
                }}
              />
            </label>
          </div>

          <div className="study-recurrence-series-window" role="group" aria-label={copy.windowLabel}>
            <span>{copy.windowLabel}</span>
            {(
              [
                ['week', copy.windowWeek],
                ['two_weeks', copy.windowTwoWeeks],
                ['four_weeks', copy.windowFourWeeks]
              ] as const
            ).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                className={`study-schedule-recurrence-day${windowPreset === preset ? ' is-on' : ''}`}
                aria-pressed={windowPreset === preset}
                disabled={busy}
                onClick={() => {
                  setWindowPreset(preset)
                  clearPreview()
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <RecurrenceMonthPreview
            draft={draft}
            seedEpochMs={weekAnchorMidnightMs}
            disabled={busy}
          />

          <div className="study-schedule-recurrence-actions study-recurrence-series-actions">
            {onSaveRules ? (
              <button
                type="button"
                className="study-schedule-secondary-button"
                onClick={handleSaveRule}
                disabled={busy}
                aria-label={copy.saveLabel}
              >
                <Save size={14} aria-hidden="true" />
                {saving ? copy.savingLabel : savedHint ? copy.savedLabel : copy.saveLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="study-schedule-secondary-button"
              onClick={runPreview}
              disabled={busy}
            >
              {copy.previewLabel}
            </button>
            {showPreview && onConfirmExpand && previewModel?.canConfirm ? (
              <button
                type="button"
                className="study-schedule-primary-button"
                onClick={handleConfirmExpand}
                disabled={busy}
              >
                <Check size={14} aria-hidden="true" />
                {expanding ? '写入中…' : previewModel.copy.confirmLabel}
              </button>
            ) : null}
            {onSaveRules && (existingRule || ruleId) ? (
              <button
                type="button"
                className="study-schedule-secondary-button study-recurrence-series-delete"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                aria-label={copy.deleteRuleLabel}
              >
                <Trash2 size={14} aria-hidden="true" />
                {copy.deleteRuleLabel}
              </button>
            ) : null}
          </div>

          {confirmDelete ? (
            <div className="study-recurrence-series-delete-confirm" role="alertdialog" aria-label={copy.deleteConfirmTitle}>
              <strong>{copy.deleteConfirmTitle}</strong>
              <p>{copy.deleteConfirmBody}</p>
              <div className="study-recurrence-series-delete-actions">
                <button
                  type="button"
                  className="study-schedule-secondary-button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  {copy.deleteConfirmNo}
                </button>
                <button
                  type="button"
                  className="study-schedule-primary-button"
                  disabled={busy}
                  onClick={handleDeleteRule}
                >
                  {deleting ? '删除中…' : copy.deleteConfirmYes}
                </button>
              </div>
            </div>
          ) : null}

          {showPreview && previewModel ? (
            <div className="study-recurrence-series-preview" role="region" aria-label="系列展开预览">
              <p className="study-schedule-recurrence-summary">{previewModel.summaryLine}</p>
              <p className="study-recurrence-series-locked-note">{previewModel.copy.lockedNote}</p>
              {previewModel.groups.length === 0 ? (
                <p className="study-schedule-recurrence-empty">{previewModel.copy.emptyLabel}</p>
              ) : (
                <ul className="study-recurrence-series-calendar" aria-label="按日分组实例">
                  {previewModel.groups.map((group) => (
                    <li key={group.key} className="study-recurrence-series-day-group">
                      <div className="study-recurrence-series-day-head">
                        <span>{group.dateLabel}</span>
                        <span>{group.weekdayLabel}</span>
                        <span className="study-recurrence-series-day-count">{group.rows.length}</span>
                      </div>
                      <ul className="study-recurrence-series-day-rows">
                        {group.rows.map((row) => (
                          <li key={row.key}>
                            <span>{row.timeLabel}</span>
                            <span className="study-schedule-recurrence-badge">{row.badgeLabel}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              {previewModel.warnings.length > 0 ? (
                <ul className="study-schedule-recurrence-warnings">
                  {previewModel.warnings.slice(0, 6).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="workbench-empty-start-sheet__footer">
          <button
            type="button"
            className="workbench-empty-start-sheet__secondary"
            onClick={() => {
              if (!busy) onClose()
            }}
            disabled={busy}
          >
            {copy.closeLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

