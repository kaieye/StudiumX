import type { ToolContext } from '../registry'
import { fetchWithOptionalProxy } from '../../../proxy-fetch'
import {
  normalizeBraveResults,
  normalizeSearchResults,
  normalizeSearXngResults,
  parseLiteResults,
  parseXaiSearchResults
} from './normalizers'
import { SEARCH_TIMEOUT_MS, webSearchSettings, webSearchValue } from './settings'
import type { SearchProvider, SearchResult, WebSearchProviderName } from './types'

const FIRECRAWL_DEFAULT_API_URL = 'https://api.firecrawl.dev'
const TAVILY_API_URL = 'https://api.tavily.com/search'
const EXA_API_URL = 'https://api.exa.ai/search'
const PARALLEL_API_URL = 'https://api.parallel.ai/v1/search'
const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses'

export const searchProviders: SearchProvider[] = [
  {
    name: 'firecrawl',
    label: 'Firecrawl',
    auto: true,
    isAvailable: (ctx) => Boolean(webSearchValue(ctx, 'firecrawlApiKey', 'FIRECRAWL_API_KEY') || firecrawlBaseUrl(ctx)),
    unavailableReason: () => 'Firecrawl 需要 FIRECRAWL_API_KEY，或配置自托管 Firecrawl API URL。',
    search: searchFirecrawl
  },
  {
    name: 'parallel',
    label: 'Parallel',
    auto: true,
    isAvailable: (ctx) => Boolean(webSearchValue(ctx, 'parallelApiKey', 'PARALLEL_API_KEY')),
    unavailableReason: () => 'Parallel 需要 PARALLEL_API_KEY。',
    search: searchParallel
  },
  {
    name: 'tavily',
    label: 'Tavily',
    auto: true,
    isAvailable: (ctx) => Boolean(webSearchValue(ctx, 'tavilyApiKey', 'TAVILY_API_KEY')),
    unavailableReason: () => 'Tavily 需要 TAVILY_API_KEY。',
    search: searchTavily
  },
  {
    name: 'exa',
    label: 'Exa',
    auto: true,
    isAvailable: (ctx) => Boolean(webSearchValue(ctx, 'exaApiKey', 'EXA_API_KEY')),
    unavailableReason: () => 'Exa 需要 EXA_API_KEY。',
    search: searchExa
  },
  {
    name: 'searxng',
    label: 'SearXNG',
    auto: true,
    isAvailable: (ctx) => Boolean(webSearchValue(ctx, 'searxngUrl', 'SEARXNG_URL')),
    unavailableReason: () => 'SearXNG 需要 SEARXNG_URL。',
    search: searchSearXng
  },
  {
    name: 'brave',
    label: 'Brave Search',
    auto: true,
    isAvailable: (ctx) => Boolean(webSearchValue(ctx, 'braveApiKey', 'BRAVE_SEARCH_API_KEY')),
    unavailableReason: () => 'Brave Search 需要 BRAVE_SEARCH_API_KEY。',
    search: searchBrave
  },
  {
    name: 'ddgs',
    label: 'DDGS / DuckDuckGo',
    auto: true,
    isAvailable: () => true,
    unavailableReason: () => '',
    search: searchDuckDuckGoLite
  },
  {
    name: 'xai',
    label: 'xAI Grok Web Search',
    auto: false,
    isAvailable: (ctx) => Boolean(webSearchValue(ctx, 'xaiApiKey', 'XAI_API_KEY')),
    unavailableReason: () => 'xAI Web Search 需要 XAI_API_KEY。',
    search: searchXai
  }
]

export function availableProviders(ctx?: ToolContext): SearchProvider[] {
  if (!ctx) return [providerByName('ddgs')!]
  const available = searchProviders.filter((provider) => provider.auto && provider.isAvailable(ctx))
  return available.length > 0 ? available : [providerByName('ddgs')!]
}

export function providerByName(name: WebSearchProviderName): SearchProvider | undefined {
  return searchProviders.find((provider) => provider.name === name)
}

function firecrawlBaseUrl(ctx: ToolContext): string {
  return webSearchValue(ctx, 'firecrawlApiUrl', 'FIRECRAWL_API_URL').replace(/\/+$/, '')
}

