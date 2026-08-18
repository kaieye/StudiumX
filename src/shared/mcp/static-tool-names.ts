/**
 * Built-in tool names that MCP tools must not collide with (ADR-0013).
 * Keep in sync with agent-capability-policy / effect-policy inventories.
 */

export const STATIC_TEACHING_TOOL_NAMES: readonly string[] = [
  'web_search',
  'web_fetch',
  'ask',
  'read_skill_resource',
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'glob_workspace',
  'memory_search',
  'write_workspace_file',
  'edit_workspace_file',
  'remember_teaching_memory',
  'forget_teaching_memory',
  'delegate_task',
  'read_only_task',
  'parallel_tasks',
  'generate_lesson'
] as const

export function staticTeachingToolNameSet(): ReadonlySet<string> {
  return new Set(STATIC_TEACHING_TOOL_NAMES)
}