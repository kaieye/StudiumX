import { createDefaultSearchRuntime, type SearchResult, type SearchSource } from '../search-runtime'
import type { ToolCallContext, ToolEntry, ToolContext } from './registry'

const searchRuntime = createDefaultSearchRuntime()

export type { SearchResult, SearchSource } from '../search-runtime'

function webSearchSettings(ctx: ToolContext): Partial<ToolContext['settings']['webSearch']> {
  return ctx.settings?.webSearch ?? {}
}

function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const value = typeof input === 'number' ? input : Number(input)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export async function search(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]> {
  return (await searchRuntime.search({ query, maxResults }, ctx)).results
}

export async function searchMany(queries: string[], maxResults: number, ctx: ToolContext): Promise<SearchSource[]> {
  return searchRuntime.searchMany(queries, maxResults, ctx)
}

export const webSearchTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '在网络上搜索信息并返回结构化来源（sourceId、标题、链接、片段、retrievedAt、provider）。后端由搜索设置选择，支持 Firecrawl、Parallel、Tavily、Exa、SearXNG、Brave Search、DDGS/DuckDuckGo 和 xAI。用于补充课程内容或回答事实性、时效性问题。若 query 是微信公众号文章链接，会尝试提取可见元数据并搜索公开转载/索引线索；这不能绕过微信登录墙读取原文全文。',
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
  handler: async (args: unknown, ctx: ToolContext, callCtx?: ToolCallContext): Promise<string> => {
    const defaultMaxResults = Math.round(clampNumber(webSearchSettings(ctx).maxResults, 1, 20, 5))
    const { query, maxResults = defaultMaxResults } = (args ?? {}) as { query?: string; maxResults?: number }
    if (!query || !query.trim()) return JSON.stringify({ error: '缺少搜索关键词 query。' })
    const cappedMax = Math.round(clampNumber(maxResults, 1, 20, defaultMaxResults))
    const envelope = await searchRuntime.search({ query: query.trim(), maxResults: cappedMax }, toolContextWithSignal(ctx, callCtx))
    return JSON.stringify({
      ...envelope,
      query,
      provider: envelope.provider ?? envelope.backend,
      count: envelope.results.length,
      ...((envelope.results.length === 0 || envelope.attemptedBackends.length > 1)
        ? { attempts: envelope.attemptedBackends }
        : {})
    })
  }
}

function toolContextWithSignal(ctx: ToolContext, callCtx?: ToolCallContext): ToolContext {
  return callCtx?.signal && callCtx.signal !== ctx.signal ? { ...ctx, signal: callCtx.signal } : ctx
}
