import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildConnectorStatuses } from '../../src/main/connector-status'
import { defaultSettings } from '../../src/main/teaching-settings'

import {
  SearchRuntime,
  assertSafeFetchUrl,
  createDefaultSearchRuntime
} from '../../src/main/ai/search-runtime'

const ddgResultOneUrl = 'https://example.com/search-result-one'
const ddgResultTwoUrl = 'https://example.com/search-result-two'

const duckDuckGoHtml = `
<!doctype html>
<html>
  <body>
    <table>
      <tr>
        <td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(ddgResultOneUrl)}&amp;rut=test" class="result-link">
            Search Runtime Result One
          </a>
        </td>
      </tr>
      <tr><td class="result-snippet">First runtime snippet.</td></tr>
      <tr>
        <td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(ddgResultTwoUrl)}&amp;rut=test" class="result-link">
            Search Runtime Result Two
          </a>
        </td>
      </tr>
      <tr><td class="result-snippet">Second runtime snippet.</td></tr>
    </table>
  </body>
</html>
`

const longBody = 'Visible long runtime body sentence. '.repeat(1200)
const longHtml = `
<!doctype html>
<html>
  <head>
    <title>Runtime Fetch Title</title>
    <style>.hidden { display: none; }</style>
  </head>
  <body>
    <script>window.secretRuntimeValue = true</script>
    <main>
      <article>
        <h1>Runtime Fetch Article</h1>
        <p>${longBody}</p>
      </article>
    </main>
  </body>
</html>
`

