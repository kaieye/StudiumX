import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  calculateDoctorExitCode,
  classifyDoctorChecks,
  collectDoctorSnapshot,
  formatDoctorReport,
  redactDoctorSnapshot
} from './lib/doctor-snapshot.mjs'

const tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-doctor-'))

try {
  await mkdir(tempRoot, { recursive: true })
  await mkdir(join(tempRoot, '.studiumx'), { recursive: true })
  await writeFile(join(tempRoot, '.studiumx', 'learning-work.jsonl'), '')
  await writeFile(
    join(tempRoot, 'studiumx-settings.json'),
    `${JSON.stringify({
      version: 1,
      provider: {
        activeProviderId: 'custom',
        providers: [
          {
            id: 'custom',
            name: 'Secret Provider',
            baseUrl: 'https://user:password@example.com/v1?api_key=sk-should-not-leak',
            endpointFormat: 'chat_completions',
            models: ['secret-model'],
            apiKey: 'sk-should-not-leak'
          }
        ],
        proxy: {
          enabled: true,
          url: 'https://proxy.example.test?token=proxy-should-not-leak'
        }
      },
      generator: {
        providerId: 'custom',
        model: 'secret-model',
        endpointFormat: 'chat_completions'
      },
      workspace: {
        defaultRoot: join(tempRoot, 'workspace')
      },
      worktree: {
        rootPath: join(tempRoot, 'workspace', '.worktrees')
      },
      tools: {
        enabled: true,
        workspaceRead: true,
        approvalMode: 'request_approval',
        webSearch: true,
        webFetch: true
      },
      privacy: {
        maskApiKeys: true,
        allowExternalLinks: true
      },
      log: {
        enabled: true,
        retentionDays: 14
      },
      webSearch: {
        braveApiKey: 'brave-should-not-leak',
        tavilyApiKey: 'tavily-should-not-leak'
      }
    }, null, 2)}\n`,
    { mode: 0o600 }
  )

  const passCheck = join(tempRoot, 'doctor-pass.mjs')
  const failCheck = join(tempRoot, 'doctor-fail.mjs')
  await writeFile(passCheck, "console.log('pass check output')\n")
  await writeFile(failCheck, "console.error('fail check output')\nprocess.exit(7)\n")

  const snapshot = await collectDoctorSnapshot({
    cwd: process.cwd(),
    userDataPath: tempRoot,
    workspacePath: tempRoot,
    runChecks: false
  })
  assert.equal(snapshot.settings.storage, 'json_file')
  assert.equal(snapshot.settings.keyStorage, 'settings_json')
  assert.equal(snapshot.settings.keychainMigration, 'pending_app_launch')
  assert.equal(snapshot.settings.provider.providerCount, 1)
  assert.deepEqual(snapshot.securityChecks, [])
  assert.equal(snapshot.readiness.status, 'checks_skipped')
  assert.equal(snapshot.diagnostics.workspaceContent, 'not_included')
  assert.deepEqual(snapshot.learningWork.map((item) => [item.scope, item.status]), [
    ['app_data', 'ok'],
    ['workspace', 'ok']
  ])

  const redacted = redactDoctorSnapshot(snapshot)
  const redactedJson = formatDoctorReport(redacted, 'json')
  assert.doesNotMatch(redactedJson, /sk-should-not-leak/)
  assert.doesNotMatch(redactedJson, /proxy-should-not-leak/)
  assert.doesNotMatch(redactedJson, /brave-should-not-leak/)
  assert.doesNotMatch(redactedJson, /tavily-should-not-leak/)
  const redactionProbe = structuredClone(snapshot)
  redactionProbe.repository.scripts.authorization = 'Bearer should-not-leak'
  redactionProbe.repository.scripts.endpoint = 'https://user:password@example.com/v1?token=should-not-leak'
  const probeJson = formatDoctorReport(redactDoctorSnapshot(redactionProbe), 'json')
  assert.doesNotMatch(probeJson, /should-not-leak/)
  assert.match(probeJson, /\[REDACTED\]/)
  assert.match(formatDoctorReport(redacted), /security checks: skipped\nlearning work \(app_data\): ok, 0 conversation\(s\)/)
  assert.equal(calculateDoctorExitCode(snapshot), 0)

  const checkedSnapshot = await collectDoctorSnapshot({
    cwd: tempRoot,
    userDataPath: tempRoot,
    runChecks: true,
    checkCatalog: [passCheck, failCheck]
  })
  assert.deepEqual(checkedSnapshot.securityChecks.map((check) => [check.status, check.classification, check.exitCode]), [
    ['passed', 'passed', 0],
    ['failed', 'failed', 7]
  ])
  assert.deepEqual(checkedSnapshot.readiness, {
    status: 'attention',
    securityChecks: {
      total: 2,
      passed: 1,
      failed: 1,
      timedOut: 0,
      runnerErrors: 0
    }
  })
  assert.equal(calculateDoctorExitCode(checkedSnapshot), 1)
  assert.match(formatDoctorReport(checkedSnapshot), /security checks: 1\/2 passed/)

  const runnerErrorCheck = {
    id: 'runner-error',
    script: 'scripts/runner-error.mjs',
    status: 'failed',
    classification: 'runner_error',
    exitCode: null,
    durationMs: 0,
    outputTail: []
  }
  assert.deepEqual(classifyDoctorChecks([runnerErrorCheck]), {
    status: 'attention',
    securityChecks: {
      total: 1,
      passed: 0,
      failed: 1,
      timedOut: 0,
      runnerErrors: 1
    }
  })

  assert.throws(() => classifyDoctorChecks([{ id: 'bad', script: 'bad.mjs', status: 'passed', classification: 'failed', exitCode: 0, durationMs: 0, outputTail: [] }]), /passed classification/)
  assert.throws(() => formatDoctorReport(snapshot, 'yaml'), /Unsupported doctor report format/)
  assert.equal(calculateDoctorExitCode({}), 1)

  const result = spawnSync(
    process.execPath,
    ['scripts/doctor.mjs', '--json', '--no-checks', '--user-data', tempRoot, '--workspace', tempRoot],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /sk-should-not-leak/)
  assert.doesNotMatch(result.stdout, /proxy-should-not-leak/)
  assert.doesNotMatch(result.stdout, /brave-should-not-leak/)
  assert.doesNotMatch(result.stdout, /tavily-should-not-leak/)

  const cliSnapshot = JSON.parse(result.stdout)
  assert.equal(cliSnapshot.readiness.status, 'checks_skipped')
  assert.deepEqual(cliSnapshot.securityChecks, [])

  console.log('doctor readiness report contracts ok')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
