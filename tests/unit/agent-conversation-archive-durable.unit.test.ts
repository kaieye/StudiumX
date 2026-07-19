import { lstat, mkdir, mkdtemp, open as openFile, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { saveAgentConversationArchive } from '../../src/main/agent-conversation-archive'
import { type AgentConversationSessionAuditOperations } from '../../src/main/agent-conversation-session-audit'
import { LEARNING_WORK_LEDGER_RELATIVE_PATH } from '../../src/main/learning-work-ledger'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../../src/shared/agent-conversation-catalog'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'

const roots: string[] = []
const DIRECTORY_FSYNC_WARNING = '[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'

type InstrumentedDurableOperations = {
  operations: DurableFileOperations
  events: string[]
  modes: Array<{ path: string; mode: number | undefined }>
}

type InstrumentedSessionAuditOperations = {
  operations: AgentConversationSessionAuditOperations
  events: string[]
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function instrumentedDurableOperations(options: {
  fail?: (event: string) => Error | undefined
} = {}): InstrumentedDurableOperations {
  const events: string[] = []
  const modes: Array<{ path: string; mode: number | undefined }> = []
  const observe = (event: string): void => {
    events.push(event)
    const failure = options.fail?.(event)
    if (failure) throw failure
  }

  const operations: DurableFileOperations = {
    mkdir,
    readFile,
    open: async (path, flags, mode) => {
      observe(`open:${flags}:${path}`)
      modes.push({ path, mode })
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
        // Close the real descriptor before surfacing an injected close error so
        // the test does not leak a handle while still exercising fail-closed
        // shared-primitive semantics.
        close: async () => {
          const event = `close:${path}`
          events.push(event)
          const failure = options.fail?.(event)
          await handle.close()
          if (failure) throw failure
        }
      }
    },
    rename: async (from, to) => {
      observe(`rename:${from}->${to}`)
      await rename(from, to)
    },
    rm: async (path, options) => {
      observe(`rm:${path}`)
      await rm(path, options)
    }
  }
  return { operations, events, modes }
}

/** Injects only the session-audit durable boundary; canonical publication and
 * ledger behavior remain real archive collaborators. */
function instrumentedSessionAuditOperations(options: {
  fail?: (event: string) => Error | undefined
} = {}): InstrumentedSessionAuditOperations {
  const events: string[] = []
  const observe = (event: string): void => {
    events.push(event)
    const failure = options.fail?.(event)
    if (failure) throw failure
  }
  const operations: AgentConversationSessionAuditOperations = {
    mkdir,
    lstat: (async (path: Parameters<typeof lstat>[0], optionsArg?: Parameters<typeof lstat>[1]) => {
      observe(`lstat:${path}`)
      return optionsArg === undefined ? lstat(path) : lstat(path, optionsArg)
    }) as typeof lstat,
    open: async (path, flags: string | number, mode) => {
      observe(`open:${flags}:${path}`)
      const handle = await openFile(path, flags, mode)
      return {
        read: async (buffer, offset, length, position) => {
          observe(`read:${path}`)
          const result = await handle.read(buffer, offset, length, position)
          return { bytesRead: result.bytesRead }
        },
        write: async (buffer, offset, length, position) => {
          observe(`write:${path}`)
          const result = await handle.write(buffer, offset, length, position)
          return { bytesWritten: result.bytesWritten }
        },
        stat: async () => {
          observe(`stat:${path}`)
          return handle.stat()
        },
        sync: async () => {
          observe(`sync:${path}`)
          await handle.sync()
        },
        close: async () => {
          const event = `close:${path}`
          events.push(event)
          const failure = options.fail?.(event)
          await handle.close()
          if (failure) throw failure
        }
      }
    }
  }
  return { operations, events }
}

async function archiveFixture(): Promise<{
  rootPath: string
  workspace: { id: string; name: string; rootPath: string }
  record: AgentConversationRecord
  jsonPath: string
  markdownPath: string
  auditPath: string
  ledgerPath: string
}> {
  const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-archive-durable-'))
  roots.push(rootPath)
  const workspace = { id: 'workspace-durable', name: 'Durable Workspace', rootPath }
  const relativePath = 'conversation/2026/07/durable-conversation.md'
  const record: AgentConversationRecord = {
    id: 'durable-conversation',
    workspaceId: workspace.id,
    title: 'OAuth archive notes',
    createdAt: '2026-07-18T01:00:00.000Z',
    updatedAt: '2026-07-18T01:01:00.000Z',
    relativePath,
    absolutePath: join(rootPath, relativePath),
    traceId: '0181c818-7f8f-4b8a-aebc-12b34d56e789',
    messageCount: 2,
    turns: [
      {
        id: 'turn-1',
        role: 'user',
        content: 'Explain OAuth scopes; credential C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e is failing.',
        createdAt: '2026-07-18T01:00:00.000Z'
      },
      {
        id: 'turn-2',
        role: 'assistant',
        content: 'Scopes limit a delegated token to approved capabilities.',
        createdAt: '2026-07-18T01:01:00.000Z'
      }
    ]
  }
  return {
    rootPath,
    workspace,
    record,
    jsonPath: join(rootPath, agentConversationJsonRelativePathForMarkdown(relativePath)),
    markdownPath: join(rootPath, relativePath),
    auditPath: join(rootPath, agentConversationSessionAuditRelativePathForMarkdown(relativePath)),
    ledgerPath: join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH)
  }
}

