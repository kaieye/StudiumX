import { assertSafeFetchUrl, createDefaultSearchRuntime } from '../search-runtime'
import type { ToolEntry } from './registry'

const searchRuntime = createDefaultSearchRuntime()

export function assertSafeUrl(input: string): string {
  return assertSafeFetchUrl(input)
}

export { assertSafeFetchUrl }

export const webFetchTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        '抓取指定 URL 的正文文本（默认最多约 6000 字符），并返回 sourceId、finalUrl、retrievedAt、contentType、truncated 和抓取 attempts。用于深入阅读某条 web_search 结果。仅支持 http/https 公网地址，会检查重定向和 DNS 解析后的地址。微信公众号链接若遇到微信登录墙，会返回可见元数据和公开搜索线索，不能绕过登录墙读取原文全文。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的完整 URL（http/https）' }
        },
        required: ['url']
      }
    }
  },
  handler: async (args: unknown, ctx): Promise<string> => {
    const { url } = (args ?? {}) as { url?: string }
    if (!url || !url.trim()) return JSON.stringify({ error: '缺少参数 url。' })
    try {
      const envelope = await searchRuntime.fetch({ url: url.trim() }, ctx)
      return JSON.stringify({
        ...envelope,
        url
      })
    } catch (e) {
      return JSON.stringify({ url, error: e instanceof Error ? e.message : String(e) })
    }
  }
}
