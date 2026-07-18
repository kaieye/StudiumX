import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  AgentRunAtomicRenameError,
  AgentRunAtomicSyncError,
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

function deterministicIo(options: {
  renameFailures?: string[]
  syncFailures?: string[]
  retryDelaysMs?: readonly number[]
}): {
  persistenceOptions: AgentRunPersistenceOptions
  renameAttempts: Array<{ from: string; to: string }>
  syncAttempts: string[]
  waits: number[]
} {
  const renameAttempts: Array<{ from: string; to: string }> = []
  const syncAttempts: string[] = []
  const waits: number[] = []
  const renameFailures = [...(options.renameFailures ?? [])]
  const syncFailures = [...(options.syncFailures ?? [])]
  return {
    renameAttempts,
    syncAttempts,
    waits,
    persistenceOptions: {
      platform: 'win32',
      ...(options.retryDelaysMs ? { renameRetryDelaysMs: options.retryDelaysMs } : {}),
      wait: async (delayMs) => { waits.push(delayMs) },
      rename: async (from, to) => {
        renameAttempts.push({ from, to })
        const code = renameFailures.shift()
        if (code) throw Object.assign(new Error(`injected rename ${code}`), { code, syscall: 'rename' })
        await rename(from, to)
      },
      syncFile: async (path) => {
        syncAttempts.push(path)
        const code = syncFailures.shift()
        if (code) throw Object.assign(new Error(`injected sync ${code}`), { code, syscall: 'fsync' })
      }
    }
  }
}

async function temporaryFiles(root: string): Promise<string[]> {
  const directory = join(root, '.agent-sessions', 'runs')
  return (await readdir(directory).catch(() => [])).filter((name) => name.includes('.tmp-'))
}

function enumerableOwnKeys(value: object): string[] {
  return Reflect.ownKeys(value).filter((key): key is string => typeof key === 'string' && Object.prototype.propertyIsEnumerable.call(value, key)).sort()
}

