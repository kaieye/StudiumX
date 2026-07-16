import { describe, expect, it } from 'vitest'
import { AgentConversationReader } from '../../src/renderer/src/views/agent-conversation/AgentConversationReader'
import type { AgentConversationTurnPresentation } from '../../src/renderer/src/agent-conversation-presentation'
import { renderUi, screen, setupUser, waitFor } from '../helpers/render'

function presentation(state: 'active' | 'complete'): AgentConversationTurnPresentation {
  return {
    turnId: 'assistant-1',
    active: state === 'active',
    answeredAsks: [],
    sources: [],
    items: [{
      id: 'reasoning-1', kind: 'reasoning', label: '思考过程',
      detail: '第一行\n第二行\n第三行\n第四行', state
    }]
  }
}

describe('AgentConversationReader reasoning disclosure', () => {
  it('collapses completed reasoning to three lines and lets the user expand it', async () => {
    const user = setupUser()
    renderUi(<AgentConversationReader presentation={presentation('complete')} />)

    const toggle = screen.getByRole('button', { name: '展开思考过程' })
    const detail = screen.getByText(/第一行/)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(detail).toHaveClass('is-collapsed', 'has-height-transition')

    await user.click(toggle)
    expect(screen.getByRole('button', { name: '折叠思考过程' })).toHaveAttribute('aria-expanded', 'true')
    expect(detail).not.toHaveClass('is-collapsed')
  })

  it('shows active reasoning in full without a disclosure toggle', () => {
    renderUi(<AgentConversationReader presentation={presentation('active')} />)
    expect(screen.getByText(/第一行/)).not.toHaveClass('is-collapsed')
    expect(screen.queryByRole('button', { name: /思考过程/ })).toBeNull()
  })
})

function childProgressPresentation(details: string[]): AgentConversationTurnPresentation {
  return {
    turnId: 'assistant-child-progress',
    active: true,
    answeredAsks: [],
    sources: [],
    items: details.map((detail, index) => ({
      id: `child-progress-${index + 1}`,
      kind: 'child_run' as const,
      label: '子任务进度',
      detail,
      state: index === details.length - 1 ? 'active' as const : 'complete' as const
    }))
  }
}

describe('AgentConversationReader repeated process descriptions', () => {
  it('rolls a new description upward and keeps the history behind a disclosure button', async () => {
    const user = setupUser()
    const { rerender } = renderUi(
      <AgentConversationReader presentation={childProgressPresentation(['child-1：thinking'])} />
    )

    expect(screen.queryByRole('button', { name: '展开子任务进度历史' })).toBeNull()

    rerender(
      <AgentConversationReader
        presentation={childProgressPresentation(['child-1：thinking', 'child-1：tool_done'])}
      />
    )

    const outgoing = screen.getByText('child-1：thinking')
    const incoming = screen.getByText('child-1：tool_done')
    expect(outgoing).toHaveClass('is-leaving')
    expect(incoming).toHaveClass('is-entering')

    await waitFor(() => expect(screen.queryByText('child-1：thinking')).toBeNull())

    rerender(
      <AgentConversationReader
        presentation={childProgressPresentation([
          'child-1：thinking',
          'child-1：tool_done',
          'child-1：thinking again'
        ])}
      />
    )
    expect(screen.getByText('child-1：tool_done')).toHaveClass('is-leaving')
    expect(screen.getByText('child-1：thinking again')).toHaveClass('is-entering')
    await waitFor(() => expect(screen.queryByText('child-1：tool_done')).toBeNull())

    const toggle = screen.getByRole('button', { name: '展开子任务进度历史' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)

    expect(screen.getByRole('button', { name: '折叠子任务进度历史' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list', { name: '子任务进度历史' })).toHaveTextContent('child-1：thinking')
    expect(screen.getByRole('list', { name: '子任务进度历史' })).toHaveTextContent('child-1：tool_done')
    expect(screen.getByRole('list', { name: '子任务进度历史' })).toHaveTextContent('child-1：thinking again')
  })
})
