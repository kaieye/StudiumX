import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const playwrightResultsRoot = resolve('out/test-results/playwright')

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.01
    }
  },
  outputDir: resolve(playwrightResultsRoot, 'artifacts'),
  snapshotPathTemplate: resolve(
    'tests/visual/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}'
  ),
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(playwrightResultsRoot, 'report'), open: 'never' }]
  ],
  use: {
    // Electron creates its own BrowserContext, so the shared Electron fixture owns
    // failure screenshots and traces and writes them beneath outputDir.
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  },
  projects: [
    {
      name: 'electron-e2e',
      testMatch: '**/*.e2e.spec.ts'
    },
    {
      name: 'electron-visual',
      testMatch: '**/*.visual.spec.ts'
    }
  ]
})
