import { Buffer } from 'node:buffer'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open as openFile, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  appendAgentConversationSessionAuditLog,
  buildAgentConversationSessionAuditEntries,
  parseAgentConversationSessionAuditLines,
  type AgentConversationSessionAuditOperations
} from '../../src/main/agent-conversation-session-audit'
import { agentConversationSessionAuditRelativePathForMarkdown } from '../../src/shared/agent-conversation-catalog'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'

const TRACE_A_UPPER = '11111111-1111-4111-8111-111111111111'.toUpperCase()
const TRACE_A = TRACE_A_UPPER.toLowerCase()
const TRACE_B = '22222222-2222-4222-8222-222222222222'
const DIRECTORY_FSYNC_WARNING =
  '[StudiumX] Directory fsync is unsupported; durable audit append completed without directory fsync.'
const createdRoots: string[] = []

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

type InstrumentedAuditOperations = {
  operations: AgentConversationSessionAuditOperations
  events: string[]
  opens: Array<{ path: string; flags: string | number }>
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-session-audit-'))
  createdRoots.push(root)
  return root
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/**
 * Exercises the audit-only I/O seam with real temporary files. Failures occur
 * at named boundary calls, never by replacing global fs APIs.
 */
function instrumentedAuditOperations(options: {
  fail?: (event: string) => Error | undefined
  hold?: (event: string) => Promise<void> | undefined
  onEvent?: (event: string) => void
} = {}): InstrumentedAuditOperations {
  const events: string[] = []
  const opens: Array<{ path: string; flags: string | number }> = []
  const observe = async (event: string): Promise<void> => {
    events.push(event)
    options.onEvent?.(event)
    await options.hold?.(event)
    const failure = options.fail?.(event)
    if (failure) throw failure
  }

  const operations: AgentConversationSessionAuditOperations = {
    mkdir,
    lstat: (async (path: Parameters<typeof lstat>[0], optionsArg?: Parameters<typeof lstat>[1]) => {
      await observe(`lstat:${path}`)
      return optionsArg === undefined ? lstat(path) : lstat(path, optionsArg)
    }) as typeof lstat,
    open: async (path, flags: string | number, mode) => {
      opens.push({ path, flags })
      await observe(`open:${flags}:${path}`)
      const handle = await openFile(path, flags, mode)
      return {
        read: async (buffer, offset, length, position) => {
          await observe(`read:${path}`)
          const result = await handle.read(buffer, offset, length, position)
          return { bytesRead: result.bytesRead }
        },
        write: async (buffer, offset, length, position) => {
          await observe(`write:${path}`)
          const result = await handle.write(buffer, offset, length, position)
          return { bytesWritten: result.bytesWritten }
        },
        stat: async () => {
          await observe(`stat:${path}`)
          return handle.stat()
        },
        sync: async () => {
          await observe(`sync:${path}`)
          await handle.sync()
        },
        // Close the real handle before surfacing a synthetic close failure so
        // tests do not leak descriptors while still asserting fail-closed I/O.
        close: async () => {
          const event = `close:${path}`
          events.push(event)
          options.onEvent?.(event)
          await options.hold?.(event)
          const failure = options.fail?.(event)
          await handle.close()
          if (failure) throw failure
        }
      }
    }
  }
  return { operations, events, opens }
}

function createRecord(input: {
  id?: string
  relativePath?: string
  traceId?: string
  turns?: AgentConversationRecord['turns']
  updatedAt?: string
} = {}): AgentConversationRecord {
  const turns = input.turns ?? [
    { id: 'turn-one', role: 'user', content: 'Initial question', createdAt: '2026-07-18T00:00:00.000Z' },
    { id: 'turn-two', role: 'assistant', content: 'Initial answer', createdAt: '2026-07-18T00:01:00.000Z' }
  ]
  const id = input.id ?? 'chat-audit-trace'
  const relativePath = input.relativePath ?? `conversation/${id}.md`
  return {
    id,
    workspaceId: 'workspace-audit-trace',
    title: 'Audit trace test',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-07-18T00:01:00.000Z',
    relativePath,
    absolutePath: `/unused/${relativePath}`,
    messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
    traceId: input.traceId,
    turns
  }
}

function auditPath(rootPath: string, record: AgentConversationRecord): string {
  return join(rootPath, agentConversationSessionAuditRelativePathForMarkdown(record.relativePath))
}

async function readAudit(rootPath: string, record: AgentConversationRecord): Promise<string> {
  return readFile(auditPath(rootPath, record), 'utf8')
}

async function appendWith(
  rootPath: string,
  record: AgentConversationRecord,
  operations: AgentConversationSessionAuditOperations,
  warn?: (message: string) => void
): Promise<string> {
  return appendAgentConversationSessionAuditLog({ rootPath, record, operations, warn })
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('agent conversation session audit durable append', () => {
  it('writes one fixed-file header, appends a continuation, exact-dedupes retries, and creates no segments', async () => {
    const root = await createRoot()
    const io = instrumentedAuditOperations()
    const initial = createRecord({ traceId: TRACE_A_UPPER })
    const initialWithoutTrace = createRecord()
    const expectedEntryIdentity = buildAgentConversationSessionAuditEntries(initialWithoutTrace)
      .map(({ type, id, parentId }) => ({ type, id, parentId }))

    await appendWith(root, initial, io.operations)
    const initialRaw = await readAudit(root, initial)
    const initialLines = parseAgentConversationSessionAuditLines(initialRaw)
    const initialEntries = initialLines.filter((line) => line.type !== 'session')
    const header = initialLines.find((line) => line.type === 'session')

    expect(header).toMatchObject({ version: 1, traceId: TRACE_A })
    expect(initialEntries).toHaveLength(expectedEntryIdentity.length)
    expect(initialEntries.map(({ type, id, parentId }) => ({ type, id, parentId }))).toEqual(expectedEntryIdentity)
    expect(initialEntries.every((entry) => entry.traceId === TRACE_A)).toBe(true)

    // Trace correlation is write-once for existing rows: a retry with TRACE_B
    // recognizes the same canonical body and does not duplicate it.
    await appendWith(root, { ...initial, traceId: TRACE_B }, io.operations)
    expect(await readAudit(root, initial)).toBe(initialRaw)

    const continuation = createRecord({
      traceId: TRACE_B,
      updatedAt: '2026-07-18T00:02:00.000Z',
      turns: [
        ...initial.turns,
        { id: 'turn-three', role: 'user', content: 'Follow-up question', createdAt: '2026-07-18T00:02:00.000Z' }
      ]
    })
    await appendWith(root, continuation, io.operations)
    const continuedLines = parseAgentConversationSessionAuditLines(await readAudit(root, continuation))
    const continuedEntries = continuedLines.filter((line) => line.type !== 'session')
    const byId = new Map(continuedEntries.map((entry) => [entry.id, entry]))

    expect(continuedLines.filter((line) => line.type === 'session')).toHaveLength(1)
    expect(continuedLines.find((line) => line.type === 'session')?.traceId).toBe(TRACE_A)
    expect(continuedEntries).toHaveLength(initialEntries.length + 1)
    expect(new Set(continuedEntries.map((entry) => entry.id)).size).toBe(continuedEntries.length)
    expect(initialEntries.every((entry) => byId.get(entry.id)?.traceId === TRACE_A)).toBe(true)
    expect(byId.get('turn:turn-three')).toMatchObject({ parentId: 'turn:turn-two', traceId: TRACE_B })

    const auditFile = auditPath(root, continuation)
    const auditDirectory = dirname(auditFile)
    const parentDirectory = dirname(auditDirectory)
    const auditTargetOpen = io.opens.find((open) => open.path === auditFile)
    expect(auditTargetOpen).toBeDefined()
    expect(typeof auditTargetOpen?.flags).toBe('number')
    expect((auditTargetOpen?.flags as number) & fsConstants.O_NOFOLLOW).toBe(fsConstants.O_NOFOLLOW)
    expect(io.opens.filter((open) => open.path === auditDirectory || open.path === parentDirectory))
      .toEqual(expect.arrayContaining([
        { path: auditDirectory, flags: 'r' },
        { path: parentDirectory, flags: 'r' }
      ]))
    expect(await readdir(auditDirectory)).toEqual([`${continuation.id}.jsonl`])
    expect(io.events.some((event) => event.includes('.sealed-'))).toBe(false)
  })

  it('linearizes same-path initial/continuation saves but does not globally block a different audit path', async () => {
    const root = await createRoot()
    const initial = createRecord()
    const continuation = createRecord({
      updatedAt: '2026-07-18T00:02:00.000Z',
      turns: [...initial.turns, { id: 'turn-three', role: 'assistant', content: 'Later', createdAt: '2026-07-18T00:02:00.000Z' }]
    })
    const other = createRecord({ id: 'chat-audit-other' })
    const firstStatStarted = deferred()
    const releaseFirstStat = deferred()
    const initialPath = auditPath(root, initial)
    let held = false
    const io = instrumentedAuditOperations({
      onEvent: (event) => {
        if (event === `stat:${initialPath}` && !held) firstStatStarted.resolve()
      },
      hold: (event) => {
        if (event === `stat:${initialPath}` && !held) {
          held = true
          return releaseFirstStat.promise
        }
        return undefined
      }
    })

    const first = appendWith(root, initial, io.operations)
    await firstStatStarted.promise
    const second = appendWith(root, continuation, io.operations)
    await Promise.resolve()
    await Promise.resolve()
    expect(io.opens.filter((open) => open.path === initialPath)).toHaveLength(1)

    await expect(appendWith(root, other, io.operations)).resolves.toBe(
      agentConversationSessionAuditRelativePathForMarkdown(other.relativePath)
    )
    releaseFirstStat.resolve()
    await Promise.all([first, second])

    const lines = parseAgentConversationSessionAuditLines(await readAudit(root, initial))
    expect(lines.filter((line) => line.type === 'session')).toHaveLength(1)
    expect(lines.filter((line) => line.type !== 'session').map((line) => line.id)).toEqual([
      'turn:turn-one',
      'turn:turn-two',
      'turn:turn-three'
    ])
  })

  it('rejects a same-ID canonical-body conflict without changing existing audit bytes', async () => {
    const root = await createRoot()
    const initial = createRecord()
    const io = instrumentedAuditOperations()
    await appendWith(root, initial, io.operations)
    const before = await readFile(auditPath(root, initial))
    const conflicting = createRecord({
      turns: [{ ...initial.turns[0]!, content: 'Different canonical body' }, initial.turns[1]!]
    })

    await expect(appendWith(root, conflicting, io.operations)).rejects.toThrow('conflicts with its canonical record')
    expect(await readFile(auditPath(root, initial))).toEqual(before)
  })

  it('treats ENOENT as empty, but propagates EACCES, EIO, and unknown byte-read failures', async () => {
    const root = await createRoot()
    const record = createRecord()
    const first = instrumentedAuditOperations()
    await expect(appendWith(root, record, first.operations)).resolves.toBe(
      agentConversationSessionAuditRelativePathForMarkdown(record.relativePath)
    )

    const path = auditPath(root, record)
    const before = await readFile(path)
    for (const failure of [errno('EACCES'), errno('EIO'), new Error('unexpected audit read failure')]) {
      const io = instrumentedAuditOperations({ fail: (event) => event === `read:${path}` ? failure : undefined })
      await expect(appendWith(root, record, io.operations)).rejects.toBe(failure)
      expect(await readFile(path)).toEqual(before)
    }
  })

  it.each(['directory', 'symlink'] as const)('rejects a %s audit target before append', async (targetKind) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    await mkdir(dirname(path), { recursive: true })
    if (targetKind === 'directory') {
      await mkdir(path)
    } else {
      const target = join(root, 'other-target.jsonl')
      await writeFile(target, 'unrelated\n', 'utf8')
      await symlink(target, path)
    }
    const io = instrumentedAuditOperations()

    await expect(appendWith(root, record, io.operations)).rejects.toThrow('not a regular file')
    expect(io.events.some((event) => event === `open:a+:${path}`)).toBe(false)
  })

  it('preserves malformed newline legacy bytes, and frames every non-newline tail exactly once before missing rows', async () => {
    const cases: Array<[string, Buffer]> = [
      ['valid JSON row without a newline', Buffer.from(JSON.stringify({ type: 'legacy', id: 'ignored' }), 'utf8')],
      ['partial JSON tail', Buffer.from('{"legacy":', 'utf8')],
      ['partial UTF-8 tail', Buffer.concat([Buffer.from('{"legacy":"', 'utf8'), Buffer.from([0xe2, 0x82])])]
    ]

    for (const [name, tail] of cases) {
      const root = await createRoot()
      const record = createRecord()
      const path = auditPath(root, record)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, tail)
      const io = instrumentedAuditOperations()

      await appendWith(root, record, io.operations)
      const raw = await readFile(path)
      expect(raw.subarray(0, tail.length), name).toEqual(tail)
      expect(raw[tail.length], name).toBe(0x0a)
      expect(raw[tail.length + 1], name).toBe('{'.charCodeAt(0))
      expect(parseAgentConversationSessionAuditLines(raw.toString('utf8')).some((line) => line.id === record.id), name).toBe(true)
    }

    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const malformedNewline = Buffer.from('{"legacy": nope}\n', 'utf8')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, malformedNewline)
    const io = instrumentedAuditOperations()
    await appendWith(root, record, io.operations)
    const raw = await readFile(path)
    expect(raw.subarray(0, malformedNewline.length)).toEqual(malformedNewline)
    expect(raw[malformedNewline.length]).toBe('{'.charCodeAt(0))
  })

  it('does not add a cosmetic framing newline or rewrite bytes when an exact retry has no missing rows', async () => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const first = instrumentedAuditOperations()
    await appendWith(root, record, first.operations)
    const noFinalNewline = (await readFile(path)).subarray(0, -1)
    await writeFile(path, noFinalNewline)
    const io = instrumentedAuditOperations()

    await appendWith(root, record, io.operations)

    expect(await readFile(path)).toEqual(noFinalNewline)
    expect(io.events.some((event) => event === `write:${path}`)).toBe(false)
  })

  it.each([
    ['file write', (root: string, record: AgentConversationRecord) => `write:${auditPath(root, record)}`],
    ['file sync', (root: string, record: AgentConversationRecord) => `sync:${auditPath(root, record)}`],
    ['file close', (root: string, record: AgentConversationRecord) => `close:${auditPath(root, record)}`],
    ['audit-directory open', (root: string, record: AgentConversationRecord) => `open:r:${dirname(auditPath(root, record))}`],
    ['audit-directory sync', (root: string, record: AgentConversationRecord) => `sync:${dirname(auditPath(root, record))}`],
    ['audit-directory close', (root: string, record: AgentConversationRecord) => `close:${dirname(auditPath(root, record))}`],
    ['parent-directory open', (root: string, record: AgentConversationRecord) => `open:r:${dirname(dirname(auditPath(root, record)))}`],
    ['parent-directory sync', (root: string, record: AgentConversationRecord) => `sync:${dirname(dirname(auditPath(root, record)))}`],
    ['parent-directory close', (root: string, record: AgentConversationRecord) => `close:${dirname(dirname(auditPath(root, record)))}`]
  ])('fails closed for a %s failure', async (_name, eventFor) => {
    const root = await createRoot()
    const record = createRecord()
    const event = eventFor(root, record)
    const io = instrumentedAuditOperations({ fail: (candidate) => candidate === event ? errno('EIO') : undefined })

    await expect(appendWith(root, record, io.operations)).rejects.toMatchObject({ code: 'EIO' })
    expect(io.events).toContain(event)
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'downgrades only supported audit-directory fsync error %s with one generic warning',
    async (code) => {
      const root = await createRoot()
      const record = createRecord({ traceId: TRACE_A })
      const warnings: string[] = []
      const directory = dirname(auditPath(root, record))
      let failed = false
      const io = instrumentedAuditOperations({
        fail: (event) => {
          if (!failed && event === `sync:${directory}`) {
            failed = true
            return errno(code)
          }
          return undefined
        }
      })

      await expect(appendWith(root, record, io.operations, (message) => warnings.push(message))).resolves.toBeDefined()
      expect(warnings).toEqual([DIRECTORY_FSYNC_WARNING])
      expect(warnings[0]).not.toContain(root)
      expect(warnings[0]).not.toContain(record.id)
      expect(warnings[0]).not.toContain(TRACE_A)
    }
  )

  it.each([
    ['EACCES', errno('EACCES')],
    ['EPERM', errno('EPERM')],
    ['EIO', errno('EIO')],
    ['unknown error', new Error('unexpected directory fsync failure')]
  ])('does not downgrade fatal directory sync %s', async (_name, failure) => {
    const root = await createRoot()
    const record = createRecord()
    const directory = dirname(auditPath(root, record))
    const warnings: string[] = []
    const io = instrumentedAuditOperations({ fail: (event) => event === `sync:${directory}` ? failure : undefined })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message))).rejects.toBe(failure)
    expect(warnings).toEqual([])
  })

  it('treats every directory close failure as fatal, including an otherwise-downgradeable code', async () => {
    const root = await createRoot()
    const record = createRecord()
    const directory = dirname(auditPath(root, record))
    const io = instrumentedAuditOperations({
      fail: (event) => event === `close:${directory}` ? errno('EINVAL') : undefined
    })

    await expect(appendWith(root, record, io.operations)).rejects.toMatchObject({ code: 'EINVAL' })
  })

  it('tolerates legacy trace-free and malformed rows without backfilling or rewriting them', async () => {
    const root = await createRoot()
    const initial = createRecord()
    const continued = createRecord({
      traceId: TRACE_B,
      updatedAt: '2026-07-18T00:02:00.000Z',
      turns: [
        initial.turns[0]!,
        { id: 'turn-three', role: 'assistant', content: 'New durable entry', createdAt: '2026-07-18T00:02:00.000Z' }
      ]
    })
    const path = auditPath(root, initial)
    const legacy = [
      JSON.stringify({
        type: 'session',
        version: 1,
        id: initial.id,
        title: initial.title,
        createdAt: initial.createdAt,
        conversationRelativePath: initial.relativePath
      }),
      JSON.stringify({
        type: 'turn',
        id: 'turn:turn-one',
        parentId: null,
        timestamp: initial.turns[0]!.createdAt,
        turnId: 'turn-one',
        role: 'user',
        contentPreview: 'Initial question',
        contentBytes: 16,
        toolCallCount: 0,
        processEventCount: 0,
        traceId: 'Bearer historical-audit-secret'
      })
    ].join('\n') + '\n'
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, legacy, 'utf8')
    const io = instrumentedAuditOperations()

    await appendWith(root, continued, io.operations)
    const raw = await readAudit(root, continued)
    const lines = parseAgentConversationSessionAuditLines(raw)

    expect(raw.startsWith(legacy)).toBe(true)
    expect(lines.find((line) => line.type === 'session')?.traceId).toBeUndefined()
    expect(lines.find((line) => line.id === 'turn:turn-one')?.traceId).toBe('Bearer historical-audit-secret')
    expect(lines.find((line) => line.id === 'turn:turn-three')).toMatchObject({ traceId: TRACE_B })
  })

  it.each([
    'not-a-uuid',
    'Bearer audit-secret-value',
    'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
  ])('omits malformed or secret-like trace input from raw JSONL (%s)', async (traceId) => {
    const root = await createRoot()
    const record = createRecord({ traceId })
    const io = instrumentedAuditOperations()

    await appendWith(root, record, io.operations)
    const raw = await readAudit(root, record)
    const lines = parseAgentConversationSessionAuditLines(raw)

    expect(raw).not.toContain(traceId)
    expect(lines.every((line) => line.traceId === undefined)).toBe(true)
  })
})
