import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { arch, release } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const vitestEntrypoint = resolve(projectRoot, 'node_modules', 'vitest', 'vitest.mjs')
const defaultRuns = 3
const defaultTimeoutMs = 120_000
const outputLimitBytes = 64 * 1024

const options = parseOptions(process.argv.slice(2))
const checks = [
  {
    id: 'agent-run-persistence.unit.test.ts',
    command: process.execPath,
    args: [vitestEntrypoint, 'run', '--project', 'unit', 'tests/unit/agent-run-persistence.unit.test.ts']
  },
  {
    id: 'check:agent-operation-idempotency',
    command: process.execPath,
    args: ['scripts/check-agent-operation-idempotency.mjs']
  },
  {
    id: 'check:agent-run-recovery',
    command: process.execPath,
    args: ['scripts/check-agent-run-recovery.mjs']
  }
]

const startedAt = new Date()
const report = {
  schemaVersion: 1,
  startedAt: startedAt.toISOString(),
  requestedRuns: options.runs,
  timeoutMs: options.timeoutMs,
  environment: {
    os: {
      platform: process.platform,
      release: release(),
      arch: arch()
    },
    node: process.version,
    pnpm: pnpmVersion()
  },
  checks: checks.map(({ id }) => id),
  runs: []
}

console.log(`Running agent persistence stability matrix ${options.runs} time(s); per-check timeout: ${options.timeoutMs}ms.`)

for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
  const runStartedAt = new Date()
  const run = {
    run: runNumber,
    startedAt: runStartedAt.toISOString(),
    durationMs: 0,
    status: 'passed',
    checks: []
  }

  console.log(`\nRun ${runNumber}/${options.runs}`)
  for (const check of checks) {
    const result = await runCheck(check, options.timeoutMs)
    run.checks.push(result)
    console.log(`  ${result.status === 'passed' ? 'PASS' : 'FAIL'} ${check.id} (${result.durationMs}ms)`)

    if (result.status !== 'passed') {
      run.status = 'failed'
      printFailureOutput(result)
    }
  }

  run.durationMs = Date.now() - runStartedAt.getTime()
  report.runs.push(run)
}

report.finishedAt = new Date().toISOString()
report.durationMs = Date.now() - startedAt.getTime()
report.summary = summarize(report.runs)

const reportPath = await writeReport(report)
console.log(`\nStability report: ${relative(projectRoot, reportPath)}`)
console.log(
  `Summary: ${report.summary.passedChecks}/${report.summary.totalChecks} checks passed across ${report.summary.completedRuns}/${report.requestedRuns} run(s) in ${report.durationMs}ms.`
)

if (report.summary.failedChecks > 0) {
  process.exitCode = 1
}

function parseOptions(args) {
  const options = { runs: defaultRuns, timeoutMs: defaultTimeoutMs }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      console.log([
        'Usage: node scripts/run-stability-checks.mjs [--runs <N>] [--timeout-ms <N>]',
        '',
        'Runs the agent persistence unit test and idempotency/recovery checks sequentially.',
        `Default runs: ${defaultRuns}; default per-check timeout: ${defaultTimeoutMs}ms.`
      ].join('\n'))
      process.exit(0)
    }

    const [name, inlineValue] = argument.split('=', 2)
    if (name === '--runs' || name === '--timeout-ms') {
      const value = inlineValue ?? args[++index]
      const parsed = parsePositiveInteger(value, name)
      if (name === '--runs') options.runs = parsed
      else options.timeoutMs = parsed
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return options
}

