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
  const application = await electron.launch({
    executablePath: electronExecutablePath,
    args: [`--user-data-dir=${runtime.paths.userData}`, electronEntryPath],
    cwd: repositoryRoot,
    env: runtime.env,
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
      await application.close().catch(() => undefined)
    }
  }
}
/** Forcefully terminate the Electron main process tree (simulates crash; no graceful close). */
export async function forceKillElectronRuntime(runtime: LaunchedElectronRuntime): Promise<void> {
  const app = runtime.application as unknown as { process?: () => { pid?: number } }
  const pid = app.process?.().pid
  if (!pid) throw new Error('Electron process PID unavailable for force kill')
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolve, reject) => {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], (error) => {
        if (error && !/not found|no running instance/i.test(error.message)) reject(error)
        else resolve()
      })
    } else {
      try { process.kill(pid, 'SIGKILL') } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ESRCH') return reject(error)
      }
      resolve()
    }
  })
}
