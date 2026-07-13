import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const requiredScripts = [
  'typecheck',
  'test:unit',
  'test:integration',
  'test:e2e',
  'test:visual',
  'check:analytics'
]
const requiredDevDependencies = [
  '@axe-core/playwright',
  '@playwright/test',
  '@testing-library/dom',
  '@testing-library/jest-dom',
  '@testing-library/react',
  '@testing-library/user-event',
  '@vitest/coverage-v8',
  'jsdom',
  'playwright',
  'vitest'
]
const requiredFiles = [
  'vitest.config.ts',
  'playwright.config.ts',
  'tests/setup/vitest.setup.ts',
  'tests/setup/tsconfig.json',
  'tests/helpers/render.tsx',
  'tests/helpers/runtime-isolation.ts',
  'tests/helpers/electron.ts',
  'tests/helpers/accessibility.ts',
  'tests/helpers/visual.ts',
  'tests/smoke/test-foundation.unit.test.tsx',
  'tests/e2e/foundation.e2e.spec.ts',
  'tests/e2e/study-analytics.e2e.spec.ts'
]

for (const script of requiredScripts) {
  if (!packageJson.scripts?.[script]) throw new Error(`Missing package script: ${script}`)
}

const checkScripts = Object.keys(packageJson.scripts).filter((name) => name.startsWith('check:'))
if (checkScripts.length < 78) {
  throw new Error(`Expected the original 77 check scripts plus check:analytics; found ${checkScripts.length}.`)
}

for (const dependency of requiredDevDependencies) {
  if (!packageJson.devDependencies?.[dependency]) {
    throw new Error(`Test tool must be declared in devDependencies: ${dependency}`)
  }
  if (packageJson.dependencies?.[dependency]) {
    throw new Error(`Test tool must not be a production dependency: ${dependency}`)
  }
}

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) throw new Error(`Missing test foundation file: ${file}`)
}

const commands = [
  ['exec', 'tsc', '--noEmit', '-p', 'tests/setup/tsconfig.json'],
  ['exec', 'vitest', 'run', '--project', 'unit', 'tests/smoke/test-foundation.unit.test.tsx'],
  ['exec', 'playwright', 'test', '--list']
]

for (const args of commands) {
  const pnpmScript = process.env.npm_execpath
  const command = pnpmScript ? process.execPath : 'pnpm'
  const commandArgs = pnpmScript ? [pnpmScript, ...args] : args
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: !pnpmScript && process.platform === 'win32'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Foundation command failed (${result.status}): pnpm ${args.join(' ')}`)
  }
}

console.log('Analytics test foundation is configured and loadable.')

