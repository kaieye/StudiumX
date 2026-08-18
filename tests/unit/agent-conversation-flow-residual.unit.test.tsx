import { describe, expect, it } from 'vitest'
import { AgentConversationReader } from '../../src/renderer/src/views/agent-conversation/AgentConversationReader'
import type { AgentConversationTurnPresentation } from '../../src/renderer/src/agent-conversation-presentation'
import { renderUi, screen } from '../helpers/render'

function withOrderedFlow(
  overrides: Partial<AgentConversationTurnPresentation>
): AgentConversationTurnPresentation {
  return {
    turnId: 'ordered-flow-turn',
    active: true,
    status: { kind: 'active' },
    answeredAsks: [],
    sources: [],
    items: [],
    flow: [{ id: 'flow:text', kind: 'assistant_text', content: '模型输出。' }],
    ...overrides
  }
}

describe('AgentConversationReader ordered-flow residual process rows', () => {
  it('suppresses only generic residual statuses while preserving pending approvals and questions', () => {
    renderUi(
      <AgentConversationReader
        presentation={withOrderedFlow({
          items: [
            {
              id: 'draft-thinking',
              kind: 'status',
              label: '内部准备状态',
              state: 'active'
            },
            {
              id: 'permission-needed',
              kind: 'permission_request',
              label: '等待写入审批',
              state: 'pending'
            },
            {
              id: 'question-needed',
              kind: 'elicitation_request',
              label: '等待用户选择',
              state: 'pending'
            }
          ]
        })}
      />
    )

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).not.toHaveTextContent('内部准备状态')
    expect(panel).toHaveTextContent('等待写入审批')
    expect(panel).toHaveTextContent('等待用户选择')
  })

  it('keeps terminal attention rows and the matching recovery outcome', () => {
    renderUi(
      <AgentConversationReader
        presentation={withOrderedFlow({
          active: false,
          status: { kind: 'resource_limit' },
          items: [
            {
              id: 'draft-complete',
              kind: 'status',
              label: '内部完成状态',
              state: 'complete'
            },
            {
              id: 'resource-boundary',
              kind: 'status',
              label: '资源边界事件',
              state: 'resource_limit'
            }
          ]
        })}
      />
    )

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).not.toHaveTextContent('内部完成状态')
    expect(panel).toHaveTextContent('资源边界事件')
    expect(panel).toHaveTextContent('已达到资源边界')
  })
})
