import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyStartSheet } from '@renderer/views/workbench/EmptyStartSheet'

describe('EmptyStartSheet UI', () => {
  it('offers pick / quick_start / unattributed and never auto-binds first open task', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <EmptyStartSheet
        open
        openTasks={[
          { id: 't1', title: '任务一' },
          { id: 't2', title: '任务二' }
        ]}
        onResolve={onResolve}
        now={new Date(2026, 6, 21, 10, 0, 0)}
      />
    )

    expect(screen.getByRole('dialog', { name: /开始专注前选择任务/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /选择任务/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建临时任务并开始/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /无任务计时开始/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /无任务计时开始/ }))
    expect(onResolve).toHaveBeenCalledWith({ choice: 'unattributed' })
  })

  it('pick path requires explicit task selection', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <EmptyStartSheet
        open
        openTasks={[
          { id: 't1', title: '任务一' },
          { id: 't2', title: '任务二' }
        ]}
        onResolve={onResolve}
      />
    )

    await user.click(screen.getByRole('button', { name: /选择任务/ }))
    const startWithPick = screen.getByRole('button', { name: '用所选任务开始' })
    expect(startWithPick).toBeDisabled()
    await user.click(screen.getByRole('option', { name: '任务二' }))
    expect(startWithPick).not.toBeDisabled()
    await user.click(startWithPick)
    expect(onResolve).toHaveBeenCalledWith({ choice: 'pick_task', taskId: 't2' })
  })

  it('quick_start path returns editable title', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <EmptyStartSheet
        open
        openTasks={[]}
        onResolve={onResolve}
        now={new Date(2026, 6, 21, 8, 15, 0)}
      />
    )

    expect(screen.getByRole('dialog', { name: '开始专注' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /创建「临时专注」并开始/ }))
    const input = screen.getByLabelText('临时任务标题')
    expect(input).toHaveValue('临时专注 · 08:15')
    await user.clear(input)
    await user.type(input, '晨读')
    await user.click(screen.getByRole('button', { name: '创建并开始' }))
    expect(onResolve).toHaveBeenCalledWith({ choice: 'quick_start', title: '晨读' })
  })

  it('Escape cancels without binding a task', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <EmptyStartSheet open openTasks={[{ id: 't1', title: 'A' }]} onResolve={onResolve} />
    )
    await user.keyboard('{Escape}')
    expect(onResolve).toHaveBeenCalledWith({ choice: 'cancel' })
  })
})
