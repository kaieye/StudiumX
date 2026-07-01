import type { ToolContext } from './registry'
import { fetchWithOptionalProxy } from '../../proxy-fetch'

export type WeChatArticleMetadata = {
  title?: string
  description?: string
  author?: string
  publishedAt?: string
}

type SearchResultLike = {
  title: string
  url: string
  snippet?: string
}

const MAX_WECHAT_REDIRECTS = 3

export const WECHAT_RESTRICTED_REASON =
  '微信公众平台限制了当前网络环境的直接访问，工具无法绕过微信登录/客户端环境抓取原文全文。'

export const WECHAT_RESTRICTED_GUIDANCE =
  '不能声称已读取原文全文；可以基于可见元数据和公开搜索结果继续分析，并提示用户粘贴正文或提供公开转载链接以获得完整内容。'

export function normalizeWeChatArticleUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (host !== 'mp.weixin.qq.com') return null
    if (url.pathname === '/s' || url.pathname.startsWith('/s/') || url.pathname.startsWith('/mp/')) {
      return url.toString()
    }
    return null
  } catch {
    return null
  }
}

export function isWeChatArticleUrl(input: string): boolean {
  return normalizeWeChatArticleUrl(input) !== null
}

export async function fetchWeChatArticleHtml(
  targetUrl: string,
  ctx: ToolContext
): Promise<{ url: string; html: string }> {
  const normalized = normalizeWeChatArticleUrl(targetUrl)
  if (!normalized) throw new Error('不是支持的微信公众号文章链接。')

  let current = normalized
  for (let hop = 0; hop <= MAX_WECHAT_REDIRECTS; hop += 1) {
    const res = await fetchWithOptionalProxy(
      current,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 MicroMessenger/8.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000)
      },
      ctx.proxyUrl
    )
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error('微信文章重定向缺少 Location 头。')
      const next = normalizeWeChatArticleUrl(new URL(location, current).toString())
      if (!next) throw new Error('微信文章重定向到了不受支持的地址。')
      current = next
      continue
    }
    if (!res.ok) throw new Error(`微信文章抓取失败：${res.status} ${res.statusText}`)
    return { url: current, html: await res.text() }
  }
  throw new Error('微信文章重定向次数过多。')
}

export function extractWeChatMetadata(html: string): WeChatArticleMetadata {
  const docTitle = readDocumentTitle(html)
  const title = firstUsefulText(
    readJsString(html, 'msg_title'),
    readMetaContent(html, ['og:title', 'twitter:title']),
    isGenericWeChatTitle(docTitle) ? '' : docTitle
  )
  const description = firstUsefulText(
    readJsString(html, 'msg_desc'),
    readMetaContent(html, ['og:description', 'twitter:description', 'description'])
  )
  const author = firstUsefulText(
    readJsString(html, 'nickname'),
    readJsString(html, 'author'),
    readMetaContent(html, ['article:author', 'og:site_name'])
  )
  const publishedAt = firstUsefulText(
    readMetaContent(html, ['article:published_time']),
    unixTimestampToIso(readJsString(html, 'ct')),
    unixTimestampToIso(readJsString(html, 'publish_time'))
  )

  return pruneEmpty({
    title,
    description,
    author,
    publishedAt
  })
}

