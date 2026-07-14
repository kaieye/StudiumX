import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AgentSessionTreePanel } from '../../src/renderer/src/views/agent-conversation/AgentSessionTreePanel'
import type { AgentConversationSessionTree } from '../../src/shared/teaching-types'

const createdAt = '2026-07-14T10:00:00.000Z'

function treeFixture(): AgentConversationSessionTree {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    openBranchId: 'branch-root',
    branches: [
      {
        sessionId: 'session-1',
        branchId: 'branch-root',
        conversationId: 'conversation-root',
        title: 'Root',
        status: 'active',
        revision: 4,
        head: { turnId: 'turn-root', turnCount: 4, updatedAt: createdAt },
        relativePath: '.agent-sessions/conversations/root.json',
        isOpen: true
      },
      {
        sessionId: 'session-1',
        branchId: 'branch-child',
        conversationId: 'conversation-child',
        title: 'Child',
        status: 'active',
        revision: 2,
        parentBranchId: 'branch-root',
        head: { turnId: 'turn-child', turnCount: 2, updatedAt: createdAt },
        relativePath: '.agent-sessions/conversations/child.json',
        isOpen: false
      },
      {
        sessionId: 'session-1',
        branchId: 'branch-archived',
        conversationId: 'conversation-archived',
        title: 'Archived',
        status: 'archived',
        revision: 3,
        parentBranchId: 'branch-root',
        head: { turnId: 'turn-archived', turnCount: 3, updatedAt: createdAt },
        relativePath: '.agent-sessions/conversations/archived.json',
        isOpen: false
      },
      {
        sessionId: 'session-1',
        branchId: 'branch-deleted',
        conversationId: 'conversation-deleted',
        title: 'Deleted',
        status: 'deleted',
        revision: 6,
        parentBranchId: 'branch-root',
        head: { turnId: 'turn-deleted', turnCount: 3, updatedAt: createdAt },
        relativePath: '.agent-sessions/conversations/deleted.json',
        isOpen: false
      }
    ]
  }
}

describe('AgentSessionTreePanel', () => {
  it('renders parent-child levels and dispatches open and head-fork actions', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn(async () => {})
    const onFork = vi.fn(async () => {})

    render(
      <AgentSessionTreePanel
        tree={treeFixture()}
        activeConversationId="conversation-root"
        onOpen={onOpen}
        onFork={onFork}
        onReplay={vi.fn(async () => [])}
        onStatus={vi.fn(async () => {})}
      />
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveStyle({ '--branch-depth': '0' })
    expect(items[1]).toHaveStyle({ '--branch-depth': '1' })

    await user.click(screen.getByRole('button', { name: '打开分支 Child' }))
    expect(onOpen).toHaveBeenCalledWith('conversation-child')

    await user.click(screen.getByRole('button', { name: '从分支 Child 的 head 创建分支' }))
    expect(onFork).toHaveBeenCalledWith('conversation-child', 'turn-child', 2)
  })

  it('marks only the viewed branch current when durable open state points elsewhere', () => {
    render(
      <AgentSessionTreePanel
        tree={treeFixture()}
        activeConversationId="conversation-child"
        onOpen={vi.fn(async () => {})}
        onFork={vi.fn(async () => {})}
        onReplay={vi.fn(async () => [])}
        onStatus={vi.fn(async () => {})}
      />
    )

    const currentItems = screen.getAllByRole('listitem').filter((item) => item.hasAttribute('aria-current'))
    expect(currentItems).toHaveLength(1)
    expect(currentItems[0]).toHaveTextContent('Child')
  })

  it('allows forking and replaying an archived head but requires restore before open', async () => {
    const user = userEvent.setup()
    const onFork = vi.fn(async () => {})
    const onReplay = vi.fn(async () => [{
      id: 'replayed-turn',
      role: 'assistant' as const,
      content: 'Safe replay content',
      createdAt,
      metadata: {
        version: 1 as const,
        provenance: {
          kind: 'replayed' as const,
          sourceConversationId: 'conversation-archived',
          sourceBranchId: 'branch-archived',
          sourceTurnId: 'turn-archived',
          replayId: 'replay-1'
        }
      }
    }])

    render(
      <AgentSessionTreePanel
        tree={treeFixture()}
        activeConversationId="conversation-root"
        onOpen={vi.fn(async () => {})}
        onFork={onFork}
        onReplay={onReplay}
        onStatus={vi.fn(async () => {})}
      />
    )

    const archivedItem = screen.getByRole('button', { name: '打开分支 Archived' }).closest('[role="listitem"]')
    expect(archivedItem).not.toBeNull()
    expect(within(archivedItem!).getByRole('button', { name: '打开分支 Archived' })).toBeDisabled()
    await user.click(within(archivedItem!).getByRole('button', { name: '从分支 Archived 的 head 创建分支' }))
    expect(onFork).toHaveBeenCalledWith('conversation-archived', 'turn-archived', 3)
    await user.click(within(archivedItem!).getByRole('button', { name: '安全回放分支 Archived' }))
    expect(onReplay).toHaveBeenCalledWith('conversation-archived', 'turn-archived')
    expect(screen.getByRole('region', { name: '安全回放预览' })).toHaveTextContent('Safe replay content')
    expect(screen.getByRole('region', { name: '安全回放预览' })).toHaveTextContent('回放结果')
  })

  it('does not report a successful replay when the store returns an error result', async () => {
    const user = userEvent.setup()
    render(
      <AgentSessionTreePanel
        tree={treeFixture()}
        activeConversationId="conversation-root"
        onOpen={vi.fn(async () => {})}
        onFork={vi.fn(async () => {})}
        onReplay={vi.fn(async () => null)}
        onStatus={vi.fn(async () => {})}
      />
    )

    await user.click(screen.getByRole('button', { name: '安全回放分支 Child' }))
    expect(screen.queryByRole('region', { name: '安全回放预览' })).not.toBeInTheDocument()
  })

  it('requires confirmation before deleting an active branch', async () => {
    const user = userEvent.setup()
    const onStatus = vi.fn(async () => {})
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(
      <AgentSessionTreePanel
        tree={treeFixture()}
        activeConversationId="conversation-root"
        onOpen={vi.fn(async () => {})}
        onFork={vi.fn(async () => {})}
        onReplay={vi.fn(async () => [])}
        onStatus={onStatus}
      />
    )

    await user.click(screen.getByRole('button', { name: '删除分支 Child' }))
    expect(onStatus).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '删除分支 Child' }))
    expect(onStatus).toHaveBeenCalledWith('conversation-child', 'deleted', 2)
    confirm.mockRestore()
  })

  it('prevents deleted branches from being opened, forked, or replayed', () => {
    render(
      <AgentSessionTreePanel
        tree={treeFixture()}
        activeConversationId="conversation-root"
        onOpen={vi.fn(async () => {})}
        onFork={vi.fn(async () => {})}
        onReplay={vi.fn(async () => [])}
        onStatus={vi.fn(async () => {})}
      />
    )

    const deletedItem = screen.getByRole('button', { name: '打开分支 Deleted' }).closest('[role="listitem"]')
    expect(deletedItem).not.toBeNull()
    expect(within(deletedItem!).getByRole('button', { name: '打开分支 Deleted' })).toBeDisabled()
    expect(within(deletedItem!).getByRole('button', { name: '从分支 Deleted 的 head 创建分支' })).toBeDisabled()
    expect(within(deletedItem!).getByRole('button', { name: '安全回放分支 Deleted' })).toBeDisabled()
  })
})
