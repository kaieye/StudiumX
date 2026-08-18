import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildDefaultRegistry, buildToolContext, type ToolPermissionResolver } from '../../src/main/ai/tools/registry'
import { classifyToolEffect } from '../../src/main/ai/tools/effect-policy'
import {
  isKnownSafeReadCommand,
  resolveShellArgv,
  tokenizeCommandLine
} from '../../src/main/ai/tools/shell-command-safety'
import { RUN_WORKSPACE_COMMAND_TOOL_NAME } from '../../src/main/ai/tools/workspace-shell'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { AgentApprovalMode } from '../../src/shared/teaching-types'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('shell-command-safety (strict known-safe contract)', () => {
  it('tokenizes simple commands and rejects metacharacters', () => {
    expect(tokenizeCommandLine('git status')).toEqual(['git', 'status'])
    expect(tokenizeCommandLine('echo "hello world"')).toEqual(['echo', 'hello world'])
    expect(tokenizeCommandLine('ls | cat')).toBeNull()
    expect(tokenizeCommandLine('echo hi > out.txt')).toBeNull()
  })

  it('marks known-safe read commands (narrow allow-list)', () => {
    expect(isKnownSafeReadCommand(['git', 'status'])).toBe(true)
    expect(isKnownSafeReadCommand(['ls', '-la'])).toBe(true)
    expect(isKnownSafeReadCommand(['dir'])).toBe(true)
    expect(isKnownSafeReadCommand(['pwd'])).toBe(true)
    expect(isKnownSafeReadCommand(['echo', 'hi'])).toBe(true)
    // Path-bearing readers default non-safe even with relative paths.
    expect(isKnownSafeReadCommand(['rg', 'foo', 'src'])).toBe(false)
    expect(isKnownSafeReadCommand(['find', '.', '-name', '*.ts'])).toBe(false)
  })

  it('rejects unsafe find/git and non-safelist commands', () => {
    expect(isKnownSafeReadCommand(['find', '.', '-delete'])).toBe(false)
    expect(isKnownSafeReadCommand(['git', 'push'])).toBe(false)
    expect(isKnownSafeReadCommand(['git', 'branch', '-D', 'foo'])).toBe(false)
    expect(isKnownSafeReadCommand(['git', 'config', 'user.name', 'x'])).toBe(false)
    expect(isKnownSafeReadCommand(['npm', 'install'])).toBe(false)
    expect(isKnownSafeReadCommand(['rm', '-rf', '.'])).toBe(false)
  })

  it('resolves argv from args object', () => {
    const ok = resolveShellArgv({ argv: ['git', 'status'], cwd: 'src', timeoutMs: 5_000 })
    expect(ok).toMatchObject({ argv: ['git', 'status'], cwdRelative: 'src', timeoutMs: 5_000 })
    // Piped command strings expand via Reasonix shell wrapper (bash -lc / pwsh -Command).
    const piped = resolveShellArgv({ command: 'echo hi | wc' })
    expect('error' in piped).toBe(false)
    if (!('error' in piped)) {
      expect(piped.argv.length).toBeGreaterThanOrEqual(3)
      // Expanded shell wrappers must never be known-safe.
      expect(isKnownSafeReadCommand(piped.argv)).toBe(false)
    }
  })
})

