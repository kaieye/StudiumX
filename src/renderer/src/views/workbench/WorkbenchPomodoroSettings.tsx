/**
 * WorkbenchPomodoro settings portal: catalog nav, rename, plan editor, footer actions.
 */

import { Check, Plus, Save, Trash2, X } from 'lucide-react'
import {
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  ToggleSwitch
} from '../settings/SettingsPrimitives'
import { StudyPlanningPrefsSection } from './StudyPlanningPrefsSection'
import {
  TIMER_PLAN_KIND_OPTIONS,
  defaultContinuousBreakPolicy,
  type StudyTimerPlanKind,
  type StudyTimerPlanKindUi
} from '../../study-space/planning-timer-plan-kind'
import type { PomodoroBreakPolicy } from '../../study-space/planning-timer-plan-advanced-fields'
import {
  simulationWindowFromTotalMinutes,
  totalMinutesFromSimulationWindow
} from '../../study-space/planning-simulation-window-ui'
import type { TimerPlanCatalogRow } from '../../study-space/planning-timer-plan-catalog-ui'
import type { EmptyStartCategoryOption } from '../../study-space/planning-study-prefs-ui'
import type { TimerPlanDraft } from './workbench-pomodoro-draft'

export type WorkbenchPomodoroSettingsProps = {
  settingsTitleId: string
  catalogRows: readonly TimerPlanCatalogRow[]
  selectedCatalogPlanId: string | null
  selectedCatalogRow: TimerPlanCatalogRow | null
  draft: TimerPlanDraft
  draftKind: StudyTimerPlanKind
  draftKindUi: StudyTimerPlanKindUi
  continuousTotalMinutes: number | null
  hasValidDraft: boolean
  isAddingPlanMode: boolean
  isViewingAppliedPlan: boolean
  primaryActionLabel: string
  primaryActionDisabled: boolean
  renamingId: string | null
  renameDraft: string
  emptyStartCategoryId: string
  emptyStartCategoryOptions: readonly EmptyStartCategoryOption[]
  onEmptyStartCategoryIdChange?: (categoryId: string) => void
  onClose: () => void
  onSelectCatalogPlan: (planId: string) => void
  onAddPlan: () => void
  onStartRename: (row: TimerPlanCatalogRow) => void
  onCommitRename: () => void
  onRenameDraftChange: (value: string) => void
  onCancelRename: () => void
  onRemoveSelectedPlan: () => void
  onSavePlan: () => void
  onApplyPlan: () => void
  updateDraft: <Key extends keyof TimerPlanDraft>(key: Key, value: TimerPlanDraft[Key]) => void
  setDraftAndMaybeCommit: (updater: (current: TimerPlanDraft) => TimerPlanDraft) => void
}

