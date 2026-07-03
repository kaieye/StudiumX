import type { ToolEntry, ToolContext } from './registry'
import type { WebSearchBackend } from '../../../shared/teaching-types'
import { fetchWithOptionalProxy } from '../../proxy-fetch'
import {
  buildWeChatFallbackQueries,
  extractWeChatMetadata,
  fetchWeChatArticleHtml,
  isWeChatAccessRestricted,
  normalizeWeChatArticleUrl,
  WECHAT_RESTRICTED_GUIDANCE,
  WECHAT_RESTRICTED_REASON
} from './wechat'

export type SearchResult = {
  title: string
  url: string
  snippet: string
}

type WebSearchProviderName = Exclude<WebSearchBackend, 'auto' | 'duckduckgo'>

type SearchAttempt = {
  provider: string
  ok: boolean
  count?: number
  error?: string
}

type SearchOutcome = {
  provider?: WebSearchProviderName
  providerLabel?: string
  results: SearchResult[]
  attempts: SearchAttempt[]
}

type SearchProvider = {
  name: WebSearchProviderName
  label: string
  auto: boolean
  isAvailable: (ctx: ToolContext) => boolean
  unavailableReason: (ctx: ToolContext) => string
  search: (query: string, maxResults: number, ctx: ToolContext) => Promise<SearchResult[]>
}

const MAX_SNIPPET_CHARS = 200
const SEARCH_TIMEOUT_MS = 15_000
const FIRECRAWL_DEFAULT_API_URL = 'https://api.firecrawl.dev'
const TAVILY_API_URL = 'https://api.tavily.com/search'
const EXA_API_URL = 'https://api.exa.ai/search'
const PARALLEL_API_URL = 'https://api.parallel.ai/v1/search'
const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses'

const SEARCH_PROVIDER_ALIASES: Record<string, WebSearchProviderName> = {
  firecrawl: 'firecrawl',
  parallel: 'parallel',
  tavily: 'tavily',
  exa: 'exa',
  searxng: 'searxng',
  brave: 'brave',
  'brave-free': 'brave',
  duckduckgo: 'ddgs',
  ddg: 'ddgs',
  ddgs: 'ddgs',
  xai: 'xai'
}

const searchProviders: SearchProvider[] = [
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

/**
 * Generic web search dispatcher inspired by Hermes' provider registry.
 * Backend selection is configured through settings.webSearch.backend. Env vars
 * remain fallback inputs for CLI/dev workflows.
 */
export async function search(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  return (await searchWithProviders(query, maxResults, ctx)).results
}

async function searchWithProviders(query: string, maxResults: number, ctx: ToolContext): Promise<SearchOutcome> {
  const attempts: SearchAttempt[] = []
  const configuredRaw = configuredBackend(ctx)
  const configured = configuredRaw ? normalizeProviderName(configuredRaw) : undefined
  const configuredProvider = configured ? providerByName(configured) : undefined
  const explicit = Boolean(configuredProvider)

  if (configuredRaw && !configured) {
    attempts.push({
      provider: configuredRaw,
      ok: false,
      error: `未知搜索后端：${configuredRaw}。可用值：firecrawl、parallel、tavily、exa、searxng、brave、ddgs、xai。`
    })
  }

  const candidates = configuredProvider ? [configuredProvider] : availableProviders(ctx)
  const fallbackEnabled = webSearchSettings(ctx).fallbackEnabled !== false
  let lastProvider: SearchProvider | undefined

  for (const provider of candidates) {
    lastProvider = provider
    if (!provider.isAvailable(ctx)) {
      attempts.push({ provider: provider.name, ok: false, error: provider.unavailableReason(ctx) })
      if (explicit) break
      continue
    }

    try {
      const results = await provider.search(query, maxResults, ctx)
      attempts.push({ provider: provider.name, ok: true, count: results.length })
      if (results.length > 0 || explicit || !fallbackEnabled) {
        return {
          provider: provider.name,
          providerLabel: provider.label,
          results,
          attempts
        }
      }
    } catch (e) {
      attempts.push({ provider: provider.name, ok: false, error: e instanceof Error ? e.message : String(e) })
      if (explicit) {
        return {
          provider: provider.name,
          providerLabel: provider.label,
          results: [],
          attempts
        }
      }
    }
  }

  return {
    provider: lastProvider?.name,
    providerLabel: lastProvider?.label,
    results: [],
    attempts
  }
}

function availableProviders(ctx?: ToolContext): SearchProvider[] {
  if (!ctx) return [providerByName('ddgs')!]
  const available = searchProviders.filter((provider) => provider.auto && provider.isAvailable(ctx))
  return available.length > 0 ? available : [providerByName('ddgs')!]
}

function normalizeProviderName(value: string): WebSearchProviderName | undefined {
  return SEARCH_PROVIDER_ALIASES[value.trim().toLowerCase()]
}

function providerByName(name: WebSearchProviderName): SearchProvider | undefined {
  return searchProviders.find((provider) => provider.name === name)
}

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? ''
}

