import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { isPathInside, type TestRuntime } from '../test-runtime'
import { collectFailureArtifacts } from './failure-artifacts'

const require = createRequire(import.meta.url)
const electronExecutablePath = require('electron') as string
const repositoryRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const electronEntryPath = resolve(repositoryRoot, 'out/main/index.js')

export interface LaunchedElectronRuntime {
  application: ElectronApplication
  close(options: { failed: boolean }): Promise<void>
}

export async function launchElectronRuntime(
  runtime: TestRuntime,
  testInfo: TestInfo
): Promise<LaunchedElectronRuntime> {
  await access(electronEntryPath).catch(() => {
    throw new Error(
      `Electron build entry is missing at ${electronEntryPath}. Run "pnpm run build" before Playwright.`
    )
  })

  const consoleMessages: string[] = []
  const pageErrors: string[] = []
  const launchEnv: Record<string, string> = {
    ...runtime.env,
    // Prefer software rendering under headless/WSL agents when GPU is absent.
    // Does not change product assertions; only stabilizes Electron process bring-up.
    ELECTRON_DISABLE_GPU: runtime.env.ELECTRON_DISABLE_GPU ?? '1'
  }
  if (process.platform === 'linux') {
    const extra = [
      runtime.env.ELECTRON_EXTRA_LAUNCH_ARGS,
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer'
    ].filter((value): value is string => Boolean(value && value.trim()))
    if (extra.length > 0) launchEnv.ELECTRON_EXTRA_LAUNCH_ARGS = [...new Set(extra.join(' ').split(/\s+/).filter(Boolean))].join(' ')
  }

  const application = await electron.launch({
    executablePath: electronExecutablePath,
    args: [
      `--user-data-dir=${runtime.paths.userData}`,
      ...(process.platform === 'linux'
        ? ['--disable-gpu', '--disable-dev-shm-usage', '--no-zygote']
        : []),
      electronEntryPath
    ],
    cwd: repositoryRoot,
    env: launchEnv,
    timeout: 30_000,
    tracesDir: testInfo.outputPath('electron-traces')
  })

  application.on('console', (message) => {
    consoleMessages.push(`[main:${message.type()}] ${message.text()}`)
  })

  const context = application.context()
  let tracingStarted = false
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    tracingStarted = true

    const actualUserDataPath = await application.evaluate(({ app }) => app.getPath('userData'))
    if (!isPathInside(runtime.paths.root, runtime.paths.userData) || !isPathInside(runtime.paths.root, actualUserDataPath)) {
      throw new Error(
        `Electron escaped the isolated runtime. Expected userData under ${runtime.paths.root}, received ${actualUserDataPath}.`
      )
    }

    const observedPages = new WeakSet<Page>()
    const observePage = (page: Page) => {
      if (observedPages.has(page)) return
      observedPages.add(page)
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('console', (message) => consoleMessages.push(`[renderer:${message.type()}] ${message.text()}`))
    }
    for (const page of application.windows()) observePage(page)
    context.on('page', observePage)
  } catch (error) {
    await application.close().catch(() => undefined)
    throw error
  }

  return {
    application,
    close: async ({ failed }) => {
      if (failed) {
        await collectFailureArtifacts({
          windows: application.windows(),
          runtime,
          sink: {
            outputPath: (fileName) => testInfo.outputPath(fileName),
            attach: (attachment) => testInfo.attach(attachment.name, {
              path: attachment.path,
              contentType: attachment.contentType
            })
          },
          consoleMessages,
          pageErrors
        })
      }

      if (tracingStarted) {
        if (failed) {
          const tracePath = testInfo.outputPath('trace.zip')
          await context.tracing.stop({ path: tracePath }).catch(() => undefined)
          await testInfo
            .attach('trace', { path: tracePath, contentType: 'application/zip' })
            .catch(() => undefined)
        } else {
          await context.tracing.stop().catch(() => undefined)
        }
      }
      const child = application.process()
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([application.close().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 5_000))])
        if (child.exitCode === null && child.signalCode === null && child.pid) {
          await killProcessTree(child.pid)
        }
      }
    }
  }
}
/**
 * Kill an Electron main PID and its descendant processes.
 * Windows uses taskkill /T; POSIX prefers process-group SIGKILL, then a
 * recursive /proc walk so crash-recovery relaunch does not inherit orphans.
 */
async function killProcessTree(pid: number): Promise<void> {
  const { execFile } = await import('node:child_process')
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], (error) => {
        if (error && !/not found|no running instance/i.test(error.message)) reject(error)
        else resolve()
      })
    })
    return
  }

  const signalTree = (signal: NodeJS.Signals) => {
    try {
      // Negative PID targets the process group when the child is group leader.
      process.kill(-pid, signal)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ESRCH' && code !== 'EPERM') throw error
    }
    try {
      process.kill(pid, signal)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ESRCH') throw error
    }
  }

  signalTree('SIGKILL')

  // Best-effort descendant sweep via /proc (Linux) or pgrep (other POSIX).
  try {
    if (process.platform === 'linux') {
      const children = await collectLinuxDescendantPids(pid)
      for (const childPid of children) {
        try {
          process.kill(childPid, 'SIGKILL')
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'ESRCH') throw error
        }
      }
    } else {
      await new Promise<void>((resolve) => {
        execFile('pkill', ['-KILL', '-P', String(pid)], () => resolve())
      })
    }
  } catch {
    // Tree cleanup is best-effort; the main PID kill above remains authoritative.
  }
}

async function collectLinuxDescendantPids(rootPid: number): Promise<number[]> {
  const { readdir, readFile } = await import('node:fs/promises')
  const childrenByParent = new Map<number, number[]>()
  try {
    const entries = await readdir('/proc')
    await Promise.all(entries.map(async (entry) => {
      if (!/^[0-9]+$/.test(entry)) return
      const childPid = Number(entry)
      try {
        const status = await readFile(`/proc/${childPid}/stat`, 'utf8')
        // comm may contain spaces/parens; parent is the field after the final ') '.
        const afterComm = status.slice(status.lastIndexOf(') ') + 2).split(' ')
        // fields: state ppid ...
        const ppid = Number(afterComm[1])
        if (!Number.isFinite(ppid)) return
        const list = childrenByParent.get(ppid)
        if (list) list.push(childPid)
        else childrenByParent.set(ppid, [childPid])
      } catch {
        // process exited while enumerating
      }
    }))
  } catch {
    return []
  }

  const out: number[] = []
  const queue = [rootPid]
  const seen = new Set<number>([rootPid])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const child of childrenByParent.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/** Forcefully terminate the Electron main process tree (simulates crash; no graceful close). */
export async function forceKillElectronRuntime(runtime: LaunchedElectronRuntime): Promise<void> {
  const app = runtime.application as unknown as { process?: () => { pid?: number } }
  const pid = app.process?.().pid
  if (!pid) throw new Error('Electron process PID unavailable for force kill')
  const child = runtime.application.process()
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null || child.killed) return resolve()
    child.once('exit', () => resolve())
  })
  await killProcessTree(pid)
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 10_000))])
  // Brief settle so port/userData locks and GPU helpers release before relaunch.
  await new Promise<void>((resolve) => setTimeout(resolve, 250))
}
