import type { AgentChatMode } from '../../shared/teaching-types'
import { isMcpToolName } from '../../shared/mcp/tool-name'

export type TeachingCapabilityPolicyId =
  | 'temporary_chat'
  | 'teaching_readonly'
  | 'teaching_workspace'

export type TeachingCapabilityPolicy = Readonly<{
  id: TeachingCapabilityPolicyId
  /** The complete, explicit tool allow-list for static/built-in tools. */
  allowedToolNames: readonly string[]
  /** Named built-in tools intentionally unavailable to this policy. */
  deniedToolNames: readonly string[]
  workspaceToolsEnabled: boolean
  delegationEnabled: boolean
  lessonToolEnabled: boolean
  /**
   * Allow predicate for static tools + dynamic MCP (`mcp__…`).
   * MCP tools share temporary/teaching injection (ADR-0128 §5.4).
   */
  allowsTool: (toolName: string) => boolean
}>

export type TeachingCapabilityPolicyInput = {
  mode: AgentChatMode | undefined
  toolsEnabled: boolean
  /** A valid selected teaching workspace, independent of file-tool trust. */
  hasTeachingWorkspace: boolean
  /** Explicit grant for workspace file tools. Omitted values fail closed. */
  workspaceToolAccessGranted: boolean | undefined
  hasLessonGenerator: boolean
}

const EXTERNAL_TOOL_NAMES = ['web_search', 'web_fetch'] as const
const CONVERSATION_TOOL_NAMES = ['ask', 'read_skill_resource'] as const
const WORKSPACE_READ_TOOL_NAMES = [
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'glob_workspace',
  'memory_search'
] as const
const WORKSPACE_WRITE_TOOL_NAMES = [
  'write_workspace_file',
  'edit_workspace_file',
  'remember_teaching_memory',
  'forget_teaching_memory'
] as const
const DELEGATION_TOOL_NAMES = ['delegate_task', 'read_only_task', 'parallel_tasks'] as const
/** Teaching-product write tools — temporary chat excludes only this set (ADR-0128 §5.4). */
const LESSON_TOOL_NAMES = ['generate_lesson'] as const

const ALL_KNOWN_TOOL_NAMES = [
  ...EXTERNAL_TOOL_NAMES,
  ...CONVERSATION_TOOL_NAMES,
  ...WORKSPACE_READ_TOOL_NAMES,
  ...WORKSPACE_WRITE_TOOL_NAMES,
  ...DELEGATION_TOOL_NAMES,
  ...LESSON_TOOL_NAMES
] as const

/**
 * Resolves the fixed capability boundary for one teaching conversation turn.
 *
 * Built-in tools use an explicit allow-list. Dynamic MCP tools (`mcp__…`) are
 * allowed whenever tools are enabled (same for temporary and teaching);
 * temporary chat differs only by excluding teaching-product write tools such as
 * `generate_lesson` (ADR-0128 §5.4).
 */
export function resolveTeachingCapabilityPolicy(
  input: TeachingCapabilityPolicyInput
): TeachingCapabilityPolicy {
  const isTeachingConversation = (input.mode ?? 'teaching') === 'teaching'
  const id: TeachingCapabilityPolicyId = !isTeachingConversation
    ? 'temporary_chat'
    : input.hasTeachingWorkspace
      ? 'teaching_workspace'
      : 'teaching_readonly'

  if (!input.toolsEnabled) return createPolicy(id, [])

  const workspaceGranted = input.workspaceToolAccessGranted === true

  // Temporary and teaching share agent tool surface except lesson/product writers.
  const allowedToolNames = [
    ...EXTERNAL_TOOL_NAMES,
    ...CONVERSATION_TOOL_NAMES,
    ...DELEGATION_TOOL_NAMES,
    ...(workspaceGranted
      ? [...WORKSPACE_READ_TOOL_NAMES, ...WORKSPACE_WRITE_TOOL_NAMES]
      : []),
    ...(isTeachingConversation && input.hasTeachingWorkspace && input.hasLessonGenerator
      ? LESSON_TOOL_NAMES
      : [])
  ]

  return createPolicy(id, allowedToolNames)
}

function createPolicy(
  id: TeachingCapabilityPolicyId,
  allowedToolNames: readonly string[]
): TeachingCapabilityPolicy {
  const allowed = new Set(allowedToolNames)
  return {
    id,
    allowedToolNames: [...allowed],
    deniedToolNames: ALL_KNOWN_TOOL_NAMES.filter((toolName) => !allowed.has(toolName)),
    workspaceToolsEnabled: allowed.has('read_workspace_file'),
    delegationEnabled: allowed.has('delegate_task'),
    lessonToolEnabled: allowed.has('generate_lesson'),
    allowsTool: (toolName) => {
      if (allowed.has(toolName)) return true
      // Dynamic MCP tools: allowed whenever any tools are enabled for this policy.
      if (allowed.size > 0 && isMcpToolName(toolName)) return true
      return false
    }
  }
}