function webSearchSettings(ctx: ToolContext): Partial<ToolContext['settings']['webSearch']> {
  return ctx.settings?.webSearch ?? {}
}

function webSearchValue<K extends keyof ToolContext['settings']['webSearch']>(
  ctx: ToolContext,
  key: K,
  envName?: string
): string {
  const value = webSearchSettings(ctx)[key]
  return (typeof value === 'string' && value.trim()) || (envName ? readEnv(envName) : '')
}

function configuredBackend(ctx: ToolContext): string {
  const settingsBackend = webSearchSettings(ctx).backend
  if (settingsBackend && settingsBackend !== 'auto') return settingsBackend
  return readEnv('TEACHOS_WEB_SEARCH_BACKEND') || readEnv('WEB_SEARCH_BACKEND')
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
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
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
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    },
    ctx.proxyUrl
  )
  if (!res.ok) throw new Error(`SearXNG 返回 ${res.status}`)
  const data = await res.json()
  const rawResults = asRecordArray(asRecord(data).results)
  return [...rawResults]
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, maxResults)
    .map((item) => ({
      title: stringField(item.title).slice(0, 200) || stringField(item.url),
      url: stringField(item.url),
      snippet: stripTags(stringField(item.content)).slice(0, MAX_SNIPPET_CHARS)
    }))
    .filter((item) => /^https?:\/\//i.test(item.url))
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
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    },
    ctx.proxyUrl
  )
  if (!res.ok) throw new Error(`Brave Search 返回 ${res.status}`)
  const data = asRecord(await res.json())
  const rawResults = asRecordArray(asRecord(data.web).results)
  return rawResults
    .slice(0, maxResults)
    .map((item) => ({
      title: stripTags(stringField(item.title)).slice(0, 200) || stringField(item.url),
      url: stringField(item.url),
      snippet: stripTags(stringField(item.description)).slice(0, MAX_SNIPPET_CHARS)
    }))
    .filter((item) => /^https?:\/\//i.test(item.url))
}

function normalizeSearchResults(data: unknown, maxResults: number): SearchResult[] {
  const root = asRecord(data)
  const dataNode = asRecord(root.data)
  const webNode = asRecord(root.web)
  const candidates = [
    asRecordArray(root.results),
    asRecordArray(root.data),
    asRecordArray(root.web),
    asRecordArray(webNode.results),
    asRecordArray(dataNode.web),
    asRecordArray(dataNode.results),
    asRecordArray(dataNode)
  ].find((items) => items.length > 0) ?? []

  return candidates
    .map(recordToSearchResult)
    .filter((item): item is SearchResult => Boolean(item && /^https?:\/\//i.test(item.url)))
    .slice(0, maxResults)
}

function recordToSearchResult(item: Record<string, unknown>): SearchResult | null {
  const url =
    stringField(item.url) ||
    stringField(item.link) ||
    stringField(item.href) ||
    stringField(item.sourceURL) ||
    stringField(item.sourceUrl)
  if (!url) return null
  const title = stripTags(stringField(item.title) || stringField(item.name) || url).slice(0, 200)
  const snippet = stripTags(
    stringField(item.description) ||
      stringField(item.content) ||
      stringField(item.snippet) ||
      stringField(item.body) ||
      joinTextList(item.highlights) ||
      joinTextList(item.excerpts)
  ).slice(0, MAX_SNIPPET_CHARS)
  return { title, url, snippet }
}

function parseXaiSearchResults(data: unknown, maxResults: number): SearchResult[] {
  const text = extractResponseText(data)
  const parsed = parseJsonFromText(text)
  const parsedResults = normalizeSearchResults(parsed, maxResults)
  if (parsedResults.length > 0) return parsedResults

  const citationResults = citationsToResults(data, text, maxResults)
  if (citationResults.length > 0) return citationResults

  return normalizeSearchResults(data, maxResults)
}

function extractResponseText(data: unknown): string {
  const root = asRecord(data)
  const outputText = stringField(root.output_text)
  if (outputText) return outputText

  const output = asRecordArray(root.output)
  const parts: string[] = []
  for (const item of output) {
    const content = asRecordArray(item.content)
    for (const piece of content) {
      const text = stringField(piece.text) || stringField(piece.output_text)
      if (text) parts.push(text)
    }
  }

  const choices = asRecordArray(root.choices)
  for (const choice of choices) {
    const message = asRecord(choice.message)
    const content = stringField(message.content)
    if (content) parts.push(content)
  }

  return parts.join('\n').trim()
}

function parseJsonFromText(text: string): unknown {
  if (!text) return {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return {}
      }
    }
    return {}
  }
}

