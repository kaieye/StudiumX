import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import type { WebSearchBackend } from '../../shared/teaching-types'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import type { ToolContext } from './tools/registry'
import {
  buildWeChatFallbackQueries,
  buildWeChatRestrictedText,
  extractWeChatArticleHtml,
  extractWeChatMetadata,
  fetchWeChatArticleHtml,
  isWeChatAccessRestricted,
  normalizeWeChatArticleUrl,
  WECHAT_RESTRICTED_GUIDANCE,
  WECHAT_RESTRICTED_REASON
} from './tools/wechat'

export type SearchResult = {
  title: string
  url: string
  snippet: string
}

export type SearchSource = SearchResult & {
  sourceId: string
  retrievedAt: string
  provider: string
  publishedAt?: string
  score?: number
}

export type SearchInput = {
  query: string
  maxResults?: number
}

export type SearchAttempt = {
  backend: string
  provider: string
  ok: boolean
  count?: number
  error?: string
  latencyMs?: number
}

export type SearchResultEnvelope = {
  query: string
  backend?: string
  provider?: string
  count: number
  attemptedBackends: SearchAttempt[]
  attempts: SearchAttempt[]
  results: SearchSource[]
  wechat?: {
    url: string
    access: 'restricted' | 'unknown'
    reason: string
    guidance: string
    metadata: ReturnType<typeof extractWeChatMetadata>
    fallbackQueries: string[]
    fetchError?: string
  }
}

export type FetchInput = {
  url: string
}

export type FetchAttempt = {
  url: string
  ok: boolean
  status?: number
  statusText?: string
  finalUrl?: string
  redirectTo?: string
  contentType?: string
  error?: string
  latencyMs?: number
  proxy?: 'none' | 'configured'
}

export type FetchResultEnvelope = {
  sourceId: string
  url: string
  finalUrl: string
  resolvedUrl: string
  retrievedAt: string
  contentType?: string
  title?: string
  text: string
  length: number
  truncated: boolean
  attempts: FetchAttempt[]
  access?: 'restricted'
  reason?: string
  guidance?: string
  metadata?: ReturnType<typeof extractWeChatMetadata>
  fallbackQueries?: string[]
  count?: number
  results?: SearchSource[]
  fetchError?: string
}

export type SearchDiagnostics = {
  providerCount: number
  fetchMaxChars: number
  fetchMaxBytes: number
}

type WebSearchProviderName = Exclude<WebSearchBackend, 'auto' | 'duckduckgo'>

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

export type SearchRuntimeOptions = {
  now?: () => Date
  resolveHostname?: (hostname: string) => Promise<string[]>
  maxFetchChars?: number
  maxFetchBytes?: number
}

const MAX_SNIPPET_CHARS = 200
const SEARCH_TIMEOUT_MS = 15_000
const FETCH_TIMEOUT_MS = 20_000
const DEFAULT_MAX_FETCH_CHARS = 6000
const DEFAULT_MAX_FETCH_BYTES = 192_000
const MAX_REDIRECTS = 3
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

export class SearchRuntime {
  private readonly now: () => Date
  private readonly resolveHostname: (hostname: string) => Promise<string[]>
  private readonly maxFetchChars: number
  private readonly maxFetchBytes: number

  constructor(options: SearchRuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.resolveHostname = options.resolveHostname ?? resolveHostnameWithDns
    this.maxFetchChars = Math.max(1, options.maxFetchChars ?? DEFAULT_MAX_FETCH_CHARS)
    this.maxFetchBytes = Math.max(1024, options.maxFetchBytes ?? DEFAULT_MAX_FETCH_BYTES)
  }

