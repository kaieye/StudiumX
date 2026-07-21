import { describe, expect, it } from 'vitest'

import {
  annotationsForEffectClass,
  DEFAULT_TOOL_RESULT_BUDGET_BYTES,
  enforceToolResultBudget,
  resolveToolResultBudget
} from '../../src/main/ai/tools/annotations'
import { ToolDispatcher } from '../../src/main/ai/tools/dispatcher'
import type { ToolCall } from '../../src/main/ai/provider-adapter'

function toolCall(name: string, args = '{}'): ToolCall {
  return {
    id: `call-${name}`,
    type: 'function',
    function: { name, arguments: args }
  }
}

describe('tool annotations', () => {
  it('maps effect classes to risk annotations', () => {
    expect(annotationsForEffectClass('read')).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      risk: 'readonly'
    })
    expect(annotationsForEffectClass('workspace_write')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      risk: 'write'
    })
    expect(annotationsForEffectClass('external_write')).toMatchObject({
      openWorldHint: true,
      risk: 'network'
    })
    expect(annotationsForEffectClass('privileged')).toMatchObject({
      destructiveHint: true,
      risk: 'privileged'
    })
  })
})

describe('tool result budget', () => {
  it('defaults to 32KiB and leaves small payloads intact', () => {
    const policy = resolveToolResultBudget()
    expect(policy.maxBytes).toBe(DEFAULT_TOOL_RESULT_BUDGET_BYTES)
    const small = enforceToolResultBudget('hello')
    expect(small.truncated).toBe(false)
    expect(small.content).toBe('hello')
  })

  it('truncates oversized payloads with an explicit marker', () => {
    const body = 'x'.repeat(200)
    const result = enforceToolResultBudget(body, 80)
    expect(result.truncated).toBe(true)
    expect(result.originalBytes).toBe(200)
    expect(result.budgetBytes).toBe(80)
    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(80)
    expect(result.content).toContain('[truncated: tool result exceeded budget')
  })

  it('dispatcher applies budget on succeeded outcomes', async () => {
    const huge = 'y'.repeat(DEFAULT_TOOL_RESULT_BUDGET_BYTES + 2048)
    const dispatcher = new ToolDispatcher({
      handlers: {
        read_workspace_file: async () => huge
      }
    })
    const outcome = await dispatcher.dispatch(toolCall('read_workspace_file', '{"path":"MISSION.md"}'))
    expect(outcome.status).toBe('succeeded')
    expect(outcome.content.length).toBeLessThan(huge.length)
    expect(outcome.content).toContain('[truncated: tool result exceeded budget')
  })
})
