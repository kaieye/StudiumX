import { describe, expect, it } from 'vitest'
import { AgentLoopExecutionState } from '../../src/main/ai/agent-loop-execution-state'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'


describe('AgentLoopExecutionState token accounting', () => {
  it('keeps provider-reported total tokens when prompt and completion components are unavailable', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
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
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
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
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ totalTokens: 50 })

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.usage.usageProvenance).toBe('provider_reported')
  })

  it('marks local_estimate when any provider usage was estimated', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ totalTokens: 50 }, 'local_estimate')

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.usage.usageProvenance).toBe('local_estimate')
  })

  it('marks usage provenance unknown when no provider usage is reported', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage(undefined)

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.usage.usageProvenance).toBe('unknown')
  })

  it('derives a bounded local total from complete provider components when total is absent', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ promptTokens: 60, completionTokens: 40 })

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.usage).toMatchObject({
      promptTokens: 60,
      completionTokens: 40,
      totalTokens: 100,
      usageProvenance: 'local_estimate'
    })
  })
})

describe('AgentLoopExecutionState token resource accounting', () => {
  const tokenBoundary = {
    userBudget: {
      limits: [{ meter: 'total_tokens' as const, limit: 100, scope: 'task' as const, auditId: 'user-total-100' }]
    }
  }

  it('does not enforce a total-token boundary from a local estimate', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000, resourceGovernance: tokenBoundary })
    execution.startProviderCall()
    execution.recordProviderUsage({ promptTokens: 60, completionTokens: 40 })

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.stopReason).toBe('final_answer')
    expect(result.usage.usageProvenance).toBe('local_estimate')
    expect(result.usage.resourceGovernance?.terminal).toBeUndefined()
  })

  it('enforces a total-token boundary from an explicit provider total', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000, resourceGovernance: tokenBoundary })
    execution.startProviderCall()
    execution.recordProviderUsage({ totalTokens: 100 })

    const result = execution.completed([], { finalText: 'done', toolsSupported: true, stopReason: 'final_answer' })

    expect(result.stopReason).toBe('resource_limit')
    expect(result.usage.resourceGovernance?.terminal).toMatchObject({
      layer: 'user_budget',
      meter: 'total_tokens',
      used: 100,
      limit: 100
    })
  })
})

describe('AgentLoopExecutionState terminal stop reasons', () => {
  it.each(['no_progress', 'context_unrecoverable'] as const)(
    'emits %s as its distinct terminal status',
    (stopReason) => {
      const events: AgentLoopEvent[] = []
      const execution = new AgentLoopExecutionState({ now: () => 1_000, onEvent: (event) => events.push(event) })

      const result = execution.failed([], true, undefined, 'Stopped without automatic continuation.', stopReason)

      expect(result.stopReason).toBe(stopReason)
      expect(events).toContainEqual({
        type: 'status',
        status: stopReason,
        message: 'Stopped without automatic continuation.'
      })
    }
  )
})