  async search(input: SearchInput, ctx: ToolContext): Promise<SearchResultEnvelope> {
    const query = input.query.trim()
    const maxResults = Math.round(clampNumber(input.maxResults, 1, 20, defaultMaxResults(ctx)))
    const wechatUrl = normalizeWeChatArticleUrl(query)
    if (wechatUrl) return this.searchWeChatArticle(wechatUrl, maxResults, ctx, input.query)

    const outcome = await this.searchWithProviders(query, maxResults, ctx)
    return this.buildSearchEnvelope({
      query: input.query,
      backend: outcome.provider,
      provider: outcome.providerLabel ?? outcome.provider,
      results: outcome.results,
      attempts: outcome.attempts
    })
  }

  async fetch(input: FetchInput, ctx: ToolContext): Promise<FetchResultEnvelope> {
    const url = input.url.trim()
    const wechatUrl = normalizeWeChatArticleUrl(url)
    if (wechatUrl) return this.fetchWeChatUrlText(wechatUrl, ctx)
    return this.fetchPublicUrlText(url, ctx)
  }

  async searchMany(queries: string[], maxResults: number, ctx: ToolContext): Promise<SearchSource[]> {
    const seen = new Set<string>()
    const results: SearchSource[] = []
    for (const query of queries) {
      const batch = await this.search({ query, maxResults }, ctx)
      for (const result of batch.results) {
        const key = normalizeResultUrlKey(result.url)
        if (seen.has(key)) continue
        seen.add(key)
        results.push(result)
        if (results.length >= maxResults) return results
      }
    }
    return results
  }

  diagnostics(): SearchDiagnostics {
    return {
      providerCount: searchProviders.length,
      fetchMaxChars: this.maxFetchChars,
      fetchMaxBytes: this.maxFetchBytes
    }
  }

