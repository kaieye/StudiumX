import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createLearningSessionLedger, encodeCommittedLearningSessionOutcome } from '../../src/main/learning-session-ledger'

const roots: string[] = []
const activeWorkers = new Set<ChildProcessWithoutNullStreams>()
const WORKER_TIMEOUT_MS = 20_000
const STRESS_WRITER_COUNT = 24
const STRESS_ROUNDS = 3
let workerRoot = ''
let workerPath = ''

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-learning-session-process-'))
  roots.push(root)
  return root
}

beforeAll(async () => {
  workerRoot = await mkdtemp(join(tmpdir(), 'studiumx-learning-session-worker-'))
  workerPath = join(workerRoot, 'worker.mjs')
  await runCommand(process.execPath, [
    join(process.cwd(), 'node_modules', 'esbuild', 'bin', 'esbuild'),
    join(process.cwd(), 'scripts', 'fixtures', 'learning-session-concurrency-worker.ts'),
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

describe('LearningSessionLedger cross-process writer', () => {
  it('serializes distinct event IDs across independent Node processes', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    await ledger.open({
      sessionId: 'session-process-distinct',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    })

    const readyPath = join(workspaceRoot, 'first-ready')
    const releasePath = join(workspaceRoot, 'release-first')
    const first = startWorker({
      workspaceRoot,
      operation: 'append',
      input: {
        sessionId: 'session-process-distinct',
        event: event('session-process-distinct', 'event-process-a', { writer: 'a' })
      },
      holdPoint: 'after_state_loaded',
      readyPath,
      releasePath
    })
    await waitForFile(readyPath)
    const second = startWorker({
      workspaceRoot,
      operation: 'append',
      input: {
        sessionId: 'session-process-distinct',
        event: event('session-process-distinct', 'event-process-b', { writer: 'b' })
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await writeFile(releasePath, 'release', 'utf8')

    const [firstResult, secondResult] = await Promise.all([collectWorker(first), collectWorker(second)])
    expect(firstResult.ok).toBe(true)
    expect(secondResult.ok).toBe(true)

    const recovered = await createLearningSessionLedger({ workspaceRoot }).load('session-process-distinct')
    expect(recovered).toMatchObject({ status: 'active', eventCount: 2 })
    expect(recovered?.events.map((value) => value.sequence)).toEqual([1, 2])
    expect(recovered?.events.map((value) => value.eventId).sort()).toEqual(['event-process-a', 'event-process-b'])
  })

  it('preserves every event through repeated 24-process writer-lock churn', { timeout: 60_000 }, async () => {
    const workspaceRoot = await createWorkspace()
    const sessionId = 'session-process-lock-churn'
    await createLearningSessionLedger({ workspaceRoot }).open({
      sessionId,
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    })

    const expectedEventIds: string[] = []
    for (let round = 0; round < STRESS_ROUNDS; round += 1) {
      const workers = Array.from({ length: STRESS_WRITER_COUNT }, (_, writer) => {
        const eventId = `event-lock-churn-${round}-${writer}`
        expectedEventIds.push(eventId)
        return startWorker({
          workspaceRoot,
          operation: 'append',
          writerLockWaitMs: 15_000,
          input: {
            sessionId,
            event: event(sessionId, eventId, { round, writer })
          }
        })
      })
      const results = await Promise.all(workers.map(collectWorker))
      const failures = results.filter((result) => !result.ok)
      expect(failures, `round ${round} worker failures: ${JSON.stringify(failures)}`).toEqual([])
    }

    const recovered = await createLearningSessionLedger({ workspaceRoot }).load(sessionId)
    expect(recovered?.eventCount).toBe(expectedEventIds.length)
    expect(recovered?.events.map((value) => value.sequence)).toEqual(
      Array.from({ length: expectedEventIds.length }, (_, index) => index + 1)
    )
    expect(new Set(recovered?.events.map((value) => value.eventId)).size).toBe(expectedEventIds.length)
    expect(recovered?.events.map((value) => value.eventId).sort()).toEqual(expectedEventIds.sort())
  })

  it('returns atomic append receipts for identical cross-process retries and rejects conflicting content', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    await ledger.open({
      sessionId: 'session-process-same-event',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    })

    const identicalEvent = event('session-process-same-event', 'event-process-same', { answer: 'same' })
    const identical = await runHeldPair(workspaceRoot,
      { operation: 'appendWithReceipt', input: { sessionId: 'session-process-same-event', event: identicalEvent } },
      { operation: 'appendWithReceipt', input: { sessionId: 'session-process-same-event', event: identicalEvent } }
    )
    expect(identical.map((result) => result.ok)).toEqual([true, true])
    const receipts = identical.map((result) => result.result as {
      disposition: 'appended' | 'matching_existing'
      snapshot: { events: unknown[] }
      event: { eventId: string; sequence: number; recordedAt: string }
    })
    expect(receipts.map((receipt) => receipt.disposition).sort()).toEqual(['appended', 'matching_existing'])
    expect(receipts[0].event).toEqual(receipts[1].event)
    expect(receipts[0].snapshot.events).toContainEqual(receipts[0].event)
    expect(receipts[1].snapshot.events).toContainEqual(receipts[1].event)
    await expect(ledger.load('session-process-same-event')).resolves.toMatchObject({ eventCount: 1 })

    const conflict = await runHeldPair(workspaceRoot,
      {
        operation: 'append',
        input: {
          sessionId: 'session-process-same-event',
          event: event('session-process-same-event', 'event-process-conflict', { answer: 'first' })
        }
      },
      {
        operation: 'append',
        input: {
          sessionId: 'session-process-same-event',
          event: event('session-process-same-event', 'event-process-conflict', { answer: 'second' })
        }
      }
    )
    expect(conflict.filter((result) => result.ok)).toHaveLength(1)
    expect(conflict.find((result) => !result.ok)?.error?.code).toBe('identity_conflict')
    await expect(ledger.load('session-process-same-event')).resolves.toMatchObject({ eventCount: 2 })
  })

  it('merges concurrent conversation bindings across independent processes', async () => {
    const workspaceRoot = await createWorkspace()
    const identity = {
      sessionId: 'session-process-binding',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    }
    await createLearningSessionLedger({ workspaceRoot }).open(identity)

    const results = await runHeldPair(workspaceRoot,
      {
        operation: 'open',
        input: {
          ...identity,
          conversationRefs: [{ conversationId: 'conversation-a', relativePath: 'conversation/conversation-a.json' }]
        }
      },
      {
        operation: 'open',
        input: {
          ...identity,
          conversationRefs: [{ conversationId: 'conversation-b', relativePath: 'conversation/conversation-b.json' }]
        }
      }
    )
    expect(results.map((result) => result.ok)).toEqual([true, true])
    const loaded = await createLearningSessionLedger({ workspaceRoot }).load(identity.sessionId)
    expect(loaded?.conversationRefs.map((ref) => ref.conversationId).sort()).toEqual(['conversation-a', 'conversation-b'])
  })

  it('returns typed writer_busy metadata when a second process cannot settle before its deadline', async () => {
    const workspaceRoot = await createWorkspace()
    await createLearningSessionLedger({ workspaceRoot }).open({
      sessionId: 'session-process-busy',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    })
    const readyPath = join(workspaceRoot, 'busy-ready')
    const releasePath = join(workspaceRoot, 'busy-release')
    const holder = startWorker({
      workspaceRoot,
      operation: 'scan',
      input: {},
      holdPoint: 'after_writer_lock_acquired',
      readyPath,
      releasePath
    })
    await waitForFile(readyPath)

    await expect(createLearningSessionLedger({ workspaceRoot, writerLockWaitMs: 40 }).load('session-process-busy'))
      .rejects.toMatchObject({
        code: 'writer_busy',
        writerOwner: { operation: 'scan', sessionId: null }
      })
    await writeFile(releasePath, 'release', 'utf8')
    expect((await collectWorker(holder)).ok).toBe(true)
  })

  it('serializes cross-process open aliases to one lowercase canonical Session', async () => {
    const workspaceRoot = await createWorkspace()
    const identity = {
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    }
    const results = await runHeldPair(workspaceRoot,
      { operation: 'open', input: { ...identity, sessionId: 'Session-Process-Case' } },
      { operation: 'open', input: { ...identity, sessionId: 'session-process-case' } }
    )

    expect(results.map((result) => result.ok)).toEqual([true, true])
    expect(results.map((result) => (result.result as { id: string }).id)).toEqual([
      'session-process-case',
      'session-process-case'
    ])
    expect((await readdir(join(workspaceRoot, 'learning-sessions'))).filter((name) => !name.startsWith('.'))).toEqual([
      'session-process-case'
    ])
  })

  it('serializes append against complete across independent processes', async () => {
    const workspaceRoot = await createWorkspace()
    await createLearningSessionLedger({ workspaceRoot }).open({
      sessionId: 'session-process-complete',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    })
    const committed = encodeCommittedLearningSessionOutcome({
      sessionId: 'session-process-complete',
      outcomeId: 'outcome-process-complete',
      kind: 'not_evidenced',
      evidenceEventIds: []
    })
    await writeFile(join(workspaceRoot, ...committed.ref.relativePath.split('/')), committed.content, 'utf8')

    const results = await runHeldPair(workspaceRoot,
      {
        operation: 'append',
        input: {
          sessionId: 'session-process-complete',
          event: event('session-process-complete', 'event-before-complete', { order: 1 })
        }
      },
      {
        operation: 'complete',
        input: { sessionId: 'session-process-complete', outcomeRef: committed.ref }
      }
    )

    expect(results.map((result) => result.ok)).toEqual([true, true])
    await expect(createLearningSessionLedger({ workspaceRoot }).load('session-process-complete')).resolves.toMatchObject({
      status: 'completed',
      eventCount: 1
    })
  })

  it('recovers a crash-published event before allowing a concurrent append', async () => {
    const workspaceRoot = await createWorkspace()
    await createLearningSessionLedger({ workspaceRoot }).open({
      sessionId: 'session-process-repair',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    })
    const crashing = startWorker({
      workspaceRoot,
      operation: 'append',
      input: {
        sessionId: 'session-process-repair',
        event: event('session-process-repair', 'event-crash-published', { crash: true })
      },
      crashPoint: 'after_event_publish'
    })
    expect(await collectCrashWorker(crashing)).toBe(86)

    const readyPath = join(workspaceRoot, 'repair-ready')
    const releasePath = join(workspaceRoot, 'repair-release')
    const repairing = startWorker({
      workspaceRoot,
      operation: 'load',
      input: { sessionId: 'session-process-repair' },
      writerLockStaleMs: 0,
      holdPoint: 'before_manifest_repair',
      readyPath,
      releasePath
    })
    await waitForFile(readyPath)
    const appending = startWorker({
      workspaceRoot,
      operation: 'append',
      input: {
        sessionId: 'session-process-repair',
        event: event('session-process-repair', 'event-after-repair', { crash: false })
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await writeFile(releasePath, 'release', 'utf8')

    expect((await collectWorker(repairing)).ok).toBe(true)
    expect((await collectWorker(appending)).ok).toBe(true)
    const recoveredLedger = createLearningSessionLedger({ workspaceRoot })
    const recovered = await recoveredLedger.load('session-process-repair')
    expect(recovered?.events.map((value) => value.eventId)).toEqual(['event-crash-published', 'event-after-repair'])
    const scan = await recoveredLedger.scan()
    expect(scan.recoveries).toContainEqual(expect.objectContaining({
      state: 'preserved',
      owner: expect.objectContaining({ operation: 'append', sessionId: 'session-process-repair' })
    }))
    expect(scan.diagnostics).toContainEqual(expect.objectContaining({ code: 'writer_recovery' }))
  })

  it('recovers a real crash-left Session stage without publishing it as canonical fact', async () => {
    const workspaceRoot = await createWorkspace()
    const crashing = startWorker({
      workspaceRoot,
      operation: 'open',
      input: {
        sessionId: 'session-process-stage-crash',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Crash stage', relativePath: 'courses/crash-stage' }
      },
      crashPoint: 'after_stage_sync'
    })
    expect(await collectCrashWorker(crashing)).toBe(86)

    const sessionsRoot = join(workspaceRoot, 'learning-sessions')
    const stageName = (await readdir(sessionsRoot)).find((name) => name.startsWith('.session-stage-'))
    expect(stageName).toBeTruthy()
    const stagePath = join(sessionsRoot, stageName!)
    await utimes(stagePath, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))

    const scan = await createLearningSessionLedger({ workspaceRoot, writerLockStaleMs: 0 }).scan()
    expect(scan.canonicalSessions).toEqual([])
    expect(scan.stages).toContainEqual(expect.objectContaining({
      relativePath: expect.stringContaining(stageName!),
      kind: 'session',
      state: 'cleaned'
    }))
    expect(scan.diagnostics).toContainEqual(expect.objectContaining({
      code: 'stale_session_stage',
      sessionId: 'session-process-stage-crash'
    }))
    await expect(access(stagePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})


async function runHeldPair(
  workspaceRoot: string,
  firstRequest: Omit<WorkerRequest, 'workspaceRoot' | 'readyPath' | 'releasePath' | 'holdPoint'>,
  secondRequest: Omit<WorkerRequest, 'workspaceRoot'>
): Promise<[WorkerResult, WorkerResult]> {
  const token = Math.random().toString(16).slice(2)
  const readyPath = join(workspaceRoot, `pair-${token}-ready`)
  const releasePath = join(workspaceRoot, `pair-${token}-release`)
  const first = startWorker({
    workspaceRoot,
    ...firstRequest,
    holdPoint: 'after_state_loaded',
    readyPath,
    releasePath
  })
  await waitForFile(readyPath)
  const second = startWorker({ workspaceRoot, ...secondRequest })
  await new Promise((resolve) => setTimeout(resolve, 100))
  await writeFile(releasePath, 'release', 'utf8')
  return Promise.all([collectWorker(first), collectWorker(second)])
}

function event(sessionId: string, eventId: string, payload: Record<string, unknown>) {
  return {
    schemaVersion: 1 as const,
    eventId,
    sessionId,
    kind: 'retrieval_attempted' as const,
    occurredAt: '2026-07-15T12:00:00.000Z',
    payload
  }
}

type WorkerRequest = {
  workspaceRoot: string
  operation: 'append' | 'appendWithReceipt' | 'open' | 'complete' | 'load' | 'scan'
  input: Record<string, unknown>
  readyPath?: string
  releasePath?: string
  holdPoint?: string
  writerLockStaleMs?: number
  writerLockWaitMs?: number
  crashPoint?: string
}

type WorkerResult = {
  ok: boolean
  result?: unknown
  error?: { code?: string; message: string; writerOwner?: unknown; diagnostic?: unknown }
}

function startWorker(request: WorkerRequest): ChildProcessWithoutNullStreams {
  const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64url')
  const child = spawn(process.execPath, [workerPath, encoded], { stdio: ['ignore', 'pipe', 'pipe'] })
  activeWorkers.add(child)
  child.once('exit', () => activeWorkers.delete(child))
  return child
}

async function collectCrashWorker(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return waitForExit(child)
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
      child.kill()
      killTimer = setTimeout(() => {
        child.removeListener('exit', onExit)
        child.kill('SIGKILL')
        reject(timeoutError())
      }, 2_000)
    }, WORKER_TIMEOUT_MS)
    child.once('exit', onExit)
    if (child.exitCode !== null) {
      child.removeListener('exit', onExit)
      clearTimeout(timer)
      resolve(child.exitCode)
    }
  })
}

async function terminateWorker(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return
  child.kill()
  await new Promise<void>((resolveTermination) => {
    const onExit = () => {
      clearTimeout(timer)
      resolveTermination()
    }
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      child.kill('SIGKILL')
      resolveTermination()
    }, 2_000)
    child.once('exit', onExit)
    if (child.exitCode !== null) {
      child.removeListener('exit', onExit)
      clearTimeout(timer)
      resolveTermination()
    }
  })
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`Timed out waiting for worker readiness: ${path}`)
}


async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { cwd: process.cwd(), timeout: 15_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${error.message}
${stderr}`))
      else resolve()
    })
  })
}
