import type { ToolEntry, ToolContext } from './registry'
import { fetchWithOptionalProxy } from '../../proxy-fetch'

const MAX_BODY_CHARS = 6000
const MAX_REDIRECTS = 3

/**
 * Fetch a URL and return its text content (tags stripped). Used to let the
 * agent dig into a specific search result. SSRF-guarded: rejects non-http(s)
 * and loopback/private addresses (Electron main has filesystem access, so this
 * matters). Redirects followed manually (works for both plain fetch and proxied
 * paths), capped at MAX_REDIRECTS hops.
 */
async function fetchUrlText(targetUrl: string, ctx: ToolContext): Promise<string> {
  const safe = assertSafeUrl(targetUrl)
  let current = safe
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchWithOptionalProxy(
      current,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000)
      },
      ctx.proxyUrl
    )
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error('重定向缺少 Location 头。')
      current = assertSafeUrl(new URL(location, current).toString())
      continue
    }
    if (!res.ok) throw new Error(`抓取失败：${res.status} ${res.statusText}`)
    const type = res.headers.get('content-type') ?? ''
    const raw = await res.text()
    if (/html/i.test(type) || /<!doctype html|<html/i.test(raw.slice(0, 200))) {
      return htmlToText(raw).slice(0, MAX_BODY_CHARS)
    }
    // Non-HTML (JSON, plain text, etc.) — return as-is.
    return raw.slice(0, MAX_BODY_CHARS)
  }
  throw new Error('重定向次数过多。')
}

function assertSafeUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('无效的 URL。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`仅允许 http/https 协议，拒绝：${url.protocol}`)
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === 'ip6-localhost' || host.endsWith('.localhost')) {
    throw new Error('拒绝访问本地地址。')
  }
  // Block IPv4 loopback / private / link-local ranges.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map((p) => Number(p))
    const [a, b] = parts
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    ) {
      throw new Error('拒绝访问内网/回环地址。')
    }
  }
  return url.toString()
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>(?!\s*\/)/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const webFetchTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        '抓取指定 URL 的正文文本（最多约 6000 字符）。用于深入阅读某条 web_search 结果。仅支持 http/https 公网地址。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的完整 URL（http/https）' }
        },
        required: ['url']
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    const { url } = (args ?? {}) as { url?: string }
    if (!url || !url.trim()) return JSON.stringify({ error: '缺少参数 url。' })
    try {
      const text = await fetchUrlText(url.trim(), ctx)
      return JSON.stringify({ url, length: text.length, text })
    } catch (e) {
      return JSON.stringify({ url, error: e instanceof Error ? e.message : String(e) })
    }
  }
}
