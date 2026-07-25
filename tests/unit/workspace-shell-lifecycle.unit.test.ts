import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildDefaultRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import {
  RUN_WORKSPACE_COMMAND_TOOL_NAME,
  WORKSPACE_SHELL_MAX_OUTPUT_BYTES
} from '../../src/main/ai/tools/workspace-shell'
import { defaultSettings } from '../../src/main/teaching-settings'

const cleanupPaths: string[] = []

afterEach(async () => {
  // Child kill can lag briefly on Windows; retry rm and ignore residual locks.
  const paths = cleanupPaths.splice(0)
  for (const path of paths) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(path, { recursive: true, force: true })
        break
      } catch {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)))
      }
    }
  }
})

async function createShellHandler(options?: { signal?: AbortSignal }) {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-lifecycle-'))
  cleanupPaths.push(root)
  const settings = defaultSettings(root)
  settings.tools.workspaceRead = true
  settings.tools.workspaceShell = true
  settings.tools.approvalMode = 'full_access'
  settings.tools.sandboxMode = 'workspace_write'
  const handler = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
    .handlerMap(
      buildToolContext(settings, {
        workspaceRoot: root,
        signal: options?.signal
      })
    )
    .run_workspace_command
  if (!handler) throw new Error('run_workspace_command not registered')
  return { root, handler }
}

describe('run_workspace_command lifecycle (Stage D / F9 / E5)', () => {
  it('pre-aborted signal returns aborted:true without throwing', async () => {
    const controller = new AbortController()
    controller.abort()
    const { handler } = await createShellHandler({ signal: controller.signal })

    const raw = await handler({
      argv: process.platform === 'win32' ? ['cmd.exe', '/c', 'echo', 'should-not-run'] : ['echo', 'should-not-run'],
      cwd: '.',
      timeoutMs: 5_000
    })

    const result = JSON.parse(raw) as Record<string, unknown>
    expect(result.tool).toBe(RUN_WORKSPACE_COMMAND_TOOL_NAME)
    expect(result.error).toBeUndefined()
    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.ok).toBe(false)
  })

  it('short timeout marks timedOut:true and does not hang', async () => {
    const { handler } = await createShellHandler()
    // resolveShellArgv clamps timeoutMs to [1000, 120000]
    const hangArgv = ['node', '-e', 'setTimeout(() => {}, 30_000)']

    const started = Date.now()
    const raw = await handler({
      argv: hangArgv,
      cwd: '.',
      timeoutMs: 1_000
    })
    const elapsed = Date.now() - started
    const result = JSON.parse(raw) as Record<string, unknown>

    expect(result.tool).toBe(RUN_WORKSPACE_COMMAND_TOOL_NAME)
    expect(result.timedOut).toBe(true)
    expect(result.aborted).toBe(false)
    expect(result.ok).toBe(false)
    // Should settle near timeout, not the full 30s sleep.
    expect(elapsed).toBeLessThan(8_000)
  }, 15_000)

  it('large stdout is truncated with marker under byte cap', async () => {
    const { handler } = await createShellHandler()
    // ~80 KiB of ascii 'x' exceeds WORKSPACE_SHELL_MAX_OUTPUT_BYTES (48 KiB).
    const size = WORKSPACE_SHELL_MAX_OUTPUT_BYTES + 32 * 1024
    const raw = await handler({
      argv: ['node', '-e', `process.stdout.write('x'.repeat(${size}))`],
      cwd: '.',
      timeoutMs: 10_000
    })
    const result = JSON.parse(raw) as Record<string, unknown>
    expect(result.tool).toBe(RUN_WORKSPACE_COMMAND_TOOL_NAME)
    expect(result.stdoutTruncated).toBe(true)
    expect(String(result.stdout ?? '')).toContain('…[truncated]')
    const stdoutBytes = Buffer.byteLength(String(result.stdout ?? ''), 'utf8')
    // Truncated payload is maxBytes + marker; keep a loose upper bound.
    expect(stdoutBytes).toBeLessThanOrEqual(WORKSPACE_SHELL_MAX_OUTPUT_BYTES + 64)
  }, 15_000)

  it('mid-run abort returns aborted:true without throw', async () => {
    const controller = new AbortController()
    const { handler } = await createShellHandler({ signal: controller.signal })
    const hangArgv = ['node', '-e', 'setTimeout(() => {}, 30_000)']

    const pending = handler({
      argv: hangArgv,
      cwd: '.',
      timeoutMs: 10_000
    })
    // Give the child a moment to spawn, then cancel.
    await new Promise((r) => setTimeout(r, 200))
    controller.abort()

    const raw = await pending
    const result = JSON.parse(raw) as Record<string, unknown>
    expect(result.tool).toBe(RUN_WORKSPACE_COMMAND_TOOL_NAME)
    expect(result.aborted).toBe(true)
    expect(result.ok).toBe(false)
  }, 15_000)
})
