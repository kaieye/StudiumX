/**
 * Minimal recurrence rule editor (STC-703).
 *
 * daily / weekly + byWeekday + time window. Dry-run expand preview;
 * confirm is host-driven (onConfirmExpand). Never auto-expands; never clones Task.
 * Optional durable rule list via preferences.recurrenceRules + explicit save.
 */
import { CalendarClock, CalendarRange, Check, Save, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import type { JsWeekday, RecurrenceRule, ScheduleBlock } from '../../../../shared/study-planning'
import {
  buildRecurrenceRuleFromForm,
  draftFromRecurrenceRule,
  findRecurrenceRuleForTask,
  formatMinutesLabel,
  localMinutesFromEpoch,
  localMonFirstWeekdayFromEpoch,
  previewRecurrenceExpand,
  upsertRecurrenceRuleInList,
  type RecurrenceExpandPreviewModel,
  type RecurrenceExpandWindow,
  type RecurrenceRuleFormDraft
} from '../../study-space/planning-recurrence-expand'
import type { StudyTaskScheduleInput } from '../../study-space/types'

const WEEKDAY_LABELS_JS: readonly { value: JsWeekday; label: string }[] = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' }
]

const MON_FIRST_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

export type RecurrenceRuleEditorProps = {
  taskId: string
  /** Seed times from the current editor schedule. */
  schedule: StudyTaskScheduleInput
  /** Inclusive first-occurrence day (epoch ms local midnight preferred). */
  dtStartMs: number
  expandWindow: RecurrenceExpandWindow
  existingBlocks?: readonly ScheduleBlock[] | null
  /**
   * Durable preferences.recurrenceRules (STC-703 persist).
   * When provided, seeds form from matching task rule.
   */
  recurrenceRules?: readonly RecurrenceRule[] | null
  /** When omitted, confirm CTA is hidden (preview-only). */
  onConfirmExpand?: (blocks: readonly ScheduleBlock[]) => Promise<boolean> | boolean
  /**
   * Persist full rule list after user explicit save (not auto-expand).
   * Host should dual-write set_preferences with recurrenceRules.
   */
  onSaveRules?: (rules: readonly RecurrenceRule[]) => Promise<boolean> | boolean
  /**
   * Open full series edit sheet (STC-703 calendar / series UI).
   * When provided, shows entry CTA next to minimal editor actions.
   */
  onOpenSeriesSheet?: () => void
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

export function RecurrenceRuleEditor({
  taskId,
  schedule,
  dtStartMs,
  expandWindow,
  existingBlocks = null,
  recurrenceRules = null,
  onConfirmExpand,
  onSaveRules,
  onOpenSeriesSheet,
  onError
}: RecurrenceRuleEditorProps) {
  const formId = useId()
  const seed = seedFromSchedule(schedule)
  const existingRule = useMemo(
    () => findRecurrenceRuleForTask(recurrenceRules, taskId),
    [recurrenceRules, taskId]
  )

  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(
    () => existingRule?.frequency ?? seed.frequency
  )
  const [byWeekday, setByWeekday] = useState<JsWeekday[]>(() => {
    if (existingRule) {
      return existingRule.byWeekday ? ([...existingRule.byWeekday] as JsWeekday[]) : seed.byWeekday
    }
    return seed.byWeekday
  })
  const [startMinutes, setStartMinutes] = useState(
    () => existingRule?.startMinutes ?? seed.startMinutes
  )
  const [endMinutes, setEndMinutes] = useState(() => existingRule?.endMinutes ?? seed.endMinutes)
  const [ruleId, setRuleId] = useState<string | undefined>(() => existingRule?.id)
  const [preview, setPreview] = useState<RecurrenceExpandPreviewModel | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [savedHint, setSavedHint] = useState(false)

  // Re-seed when durable rules or task change (not on every schedule tick after user edits).
  useEffect(() => {
    const rule = findRecurrenceRuleForTask(recurrenceRules, taskId)
    if (rule) {
      const d = draftFromRecurrenceRule(rule)
      setFrequency(d.frequency)
      setByWeekday(d.byWeekday.length > 0 ? ([...d.byWeekday] as JsWeekday[]) : seedFromSchedule(schedule).byWeekday)
      setStartMinutes(d.startMinutes)
      setEndMinutes(d.endMinutes)
      setRuleId(d.ruleId)
    }
    setShowPreview(false)
    setPreview(null)
    setSavedHint(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- schedule only for empty-rule seed path
  }, [taskId, recurrenceRules])

  // Keep times in sync when host schedule changes only if no durable rule for this task.
  useEffect(() => {
    if (findRecurrenceRuleForTask(recurrenceRules, taskId)) return
    setStartMinutes(schedule.startMinutes)
    setEndMinutes(schedule.endMinutes)
  }, [schedule.startMinutes, schedule.endMinutes, recurrenceRules, taskId])

  const draft: RecurrenceRuleFormDraft = useMemo(
    () => ({
      taskId,
      frequency,
      byWeekday,
      startMinutes,
      endMinutes,
      dtStartMs: existingRule?.dtStartMs ?? dtStartMs,
      expandAsLocked: true,
      ruleId: ruleId ?? `recurrence:${taskId}`
    }),
    [taskId, frequency, byWeekday, startMinutes, endMinutes, dtStartMs, ruleId, existingRule?.dtStartMs]
  )

  const toggleWeekday = (day: JsWeekday): void => {
    setByWeekday((current) => {
      if (current.includes(day)) {
        const next = current.filter((d) => d !== day)
        return next.length === 0 ? current : next
      }
      return [...current, day].sort((a, b) => a - b) as JsWeekday[]
    })
    setShowPreview(false)
    setPreview(null)
    setSavedHint(false)
  }

  const runPreview = (): void => {
    const model = previewRecurrenceExpand({
      draft,
      existingBlocks: existingBlocks ?? [],
      window: expandWindow
    })
    setPreview(model)
    setShowPreview(true)
    if (!model.canConfirm && model.warnings.length > 0) {
      onError?.(model.warnings[0] ?? model.summaryLine)
    }
  }

  const handleConfirm = (): void => {
    if (!onConfirmExpand || !preview?.canConfirm || busy) return
    setBusy(true)
    Promise.resolve(onConfirmExpand(preview.applyBlocks))
      .then((ok) => {
        setBusy(false)
        if (ok) {
          setShowPreview(false)
          // Re-preview after apply so skipped-existing updates.
          const refreshed = previewRecurrenceExpand({
            draft,
            existingBlocks: [...(existingBlocks ?? []), ...preview.applyBlocks],
            window: expandWindow
          })
          setPreview(refreshed)
        } else {
          onError?.('展开写入失败')
        }
      })
      .catch(() => {
        setBusy(false)
        onError?.('展开写入失败')
      })
  }

  const handleSaveRule = (): void => {
    if (!onSaveRules || saving || busy) return
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

  const minuteOpts = minutesOptions()

  return (
    <div className="study-schedule-recurrence" aria-label="重复规则">
      <div className="study-schedule-editor-blocks-head">
        <span>
          <CalendarClock size={14} aria-hidden="true" /> 重复规则
        </span>
      </div>
      <p className="study-schedule-recurrence-hint">
        可先保存规则，再预览确认后才写入时间块；不会复制任务。默认不自动展开。完整系列编辑请打开「系列编辑」。
      </p>

      <div className="study-schedule-recurrence-row" role="group" aria-label="频率">
        <label>
          <input
            type="radio"
            name={`${formId}-freq`}
            checked={frequency === 'daily'}
            onChange={() => {
              setFrequency('daily')
              setShowPreview(false)
              setPreview(null)
              setSavedHint(false)
            }}
          />
          每天
        </label>
        <label>
          <input
            type="radio"
            name={`${formId}-freq`}
            checked={frequency === 'weekly'}
            onChange={() => {
              setFrequency('weekly')
              setShowPreview(false)
              setPreview(null)
              setSavedHint(false)
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
            onChange={(e) => {
              const next = Number(e.target.value)
              setStartMinutes(next)
              if (endMinutes <= next) setEndMinutes(Math.min(24 * 60, next + 60))
              setShowPreview(false)
              setPreview(null)
              setSavedHint(false)
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
            onChange={(e) => {
              setEndMinutes(Number(e.target.value))
              setShowPreview(false)
              setPreview(null)
              setSavedHint(false)
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

      <div className="study-schedule-recurrence-actions">
        {onOpenSeriesSheet ? (
          <button
            type="button"
            className="study-schedule-secondary-button"
            onClick={onOpenSeriesSheet}
            disabled={busy || saving}
            aria-label="打开系列编辑"
          >
            <CalendarRange size={14} aria-hidden="true" />
            系列编辑
          </button>
        ) : null}
        {onSaveRules ? (
          <button
            type="button"
            className="study-schedule-secondary-button"
            onClick={handleSaveRule}
            disabled={busy || saving}
            aria-label="保存重复规则"
          >
            <Save size={14} aria-hidden="true" />
            {saving ? '保存中…' : savedHint ? '已保存' : '保存规则'}
          </button>
        ) : null}
        <button
          type="button"
          className="study-schedule-secondary-button"
          onClick={runPreview}
          disabled={busy || saving}
        >
          预览展开
        </button>
        {showPreview && onConfirmExpand && preview?.canConfirm ? (
          <button
            type="button"
            className="study-schedule-primary-button"
            onClick={handleConfirm}
            disabled={busy || saving}
          >
            <Check size={14} aria-hidden="true" />
            {busy ? '写入中…' : preview.copy.confirmLabel}
          </button>
        ) : null}
        {showPreview ? (
          <button
            type="button"
            className="study-schedule-secondary-button"
            onClick={() => {
              setShowPreview(false)
              setPreview(null)
            }}
            disabled={busy || saving}
            aria-label="关闭预览"
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {showPreview && preview ? (
        <div className="study-schedule-recurrence-preview" role="region" aria-label="展开预览">
          <p className="study-schedule-recurrence-summary">{preview.summaryLine}</p>
          {preview.applyBlocks.length === 0 ? (
            <p className="study-schedule-recurrence-empty">{preview.copy.emptyLabel}</p>
          ) : (
            <ul className="study-schedule-recurrence-list">
              {preview.applyBlocks.map((block) => {
                const mon = localMonFirstWeekdayFromEpoch(block.startAtMs)
                const startM = localMinutesFromEpoch(block.startAtMs)
                const endM = localMinutesFromEpoch(block.endAtMs)
                return (
                  <li key={block.id}>
                    <span>{MON_FIRST_LABELS[mon] ?? '日'}</span>
                    <span>
                      {formatMinutesLabel(startM)}–{formatMinutesLabel(endM)}
                    </span>
                    <span className="study-schedule-recurrence-badge">新增</span>
                  </li>
                )
              })}
            </ul>
          )}
          {preview.warnings.length > 0 ? (
            <ul className="study-schedule-recurrence-warnings">
              {preview.warnings.slice(0, 4).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
