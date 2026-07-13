import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ToolRegistry, ToolRunPermissionGrants, buildToolContext } from '../../src/main/ai/tools/registry'
import { AgentRunStore, DEFAULT_AGENT_RUN_BUDGET } from '../../src/main/ai/agent-run-store'
import { defaultSettings } from '../../src/main/teaching-settings'

const root = await mkdtemp(join(tmpdir(), 'studiumx-scoped-permissions-'))
const outside = await mkdtemp(join(tmpdir(), 'studiumx-scoped-permissions-outside-'))

try {
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'docs'), { recursive: true })
  const symlinkAvailable = await tryCreateSymlink(outside, join(root, 'linked'))
  const settings = defaultSettings(root)
  settings.tools.workspaceWritePermission = 'ask_each_time'

  let executions = 0
  const registry = new ToolRegistry()
  registry.register({
    definition: {
      type: 'function',
      function: {
        name: 'scoped_write',
        description: 'test scoped writes',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      }
    },
    permission: {
      kind: 'workspace_write',
      describe: (args) => ({
        operation: '写入测试文档',
        targetPath: String((args as { path?: unknown }).path ?? ''),
        creates: true
      })
    },
    handler: async () => {
      executions += 1
      return JSON.stringify({ ok: true })
    }
  })

  const directoryGrants = new ToolRunPermissionGrants()
  let directoryRequests = 0
  const directoryHandlers = registry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    permissionGrants: directoryGrants,
    requestToolPermission: async () => {
      directoryRequests += 1
      return directoryRequests === 1
        ? { decision: 'allow_for_directory', scopePath: 'notes' }
        : { decision: 'deny', reason: 'outside approved directory' }
    }
  }))
  assert.equal(JSON.parse(await directoryHandlers.scoped_write({ path: 'notes/a.md' })).ok, true)
  assert.equal(JSON.parse(await directoryHandlers.scoped_write({ path: 'notes/new/deep.md' })).ok, true)
  assert.equal(directoryRequests, 1, 'a canonical child of an approved directory should reuse the in-memory grant')
  assert.match(JSON.parse(await directoryHandlers.scoped_write({ path: 'docs/outside.md' })).error, /outside approved directory/)
  assert.equal(directoryRequests, 2)

  if (symlinkAvailable) {
    const beforeSymlink = executions
    const symlinkResult = JSON.parse(await directoryHandlers.scoped_write({ path: 'linked/escape.md' }))
    assert.match(symlinkResult.error, /符号链接后超出当前工作区/)
    assert.equal(executions, beforeSymlink)
    assert.equal(directoryRequests, 2, 'symlink escapes must be rejected before an approval request')
  }

  directoryGrants.clear()
  await directoryHandlers.scoped_write({ path: 'notes/after-clear.md' })
  assert.equal(directoryRequests, 3, 'terminal cleanup must remove run-scoped grants')

  let restartRequests = 0
  const restartedHandlers = registry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    requestToolPermission: async () => {
      restartRequests += 1
      return { decision: 'deny' }
    }
  }))
  await restartedHandlers.scoped_write({ path: 'notes/restart.md' })
  assert.equal(restartRequests, 1, 'grants must not survive a new context/process')

  let onceRequests = 0
  const onceHandlers = registry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    requestToolPermission: async () => {
      onceRequests += 1
      return { decision: 'allow_once' }
    }
  }))
  await onceHandlers.scoped_write({ path: 'notes/once-a.md' })
  await onceHandlers.scoped_write({ path: 'notes/once-b.md' })
  assert.equal(onceRequests, 2)

  let runRequests = 0
  const runHandlers = registry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    requestToolPermission: async () => {
      runRequests += 1
      return { decision: 'allow_for_run' }
    }
  }))
  await runHandlers.scoped_write({ path: 'notes/run-a.md' })
  await runHandlers.scoped_write({ path: 'docs/run-b.md' })
  assert.equal(runRequests, 1)

  const readOnlySettings = defaultSettings(root)
  readOnlySettings.tools.workspaceWritePermission = 'read_only'
  const store = new AgentRunStore(root)
  await store.create({ runId: 'read-only-run', streamId: 'read-only-run', budget: DEFAULT_AGENT_RUN_BUDGET })
  let readOnlyRequests = 0
  const readOnlyHandlers = registry.handlerMap(buildToolContext(readOnlySettings, {
    workspaceRoot: root,
    runId: 'read-only-run',
    operationJournal: store.operations,
    requestToolPermission: async () => {
      readOnlyRequests += 1
      return { decision: 'allow_once' }
    }
  }))
  const beforeReadOnly = executions
  assert.match(JSON.parse(await readOnlyHandlers.scoped_write({ path: 'notes/read-only.md' })).error, /只读模式/)
  assert.equal(readOnlyRequests, 0)
  assert.equal(executions, beforeReadOnly)

  console.log('scoped tool permission boundaries ok')
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}

async function tryCreateSymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path)
    return true
  } catch (error) {
    if (process.platform === 'win32' && (error as { code?: unknown }).code === 'EPERM') {
      console.log('skipping symlink permission assertion: Windows symlink privilege is unavailable')
      return false
    }
    throw error
  }
}
