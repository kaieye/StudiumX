import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveTeachingCapabilityPolicy } from '../../src/main/ai/agent-capability-policy'
import { buildToolContext, buildDefaultRegistry, type ToolEntry, ToolRegistry } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'

function toolNames(policy: ReturnType<typeof resolveTeachingCapabilityPolicy>): string[] {
  const registry = new ToolRegistry()
  for (const name of [
    'web_search',
    'web_fetch',
    'ask',
    'read_skill_resource',
    'list_workspace',
    'read_workspace_file',
    'search_workspace',
    'glob_workspace',
    'write_workspace_file',
    'delegate_task',
    'read_only_task',
    'parallel_tasks',
    'generate_lesson',
    'future_tool'
  ]) {
    registry.register(stubTool(name))
  }
  return registry.project({
    allow: policy.allowedToolNames,
    deny: policy.deniedToolNames
  }).names()
}

function stubTool(name: string): ToolEntry {
  return {
    definition: {
      type: 'function',
      function: {
        name,
        description: name,
        parameters: { type: 'object', properties: {} }
      }
    },
    handler: async () => JSON.stringify({ name })
  }
}

const temporary = resolveTeachingCapabilityPolicy({
  mode: 'temporary',
  toolsEnabled: true,
  hasWorkspace: true,
  hasLessonGenerator: true
})
assert.equal(temporary.id, 'temporary_chat')
assert.deepEqual(toolNames(temporary), ['web_search', 'web_fetch', 'ask', 'read_skill_resource'])
assert.equal(temporary.allowsTool('future_tool'), false, 'unassigned future tools must remain fail-closed')

const teachingReadOnly = resolveTeachingCapabilityPolicy({
  mode: 'teaching',
  toolsEnabled: true,
  hasWorkspace: false,
  hasLessonGenerator: true
})
assert.equal(teachingReadOnly.id, 'teaching_readonly')
assert.deepEqual(toolNames(teachingReadOnly), [
  'web_search',
  'web_fetch',
  'ask',
  'read_skill_resource',
  'delegate_task',
  'read_only_task',
  'parallel_tasks'
])

const teachingWorkspace = resolveTeachingCapabilityPolicy({
  mode: 'teaching',
  toolsEnabled: true,
  hasWorkspace: true,
  hasLessonGenerator: true
})
assert.equal(teachingWorkspace.id, 'teaching_workspace')
assert.deepEqual(toolNames(teachingWorkspace), [
  'web_search',
  'web_fetch',
  'ask',
  'read_skill_resource',
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'glob_workspace',
  'write_workspace_file',
  'delegate_task',
  'read_only_task',
  'parallel_tasks',
  'generate_lesson'
])

const root = await mkdtemp(join(tmpdir(), 'studiumx-capability-policy-'))
try {
  const settings = defaultSettings(root)
  settings.tools.enabled = true
  settings.tools.workspaceRead = true
  settings.tools.workspaceWritePermission = 'read_only'
  const registry = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
    .project({
      allow: teachingWorkspace.allowedToolNames,
      deny: teachingWorkspace.deniedToolNames
    })
  const handler = registry.handlerMap(buildToolContext(settings, { workspaceRoot: root })).write_workspace_file
  assert.ok(handler, 'workspace policy must retain the established write tool')
  const result = JSON.parse(await handler!({ path: 'notes/blocked.md', content: '# blocked\n' }))
  assert.equal(result.permission.kind, 'workspace_write')
  assert.match(result.error, /只读模式/)
  await assert.rejects(() => stat(join(root, 'notes', 'blocked.md')))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('agent capability policy ok')