function makeCtx(webSearch: Record<string, unknown> = {}, proxyUrl = ''): unknown {
  return {
    proxyUrl,
    settings: {
      webSearch: {
        backend: 'ddgs',
        fallbackEnabled: true,
        maxResults: 5,
        searxngUrl: '',
        braveApiKey: '',
        firecrawlApiKey: '',
        firecrawlApiUrl: '',
        tavilyApiKey: '',
        exaApiKey: '',
        parallelApiKey: '',
        parallelSearchMode: 'agentic',
        xaiApiKey: '',
        xaiModel: 'grok-4.3',
        ...webSearch
      }
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  return value as Record<string, unknown>
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  assert.equal(typeof value, 'string', message)
  assert.ok(value.trim().length > 0, message)
}

function assertIsoDate(value: unknown, message: string): asserts value is string {
  assertNonEmptyString(value, message)
  assert.ok(Number.isFinite(Date.parse(value)), message)
}

function assertRuntimeResultShape(result: unknown, providerHint: string): void {
  const item = asRecord(result)
  assertNonEmptyString(item.sourceId, 'search result should include sourceId')
  assertNonEmptyString(item.title, 'search result should include title')
  assertNonEmptyString(item.url, 'search result should include url')
  assertNonEmptyString(item.snippet, 'search result should include snippet')
  assertIsoDate(item.retrievedAt, 'search result should include retrievedAt')
  assertNonEmptyString(item.provider, 'search result should include provider')
  assert.match(item.provider, new RegExp(providerHint, 'i'))
}

function attemptName(attempt: unknown): string {
  if (typeof attempt === 'string') return attempt
  const item = asRecord(attempt)
  return stringField(item.backend) || stringField(item.provider) || stringField(item.name)
}

function assertAttemptedBackend(attempt: unknown, pattern: RegExp): void {
  assert.match(attemptName(attempt), pattern)
}

function attemptError(attempt: unknown): string {
  const item = asRecord(attempt)
  return stringField(item.error) || stringField(item.reason) || stringField(item.message)
}

function attemptUrl(attempt: unknown): string {
  const item = asRecord(attempt)
  return stringField(item.url) || stringField(item.requestUrl) || stringField(item.finalUrl)
}

function assertUnsafeUrl(url: string): void {
  assert.throws(
    () => assertSafeFetchUrl(url),
    /http\/https|local|localhost|private|metadata|cgnat|loopback|link-local|内网|回环|本地|拒绝|unsafe/i,
    `${url} should be rejected`
  )
}

function assertSafeUrl(url: string): void {
  assert.equal(assertSafeFetchUrl(url), new URL(url).toString(), `${url} should be allowed and normalized`)
}

const originalFetch = globalThis.fetch
const requests: Array<{ url: string; init?: RequestInit }> = []

try {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString()
    requests.push({ url, init })

    if (/duckduckgo\.com/i.test(url)) {
      return new Response(duckDuckGoHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }

    if (url.startsWith('https://api.firecrawl.dev/v2/search')) {
      return new Response('temporarily unavailable', { status: 503 })
    }

    if (url.startsWith('https://api.search.brave.com/res/v1/web/search')) {
      return new Response(JSON.stringify({
        web: {
          results: [{
            title: 'Shared catalog Brave result',
            url: 'https://example.com/shared-catalog-brave',
            description: 'Shared catalog Brave snippet'
          }]
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }

    if (url === 'https://example.com/long-html') {
      return new Response(longHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }

    if (url === 'https://example.com/redirect-to-private') {
      return new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' }
      })
    }

    if (url === 'http://127.0.0.1/private') {
      throw new Error('unsafe redirect target was fetched')
    }

    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch

  assert.equal(typeof SearchRuntime, 'function', 'SearchRuntime should be exported')
  const runtime = createDefaultSearchRuntime()
  assert.ok(runtime instanceof SearchRuntime, 'createDefaultSearchRuntime should return a SearchRuntime')

  requests.length = 0
  const searchPayload = asRecord(await runtime.search({ query: 'phase 1 runtime search', maxResults: 2 }, makeCtx({ backend: 'ddgs' })))
  assert.equal(searchPayload.query, 'phase 1 runtime search')
  assert.equal(searchPayload.backend, 'ddgs')
  assertNonEmptyString(searchPayload.provider, 'search should include provider')
  assert.match(searchPayload.provider, /duckduckgo|ddgs/i)
  assert.ok(Array.isArray(searchPayload.attemptedBackends), 'search should include attemptedBackends')
  assert.equal(searchPayload.attemptedBackends.length, 1)
  assertAttemptedBackend(searchPayload.attemptedBackends[0], /duckduckgo|ddgs/i)
  assert.ok(Array.isArray(searchPayload.results), 'search should include results')
  assert.equal(searchPayload.results.length, 2)
  assertRuntimeResultShape(searchPayload.results[0], 'duckduckgo|ddgs')
  assert.equal(asRecord(searchPayload.results[0]).url, ddgResultOneUrl)
  assertRuntimeResultShape(searchPayload.results[1], 'duckduckgo|ddgs')
  assert.ok(
    requests.some((request) => decodeURIComponent(request.url).includes('phase 1 runtime search')),
    'ddgs search should call fetch with the encoded query'
  )

  requests.length = 0
  const unavailablePayload = asRecord(
    await runtime.search(
      { query: 'do not fallback from explicit unavailable backend', maxResults: 2 },
      makeCtx({ backend: 'brave', fallbackEnabled: true, braveApiKey: '' })
    )
  )
  assert.equal(unavailablePayload.backend, 'brave')
  assert.ok(Array.isArray(unavailablePayload.results), 'unavailable search should include results')
  assert.equal(unavailablePayload.results.length, 0)
  assert.ok(Array.isArray(unavailablePayload.attemptedBackends), 'unavailable search should include attemptedBackends')
  assert.equal(unavailablePayload.attemptedBackends.length, 1)
  assertAttemptedBackend(unavailablePayload.attemptedBackends[0], /brave/i)
  assert.match(attemptError(unavailablePayload.attemptedBackends[0]), /brave|api|key|unavailable|需要|未设置/i)
  assert.equal(requests.length, 0, 'explicit unavailable backend should not fall back to ddgs fetch')

  requests.length = 0
  const fallbackPayload = asRecord(
    await runtime.search(
      { query: 'fall through a failed auto provider', maxResults: 2 },
      makeCtx({ backend: 'auto', firecrawlApiKey: 'fc-test', fallbackEnabled: true })
    )
  )
  assert.equal(fallbackPayload.backend, 'ddgs', 'auto mode should continue to the no-key provider after Firecrawl fails')
  assert.equal(fallbackPayload.results.length, 2)
  assert.ok(Array.isArray(fallbackPayload.attemptedBackends))
  assert.ok(fallbackPayload.attemptedBackends.length >= 2)
  assertAttemptedBackend(fallbackPayload.attemptedBackends[0], /firecrawl/i)
  assert.match(attemptError(fallbackPayload.attemptedBackends[0]), /503/)
  const ddgsAttempt = fallbackPayload.attemptedBackends.find((attempt) => /duckduckgo|ddgs/i.test(attemptName(attempt)))
  assert.ok(ddgsAttempt, 'auto fallback should eventually try DDGS after a configured provider fails')

  const previousBackend = process.env.STUDIUMX_WEB_SEARCH_BACKEND
  process.env.STUDIUMX_WEB_SEARCH_BACKEND = 'brave-free'
  try {
    const sharedSettings = defaultSettings(join(tmpdir(), 'studiumx-runtime-catalog-fixture'))
    sharedSettings.tools.enabled = true
    sharedSettings.tools.webSearch = true
    sharedSettings.webSearch.backend = 'auto'
    sharedSettings.webSearch.braveApiKey = 'brave-test'

    const connectorStatuses = await buildConnectorStatuses(sharedSettings, null, {
      probeCommand: async () => ({ stdout: 'rg 14.1.0\n' })
    })
    const connector = connectorStatuses.connectors.find((item) => item.id === 'web_search')
    assert.equal(connector?.state, 'available')
    assert.match(connector?.detail ?? '', /Brave Search/)

    requests.length = 0
    const sharedRuntimePayload = asRecord(
      await runtime.search({ query: 'shared catalog alias', maxResults: 1 }, makeCtx({ backend: 'auto', braveApiKey: 'brave-test' }))
    )
    assert.equal(sharedRuntimePayload.backend, 'brave')
    assert.match(String(sharedRuntimePayload.provider), /Brave Search/)
    assert.equal(sharedRuntimePayload.results.length, 1)
    assert.ok(requests.some((request) => request.url.startsWith('https://api.search.brave.com/res/v1/web/search')))
  } finally {
    if (previousBackend === undefined) delete process.env.STUDIUMX_WEB_SEARCH_BACKEND
    else process.env.STUDIUMX_WEB_SEARCH_BACKEND = previousBackend
  }

  requests.length = 0
  const fetchPayload = asRecord(await runtime.fetch({ url: 'https://example.com/long-html' }, makeCtx()))
  assertNonEmptyString(fetchPayload.sourceId, 'fetch should include sourceId')
  assert.equal(fetchPayload.url, 'https://example.com/long-html')
  assert.equal(fetchPayload.finalUrl, 'https://example.com/long-html')
  assert.match(String(fetchPayload.contentType), /text\/html/i)
  assertIsoDate(fetchPayload.retrievedAt, 'fetch should include retrievedAt')
  assert.equal(fetchPayload.truncated, true)
  assertNonEmptyString(fetchPayload.text, 'fetch should include text')
  assert.match(fetchPayload.text, /Runtime Fetch Article/)
  assert.match(fetchPayload.text, /Visible long runtime body sentence/)
  assert.doesNotMatch(fetchPayload.text, /window\.secretRuntimeValue|display:\s*none/)
  assert.ok(fetchPayload.text.length < longBody.length, 'long HTML body should be truncated')
  assert.ok(Array.isArray(fetchPayload.attempts), 'fetch should include attempts')
  assert.equal(fetchPayload.attempts.length, 1)
  assert.equal(attemptUrl(fetchPayload.attempts[0]), 'https://example.com/long-html')

  requests.length = 0
  await assert.rejects(
    () => runtime.fetch({ url: 'https://example.com/redirect-to-private' }, makeCtx()),
    /private|loopback|localhost|内网|回环|本地|拒绝|unsafe/i,
    'redirects to private addresses should be rejected'
  )
  assert.deepEqual(
    requests.map((request) => request.url),
    ['https://example.com/redirect-to-private'],
    'redirect target should be validated before fetching'
  )

  requests.length = 0
  const dnsBlockedRuntime = new SearchRuntime({
    resolveHostname: async (hostname) => {
      assert.equal(hostname, 'dns-private.example')
      return ['10.0.0.2']
    }
  })
  await assert.rejects(
    () => dnsBlockedRuntime.fetch({ url: 'https://dns-private.example/page' }, makeCtx()),
    /private|loopback|localhost|内网|回环|本地|拒绝|unsafe/i,
    'DNS results that resolve to private addresses should be rejected before fetch'
  )
  assert.equal(requests.length, 0, 'unsafe DNS target should not be fetched')

  const proxiedDnsBlockedRuntime = new SearchRuntime({
    resolveHostname: async (hostname) => {
      assert.equal(hostname, 'proxied-private.example')
      return ['169.254.169.254']
    }
  })
  await assert.rejects(
    () => proxiedDnsBlockedRuntime.fetch({ url: 'https://proxied-private.example/page' }, makeCtx({}, 'http://proxy.example:8080')),
    /metadata|private|loopback|localhost|内网|回环|本地|拒绝|unsafe/i,
    'proxy mode should not bypass pre-fetch DNS safety checks'
  )
  assert.equal(requests.length, 0, 'unsafe proxied DNS target should not be fetched')

  assertSafeUrl('https://example.com/path?q=runtime#section')
  assertSafeUrl('http://93.184.216.34/')
  assertSafeUrl('http://172.15.255.255/')
  assertSafeUrl('http://172.32.0.1/')
  assertSafeUrl('http://100.128.0.1/')

  assertUnsafeUrl('file:///C:/secret.txt')
  assertUnsafeUrl('http://localhost:3000/')
  assertUnsafeUrl('http://service.localhost/')
  assertUnsafeUrl('http://0.0.0.0/')
  assertUnsafeUrl('http://127.0.0.1:3000/')
  assertUnsafeUrl('http://10.0.0.1/')
  assertUnsafeUrl('http://172.16.0.1/')
  assertUnsafeUrl('http://172.31.255.255/')
  assertUnsafeUrl('http://192.168.1.1/')
  assertUnsafeUrl('http://169.254.169.254/latest/meta-data/')
  assertUnsafeUrl('http://100.64.0.1/')
  assertUnsafeUrl('http://100.127.255.254/')
  assertUnsafeUrl('http://[::1]/')
  assertUnsafeUrl('http://[fc00::1]/')
  assertUnsafeUrl('http://[fd12:3456::1]/')
  assertUnsafeUrl('http://[fe80::1]/')
  assertUnsafeUrl('http://[::ffff:127.0.0.1]/')
  assertUnsafeUrl('http://[::127.0.0.1]/')

  console.log('search runtime ok')
} finally {
  globalThis.fetch = originalFetch
}
