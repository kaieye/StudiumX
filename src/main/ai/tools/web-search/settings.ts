import type { ToolContext } from '../registry'
import type { WebSearchProviderName } from './types'

export const SEARCH_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_SEARCH_RESULTS = 5
export const MIN_SEARCH_RESULTS = 1
export const MAX_SEARCH_RESULTS = 20

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

export function normalizeProviderName(value: string): WebSearchProviderName | undefined {
  return SEARCH_PROVIDER_ALIASES[value.trim().toLowerCase()]
}

export function readEnv(name: string): string {
  return process.env[name]?.trim() ?? ''
}

export function webSearchSettings(ctx: ToolContext): Partial<ToolContext['settings']['webSearch']> {
  return ctx.settings?.webSearch ?? {}
}

export function webSearchValue<K extends keyof ToolContext['settings']['webSearch']>(
  ctx: ToolContext,
  key: K,
  envName?: string
): string {
  const value = webSearchSettings(ctx)[key]
  return (typeof value === 'string' && value.trim()) || (envName ? readEnv(envName) : '')
}

export function configuredBackend(ctx: ToolContext): string {
  const settingsBackend = webSearchSettings(ctx).backend
  if (settingsBackend && settingsBackend !== 'auto') return settingsBackend
  return readEnv('STUDIUMX_WEB_SEARCH_BACKEND') || readEnv('TEACHOS_WEB_SEARCH_BACKEND') || readEnv('WEB_SEARCH_BACKEND')
}

export function configuredMaxResults(ctx: ToolContext): number {
  const value = Number(webSearchSettings(ctx).maxResults)
  if (!Number.isFinite(value)) return DEFAULT_MAX_SEARCH_RESULTS
  return Math.round(Math.min(MAX_SEARCH_RESULTS, Math.max(MIN_SEARCH_RESULTS, value)))
}
