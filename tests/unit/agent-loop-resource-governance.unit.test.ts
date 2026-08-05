import { afterEach, describe, expect, it } from 'vitest'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function settings(): TeachingSettingsV1 {
  const value = defaultSettings('C:/agent-loop-resource-governance-fixture')
  value.generator.endpointFormat = 'chat_completions'
  value.generator.requestTimeoutMs = 5_000
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

function providerFinalResponse(): Response {
  return jsonResponse({
    choices: [{ message: { content: 'This final answer must not settle as success.' } }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
  })
}

describe('runAgentLoop resource governance terminals', () => {
  it('turns a final provider response that reaches a user token boundary into resource_limit', async () => {
    globalThis.fetch = (async () => providerFinalResponse()) as typeof fetch
    const statuses: string[] = []

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'Continue.' }],
      tools: [],
      toolHandlers: {},
      resourceGovernance: {
        userBudget: {
          limits: [{ meter: 'total_tokens', limit: 20, scope: 'task', auditId: 'user-total-20' }]
        }
      },
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'status') statuses.push(event.status)
        }
      }
    })

    expect(result.stopReason).toBe('resource_limit')
    expect(result.error).toBeUndefined()
    expect(result.finalText).toBe('')
    expect(result.messages).toEqual([{ role: 'user', content: 'Continue.' }])
    expect(result.usage.resourceGovernance?.terminal).toMatchObject({
      layer: 'user_budget', meter: 'total_tokens', limit: 20, action: 'resource_limit', auditId: 'user-total-20'
    })
    expect(statuses).toContain('resource_limit')
    expect(statuses).not.toContain('done')
  })

  it('uses suspended when an emergency token fuse is reached', async () => {
    globalThis.fetch = (async () => providerFinalResponse()) as typeof fetch
    const statuses: string[] = []

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'Continue.' }],
      tools: [],
      toolHandlers: {},
      resourceGovernance: {
        emergencyFuse: {
          limits: [{ meter: 'total_tokens', limit: 20, scope: 'run', auditId: 'test-emergency-total-20' }]
        }
      },
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'status') statuses.push(event.status)
        }
      }
    })

    expect(result.stopReason).toBe('suspended')
    expect(result.error).toBeUndefined()
    expect(result.finalText).toBe('')
    expect(result.usage.resourceGovernance?.terminal).toMatchObject({
      layer: 'emergency_fuse', meter: 'total_tokens', limit: 20, action: 'suspended', auditId: 'test-emergency-total-20'
    })
    expect(statuses).toContain('suspended')
    expect(statuses).not.toContain('done')
  })
})
