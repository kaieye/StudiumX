import { describe, expect, it } from 'vitest'
import { agentRuntimeEventFromWire, agentRuntimeEventToWire } from '../../src/main/ai/agent-runtime-wire'

describe('agent runtime wire', () => {
  it('serializes a closed-set event without shared references', () => {
    const payload = { usage: { inputTokens: 2 } }
    const wire = agentRuntimeEventToWire({ streamId: 's1', kind: 'usage', payload, sequence: 1, createdAt: '2026-01-01T00:00:00.000Z' })
    payload.usage.inputTokens = 9
    expect(wire.payload?.usage).toEqual({ inputTokens: 2 })
    expect(agentRuntimeEventFromWire(wire)).toEqual(wire)
  })

  it('rejects invalid sequence and stream', () => {
    expect(() => agentRuntimeEventToWire({ streamId: '', kind: 'status', sequence: 0 })).toThrow()
    expect(() => agentRuntimeEventToWire({ streamId: 's', kind: 'status', sequence: -1 })).toThrow()
  })
})