function citationsToResults(data: unknown, snippet: string, maxResults: number): SearchResult[] {
  const root = asRecord(data)
  const citations = Array.isArray(root.citations) ? root.citations : []
  return citations
    .map((citation, index) => {
      if (typeof citation === 'string') {
        return /^https?:\/\//i.test(citation)
          ? { title: citation, url: citation, snippet: stripTags(snippet).slice(0, MAX_SNIPPET_CHARS) }
          : null
      }
      const record = asRecord(citation)
      const url = stringField(record.url)
      if (!url) return null
      return {
        title: stringField(record.title) || `xAI citation ${index + 1}`,
        url,
        snippet: stripTags(stringField(record.snippet) || snippet).slice(0, MAX_SNIPPET_CHARS)
      }
    })
    .filter((item): item is SearchResult => Boolean(item && /^https?:\/\//i.test(item.url)))
    .slice(0, maxResults)
}

function joinTextList(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map((item) => typeof item === 'string' ? item : stringField(asRecord(item).text)).filter(Boolean).join(' ')
}

/**
 * DuckDuckGo Lite HTML scrape. The Instant Answer API returns almost no
 * organic results, so this remains the no-key fallback. Requests run in the
 * Electron main process (no CORS). Defensive parsing — any failure returns an
 * empty result set so the agent loop never crashes.
 */
async function searchDuckDuckGoLite(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
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
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      },
      ctx.proxyUrl
    )
    if (!res.ok) throw new Error(`DuckDuckGo 返回 ${res.status}`)
    return res.text()
  }

  let html: string
  try {
    html = await fetchOnce()
  } catch (e) {
    // Single backoff retry on transient failure / challenge page.
    await sleep(800)
    try {
      html = await fetchOnce()
    } catch {
      return []
    }
  }

  const results = parseLiteResults(html)
  if (results.length === 0) {
    // Some requests get a transient empty/challenge page; retry once more.
    await sleep(800)
    try {
      html = await fetchOnce()
      return parseLiteResults(html).slice(0, maxResults)
    } catch {
      return []
    }
  }
  return results.slice(0, maxResults)
}

/**
 * Parse lite.duckduckgo.com/lite/ result rows. The layout uses a table where
 * each result has an anchor (class "result-link") and a snippet cell. We scan
 * anchor-by-anchor and grab the next text-heavy cell as the snippet.
 */
function parseLiteResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  try {
    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    let match: RegExpExecArray | null
    while ((match = anchorRe.exec(html)) !== null) {
      const attrs = parseHtmlAttributes(match[1])
      if (!/\bresult-link\b/i.test(attrs.class ?? '')) continue
      const rawHref = attrs.href ?? ''
      const title = stripTags(match[2]).trim()
      // DDG lite sometimes wraps the real URL in a redirect param; unwrap uddg=.
      const url = unwrapDuckDuckGoHref(rawHref)
      if (!url || !/^https?:\/\//i.test(url)) continue
      const snippet = extractSnippetAfter(html, match.index + match[0].length)
      results.push({
        title: title.slice(0, 200) || url,
        url,
        snippet: snippet.slice(0, MAX_SNIPPET_CHARS)
      })
      if (results.length >= 10) break
    }
  } catch {
    return []
  }
  return results
}