describe('run_workspace_command registration and approval (ADR-0015)', () => {
  it('classifies as privileged', () => {
    expect(classifyToolEffect(RUN_WORKSPACE_COMMAND_TOOL_NAME)).toBe('privileged')
  })

  it('is registered when workspaceShell defaults true (mainstream agent)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-default-'))
    cleanupPaths.push(root)
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    // schema default workspaceShell true; do not set false
    settings.tools.workspaceShell = true
    settings.tools.sandboxMode = 'workspace_write'
    const registry = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
    expect(registry.names()).toContain(RUN_WORKSPACE_COMMAND_TOOL_NAME)
    expect(registry.names()).toContain('shell')
  })

  it('is not registered when workspaceShell is false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-off-'))
    cleanupPaths.push(root)
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.workspaceShell = false
    const registry = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
    expect(registry.names()).not.toContain(RUN_WORKSPACE_COMMAND_TOOL_NAME)
    expect(registry.names()).not.toContain('shell')
  })

  it('registers when workspaceShell is true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-on-'))
    cleanupPaths.push(root)
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.workspaceShell = true
    const registry = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
    expect(registry.names()).toContain(RUN_WORKSPACE_COMMAND_TOOL_NAME)
  })

  it('read_only sandbox rejects npm install at execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-ro-'))
    cleanupPaths.push(root)
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.workspaceShell = true
    settings.tools.sandboxMode = 'read_only'
    settings.tools.approvalMode = 'full_access'
    const handler = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
      .handlerMap(buildToolContext(settings, { workspaceRoot: root }))
      .run_workspace_command
    if (!handler) throw new Error('missing tool')
    const raw = await handler({ argv: ['npm', 'install'] })
    const result = JSON.parse(raw) as Record<string, unknown>
    expect(result.error).toBe(true)
    expect(String(result.message ?? '')).toMatch(/read_only/i)
  })

  async function invokeShell(options: {
    mode: AgentApprovalMode
    argv: string[]
    requestToolPermission?: ToolPermissionResolver
  }): Promise<{ result: Record<string, unknown>; requested: boolean }> {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-run-'))
    cleanupPaths.push(root)
    await writeFile(join(root, 'README.md'), '# t\n', 'utf8')
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.workspaceShell = true
    settings.tools.approvalMode = options.mode
    const requestToolPermission =
      options.requestToolPermission ??
      vi.fn<ToolPermissionResolver>().mockResolvedValue({ decision: 'allow_once' })
    const handler = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
      .handlerMap(
        buildToolContext(settings, {
          workspaceRoot: root,
          requestToolPermission
        })
      )
      .run_workspace_command
    if (!handler) throw new Error('run_workspace_command not registered')
    const raw = await handler({ argv: options.argv, cwd: '.' })
    return {
      result: JSON.parse(raw) as Record<string, unknown>,
      requested: vi.isMockFunction(requestToolPermission)
        ? requestToolPermission.mock.calls.length > 0
        : false
    }
  }

  it('request_approval always prompts (Codex untrusted)', async () => {
    const requestToolPermission = vi
      .fn<ToolPermissionResolver>()
      .mockResolvedValue({ decision: 'allow_once' })
    const { result, requested } = await invokeShell({
      mode: 'request_approval',
      argv: process.platform === 'win32' ? ['cmd.exe', '/c', 'echo', 'hi'] : ['echo', 'hi'],
      requestToolPermission
    })
    expect(requested).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.tool).toBe(RUN_WORKSPACE_COMMAND_TOOL_NAME)
  })

  it('based_on_approval auto-allows known-safe commands (Codex on-request)', async () => {
    const requestToolPermission = vi
      .fn<ToolPermissionResolver>()
      .mockResolvedValue({ decision: 'allow_once' })
    const { result } = await invokeShell({
      mode: 'based_on_approval',
      // `echo` is safelist; on Windows spawn echo without shell may fail — use node -e for portability when testing auto path with git status which is safe but may not exist... use pwd/echo
      argv: process.platform === 'win32' ? ['cmd.exe', '/c', 'echo', 'ok'] : ['true'],
      requestToolPermission
    })
    // cmd.exe is not in safelist → should prompt on based_on_approval
    if (process.platform === 'win32') {
      expect(requestToolPermission).toHaveBeenCalled()
    } else {
      // `true` is safelist
      expect(requestToolPermission).not.toHaveBeenCalled()
      expect(result.ok).toBe(true)
    }
  })

  it('based_on_approval auto-allows git status without prompt when git exists', async () => {
    const requestToolPermission = vi
      .fn<ToolPermissionResolver>()
      .mockResolvedValue({ decision: 'allow_once' })
    const { result } = await invokeShell({
      mode: 'based_on_approval',
      argv: ['git', 'status', '--porcelain'],
      requestToolPermission
    })
    expect(requestToolPermission).not.toHaveBeenCalled()
    // git may be missing on some CI images — still must not error at permission layer
    expect(result.tool).toBe(RUN_WORKSPACE_COMMAND_TOOL_NAME)
    expect(result.knownSafeRead).toBe(true)
  })

  it('full_access does not prompt (Codex never)', async () => {
    const requestToolPermission = vi
      .fn<ToolPermissionResolver>()
      .mockResolvedValue({ decision: 'allow_once' })
    const { result } = await invokeShell({
      mode: 'full_access',
      argv: process.platform === 'win32' ? ['cmd.exe', '/c', 'echo', 'full'] : ['echo', 'full'],
      requestToolPermission
    })
    expect(requestToolPermission).not.toHaveBeenCalled()
    expect(result.tool).toBe(RUN_WORKSPACE_COMMAND_TOOL_NAME)
  })

  it('rejects absolute cwd escape', async () => {
    const requestToolPermission = vi
      .fn<ToolPermissionResolver>()
      .mockResolvedValue({ decision: 'allow_once' })
    const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-esc-'))
    cleanupPaths.push(root)
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.workspaceShell = true
    settings.tools.approvalMode = 'full_access'
    const handler = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
      .handlerMap(buildToolContext(settings, { workspaceRoot: root, requestToolPermission }))
      .run_workspace_command
    if (!handler) throw new Error('missing tool')
    const raw = await handler({
      argv: ['echo', 'x'],
      cwd: process.platform === 'win32' ? 'C:\\Windows' : '/tmp'
    })
    const result = JSON.parse(raw) as Record<string, unknown>
    expect(result.error === true || typeof result.error === 'string').toBe(true)
    if (typeof result.message === 'string') {
      expect(result.message.length).toBeGreaterThan(0)
    }
  })
})

describe('workspace-shell permission describe (Stage E)', () => {
  const cleanupPaths: string[] = []
  afterEach(async () => {
    for (const p of cleanupPaths.splice(0)) {
      try {
        await (await import('node:fs/promises')).rm(p, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  it('permission reason includes sandboxMode, knownSafe, and expected backend', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-desc-'))
    cleanupPaths.push(root)
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.workspaceShell = true
    settings.tools.sandboxMode = 'workspace_write'
    settings.tools.approvalMode = 'request_approval'
    const requestToolPermission = vi.fn<ToolPermissionResolver>().mockResolvedValue({ decision: 'allow_once' })
    const handler = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
      .handlerMap(
        buildToolContext(settings, {
          workspaceRoot: root,
          requestToolPermission
        })
      )
      .run_workspace_command
    if (!handler) throw new Error('missing tool')
    await handler({ argv: ['npm', 'test'], cwd: '.' })
    expect(requestToolPermission).toHaveBeenCalled()
    const req = requestToolPermission.mock.calls[0]?.[0] as { reason?: string }
    expect(String(req?.reason ?? '')).toMatch(/sandboxMode=workspace_write/)
    expect(String(req?.reason ?? '')).toMatch(/knownSafe=no/)
    expect(String(req?.reason ?? '')).toMatch(/expected backend=/)
    expect(String(req?.reason ?? '')).not.toMatch(/YOLO|DangerFullAccess|always-approve/i)
  })

})