async function postJson(
  url: string,
  body: unknown,
  ctx: ToolContext,
  headers: Record<string, string>
): Promise<unknown> {
  const res = await fetchWithOptionalProxy(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal: withToolTimeoutSignal(ctx.signal, SEARCH_TIMEOUT_MS)
    },
    ctx.proxyUrl
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`)
  }
  return res.json()
}

async function searchFirecrawl(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  const apiKey = webSearchValue(ctx, 'firecrawlApiKey', 'FIRECRAWL_API_KEY')
  const baseUrl = firecrawlBaseUrl(ctx) || FIRECRAWL_DEFAULT_API_URL
  if (!apiKey && baseUrl === FIRECRAWL_DEFAULT_API_URL) {
    throw new Error('Firecrawl 云端 API 需要 FIRECRAWL_API_KEY。')
  }
  const data = await postJson(
    `${baseUrl}/v2/search`,
    {
      query,
      limit: Math.min(Math.max(maxResults, 1), 10),
      sources: ['web']
    },
    ctx,
    apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  )
  return normalizeSearchResults(data, maxResults)
}

async function searchParallel(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  const apiKey = webSearchValue(ctx, 'parallelApiKey', 'PARALLEL_API_KEY')
  if (!apiKey) throw new Error('PARALLEL_API_KEY 未设置。')
  const mode = webSearchSettings(ctx).parallelSearchMode ?? 'agentic'
  const data = await postJson(
    PARALLEL_API_URL,
    {
      search_queries: [query],
      objective: query,
      processor: mode === 'agentic' ? 'pro' : 'base',
      max_results: Math.min(Math.max(maxResults, 1), 20)
    },
    ctx,
    { 'x-api-key': apiKey }
  )
  return normalizeSearchResults(data, maxResults)
}

async function searchTavily(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  const apiKey = webSearchValue(ctx, 'tavilyApiKey', 'TAVILY_API_KEY')
  if (!apiKey) throw new Error('TAVILY_API_KEY 未设置。')
  const data = await postJson(
    TAVILY_API_URL,
    {
      query,
      max_results: Math.min(Math.max(maxResults, 1), 20),
      include_raw_content: false,
      include_images: false
    },
    ctx,
    { Authorization: `Bearer ${apiKey}` }
  )
  return normalizeSearchResults(data, maxResults)
}

async function searchExa(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  const apiKey = webSearchValue(ctx, 'exaApiKey', 'EXA_API_KEY')
  if (!apiKey) throw new Error('EXA_API_KEY 未设置。')
  const data = await postJson(
    EXA_API_URL,
    {
      query,
      numResults: Math.min(Math.max(maxResults, 1), 20),
      contents: { highlights: true }
    },
    ctx,
    { 'x-api-key': apiKey }
  )
  return normalizeSearchResults(data, maxResults)
}

async function searchXai(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  const apiKey = webSearchValue(ctx, 'xaiApiKey', 'XAI_API_KEY')
  if (!apiKey) throw new Error('XAI_API_KEY 未设置。')
  const model = webSearchValue(ctx, 'xaiModel') || 'grok-4.3'
  const data = await postJson(
    XAI_RESPONSES_URL,
    {
      model,
      tools: [{ type: 'web_search' }],
      input:
        `Use web_search to find current web results for this query: ${query}\n` +
        `Return only JSON in this shape: {"results":[{"title":"...","url":"https://...","description":"..."}]}. ` +
        `Return at most ${Math.min(Math.max(maxResults, 1), 10)} results.`
    },
    ctx,
    { Authorization: `Bearer ${apiKey}` }
  )
  return parseXaiSearchResults(data, maxResults)
}

async function searchSearXng(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  const baseUrl = webSearchValue(ctx, 'searxngUrl', 'SEARXNG_URL').replace(/\/+$/, '')
  if (!baseUrl) throw new Error('SEARXNG_URL 未设置。')
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`
  const res = await fetchWithOptionalProxy(
    url,
    {
      headers: {
        Accept: 'application/json'
      },
      signal: withToolTimeoutSignal(ctx.signal, SEARCH_TIMEOUT_MS)
    },
    ctx.proxyUrl
  )
  if (!res.ok) throw new Error(`SearXNG 返回 ${res.status}`)
  return normalizeSearXngResults(await res.json(), maxResults)
}

async function searchBrave(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  const apiKey = webSearchValue(ctx, 'braveApiKey', 'BRAVE_SEARCH_API_KEY')
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY 未设置。')
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(Math.max(maxResults, 1), 20)}`
  const res = await fetchWithOptionalProxy(
    url,
    {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey
      },
      signal: withToolTimeoutSignal(ctx.signal, SEARCH_TIMEOUT_MS)
    },
    ctx.proxyUrl
  )
  if (!res.ok) throw new Error(`Brave Search 返回 ${res.status}`)
  return normalizeBraveResults(await res.json(), maxResults)
}

/**
 * DuckDuckGo Lite HTML scrape. The Instant Answer API returns almost no
 * organic results, so this remains the no-key fallback. Requests run in the
 * Electron main process (no CORS). Defensive parsing - any failure returns an
 * empty result set so the agent loop never crashes.
 */
async function searchDuckDuckGoLite(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  throwIfToolCanceled(ctx.signal)
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=wt-wt`
  const fetchOnce = async (): Promise<string> => {
    const res = await fetchWithOptionalProxy(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        signal: withToolTimeoutSignal(ctx.signal, SEARCH_TIMEOUT_MS)
      },
      ctx.proxyUrl
    )
    if (!res.ok) throw new Error(`DuckDuckGo 返回 ${res.status}`)
    return res.text()
  }

  let html: string
  try {
    html = await fetchOnce()
  } catch {
    await sleep(800, ctx.signal)
    try {
      html = await fetchOnce()
    } catch (e) {
      if (ctx.signal?.aborted) throw e
      return []
    }
  }

  const results = parseLiteResults(html)
  if (results.length === 0) {
    await sleep(800, ctx.signal)
    try {
      html = await fetchOnce()
      return parseLiteResults(html).slice(0, maxResults)
    } catch (e) {
      if (ctx.signal?.aborted) throw e
      return []
    }
  }
  return results.slice(0, maxResults)
}

function withToolTimeoutSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal
}

function throwIfToolCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('工具调用已取消。')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfToolCanceled(signal)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('工具调用已取消。'))
    }, { once: true })
  })
}
