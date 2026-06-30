import type { ToolDefinition } from '../provider-adapter'
import type { TeachingSettingsV1 } from '../../../shared/teaching-types'
import { webSearchTool } from './web_search'
import { webFetchTool } from './web_fetch'
import { workspaceTools } from './workspace'

export type ToolContext = {
  settings: TeachingSettingsV1
  proxyUrl: string
  workspaceRoot?: string
}

/** A tool handler with its ToolContext already bound (ctx curried in). */
export type BoundToolHandler = (args: unknown) => Promise<string>

export type ToolHandlerMap = Record<string, BoundToolHandler>

export type ToolEntry = {
  definition: ToolDefinition
  handler: (args: unknown, ctx: ToolContext) => Promise<string>
}

export class ToolRegistry {
  private entries = new Map<string, ToolEntry>()

  register(entry: ToolEntry): void {
    this.entries.set(entry.definition.function.name, entry)
  }

  definitions(): ToolDefinition[] {
    return [...this.entries.values()].map((e) => e.definition)
  }

  handlerMap(ctx: ToolContext): ToolHandlerMap {
    const out: ToolHandlerMap = {}
    for (const [name, entry] of this.entries) {
      out[name] = (args) => entry.handler(args, ctx)
    }
    return out
  }
}

export function buildToolContext(
  settings: TeachingSettingsV1,
  options: { workspaceRoot?: string | null } = {}
): ToolContext {
  const proxyUrl = settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
  const workspaceRoot = options.workspaceRoot?.trim() || undefined
  return { settings, proxyUrl, workspaceRoot }
}

export function buildDefaultRegistry(
  settings: TeachingSettingsV1,
  options: { workspaceRoot?: string | null } = {}
): ToolRegistry {
  const registry = new ToolRegistry()
  if (settings.tools.workspaceRead && options.workspaceRoot) {
    for (const tool of workspaceTools) registry.register(tool)
  }
  if (settings.tools.webSearch) registry.register(webSearchTool)
  if (settings.tools.webFetch) registry.register(webFetchTool)
  return registry
}
