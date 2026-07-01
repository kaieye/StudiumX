import type { ToolEntry, ToolContext } from './registry'
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

const MAX_SNIPPET_CHARS = 200

/**
 * DuckDuckGo lite HTML scrape. The Instant Answer API returns almost no
 * organic results, so we scrape https://lite.duckduckgo.com/lite/ instead.
 * Requests run in the Electron main process (no CORS). Defensive parsing —
 * any failure returns an empty result set so the agent loop never crashes.
 */
export async function search(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
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
        signal: AbortSignal.timeout(15_000)
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
    const anchorRe = /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let match: RegExpExecArray | null
    while ((match = anchorRe.exec(html)) !== null) {
      const rawHref = match[1]
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
  const snippetMatch = rest.match(/<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i)
  if (snippetMatch) return stripTags(snippetMatch[1]).trim()
  // Fallback: any text-bearing cell before the next anchor.
  const nextAnchor = rest.search(/<a[^>]*class="[^"]*result-link/i)
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
    const decoded = decodeURIComponent(href)
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

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
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
        '在网络上搜索信息并返回结果摘要（标题、链接、片段）。用于补充课程内容或回答事实性、时效性问题。最多返回 5 条结果。若 query 是微信公众号文章链接，会尝试提取可见元数据并搜索公开转载/索引线索；这不能绕过微信登录墙读取原文全文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          maxResults: { type: 'number', description: '最大返回结果数，默认 5', minimum: 1, maximum: 10, default: 5 }
        },
        required: ['query']
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    const { query, maxResults = 5 } = (args ?? {}) as { query?: string; maxResults?: number }
    if (!query || !query.trim()) return JSON.stringify({ error: '缺少搜索关键词 query。' })
    const normalizedQuery = query.trim()
    const cappedMax = Math.min(Math.max(1, maxResults), 10)
    const wechatUrl = normalizeWeChatArticleUrl(normalizedQuery)
    if (wechatUrl) {
      const fallback = await searchWeChatArticle(wechatUrl, cappedMax, ctx)
      return JSON.stringify({ query, count: fallback.results.length, ...fallback })
    }
    const results = await search(normalizedQuery, cappedMax, ctx)
    return JSON.stringify({ query, count: results.length, results })
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
