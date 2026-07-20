import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, parse, relative, resolve } from 'node:path'

import {
  classifyAuditCommandResult,
  isCleanCheckoutStatusCommand,
  isPathInside,
  parseAuditSkips,
  releaseAuditCommands,
  requiresWindowsCommandShell
} from './release-audit-contract.mjs'

const root = resolve(process.cwd())
const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')

if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--'))) {
  console.error('--output requires a path')
  process.exit(2)
}

const unsupportedArgs = args.filter((arg, index) => arg !== '--output' && !(outputIndex >= 0 && index === outputIndex + 1))
if (unsupportedArgs.length) {
  console.error(`unsupported release-audit arguments: ${unsupportedArgs.join(' ')}`)
  process.exit(2)
}

const output = outputIndex >= 0
  ? resolve(root, args[outputIndex + 1])
  : resolve(mkdtempSync(resolve(tmpdir(), 'studiumx-release-audit-')), 'p0-clean-checkout-audit.json')
const artifactDir = resolve(dirname(output), `${output.split(/[\\/]/).pop().replace(/\.json$/, '')}-artifacts`)
const outputInsideSourceWorktree = isPathInside(root, output) || isPathInside(root, artifactDir)

function quoteWindowsCommandArgument(argument) {
  return /^[A-Za-z0-9_./:=@+\-]+$/.test(argument) ? argument : `"${argument.replaceAll('"', '""')}"`
}

function run(argv, cwd) {
  const started = Date.now()
  const [command, commandArguments] = process.platform === 'win32' && requiresWindowsCommandShell(argv)
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', argv.map(quoteWindowsCommandArgument).join(' ')]]
    : [argv[0], argv.slice(1)]
  const result = spawnSync(command, commandArguments, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true
  })
  return {
    argv,
    exit: result.status ?? 1,
    durationMs: Date.now() - started,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error) : null
  }
}

const git = (argv, cwd = root) => run(['git', ...argv], cwd)
const gitWithLongPaths = (argv, cwd = root) => process.platform === 'win32'
  ? run(['git', '-c', 'core.longpaths=true', ...argv], cwd)
  : git(argv, cwd)
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const statusRecord = (result) => ({ exit: result.exit, stdout: result.stdout, stderr: result.stderr })
const toolVersions = Object.fromEntries([
  ['node', run(['node', '--version'], root)],
  ['pnpm', run(['pnpm', '--version'], root)],
  ['git', run(['git', '--version'], root)]
].map(([tool, result]) => [tool, { exit: result.exit, value: result.stdout.trim(), stderr: result.stderr.trim() }]))

mkdirSync(artifactDir, { recursive: true })

const sourceStatusBefore = git(['status', '--porcelain=v1'])
const commit = git(['rev-parse', 'HEAD'])
const commitSha = commit.exit === 0 ? commit.stdout.trim() : null
const results = []
let failed = false
let initializationError = null
let worktree = null
let worktreeParent = null
let cleanup = { attempted: false, succeeded: false, error: null }
let cleanCheckoutStatusAfterCommands = null

if (sourceStatusBefore.exit !== 0 || sourceStatusBefore.stdout.trim()) {
  failed = true
  initializationError = sourceStatusBefore.exit !== 0
    ? 'Unable to read source worktree status.'
    : 'Release audit requires a clean source worktree.'
} else if (commitSha === null) {
  failed = true
  initializationError = 'Unable to resolve source HEAD.'
} else {
  const worktreeTemporaryRoot = process.platform === 'win32' ? parse(root).root : tmpdir()
  worktreeParent = mkdtempSync(resolve(worktreeTemporaryRoot, 'sx-audit-'))
  worktree = resolve(worktreeParent, 'checkout')
  const add = git(['worktree', 'add', '--detach', worktree, commitSha])
  if (add.exit !== 0) {
    failed = true
    initializationError = `Unable to create detached clean checkout: ${add.stderr.trim() || add.error || 'unknown error'}`
    cleanup = { attempted: true, succeeded: true, error: null }
    rmSync(worktreeParent, { recursive: true, force: true })
    worktree = null
  } else {
    try {
      for (const argv of releaseAuditCommands) {
        const result = run(argv, worktree)
        const index = results.length
        const stdoutPath = resolve(artifactDir, `${index}.stdout`)
        const stderrPath = resolve(artifactDir, `${index}.stderr`)
        writeFileSync(stdoutPath, result.stdout)
        writeFileSync(stderrPath, result.stderr)

        const skips = parseAuditSkips(`${result.stdout}\n${result.stderr}`)
        const classification = classifyAuditCommandResult(result.exit, skips, { argv, platform: process.platform })
        const dirtyCheckout = isCleanCheckoutStatusCommand(argv) && result.stdout.trim().length > 0
        const failureReasons = [
          ...(result.exit === 0 ? [] : ['nonzero_exit']),
          ...(classification.unknownSkips.length ? ['unknown_skip_detected'] : []),
          ...(dirtyCheckout ? ['clean_checkout_dirty'] : []),
          ...(result.error ? ['spawn_error'] : [])
        ]
        const record = {
          argv,
          exit: result.exit,
          durationMs: result.durationMs,
          stdoutFile: relative(root, stdoutPath),
          stderrFile: relative(root, stderrPath),
          stdoutSha256: sha256(stdoutPath),
          stderrSha256: sha256(stderrPath),
          skips,
          knownSkips: classification.knownSkips,
          unknownSkips: classification.unknownSkips,
          failureReasons
        }
        results.push(record)
        failed ||= classification.failed || dirtyCheckout || result.error !== null
      }
      cleanCheckoutStatusAfterCommands = results.at(-1) ?? null
    } finally {
      cleanup.attempted = true
      const removed = gitWithLongPaths(['worktree', 'remove', '--force', worktree])
      cleanup.succeeded = removed.exit === 0
      cleanup.error = removed.exit === 0 ? null : (removed.stderr.trim() || removed.error || 'unknown error')
      if (!cleanup.succeeded) {
        failed = true
      } else if (worktreeParent) {
        rmSync(worktreeParent, { recursive: true, force: true })
      }
    }
  }
}

const sourceStatusAfterCommands = git(['status', '--porcelain=v1'])
if (sourceStatusAfterCommands.exit !== 0 || sourceStatusAfterCommands.stdout.trim()) failed = true
if (outputInsideSourceWorktree) failed = true

const artifact = {
  path: output,
  sha256: null,
  sha256Basis: 'SHA-256 of manifest bytes with artifact.sha256 set to null'
}
const audit = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  commitSha,
  sourceWorktree: root,
  outputInsideSourceWorktree,
  sourceStatusBefore: statusRecord(sourceStatusBefore),
  sourceStatusAfterCommands: statusRecord(sourceStatusAfterCommands),
  toolVersions,
  cleanCheckout: {
    path: worktree,
    detached: true,
    sha: commitSha,
    statusAfterCommands: cleanCheckoutStatusAfterCommands,
    cleanup
  },
  initializationError,
  commands: results,
  artifact,
  passed: !failed
}

mkdirSync(dirname(output), { recursive: true })
const basis = `${JSON.stringify(audit, null, 2)}\n`
artifact.sha256 = createHash('sha256').update(basis).digest('hex')
writeFileSync(output, `${JSON.stringify(audit, null, 2)}\n`)

if (failed) {
  console.error('release audit failed')
  process.exitCode = 1
}
console.log(output)
