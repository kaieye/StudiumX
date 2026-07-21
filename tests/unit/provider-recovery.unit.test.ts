import { describe, expect, it } from 'vitest'
import { classifyProviderRecovery } from '../../src/shared/provider-recovery'

describe('classifyProviderRecovery (A-04)', () => {
  it('never marks billing / quota as retryable', () => {
    for (const input of [
      'quota exceeded',
      'insufficient_quota',
      'Provider 返回 402 Payment Required：Insufficient Balance',
      'billing hard limit exceeded',
      '余额不足'
    ]) {
      const d = classifyProviderRecovery(input)
      expect(d.class).toBe('billing')
      expect(d.retryable).toBe(false)
      expect(d.shouldCompress).toBe(false)
      expect(d.uxKind).toBe('insufficient_balance')
      expect(d.reasonCode).toBe('billing_or_quota')
    }
  })

  it('never marks permanent auth as retryable', () => {
    const d = classifyProviderRecovery('Provider 返回 401 Unauthorized：Invalid API key')
    expect(d.class).toBe('authentication')
    expect(d.retryable).toBe(false)
    expect(d.shouldFallback).toBe(false)
    expect(d.uxKind).toBe('authentication')
  })

  it('marks rate_limit retryable without implementing a retry loop', () => {
    const d = classifyProviderRecovery('Provider 返回 429 Too Many Requests：rate limit exceeded')
    expect(d.class).toBe('rate_limit')
    expect(d.retryable).toBe(true)
    expect(d.shouldFallback).toBe(true)
    expect(d.uxKind).toBe('rate_limit')
  })

  it('classifies empty stream independently and as retryable', () => {
    const named = Object.assign(new Error('stream closed with no content'), { name: 'EmptyStreamError' })
    const d1 = classifyProviderRecovery(named)
    expect(d1.class).toBe('empty_stream')
    expect(d1.retryable).toBe(true)
    expect(d1.reasonCode).toBe('empty_stream')

    const d2 = classifyProviderRecovery('empty stream: no chunks received')
    expect(d2.class).toBe('empty_stream')
    expect(d2.retryable).toBe(true)
  })

  it('never retries context overflow; prefers compress', () => {
    const d = classifyProviderRecovery('context_length_exceeded: maximum context length exceeded')
    expect(d.class).toBe('context_overflow')
    expect(d.retryable).toBe(false)
    expect(d.shouldCompress).toBe(true)
  })

  it('never retries max-tokens / length truncation', () => {
    const d1 = classifyProviderRecovery({ finish_reason: 'length' })
    expect(d1.class).toBe('max_tokens')
    expect(d1.retryable).toBe(false)

    const d2 = classifyProviderRecovery('finish_reason=max_tokens response truncated')
    expect(d2.class).toBe('max_tokens')
    expect(d2.retryable).toBe(false)
  })

  it('classifies timeout / network / server_error as retryable', () => {
    expect(classifyProviderRecovery({ kind: 'timeout', message: 'request timed out' })).toMatchObject({
      class: 'timeout',
      retryable: true
    })
    expect(classifyProviderRecovery({ kind: 'network', message: 'ECONNRESET' })).toMatchObject({
      class: 'network',
      retryable: true
    })
    expect(classifyProviderRecovery('Provider 返回 502 Bad Gateway')).toMatchObject({
      class: 'server_error',
      retryable: true,
      uxKind: 'http'
    })
  })

  it('classifies overloaded and payload_too_large', () => {
    expect(classifyProviderRecovery('Provider 返回 503 Service Unavailable: overloaded')).toMatchObject({
      class: 'overloaded',
      retryable: true
    })
    expect(classifyProviderRecovery('Provider 返回 413 Payload Too Large')).toMatchObject({
      class: 'payload_too_large',
      retryable: false,
      shouldCompress: true
    })
  })

  it('classifies content_policy and format_error as non-retryable', () => {
    expect(classifyProviderRecovery('content_policy_violation: blocked by policy')).toMatchObject({
      class: 'content_policy',
      retryable: false,
      shouldFallback: true
    })
    expect(classifyProviderRecovery('invalid_request: tool schema malformed')).toMatchObject({
      class: 'format_error',
      retryable: false
    })
  })

  it('falls back to http / unknown without inventing retryability', () => {
    expect(classifyProviderRecovery('Provider 返回 418 I am a teapot')).toMatchObject({
      class: 'http',
      retryable: false,
      uxKind: 'http'
    })
    expect(classifyProviderRecovery('something completely opaque')).toMatchObject({
      class: 'unknown',
      retryable: false
    })
  })
})
