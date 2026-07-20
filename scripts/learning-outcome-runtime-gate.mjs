import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export function validateVitestResult(stdout, { scenario, expectedMatches = 1 }) {
  let report
  try { report = JSON.parse(stdout) } catch (error) { throw new Error(`Vitest emitted non-JSON output for ${scenario}: ${error.message}`) }
  const passed = report.testResults?.flatMap((suite) => suite.assertionResults ?? []).filter((test) => test.status === 'passed') ?? []
  assert.equal(report.success, true, `Vitest runtime scenario failed: ${scenario}`)
  assert.equal(passed.length, expectedMatches, `Scenario ${scenario} matched ${passed.length} passing tests; expected ${expectedMatches}`)
  return report
}

export function runVitestRuntimeGate({ files, requiredScenarios }) {
  assert.ok(Array.isArray(requiredScenarios) && requiredScenarios.length > 0, 'requiredScenarios must not be empty')
  for (const scenario of requiredScenarios) {
    assert.ok(scenario.testName, 'required scenario testName must be provided')
    const args = [join(process.cwd(), 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', '-t', scenario.testName, ...files]
    const result = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(result.error, undefined, `Unable to launch Vitest: ${result.error?.message ?? 'unknown error'}`)
    assert.equal(result.status, 0, `Vitest runtime scenario failed (exit ${result.status}) ${scenario.testName}.\n${result.stdout}\n${result.stderr}`)
    validateVitestResult(result.stdout, scenario)
  }
}