function parsePositiveInteger(value, name) {
  if (!/^\d+$/.test(value ?? '')) {
    throw new Error(`${name} must be a positive integer; received ${String(value)}`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer; received ${value}`)
  }

  return parsed
}

async function runCheck(check, timeoutMs) {
  const startedAt = new Date()
  const childResult = await spawnAndCapture(check.command, check.args, timeoutMs)
  const durationMs = Date.now() - startedAt.getTime()
  const status = childResult.kind === 'passed' ? 'passed' : 'failed'

  return {
    id: check.id,
    status,
    startedAt: startedAt.toISOString(),
    durationMs,
    command: formatCommand(check.command, check.args),
    exitCode: childResult.exitCode,
    signal: childResult.signal,
    failure: childResult.kind === 'passed' ? null : childResult.kind,
    error: childResult.error,
    output: {
      stdout: childResult.stdout,
      stderr: childResult.stderr,
      truncated: childResult.truncated
    }
  }
}

function spawnAndCapture(command, args, timeoutMs) {
  return new Promise((resolveResult) => {
    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    let timedOut = false
    let timeout

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveResult({ ...result, stdout, stderr, truncated })
    }

    let child
    try {
      child = spawn(command, args, {
        cwd: projectRoot,
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      finish({ kind: 'spawn_error', exitCode: null, signal: null, error: serializeError(error) })
      return
    }

    child.stdout?.on('data', (chunk) => {
      const captured = appendOutput(stdout, chunk)
      stdout = captured.value
      truncated ||= captured.truncated
    })
    child.stderr?.on('data', (chunk) => {
      const captured = appendOutput(stderr, chunk)
      stderr = captured.value
      truncated ||= captured.truncated
    })
    child.once('error', (error) => {
      finish({ kind: 'spawn_error', exitCode: null, signal: null, error: serializeError(error) })
    })
    child.once('close', (exitCode, signal) => {
      if (timedOut) {
        finish({ kind: 'timeout', exitCode, signal, error: `Timed out after ${timeoutMs}ms` })
      } else if (signal) {
        finish({ kind: 'signal', exitCode, signal, error: null })
      } else if (exitCode === 0) {
        finish({ kind: 'passed', exitCode, signal: null, error: null })
      } else {
        finish({ kind: 'exit_code', exitCode, signal: null, error: null })
      }
    })

    timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    timeout.unref()
  })
}

function appendOutput(existing, chunk) {
  const next = `${existing}${Buffer.from(chunk).toString('utf8')}`
  if (Buffer.byteLength(next) <= outputLimitBytes) return { value: next, truncated: false }

  const preserved = Buffer.from(next).subarray(-outputLimitBytes).toString('utf8')
  return { value: preserved, truncated: true }
}

function summarize(runs) {
  const completedRuns = runs.length
  const totalChecks = runs.reduce((total, run) => total + run.checks.length, 0)
  const failedChecks = runs.reduce(
    (total, run) => total + run.checks.filter((check) => check.status === 'failed').length,
    0
  )

  return {
    completedRuns,
    totalChecks,
    passedChecks: totalChecks - failedChecks,
    failedChecks,
    failedRuns: runs.filter((run) => run.status === 'failed').length
  }
}

async function writeReport(value) {
  const reportDirectory = resolve(projectRoot, 'out', 'test-results', 'stability-agent-persistence')
  await mkdir(reportDirectory, { recursive: true })
  const fileName = `${timestampForFileName(new Date())}-${process.pid}.json`
  const reportPath = resolve(reportDirectory, fileName)
  await writeFile(reportPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return reportPath
}

function timestampForFileName(date) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function pnpmVersion() {
  const userAgent = process.env.npm_config_user_agent ?? ''
  return userAgent.match(/(?:^|\s)pnpm\/([^\s]+)/)?.[1] ?? 'unavailable'
}

function formatCommand(command, args) {
  const executable = command === process.execPath ? 'node' : relative(projectRoot, command)
  return [executable, ...args.map((argument) => relativeIfWithinProject(argument))].join(' ')
}

function relativeIfWithinProject(value) {
  const relativeValue = relative(projectRoot, value)
  return relativeValue && !relativeValue.startsWith('..') && !/^[A-Za-z]:/.test(relativeValue)
    ? relativeValue
    : value
}

function serializeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function printFailureOutput(result) {
  const output = [result.output.stdout, result.output.stderr].filter(Boolean).join('\n').trim()
  const details = [
    result.failure && `failure=${result.failure}`,
    result.exitCode !== null && `exitCode=${result.exitCode}`,
    result.signal && `signal=${result.signal}`,
    result.error && `error=${result.error}`
  ].filter(Boolean).join(', ')

  console.error(`    ${details}`)
  if (output) console.error(output)
  if (result.output.truncated) console.error(`    Output was truncated to the final ${outputLimitBytes} bytes.`)
}