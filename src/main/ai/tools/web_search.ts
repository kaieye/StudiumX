import type { ToolEntry, ToolContext } from './registry'
import { availableProviders, providerByName } from './web-search/providers'
import { configuredBackend, normalizeProviderName, webSearchSettings } from './web-search/settings'
import type { SearchProvider, SearchResult, WebSearchProviderName } from './web-search/types'
import {
  buildWeChatFallbackQueries,
  extractWeChatMetadata,
  fetchWeChatArticleHtml,
  isWeChatAccessRestricted,
  normalizeWeChatArticleUrl,
  WECHAT_RESTRICTED_GUIDANCE,
  WECHAT_RESTRICTED_REASON
} from './wechat'

export type { SearchResult } from './web-search/types'

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

function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const value = typeof input === 'number' ? input : Number(input)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
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
