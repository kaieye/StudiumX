import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PROVIDER_RETRY_MAX_ATTEMPTS,
  extractRetryAfterMsFromError,
  planProviderRetry,
  PROVIDER_RETRY_BASE_DELAY_MS,
  PROVIDER_RETRY_MAX_DELAY_MS,
  withProviderRetry
} from '../../src/shared/provider-retry'

describe('planProviderRetry (A-05)', () => {
  const budget = { maxAttempts: 3, attemptsUsed: 1 }

  it('retries rate_limit with full jitter within base bounds', () => {
    const plan = planProviderRetry({
      error: 'Provider 返回 429 Too Many Requests：rate limit exceeded',
      budget,
      random: () => 0.5
    })
    expect(plan.action).toBe('retry')
    if (plan.action !== 'retry') return
    expect(plan.attempt).toBe(2)
    expect(plan.reasonCode).toBe('rate_limit')
    expect(plan.decision.retryable).toBe(true)
    expect(plan.delayMs).toBe(Math.floor(0.5 * PROVIDER_RETRY_BASE_DELAY_MS))
    expect(plan.delayMs).toBeGreaterThanOrEqual(0)
    expect(plan.delayMs).toBeLessThanOrEqual(PROVIDER_RETRY_MAX_DELAY_MS)
  })

  it('never retries billing / quota', () => {
    for (const error of ['quota exceeded', 'insufficient_quota', '余额不足', 'Provider 返回 402 Payment Required']) {
      const plan = planProviderRetry({ error, budget, random: () => 0 })
      expect(plan.action).toBe('fail')
      if (plan.action !== 'fail') continue
      expect(plan.decision.class).toBe('billing')
      expect(plan.decision.retryable).toBe(false)
      expect(plan.reasonCode).toBe('billing_or_quota')
    }
  })

  it('never retries permanent auth', () => {
    const plan = planProviderRetry({
      error: 'Provider 返回 401 Unauthorized：Invalid API key',
      budget,
      random: () => 0
    })
    expect(plan.action).toBe('fail')
    if (plan.action !== 'fail') return
    expect(plan.decision.class).toBe('authentication')
    expect(plan.decision.retryable).toBe(false)
  })

  it('never retries max_tokens / length truncation', () => {
    const plan = planProviderRetry({
      error: { finish_reason: 'length' },
      budget,
      random: () => 0
    })
    expect(plan.action).toBe('fail')
    if (plan.action !== 'fail') return
    expect(plan.decision.class).toBe('max_tokens')
    expect(plan.decision.retryable).toBe(false)
  })

  it('never retries context overflow', () => {
    const plan = planProviderRetry({
      error: 'context_length_exceeded: maximum context length exceeded',
      budget,
      random: () => 0
    })
    expect(plan.action).toBe('fail')
    if (plan.action !== 'fail') return
    expect(plan.decision.class).toBe('context_overflow')
    expect(plan.decision.retryable).toBe(false)
    expect(plan.decision.shouldCompress).toBe(true)
  })

  it('fails when attempt budget is exhausted', () => {
    const plan = planProviderRetry({
      error: 'Provider 返回 429 rate limit',
      budget: { maxAttempts: 3, attemptsUsed: 3 },
      random: () => 0
    })
    expect(plan.action).toBe('fail')
    if (plan.action !== 'fail') return
    expect(plan.reasonCode).toBe('auto_retry_exhausted')
  })

  it('honors Retry-After as a floor with small jitter', () => {
    const plan = planProviderRetry({
      error: 'Provider 返回 429 rate limit',
      budget,
      retryAfterMs: 2_000,
      random: () => 0.4
    })
    expect(plan.action).toBe('retry')
    if (plan.action !== 'retry') return
    // max(backoff, 2000) + floor(0.4 * min(250, 200)) = 2000 + floor(0.4*200)=2000+80
    expect(plan.delayMs).toBeGreaterThanOrEqual(2_000)
    expect(plan.delayMs).toBeLessThanOrEqual(2_000 + 250)
    expect(plan.delayMs).toBe(2_080)
  })

  it('caps delay at PROVIDER_RETRY_MAX_DELAY_MS', () => {
    const plan = planProviderRetry({
      error: 'Provider 返回 503 overloaded',
      budget: { maxAttempts: 5, attemptsUsed: 4 },
      retryAfterMs: 60_000,
      random: () => 0.999
    })
    expect(plan.action).toBe('retry')
    if (plan.action !== 'retry') return
    expect(plan.delayMs).toBe(PROVIDER_RETRY_MAX_DELAY_MS)
  })

  it('defaults maxAttempts to 3', () => {
    expect(DEFAULT_PROVIDER_RETRY_MAX_ATTEMPTS).toBe(3)
  })
})

describe('extractRetryAfterMsFromError', () => {
  it('reads numeric retryAfterMs field', () => {
    expect(extractRetryAfterMsFromError({ retryAfterMs: 1500 })).toBe(1500)
  })

  it('reads retry-after header seconds', () => {
    expect(extractRetryAfterMsFromError({ headers: { 'retry-after': '2' } })).toBe(2000)
  })

  it('parses message text', () => {
    expect(extractRetryAfterMsFromError(new Error('retry-after: 1.5s'))).toBe(1500)
    expect(extractRetryAfterMsFromError('Retry-After=500ms')).toBe(500)
  })
})

describe('withProviderRetry', () => {
  it('retries rate_limit then succeeds without failing the run', async () => {
    const sleeps: number[] = []
    let calls = 0
    const onRetry = vi.fn()
    const result = await withProviderRetry({
      budget: { maxAttempts: 3, attemptsUsed: 0 },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 0.5,
      onRetry,
      run: async (attempt) => {
        calls += 1
        if (attempt === 1) throw new Error('Provider 返回 429 Too Many Requests：rate limit exceeded')
        return `ok-${attempt}`
      }
    })
    expect(result).toBe('ok-2')
    expect(calls).toBe(2)
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBe(Math.floor(0.5 * PROVIDER_RETRY_BASE_DELAY_MS))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({
      attempt: 2,
      reasonCode: 'rate_limit'
    })
  })

  it('fails immediately on billing without sleeping', async () => {
    const sleep = vi.fn(async () => undefined)
    const onRetry = vi.fn()
    await expect(
      withProviderRetry({
        budget: { maxAttempts: 3, attemptsUsed: 0 },
        sleep,
        onRetry,
        run: async () => {
          throw new Error('quota exceeded')
        }
      })
    ).rejects.toThrow(/quota exceeded/)
    expect(sleep).not.toHaveBeenCalled()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('stops when AbortSignal fires during wait', async () => {
    const controller = new AbortController()
    let calls = 0
    const promise = withProviderRetry({
      budget: { maxAttempts: 3, attemptsUsed: 0 },
      signal: controller.signal,
      random: () => 0.5,
      sleep: async (_ms, signal) => {
        controller.abort()
        if (signal?.aborted) {
          const err = new Error('aborted')
          err.name = 'AbortError'
          throw err
        }
      },
      run: async () => {
        calls += 1
        throw new Error('Provider 返回 429 rate limit')
      }
    })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })
})
