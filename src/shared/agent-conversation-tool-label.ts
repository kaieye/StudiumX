/**
 * Learner-facing label only. It never changes a tool's runtime name, effect,
 * approval requirement, or registration.
 */
export type AgentConversationToolDisplayName =
  | 'Bash'
  | 'READ'
  | 'Search'
  | 'Write'
  | 'Edit'
  | 'Tool call'

export function agentConversationToolDisplayName(toolName: string | undefined): AgentConversationToolDisplayName {
  const normalized = (toolName ?? '').toLowerCase()
  if (normalized === 'run_workspace_command' || normalized === 'workspace_shell' || normalized === 'workspaceshell' || normalized === 'bash' || normalized === 'shell') return 'Bash'
  if (normalized === 'file_read' || normalized === 'fileread' || normalized === 'read' || normalized === 'read_file' || normalized === 'read_workspace_file' || normalized === 'read_skill_resource') return 'READ'
  if (
    normalized === 'grep' ||
    normalized === 'glob' ||
    normalized === 'glob_workspace' ||
    normalized === 'list_workspace' ||
    normalized === 'web_search' ||
    normalized === 'websearch' ||
    normalized === 'web_fetch' ||
    normalized === 'webfetch' ||
    normalized === 'memory_search' ||
    normalized === 'memorysearch' ||
    normalized === 'search'
  ) return 'Search'
  if (
    normalized === 'write_workspace_file' ||
    normalized === 'file_write' ||
    normalized === 'write' ||
    normalized === 'generate_lesson'
  ) return 'Write'
  if (normalized === 'edit_workspace_file' || normalized === 'edit_file' || normalized === 'edit' || normalized === 'apply_patch') return 'Edit'
  return 'Tool call'
}
