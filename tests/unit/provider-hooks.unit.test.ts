import { describe, expect, it } from 'vitest'
import {
  ProviderHookLedger,
  normalizeProviderMetadata,
  normalizeStopReason,
  type ProviderHookEvent
} from '../../src/main/ai/provider-hooks'

function feed(events: ProviderHookEvent[]): ProviderHookLedger {
  const ledger = new ProviderHookLedger()
  for (const event of events) ledger.record(event)
  return ledger
}

describe('ProviderHookLedger idempotency', () => {
  it('does not double-count a call when request_started arrives twice', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'request_started', callId: 'c1' },
      { kind: 'usage', callId: 'c1', usage: { totalTokens: 10 } },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.calls).toBe(1)
    expect(snapshot.completed).toBe(1)
    expect(snapshot.usage.totalTokens).toBe(10)
  })

  it('does not double-bill when usage for the same call is repeated', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'usage', callId: 'c1', usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 } },
      { kind: 'usage', callId: 'c1', usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 } },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.usage).toMatchObject({ promptTokens: 30, completionTokens: 20, totalTokens: 50 })
  })

  it('applies last-wins for partial then final usage within one call', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'usage', callId: 'c1', usage: { promptTokens: 30 } },
      { kind: 'usage', callId: 'c1', usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 } },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.usage).toMatchObject({ promptTokens: 30, completionTokens: 20, totalTokens: 50 })
  })

  it('sums usage across distinct calls', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'usage', callId: 'c1', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { kind: 'stop', callId: 'c1' },
      { kind: 'request_started', callId: 'c2' },
      { kind: 'usage', callId: 'c2', usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } },
      { kind: 'stop', callId: 'c2' }
    ]).snapshot()

    expect(snapshot.calls).toBe(2)
    expect(snapshot.usage).toMatchObject({ promptTokens: 30, completionTokens: 15, totalTokens: 45 })
  })

  it('tolerates out-of-order events (usage and stop before request_started)', () => {
    const snapshot = feed([
      { kind: 'usage', callId: 'c1', usage: { totalTokens: 42 } },
      { kind: 'stop', callId: 'c1' },
      { kind: 'request_started', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.calls).toBe(1)
    expect(snapshot.completed).toBe(1)
    expect(snapshot.usage.totalTokens).toBe(42)
  })

  it('keeps the first terminal outcome when stop and cancel race', () => {
    const stopFirst = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'stop', callId: 'c1' },
      { kind: 'canceled', callId: 'c1' }
    ]).snapshot()
    expect(stopFirst.completed).toBe(1)
    expect(stopFirst.canceled).toBe(0)

    const cancelFirst = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'canceled', callId: 'c1' },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()
    expect(cancelFirst.canceled).toBe(1)
    expect(cancelFirst.completed).toBe(0)
  })

  it('dedupes retries by attempt and counts distinct attempts', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'retry', callId: 'c1', attempt: 1 },
      { kind: 'retry', callId: 'c1', attempt: 1 },
      { kind: 'retry', callId: 'c1', attempt: 2 },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.retries).toBe(2)
  })

  it('dedupes rate-limit signals by attempt', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'rate_limit', callId: 'c1', attempt: 1 },
      { kind: 'rate_limit', callId: 'c1', attempt: 1 },
      { kind: 'rate_limit', callId: 'c1', attempt: 2 },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.rateLimited).toBe(2)
  })

  it('records the earliest first-token latency across duplicate signals', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'first_token', callId: 'c1', at: 120 },
      { kind: 'first_token', callId: 'c1', at: 90 },
      { kind: 'first_token', callId: 'c1', at: 150 },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.firstTokenAtMs).toBe(90)
  })

  it('redacts and retains the last error text', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'error', callId: 'c1', message: 'boom with api_key=sk-secret123456' }
    ]).snapshot()

    expect(snapshot.errored).toBe(1)
    expect(snapshot.lastError).toBeDefined()
    expect(snapshot.lastError).not.toContain('sk-secret123456')
  })

  it('rejects events without a callId', () => {
    const ledger = new ProviderHookLedger()
    expect(() => ledger.record({ kind: 'request_started', callId: '  ' })).toThrow()
  })
})

describe('ProviderHookLedger provenance semantics', () => {
  it('reports provider_reported when all usage came from the provider', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'usage', callId: 'c1', usage: { totalTokens: 10 }, source: 'provider_reported' },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.usageProvenance).toBe('provider_reported')
    expect(snapshot.hasUnknownUsage).toBe(false)
  })

  it('downgrades to local_estimate when any call was estimated', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'usage', callId: 'c1', usage: { totalTokens: 10 }, source: 'provider_reported' },
      { kind: 'stop', callId: 'c1' },
      { kind: 'request_started', callId: 'c2' },
      { kind: 'usage', callId: 'c2', usage: { totalTokens: 8 }, source: 'local_estimate' },
      { kind: 'stop', callId: 'c2' }
    ]).snapshot()

    expect(snapshot.usageProvenance).toBe('local_estimate')
  })

  it('reports unknown provenance and flags missing usage when a completed call reported none', () => {
    const snapshot = feed([
      { kind: 'request_started', callId: 'c1' },
      { kind: 'stop', callId: 'c1' }
    ]).snapshot()

    expect(snapshot.usageProvenance).toBe('unknown')
    expect(snapshot.hasUnknownUsage).toBe(true)
  })
})

describe('normalizeProviderMetadata', () => {
  it('drops secret-looking keys and coerces primitives', () => {
    const result = normalizeProviderMetadata({
      model: 'gpt-x',
      temperature: 0.7,
      streaming: true,
      api_key: 'sk-should-not-appear',
      authorization: 'Bearer nope',
      nested: { deep: true }
    })

    expect(result).toEqual({ model: 'gpt-x', temperature: 0.7, streaming: true })
  })

  it('returns undefined for non-object or empty inputs', () => {
    expect(normalizeProviderMetadata(null)).toBeUndefined()
    expect(normalizeProviderMetadata('nope')).toBeUndefined()
    expect(normalizeProviderMetadata({})).toBeUndefined()
  })

  it('caps the number of retained keys', () => {
    const raw: Record<string, number> = {}
    for (let i = 0; i < 100; i++) raw[`k${i}`] = i
    const result = normalizeProviderMetadata(raw)
    expect(Object.keys(result ?? {}).length).toBeLessThanOrEqual(24)
  })
})

describe('normalizeStopReason', () => {
  it('folds known provider reasons into the normalized set', () => {
    expect(normalizeStopReason('end_turn')).toBe('stop')
    expect(normalizeStopReason('max_tokens')).toBe('length')
    expect(normalizeStopReason('tool_use')).toBe('tool_calls')
    expect(normalizeStopReason('content_filter')).toBe('content_filter')
    expect(normalizeStopReason('aborted')).toBe('canceled')
  })

  it('maps unknown or missing reasons to other', () => {
    expect(normalizeStopReason('something_new')).toBe('other')
    expect(normalizeStopReason(undefined)).toBe('other')
  })
})
