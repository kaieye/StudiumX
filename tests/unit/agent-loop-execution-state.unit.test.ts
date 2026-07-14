import { describe, expect, it } from 'vitest'
import { AgentLoopExecutionState } from '../../src/main/ai/agent-loop-execution-state'

const budget = {
  maxDurationMs: 60_000,
  maxProviderCalls: 10,
  maxToolCalls: 10,
  maxTotalTokens: 100_000,
  warningThreshold: 0.8
}

describe('AgentLoopExecutionState token accounting', () => {
  it('keeps provider-reported total tokens when prompt and completion components are unavailable', () => {
    const execution = new AgentLoopExecutionState({ budget, now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ totalTokens: 77 })

    const result = execution.completed([], {
      finalText: 'done',
      toolsSupported: true,
      stopReason: 'final_answer'
    })

    expect(result.usage.totalTokens).toBe(77)
    expect(result.usage).not.toHaveProperty('promptTokens')
    expect(result.usage).not.toHaveProperty('completionTokens')
  })

  it('retains known token counts when another provider call omits usage', () => {
    const execution = new AgentLoopExecutionState({ budget, now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ promptTokens: 60, completionTokens: 40, totalTokens: 100 })
    execution.startProviderCall()
    execution.recordProviderUsage(undefined)

    const result = execution.completed([], {
      finalText: 'done',
      toolsSupported: true,
      stopReason: 'final_answer'
    })

    expect(result.usage).toMatchObject({ promptTokens: 60, completionTokens: 40, totalTokens: 100 })
  })
})

describe('AgentLoopExecutionState usage provenance', () => {
  it('marks provider-reported usage when tokens came from the provider', () => {
    const execution = new AgentLoopExecutionState({ budget, now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ totalTokens: 50 })

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.usage.usageProvenance).toBe('provider_reported')
  })

  it('marks local_estimate when any provider usage was estimated', () => {
    const execution = new AgentLoopExecutionState({ budget, now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ totalTokens: 50 }, 'local_estimate')

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.usage.usageProvenance).toBe('local_estimate')
  })

  it('omits provenance when no provider tokens were reported', () => {
    const execution = new AgentLoopExecutionState({ budget, now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage(undefined)

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.usage).not.toHaveProperty('usageProvenance')
  })
})
