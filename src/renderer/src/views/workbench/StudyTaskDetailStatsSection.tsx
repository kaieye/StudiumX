/**
 * Task detail stats strip (STC-304): estimate / planned / actual + future|history blocks.
 * Thin UI — pure model in planning-task-detail-stats.
 */
import type { ScheduleBlock, TimerSessionRecord } from '../../../../shared/study-planning'
import {
  buildTaskDetailStatsModel,
  formatDetailMinutes,
  type TaskDetailBlockRow
} from '../../study-space/planning-task-detail-stats'

export type StudyTaskDetailStatsSectionProps = {
  taskId: string
  scheduleBlocks: readonly ScheduleBlock[] | null | undefined
  timerSessions?: readonly TimerSessionRecord[] | null
  estimateMinutes?: number | null
  remainingEstimateMinutes?: number | null
  nowMs?: number
  /**
   * When provided, estimate is editable (controlled string from parent editor).
   * Parent owns dual-write on submit.
   */
  estimateDraft?: string
  onEstimateDraftChange?: (value: string) => void
  readOnly?: boolean
}

function BlockList({
  heading,
  rows,
  empty
}: {
  heading: string
  rows: readonly TaskDetailBlockRow[]
  empty: string
}) {
  return (
    <div className="study-schedule-detail-block-group">
      <div className="study-schedule-detail-block-group__head">{heading}</div>
      {rows.length === 0 ? (
        <p className="study-schedule-detail-block-empty">{empty}</p>
      ) : (
        <ul className="study-schedule-detail-block-list" aria-label={heading}>
          {rows.map((row) => (
            <li
              key={row.blockId}
              className={`study-schedule-detail-block-row is-${row.bucket}${row.locked ? ' is-locked' : ''}${row.status === 'cancelled' ? ' is-cancelled' : ''}`}
            >
              <span className="study-schedule-detail-block-label">{row.label}</span>
              <span className="study-schedule-detail-block-meta">
                {row.isPrimary ? <em>主块</em> : null}
                {row.locked ? <em>锁定</em> : null}
                {row.status === 'cancelled' ? <em>已取消</em> : null}
                <strong>{formatDetailMinutes(row.durationMinutes)}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function StudyTaskDetailStatsSection({
  taskId,
  scheduleBlocks,
  timerSessions = null,
  estimateMinutes = null,
  remainingEstimateMinutes,
  nowMs,
  estimateDraft,
  onEstimateDraftChange,
  readOnly = false
}: StudyTaskDetailStatsSectionProps) {
  const model = buildTaskDetailStatsModel({
    taskId,
    scheduleBlocks: scheduleBlocks ?? [],
    timerSessions,
    estimateMinutes,
    remainingEstimateMinutes,
    nowMs
  })

  const draftControlled = typeof estimateDraft === 'string' && typeof onEstimateDraftChange === 'function'

  return (
    <section className="study-schedule-detail-stats" aria-label="任务详情统计">
      <div className="study-schedule-detail-stats__grid">
        <label className="study-schedule-detail-stat">
          <span>{model.copy.estimateLabel}</span>
          {draftControlled && !readOnly ? (
            <input
              type="number"
              min={0}
              max={24 * 60}
              step={5}
              inputMode="numeric"
              value={estimateDraft}
              onChange={(event) => onEstimateDraftChange(event.target.value)}
              placeholder={model.copy.estimateEmpty}
              aria-label="估时（分钟）"
            />
          ) : (
            <strong>
              {model.estimateMinutes == null
                ? model.copy.estimateEmpty
                : formatDetailMinutes(model.estimateMinutes)}
            </strong>
          )}
        </label>
        <div className="study-schedule-detail-stat">
          <span>{model.copy.plannedLabel}</span>
          <strong>{formatDetailMinutes(model.plannedFocusMinutes)}</strong>
        </div>
        <div className="study-schedule-detail-stat">
          <span>{model.copy.actualLabel}</span>
          <strong>{formatDetailMinutes(model.actualFocusMinutes)}</strong>
        </div>
      </div>

      {model.currentBlocks.length > 0 ? (
        <BlockList
          heading={model.copy.currentHeading}
          rows={model.currentBlocks}
          empty={model.copy.emptyBlocks}
        />
      ) : null}
      <BlockList
        heading={model.copy.futureHeading}
        rows={model.futureBlocks}
        empty={model.copy.emptyBlocks}
      />
      <BlockList
        heading={model.copy.historyHeading}
        rows={model.historyBlocks}
        empty={model.copy.emptyBlocks}
      />
    </section>
  )
}
