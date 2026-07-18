import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  AgentRunAtomicRenameError,
  AgentRunPersistence,
  type AgentRunPersistenceOptions
} from '../../src/main/ai/agent-run-persistence'
import { DEFAULT_AGENT_RUN_BUDGET, emptyAgentRunUsage, type AgentRunCheckpoint } from '../../src/main/ai/agent-run-store'

const roots: string[] = []

async function storageRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `studiumx-agent-run-persistence-${label}-`))
  roots.push(root)
  return root
}

function checkpoint(runId: string, status: AgentRunCheckpoint['status'] = 'running'): AgentRunCheckpoint {
  return {
    version: 1,
    runId,
    streamId: runId,
    status,
    lastDurableSequence: 0,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    operationJournalPointer: `.agent-sessions/operations/${runId}`,
    budget: DEFAULT_AGENT_RUN_BUDGET,
    usage: emptyAgentRunUsage()
  }
}

function deterministicRename(options: {
  failures: string[]
  retryDelaysMs?: readonly number[]
}): {
  persistenceOptions: AgentRunPersistenceOptions
  attempts: Array<{ from: string; to: string }>
  waits: number[]
} {
  const attempts: Array<{ from: string; to: string }> = []
  const waits: number[] = []
  const failures = [...options.failures]
  return {
    attempts,
    waits,
    persistenceOptions: {
      platform: 'win32',
      ...(options.retryDelaysMs ? { renameRetryDelaysMs: options.retryDelaysMs } : {}),
      wait: async (delayMs) => { waits.push(delayMs) },
      rename: async (from, to) => {
        attempts.push({ from, to })
        const code = failures.shift()
        if (code) throw Object.assign(new Error(`injected rename ${code}`), { code, syscall: 'rename' })
        await rename(from, to)
      }
    }
  }
}

async function temporaryFiles(root: string): Promise<string[]> {
  const directory = join(root, '.agent-sessions', 'runs')
  return (await readdir(directory).catch(() => [])).filter((name) => name.includes('.tmp-'))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('AgentRunPersistence atomic rename', () => {
  it('retries transient Windows rename failures and atomically replaces the complete checkpoint', async () => {
    const root = await storageRoot('transient-success')
    const target = join(root, '.agent-sessions', 'runs', 'run-transient-success.json')
    const initial = new AgentRunPersistence(root)
    await initial.writeCheckpoint(checkpoint('run-transient-success'), false)
    const controlled = deterministicRename({ failures: ['EPERM', 'EACCES', 'EBUSY'], retryDelaysMs: [1, 2, 4] })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    await expect(persistence.writeCheckpoint(checkpoint('run-transient-success', 'completed'), true))
      .resolves.toBeUndefined()

    expect(controlled.attempts).toHaveLength(4)
    expect(controlled.waits).toEqual([1, 2, 4])
    expect(await temporaryFiles(root)).toEqual([])
    await expect(readFile(target, 'utf8')).resolves.toContain('"status": "completed"')
  })

  it('fails with a typed error after the bounded retry budget and cleans the temporary file', async () => {
    const root = await storageRoot('retry-exhausted')
    const controlled = deterministicRename({ failures: Array<string>(7).fill('EBUSY') })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    await expect(persistence.writeCheckpoint(checkpoint('run-retry-exhausted'), false)).rejects.toMatchObject({
      name: 'AgentRunAtomicRenameError',
      code: 'agent_run_atomic_rename_failed',
      causeCode: 'EBUSY',
      attempts: 7,
      retryable: true,
      message: 'Atomic agent state rename failed after 7 attempts (EBUSY).'
    } satisfies Partial<AgentRunAtomicRenameError>)

    expect(controlled.attempts).toHaveLength(7)
    expect(controlled.waits).toEqual([10, 20, 40, 80, 160, 320])
    expect(await temporaryFiles(root)).toEqual([])
    await expect(readFile(join(root, '.agent-sessions', 'runs', 'run-retry-exhausted.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails a non-retryable rename error immediately and still cleans the temporary file', async () => {
    const root = await storageRoot('non-retryable')
    const controlled = deterministicRename({ failures: ['EIO'], retryDelaysMs: [1, 2, 4] })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    await expect(persistence.writeCheckpoint(checkpoint('run-non-retryable'), false)).rejects.toMatchObject({
      name: 'AgentRunAtomicRenameError',
      code: 'agent_run_atomic_rename_failed',
      causeCode: 'EIO',
      attempts: 1,
      retryable: false,
      message: 'Atomic agent state rename failed after 1 attempt (EIO).'
    } satisfies Partial<AgentRunAtomicRenameError>)

    expect(controlled.attempts).toHaveLength(1)
    expect(controlled.waits).toEqual([])
    expect(await temporaryFiles(root)).toEqual([])
  })

  it('retries transient Windows rename failures while quarantining a corrupt recovery record', async () => {
    const root = await storageRoot('quarantine-transient')
    const runsDirectory = join(root, '.agent-sessions', 'runs')
    await mkdir(runsDirectory, { recursive: true })
    await writeFile(join(runsDirectory, 'run-corrupt.json'), '{not-json', 'utf8')
    const controlled = deterministicRename({ failures: ['EPERM', 'EACCES', 'EBUSY'], retryDelaysMs: [1, 2, 4] })
    const persistence = new AgentRunPersistence(root, () => '2026-07-18T00:00:00.000Z', controlled.persistenceOptions)

    await expect(persistence.readCheckpoint('run-corrupt')).rejects.toThrow('Agent state record is corrupt or unsupported')

    expect(controlled.attempts).toHaveLength(4)
    expect(controlled.waits).toEqual([1, 2, 4])
    expect(await readdir(runsDirectory)).toEqual(['run-corrupt.json.corrupt-20260718000000000'])
  })

  it('protects an existing record without staging or renaming a replacement', async () => {
    const root = await storageRoot('existing-record')
    const initial = new AgentRunPersistence(root)
    await initial.writeCheckpoint(checkpoint('run-existing'), false)
    const original = await readFile(join(root, '.agent-sessions', 'runs', 'run-existing.json'), 'utf8')
    const controlled = deterministicRename({ failures: [] })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    await expect(persistence.writeCheckpoint(checkpoint('run-existing', 'completed'), false))
      .rejects.toThrow('Agent state record already exists.')

    expect(controlled.attempts).toEqual([])
    expect(await temporaryFiles(root)).toEqual([])
    await expect(readFile(join(root, '.agent-sessions', 'runs', 'run-existing.json'), 'utf8')).resolves.toBe(original)
  })
})