  private async searchWithProviders(query: string, maxResults: number, ctx: ToolContext): Promise<SearchOutcome> {
    const attempts: SearchAttempt[] = []
    const configuredRaw = configuredBackend(ctx)
    const configured = configuredRaw ? normalizeProviderName(configuredRaw) : undefined
    const configuredProvider = configured ? providerByName(configured) : undefined
    const explicit = Boolean(configuredProvider)

    if (configuredRaw && !configured) {
      attempts.push({
        backend: configuredRaw,
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
        attempts.push({
          backend: provider.name,
          provider: provider.name,
          ok: false,
          error: provider.unavailableReason(ctx)
        })
        if (explicit) break
        continue
      }

      const startedAt = Date.now()
      try {
        const results = await provider.search(query, maxResults, ctx)
        attempts.push({
          backend: provider.name,
          provider: provider.name,
          ok: true,
          count: results.length,
          latencyMs: Date.now() - startedAt
        })
        if (results.length > 0 || explicit || !fallbackEnabled) {
          return {
            provider: provider.name,
            providerLabel: provider.label,
            results,
            attempts
          }
        }
      } catch (e) {
        attempts.push({
          backend: provider.name,
          provider: provider.name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          latencyMs: Date.now() - startedAt
        })
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

  private buildSearchEnvelope(opts: {
    query: string
    backend?: string
    provider?: string
    results: SearchResult[]
    attempts: SearchAttempt[]
    wechat?: SearchResultEnvelope['wechat']
  }): SearchResultEnvelope {
    const retrievedAt = this.now().toISOString()
    const provider = opts.provider ?? opts.backend ?? 'unknown'
    const sources = opts.results.map((result) => toSearchSource(result, provider, retrievedAt))
    return {
      query: opts.query,
      backend: opts.backend,
      provider: opts.provider,
      count: sources.length,
      attemptedBackends: opts.attempts,
      attempts: opts.attempts,
      results: sources,
      ...(opts.wechat ? { wechat: opts.wechat } : {})
    }
  }

  private async searchWeChatArticle(
    url: string,
    maxResults: number,
    ctx: ToolContext,
    originalQuery: string
  ): Promise<SearchResultEnvelope> {
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
    const results = await this.searchMany(fallbackQueries, maxResults, ctx)
    const attempts: SearchAttempt[] = [
      {
        backend: 'wechat_fallback',
        provider: 'wechat_fallback',
        ok: true,
        count: results.length
      }
    ]
    return {
      query: originalQuery,
      backend: 'wechat_fallback',
      provider: 'WeChat fallback search',
      count: results.length,
      attemptedBackends: attempts,
      attempts,
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

  private async fetchPublicUrlText(targetUrl: string, ctx: ToolContext): Promise<FetchResultEnvelope> {
    let current = await this.assertResolvedSafeUrl(targetUrl)
    const attempts: FetchAttempt[] = []

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const startedAt = Date.now()
      const attempt: FetchAttempt = {
        url: current,
        ok: false,
        proxy: ctx.proxyUrl ? 'configured' : 'none'
      }
      attempts.push(attempt)
      try {
        const res = await fetchWithOptionalProxy(
          current,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            redirect: 'manual',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
          },
          ctx.proxyUrl
        )

        attempt.status = res.status
        attempt.statusText = res.statusText
        attempt.latencyMs = Date.now() - startedAt

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location')
          if (!location) throw new Error('重定向缺少 Location 头。')
          const redirectTo = new URL(location, current).toString()
          attempt.redirectTo = redirectTo
          try {
            current = await this.assertResolvedSafeUrl(redirectTo)
            attempt.ok = true
          } catch (e) {
            attempt.error = e instanceof Error ? e.message : String(e)
            throw e
          }
          continue
        }

        if (!res.ok) throw new Error(`抓取失败：${res.status} ${res.statusText}`)

        const contentType = res.headers.get('content-type') ?? ''
        attempt.ok = true
        attempt.contentType = contentType
        attempt.finalUrl = current

        const raw = await readResponseTextLimited(res, this.maxFetchBytes)
        const looksHtml = /html/i.test(contentType) || /<!doctype html|<html/i.test(raw.text.slice(0, 200))
        const title = looksHtml ? extractHtmlTitle(raw.text) : undefined
        const body = looksHtml ? htmlToText(raw.text) : raw.text
        const truncated = raw.truncated || body.length > this.maxFetchChars
        const text = body.slice(0, this.maxFetchChars)
        return {
          sourceId: sourceIdForUrl(current, 'fetch'),
          url: targetUrl,
          finalUrl: current,
          resolvedUrl: current,
          retrievedAt: this.now().toISOString(),
          contentType,
          ...(title ? { title } : {}),
          text,
          length: text.length,
          truncated,
          attempts
        }
      } catch (e) {
        attempt.error = e instanceof Error ? e.message : String(e)
        attempt.latencyMs = Date.now() - startedAt
        throw e
      }
    }

    throw new Error('重定向次数过多。')
  }

  private async fetchWeChatUrlText(targetUrl: string, ctx: ToolContext): Promise<FetchResultEnvelope> {
    try {
      const fetched = await fetchWeChatArticleHtml(targetUrl, ctx)
      const articleHtml = extractWeChatArticleHtml(fetched.html)
      const articleText = articleHtml ? htmlToText(articleHtml) : ''
      if (articleText.length >= 120 && !isWeChatAccessRestricted(fetched.html, articleText)) {
        const text = articleText.slice(0, this.maxFetchChars)
        return {
          sourceId: sourceIdForUrl(fetched.url, 'wechat'),
          url: targetUrl,
          finalUrl: fetched.url,
          resolvedUrl: fetched.url,
          retrievedAt: this.now().toISOString(),
          contentType: 'text/html',
          text,
          length: text.length,
          truncated: articleText.length > this.maxFetchChars,
          attempts: [{ url: targetUrl, ok: true, finalUrl: fetched.url, proxy: ctx.proxyUrl ? 'configured' : 'none' }]
        }
      }
      const metadata = extractWeChatMetadata(fetched.html)
      return this.buildRestrictedWeChatFetchPayload({
        targetUrl,
        resolvedUrl: fetched.url,
        metadata,
        ctx
      })
    } catch (e) {
      return this.buildRestrictedWeChatFetchPayload({
        targetUrl,
        resolvedUrl: targetUrl,
        metadata: {},
        fetchError: e instanceof Error ? e.message : String(e),
        ctx
      })
    }
  }

  private async buildRestrictedWeChatFetchPayload(opts: {
    targetUrl: string
    resolvedUrl: string
    metadata: ReturnType<typeof extractWeChatMetadata>
    fetchError?: string
    ctx: ToolContext
  }): Promise<FetchResultEnvelope> {
    const { targetUrl, resolvedUrl, metadata, fetchError, ctx } = opts
    const fallbackQueries = buildWeChatFallbackQueries(resolvedUrl, metadata)
    const results = await this.searchMany(fallbackQueries, 5, ctx)
    const text = buildWeChatRestrictedText(metadata, results)
    return {
      sourceId: sourceIdForUrl(resolvedUrl, 'wechat'),
      url: targetUrl,
      finalUrl: resolvedUrl,
      resolvedUrl,
      retrievedAt: this.now().toISOString(),
      text,
      length: text.length,
      truncated: false,
      attempts: [
        {
          url: targetUrl,
          ok: !fetchError,
          finalUrl: resolvedUrl,
          error: fetchError,
          proxy: ctx.proxyUrl ? 'configured' : 'none'
        }
      ],
      access: 'restricted',
      reason: WECHAT_RESTRICTED_REASON,
      guidance: WECHAT_RESTRICTED_GUIDANCE,
      metadata,
      ...(fetchError ? { fetchError } : {}),
      fallbackQueries,
      count: results.length,
      results
    }
  }

  private async assertResolvedSafeUrl(input: string): Promise<string> {
    const normalized = assertSafeFetchUrl(input)
    const hostname = normalizedHostname(new URL(normalized).hostname)
    if (isIP(hostname) !== 0) return normalized

    const addresses = await this.resolveHostname(hostname)
    if (addresses.length === 0) throw new Error('DNS 解析没有返回可用地址。')
    for (const address of addresses) assertSafeHost(address)
    return normalized
  }
}

export function createDefaultSearchRuntime(options?: SearchRuntimeOptions): SearchRuntime {
  return new SearchRuntime(options)
}

export function assertSafeFetchUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('无效的 URL。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`仅允许 http/https 协议，拒绝：${url.protocol}`)
  }
  assertSafeHost(url.hostname)
  return url.toString()
}

function assertSafeHost(input: string): void {
  const host = normalizedHostname(input)
  if (host === 'localhost' || host === 'ip6-localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('拒绝访问本地地址。')
  }
  if (host === 'metadata.google.internal' || host === 'metadata') {
    throw new Error('拒绝访问云元数据地址。')
  }
  const ipVersion = isIP(host)
  if (ipVersion === 4) {
    if (isUnsafeIpv4(host)) throw new Error('拒绝访问内网/回环地址。')
    return
  }
  if (ipVersion === 6) {
    if (isUnsafeIpv6(host)) throw new Error('拒绝访问内网/回环地址。')
  }
}

function normalizedHostname(hostname: string): string {
  return hostname.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

function isUnsafeIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c, d] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 169 && b === 254 && c === 169 && d === 254) ||
    a >= 224
  )
}

