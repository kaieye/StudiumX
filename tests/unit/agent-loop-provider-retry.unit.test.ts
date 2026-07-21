import { afterEach, describe, expect, it } from 'vitest'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const budget = {
  maxDurationMs: 60_000,
  maxProviderCalls: 10,
  maxToolCalls: 10,
  maxTotalTokens: 100_000,
  warningThreshold: 0.8
}

function settings(): TeachingSettingsV1 {
  const value = defaultSettings('C:/agent-loop-provider-retry-fixture')
  value.generator.endpointFormat = 'chat_completions'
  value.generator.requestTimeoutMs = 5_000
  value.tools.maxIterations = 1
  return value
}

function provider(): TeachingModelProviderProfile {
  return {
    ...settings().provider.providers[0]!,
    baseUrl: 'https://provider.example/v1',
    endpointFormat: 'chat_completions',
    apiKey: 'sk-fixture'
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('agent-loop provider retry smoke (A-05)', () => {
  it('retries rate_limit then succeeds', async () => {
    let calls = 0
    const statuses: string[] = []
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        return jsonResponse(
          { error: { message: 'rate limit exceeded', type: 'rate_limit_error' } },
          429,
          { 'retry-after': '0' }
        )
      }
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'recovered answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
      })
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {},
      budget,
      now: () => Date.now(),
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'status' && event.message) statuses.push(event.message)
        }
      }
    })

    expect(result.error ?? null).toBeNull()
    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toContain('recovered answer')
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(result.usage.providerCalls).toBeGreaterThanOrEqual(2)
    expect(statuses.some((s) => s.startsWith('auto_retry_scheduled:'))).toBe(true)
  })

  it('fails billing immediately without multi-attempt providerCalls', async () => {
    let calls = 0
    const statuses: string[] = []
    globalThis.fetch = (async () => {
      calls += 1
      return jsonResponse(
        { error: { message: 'Insufficient Balance', type: 'billing_error' } },
        402
      )
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {},
      budget,
      now: () => Date.now(),
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'status' && event.message) statuses.push(event.message)
        }
      }
    })

    expect(result.stopReason).toBe('error')
    expect(calls).toBe(1)
    expect(result.usage.providerCalls).toBe(1)
    expect(statuses.some((s) => s.startsWith('auto_retry_scheduled:'))).toBe(false)
  })
})
