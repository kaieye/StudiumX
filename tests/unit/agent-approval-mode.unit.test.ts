import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDefaultRegistry, buildToolContext, type ToolPermissionResolver } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'
import { getWorkspaceWriteToolAvailability } from '../../src/main/ai/tools/workspace'
import type { AgentApprovalMode } from '../../src/shared/teaching-types'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function writeWorkspaceFile(options: {
  mode: AgentApprovalMode
  path: string
  content: string
  requestToolPermission?: ToolPermissionResolver
}): Promise<{ result: Record<string, unknown>; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-approval-'))
  cleanupPaths.push(root)
  const settings = defaultSettings(root)
  settings.tools.workspaceRead = true
  settings.tools.approvalMode = options.mode
  const handler = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
    .handlerMap(buildToolContext(settings, {
      workspaceRoot: root,
      requestToolPermission: options.requestToolPermission
    }))
    .write_workspace_file
  if (!handler) throw new Error('write_workspace_file handler was not registered')

  return {
    result: JSON.parse(await handler({ path: options.path, content: options.content })) as Record<string, unknown>,
    root
  }
}

describe.runIf(getWorkspaceWriteToolAvailability().available)('Agent approval modes', () => {
  it('requires explicit approval before writing in request-approval mode', async () => {
    const requestToolPermission = vi.fn<ToolPermissionResolver>().mockResolvedValue({ decision: 'allow_once' })
    const { root, result } = await writeWorkspaceFile({
      mode: 'request_approval',
      path: 'notes/approved.md',
      content: '# approved\n',
      requestToolPermission
    })

    expect(requestToolPermission).toHaveBeenCalledOnce()
    expect(result.error).toBeUndefined()
    await expect(readFile(join(root, 'notes', 'approved.md'), 'utf8')).resolves.toBe('# approved\n')
  })

  it('allows only new files automatically in based-on-approval mode', async () => {
    const requestToolPermission = vi.fn<ToolPermissionResolver>().mockResolvedValue({ decision: 'allow_once' })
    const created = await writeWorkspaceFile({
      mode: 'based_on_approval',
      path: 'notes/new.md',
      content: '# new\n',
      requestToolPermission
    })

    expect(requestToolPermission).not.toHaveBeenCalled()
    await expect(readFile(join(created.root, 'notes', 'new.md'), 'utf8')).resolves.toBe('# new\n')

    await writeFile(join(created.root, 'notes', 'existing.md'), '# old\n', 'utf8')
    const settings = defaultSettings(created.root)
    settings.tools.workspaceRead = true
    settings.tools.approvalMode = 'based_on_approval'
    const overwriteApproval = vi.fn<ToolPermissionResolver>().mockResolvedValue({ decision: 'allow_once' })
    const overwrite = buildDefaultRegistry(settings, { workspaceRoot: created.root, workspaceWrite: true })
      .handlerMap(buildToolContext(settings, { workspaceRoot: created.root, requestToolPermission: overwriteApproval }))
      .write_workspace_file
    if (!overwrite) throw new Error('write_workspace_file handler was not registered')

    await overwrite({ path: 'notes/existing.md', content: '# replacement\n', overwrite: true })
    expect(overwriteApproval).toHaveBeenCalledOnce()
    await expect(readFile(join(created.root, 'notes', 'existing.md'), 'utf8')).resolves.toBe('# replacement\n')
  })

  it('writes without an approval callback in full-access mode', async () => {
    const { root, result } = await writeWorkspaceFile({
      mode: 'full_access',
      path: 'notes/unattended.md',
      content: '# unattended\n'
    })

    expect(result.error).toBeUndefined()
    await expect(readFile(join(root, 'notes', 'unattended.md'), 'utf8')).resolves.toBe('# unattended\n')
  })
})

describe.runIf(!getWorkspaceWriteToolAvailability().available)('Agent approval modes without durable workspace write capability', () => {
  it('does not expose a write that any approval mode could promise to execute', () => {
    const root = 'C:/studiumx-unavailable-workspace'
    const availability = getWorkspaceWriteToolAvailability()
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true

    expect(availability).toEqual({
      available: false,
      code: 'containment_unavailable',
      message: '当前平台无法安全发布工作区文件。'
    })

    for (const approvalMode of ['full_access', 'based_on_approval', 'request_approval'] as const) {
      settings.tools.approvalMode = approvalMode
      const registry = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
      expect(registry.names()).toContain('read_workspace_file')
      expect(registry.names()).not.toContain('write_workspace_file')
    }
  })
})