export function WorkbenchPomodoroSettings({
  settingsTitleId,
  catalogRows,
  selectedCatalogPlanId,
  selectedCatalogRow,
  draft,
  draftKind,
  draftKindUi,
  continuousTotalMinutes,
  hasValidDraft,
  isAddingPlanMode,
  isViewingAppliedPlan,
  primaryActionLabel,
  primaryActionDisabled,
  renamingId,
  renameDraft,
  emptyStartCategoryId,
  emptyStartCategoryOptions,
  onEmptyStartCategoryIdChange,
  onClose,
  onSelectCatalogPlan,
  onAddPlan,
  onStartRename,
  onCommitRename,
  onRenameDraftChange,
  onCancelRename,
  onRemoveSelectedPlan,
  onSavePlan,
  onApplyPlan,
  updateDraft,
  setDraftAndMaybeCommit
}: WorkbenchPomodoroSettingsProps) {
  return (
    <div className="office-workbench-timer-settings-overlay">
      <div
        className="study-schedule-editor-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          id="workbench-pomodoro-settings"
          className="workbench-pomodoro-settings-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={settingsTitleId}
        >
          <button
            type="button"
            className="workbench-pomodoro-settings-close"
            onClick={onClose}
            aria-label="关闭计时设置"
            title="关闭设置"
          >
            <X size={17} aria-hidden="true" />
          </button>

          <aside className="workbench-pomodoro-settings-nav" aria-label="专注计时方案">
            <div className="workbench-pomodoro-settings-nav-heading" id={settingsTitleId}>专注计时</div>
            <div className="workbench-pomodoro-settings-nav-list" role="list" aria-label="方案列表">
              {catalogRows.map((row) => {
                const selected =
                  selectedCatalogPlanId === row.id
                  || (selectedCatalogPlanId == null && row.isDefault)
                return (
                  <div
                    key={row.id}
                    role="listitem"
                    className={`workbench-pomodoro-settings-nav-plan${selected ? ' is-active' : ''}${row.readonly ? ' is-builtin' : ''}${row.isDefault ? ' is-default' : ''}`}
                  >
                    {renamingId === row.id ? (
                      <div className="workbench-pomodoro-rename-row">
                        <input
                          type="text"
                          aria-label={`重命名方案：${row.name}`}
                          value={renameDraft}
                          maxLength={24}
                          autoFocus
                          onChange={(e) => onRenameDraftChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onCommitRename()
                            if (e.key === 'Escape') onCancelRename()
                          }}
                        />
                        <button type="button" className="workbench-pomodoro-plan-action" onClick={onCommitRename} aria-label="确认重命名">
                          <Check size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`workbench-pomodoro-settings-nav-item${selected ? ' is-active' : ''}`}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => onSelectCatalogPlan(row.id)}
                        onDoubleClick={() => onStartRename(row)}
                        title={row.canRename ? '双击重命名' : undefined}
                      >
                        <span>
                          <strong>{row.name}</strong>
                        </span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="workbench-pomodoro-settings-nav-add">
              <button
                type="button"
                className="workbench-pomodoro-settings-nav-add-btn"
                onClick={onAddPlan}
                aria-label="添加方案"
                title="添加方案"
              >
                <Plus size={15} aria-hidden="true" />
                添加方案
              </button>
            </div>
          </aside>

          <div className="workbench-pomodoro-settings-content">
            <header className="workbench-pomodoro-settings-panel-heading">
              <h2>专注方案</h2>
              <p>自定义计时类别；左侧选择后点应用。进行中的会话快照不会被覆盖。</p>
            </header>

            <div className="workbench-pomodoro-settings-scroll">
              <SettingsCard className="workbench-pomodoro-settings-card">
                <SettingsRow label="方案名称">
                  <input
                    className="settings-input"
                    type="text"
                    aria-label="方案名称"
                    value={draft.name}
                    maxLength={24}
                    placeholder="例如：深潜块"
                    onChange={(event) => updateDraft('name', event.target.value)}
                  />
                </SettingsRow>
                <SettingsRow label="方案类型">
                  <SettingsSelect
                    value={draftKindUi}
                    position="item-aligned"
                    options={[...TIMER_PLAN_KIND_OPTIONS]}
                    onChange={(next) => {
                      setDraftAndMaybeCommit((current) => {
                        if (next === 'exam') {
                          const existingTotal =
                            totalMinutesFromSimulationWindow(
                              current.simulationStartTime,
                              current.simulationEndTime
                            )
                          const keepWindow =
                            current.simulationStartTime
                            && current.simulationEndTime
                            && current.simulationStartTime < current.simulationEndTime
                            && current.simulationStartTime !== '00:00'
                          const examStart = keepWindow ? current.simulationStartTime : '09:00'
                          const examEnd = keepWindow
                            ? current.simulationEndTime
                            : (existingTotal
                              ? (simulationWindowFromTotalMinutes(existingTotal, '09:00')?.end ?? '11:30')
                              : '11:30')
                          const examTotal =
                            totalMinutesFromSimulationWindow(examStart, examEnd) ?? 150
                          return {
                            ...current,
                            kind: 'continuous',
                            continuousTarget: true,
                            continuousMode: 'exam',
                            clockMode: 'countup',
                            focusMinutes: examTotal,
                            breakMinutes: 0,
                            simulationStartTime: examStart,
                            simulationEndTime: examEnd,
                            breakPolicy: 'none',
                            rhythmSequence: undefined
                          }
                        }
                        if (next === 'continuous') {
                          const existingTotal =
                            totalMinutesFromSimulationWindow(
                              current.simulationStartTime,
                              current.simulationEndTime
                            )
                          const nextFocus =
                            Number.isInteger(current.focusMinutes) && current.focusMinutes >= 5
                              ? current.focusMinutes
                              : 25
                          const nextBreak =
                            Number.isInteger(current.breakMinutes) && current.breakMinutes >= 0
                              ? current.breakMinutes
                              : 5
                          const nextTotal =
                            existingTotal
                            ?? Math.min(240, Math.max(5, nextFocus * 2 + nextBreak))
                          const totalWindow = simulationWindowFromTotalMinutes(nextTotal) ?? {
                            start: '00:00',
                            end: '01:30'
                          }
                          return {
                            ...current,
                            kind: 'continuous',
                            continuousTarget: false,
                            continuousMode: 'target',
                            clockMode: current.clockMode === 'countup' ? 'countup' : 'countdown',
                            focusMinutes: nextFocus,
                            breakMinutes: nextBreak,
                            simulationStartTime: totalWindow.start,
                            simulationEndTime: totalWindow.end,
                            breakPolicy:
                              current.breakPolicy === 'automatic'
                              || current.breakPolicy === 'ask'
                              || current.breakPolicy === 'reminder_only'
                              || current.breakPolicy === 'none'
                                ? current.breakPolicy
                                : defaultContinuousBreakPolicy(),
                            rhythmSequence: undefined
                          }
                        }
                        return {
                          ...current,
                          kind: 'pomodoro',
                          continuousTarget: undefined,
                          continuousMode: undefined,
                          clockMode: 'countdown',
                          breakPolicy:
                            current.breakPolicy === 'automatic' || current.breakPolicy === 'ask'
                              ? current.breakPolicy
                              : 'ask',
                          breakMinutes: current.breakMinutes || 5,
                          rhythmSequence: undefined
                        }
                      })
                    }}
                  />
                </SettingsRow>
                {draftKind === 'continuous' && (draft.continuousMode === 'exam' || draft.continuousTarget === true) ? (
                  <>
                    <SettingsRow label="考试时段" detail="开始与结束时间">
                      <div className="workbench-pomodoro-time-range workbench-pomodoro-time-range--settings">
                        <input
                          className="settings-input"
                          type="time"
                          aria-label="考试开始时间"
                          value={draft.simulationStartTime}
                          onChange={(event) => {
                            const start = event.target.value
                            setDraftAndMaybeCommit((current) => {
                              const end = current.simulationEndTime
                              const total = totalMinutesFromSimulationWindow(start, end)
                              return {
                                ...current,
                                simulationStartTime: start,
                                focusMinutes: total ?? current.focusMinutes
                              }
                            })
                          }}
                        />
                        <i>至</i>
                        <input
                          className="settings-input"
                          type="time"
                          aria-label="考试结束时间"
                          value={draft.simulationEndTime}
                          onChange={(event) => {
                            const end = event.target.value
                            setDraftAndMaybeCommit((current) => {
                              const start = current.simulationStartTime
                              const total = totalMinutesFromSimulationWindow(start, end)
                              return {
                                ...current,
                                simulationEndTime: end,
                                focusMinutes: total ?? current.focusMinutes
                              }
                            })
                          }}
                        />
                      </div>
                    </SettingsRow>
                  </>
                ) : draftKind === 'continuous' ? (
                  <>
                    <SettingsRow label="专注时间">
                      <div className="workbench-pomodoro-settings-control-inline">
                        <input
                          className="settings-number"
                          type="number"
                          aria-label="专注时间"
                          value={draft.focusMinutes}
                          min={5}
                          max={240}
                          step={1}
                          onChange={(event) => updateDraft('focusMinutes', Number(event.target.value))}
                        />
                        <span className="workbench-pomodoro-settings-unit">分钟</span>
                      </div>
                    </SettingsRow>
                    <SettingsRow label="休息时间">
                      <div className="workbench-pomodoro-settings-control-inline">
                        <input
                          className="settings-number"
                          type="number"
                          aria-label="休息时间"
                          value={draft.breakMinutes}
                          min={0}
                          max={45}
                          step={1}
                          onChange={(event) => updateDraft('breakMinutes', Number(event.target.value))}
                        />
                        <span className="workbench-pomodoro-settings-unit">分钟</span>
                      </div>
                    </SettingsRow>
                    <SettingsRow label="总时长">
                      <div className="workbench-pomodoro-settings-control-inline">
                        <input
                          className="settings-number"
                          type="number"
                          aria-label="总时长"
                          value={continuousTotalMinutes ?? ''}
                          min={5}
                          max={240}
                          step={1}
                          onChange={(event) => {
                            const raw = event.target.value
                            if (raw.trim() === '') {
                              setDraftAndMaybeCommit((current) => ({
                                ...current,
                                simulationStartTime: '00:00',
                                simulationEndTime: '00:00'
                              }))
                              return
                            }
                            const mins = Number(raw)
                            if (!Number.isInteger(mins)) return
                            const window = simulationWindowFromTotalMinutes(mins)
                            if (!window) return
                            setDraftAndMaybeCommit((current) => ({
                              ...current,
                              simulationStartTime: window.start,
                              simulationEndTime: window.end
                            }))
                          }}
                        />
                        <span className="workbench-pomodoro-settings-unit">分钟</span>
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="正计时"
                      detail="默认关闭；开启后圆环与主数字按时长累计显示"
                    >
                      <ToggleSwitch
                        checked={draft.clockMode === 'countup'}
                        ariaLabel="正计时"
                        onChange={(checked) =>
                          updateDraft('clockMode', checked ? 'countup' : 'countdown')
                        }
                      />
                    </SettingsRow>
                  </>
                ) : (
                  <>
                    <SettingsRow label="专注时间">
                      <div className="workbench-pomodoro-settings-control-inline">
                        <input
                          className="settings-number"
                          type="number"
                          aria-label="专注时间"
                          value={draft.focusMinutes}
                          min={5}
                          max={120}
                          step={1}
                          onChange={(event) => updateDraft('focusMinutes', Number(event.target.value))}
                        />
                        <span className="workbench-pomodoro-settings-unit">分钟</span>
                      </div>
                    </SettingsRow>
                    <SettingsRow label="休息时间">
                      <div className="workbench-pomodoro-settings-control-inline">
                        <input
                          className="settings-number"
                          type="number"
                          aria-label="休息时间"
                          value={draft.breakMinutes}
                          min={0}
                          max={45}
                          step={1}
                          onChange={(event) => updateDraft('breakMinutes', Number(event.target.value))}
                        />
                        <span className="workbench-pomodoro-settings-unit">分钟</span>
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="正计时"
                      detail="默认关闭；开启后圆环与主数字按时长累计显示"
                    >
                      <ToggleSwitch
                        checked={draft.clockMode === 'countup'}
                        ariaLabel="正计时"
                        onChange={(checked) =>
                          updateDraft('clockMode', checked ? 'countup' : 'countdown')
                        }
                      />
                    </SettingsRow>
                    <SettingsRow label="自动开启下一循环">
                      <ToggleSwitch
                        checked={draft.breakPolicy === 'automatic'}
                        ariaLabel="自动开启下一循环"
                        onChange={(checked) =>
                          updateDraft('breakPolicy', (checked ? 'automatic' : 'ask') as PomodoroBreakPolicy)
                        }
                      />
                    </SettingsRow>
                  </>
                )}
                {onEmptyStartCategoryIdChange ? (
                  <StudyPlanningPrefsSection
                    emptyStartCategoryId={emptyStartCategoryId}
                    categoryOptions={emptyStartCategoryOptions}
                    onEmptyStartCategoryIdChange={onEmptyStartCategoryIdChange}
                    compact
                  />
                ) : null}
              </SettingsCard>
            </div>

            <div className="workbench-pomodoro-settings-footer" role="toolbar" aria-label="方案操作">
              <div className="workbench-pomodoro-settings-footer-actions">
                {selectedCatalogRow && selectedCatalogRow.canDelete ? (
                  <button
                    type="button"
                    className="ghost-button danger"
                    onClick={onRemoveSelectedPlan}
                    aria-label={`删除方案：${selectedCatalogRow.name}`}
                    title="删除方案"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    删除方案
                  </button>
                ) : null}
              </div>
              <div className="workbench-pomodoro-settings-footer-primary">
                {!isAddingPlanMode ? (
                  <button
                    type="button"
                    className="ghost-button workbench-pomodoro-save-plan"
                    onClick={onSavePlan}
                    disabled={!hasValidDraft}
                    aria-label="保存"
                    title="保存到方案列表，不切换当前计时"
                  >
                    <Save size={15} aria-hidden="true" />
                    保存
                  </button>
                ) : null}
                <button
                  className={`ghost-button workbench-pomodoro-apply-plan${isViewingAppliedPlan ? ' is-applied' : ' strong'}`}
                  type="button"
                  onClick={onApplyPlan}
                  disabled={primaryActionDisabled}
                  aria-label={primaryActionLabel}
                  title={primaryActionLabel}
                >
                  <Check size={15} aria-hidden="true" />
                  {primaryActionLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