function extractSnippetAfter(html: string, fromIndex: number): string {
  const rest = html.slice(fromIndex, fromIndex + 2000)
  // Find the next <td class="result-snippet">…</td> or a text block.
  const snippetMatch = rest.match(/<td\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bresult-snippet\b[^"']*\1)[^>]*>([\s\S]*?)<\/td>/i)
  if (snippetMatch) return stripTags(snippetMatch[2]).trim()
  // Fallback: any text-bearing cell before the next anchor.
  const nextAnchor = rest.search(/<a\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bresult-link\b[^"']*\1)[^>]*>/i)
  const region = nextAnchor > 0 ? rest.slice(0, nextAnchor) : rest
  const cellMatch = region.match(/<td[^>]*>([\s\S]*?)<\/td>/i)
  if (cellMatch) {
    const text = stripTags(cellMatch[1]).trim()
    if (text.length > 0) return text
  }
  return ''
}

function unwrapDuckDuckGoHref(href: string): string {
  try {
    const decoded = decodeURIComponent(decodeHtmlEntities(href))
    const u = new URL(decoded, 'https://duckduckgo.com')
    // lite links are sometimes //duckduckgo.com/l/?uddg=<encoded url>&...
    const uddg = u.searchParams.get('uddg')
    if (uddg) return uddg
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded
    return href
  } catch {
    return href
  }
}

function parseHtmlAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(input)) !== null) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const value = typeof input === 'number' ? input : Number(input)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const webSearchTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '在网络上搜索信息并返回结果摘要（标题、链接、片段）。后端由搜索设置选择，支持 Firecrawl、Parallel、Tavily、Exa、SearXNG、Brave Search、DDGS/DuckDuckGo 和 xAI。用于补充课程内容或回答事实性、时效性问题。若 query 是微信公众号文章链接，会尝试提取可见元数据并搜索公开转载/索引线索；这不能绕过微信登录墙读取原文全文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          maxResults: { type: 'number', description: '最大返回结果数，默认使用设置页配置', minimum: 1, maximum: 20, default: 5 }
        },
        required: ['query']
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    const defaultMaxResults = Math.round(clampNumber(webSearchSettings(ctx).maxResults, 1, 20, 5))
    const { query, maxResults = defaultMaxResults } = (args ?? {}) as { query?: string; maxResults?: number }
    if (!query || !query.trim()) return JSON.stringify({ error: '缺少搜索关键词 query。' })
    const normalizedQuery = query.trim()
    const cappedMax = Math.round(clampNumber(maxResults, 1, 20, defaultMaxResults))
    const wechatUrl = normalizeWeChatArticleUrl(normalizedQuery)
    if (wechatUrl) {
      const fallback = await searchWeChatArticle(wechatUrl, cappedMax, ctx)
      return JSON.stringify({ query, count: fallback.results.length, ...fallback })
    }
    const outcome = await searchWithProviders(normalizedQuery, cappedMax, ctx)
    return JSON.stringify({
      query,
      provider: outcome.providerLabel ?? outcome.provider,
      count: outcome.results.length,
      results: outcome.results,
      ...((outcome.results.length === 0 || outcome.attempts.length > 1) ? { attempts: outcome.attempts } : {})
    })
  }
}

async function searchWeChatArticle(
  url: string,
  maxResults: number,
  ctx: ToolContext
): Promise<{
  results: SearchResult[]
  wechat: {
    url: string
    access: 'restricted' | 'unknown'
    reason: string
    guidance: string
    metadata: ReturnType<typeof extractWeChatMetadata>
    fallbackQueries: string[]
    fetchError?: string
  }
}> {
  let metadata: ReturnType<typeof extractWeChatMetadata> = {}
  let access: 'restricted' | 'unknown' = 'unknown'
  let fetchError: string | undefined

  try {
    const fetched = await fetchWeChatArticleHtml(url, ctx)
    metadata = extractWeChatMetadata(fetched.html)
    if (isWeChatAccessRestricted(fetched.html)) access = 'restricted'
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e)
  }

  const fallbackQueries = buildWeChatFallbackQueries(url, metadata)
  const results = await searchMany(fallbackQueries, maxResults, ctx)
  return {
    results,
    wechat: {
      url,
      access,
      reason: WECHAT_RESTRICTED_REASON,
      guidance: WECHAT_RESTRICTED_GUIDANCE,
      metadata,
      fallbackQueries,
      ...(fetchError ? { fetchError } : {})
    }
  }
}

export async function searchMany(queries: string[], maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  const seen = new Set<string>()
  const results: SearchResult[] = []
  for (const query of queries) {
    const batch = await search(query, maxResults, ctx)
    for (const result of batch) {
      const key = normalizeResultUrlKey(result.url)
      if (seen.has(key)) continue
      seen.add(key)
      results.push(result)
      if (results.length >= maxResults) return results
    }
  }
  return results
}

function normalizeResultUrlKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}
