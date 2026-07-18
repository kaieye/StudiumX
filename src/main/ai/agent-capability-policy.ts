import type { AgentChatMode } from '../../shared/teaching-types'

export type TeachingCapabilityPolicyId =
  | 'temporary_chat'
  | 'teaching_readonly'
  | 'teaching_workspace'

export type TeachingCapabilityPolicy = Readonly<{
  id: TeachingCapabilityPolicyId
  /** The complete, explicit tool allow-list for this turn. Unknown tools are denied by projection. */
  allowedToolNames: readonly string[]
  /** Named built-in tools intentionally unavailable to this policy. */
  deniedToolNames: readonly string[]
  workspaceToolsEnabled: boolean
  delegationEnabled: boolean
  lessonToolEnabled: boolean
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
  'glob_workspace'
] as const
const WORKSPACE_WRITE_TOOL_NAMES = ['write_workspace_file'] as const
const DELEGATION_TOOL_NAMES = ['delegate_task', 'read_only_task', 'parallel_tasks'] as const
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
 * The policy is deliberately an explicit allow-list. Runtime registration may
 * add a new tool later, but it is unavailable until this module deliberately
 * assigns it to a policy. This keeps temporary chats fail-closed for workspace,
 * lesson, delegation, and future tool capabilities. A valid teaching workspace
 * and its file-tool grant stay distinct so trust can fail closed without
 * removing workspace-scoped teaching capabilities such as lesson generation.
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

  const allowedToolNames = [
    ...EXTERNAL_TOOL_NAMES,
    ...CONVERSATION_TOOL_NAMES,
    ...(isTeachingConversation ? DELEGATION_TOOL_NAMES : []),
    ...(isTeachingConversation && input.workspaceToolAccessGranted === true
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
    allowsTool: (toolName) => allowed.has(toolName)
  }
}
