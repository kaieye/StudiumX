import { afterEach, describe, expect, it } from 'vitest'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function settings(): TeachingSettingsV1 {
  const value = defaultSettings('C:/agent-loop-provider-hooks-fixture')
  value.generator.endpointFormat = 'chat_completions'
  value.generator.requestTimeoutMs = 50
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('runAgentLoop provider hooks end-to-end', () => {
  it('surfaces provider_reported provenance when the provider reports usage', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        choices: [{ message: { content: 'final answer' } }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
      })) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {}
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.usage.totalTokens).toBe(20)
    expect(result.usage.usageProvenance).toBe('provider_reported')
  })

  it('omits provenance when the provider reports no usage', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ choices: [{ message: { content: 'final answer' } }] })) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {}
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.usage).not.toHaveProperty('usageProvenance')
  })
})
