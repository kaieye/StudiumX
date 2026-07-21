import { describe, expect, it } from 'vitest'
import { buildAgentRuntimeStatus } from '../../src/main/ai/agent-runtime-status'

describe('agent runtime status', () => {
  it('aggregates injected state purely with safe defaults', () => {
    expect(buildAgentRuntimeStatus()).toEqual({ running: false, pendingPrompt: false, backgroundJobs: 0, cancelRequested: false, cancellable: false })
    expect(buildAgentRuntimeStatus({ active: true, pendingQuestion: true, jobs: 2 })).toEqual({ running: true, pendingPrompt: true, backgroundJobs: 2, cancelRequested: false, cancellable: true })
  })

  it('does not report cancellable after cancellation', () => {
    expect(buildAgentRuntimeStatus({ running: true, cancelRequested: true })).toMatchObject({ running: true, cancelRequested: true, cancellable: false })
  })
})