async function temporaryFiles(rootPath: string): Promise<string[]> {
  const visit = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return visit(path)
      return entry.name.endsWith('.tmp') ? [relative(rootPath, path)] : []
    }))
    return nested.flat()
  }
  return visit(rootPath)
}

function candidatePath(events: readonly string[], canonicalPath: string): string {
  const openEvent = events.find((event) => event.startsWith(`open:wx:${join(canonicalPath, '..')}`) && event.includes(`.${canonicalPath.split('/').at(-1)}.`))
  if (!openEvent) throw new Error(`Missing durable temporary candidate for ${canonicalPath}`)
  return openEvent.slice('open:wx:'.length)
}

async function expectNoAuditOrLedger(paths: { auditPath: string; ledgerPath: string }): Promise<void> {
  await expect(readFile(paths.auditPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(paths.ledgerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
}

describe('Agent conversation archive durable canonical publication', () => {
  it('durably publishes JSON then Markdown before audit and ledger while preserving schema, trace, redaction, and create mode', async () => {
    const fixture = await archiveFixture()
    const durable = instrumentedDurableOperations()

    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      durableFileOperations: durable.operations
    })).resolves.toBeUndefined()

    const [json, markdown, audit, ledger] = await Promise.all([
      readFile(fixture.jsonPath, 'utf8'),
      readFile(fixture.markdownPath, 'utf8'),
      readFile(fixture.auditPath, 'utf8'),
      readFile(fixture.ledgerPath, 'utf8')
    ])
    const parsed = JSON.parse(json) as { version?: unknown; id?: unknown; traceId?: unknown; turns?: Array<{ content?: string }> }
    expect(parsed).toMatchObject({
      version: 1,
      id: fixture.record.id,
      workspaceId: fixture.workspace.id,
      relativePath: fixture.record.relativePath,
      traceId: fixture.record.traceId
    })
    expect(parsed.turns?.[0]?.content).toContain('Explain OAuth scopes')
    for (const output of [json, markdown, audit, ledger]) {
      expect(output).not.toContain('C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e')
    }
    expect(markdown).toContain('# OAuth archive notes')
    expect(audit).toContain(fixture.record.id)
    expect(ledger).toContain(fixture.record.id)

    const jsonCandidate = candidatePath(durable.events, fixture.jsonPath)
    const markdownCandidate = candidatePath(durable.events, fixture.markdownPath)
    const fileSyncJson = durable.events.indexOf(`sync:${jsonCandidate}`)
    const fileCloseJson = durable.events.indexOf(`close:${jsonCandidate}`)
    const renameJson = durable.events.indexOf(`rename:${jsonCandidate}->${fixture.jsonPath}`)
    const directorySyncJson = durable.events.indexOf(`sync:${join(fixture.rootPath, 'conversation/2026/07')}`)
    const directoryCloseJson = durable.events.indexOf(`close:${join(fixture.rootPath, 'conversation/2026/07')}`)
    const writeMarkdown = durable.events.indexOf(`write:${markdownCandidate}`)
    const fileSyncMarkdown = durable.events.indexOf(`sync:${markdownCandidate}`)
    const fileCloseMarkdown = durable.events.indexOf(`close:${markdownCandidate}`)
    const renameMarkdown = durable.events.indexOf(`rename:${markdownCandidate}->${fixture.markdownPath}`)
    const directorySyncMarkdown = durable.events.lastIndexOf(`sync:${join(fixture.rootPath, 'conversation/2026/07')}`)
    const directoryCloseMarkdown = durable.events.lastIndexOf(`close:${join(fixture.rootPath, 'conversation/2026/07')}`)
    expect(fileSyncJson).toBeGreaterThan(durable.events.indexOf(`write:${jsonCandidate}`))
    expect(fileCloseJson).toBeGreaterThan(fileSyncJson)
    expect(renameJson).toBeGreaterThan(fileCloseJson)
    expect(directorySyncJson).toBeGreaterThan(renameJson)
    expect(directoryCloseJson).toBeGreaterThan(directorySyncJson)
    expect(writeMarkdown).toBeGreaterThan(directoryCloseJson)
    expect(fileSyncMarkdown).toBeGreaterThan(writeMarkdown)
    expect(fileCloseMarkdown).toBeGreaterThan(fileSyncMarkdown)
    expect(renameMarkdown).toBeGreaterThan(fileCloseMarkdown)
    expect(directorySyncMarkdown).toBeGreaterThan(renameMarkdown)
    expect(directoryCloseMarkdown).toBeGreaterThan(directorySyncMarkdown)
    expect(durable.modes).toEqual(expect.arrayContaining([
      { path: jsonCandidate, mode: 0o666 },
      { path: markdownCandidate, mode: 0o666 }
    ]))
    expect(await temporaryFiles(fixture.rootPath)).toEqual([])
  })

  it.each([
    ['write', (event: string, jsonPath: string) => event.startsWith('write:') && event.includes('.durable-conversation.json.')],
    ['file sync', (event: string, jsonPath: string) => event.startsWith('sync:') && event.includes('.durable-conversation.json.')],
    ['file close', (event: string, jsonPath: string) => event.startsWith('close:') && event.includes('.durable-conversation.json.')],
    ['rename', (event: string, jsonPath: string) => event.startsWith('rename:') && event.endsWith(`->${jsonPath}`)]
  ])('fails closed before JSON publication when its durable %s step fails', async (_name, matches) => {
    const fixture = await archiveFixture()
    const oldJson = '{"legacy":"complete"}\n'
    await mkdir(join(fixture.rootPath, 'conversation/2026/07'), { recursive: true })
    await writeFile(fixture.jsonPath, oldJson, 'utf8')
    const durable = instrumentedDurableOperations({
      fail: (event) => matches(event, fixture.jsonPath) ? errno('EIO') : undefined
    })

    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      durableFileOperations: durable.operations
    })).rejects.toMatchObject({ code: 'EIO' })

    await expect(readFile(fixture.jsonPath, 'utf8')).resolves.toBe(oldJson)
    expect(durable.events.some((event) => event.includes('.durable-conversation.md.'))).toBe(false)
    await expectNoAuditOrLedger(fixture)
    expect(await temporaryFiles(fixture.rootPath)).toEqual([])
  })

  it('keeps the completed JSON publish when Markdown durable publication fails and does not append audit or ledger', async () => {
    const fixture = await archiveFixture()
    const durable = instrumentedDurableOperations({
      fail: (event) => event.startsWith('write:') && event.includes('.durable-conversation.md.') ? errno('EIO') : undefined
    })

    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      durableFileOperations: durable.operations
    })).rejects.toMatchObject({ code: 'EIO' })

    const json = await readFile(fixture.jsonPath, 'utf8')
    expect(JSON.parse(json)).toMatchObject({ id: fixture.record.id, traceId: fixture.record.traceId })
    await expect(readFile(fixture.markdownPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expectNoAuditOrLedger(fixture)
    expect(await temporaryFiles(fixture.rootPath)).toEqual([])
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'degrades only the shared directory-fsync capability error %s with a generic warning',
    async (code) => {
      const fixture = await archiveFixture()
      const warnings: string[] = []
      let failed = false
      const directoryPath = join(fixture.rootPath, 'conversation/2026/07')
      const durable = instrumentedDurableOperations({
        fail: (event) => {
          if (!failed && event === `sync:${directoryPath}`) {
            failed = true
            return errno(code)
          }
          return undefined
        }
      })

      await expect(saveAgentConversationArchive({
        workspace: fixture.workspace,
        record: fixture.record,
        durableFileOperations: durable.operations,
        durableWarn: (message) => warnings.push(message)
      })).resolves.toBeUndefined()

      expect(warnings).toEqual([DIRECTORY_FSYNC_WARNING])
      expect(warnings[0]).not.toContain(fixture.rootPath)
      await expect(readFile(fixture.jsonPath, 'utf8')).resolves.toContain(fixture.record.id)
      await expect(readFile(fixture.markdownPath, 'utf8')).resolves.toContain('OAuth archive notes')
      await expect(readFile(fixture.auditPath, 'utf8')).resolves.toContain(fixture.record.id)
      await expect(readFile(fixture.ledgerPath, 'utf8')).resolves.toContain(fixture.record.id)
      expect(await temporaryFiles(fixture.rootPath)).toEqual([])
    }
  )

  it.each([
    ['EIO', errno('EIO')],
    ['EACCES', errno('EACCES')],
    ['unknown error', new Error('unexpected directory failure')]
  ])('does not downgrade directory fsync %s or append audit or ledger', async (_name, failure) => {
    const fixture = await archiveFixture()
    const directoryPath = join(fixture.rootPath, 'conversation/2026/07')
    const durable = instrumentedDurableOperations({
      fail: (event) => event === `sync:${directoryPath}` ? failure : undefined
    })

    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      durableFileOperations: durable.operations
    })).rejects.toBe(failure)

    // Directory fsync follows rename: the JSON is complete, but the archive
    // reports no success and does not attempt a multi-file rollback.
    await expect(readFile(fixture.jsonPath, 'utf8')).resolves.toContain(fixture.record.id)
    await expect(readFile(fixture.markdownPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expectNoAuditOrLedger(fixture)
    expect(await temporaryFiles(fixture.rootPath)).toEqual([])
  })

  it('does not report success when closing the JSON directory after rename fails', async () => {
    const fixture = await archiveFixture()
    const directoryPath = join(fixture.rootPath, 'conversation/2026/07')
    const durable = instrumentedDurableOperations({
      fail: (event) => event === `close:${directoryPath}` ? errno('EIO') : undefined
    })

    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      durableFileOperations: durable.operations
    })).rejects.toMatchObject({ code: 'EIO' })

    await expect(readFile(fixture.jsonPath, 'utf8')).resolves.toContain(fixture.record.id)
    await expect(readFile(fixture.markdownPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expectNoAuditOrLedger(fixture)
    expect(await temporaryFiles(fixture.rootPath)).toEqual([])
  })

  it('blocks the ledger after a post-append audit-directory failure, then exact-dedupes the retry before ledger and final verification', async () => {
    const fixture = await archiveFixture()
    const auditDirectory = dirname(fixture.auditPath)
    const failedAudit = instrumentedSessionAuditOperations({
      fail: (event) => event === `sync:${auditDirectory}` ? errno('EIO') : undefined
    })

    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      sessionAuditOperations: failedAudit.operations
    })).rejects.toMatchObject({ code: 'EIO' })

    const auditAfterFailure = await readFile(fixture.auditPath)
    expect(auditAfterFailure.byteLength).toBeGreaterThan(0)
    await expect(readFile(fixture.ledgerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(failedAudit.events).toContain(`sync:${auditDirectory}`)

    const retryAudit = instrumentedSessionAuditOperations()
    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      sessionAuditOperations: retryAudit.operations
    })).resolves.toBeUndefined()

    expect(await readFile(fixture.auditPath)).toEqual(auditAfterFailure)
    expect(retryAudit.events).not.toContain(`write:${fixture.auditPath}`)
    await expect(readFile(fixture.ledgerPath, 'utf8')).resolves.toContain(fixture.record.id)
  })

  it('does not duplicate a successful audit when the later ledger append fails and is retried', async () => {
    const fixture = await archiveFixture()
    // The ledger's existing fixed-file validation rejects this target after
    // archive JSON, Markdown, and the durable audit append have completed.
    await mkdir(fixture.ledgerPath, { recursive: true })
    const firstAudit = instrumentedSessionAuditOperations()

    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      sessionAuditOperations: firstAudit.operations
    })).rejects.toThrow('not a regular file')

    const auditAfterLedgerFailure = await readFile(fixture.auditPath)
    expect(firstAudit.events).toContain(`write:${fixture.auditPath}`)

    await rm(fixture.ledgerPath, { recursive: true, force: true })
    const retryAudit = instrumentedSessionAuditOperations()
    await expect(saveAgentConversationArchive({
      workspace: fixture.workspace,
      record: fixture.record,
      sessionAuditOperations: retryAudit.operations
    })).resolves.toBeUndefined()

    expect(await readFile(fixture.auditPath)).toEqual(auditAfterLedgerFailure)
    expect(retryAudit.events).not.toContain(`write:${fixture.auditPath}`)
    await expect(readFile(fixture.ledgerPath, 'utf8')).resolves.toContain(fixture.record.id)
  })

})
