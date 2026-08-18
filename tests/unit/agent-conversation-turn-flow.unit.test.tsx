import { describe, expect, it } from 'vitest'
import { AgentConversationTurnFlow } from '../../src/renderer/src/views/agent-conversation/AgentConversationTurnFlow'
import type { AgentConversationFlowItem } from '../../src/renderer/src/agent-conversation-presentation'
import { renderUi, screen, setupUser } from '../helpers/render'

const rawToolDetail = 'token=tool-secret /Users/learner/private/tool-result.txt'

const flow: AgentConversationFlowItem[] = [
  {
    id: 'flow-think-1',
    kind: 'process',
    item: {
      id: 'think-1',
      kind: 'reasoning',
      label: 'provider-facing reasoning title',
      detail: '先检查已有上下文。\n确认下一步。',
      state: 'complete'
    }
  },
  { id: 'flow-text-1', kind: 'assistant_text', content: '第一段模型输出。' },
  {
    id: 'flow-tool',
    kind: 'process',
    item: {
      id: 'tool-1',
      kind: 'tool_call',
      label: 'READ',
      detail: rawToolDetail,
      state: 'complete',
      disclosure: {
        eligible: true,
        label: 'notes/lesson.md',
        arguments: '{\n  "path": "notes/lesson.md"\n}',
        result: '{\n  "ok": true\n}',
        resultState: 'available'
      }
    }
  },
  {
    id: 'flow-think-2',
    kind: 'process',
    item: {
      id: 'think-2',
      kind: 'reasoning',
      label: 'Think',
      detail: '根据读取结果组织最终答复。',
      state: 'complete'
    }
  },
  { id: 'flow-text-final', kind: 'assistant_text', content: '最终模型输出。' }
]

describe('AgentConversationTurnFlow', () => {
  it('renders Think, model prose, a stable tool row, Think, and final prose in arrival order', async () => {
    const user = setupUser()
    const { container } = renderUi(<AgentConversationTurnFlow flow={flow} />)

    const text = container.textContent ?? ''
    const firstThink = text.indexOf('Think')
    const firstModelText = text.indexOf('第一段模型输出。')
    const tool = text.indexOf('READ')
    const secondThink = text.indexOf('Think', tool + 1)
    const finalText = text.indexOf('最终模型输出。')

    expect(firstThink).toBeGreaterThanOrEqual(0)
    expect(firstModelText).toBeGreaterThan(firstThink)
    expect(tool).toBeGreaterThan(firstModelText)
    expect(secondThink).toBeGreaterThan(tool)
    expect(finalText).toBeGreaterThan(secondThink)
    expect(text.match(/最终模型输出。/g)).toHaveLength(1)

    const thinkToggles = screen.getAllByRole('button', { name: '展开思考内容' })
    expect(thinkToggles).toHaveLength(2)
    for (const toggle of thinkToggles) {
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    }

    const toolToggle = screen.getByRole('button', { name: '展开READ详情' })
    expect(toolToggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toolToggle)

    expect(screen.getByRole('button', { name: '收起READ详情' })).toHaveAttribute('aria-expanded', 'true')
    const afterExpand = container.textContent ?? ''
    expect(afterExpand).toContain('IN')
    expect(afterExpand).toContain('OUT')
    expect(afterExpand).not.toContain(rawToolDetail)
    expect(afterExpand).not.toContain('tool-secret')
    expect(afterExpand).not.toContain('/Users/learner')
  })
})
