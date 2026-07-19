import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export function runVitestRuntimeGate({ files, testName }) {
  const args = [join(process.cwd(), 'node_modules/vitest/vitest.mjs'), 'run']
  if (testName) args.push('-t', testName)
  args.push(...files)
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(result.error, undefined, `Unable to launch Vitest: ${result.error?.message ?? 'unknown error'}`)
  assert.equal(result.status, 0, `Vitest runtime gate failed (exit ${result.status}).\n${result.stdout}\n${result.stderr}`)
}
