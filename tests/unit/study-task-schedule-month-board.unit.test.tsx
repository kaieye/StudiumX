import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleMonthModel } from '../../src/renderer/src/study-space/planning-schedule-calendar-nav'
import {
  MONTH_DAY_SINGLE_CLICK_DELAY_MS,
  StudyTaskScheduleMonthBoard
} from '../../src/renderer/src/views/workbench/StudyTaskScheduleMonthBoard'

const model: ScheduleMonthModel = {
  year: 2026,
  monthIndex: 6,
  titleLabel: '2026年7月',
  weekdayHeaders: ['一', '二', '三', '四', '五', '六', '日'],
  cells: [
    {
      key: '2026-07-23',
      isoDate: '2026-07-23',
      dayOfMonth: 23,
      dayStartMs: new Date(2026, 6, 23).getTime(),
      inMonth: true,
      isToday: true,
      tasks: []
    }
  ],
  scheduledDayCount: 0,
  totalTaskChips: 0
}

describe('StudyTaskScheduleMonthBoard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the add-task flow on a delayed single click without requiring a view change', () => {
    const onAddTaskForDay = vi.fn()

    render(
      <StudyTaskScheduleMonthBoard
        model={model}
        categories={[]}
        onOpenTask={vi.fn()}
        onAddTaskForDay={onAddTaskForDay}
      />
    )

    const dayCell = screen.getByRole('gridcell', { name: /2026-07-23/ })
    fireEvent.click(dayCell)
    expect(onAddTaskForDay).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(MONTH_DAY_SINGLE_CLICK_DELAY_MS)
    })
    expect(onAddTaskForDay).toHaveBeenCalledTimes(1)
    expect(onAddTaskForDay).toHaveBeenCalledWith('2026-07-23')
  })

  it('opens add-task immediately via keyboard Enter', () => {
    const onAddTaskForDay = vi.fn()

    render(
      <StudyTaskScheduleMonthBoard
        model={model}
        categories={[]}
        onOpenTask={vi.fn()}
        onAddTaskForDay={onAddTaskForDay}
      />
    )

    const dayCell = screen.getByRole('gridcell', { name: /2026-07-23/ })
    fireEvent.keyDown(dayCell, { key: 'Enter' })
    expect(onAddTaskForDay).toHaveBeenCalledWith('2026-07-23')
  })

  it('double-click opens week view and cancels the pending add-task click', () => {
    const onAddTaskForDay = vi.fn()
    const onOpenWeekForDay = vi.fn()

    render(
      <StudyTaskScheduleMonthBoard
        model={model}
        categories={[]}
        onOpenTask={vi.fn()}
        onAddTaskForDay={onAddTaskForDay}
        onOpenWeekForDay={onOpenWeekForDay}
      />
    )

    const dayCell = screen.getByRole('gridcell', { name: /2026-07-23/ })
    fireEvent.click(dayCell)
    fireEvent.doubleClick(dayCell)

    act(() => {
      vi.advanceTimersByTime(MONTH_DAY_SINGLE_CLICK_DELAY_MS + 50)
    })

    expect(onOpenWeekForDay).toHaveBeenCalledTimes(1)
    expect(onOpenWeekForDay).toHaveBeenCalledWith('2026-07-23')
    expect(onAddTaskForDay).not.toHaveBeenCalled()
  })
})
