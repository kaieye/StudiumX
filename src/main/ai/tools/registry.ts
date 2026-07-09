import type { ToolDefinition } from '../provider-adapter'
import type { TeachingSettingsV1 } from '../../../shared/teaching-types'
import { webSearchTool } from './web_search'
import { webFetchTool } from './web_fetch'
import { workspaceReadTools, writeWorkspaceFileTool } from './workspace'

export type ToolContext = {
  settings: TeachingSettingsV1
  proxyUrl: string
  workspaceRoot?: string
}

export type ToolRuntimeChildRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

export type ToolRuntimeChildRunRecord = {
  id: string
  label: string
  profile: string
  status: ToolRuntimeChildRunStatus
  summary?: string
  error?: string
  startedAt?: string
  completedAt?: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    toolCalls: number
  }
}

export type ToolRuntimeEvent =
  | { type: 'child_run_queued'; child: ToolRuntimeChildRunRecord }
  | { type: 'child_run_started'; child: ToolRuntimeChildRunRecord }
  | { type: 'child_run_delta'; childRunId: string; message: string }
  | { type: 'child_run_completed'; child: ToolRuntimeChildRunRecord }
  | { type: 'child_run_failed'; child: ToolRuntimeChildRunRecord }
  | { type: 'child_run_canceled'; child: ToolRuntimeChildRunRecord }

/** Contextual information about the specific tool call being executed,
 *  passed into handlers so they can correlate back-ends (e.g. the `ask`
 *  tool needs `toolCallId` to route the user's answer back). Optional so
 *  legacy handlers can ignore it. */
export type ToolCallContext = {
  toolCallId: string
  toolName: string
  emit?: (event: ToolRuntimeEvent) => void
}

/** A tool handler with its ToolContext already bound (ctx curried in). */
export type BoundToolHandler = (args: unknown, callCtx?: ToolCallContext) => Promise<string>

export type ToolHandlerMap = Record<string, BoundToolHandler>

export type ToolEntry = {
  definition: ToolDefinition
  handler: (args: unknown, ctx: ToolContext, callCtx?: ToolCallContext) => Promise<string>
}

export class ToolRegistry {
  private entries = new Map<string, ToolEntry>()

  register(entry: ToolEntry): void {
    this.entries.set(entry.definition.function.name, entry)
  }

  names(): string[] {
    return [...this.entries.keys()]
  }

  project(options: { allow?: Iterable<string>; deny?: Iterable<string> }): ToolRegistry {
    const allow = options.allow ? new Set(options.allow) : null
    const deny = options.deny ? new Set(options.deny) : new Set<string>()
    const registry = new ToolRegistry()
    for (const [name, entry] of this.entries) {
      if (allow && !allow.has(name)) continue
      if (deny.has(name)) continue
      registry.register(entry)
    }
    return registry
  }

  definitions(): ToolDefinition[] {
    return [...this.entries.values()].map((e) => e.definition)
  }

  handlerMap(ctx: ToolContext): ToolHandlerMap {
    const out: ToolHandlerMap = {}
    for (const [name, entry] of this.entries) {
      out[name] = (args, callCtx) => entry.handler(args, ctx, callCtx)
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
  options: { workspaceRoot?: string | null; workspaceWrite?: boolean } = {}
): ToolRegistry {
  const registry = new ToolRegistry()
  if (settings.tools.workspaceRead && options.workspaceRoot) {
    for (const tool of workspaceReadTools) registry.register(tool)
    if (options.workspaceWrite === true) registry.register(writeWorkspaceFileTool)
  }
  if (settings.tools.webSearch) registry.register(webSearchTool)
  if (settings.tools.webFetch) registry.register(webFetchTool)
  return registry
}
