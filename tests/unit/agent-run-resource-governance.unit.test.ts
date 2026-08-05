import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentLoopExecutionState } from '../../src/main/ai/agent-loop-execution-state'
import {
  AgentRunResourceBoundaryError,
  AgentRunResourceGovernor
} from '../../src/main/ai/agent-run-resource-governance'

describe('AgentRunResourceGovernor', () => {
  it('keeps the unconditional high emergency fuse when no limits are configured', () => {
    const governor = new AgentRunResourceGovernor({
      governance: { emergencyFuse: { limits: [] } }
    })

    const audit = governor.audit()
    expect(audit.configured).toEqual(expect.arrayContaining([
      expect.objectContaining({
        layer: 'emergency_fuse',
        meter: 'logical_requests',
        limit: 10_000,
        auditId: 'host_emergency_logical_requests'
      }),
      expect.objectContaining({
        layer: 'emergency_fuse',
        meter: 'total_tokens',
        limit: 100_000_000,
        auditId: 'host_emergency_total_tokens'
      })
    ]))
    governor.dispose()
  })

  it('stops at an explicit user logical-request boundary', () => {
    const governor = new AgentRunResourceGovernor({
      governance: {
        userBudget: {
          limits: [{ meter: 'logical_requests', limit: 1, scope: 'task', auditId: 'user-requests' }]
        }
      }
    })

    governor.claim('logical_requests')
    expect(() => governor.claim('logical_requests')).toThrow(AgentRunResourceBoundaryError)
    expect(governor.boundary).toMatchObject({
      layer: 'user_budget',
      meter: 'logical_requests',
      used: 1,
      limit: 1,
      action: 'resource_limit',
      auditId: 'user-requests'
    })
    governor.dispose()
  })

  it('forwards only child token deltas while aggregating sibling lanes', () => {
    const parentGovernor = new AgentRunResourceGovernor({
      governance: {
        userBudget: {
          limits: [{ meter: 'total_tokens', limit: 65, scope: 'run', auditId: 'shared-child-tokens' }]
        }
      }
    })
    const firstChild = parentGovernor.createChild()
    const secondChild = parentGovernor.createChild()

    // Provider totals are cumulative per child execution lane. Reporting 50
    // after 20 must forward only the additional 30, not add both readings.
    firstChild.consume('total_tokens', 20)
    firstChild.consume('total_tokens', 50)
    expect(parentGovernor.boundary).toBeUndefined()
    secondChild.consume('total_tokens', 15)

    expect(parentGovernor.boundary).toMatchObject({
      layer: 'user_budget',
      meter: 'total_tokens',
      used: 65,
      limit: 65,
      action: 'resource_limit',
      auditId: 'shared-child-tokens'
    })
    firstChild.dispose()
    secondChild.dispose()
    parentGovernor.dispose()
  })

  it('uses suspended for a custom emergency fuse boundary', () => {
    const governor = new AgentRunResourceGovernor({
      governance: {
        emergencyFuse: {
          limits: [{ meter: 'tool_operation_attempts', limit: 1, scope: 'run', auditId: 'test-fuse' }]
        }
      }
    })

    governor.claim('tool_operation_attempts')
    expect(() => governor.claim('tool_operation_attempts')).toThrow(AgentRunResourceBoundaryError)
    expect(governor.boundary).toMatchObject({
      layer: 'emergency_fuse',
      meter: 'tool_operation_attempts',
      action: 'suspended',
      auditId: 'test-fuse'
    })
    governor.dispose()
  })
})

describe('AgentLoopExecutionState injected governor cancellation', () => {
  it('preserves an ordinary external cancellation signal when using a child ledger', () => {
    const controller = new AbortController()
    const parentGovernor = new AgentRunResourceGovernor({})
    const childGovernor = parentGovernor.createChild()
    const execution = new AgentLoopExecutionState({
      now: () => 1_000,
      signal: controller.signal,
      resourceGovernor: childGovernor
    })

    controller.abort('user_cancel')

    expect(execution.signal.aborted).toBe(true)
    expect(execution.isCanceled).toBe(true)
    expect(execution.isResourceTerminated).toBe(false)
    childGovernor.dispose()
    parentGovernor.dispose()
  })
})


describe('AgentLoopExecutionState shared governor lifecycle', () => {
  afterEach(() => vi.useRealTimers())

  it('does not dispose an injected shared governor after a nested loop completes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T00:00:00.000Z'))
    const governor = new AgentRunResourceGovernor({
      governance: {
        userBudget: {
          limits: [{ meter: 'duration_ms', limit: 20, scope: 'task', auditId: 'shared-duration' }]
        }
      }
    })
    const execution = new AgentLoopExecutionState({ now: Date.now, resourceGovernor: governor })

    execution.completed([], { finalText: 'nested done', toolsSupported: true, stopReason: 'final_answer' })
    await vi.advanceTimersByTimeAsync(20)

    expect(governor.boundary).toMatchObject({
      layer: 'user_budget',
      meter: 'duration_ms',
      used: 20,
      limit: 20,
      action: 'resource_limit'
    })
    governor.dispose()
  })
})

describe('AgentLoopExecutionState resource terminal ordering', () => {
  it('checks duration before publishing done', () => {
    let now = 0
    const statuses: string[] = []
    const execution = new AgentLoopExecutionState({
      now: () => now,
      resourceGovernance: {
        userBudget: {
          limits: [{ meter: 'duration_ms', limit: 100, scope: 'task', auditId: 'user-duration' }]
        }
      },
      onEvent: (event) => {
        if (event.type === 'status') statuses.push(event.status)
      }
    })

    now = 100
    const result = execution.completed([], {
      finalText: 'should not be successful',
      toolsSupported: true,
      stopReason: 'final_answer'
    })

    expect(result.stopReason).toBe('resource_limit')
    expect(result.finalText).toBe('')
    expect(statuses).toContain('resource_limit')
    expect(statuses).not.toContain('done')
  })
})

describe('AgentLoopExecutionState operation accounting', () => {
  it('keeps logical, transport, retry, recovery, compaction, and tool counters independent', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
    execution.startLogicalRequest()
    execution.startProviderCall()
    execution.noteProviderRetry(2, 'rate_limit', 25)
    execution.noteContextOverflowRecovery()
    execution.startCompactionOperation()
    execution.startCompactionSummaryAttempt()
    execution.ensureToolOperationCapacity(2)
    execution.startToolCall()
    execution.startToolCall()

    expect(execution.completed([], {
      finalText: 'done',
      toolsSupported: true,
      stopReason: 'final_answer'
    }).usage.operationAccounting).toEqual({
      logicalRequests: 1,
      providerTransportAttempts: 1,
      transportRetries: 1,
      overflowRecoveries: 1,
      compactionOperations: 1,
      compactionSummaryAttempts: 1,
      toolOperationAttempts: 2
    })
  })
})