export function isWeChatAccessRestricted(html: string, visibleText = roughHtmlToText(html)): boolean {
  const hasArticleContent = /id=["']js_content["']|class=["'][^"']*rich_media_content/i.test(html)
  const text = cleanText(visibleText)
  const restricted =
    /请在微信客户端打开|请在微信中打开|在微信客户端打开链接/.test(text) ||
    /当前环境异常|需要登录|登录后继续访问|安全验证|访问过于频繁/.test(text) ||
    /open\s+in\s+wechat|wechat\s+client/i.test(text)
  if (!restricted) return false
  if (!hasArticleContent) return true
  const articleText = roughHtmlToText(extractWeChatArticleHtml(html) ?? '')
  return articleText.length < 120
}

export function extractWeChatArticleHtml(html: string): string | null {
  const marker = html.search(/<div[^>]*id=["']js_content["'][^>]*>/i)
  if (marker < 0) return null
  const rest = html.slice(marker)
  const end = rest.search(/<script\b|<div[^>]*id=["']js_sponsor_ad_area["']|<div[^>]*class=["'][^"']*rich_media_tool/i)
  return end > 0 ? rest.slice(0, end) : rest
}

export function buildWeChatFallbackQueries(targetUrl: string, metadata: WeChatArticleMetadata): string[] {
  const queries: string[] = []
  if (metadata.title) {
    if (metadata.author) queries.push(`"${metadata.title}" "${metadata.author}"`)
    queries.push(`"${metadata.title}"`)
    queries.push(`${metadata.title} 微信公众号`)
  }
  queries.push(`"${targetUrl.replace(/#.*$/, '')}"`)

  try {
    const url = new URL(targetUrl)
    const parts = ['__biz', 'mid', 'idx', 'sn']
      .map((key) => url.searchParams.get(key))
      .filter((value): value is string => Boolean(value))
    if (parts.length > 0) queries.push(`site:mp.weixin.qq.com ${parts.join(' ')}`)
  } catch {
    // Ignore malformed fallback URL; the normalized URL path handles real use.
  }

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))]
}

export function buildWeChatRestrictedText(
  metadata: WeChatArticleMetadata,
  results: SearchResultLike[]
): string {
  const lines = ['微信文章原文访问受限，工具未获取到全文。']
  if (metadata.title) lines.push(`标题：${metadata.title}`)
  if (metadata.author) lines.push(`作者/公众号：${metadata.author}`)
  if (metadata.publishedAt) lines.push(`发布时间：${metadata.publishedAt}`)
  if (metadata.description) lines.push(`摘要：${metadata.description}`)
  if (results.length > 0) {
    lines.push('公开搜索线索：')
    for (const result of results.slice(0, 5)) {
      const snippet = result.snippet ? ` - ${result.snippet}` : ''
      lines.push(`${result.title} ${result.url}${snippet}`)
    }
  } else {
    lines.push('未找到可用的公开转载或索引结果。')
  }
  lines.push(WECHAT_RESTRICTED_GUIDANCE)
  return lines.join('\n')
}

export function roughHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>(?!\s*\/)/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readDocumentTitle(html: string): string {
  return cleanText(decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''))
}

function readMetaContent(html: string, names: string[]): string {
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  const metaRe = /<meta\b([^>]*)>/gi
  let match: RegExpExecArray | null
  while ((match = metaRe.exec(html)) !== null) {
    const attrs = readAttributes(match[1] ?? '')
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? '').toLowerCase()
    if (wanted.has(key) && attrs.content) return cleanText(decodeHtmlEntities(attrs.content))
  }
  return ''
}

function readAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(input)) !== null) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[3] ?? match[4] ?? match[5] ?? '')
  }
  return attrs
}

function readJsString(html: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(?:var\\s+)?${escapedName}\\s*=\\s*("(?:(?:\\\\.)|[^"\\\\])*"|'(?:(?:\\\\.)|[^'\\\\])*')`,
    'i'
  )
  const raw = html.match(pattern)?.[1]
  return raw ? cleanText(decodeHtmlEntities(decodeJsString(raw))) : ''
}

function decodeJsString(raw: string): string {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw
    .slice(1, -1)
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function firstUsefulText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const cleaned = cleanText(value ?? '')
    if (cleaned) return cleaned
  }
  return undefined
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function unixTimestampToIso(value: string | undefined): string | undefined {
  if (!value || !/^\d{10,13}$/.test(value)) return undefined
  const raw = Number(value)
  const ms = value.length === 13 ? raw : raw * 1000
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function pruneEmpty<T extends Record<string, string | undefined>>(input: T): T {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value) out[key] = value
  }
  return out as T
}

function isGenericWeChatTitle(title: string): boolean {
  return /^(微信公众平台|微信公众平台安全保护|安全验证|Weixin Official Accounts Platform)$/i.test(title)
}
