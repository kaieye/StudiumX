import { describe, expect, it } from 'vitest'
import {
  classifyProviderError,
  providerErrorReason,
  redactProviderErrorText
} from '../../src/shared/provider-error'

describe('classifyProviderError (A-03)', () => {
  it('maps 402 / insufficient balance to insufficient_balance', () => {
    const info = classifyProviderError(
      'Provider 返回 402 Payment Required：{"error":{"message":"Insufficient Balance","type":"unknown_error","code":"invalid_request_error"}}'
    )
    expect(info?.kind).toBe('insufficient_balance')
    expect(info?.status).toBe(402)
    expect(info?.providerMessage).toContain('Insufficient Balance')
    expect(providerErrorReason(info!)).toBe('Provider 余额或配额不足')
  })

  it('maps bare "quota exceeded" to insufficient_balance, never rate_limit', () => {
    const info = classifyProviderError('quota exceeded')
    expect(info?.kind).toBe('insufficient_balance')
    expect(info?.kind).not.toBe('rate_limit')
    expect(providerErrorReason(info!)).toBe('Provider 余额或配额不足')
  })

  it('maps insufficient_quota / billing exhaustion to insufficient_balance', () => {
    expect(classifyProviderError('Error: insufficient_quota')?.kind).toBe('insufficient_balance')
    expect(classifyProviderError('billing hard limit exceeded')?.kind).toBe('insufficient_balance')
    expect(classifyProviderError('You exceeded your current quota')?.kind).toBe('insufficient_balance')
    expect(classifyProviderError('额度不足')?.kind).toBe('insufficient_balance')
    expect(classifyProviderError('配额已用完')?.kind).toBe('insufficient_balance')
  })

  it('maps true 429 / rate limit to rate_limit only', () => {
    const info = classifyProviderError('Provider 返回 429 Too Many Requests：rate limit exceeded')
    expect(info?.kind).toBe('rate_limit')
    expect(info?.status).toBe(429)
    expect(providerErrorReason(info!)).toBe('Provider 速率限制')
    expect(classifyProviderError('too many requests, please slow down')?.kind).toBe('rate_limit')
  })

  it('does not treat "quota exceeded" mixed into 429 body as rate_limit when quota language dominates', () => {
    // Explicit quota phrases win even if status looks like 429, so future retry
    // never treats billing exhaustion as throttle.
    const info = classifyProviderError(
      'Provider 返回 429：{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}'
    )
    expect(info?.kind).toBe('insufficient_balance')
  })

  it('classifies authentication and generic http', () => {
    expect(classifyProviderError('Provider 返回 401 Unauthorized：{"error":{"message":"Invalid API key"}}')?.kind).toBe(
      'authentication'
    )
    expect(classifyProviderError('Provider 返回 500 Internal Server Error')?.kind).toBe('http')
  })

  it('redacts secrets', () => {
    const redacted = redactProviderErrorText(
      'Authorization: Bearer sk-testsecret123456789 api_key=abc123 https://user:pass@example.test {"apiKey":"secret-value"}'
    )
    expect(redacted).not.toMatch(/sk-testsecret123456789|api_key=abc123|user:pass|secret-value/)
    expect(redacted).toMatch(/\[redacted\]/)
  })
})
