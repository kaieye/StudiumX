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
  it('classifies provider-specific overflow patterns without retry', () => {
    const samples = [
      'prompt is too long: 213462 tokens > 200000 maximum',
      'Your input exceeds the context window of this model',
      'The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)',
      'model_context_window_exceeded',
      'invalid params, context window exceeds limit',
      '400 status code (no body)',
      '请求失败：上下文超限'
    ]
    for (const sample of samples) {
      const d = classifyProviderRecovery(sample)
      expect(d.class, sample).toBe('context_overflow')
      expect(d.retryable, sample).toBe(false)
      expect(d.shouldCompress, sample).toBe(true)
    }
  })

  it('does not treat Bedrock throttling "Too many tokens" as context_overflow', () => {
    const d = classifyProviderRecovery(
      'ThrottlingException: Too many tokens, please wait before trying again.'
    )
    expect(d.class).not.toBe('context_overflow')
    expect(d.shouldCompress).toBe(false)
  })

  it('classifies silent overflow when error object carries usage + stop + contextWindow', () => {
    const dStop = classifyProviderRecovery({
      message: 'ok',
      stopReason: 'stop',
      usage: { input: 90_000, output: 10, cacheRead: 20_000 },
      contextWindow: 100_000
    })
    expect(dStop.class).toBe('context_overflow')
    expect(dStop.retryable).toBe(false)
    expect(dStop.shouldCompress).toBe(true)

    const dLength = classifyProviderRecovery({
      finish_reason: 'length',
      usage: { input: 99_500, output: 0 },
      contextWindow: 100_000
    })
    expect(dLength.class).toBe('context_overflow')
    expect(dLength.retryable).toBe(false)
    expect(dLength.shouldCompress).toBe(true)
  })

  it('still treats bare finish_reason length without usage as max_tokens', () => {
    const d = classifyProviderRecovery({ finish_reason: 'length' })
    expect(d.class).toBe('max_tokens')
    expect(d.retryable).toBe(false)
  })

  it('classifies platform capability gaps separately from empty_stream and never retries them', () => {
    const d1 = classifyProviderRecovery(
      'NativeContainedDurableReplaceUnavailableError: descriptor-relative contained directory is unsupported_platform'
    )
    expect(d1.reasonCode).toBe('platform_capability')
    expect(d1.retryable).toBe(false)
    expect(d1.class).not.toBe('empty_stream')

    const d2 = classifyProviderRecovery('platform capability: windows_direct_path unavailable')
    expect(d2.reasonCode).toBe('platform_capability')
    expect(d2.retryable).toBe(false)
  })

})
