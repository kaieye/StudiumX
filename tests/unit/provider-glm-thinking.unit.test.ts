import { describe, expect, it } from 'vitest'

import { buildRequest } from '../../src/main/ai/provider-adapter/request-builder'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile } from '../../src/shared/teaching-types'

function prepared(providerId: 'glm' | 'custom') {
  const settings = defaultSettings('C:/provider-glm-thinking-test')
  const preset = settings.provider.providers.find((item) => item.id === providerId)!
  const provider: TeachingModelProviderProfile = {
    ...preset,
    baseUrl: providerId === 'custom' ? 'https://proxy.example.test/v1' : preset.baseUrl,
    apiKey: 'test-key'
  }
  const generator = {
    ...settings.generator,
    providerId,
    endpointFormat: 'chat_completions' as const,
    model: 'glm-5.2',
    reasoningEffort: 'auto' as const
  }
  return { provider, generator }
}

function requestBody(providerId: 'glm' | 'custom', jsonMode: boolean) {
  const { provider, generator } = prepared(providerId)
  const built = buildRequest('chat_completions', {
    provider,
    generator,
    request: { systemPrompt: 'system', userPrompt: 'user', jsonMode },
    stream: false
  })
  return JSON.parse(String(built.init.body)) as Record<string, unknown>
}

describe('GLM thinking request options', () => {
  it('disables default GLM-5 thinking for strict JSON lesson generation', () => {
    expect(requestBody('glm', true)).toMatchObject({
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' }
    })
  })

  it('detects GLM-5 models behind a custom OpenAI-compatible proxy', () => {
    expect(requestBody('custom', true)).toMatchObject({
      model: 'glm-5.2',
      thinking: { type: 'disabled' }
    })
  })

  it('keeps thinking enabled for non-JSON GLM requests when effort is automatic', () => {
    expect(requestBody('glm', false)).toMatchObject({ thinking: { type: 'enabled' } })
  })
})
