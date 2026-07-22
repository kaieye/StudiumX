/**
 * Multi-block list section for task editor (STC-307).
 * Thin UI only — pure model in planning-multi-block-editor.
 */
import { Plus, Trash2 } from 'lucide-react'
import type { ScheduleBlock } from '../../../../shared/study-planning'
import {
  formatBlockTimeRange,
  listTaskBlockEditorRows,
  suggestNextFocusBlockSchedule,
  type TaskBlockEditorRow
} from '../../study-space/planning-multi-block-editor'
import type { StudyTaskScheduleInput } from '../../study-space/types'

export type StudyTaskMultiBlockSectionProps = {
  taskId: string
  scheduleBlocks: readonly ScheduleBlock[] | null | undefined
  selectedBlockId?: string
  /** Current editor schedule used as fallback when suggesting next block. */
  currentSchedule: StudyTaskScheduleInput
  weekAnchorMidnightMs: number
  onSelectBlock: (row: TaskBlockEditorRow) => void
  onCreateBlock?: (
    taskId: string,
    schedule: StudyTaskScheduleInput,
    options?: { weekAnchorMidnightMs?: number; blockId?: string }
  ) => string | null
  onDeleteBlock?: (taskId: string, blockId: string) => boolean
  onError?: (message: string) => void
  onCreated?: (schedule: StudyTaskScheduleInput, blockId: string | null) => void
  onDeleted?: (blockId: string) => void
}

export function StudyTaskMultiBlockSection({
  taskId,
  scheduleBlocks,
  selectedBlockId,
  currentSchedule,
  weekAnchorMidnightMs,
  onSelectBlock,
  onCreateBlock,
  onDeleteBlock,
  onError,
  onCreated,
  onDeleted
}: StudyTaskMultiBlockSectionProps) {
  if (!onCreateBlock && !onDeleteBlock && !(scheduleBlocks && scheduleBlocks.length > 0)) {
    return null
  }

  const rows = listTaskBlockEditorRows({
    taskId,
    scheduleBlocks: scheduleBlocks ?? [],
    nowMs: Date.now()
  })

  return (
    <div className="study-schedule-editor-blocks" aria-label="任务时间块">
      <div className="study-schedule-editor-blocks-head">
        <span>时间块</span>
        {onCreateBlock ? (
          <button
            type="button"
            className="study-schedule-secondary-button study-schedule-editor-add-block"
            onClick={() => {
              const nextSchedule = suggestNextFocusBlockSchedule(rows, currentSchedule)
              const createdId = onCreateBlock(taskId, nextSchedule, { weekAnchorMidnightMs })
              if (!createdId) {
                onError?.('无法添加时间块')
                return
              }
              onCreated?.(nextSchedule, createdId)
            }}
          >
            <Plus size={14} aria-hidden="true" />
            添加时间块
          </button>
        ) : null}
      </div>
      <ul className="study-schedule-editor-blocks-list">
        {rows.map((row) => {
          const selected = selectedBlockId
            ? selectedBlockId === row.blockId
            : row.isPrimary
          return (
            <li
              key={row.blockId}
              className={`study-schedule-editor-block-row${selected ? ' is-selected' : ''}${row.locked ? ' is-locked' : ''}`}
            >
              <button
                type="button"
                className="study-schedule-editor-block-select"
                aria-pressed={selected}
                onClick={() => onSelectBlock(row)}
              >
                <strong>{formatBlockTimeRange(row)}</strong>
                {row.isPrimary ? <em>主块</em> : null}
                {row.locked ? <em>锁定</em> : null}
              </button>
              {onDeleteBlock && !row.locked ? (
                <button
                  type="button"
                  className="study-schedule-editor-block-delete"
                  aria-label={`删除时间块 ${formatBlockTimeRange(row)}`}
                  title="删除时间块"
                  onClick={() => {
                    const ok = onDeleteBlock(taskId, row.blockId)
                    if (!ok) {
                      onError?.('无法删除时间块')
                      return
                    }
                    onDeleted?.(row.blockId)
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="study-schedule-editor-blocks-hint">
        同一任务可有多个时间块；拖拽与上方时间字段只改当前选中块，不会复制任务。
      </p>
    </div>
  )
}
