import { describe, expect, it } from 'vitest'
import { presentAgentTurnProvenance } from '../../src/renderer/src/agent-conversation-state'
import type { AgentChatTurn } from '../../src/shared/teaching-types'

const createdAt = '2026-07-14T10:00:00.000Z'

function turn(metadata?: AgentChatTurn['metadata']): AgentChatTurn {
  return { id: 'turn-1', role: 'assistant', content: 'Answer', createdAt, metadata }
}

describe('presentAgentTurnProvenance', () => {
  it('treats legacy turns without provenance as original', () => {
    expect(presentAgentTurnProvenance(turn())).toEqual({
      kind: 'original',
      label: '原始轮次',
      detail: '当前分支的原始对话记录'
    })
  })

  it('presents replayed turns with their source branch and turn', () => {
    expect(presentAgentTurnProvenance(turn({
      version: 1,
      provenance: {
        kind: 'replayed',
        sourceConversationId: 'conversation-source',
        sourceBranchId: 'branch-source',
        sourceTurnId: 'turn-source',
        replayId: 'replay-1'
      }
    }))).toEqual({
      kind: 'replayed',
      label: '回放结果',
      detail: '来源 branch-source · turn-source'
    })
  })

  it('labels recovery notices as recovery boundaries rather than replayed model output', () => {
    expect(presentAgentTurnProvenance(turn({
      version: 1,
      provenance: { kind: 'recovery_notice' }
    }))).toEqual({
      kind: 'recovery_notice',
      label: '恢复提示',
      detail: '运行恢复边界，不是模型重放结果'
    })
  })
})
