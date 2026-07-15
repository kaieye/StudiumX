import assert from 'node:assert/strict'

import {
  effectiveMaxOutputTokens,
  MODEL_PROVIDER_CATALOG,
  modelContextWindowTokens,
  modelMaxOutputTokens,
  modelReasoningEffortsForProviderModel,
  resolveModelCapability
} from '../../src/shared/model-provider-catalog'
import {
  TEACHING_MODEL_PROVIDER_PRESETS,
  type TeachingModelProviderProfile,
  type TeachingSettingsV1
} from '../../src/shared/teaching-types'
import { inferContextWindowTokens } from '../../src/main/ai/context-compactor'
import { buildRequest } from '../../src/main/ai/provider-adapter/request-builder'

const deepseekPreset = TEACHING_MODEL_PROVIDER_PRESETS.find((provider) => provider.id === 'deepseek')
const customPreset = TEACHING_MODEL_PROVIDER_PRESETS.find((provider) => provider.id === 'custom')
assert.ok(deepseekPreset)
assert.ok(customPreset)
assert.deepEqual(deepseekPreset.models, ['deepseek-v4-pro', 'deepseek-v4-flash'])
assert.deepEqual(customPreset.models, [])
assert.equal(MODEL_PROVIDER_CATALOG.some((provider) => provider.id === 'glm'), true)

const deepseekProfile: TeachingModelProviderProfile = { ...deepseekPreset, apiKey: 'test-key' }
assert.equal(
  resolveModelCapability({
    providerId: deepseekProfile.id,
    providerBaseUrl: deepseekProfile.baseUrl,
    modelId: 'deepseek-v4-flash'
  })?.model.id,
  'deepseek-v4-flash'
)
assert.equal(
  modelContextWindowTokens({
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro'
  }),
  1_000_000
)
assert.equal(
  modelMaxOutputTokens({
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro'
  }),
  384_000
)
assert.deepEqual(
  modelReasoningEffortsForProviderModel({
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro'
  }),
  ['auto', 'high', 'max']
)
assert.equal(effectiveMaxOutputTokens(deepseekProfile, 'deepseek-v4-flash', 500_000), 384_000)
assert.equal(inferContextWindowTokens('deepseek-v4-flash', deepseekProfile), 1_000_000)
assert.equal(inferContextWindowTokens('unknown-32k'), 32_000)

const generator: TeachingSettingsV1['generator'] = {
  providerId: deepseekProfile.id,
  model: 'deepseek-v4-flash',
  endpointFormat: 'chat_completions',
  temperature: 0.4,
  maxOutputTokens: 500_000,
  lessonDurationMinutes: 15,
  includeRetrievalPractice: true,
  generateReference: true,
  structuredOutput: true,
  streaming: false,
  reasoningEffort: 'auto',
  requestTimeoutMs: 60_000
}

const request = buildRequest('chat_completions', {
  provider: deepseekProfile,
  generator,
  request: {
    systemPrompt: 'system',
    userPrompt: 'user',
    jsonMode: false
  },
  stream: false
})
const body = JSON.parse(String(request.init.body))
assert.equal(body.max_tokens, 384_000)
assert.equal(body.reasoning_effort, 'high')

console.log('model provider catalog ok')
