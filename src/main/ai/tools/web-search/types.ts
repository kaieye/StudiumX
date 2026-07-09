import type { WebSearchBackend } from '../../../../shared/teaching-types'
import type { ToolContext } from '../registry'

export type SearchResult = {
  title: string
  url: string
  snippet: string
}

export type WebSearchProviderName = Exclude<WebSearchBackend, 'auto' | 'duckduckgo'>

export type SearchProvider = {
  name: WebSearchProviderName
  label: string
  auto: boolean
  isAvailable: (ctx: ToolContext) => boolean
  unavailableReason: (ctx: ToolContext) => string
  search: (query: string, maxResults: number, ctx: ToolContext) => Promise<SearchResult[]>
}