function isUnsafeIpv6(address: string): boolean {
  const normalized = normalizedHostname(address)
  if (normalized === '::' || normalized === '::1') return true
  const mappedIpv4 = mappedIpv4FromIpv6(normalized)
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4)
  const groups = expandIpv6(normalized)
  if (!groups) return true
  const first = groups[0]
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && groups[1] === 0x0db8)
  )
}

function mappedIpv4FromIpv6(address: string): string | null {
  const dotted = address.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1]
  if (dotted) return dotted
  const groups = expandIpv6(address)
  if (!groups) return null
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const high = groups[6]
    const low = groups[7]
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }
  if (groups.slice(0, 6).every((group) => group === 0) && (groups[6] !== 0 || groups[7] !== 0)) {
    const high = groups[6]
    const low = groups[7]
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }
  return null
}

function expandIpv6(address: string): number[] | null {
  const zoneIndex = address.indexOf('%')
  const withoutZone = zoneIndex >= 0 ? address.slice(0, zoneIndex) : address
  const ipv4Tail = withoutZone.match(/(.+:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  let candidate = withoutZone
  let tailGroups: number[] = []
  if (ipv4Tail) {
    const parts = ipv4Tail[2].split('.').map((part) => Number(part))
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
    tailGroups = [(parts[0] << 8) + parts[1], (parts[2] << 8) + parts[3]]
    candidate = `${ipv4Tail[1]}${tailGroups.map((part) => part.toString(16)).join(':')}`
  }

  if (!candidate.includes('::')) {
    const groups = candidate.split(':').map(parseIpv6Group)
    return groups.length === 8 && groups.every((group) => group !== null) ? groups as number[] : null
  }

  const [leftRaw, rightRaw] = candidate.split('::')
  if (candidate.indexOf('::') !== candidate.lastIndexOf('::')) return null
  const left = leftRaw ? leftRaw.split(':').map(parseIpv6Group) : []
  const right = rightRaw ? rightRaw.split(':').map(parseIpv6Group) : []
  if ([...left, ...right].some((group) => group === null)) return null
  const missing = 8 - left.length - right.length
  if (missing < 1) return null
  return [...left as number[], ...Array.from({ length: missing }, () => 0), ...right as number[]]
}

function parseIpv6Group(value: string): number | null {
  if (!/^[0-9a-f]{1,4}$/i.test(value)) return null
  const parsed = Number.parseInt(value, 16)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0xffff ? parsed : null
}

async function resolveHostnameWithDns(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: false })
  return records.map((record) => record.address)
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
  return readEnv('STUDIUMX_WEB_SEARCH_BACKEND') || readEnv('TEACHOS_WEB_SEARCH_BACKEND') || readEnv('WEB_SEARCH_BACKEND')
}

