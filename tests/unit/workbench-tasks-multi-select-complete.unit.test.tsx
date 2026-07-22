/**
 * WorkbenchTasks multi-select complete UI entry (STC-408 remainder).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchTasks } from '@renderer/views/workbench/WorkbenchTasks'
import type { StudyTask } from '@renderer/study-space/types'

function task(partial: Partial<StudyTask> & Pick<StudyTask, 'id' | 'title'>): StudyTask {
  return {
    id: partial.id,
    title: partial.title,
    done: partial.done ?? false,
    ...(partial.categoryId !== undefined ? { categoryId: partial.categoryId } : {}),
    ...(partial.schedule !== undefined ? { schedule: partial.schedule } : {}),
    ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {})
  }
}

const baseTasks: StudyTask[] = [
  task({ id: 'a', title: '任务A', categoryId: 'study' }),
  task({ id: 'b', title: '任务B', done: true, categoryId: 'study' }),
  task({ id: 'c', title: '任务C', categoryId: 'exercise' })
]

const noop = (): void => {}

describe('WorkbenchTasks multi-select complete UI (STC-408 remainder)', () => {
  it('hides multi-select entry when host omits onCompleteTasksBatch', () => {
    render(
      <WorkbenchTasks
        tasks={baseTasks}
        openTasks={2}
        completedTasks={1}
        onToggleTask={noop}
        onRemoveTask={noop}
        onOpenSchedule={noop}
        onOpenAddTask={noop}
        onOpenAnalytics={noop}
        defaultOpen
      />
    )
    expect(screen.queryByRole('button', { name: '多选' })).not.toBeInTheDocument()
  })

  it('selects open tasks and completes via host batch callback', async () => {
    const user = userEvent.setup()
    const onCompleteTasksBatch = vi.fn()
    render(
      <WorkbenchTasks
        tasks={baseTasks}
        openTasks={2}
        completedTasks={1}
        onToggleTask={noop}
        onRemoveTask={noop}
        onOpenSchedule={noop}
        onOpenAddTask={noop}
        onOpenAnalytics={noop}
        onCompleteTasksBatch={onCompleteTasksBatch}
        defaultOpen
        defaultView="all"
      />
    )

    await user.click(screen.getByRole('button', { name: '多选' }))
    expect(screen.getByRole('toolbar', { name: '批量完成' })).toBeInTheDocument()

    const completeBtn = screen.getByRole('button', { name: '完成' })
    expect(completeBtn).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '选择：任务A' }))
    await user.click(screen.getByRole('button', { name: '选择：任务C' }))

    const ready = screen.getByRole('button', { name: '完成（2）' })
    expect(ready).not.toBeDisabled()
    await user.click(ready)

    expect(onCompleteTasksBatch).toHaveBeenCalledTimes(1)
    expect(onCompleteTasksBatch).toHaveBeenCalledWith(['a', 'c'])
    // exits selection mode after complete
    expect(screen.queryByRole('toolbar', { name: '批量完成' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '多选' })).toBeInTheDocument()
  })

  it('select-all visible only picks open tasks; done rows are not selectable', async () => {
    const user = userEvent.setup()
    const onCompleteTasksBatch = vi.fn()
    render(
      <WorkbenchTasks
        tasks={baseTasks}
        openTasks={2}
        completedTasks={1}
        onToggleTask={noop}
        onRemoveTask={noop}
        onOpenSchedule={noop}
        onOpenAddTask={noop}
        onOpenAnalytics={noop}
        onCompleteTasksBatch={onCompleteTasksBatch}
        defaultOpen
        defaultView="all"
      />
    )

    await user.click(screen.getByRole('button', { name: '多选' }))
    expect(screen.getByRole('button', { name: /已完成任务不可多选：任务B/ })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '全选可见' }))
    const toolbar = screen.getByRole('toolbar', { name: '批量完成' })
    expect(within(toolbar).getByText('已选 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '完成（2）' }))
    expect(onCompleteTasksBatch).toHaveBeenCalledWith(['a', 'c'])
  })

  it('cancel exits selection mode without completing', async () => {
    const user = userEvent.setup()
    const onCompleteTasksBatch = vi.fn()
    render(
      <WorkbenchTasks
        tasks={baseTasks}
        openTasks={2}
        completedTasks={1}
        onToggleTask={noop}
        onRemoveTask={noop}
        onOpenSchedule={noop}
        onOpenAddTask={noop}
        onOpenAnalytics={noop}
        onCompleteTasksBatch={onCompleteTasksBatch}
        defaultOpen
        defaultView="all"
      />
    )

    await user.click(screen.getByRole('button', { name: '多选' }))
    await user.click(screen.getByRole('button', { name: '选择：任务A' }))
    await user.click(screen.getByRole('button', { name: '取消多选' }))
    expect(onCompleteTasksBatch).not.toHaveBeenCalled()
    expect(screen.queryByRole('toolbar', { name: '批量完成' })).not.toBeInTheDocument()
  })
})
