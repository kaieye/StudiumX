import { createRequire } from 'node:module'
import { access, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  test as base,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@playwright/test'
import { _electron as electron } from 'playwright'
import {
  createIsolatedTestRuntime,
  isPathInside,
  type IsolatedTestRuntime
} from './runtime-isolation'

const require = createRequire(import.meta.url)
const electronExecutablePath = require('electron') as string
const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const electronEntryPath = resolve(repositoryRoot, 'out/main/index.js')

type ElectronFixtures = {
  runtime: IsolatedTestRuntime
  workspacePath: string
  electronApp: ElectronApplication
  mainWindow: Page
}

async function captureFailureArtifacts(
  electronApp: ElectronApplication,
  testInfo: TestInfo,
  consoleMessages: string[]
): Promise<void> {
  const windows = electronApp.windows()
  for (const [index, window] of windows.entries()) {
    const screenshotPath = testInfo.outputPath(`failure-window-${index + 1}.png`)
    await window.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
    await testInfo
      .attach(`failure-window-${index + 1}`, { path: screenshotPath, contentType: 'image/png' })
      .catch(() => undefined)
  }

  if (consoleMessages.length > 0) {
    const consolePath = testInfo.outputPath('electron-console.log')
    await writeFile(consolePath, `${consoleMessages.join('\n')}\n`, 'utf8')
    await testInfo.attach('electron-console', { path: consolePath, contentType: 'text/plain' })
  }
}

export const test = base.extend<ElectronFixtures>({
  runtime: async ({}, use, testInfo) => {
    const runtime = await createIsolatedTestRuntime(`${testInfo.project.name}-${testInfo.workerIndex}`)
    try {
      await use(runtime)
    } finally {
      await runtime.cleanup()
    }
  },

  workspacePath: async ({ runtime }, use) => {
    await use(runtime.workspaceDir)
  },

  electronApp: async ({ runtime }, use, testInfo) => {
    await access(electronEntryPath).catch(() => {
      throw new Error(
        `Electron build entry is missing at ${electronEntryPath}. Run "pnpm run build" before Playwright.`
      )
    })

    const consoleMessages: string[] = []
    const electronApp = await electron.launch({
      executablePath: electronExecutablePath,
      args: [`--user-data-dir=${runtime.userDataDir}`, electronEntryPath],
      cwd: repositoryRoot,
      env: runtime.env,
      timeout: 30_000,
      tracesDir: testInfo.outputPath('electron-traces')
    })

    electronApp.on('console', (message) => {
      consoleMessages.push(`[main:${message.type()}] ${message.text()}`)
    })

    const context = electronApp.context()
    let tracingStarted = false
    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      tracingStarted = true

      const actualUserDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      if (!isPathInside(runtime.rootDir, actualUserDataDir)) {
        throw new Error(
          `Electron escaped the isolated runtime. Expected userData under ${runtime.rootDir}, received ${actualUserDataDir}.`
        )
      }

      await use(electronApp)
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus
      if (failed) {
        await captureFailureArtifacts(electronApp, testInfo, consoleMessages)
      }

      if (tracingStarted) {
        if (failed) {
          const tracePath = testInfo.outputPath('trace.zip')
          await context.tracing.stop({ path: tracePath }).catch(() => undefined)
          await testInfo.attach('trace', { path: tracePath, contentType: 'application/zip' }).catch(() => undefined)
        } else {
          await context.tracing.stop().catch(() => undefined)
        }
      }
      await electronApp.close().catch(() => undefined)
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  }
})

export { expect }

