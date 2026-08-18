/**
 * MCP tool bridge + registry inject (ADR-0013).
 *
 * MCP handlers never import outcome committer / ledger writer.
 * MCP does not write workspace files directly (even when effect override is workspace_write).
 */

import type { ToolDefinition } from '../ai/provider-adapter'
import type {
  ToolEntry,
  ToolPermissionDescriptor,
  ToolRegistry
} from '../ai/tools/registry'
import { annotationsForEffectClass } from '../ai/tools/annotations'
import { McpApplicationToolError } from '../ai/tools/mcp-application-error'
import { setMcpEffectLookup } from '../ai/tools/effect-policy'
import { capabilitiesForEffectClass } from '../ai/tools/tool-capabilities'
import {
  permissionKindForMcpEffect
} from '../../shared/mcp/effect-map'
import {
  MCP_ERROR_CODES,
  mcpUserMessage,
  type McpEffectClass
} from '../../shared/mcp/types'
import type { McpSessionManager, McpSnapshotTool, McpToolsSnapshot } from './session-manager'

/**
 * Runtime effect map for classifyToolEffect extension (ADR-0013).
 * Populated from the run-scoped MCP snapshot; never persisted as workspace authority.
 */
let runtimeMcpEffectMap: ReadonlyMap<string, McpEffectClass> | null = null

export function setRuntimeMcpEffectMap(
  map: ReadonlyMap<string, McpEffectClass> | null
): void {
  runtimeMcpEffectMap = map
  setMcpEffectLookup(map ? (name) => map.get(name) : null)
}

export function getRuntimeMcpEffectMap(): ReadonlyMap<string, McpEffectClass> | null {
  return runtimeMcpEffectMap
}

export function lookupRuntimeMcpEffect(toolName: string): McpEffectClass | undefined {
  return runtimeMcpEffectMap?.get(toolName)
}

export function createMcpToolEntry(
  tool: McpSnapshotTool,
  sessionManager: McpSessionManager
): ToolEntry {
  const definition: ToolDefinition = {
    type: 'function',
    function: {
      name: tool.registeredName,
      description: tool.description || `MCP tool ${tool.rawToolName} from ${tool.serverId}`,
      parameters: tool.parameters
    }
  }

  const permission = buildMcpPermission(tool.effectClass, tool.registeredName)

  return {
    definition,
    permission,
    annotations: annotationsForEffectClass(tool.effectClass),
    capabilities: capabilitiesForEffectClass(tool.effectClass),
    handler: async (args, _ctx, callCtx) => {
      const record =
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {}
      const result = await sessionManager.callTool(
        tool.registeredName,
        record,
        callCtx?.signal ?? _ctx.signal
      )
      if (!result.ok) {
        // MCP protocol application errors are an explicit terminal failure, not
        // error-shaped successful tool content. The session manager has already
        // normalized and bounded this untrusted server-controlled message.
        if (result.errorCode === 'mcp_application_error') {
          throw new McpApplicationToolError(result.modelText || result.message)
        }
        return JSON.stringify(
          {
            ok: false,
            error: result.message,
            code: result.code,
            tool: tool.registeredName
          },
          null,
          2
        )
      }
      // Never execute workspace writes from MCP bridge — results are data only.
      return result.content
    }
  }
}

function buildMcpPermission(
  effect: McpEffectClass,
  toolName: string
): ToolPermissionDescriptor | undefined {
  if (effect === 'read') {
    // Align with built-in read: no interactive gate by default.
    return undefined
  }
  const kind = permissionKindForMcpEffect(effect)
  return {
    kind,
    describe: async () => ({
      operation: `mcp:${toolName}`,
      reason:
        effect === 'privileged'
          ? '需要批准的外部 MCP 工具（默认 privileged）。'
          : effect === 'external_write'
            ? 'MCP 工具可能产生外部/网络副作用。'
            : 'MCP 工具已标记为 workspace_write（仍不直写工作区；仅影响审批分类）。',
      // For workspace_write kind, registry expects optional path; omit creates so it goes interactive.
      targetPath: effect === 'workspace_write' || effect === 'privileged' ? undefined : undefined
    })
  }
}

/**
 * Attach MCP tools from a run snapshot into a registry.
 * Call after static tools; collisions with static names are skipped.
 */
export function attachMcpTools(
  registry: ToolRegistry,
  snapshot: McpToolsSnapshot,
  sessionManager: McpSessionManager
): { attached: number; skipped: string[] } {
  const existing = new Set(registry.names())
  const skipped: string[] = []
  let attached = 0

  for (const tool of snapshot.tools) {
    if (existing.has(tool.registeredName)) {
      skipped.push(tool.registeredName)
      continue
    }
    registry.register(createMcpToolEntry(tool, sessionManager))
    existing.add(tool.registeredName)
    attached += 1
  }

  setRuntimeMcpEffectMap(snapshot.effectByRegisteredName)
  return { attached, skipped }
}

/** Clear runtime MCP map (e.g. after run ends / disable). */
export function clearMcpRuntimeState(): void {
  setRuntimeMcpEffectMap(null)
}

/**
 * Stable failed payload when MCP is unavailable mid-run.
 */
export function mcpUnavailablePayload(toolName: string): string {
  return JSON.stringify(
    {
      ok: false,
      error: mcpUserMessage(MCP_ERROR_CODES.mcp_server_unavailable),
      code: MCP_ERROR_CODES.mcp_server_unavailable,
      tool: toolName
    },
    null,
    2
  )
}
