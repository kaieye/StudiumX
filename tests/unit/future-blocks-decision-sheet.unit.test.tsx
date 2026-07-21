import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FutureBlocksDecisionSheet } from '@renderer/views/workbench/FutureBlocksDecisionSheet'

describe('FutureBlocksDecisionSheet UI', () => {
  it('offers cancel / keep review / reassign and never auto-cancels', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <FutureBlocksDecisionSheet
        open
        taskId="t1"
        taskTitle="论文"
        futureBlockIds={['b1', 'b2']}
        reassignCandidates={[{ id: 't2', title: '复习' }]}
        onResolve={onResolve}
      />
    )

    expect(screen.getByRole('dialog', { name: /任务已完成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /取消这些时间块/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保留作复习/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /改派给其他任务/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /保留作复习/ }))
    expect(onResolve).toHaveBeenCalledWith({ choice: 'keep_as_review' })
  })

  it('reassign uses first open candidate id', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <FutureBlocksDecisionSheet
        open
        taskId="t1"
        taskTitle="论文"
        futureBlockIds={['b1']}
        reassignCandidates={[
          { id: 't2', title: '复习' },
          { id: 't3', title: '其他' }
        ]}
        onResolve={onResolve}
      />
    )
    await user.click(screen.getByRole('button', { name: /改派给其他任务/ }))
    expect(onResolve).toHaveBeenCalledWith({ choice: 'reassign', reassignTaskId: 't2' })
  })

  it('Escape dismisses without block disposition', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <FutureBlocksDecisionSheet
        open
        taskId="t1"
        taskTitle="A"
        futureBlockIds={['b1']}
        onResolve={onResolve}
      />
    )
    await user.keyboard('{Escape}')
    expect(onResolve).toHaveBeenCalledWith({ choice: 'dismiss' })
  })
})
