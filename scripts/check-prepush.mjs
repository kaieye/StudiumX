#!/usr/bin/env node
/**
 * Local pre-push subset: typecheck + security hygiene.
 * Intentionally excludes Playwright and full release-audit.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/check-prepush.mjs

Runs:
  - pnpm run typecheck
  - pnpm run check:security

Exits non-zero if any step fails.`)
  process.exit(0)
}

function run(label, command, commandArgs) {
  console.log(`\n[check:prepush] ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env
  })
  if (result.status !== 0) {
    console.error(`[check:prepush] failed: ${label}`)
    process.exit(result.status ?? 1)
  }
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
run('typecheck', pnpm, ['run', 'typecheck'])
run('check:security', pnpm, ['run', 'check:security'])
console.log('\n[check:prepush] ok')
