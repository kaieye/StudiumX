import assert from 'node:assert/strict'

import { probeModelProvider } from '../../src/main/provider-connection'
import { validateProviderRequestUrl } from '../../src/shared/provider-url-policy'

const blocked = await probeModelProvider(
  { baseUrl: 'http://api.example.com', apiKey: 'sk-remote-secret-123456789', endpointFormat: 'chat_completions' },
  '',
  async () => {
    throw new Error('remote HTTP URL should be rejected before fetch')
  }
)
assert.equal(blocked.ok, false)
assert.match(blocked.message, /HTTPS|HTTP/)

const localProbe = await probeModelProvider(
  { baseUrl: 'http://127.0.0.1:11434', apiKey: 'local-dev-key', endpointFormat: 'chat_completions' },
  '',
  async () => new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 })
)
assert.equal(localProbe.ok, true)
assert.deepEqual(localProbe.ok ? localProbe.modelIds : [], ['local-model'])

const calls: Array<{ proxyUrl: string; authorization?: string; xApiKey?: string }> = []
const proxyFailure = await probeModelProvider(
  { baseUrl: 'https://api.example.com', apiKey: 'sk-proxy-secret-123456789', endpointFormat: 'chat_completions' },
  'http://user:pass@proxy.local:8080',
  async (_input, init, proxyUrl) => {
    const headers = new Headers(init?.headers)
    calls.push({
      proxyUrl,
      authorization: headers.get('authorization') ?? undefined,
      xApiKey: headers.get('x-api-key') ?? undefined
    })
    if (proxyUrl) {
      throw new Error('proxy failed Authorization: Bearer sk-proxy-secret-123456789 via http://user:pass@proxy.local:8080')
    }
    return new Response('unauthorized without key', { status: 401 })
  }
)
assert.equal(proxyFailure.ok, false)
assert.match(proxyFailure.message, /直连可达/)
assert.equal(calls.length, 2)
assert.match(calls[0]?.authorization ?? '', /sk-proxy-secret/)
assert.equal(calls[1]?.proxyUrl, '')
assert.equal(calls[1]?.authorization, undefined, 'direct proxy-reachability probe must not carry provider key')
assert.equal(calls[1]?.xApiKey, undefined, 'direct proxy-reachability probe must not carry x-api-key')
assert.doesNotMatch(proxyFailure.message, /sk-proxy-secret|user:pass/)

const redactedBody = await probeModelProvider(
  { baseUrl: 'https://api.example.com', apiKey: 'sk-body-secret-123456789', endpointFormat: 'chat_completions' },
  '',
  async () => new Response(
    '{"error":{"message":"Authorization: Bearer sk-body-secret-123456789 api_key=bodySecret"}}',
    { status: 500, statusText: 'Server Error' }
  )
)
assert.equal(redactedBody.ok, false)
assert.doesNotMatch(redactedBody.message, /sk-body-secret|api_key=bodySecret/)
assert.match(redactedBody.message, /\[redacted\]/)

assert.equal(validateProviderRequestUrl('https://api.example.com?api_key=secret').ok, false)
assert.equal(validateProviderRequestUrl('https://api.example.com#access_token=secret').ok, false)

console.log('provider privacy checks ok')
