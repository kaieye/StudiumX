import { describe, expect, it } from 'vitest'
import {
  collapseConsecutiveAssistantTurns,
  sanitizeAgentConversationTurns,
  sanitizeAgentTurnContent
} from '../../src/shared/agent-conversation-turns'
import type { AgentChatTurn } from '../../src/shared/teaching-types'

const createdAt = '2026-07-16T13:52:23.000Z'

function turn(partial: Partial<AgentChatTurn> & Pick<AgentChatTurn, 'id' | 'role'>): AgentChatTurn {
  return {
    content: '',
    createdAt,
    ...partial
  }
}

describe('agent conversation turn collapse', () => {
  it('collapses multi-step tool-loop assistant turns into one durable reply', () => {
    const collapsed = collapseConsecutiveAssistantTurns([
      turn({ id: 'u0', role: 'user', content: '我想学习claude code' }),
      turn({
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'c1', name: 'list_workspace', arguments: '{}' }]
      }),
      turn({
        id: 'a2',
        role: 'assistant',
        content: '先确认起点',
        toolCalls: [{ id: 'c2', name: 'ask', arguments: '{"questions":[]}' }]
      }),
      turn({
        id: 'a3',
        role: 'assistant',
        content: '最终答复正文',
        metadata: {
          version: 1,
          sources: [{ sourceId: 'src-1', url: 'https://example.com', title: 'Guide' }]
        }
      })
    ])

    expect(collapsed).toHaveLength(2)
    expect(collapsed[0]).toMatchObject({ role: 'user', content: '我想学习claude code' })
    expect(collapsed[1]).toMatchObject({
      id: 'a1',
      role: 'assistant',
      content: '最终答复正文'
    })
    expect(collapsed[1].toolCalls?.map((toolCall) => toolCall.name)).toEqual(['list_workspace', 'ask'])
    expect(collapsed[1].metadata?.sources?.[0]?.url).toBe('https://example.com')
  })

  it('strips DSML tool markup from content and recovers structured tool calls', () => {
    const dsml = [
      '<｜｜DSML｜｜tool_calls>',
      '<｜｜DSML｜｜invoke name="write_workspace_file">',
      '<｜｜DSML｜｜parameter name="path" string="true">GLOSSARY.md</｜｜DSML｜｜parameter>',
      '<｜｜DSML｜｜parameter name="content" string="true"># Glossary</｜｜DSML｜｜parameter>',
      '</｜｜DSML｜｜invoke>',
      '</｜｜DSML｜｜tool_calls>'
    ].join('\n')

    expect(sanitizeAgentTurnContent(dsml)).toBe('')

    const sanitized = sanitizeAgentConversationTurns([
      turn({ id: 'u0', role: 'user', content: '继续' }),
      turn({ id: 'a1', role: 'assistant', content: dsml })
    ])

    expect(sanitized).toHaveLength(2)
    expect(sanitized[1].content).toBe('')
    expect(sanitized[1].toolCalls).toHaveLength(1)
    expect(sanitized[1].toolCalls?.[0]).toMatchObject({
      name: 'write_workspace_file'
    })
    expect(sanitized[1].toolCalls?.[0]?.arguments).toContain('GLOSSARY.md')
  })


  it('strips XML-style tool-call markup emitted by compatible providers from learner-visible content', () => {
    const rawToolCall = [
      '课程已生成。接下来补充术语表。',
      '<tool_call>write_workspace_file<arg_key>content</arg_key><arg_value># Glossary</arg_value><arg_key>overwrite</arg_key><arg_value>true</arg_value><arg_key>path</arg_key><arg_value>GLOSSARY.md</arg_value></tool_call>'
    ].join('\n')

    expect(sanitizeAgentTurnContent(rawToolCall)).toBe('课程已生成。接下来补充术语表。')
    expect(sanitizeAgentTurnContent('可见正文 <tool_call>write_workspace_file<arg_key>path</arg_key>')).toBe('可见正文')
  })

  it('strips unclosed DSML tool markup so raw tags never surface', () => {
    const partial = [
      '可见正文',
      '<｜｜DSML｜｜tool_calls>',
      '<｜｜DSML｜｜invoke name="write_workspace_file">',
      '<｜｜DSML｜｜parameter name="path" string="true">GLOSSARY.md'
    ].join('\n')

    expect(sanitizeAgentTurnContent(partial)).toBe('可见正文')
  })
})
