import { describe, expect, it } from 'vitest'
import { AgentConversationReader } from '../../src/renderer/src/views/agent-conversation/AgentConversationReader'
import type { AgentConversationTurnPresentation } from '../../src/renderer/src/agent-conversation-presentation'
import { renderUi, screen, setupUser } from '../helpers/render'

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
