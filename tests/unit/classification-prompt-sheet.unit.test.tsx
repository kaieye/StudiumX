import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ClassificationPromptSheet } from '@renderer/views/workbench/ClassificationPromptSheet'

const categories = [
  { id: 'study', name: '学习', color: '#8197aa' },
  { id: 'entertainment', name: '娱乐', color: '#9c8aa5' }
]

describe('ClassificationPromptSheet UI', () => {
  it('offers classify / keep inbox / never / later; Escape → later', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <ClassificationPromptSheet
        open
        taskId="t1"
        taskTitle="论文"
        categories={categories}
        onResolve={onResolve}
      />
    )

    expect(screen.getByRole('dialog', { name: /任务已完成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /选择类别/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保持待归类/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /不再提示/ })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onResolve).toHaveBeenCalledWith({ action: 'later' })
  })

  it('classify requires explicit category pick (never invent first)', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <ClassificationPromptSheet
        open
        taskId="t1"
        taskTitle="论文"
        categories={categories}
        onResolve={onResolve}
      />
    )

    await user.click(screen.getByRole('button', { name: /选择类别/ }))
    const confirm = screen.getByRole('button', { name: /确认归类/ })
    expect(confirm).toBeDisabled()

    await user.click(screen.getByRole('option', { name: /娱乐/ }))
    expect(confirm).not.toBeDisabled()
    await user.click(confirm)
    expect(onResolve).toHaveBeenCalledWith({ action: 'classify', categoryId: 'entertainment' })
  })

  it('keep_inbox and never_prompt resolve without category', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const { rerender } = render(
      <ClassificationPromptSheet
        open
        taskId="t1"
        taskTitle="A"
        categories={categories}
        onResolve={onResolve}
      />
    )
    await user.click(screen.getByRole('button', { name: /保持待归类/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'keep_inbox' })

    onResolve.mockClear()
    rerender(
      <ClassificationPromptSheet
        open
        taskId="t1"
        taskTitle="A"
        categories={categories}
        onResolve={onResolve}
      />
    )
    await user.click(screen.getByRole('button', { name: /不再提示/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'never_prompt' })
  })
})