function assertPathSafeError(error: Error, absoluteRoot: string): void {
  expect(error.message).not.toContain(absoluteRoot)
  expect(error.message).not.toMatch(/[A-Za-z]:\\/)
  expect(JSON.stringify(error)).not.toContain(absoluteRoot)
  expect(JSON.stringify(error)).not.toMatch(/[A-Za-z]:\\/)
  for (const key of enumerableOwnKeys(error)) {
    const value = (error as Record<string, unknown>)[key]
    if (typeof value === 'string') {
      expect(value).not.toContain(absoluteRoot)
      expect(value).not.toMatch(/[A-Za-z]:\\/)
    }
  }
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
    const controlled = deterministicIo({ renameFailures: ['EPERM', 'EACCES', 'EBUSY'], retryDelaysMs: [1, 2, 4] })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    await expect(persistence.writeCheckpoint(checkpoint('run-transient-success', 'completed'), true))
      .resolves.toBeUndefined()

    expect(controlled.renameAttempts).toHaveLength(4)
    expect(controlled.waits).toEqual([1, 2, 4])
    expect(await temporaryFiles(root)).toEqual([])
    await expect(readFile(target, 'utf8')).resolves.toContain('"status": "completed"')
  })

  it('fails with a typed error after the bounded retry budget and cleans the temporary file', async () => {
    const root = await storageRoot('retry-exhausted')
    const controlled = deterministicIo({ renameFailures: Array<string>(7).fill('EBUSY') })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    const rejection = persistence.writeCheckpoint(checkpoint('run-retry-exhausted'), false)
    await expect(rejection).rejects.toMatchObject({
      name: 'AgentRunAtomicRenameError',
      code: 'agent_run_atomic_rename_failed',
      causeCode: 'EBUSY',
      attempts: 7,
      retryable: true,
      message: 'Atomic agent state rename failed after 7 attempts (EBUSY).'
    } satisfies Partial<AgentRunAtomicRenameError>)

    const error = await rejection.catch((value) => value as AgentRunAtomicRenameError)
    assertPathSafeError(error, root)
    expect(enumerableOwnKeys(error)).not.toContain('sourcePath')
    expect(enumerableOwnKeys(error)).not.toContain('destinationPath')
    expect(enumerableOwnKeys(error)).not.toContain('cause')
    expect(error.sourcePath).toContain('run-retry-exhausted.json.tmp-')
    expect(error.destinationPath).toContain('run-retry-exhausted.json')

    expect(controlled.renameAttempts).toHaveLength(7)
    expect(controlled.waits).toEqual([10, 20, 40, 80, 160, 320])
    expect(await temporaryFiles(root)).toEqual([])
    await expect(readFile(join(root, '.agent-sessions', 'runs', 'run-retry-exhausted.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails a non-retryable rename error immediately and still cleans the temporary file', async () => {
    const root = await storageRoot('non-retryable')
    const controlled = deterministicIo({ renameFailures: ['EIO'], retryDelaysMs: [1, 2, 4] })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    const rejection = persistence.writeCheckpoint(checkpoint('run-non-retryable'), false)
    await expect(rejection).rejects.toMatchObject({
      name: 'AgentRunAtomicRenameError',
      code: 'agent_run_atomic_rename_failed',
      causeCode: 'EIO',
      attempts: 1,
      retryable: false,
      message: 'Atomic agent state rename failed after 1 attempt (EIO).'
    } satisfies Partial<AgentRunAtomicRenameError>)

    const error = await rejection.catch((value) => value as AgentRunAtomicRenameError)
    assertPathSafeError(error, root)

    expect(controlled.renameAttempts).toHaveLength(1)
    expect(controlled.waits).toEqual([])
    expect(await temporaryFiles(root)).toEqual([])
  })

  it('retries transient Windows rename failures while quarantining a corrupt recovery record', async () => {
    const root = await storageRoot('quarantine-transient')
    const runsDirectory = join(root, '.agent-sessions', 'runs')
    await mkdir(runsDirectory, { recursive: true })
    await writeFile(join(runsDirectory, 'run-corrupt.json'), '{not-json', 'utf8')
    const controlled = deterministicIo({ renameFailures: ['EPERM', 'EACCES', 'EBUSY'], retryDelaysMs: [1, 2, 4] })
    const persistence = new AgentRunPersistence(root, () => '2026-07-18T00:00:00.000Z', controlled.persistenceOptions)

    await expect(persistence.readCheckpoint('run-corrupt')).rejects.toThrow('Agent state record is corrupt or unsupported')

    expect(controlled.renameAttempts).toHaveLength(4)
    expect(controlled.waits).toEqual([1, 2, 4])
    expect(await readdir(runsDirectory)).toEqual(['run-corrupt.json.corrupt-20260718000000000'])
  })

  it('keeps the corrupt diagnostic when quarantine rename retries are exhausted', async () => {
    const root = await storageRoot('quarantine-exhausted')
    const runsDirectory = join(root, '.agent-sessions', 'runs')
    await mkdir(runsDirectory, { recursive: true })
    await writeFile(join(runsDirectory, 'run-corrupt-stuck.json'), '{not-json', 'utf8')
    const controlled = deterministicIo({
      renameFailures: Array<string>(7).fill('EBUSY'),
      retryDelaysMs: [1, 2, 4, 8, 16, 32]
    })
    const persistence = new AgentRunPersistence(root, () => '2026-07-18T00:00:00.000Z', controlled.persistenceOptions)

    const rejection = persistence.readCheckpoint('run-corrupt-stuck')
    await expect(rejection).rejects.toThrow(/Agent state record is corrupt or unsupported/)
    await expect(rejection).rejects.not.toBeInstanceOf(AgentRunAtomicRenameError)

    const error = await rejection.catch((value) => value as Error)
    expect(error.message).toMatch(/Agent state record is corrupt or unsupported/)
    expect(error.message).not.toMatch(/Atomic agent state rename failed/)
    assertPathSafeError(error, root)

    // Internal cause preserves the typed rename failure without making it the public diagnostic.
    const internal = (error as Error & { cause?: unknown }).cause
    expect(internal).toBeInstanceOf(AgentRunAtomicRenameError)
    expect(internal).toMatchObject({
      name: 'AgentRunAtomicRenameError',
      code: 'agent_run_atomic_rename_failed',
      causeCode: 'EBUSY',
      attempts: 7,
      retryable: true
    })
    assertPathSafeError(internal as AgentRunAtomicRenameError, root)

    expect(controlled.renameAttempts).toHaveLength(7)
    expect(controlled.waits).toEqual([1, 2, 4, 8, 16, 32])
    // Original corrupt file remains when quarantine rename cannot complete.
    expect(await readdir(runsDirectory)).toEqual(['run-corrupt-stuck.json'])
  })

  it('protects an existing record without staging or renaming a replacement', async () => {
    const root = await storageRoot('existing-record')
    const initial = new AgentRunPersistence(root)
    await initial.writeCheckpoint(checkpoint('run-existing'), false)
    const original = await readFile(join(root, '.agent-sessions', 'runs', 'run-existing.json'), 'utf8')
    const controlled = deterministicIo({ renameFailures: [] })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    await expect(persistence.writeCheckpoint(checkpoint('run-existing', 'completed'), false))
      .rejects.toThrow('Agent state record already exists.')

    expect(controlled.renameAttempts).toEqual([])
    expect(controlled.syncAttempts).toEqual([])
    expect(await temporaryFiles(root)).toEqual([])
    await expect(readFile(join(root, '.agent-sessions', 'runs', 'run-existing.json'), 'utf8')).resolves.toBe(original)
  })
})

describe('AgentRunPersistence atomic temp-file sync', () => {
  it('retries transient Windows temp-file sync failures then renames successfully', async () => {
    const root = await storageRoot('sync-transient-success')
    const controlled = deterministicIo({
      syncFailures: ['EPERM', 'EACCES', 'EBUSY'],
      retryDelaysMs: [1, 2, 4]
    })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    await expect(persistence.writeCheckpoint(checkpoint('run-sync-success'), false)).resolves.toBeUndefined()

    expect(controlled.syncAttempts).toHaveLength(4)
    expect(controlled.renameAttempts).toHaveLength(1)
    expect(controlled.waits).toEqual([1, 2, 4])
    expect(await temporaryFiles(root)).toEqual([])
    await expect(readFile(join(root, '.agent-sessions', 'runs', 'run-sync-success.json'), 'utf8'))
      .resolves.toContain('"status": "running"')
  })

  it('fails with a typed sync error after the bounded retry budget and cleans the temporary file', async () => {
    const root = await storageRoot('sync-retry-exhausted')
    const controlled = deterministicIo({
      syncFailures: Array<string>(7).fill('EBUSY')
    })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    const rejection = persistence.writeCheckpoint(checkpoint('run-sync-exhausted'), false)
    await expect(rejection).rejects.toMatchObject({
      name: 'AgentRunAtomicSyncError',
      code: 'agent_run_atomic_sync_failed',
      causeCode: 'EBUSY',
      attempts: 7,
      retryable: true,
      message: 'Atomic agent state temp-file sync failed after 7 attempts (EBUSY).'
    } satisfies Partial<AgentRunAtomicSyncError>)

    const error = await rejection.catch((value) => value as AgentRunAtomicSyncError)
    assertPathSafeError(error, root)
    expect(enumerableOwnKeys(error)).not.toContain('path')
    expect(enumerableOwnKeys(error)).not.toContain('cause')
    expect(error.path).toContain('run-sync-exhausted.json.tmp-')

    expect(controlled.syncAttempts).toHaveLength(7)
    expect(controlled.renameAttempts).toEqual([])
    expect(controlled.waits).toEqual([10, 20, 40, 80, 160, 320])
    expect(await temporaryFiles(root)).toEqual([])
    await expect(readFile(join(root, '.agent-sessions', 'runs', 'run-sync-exhausted.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails a non-retryable sync error immediately and still cleans the temporary file', async () => {
    const root = await storageRoot('sync-non-retryable')
    const controlled = deterministicIo({
      syncFailures: ['EIO'],
      retryDelaysMs: [1, 2, 4]
    })
    const persistence = new AgentRunPersistence(root, undefined, controlled.persistenceOptions)

    const rejection = persistence.writeCheckpoint(checkpoint('run-sync-non-retryable'), false)
    await expect(rejection).rejects.toMatchObject({
      name: 'AgentRunAtomicSyncError',
      code: 'agent_run_atomic_sync_failed',
      causeCode: 'EIO',
      attempts: 1,
      retryable: false,
      message: 'Atomic agent state temp-file sync failed after 1 attempt (EIO).'
    } satisfies Partial<AgentRunAtomicSyncError>)

    const error = await rejection.catch((value) => value as AgentRunAtomicSyncError)
    assertPathSafeError(error, root)

    expect(controlled.syncAttempts).toHaveLength(1)
    expect(controlled.renameAttempts).toEqual([])
    expect(controlled.waits).toEqual([])
    expect(await temporaryFiles(root)).toEqual([])
  })
})

describe('AgentRunPersistence typed error privacy', () => {
  it('keeps absolute paths and cause non-enumerable on rename and sync failures', async () => {
    const root = await storageRoot('error-privacy')

    const renameControlled = deterministicIo({ renameFailures: ['EIO'], retryDelaysMs: [1] })
    const renamePersistence = new AgentRunPersistence(root, undefined, renameControlled.persistenceOptions)
    const renameError = await renamePersistence.writeCheckpoint(checkpoint('run-privacy-rename'), false)
      .catch((value) => value as AgentRunAtomicRenameError)

    expect(renameError).toBeInstanceOf(AgentRunAtomicRenameError)
    expect(Object.keys(renameError)).not.toContain('sourcePath')
    expect(Object.keys(renameError)).not.toContain('destinationPath')
    expect(Object.keys(renameError)).not.toContain('cause')
    expect(Object.keys(renameError)).toEqual(expect.arrayContaining(['name', 'code', 'causeCode', 'attempts', 'retryable']))
    const renameJson = JSON.parse(JSON.stringify(renameError)) as Record<string, unknown>
    expect(renameJson).not.toHaveProperty('sourcePath')
    expect(renameJson).not.toHaveProperty('destinationPath')
    expect(renameJson).not.toHaveProperty('cause')
    assertPathSafeError(renameError, root)
    expect(renameError.sourcePath.length).toBeGreaterThan(0)
    expect(renameError.destinationPath.length).toBeGreaterThan(0)
    expect(renameError.cause).toMatchObject({ code: 'EIO' })

    const syncControlled = deterministicIo({ syncFailures: ['EIO'], retryDelaysMs: [1] })
    const syncPersistence = new AgentRunPersistence(root, undefined, syncControlled.persistenceOptions)
    const syncError = await syncPersistence.writeCheckpoint(checkpoint('run-privacy-sync'), false)
      .catch((value) => value as AgentRunAtomicSyncError)

    expect(syncError).toBeInstanceOf(AgentRunAtomicSyncError)
    expect(Object.keys(syncError)).not.toContain('path')
    expect(Object.keys(syncError)).not.toContain('cause')
    expect(Object.keys(syncError)).toEqual(expect.arrayContaining(['name', 'code', 'causeCode', 'attempts', 'retryable']))
    const syncJson = JSON.parse(JSON.stringify(syncError)) as Record<string, unknown>
    expect(syncJson).not.toHaveProperty('path')
    expect(syncJson).not.toHaveProperty('cause')
    assertPathSafeError(syncError, root)
    expect(syncError.path.length).toBeGreaterThan(0)
    expect(syncError.cause).toMatchObject({ code: 'EIO' })
  })
})
