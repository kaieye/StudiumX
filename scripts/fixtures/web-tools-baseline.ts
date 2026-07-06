import assert from 'node:assert/strict'

import type { ToolContext } from '../../src/main/ai/tools/registry'
import { assertSafeUrl, webFetchTool } from '../../src/main/ai/tools/web_fetch'
import { webSearchTool } from '../../src/main/ai/tools/web_search'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'

const searchHtml = `
<html>
  <body>
    <table>
      <tr>
        <td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://example.com/result?a=1')}&amp;rut=test" class='result-link'>
            Result &amp; Title
          </a>
        </td>
      </tr>
      <tr>
        <td class='result-snippet'>Snippet &amp; details</td>
      </tr>
    </table>
  </body>
</html>
`

const articleHtml = `
<!doctype html>
<html>
  <head><title>Fetch title</title><style>.hidden{display:none}</style></head>
  <body>
    <script>window.secret = true</script>
    <article>
      <h1>Fetched Article</h1>
      <p>First paragraph &amp; entity.</p>
      <p>Second paragraph.</p>
    </article>
  </body>
</html>
`

function makeCtx(webSearch: Partial<TeachingSettingsV1['webSearch']> = {}): ToolContext {
  return {
    proxyUrl: '',
    settings: {
      webSearch: {
        backend: 'ddgs',
        fallbackEnabled: true,
        maxResults: 2,
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
  } as ToolContext
}

const originalFetch = globalThis.fetch
const requests: string[] = []

try {
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = input.toString()
    requests.push(url)
    if (url.startsWith('https://lite.duckduckgo.com/lite/')) {
      return new Response(searchHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }
    if (url === 'https://example.com/article') {
      return new Response(articleHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }
    if (url === 'https://example.com/plain') {
      return new Response('plain text body', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const missingSearch = JSON.parse(await webSearchTool.handler({}, makeCtx()))
  assert.match(missingSearch.error, /query/, 'web_search should return a structured missing-query error')

  const searchPayload = JSON.parse(await webSearchTool.handler({ query: 'baseline search', maxResults: 10 }, makeCtx({ maxResults: 1 })))
  assert.equal(searchPayload.query, 'baseline search')
  assert.equal(searchPayload.provider, 'DDGS / DuckDuckGo')
  assert.equal(searchPayload.count, 1)
  assert.deepEqual(searchPayload.results[0], {
    title: 'Result & Title',
    url: 'https://example.com/result?a=1',
    snippet: 'Snippet & details'
  })
  assert.ok(requests.some((url) => url.includes('baseline%20search')), 'query should be encoded into the DDG Lite request')

  const missingFetch = JSON.parse(await webFetchTool.handler({}, makeCtx()))
  assert.match(missingFetch.error, /url/, 'web_fetch should return a structured missing-url error')

  const fetchPayload = JSON.parse(await webFetchTool.handler({ url: 'https://example.com/article' }, makeCtx()))
  assert.equal(fetchPayload.url, 'https://example.com/article')
  assert.equal(fetchPayload.length, fetchPayload.text.length)
  assert.match(fetchPayload.text, /Fetched Article/)
  assert.match(fetchPayload.text, /First paragraph & entity/)
  assert.doesNotMatch(fetchPayload.text, /window\.secret|display:none/)

  const plainPayload = JSON.parse(await webFetchTool.handler({ url: 'https://example.com/plain' }, makeCtx()))
  assert.equal(plainPayload.text, 'plain text body')

  assert.equal(assertSafeUrl('https://example.com/path#hash'), 'https://example.com/path#hash')
  assert.throws(() => assertSafeUrl('file:///C:/secret.txt'), /http\/https/)
  assert.throws(() => assertSafeUrl('http://localhost:3000'), /本地地址/)
  assert.throws(() => assertSafeUrl('http://127.0.0.1:3000'), /内网\/回环/)
  assert.throws(() => assertSafeUrl('http://10.0.0.1'), /内网\/回环/)
  assert.throws(() => assertSafeUrl('http://192.168.1.1'), /内网\/回环/)
  assert.throws(() => assertSafeUrl('http://172.16.0.1'), /内网\/回环/)
  assert.throws(() => assertSafeUrl('http://169.254.10.1'), /内网\/回环/)

  console.log('web tools baseline ok')
} finally {
  globalThis.fetch = originalFetch
}