function defaultMaxResults(ctx: ToolContext): number {
  return Math.round(clampNumber(webSearchSettings(ctx).maxResults, 1, 20, 5))
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
  } catch {
    await sleep(800)
    try {
      html = await fetchOnce()
    } catch {
      return []
    }
  }

  const results = parseLiteResults(html)
  if (results.length === 0) {
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
  const snippetMatch = rest.match(/<td\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bresult-snippet\b[^"']*\1)[^>]*>([\s\S]*?)<\/td>/i)
  if (snippetMatch) return stripTags(snippetMatch[2]).trim()
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
    const decoded = decodeHtmlEntities(decodeURIComponent(href))
    const url = new URL(decoded, 'https://duckduckgo.com')
    const uddg = url.searchParams.get('uddg')
    if (uddg) return uddg
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded
    return href
  } catch {
    return href
  }
}

async function readResponseTextLimited(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    const text = await res.text()
    return {
      text: text.slice(0, maxBytes),
      truncated: text.length > maxBytes
    }
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (total + value.byteLength > maxBytes) {
        const remaining = Math.max(0, maxBytes - total)
        if (remaining > 0) chunks.push(value.slice(0, remaining))
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  const decoder = new TextDecoder()
  return {
    text: chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode(),
    truncated
  }
}

function toSearchSource(result: SearchResult, provider: string, retrievedAt: string): SearchSource {
  return {
    sourceId: sourceIdForUrl(result.url, provider),
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    retrievedAt,
    provider
  }
}

function sourceIdForUrl(url: string, provider: string): string {
  const normalized = normalizeResultUrlKey(url)
  const digest = createHash('sha1').update(`${provider}\n${normalized}`).digest('hex').slice(0, 12)
  return `src_${digest}`
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

function parseHtmlAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(input)) !== null) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>(?!\s*\/)/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractHtmlTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const cleaned = title ? stripTags(title) : ''
  return cleaned || undefined
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
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : []
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
