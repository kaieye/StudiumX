/**
 * Month board for StudyTaskSchedulePage —
 * single-click a date opens the add-task editor;
 * double-click jumps to that week's week view.
 * Navigation chrome lives on the parent page.
 */
import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { StudyTaskCategory, StudyTaskCategoryId } from '../../study-space/types'
import {
  formatScheduleMinutes
} from './study-task-schedule-interaction'
import type { ScheduleMonthModel, ScheduleMonthTaskChip } from '../../study-space/planning-schedule-calendar-nav'
import { getReadableCategoryInk, resolveStudyTaskCategory } from '../../study-space/taskCategories'

/** Delay single-click so a double-click can cancel the add-task open. */
export const MONTH_DAY_SINGLE_CLICK_DELAY_MS = 280

type CategorySwatchVarStyle = CSSProperties & Record<'--category-swatch-color' | '--category-swatch-ink', string>

export type StudyTaskScheduleMonthBoardProps = {
  model: ScheduleMonthModel
  categories: readonly StudyTaskCategory[]
  selectedTaskId?: string | null
  onSelectTask?: (taskId: string | null) => void
  onOpenTask: (task: ScheduleMonthTaskChip) => void
  onAddTaskForDay: (isoDate: string) => void
  /** Double-click a date → open week view focused on that day. */
  onOpenWeekForDay?: (isoDate: string) => void
}

function resolveCategory(
  categoryId: StudyTaskCategoryId | undefined | null,
  categories: readonly StudyTaskCategory[]
): StudyTaskCategory {
  return (
    resolveStudyTaskCategory(categoryId, categories as StudyTaskCategory[]) ??
    resolveStudyTaskCategory('study', categories as StudyTaskCategory[])!
  )
}

function categoryBadgeStyle(category: StudyTaskCategory): CategorySwatchVarStyle {
  return {
    '--category-swatch-color': category.color,
    '--category-swatch-ink': getReadableCategoryInk(category.color)
  }
}

export function StudyTaskScheduleMonthBoard({
  model,
  categories,
  selectedTaskId = null,
  onSelectTask,
  onOpenTask,
  onAddTaskForDay,
  onOpenWeekForDay
}: StudyTaskScheduleMonthBoardProps) {
  const pendingSingleClickTimerRef = useRef<number | null>(null)

  const clearPendingSingleClick = (): void => {
    if (pendingSingleClickTimerRef.current == null) return
    window.clearTimeout(pendingSingleClickTimerRef.current)
    pendingSingleClickTimerRef.current = null
  }

  useEffect(() => () => clearPendingSingleClick(), [])

  const scheduleAddForDay = (isoDate: string): void => {
    clearPendingSingleClick()
    pendingSingleClickTimerRef.current = window.setTimeout(() => {
      pendingSingleClickTimerRef.current = null
      onAddTaskForDay(isoDate)
    }, MONTH_DAY_SINGLE_CLICK_DELAY_MS)
  }

  const openWeekForDay = (isoDate: string): void => {
    clearPendingSingleClick()
    onOpenWeekForDay?.(isoDate)
  }

  return (
    <div className="study-schedule-month-board" role="grid" aria-label={`${model.titleLabel} 任务月历`}>
      {model.weekdayHeaders.map((header) => (
        <div key={`hdr-${header}`} className="study-schedule-month-weekday" role="columnheader">
          {header}
        </div>
      ))}
      {model.cells.map((cell) => {
        const visibleTasks = cell.tasks.slice(0, 3)
        const overflow = cell.tasks.length - visibleTasks.length
        return (
          <div
            key={cell.key}
            className={[
              'study-schedule-month-cell',
              cell.inMonth ? '' : 'is-out-of-month',
              cell.isToday ? 'is-today' : '',
              cell.tasks.length > 0 ? 'has-tasks' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            role="gridcell"
            aria-label={
              cell.inMonth
                ? cell.isoDate +
                  '，单击添加任务' +
                  (onOpenWeekForDay ? '，双击打开周视图' : '') +
                  (cell.tasks.length ? '，已有 ' + cell.tasks.length + ' 个任务' : '')
                : cell.isoDate + ' 非本月' + (onOpenWeekForDay ? '，双击打开周视图' : '')
            }
            data-iso={cell.isoDate}
            data-in-month={cell.inMonth ? '1' : '0'}
            tabIndex={cell.inMonth || onOpenWeekForDay ? 0 : -1}
            onClick={() => {
              if (!cell.inMonth) return
              scheduleAddForDay(cell.isoDate)
            }}
            onDoubleClick={() => {
              if (!onOpenWeekForDay) return
              openWeekForDay(cell.isoDate)
            }}
            onKeyDown={(event) => {
              if (event.currentTarget !== event.target) return
              if (event.key === 'Enter' || event.key === ' ') {
                if (!cell.inMonth) return
                event.preventDefault()
                // Keyboard has no double-tap gesture here — open add directly.
                clearPendingSingleClick()
                onAddTaskForDay(cell.isoDate)
                return
              }
            }}
          >
            <div className="study-schedule-month-cell-head">
              <span className="study-schedule-month-day-number">{cell.dayOfMonth}</span>
              {cell.tasks.length > 0 ? (
                <strong className="study-schedule-month-day-count">{cell.tasks.length}</strong>
              ) : null}
            </div>
            <div className="study-schedule-month-cell-tasks">
              {visibleTasks.map((task) => {
                const category = resolveCategory(task.categoryId, categories)
                const isSelected = selectedTaskId === task.taskId
                return (
                  <button
                    key={task.chipKey}
                    type="button"
                    className={[
                      'study-schedule-month-task',
                      task.done ? 'is-done' : '',
                      isSelected ? 'is-selected' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={
                      {
                        '--event-color': category.color
                      } as CSSProperties
                    }
                    title={`${task.title} ${formatScheduleMinutes(task.startMinutes)}-${formatScheduleMinutes(task.endMinutes)}`}
                    onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation()
                      clearPendingSingleClick()
                      onSelectTask?.(task.taskId)
                      onOpenTask(task)
                    }}
                    onDoubleClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                      // Prevent bubbling to the day cell (would jump to week).
                      event.stopPropagation()
                    }}
                  >
                    <span className="study-schedule-month-task-time">
                      {formatScheduleMinutes(task.startMinutes)}
                    </span>
                    <span className="study-schedule-month-task-title">{task.title}</span>
                    <small
                      className="study-schedule-month-task-category"
                      style={categoryBadgeStyle(category)}
                      aria-hidden="true"
                    />
                  </button>
                )
              })}
              {overflow > 0 ? (
                <span className="study-schedule-month-overflow">+{overflow}</span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
