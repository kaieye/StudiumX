import assert from 'node:assert/strict'

import type { ToolContext } from '../../src/main/ai/tools/registry'
import { webSearchTool } from '../../src/main/ai/tools/web_search'
import type { TeachingSettingsV1, WebSearchBackend } from '../../src/shared/teaching-types'

type ProviderCase = {
  backend: WebSearchBackend
  provider: string
  settings: Partial<TeachingSettingsV1['webSearch']>
  matchUrl: string
  response: unknown
}

const ddgUrl = 'https://example.com/ddg-result'
const duckDuckGoHtml = `
<html>
  <body>
    <table>
      <tr>
        <td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(ddgUrl)}&amp;rut=test" class='result-link'>
            DDG result
          </a>
        </td>
      </tr>
      <tr>
        <td class='result-snippet'>DDG snippet</td>
      </tr>
    </table>
  </body>
</html>
`

const cases: ProviderCase[] = [
  {
    backend: 'firecrawl',
    provider: 'Firecrawl',
    settings: { firecrawlApiKey: 'fc-test' },
    matchUrl: 'https://api.firecrawl.dev/v2/search',
    response: { data: { web: [{ title: 'Firecrawl result', url: 'https://example.com/firecrawl', description: 'Firecrawl snippet' }] } }
  },
  {
    backend: 'parallel',
    provider: 'Parallel',
    settings: { parallelApiKey: 'parallel-test' },
    matchUrl: 'https://api.parallel.ai/v1/search',
    response: { results: [{ title: 'Parallel result', url: 'https://example.com/parallel', excerpts: ['Parallel snippet'] }] }
  },
  {
    backend: 'tavily',
    provider: 'Tavily',
    settings: { tavilyApiKey: 'tvly-test' },
    matchUrl: 'https://api.tavily.com/search',
    response: { results: [{ title: 'Tavily result', url: 'https://example.com/tavily', content: 'Tavily snippet' }] }
  },
  {
    backend: 'exa',
    provider: 'Exa',
    settings: { exaApiKey: 'exa-test' },
    matchUrl: 'https://api.exa.ai/search',
    response: { results: [{ title: 'Exa result', url: 'https://example.com/exa', highlights: ['Exa snippet'] }] }
  },
  {
    backend: 'searxng',
    provider: 'SearXNG',
    settings: { searxngUrl: 'https://searxng.example.test' },
    matchUrl: 'https://searxng.example.test/search',
    response: { results: [{ title: 'SearXNG result', url: 'https://example.com/searxng', content: 'SearXNG snippet', score: 1 }] }
  },
  {
    backend: 'brave',
    provider: 'Brave Search',
    settings: { braveApiKey: 'brave-test' },
    matchUrl: 'https://api.search.brave.com/res/v1/web/search',
    response: { web: { results: [{ title: 'Brave result', url: 'https://example.com/brave', description: 'Brave snippet' }] } }
  },
  {
    backend: 'xai',
    provider: 'xAI Grok Web Search',
    settings: { xaiApiKey: 'xai-test', xaiModel: 'grok-test' },
    matchUrl: 'https://api.x.ai/v1/responses',
    response: { output_text: '{"results":[{"title":"xAI result","url":"https://example.com/xai","description":"xAI snippet"}]}' }
  }
]

function makeCtx(webSearch: Partial<TeachingSettingsV1['webSearch']>): ToolContext {
  return {
    proxyUrl: '',
    settings: {
      webSearch: {
        backend: 'auto',
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
  } as ToolContext
}

const originalFetch = globalThis.fetch

try {
  for (const item of cases) {
    globalThis.fetch = async (input: string | URL | Request) => {
      assert.ok(input.toString().startsWith(item.matchUrl), `${item.backend} should call ${item.matchUrl}, got ${input.toString()}`)
      return new Response(JSON.stringify(item.response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const payload = JSON.parse(await webSearchTool.handler({ query: 'hello', maxResults: 3 }, makeCtx({ backend: item.backend, ...item.settings })))
    assert.equal(payload.provider, item.provider)
    assert.equal(payload.count, 1, `${item.backend} should return one result`)
    assert.match(payload.results[0].url, /^https:\/\/example\.com\//)
  }

  globalThis.fetch = async (input: string | URL | Request) => {
    assert.ok(input.toString().startsWith('https://lite.duckduckgo.com/lite/'))
    return new Response(duckDuckGoHtml, {
      status: 200,
      headers: { 'content-type': 'text/html' }
    })
  }
  const ddgPayload = JSON.parse(await webSearchTool.handler({ query: 'hello', maxResults: 3 }, makeCtx({ backend: 'ddgs' })))
  assert.equal(ddgPayload.provider, 'DDGS / DuckDuckGo')
  assert.equal(ddgPayload.results[0].url, ddgUrl)

  console.log('web search provider dispatch ok')
} finally {
  globalThis.fetch = originalFetch
}
