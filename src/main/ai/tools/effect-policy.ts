/**
 * Effect classification and pre-execution authorization for tool calls.
 *
 * Authorization here is orthogonal to the interactive workspace_write permission
 * gate in registry.ts. This policy answers: may this effect class run at all
 * for the current turn before any handler side effect starts.
 */

import type { ToolEffectClass } from './tool-outcome'

export type EffectAuthorizationInput = Readonly<{
  toolName: string
  effectClass: ToolEffectClass
  /** Optional allow-list of effect classes for this turn. Omitted means all classes. */
  allowedEffects?: readonly ToolEffectClass[]
  /** Optional tool-name allow predicate (e.g. capability policy). Omitted means all tools. */
  allowsTool?: (toolName: string) => boolean
}>

export type EffectAuthorizationDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: string; code: string }>

const WORKSPACE_READ_TOOLS = new Set([
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'glob_workspace',
  'read_skill_resource',
  'read_only_task',
  'memory_search'
])

const WORKSPACE_WRITE_TOOLS = new Set([
  'write_workspace_file',
  'remember_teaching_memory',
  'forget_teaching_memory'
])

const EXTERNAL_WRITE_TOOLS = new Set(['web_search', 'web_fetch'])

const PRIVILEGED_TOOLS = new Set([
  'ask',
  'generate_lesson',
  'delegate_task',
  'parallel_tasks'
])

/**
 * Optional runtime MCP effect lookup (ADR-0128 §6.1).
 * Installed by main/mcp/tool-bridge; never workspace-authoritative.
 */
let mcpEffectLookup: ((toolName: string) => ToolEffectClass | undefined) | null = null

/** Register (or clear) the MCP runtime effect lookup used by classifyToolEffect. */
export function setMcpEffectLookup(
  lookup: ((toolName: string) => ToolEffectClass | undefined) | null
): void {
  mcpEffectLookup = lookup
}

/**
 * Classify the side-effect class of a registered teaching tool.
 * Unknown tools fail closed as privileged so new capabilities need an explicit mapping.
 *
 * MCP tools (`mcp__…`) consult optional runtime map first (ADR-0128 §6.1).
 */
export function classifyToolEffect(
  toolName: string,
  runtimeMcpEffectMap?: ReadonlyMap<string, ToolEffectClass> | null
): ToolEffectClass {
  const name = toolName.trim()
  if (!name) return 'privileged'

  if (name.startsWith('mcp__')) {
    const fromArg = runtimeMcpEffectMap?.get(name)
    if (fromArg) return fromArg
    const fromLookup = mcpEffectLookup?.(name)
    if (fromLookup) return fromLookup
    return 'privileged'
  }

  if (WORKSPACE_WRITE_TOOLS.has(name)) return 'workspace_write'
  if (EXTERNAL_WRITE_TOOLS.has(name)) return 'external_write'
  if (WORKSPACE_READ_TOOLS.has(name)) return 'read'
  if (PRIVILEGED_TOOLS.has(name)) return 'privileged'
  return 'privileged'
}

/**
 * Authorize an effect class before the handler runs.
 * Deny reasons are safe diagnostic strings only (no secrets / raw args).
 */
export function authorizeToolEffect(input: EffectAuthorizationInput): EffectAuthorizationDecision {
  const toolName = input.toolName.trim()
  if (!toolName) {
    return {
      allowed: false,
      code: 'missing_tool_name',
      reason: '工具名称缺失，拒绝执行。'
    }
  }

  if (input.allowsTool && !input.allowsTool(toolName)) {
    return {
      allowed: false,
      code: 'tool_not_allowed',
      reason: `当前能力策略不允许调用工具 ${toolName}。`
    }
  }

  if (input.allowedEffects && !input.allowedEffects.includes(input.effectClass)) {
    return {
      allowed: false,
      code: 'effect_not_allowed',
      reason: `当前回合不允许 ${input.effectClass} 类副作用（工具 ${toolName}）。`
    }
  }

  return { allowed: true }
}
