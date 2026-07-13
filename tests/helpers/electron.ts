import {
  test as base,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { createTestRuntime, type TestRuntime } from './test-runtime'
import { launchElectronRuntime } from './test-runtime/electron'

type ElectronFixtures = {
  runtime: TestRuntime
  workspacePath: string
  electronApp: ElectronApplication
  mainWindow: Page
}

export const test = base.extend<ElectronFixtures>({
  runtime: async ({}, use, testInfo) => {
    const runtime = await createTestRuntime(`${testInfo.project.name}-${testInfo.workerIndex}`)
    try {
      await use(runtime)
    } finally {
      await runtime.cleanup()
    }
  },

  workspacePath: async ({ runtime }, use) => {
    await use(runtime.paths.workspace)
  },

  electronApp: async ({ runtime }, use, testInfo) => {
    const launched = await launchElectronRuntime(runtime, testInfo)
    try {
      await use(launched.application)
    } finally {
      await launched.close({ failed: testInfo.status !== testInfo.expectedStatus })
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  }
})

export { expect }