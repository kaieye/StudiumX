/**
 * BatchClassifySheet UI (STC-408).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BatchClassifySheet } from '@renderer/views/workbench/BatchClassifySheet'

const categories = [
  { id: 'study', name: '学习', color: '#8197aa' },
  { id: 'exercise', name: '锻炼', color: '#8aa58a' }
]

describe('BatchClassifySheet UI (STC-408)', () => {
  it('requires explicit category; Escape cancels', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <BatchClassifySheet
        open
        tasks={[
          { id: 'a', title: '任务A' },
          { id: 'b', title: '任务B' }
        ]}
        taskIds={['a', 'b']}
        categories={categories}
        onResolve={onResolve}
      />
    )

    expect(screen.getByRole('dialog', { name: /批量归类/ })).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: /确认归类/ })
    expect(confirm).toBeDisabled()

    await user.keyboard('{Escape}')
    expect(onResolve).toHaveBeenCalledWith({ action: 'cancel' })
  })

  it('classifies with selected category and taskIds', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <BatchClassifySheet
        open
        tasks={[
          { id: 'a', title: '任务A' },
          { id: 'b', title: '任务B' }
        ]}
        taskIds={['a', 'b']}
        categories={categories}
        onResolve={onResolve}
      />
    )

    await user.click(screen.getByRole('option', { name: /锻炼/ }))
    const confirm = screen.getByRole('button', { name: /确认归类/ })
    expect(confirm).not.toBeDisabled()
    await user.click(confirm)
    expect(onResolve).toHaveBeenCalledWith({
      action: 'classify',
      categoryId: 'exercise',
      taskIds: ['a', 'b']
    })
  })
})
