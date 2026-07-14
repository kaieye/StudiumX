import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentArchivedHistoryPanel } from '../../src/renderer/src/views/agent-conversation/AgentArchivedHistoryPanel'
import type { QueryAgentArchivedHistoryResult, TeachingSystemApi } from '../../src/shared/teaching-types'

const originalTeachingSystem = window.teachingSystem

function installTeachingSystem(api: Partial<TeachingSystemApi>): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: api as TeachingSystemApi
  })
}

afterEach(() => {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: originalTeachingSystem
  })
})

describe('AgentArchivedHistoryPanel', () => {
  it('queries only after explicit opening and keeps retrieval separate from provider context and learner memory', async () => {
    const user = userEvent.setup()
    const result: QueryAgentArchivedHistoryResult = {
      items: [{
        reference: 'workspace:artifact:tool-1',
        type: 'tool_result',
        conversationId: 'conversation-1',
        conversationRelativePath: '.agent-sessions/conversations/conversation-1.json',
        timestamp: '2026-07-14T10:00:00.000Z',
        summary: 'Archived tool output',
        sourceRelativePath: '.agent-sessions/artifacts/tool-1.txt',
        turnId: 'turn-1',
        checkpointIds: ['checkpoint-1'],
        bytes: 128,
        integrity: 'verified'
      }],
      truncated: true,
      usage: { items: 1, bytes: 128, limit: 40, maxBytes: 128 * 1024, maxExcerptBytes: 800 },
      issues: [],
      providerInjection: 'none',
      memoryWrite: 'none'
    }
    const queryAgentArchivedHistory = vi.fn(async () => result)
    installTeachingSystem({
      queryAgentArchivedHistory,
      rebuildAgentHistoryIndex: vi.fn()
    })

    render(<AgentArchivedHistoryPanel workspaceId="workspace-1" conversationId="conversation-1" />)

    expect(queryAgentArchivedHistory).not.toHaveBeenCalled()
    expect(screen.queryByText('Archived tool output')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /归档历史/ }))

    expect(await screen.findByText('Archived tool output')).toBeInTheDocument()
    expect(queryAgentArchivedHistory).toHaveBeenCalledTimes(1)
    expect(queryAgentArchivedHistory).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      conversationId: 'conversation-1',
      scope: 'all'
    }))
    expect(screen.getByText('检查点：checkpoint-1')).toBeInTheDocument()
    expect(screen.getByText('完整性已验证')).toBeInTheDocument()
    expect(screen.getByText('结果已按预算截断')).toBeInTheDocument()
    expect(screen.getByText('模型注入：无 · 记忆写入：无')).toBeInTheDocument()
  })

  it('does not retry a failed explicit query in a render loop', async () => {
    const user = userEvent.setup()
    const queryAgentArchivedHistory = vi.fn(async () => {
      throw new Error('permission denied')
    })
    installTeachingSystem({
      queryAgentArchivedHistory,
      rebuildAgentHistoryIndex: vi.fn()
    })

    render(<AgentArchivedHistoryPanel workspaceId="workspace-1" conversationId="conversation-1" />)
    await user.click(screen.getByRole('button', { name: /归档历史/ }))

    expect(await screen.findByText('permission denied')).toBeInTheDocument()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
    expect(queryAgentArchivedHistory).toHaveBeenCalledTimes(1)
  })
})
