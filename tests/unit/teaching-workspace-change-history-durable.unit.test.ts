import { mkdir, open as openFile, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import {
  MAX_WORKSPACE_CHANGE_HISTORY_ENTRIES,
  TeachingWorkspaceChangeHistoryStore
} from '../../src/main/teaching-workspace-change-history'
import type { TeachingWorkspaceChangeSummary } from '../../src/shared/teaching-types'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()
const DIRECTORY_FSYNC_WARNING = '[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'

type RecordedOperation = { event: string; mode?: number }
type RecordingDurableOperations = { operations: DurableFileOperations; recorded: RecordedOperation[] }

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function recordingOperations(options: {
  fail?: (event: string) => Error | undefined
} = {}): RecordingDurableOperations {
  const recorded: RecordedOperation[] = []
  const observe = (event: string, mode?: number) => {
    recorded.push({ event, mode })
    const failure = options.fail?.(event)
    if (failure) throw failure
  }
  return {
    recorded,
    operations: {
      mkdir,
      readFile,
      open: async (path, flags, mode) => {
        observe(`open:${flags}:${path}`, mode)
        const handle = await openFile(path, flags, mode)
        return {
          writeFile: async (content) => {
            observe(`write:${path}`)
            await handle.writeFile(content)
          },
          sync: async () => {
            observe(`sync:${path}`)
            await handle.sync()
          },
          close: async () => {
            recorded.push({ event: `close:${path}` })
            const failure = options.fail?.(`close:${path}`)
            await handle.close()
            if (failure) throw failure
          }
        }
      },
      rename: async (from, to) => {
        observe(`rename:${from}->${to}`)
        await rename(from, to)
      },
      rm
    }
  }
}

function summary(id: string, timestamp = `2026-07-18T00:00:${id.padStart(2, '0')}.000Z`): TeachingWorkspaceChangeSummary {
  return {
    id,
    workspaceId: 'workspace-a',
    timestamp,
    trigger: { kind: 'mission_update', label: 'Updated mission' },
    changedFiles: [{
      relativePath: 'MISSION.md', status: 'modified', fileKind: 'mission', additions: 1, deletions: 0, diffAvailable: true
    }],
    additions: 1,
    deletions: 0,
    summary: `Changed ${id}`,
    git: { available: false, reason: 'not_git_repo' }
  }
}

async function fixture(
  label: string,
  operations: DurableFileOperations,
  options: { maxEntriesPerWorkspace?: number; durableWarn?: (message: string) => void } = {}
) {
  const runtime = await runtimeScope.create(label)
  const historyPath = join(runtime.paths.appData, 'learning-changes', 'history.json')
  return {
    historyPath,
    store: new TeachingWorkspaceChangeHistoryStore({
      filePath: historyPath,
      maxEntriesPerWorkspace: options.maxEntriesPerWorkspace,
      durableFileOperations: operations,
      durableWarn: options.durableWarn
    })
  }
}

async function temporaryCandidates(historyPath: string): Promise<string[]> {
  return (await readdir(dirname(historyPath))).filter((entry) =>
    entry.startsWith(`.${basename(historyPath)}.`) && entry.endsWith('.tmp'))
}

describe('TeachingWorkspaceChangeHistoryStore durable history publication', () => {
  it('durably publishes formatted history, retains the legacy mode, and reloads it', async () => {
    const fake = recordingOperations()
    const { historyPath, store } = await fixture('change-history-durable-success', fake.operations)

    await expect(store.append('workspace-a', summary('one'))).resolves.toMatchObject({ id: 'one' })

    const content = await readFile(historyPath, 'utf8')
    expect(content).toBe(`${JSON.stringify({ version: 1, workspaces: { 'workspace-a': [summary('one')] } }, null, 2)}\n`)
    await expect(new TeachingWorkspaceChangeHistoryStore({ filePath: historyPath }).list('workspace-a'))
      .resolves.toEqual([summary('one')])
    expect((await stat(historyPath)).mode & 0o777).toBe(0o666 & ~process.umask() & 0o777)
    expect(Object.keys(JSON.parse(content) as Record<string, unknown>)).toEqual(['version', 'workspaces'])

    const temporaryPath = fake.recorded.find(({ event }) => event.startsWith('open:wx:'))?.event.slice('open:wx:'.length)
    expect(temporaryPath).toBeDefined()
    const path = temporaryPath!
    const order = (event: string) => fake.recorded.findIndex((record) => record.event === event)
    const parent = dirname(historyPath)
    expect(order(`write:${path}`)).toBeLessThan(order(`sync:${path}`))
    expect(order(`sync:${path}`)).toBeLessThan(order(`close:${path}`))
    expect(order(`close:${path}`)).toBeLessThan(order(`rename:${path}->${historyPath}`))
    expect(order(`rename:${path}->${historyPath}`)).toBeLessThan(order(`sync:${parent}`))
    expect(order(`sync:${parent}`)).toBeLessThan(order(`close:${parent}`))
    expect(fake.recorded).toContainEqual({ event: `open:wx:${path}`, mode: 0o666 })
    await expect(temporaryCandidates(historyPath)).resolves.toEqual([])
  })

  it.each([
    ['write', (event: string, historyPath: string) => event.startsWith('write:') && event.includes(`.${basename(historyPath)}.`)],
    ['file sync', (event: string, historyPath: string) => event.startsWith('sync:') && event.includes(`.${basename(historyPath)}.`)],
    ['file close', (event: string, historyPath: string) => event.startsWith('close:') && event.includes(`.${basename(historyPath)}.`)],
    ['rename', (event: string, historyPath: string) => event.startsWith('rename:') && event.endsWith(`->${historyPath}`)]
  ])('fails closed before publication when %s fails', async (_name, matches) => {
    let matcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => matcher(event) })
    const { historyPath, store } = await fixture(`change-history-pre-${_name}`, fake.operations)
    await mkdir(dirname(historyPath), { recursive: true })
    const oldContent = '{"legacy":"history"}\n'
    await writeFile(historyPath, oldContent, { mode: 0o666 })
    const failure = errno('EIO')
    matcher = (event) => matches(event, historyPath) ? failure : undefined

    await expect(store.append('workspace-a', summary('one'))).rejects.toBe(failure)
    await expect(readFile(historyPath, 'utf8')).resolves.toBe(oldContent)
    await expect(temporaryCandidates(historyPath)).resolves.toEqual([])
  })

  it.each([
    ['EIO', errno('EIO')],
    ['EACCES', errno('EACCES')],
    ['EPERM', errno('EPERM')],
    ['unknown error', new Error('unexpected directory failure')]
  ])('does not downgrade directory fsync %s after rename', async (_name, failure) => {
    let matcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => matcher(event) })
    const { historyPath, store } = await fixture(`change-history-dir-${_name}`, fake.operations)
    await mkdir(dirname(historyPath), { recursive: true })
    await writeFile(historyPath, '{"old":true}\n')
    matcher = (event) => event === `sync:${dirname(historyPath)}` ? failure : undefined

    await expect(store.append('workspace-a', summary('one'))).rejects.toBe(failure)
    await expect(readFile(historyPath, 'utf8')).resolves.toBe(`${JSON.stringify({ version: 1, workspaces: { 'workspace-a': [summary('one')] } }, null, 2)}\n`)
    await expect(temporaryCandidates(historyPath)).resolves.toEqual([])
  })

  it('fails closed after rename when closing the directory fails', async () => {
    let matcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => matcher(event) })
    const { historyPath, store } = await fixture('change-history-dir-close', fake.operations)
    matcher = (event) => event === `close:${dirname(historyPath)}` ? errno('EIO') : undefined

    await expect(store.append('workspace-a', summary('one'))).rejects.toMatchObject({ code: 'EIO' })
    await expect(store.list('workspace-a')).resolves.toEqual([summary('one')])
    await expect(temporaryCandidates(historyPath)).resolves.toEqual([])
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'permits only the shared directory-fsync capability downgrade (%s)',
    async (code) => {
      let matcher: (event: string) => Error | undefined = () => undefined
      const warnings: string[] = []
      const fake = recordingOperations({ fail: (event) => matcher(event) })
      const { historyPath, store } = await fixture(`change-history-allowlist-${code}`, fake.operations, {
        durableWarn: (message) => warnings.push(message)
      })
      matcher = (event) => event === `sync:${dirname(historyPath)}` ? errno(code) : undefined

      await expect(store.append('workspace-a', summary('one'))).resolves.toEqual(summary('one'))
      expect(warnings).toEqual([DIRECTORY_FSYNC_WARNING])
      expect(warnings[0]).not.toContain(historyPath)
      await expect(temporaryCandidates(historyPath)).resolves.toEqual([])
    }
  )

  it('keeps tolerant reads, the default per-workspace 20-entry limit, and serialized appends', async () => {
    const fake = recordingOperations()
    const { historyPath, store } = await fixture('change-history-compatible-serial', fake.operations)
    await mkdir(dirname(historyPath), { recursive: true })
    await writeFile(historyPath, '{not json')
    await expect(store.list('workspace-a')).resolves.toEqual([])

    await Promise.all(Array.from({ length: MAX_WORKSPACE_CHANGE_HISTORY_ENTRIES + 1 }, async (_, index) => {
      const numeric = index + 1
      return store.append('workspace-a', summary(`${numeric}`, `2026-07-18T00:${String(numeric).padStart(2, '0')}.000Z`))
    }))

    const entries = await store.list('workspace-a')
    expect(entries).toHaveLength(MAX_WORKSPACE_CHANGE_HISTORY_ENTRIES)
    expect(entries.map((entry) => entry.id)).toEqual(
      Array.from({ length: MAX_WORKSPACE_CHANGE_HISTORY_ENTRIES }, (_, index) => String(MAX_WORKSPACE_CHANGE_HISTORY_ENTRIES + 1 - index))
    )
    expect(new Set(entries.map((entry) => entry.id))).toHaveLength(MAX_WORKSPACE_CHANGE_HISTORY_ENTRIES)
    const content = JSON.parse(await readFile(historyPath, 'utf8')) as Record<string, unknown>
    expect(content).toEqual({ version: 1, workspaces: { 'workspace-a': entries } })
    expect(JSON.stringify(content)).not.toContain('traceId')
    expect(JSON.stringify(content)).not.toContain('actionId')
    expect(JSON.stringify(content)).not.toContain('receipt')
  })
})
