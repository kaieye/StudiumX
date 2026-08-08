import assert from 'node:assert/strict'

import {
  adapterAuthHeaders,
  providerFormatAdapter,
  providerProbeHeaders,
  toolsSupportedForFormat
} from '../../src/shared/provider-format'

assert.equal(toolsSupportedForFormat('chat_completions'), true)
assert.equal(toolsSupportedForFormat('custom_endpoint'), true)
assert.equal(toolsSupportedForFormat('responses'), true)
assert.equal(toolsSupportedForFormat('messages'), true)

assert.deepEqual(providerProbeHeaders('chat_completions', 'sk-test'), {
  Accept: 'application/json',
  Authorization: 'Bearer sk-test'
})
assert.deepEqual(providerProbeHeaders('messages', 'anthropic-key'), {
  Accept: 'application/json',
  'anthropic-version': '2023-06-01',
  'x-api-key': 'anthropic-key'
})
assert.equal(adapterAuthHeaders('messages', 'anthropic-key')['Content-Type'], 'application/json')

assert.deepEqual(
  providerFormatAdapter('chat_completions').parseModelIds(JSON.stringify({
    data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }]
  })),
  ['gpt-5.4', 'gpt-5.4-mini']
)
assert.deepEqual(
  providerFormatAdapter('messages').parseModelIds(JSON.stringify({
    models: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5' }]
  })),
  ['claude-sonnet-4-6', 'claude-haiku-4-5']
)
assert.equal(providerFormatAdapter('custom_endpoint').probeSupported, false)
assert.match(providerFormatAdapter('custom_endpoint').unsupportedProbeMessage ?? '', /不支持/)

console.log('provider format adapters ok')

