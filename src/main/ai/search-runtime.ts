import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { fetchWithOptionalProxy } from '../proxy-fetch'
import type { ToolContext } from './tools/registry'
import { decodeHtmlEntities, stripTags } from './tools/web-search/normalizers'
import { availableProviders, resolveConfiguredProvider, searchProviders, supportedProviderNames } from './tools/web-search/providers'
import { configuredMaxResults, webSearchSettings } from './tools/web-search/settings'
import type { SearchProvider, SearchResult, WebSearchProviderName } from './tools/web-search/types'
export type { SearchResult } from './tools/web-search/types'
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

type SearchOutcome = {
  provider?: WebSearchProviderName
  providerLabel?: string
  results: SearchResult[]
  attempts: SearchAttempt[]
}

export type SearchRuntimeOptions = {
  now?: () => Date
  resolveHostname?: (hostname: string) => Promise<string[]>
  maxFetchChars?: number
  maxFetchBytes?: number
}

const FETCH_TIMEOUT_MS = 20_000
const DEFAULT_MAX_FETCH_CHARS = 6000
const DEFAULT_MAX_FETCH_BYTES = 192_000
const TOOL_CANCELED_MESSAGE = '工具调用已取消。'
const MAX_REDIRECTS = 3

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
    throwIfToolCanceled(ctx.signal)
    const query = input.query.trim()
    const maxResults = Math.round(clampNumber(input.maxResults, 1, 20, configuredMaxResults(ctx)))
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
    throwIfToolCanceled(ctx.signal)
    const url = input.url.trim()
    const wechatUrl = normalizeWeChatArticleUrl(url)
    if (wechatUrl) return this.fetchWeChatUrlText(wechatUrl, ctx)
    return this.fetchPublicUrlText(url, ctx)
  }

  async searchMany(queries: string[], maxResults: number, ctx: ToolContext): Promise<SearchSource[]> {
    throwIfToolCanceled(ctx.signal)
    const seen = new Set<string>()
    const results: SearchSource[] = []
    for (const query of queries) {
      throwIfToolCanceled(ctx.signal)
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
    const configured = resolveConfiguredProvider(ctx)
    const configuredRaw = configured.requestedBackend
    const configuredProvider = configured.provider
    const explicit = Boolean(configuredProvider)

    if (configuredRaw && !configured.normalizedName) {
      attempts.push({
        backend: configuredRaw,
        provider: configuredRaw,
        ok: false,
        error: `未知搜索后端：${configuredRaw}。可用值：${supportedProviderNames.join('、')}。`
      })
    }

    const candidates = configuredProvider ? [configuredProvider] : availableProviders(ctx)
    const fallbackEnabled = webSearchSettings(ctx).fallbackEnabled !== false
    let lastProvider: SearchProvider | undefined

    for (const provider of candidates) {
      throwIfToolCanceled(ctx.signal)
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
        if (ctx.signal?.aborted) throw e
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
      if (ctx.signal?.aborted) throw e
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
      throwIfToolCanceled(ctx.signal)
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
            signal: withToolTimeoutSignal(ctx.signal, FETCH_TIMEOUT_MS)
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
      if (ctx.signal?.aborted) throw e
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

function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const value = typeof input === 'number' ? input : Number(input)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function withToolTimeoutSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal
}

function throwIfToolCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(TOOL_CANCELED_MESSAGE)
}
