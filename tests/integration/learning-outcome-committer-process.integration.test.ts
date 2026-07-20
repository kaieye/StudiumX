import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'

const roots: string[] = []
const activeWorkers = new Set<ChildProcessWithoutNullStreams>()
const WORKER_TIMEOUT_MS = 20_000
let workerRoot = ''
let workerPath = ''

type WorkerRequest = {
  workspaceRoot: string
  operation: 'open' | 'appendEvidence' | 'commit' | 'reconcile'
  sessionId: string
  operationId?: string
  outcomeId?: string
  evidenceEventId?: string
  kind?: 'established' | 'needs_practice' | 'not_evidenced' | 'misconception_corrected'
  crashPoint?: string
  writerLockStaleMs?: number
  writerLockWaitMs?: number
}

type WorkerResult = {
  ok: boolean
  result?: unknown
  error?: { name?: string; message?: string; code?: string }
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-outcome-committer-process-'))
  roots.push(root)
  return root
}

beforeAll(async () => {
  workerRoot = await mkdtemp(join(tmpdir(), 'studiumx-outcome-committer-worker-'))
  workerPath = join(workerRoot, 'worker.mjs')
  const esbuildBinary = join(process.cwd(), 'node_modules', 'esbuild', 'bin', 'esbuild')
  await runCommand(esbuildBinary, [
    join(process.cwd(), 'scripts', 'fixtures', 'learning-outcome-committer-process-worker.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node22',
    `--outfile=${workerPath}`,
    '--log-level=silent'
  ])
})

afterEach(async () => {
  const workers = [...activeWorkers]
  await Promise.all(workers.map(terminateWorker))
  activeWorkers.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

afterAll(async () => {
  if (workerRoot) await rm(workerRoot, { recursive: true, force: true })
})

describe('LearningOutcomeCommitter cross-process settlement', () => {
  it('cleans stage residual across process restart and commits without duplicate record identity', async () => {
    const workspaceRoot = await createWorkspace()
    const sessionId = 'session-process-stage-residual'
    const outcomeId = 'outcome-process-stage-residual-1'
    const operationId = 'process-stage-residual-operation-1'
    const evidenceEventId = 'evidence-process-stage-residual-1'

    expect((await runWorker({ workspaceRoot, operation: 'open', sessionId })).ok).toBe(true)
    expect((await runWorker({
      workspaceRoot,
      operation: 'appendEvidence',
      sessionId,
      evidenceEventId
    })).ok).toBe(true)

    const crashed = startWorker({
      workspaceRoot,
      operation: 'commit',
      sessionId,
      operationId,
      outcomeId,
      evidenceEventId,
      kind: 'established',
      crashPoint: 'after_stage_flush'
    })
    expect(await waitForExit(crashed)).toBe(86)

    const stageDirectory = join(workspaceRoot, 'learning-records', '.learning-outcome-committer-stage')
    const stagedEntries = await readdir(stageDirectory)
    expect(stagedEntries).toHaveLength(1)
    expect(stagedEntries[0]).toContain(sessionId)
    await expect(readFile(join(workspaceRoot, 'learning-records', `outcome-${sessionId}.md`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const reconcile = await runWorker({ workspaceRoot, operation: 'reconcile', sessionId, outcomeId, writerLockStaleMs: 0 })
    expect(reconcile).toMatchObject({ ok: true, result: { state: 'pending', marker: null, record: null } })
    await expect(readdir(stageDirectory)).resolves.toEqual([])

    const commit = await runWorker({
      workspaceRoot,
      operation: 'commit',
      sessionId,
      operationId,
      outcomeId,
      evidenceEventId,
      kind: 'established'
    })
    expect(commit).toMatchObject({
      ok: true,
      result: { status: 'committed', outcome: { outcomeId, kind: 'established' }, recordSaved: true }
    })

    const record = await readFile(join(workspaceRoot, 'learning-records', `outcome-${sessionId}.md`), 'utf8')
    expect(record).toContain(outcomeId)
    await expect(readdir(stageDirectory)).resolves.toEqual([])

    const replay = await runWorker({
      workspaceRoot,
      operation: 'commit',
      sessionId,
      operationId,
      outcomeId,
      evidenceEventId,
      kind: 'established'
    })
    expect(replay).toMatchObject({
      ok: true,
      result: { status: 'already_committed', outcome: { outcomeId } }
    })
    const records = (await readdir(join(workspaceRoot, 'learning-records'))).filter((entry) => entry.endsWith('.md'))
    expect(records).toEqual([`outcome-${sessionId}.md`])
    await expect(createLearningSessionLedger({ workspaceRoot }).load(sessionId)).resolves.toMatchObject({
      status: 'completed',
      outcomeRef: { outcomeId }
    })
  })

  it('repairs after-record-publish crash across process restart without re-evaluating identity', async () => {
    const workspaceRoot = await createWorkspace()
    const sessionId = 'session-process-after-record'
    const outcomeId = 'outcome-process-after-record-1'
    const operationId = 'process-after-record-operation-1'
    const evidenceEventId = 'evidence-process-after-record-1'

    expect((await runWorker({ workspaceRoot, operation: 'open', sessionId })).ok).toBe(true)
    expect((await runWorker({
      workspaceRoot,
      operation: 'appendEvidence',
      sessionId,
      evidenceEventId
    })).ok).toBe(true)

    const crashed = startWorker({
      workspaceRoot,
      operation: 'commit',
      sessionId,
      operationId,
      outcomeId,
      evidenceEventId,
      kind: 'established',
      crashPoint: 'after_record_publish'
    })
    expect(await waitForExit(crashed)).toBe(86)

    await expect(readFile(join(workspaceRoot, 'learning-records', `outcome-${sessionId}.md`), 'utf8')).resolves.toContain(outcomeId)
    await expect(readFile(join(workspaceRoot, 'learning-sessions', sessionId, 'outcome.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const reconcile = await runWorker({ workspaceRoot, operation: 'reconcile', sessionId, outcomeId, writerLockStaleMs: 0 })
    expect(reconcile).toMatchObject({
      ok: true,
      result: {
        state: 'repaired',
        marker: { outcomeId, operationId },
        record: { recordId: `learning-outcome-${sessionId}-${outcomeId}` }
      }
    })
    await expect(createLearningSessionLedger({ workspaceRoot }).load(sessionId)).resolves.toMatchObject({
      status: 'completed',
      outcomeRef: { outcomeId }
    })
    await expect(readFile(join(workspaceRoot, 'learning-sessions', sessionId, 'outcome-settlement.json'), 'utf8')).resolves.toContain(operationId)

    const replay = await runWorker({
      workspaceRoot,
      operation: 'commit',
      sessionId,
      operationId,
      outcomeId,
      evidenceEventId,
      kind: 'established'
    })
    expect(replay).toMatchObject({
      ok: true,
      result: { status: 'already_committed', outcome: { outcomeId } }
    })
  })
})

function startWorker(request: WorkerRequest): ChildProcessWithoutNullStreams {
  const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64url')
  const child = spawn(process.execPath, [workerPath, encoded], { stdio: ['ignore', 'pipe', 'pipe'] })
  activeWorkers.add(child)
  child.once('exit', () => activeWorkers.delete(child))
  return child
}

async function runWorker(request: WorkerRequest): Promise<WorkerResult> {
  return collectWorker(startWorker(request))
}

async function collectWorker(child: ChildProcessWithoutNullStreams): Promise<WorkerResult> {
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exitCode = await waitForExit(child)
  if (!stdout.trim()) throw new Error(`Worker exited ${exitCode}: ${stderr}`)
  return JSON.parse(stdout.trim()) as WorkerResult
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode
  return new Promise<number | null>((resolve, reject) => {
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const timeoutError = () => new Error(`Worker exceeded ${WORKER_TIMEOUT_MS}ms and was terminated.`)
    const onExit = (code: number | null) => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      if (timedOut) reject(timeoutError())
      else resolve(code)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      killTimer = setTimeout(() => reject(timeoutError()), 1_000)
    }, WORKER_TIMEOUT_MS)
    child.once('exit', onExit)
  })
}

async function terminateWorker(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) return
  child.kill('SIGKILL')
  await waitForExit(child).catch(() => undefined)
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { cwd: process.cwd(), timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error([
          `Command failed: ${command} ${args.join(' ')}`,
          error.message,
          `stdout:\n${stdout}`,
          `stderr:\n${stderr}`
        ].join('\n')))
        return
      }
      resolve()
    })
  })
}
