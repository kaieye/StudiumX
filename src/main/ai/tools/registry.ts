import type { ToolDefinition } from '../provider-adapter'
import type { TeachingSettingsV1 } from '../../../shared/teaching-types'
import { webSearchTool } from './web_search'
import { webFetchTool } from './web_fetch'
import { workspaceReadTools, writeWorkspaceFileTool } from './workspace'

export type ToolPermissionKind =
  | 'workspace_write'
  | 'workspace_read'
  | 'external_network'

export type ToolPermissionRequest = {
  id: string
  kind: ToolPermissionKind
  toolName: string
  operation: string
  targetPath?: string
  reason?: string
  creates?: boolean
}

export type ToolPermissionDecision = {
  decision: 'allow' | 'deny'
  reason?: string
}

export type ToolPermissionDescriptor = {
  kind: ToolPermissionKind
  describe: (args: unknown, ctx: ToolContext, callCtx?: ToolCallContext) =>
    | Omit<ToolPermissionRequest, 'id' | 'kind' | 'toolName'>
    | Promise<Omit<ToolPermissionRequest, 'id' | 'kind' | 'toolName'>>
}

export type ToolPermissionResolver = (
  request: ToolPermissionRequest,
  callCtx?: ToolCallContext
) => Promise<ToolPermissionDecision>

export type ToolContext = {
  settings: TeachingSettingsV1
  proxyUrl: string
  workspaceRoot?: string
  requestToolPermission?: ToolPermissionResolver
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
  permission?: ToolPermissionDescriptor
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
      out[name] = async (args, callCtx) => {
        const permission = entry.permission
        if (permission) {
          const decision = await resolveToolPermission(name, permission, args, ctx, callCtx)
          if (decision.decision === 'deny') {
            return JSON.stringify({
              tool: name,
              error: decision.reason ?? '工具调用未获批准。',
              permission: {
                kind: permission.kind,
                decision: decision.decision
              }
            }, null, 2)
          }
        }
        return entry.handler(args, ctx, callCtx)
      }
    }
    return out
  }
}

export function buildToolContext(
  settings: TeachingSettingsV1,
  options: { workspaceRoot?: string | null; requestToolPermission?: ToolPermissionResolver } = {}
): ToolContext {
  const proxyUrl = settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
  const workspaceRoot = options.workspaceRoot?.trim() || undefined
  return { settings, proxyUrl, workspaceRoot, requestToolPermission: options.requestToolPermission }
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

async function resolveToolPermission(
  toolName: string,
  descriptor: ToolPermissionDescriptor,
  args: unknown,
  ctx: ToolContext,
  callCtx?: ToolCallContext
): Promise<ToolPermissionDecision> {
  if (descriptor.kind === 'workspace_write') {
    switch (ctx.settings.tools.workspaceWritePermission) {
      case 'allow_for_conversation':
        return { decision: 'allow' }
      case 'read_only':
        return denyWorkspaceWrite(toolName, descriptor, args, ctx, callCtx, '当前工具权限为只读模式')
      case 'ask_each_time': {
        const request = await describeToolPermission(toolName, descriptor, args, ctx, callCtx)
        if (!ctx.requestToolPermission) {
          return {
            decision: 'deny',
            reason: `需要用户批准 ${request.operation}${request.targetPath ? `：${request.targetPath}` : ''}，但当前会话没有审批通道。`
          }
        }
        return ctx.requestToolPermission(request, callCtx)
      }
    }
  }
  return { decision: 'allow' }
}

async function denyWorkspaceWrite(
  toolName: string,
  descriptor: ToolPermissionDescriptor,
  args: unknown,
  ctx: ToolContext,
  callCtx: ToolCallContext | undefined,
  prefix: string
): Promise<ToolPermissionDecision> {
  try {
    const request = await describeToolPermission(toolName, descriptor, args, ctx, callCtx)
    return {
      decision: 'deny',
      reason: `${prefix}，已拒绝 ${request.operation}${request.targetPath ? `：${request.targetPath}` : ''}。`
    }
  } catch (error) {
    return {
      decision: 'deny',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

async function describeToolPermission(
  toolName: string,
  descriptor: ToolPermissionDescriptor,
  args: unknown,
  ctx: ToolContext,
  callCtx?: ToolCallContext
): Promise<ToolPermissionRequest> {
  try {
    const detail = await descriptor.describe(args, ctx, callCtx)
    return {
      id: callCtx?.toolCallId ?? `${toolName}:${Date.now()}`,
      kind: descriptor.kind,
      toolName,
      ...detail
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}
