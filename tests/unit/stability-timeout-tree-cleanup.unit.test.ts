import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runCommand } from '../../scripts/lib/stability-check-runner.mjs'

const temporaryRoots: string[] = []

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Condition did not become true within ${timeoutMs}ms.`)
}

async function cleanupPid(pidPath: string): Promise<void> {
  const pid = Number((await readFile(pidPath, 'utf8').catch(() => '')).trim())
  if (!Number.isInteger(pid) || pid <= 0) return

  if (process.platform === 'win32') {
    await runCommand({ command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'], cwd: process.cwd(), timeoutMs: 5_000 })
    return
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The timeout runner already cleaned up the fixture process.
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('stability timeout process cleanup', () => {
  it('terminates the timed-out process tree before returning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-stability-timeout-'))
    temporaryRoots.push(root)
    const workerPidPath = join(root, 'worker.pid')
    const orphanMarkerPath = join(root, 'orphaned.txt')
    const fixture = resolve(process.cwd(), 'tests/fixtures/stability-timeout-tree-parent.mjs')

    try {
      const result = await runCommand({
        command: process.execPath,
        args: [fixture, workerPidPath, orphanMarkerPath],
        cwd: root,
        timeoutMs: 1_000
      })

      expect(result.kind).toBe('timeout')
      expect(result.termination).toMatchObject({ attempted: true, succeeded: true })
      await waitFor(() => existsSync(workerPidPath), 500)
      // The orphan timer (3.5s) must lose to tree termination, including the
      // Windows dead-parent orphan sweep (bounded CIM snapshot ≤3s).
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      expect(existsSync(orphanMarkerPath)).toBe(false)
    } finally {
      await cleanupPid(workerPidPath)
    }
  })
})
