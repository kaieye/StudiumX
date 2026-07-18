import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { defaultSettings } from '../../src/main/teaching-settings'
import {
  buildDefaultRegistry,
  buildToolContext,
  type ToolPermissionRequest
} from '../../src/main/ai/tools/registry'
import {
  registerToolPermissionPending,
  resolveToolPermissionPending
} from '../../src/main/ai/tool-permission-pending'
import type { TeachingSettingsV1, AgentApprovalMode } from '../../src/shared/teaching-types'

function settingsFor(root: string, mode: AgentApprovalMode): TeachingSettingsV1 {
  const settings = defaultSettings(root)
  settings.tools.enabled = true
  settings.tools.workspaceRead = true
  settings.tools.approvalMode = mode
  return settings
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile()).catch(() => false)
}

const root = await mkdtemp(join(tmpdir(), 'studiumx-tool-permissions-'))

try {
  const allowSettings = settingsFor(root, 'full_access')
  const allowHandlers = buildDefaultRegistry(allowSettings, {
    workspaceRoot: root,
    workspaceWrite: true
  }).handlerMap(buildToolContext(allowSettings, { workspaceRoot: root }))
  const allowResult = JSON.parse(await allowHandlers.write_workspace_file({
    path: 'notes/allowed.md',
    content: '# Allowed\n'
  }))
  assert.equal(allowResult.created, true)
  assert.equal(await readFile(join(root, 'notes/allowed.md'), 'utf8'), '# Allowed\n')

  const requestSettings = settingsFor(root, 'request_approval')
  const requestWithoutResolverHandlers = buildDefaultRegistry(requestSettings, {
    workspaceRoot: root,
    workspaceWrite: true
  }).handlerMap(buildToolContext(requestSettings, { workspaceRoot: root }))
  const requestWithoutResolverResult = JSON.parse(await requestWithoutResolverHandlers.write_workspace_file({
    path: 'notes/request-without-resolver.md',
    content: '# Blocked\n'
  }))
  assert.match(requestWithoutResolverResult.error, /没有审批通道/)
  assert.equal(requestWithoutResolverResult.permission.kind, 'workspace_write')
  assert.equal(await exists(join(root, 'notes/request-without-resolver.md')), false)

  const riskBasedSettings = settingsFor(root, 'based_on_approval')
  const riskBasedHandlers = buildDefaultRegistry(riskBasedSettings, {
    workspaceRoot: root,
    workspaceWrite: true
  }).handlerMap(buildToolContext(riskBasedSettings, { workspaceRoot: root }))
  const riskBasedResult = JSON.parse(await riskBasedHandlers.write_workspace_file({
    path: 'notes/risk-based-new.md',
    content: '# Created without approval\n'
  }))
  assert.equal(riskBasedResult.created, true)
  assert.equal(await readFile(join(root, 'notes/risk-based-new.md'), 'utf8'), '# Created without approval\n')

  const askSettings = settingsFor(root, 'request_approval')
  const askWithoutResolverHandlers = buildDefaultRegistry(askSettings, {
    workspaceRoot: root,
    workspaceWrite: true
  }).handlerMap(buildToolContext(askSettings, { workspaceRoot: root }))
  const askWithoutResolverResult = JSON.parse(await askWithoutResolverHandlers.write_workspace_file({
    path: 'notes/no-resolver.md',
    content: '# Blocked\n'
  }))
  assert.match(askWithoutResolverResult.error, /没有审批通道/)
  assert.equal(await exists(join(root, 'notes/no-resolver.md')), false)

  const approvalRequests: ToolPermissionRequest[] = []
  const askWithResolverHandlers = buildDefaultRegistry(askSettings, {
    workspaceRoot: root,
    workspaceWrite: true
  }).handlerMap(buildToolContext(askSettings, {
    workspaceRoot: root,
    requestToolPermission: async (request) => {
      approvalRequests.push(request)
      return { decision: 'allow' }
    }
  }))
  const approvedResult = JSON.parse(await askWithResolverHandlers.write_workspace_file({
    path: 'notes/approved.md',
    content: '# Approved\n'
  }, {
    toolCallId: 'call-approved',
    toolName: 'write_workspace_file'
  }))
  assert.equal(approvedResult.created, true)
  assert.equal(await readFile(join(root, 'notes/approved.md'), 'utf8'), '# Approved\n')
  assert.deepEqual(approvalRequests.map((request) => ({
    id: request.id,
    kind: request.kind,
    toolName: request.toolName,
    operation: request.operation,
    targetPath: request.targetPath,
    creates: request.creates
  })), [
    {
      id: 'call-approved',
      kind: 'workspace_write',
      toolName: 'write_workspace_file',
      operation: '创建工作区文件',
      targetPath: 'notes/approved.md',
      creates: true
    }
  ])

  const pendingDecision = registerToolPermissionPending('stream-1', 'permission-1')
  assert.equal(
    resolveToolPermissionPending('stream-1', 'permission-1', [
      { questionId: 'permission', selected: ['allow'] }
    ]),
    true
  )
  assert.deepEqual(await pendingDecision, {
    decision: 'allow_once',
    reason: undefined,
    scopePath: undefined
  })
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('tool permission policies ok')
