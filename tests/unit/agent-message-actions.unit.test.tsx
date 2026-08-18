import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AgentMessageActions, AgentMessageEditor } from '../../src/renderer/src/views/agent-conversation/AgentSessionTreePanel'
import type { AgentChatTurn } from '../../src/shared/teaching-types'

const createdAt = '2026-07-14T10:00:00.000Z'

function turn(role: AgentChatTurn['role'], content = 'hello'): AgentChatTurn {
  return { id: `turn-${role}`, role, content, createdAt }
}

describe('AgentMessageActions', () => {
  it('exposes in-flow controls, a hover-revealed timestamp, and edit only for user turns', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    const onFork = vi.fn()
    const onEdit = vi.fn()
    const onPrevious = vi.fn()
    const onNext = vi.fn()

    const { rerender } = render(
      <AgentMessageActions
        turn={turn('assistant')}
        canFork
        canEdit
        onCopy={onCopy}
        onFork={onFork}
        onEdit={onEdit}
        branchNavigation={{ current: 2, total: 2, onPrevious, onNext }}
      />
    )
    await user.click(screen.getByRole('button', { name: '复制消息' }))
    expect(onCopy).toHaveBeenCalledWith('hello')
    const assistantToolbar = screen.getByRole('toolbar', { name: '消息操作' })
    const assistantTime = assistantToolbar.querySelector('time')
    expect(assistantTime).toHaveAttribute('dateTime', createdAt)
    expect(assistantToolbar.lastElementChild).toBe(assistantTime)
    expect(screen.getByRole('button', { name: '从轮次创建分支' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新编辑并发送' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('分支 2/2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一分支' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '下一分支' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '上一分支' }))
    expect(onPrevious).toHaveBeenCalledOnce()

    rerender(<AgentMessageActions turn={turn('user')} canFork canEdit onCopy={onCopy} onFork={onFork} onEdit={onEdit} />)
    const userToolbar = screen.getByRole('toolbar', { name: '消息操作' })
    const userTime = userToolbar.querySelector('time')
    expect(userTime).toHaveAttribute('dateTime', createdAt)
    expect(userToolbar.firstElementChild).toBe(userTime)
    await user.click(screen.getByRole('button', { name: '重新编辑并发送' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'turn-user' }))
  })
})

describe('AgentMessageEditor', () => {
  it('submits trimmed content and supports cancel', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<AgentMessageEditor initialValue="  old prompt  " onSubmit={onSubmit} onCancel={onCancel} />)
    const textarea = screen.getByLabelText('重新编辑消息')
    await user.clear(textarea)
    await user.type(textarea, 'new prompt')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(onSubmit).toHaveBeenCalledWith('new prompt')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
