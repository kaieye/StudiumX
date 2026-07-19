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

type AuditWritePlan = (input: {
  path: string
  bytes: Buffer
  writeCall: number
}) => { bytesWritten?: number; failure?: Error } | undefined

type AuditReadPlan = (input: {
  path: string
  readCall: number
}) => { bytesRead?: number; failure?: Error } | undefined

type InstrumentedAuditOperations = {
  operations: AgentConversationSessionAuditOperations
  events: string[]
  opens: Array<{ path: string; flags: string | number }>
  writtenBuffers: Buffer[]
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
  writePlan?: AuditWritePlan
  readPlan?: AuditReadPlan
  /** Test-only post-open handle.stat residual injection. */
  statPlan?: (input: { path: string; statCall: number }) => { failure?: Error; isFile?: boolean } | undefined
} = {}): InstrumentedAuditOperations {
  const events: string[] = []
  const opens: Array<{ path: string; flags: string | number }> = []
  const writtenBuffers: Buffer[] = []
  let writeCall = 0
  let readCall = 0
  let statCall = 0
  const observe = async (event: string): Promise<void> => {
    events.push(event)
    options.onEvent?.(event)
    await options.hold?.(event)
    const failure = options.fail?.(event)
    if (failure) throw failure
  }

  const operations: AgentConversationSessionAuditOperations = {
    mkdir: (async (path: Parameters<typeof mkdir>[0], optionsArg?: Parameters<typeof mkdir>[1]) => {
      await observe(`mkdir:${path}`)
      return optionsArg === undefined ? mkdir(path) : mkdir(path, optionsArg)
    }) as typeof mkdir,
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
          const plan = options.readPlan?.({
            path,
            readCall: readCall++
          })
          if (plan?.failure) throw plan.failure
          // Synthetic incomplete/non-integer counts exercise fail-closed transfer
          // residuals without needing production seams beyond the I/O handle.
          if (plan?.bytesRead !== undefined && (!Number.isInteger(plan.bytesRead) || plan.bytesRead <= 0)) {
            return { bytesRead: plan.bytesRead }
          }
          const readLength = plan?.bytesRead === undefined ? length : Math.min(length, plan.bytesRead)
          const result = await handle.read(buffer, offset, readLength, position)
          return { bytesRead: result.bytesRead }
        },
        write: async (buffer, offset, length, position) => {
          await observe(`write:${path}`)
          const plan = options.writePlan?.({
            path,
            bytes: Buffer.from(buffer.subarray(offset, offset + length)),
            writeCall: writeCall++
          })
          if (plan?.failure) throw plan.failure
          // Return non-progressing/invalid counts as-is so incomplete-write
          // residuals match production writeAllAuditBytes checks.
          if (plan?.bytesWritten !== undefined && (!Number.isInteger(plan.bytesWritten) || plan.bytesWritten <= 0)) {
            return { bytesWritten: plan.bytesWritten }
          }
          const writeLength = Math.min(length, plan?.bytesWritten ?? length)
          const result = await handle.write(buffer, offset, writeLength, position)
          writtenBuffers.push(Buffer.from(buffer.subarray(offset, offset + result.bytesWritten)))
          return { bytesWritten: result.bytesWritten }
        },
        stat: async () => {
          await observe(`stat:${path}`)
          const plan = options.statPlan?.({
            path,
            statCall: statCall++
          })
          if (plan?.failure) throw plan.failure
          const info = await handle.stat()
          // Synthetic non-file openedInfo exercises the post-open isFile gate
          // without replacing global fs or requiring native non-file descriptors.
          if (plan?.isFile === false) {
            return {
              ...info,
              isFile: () => false,
              isDirectory: () => true,
              isSymbolicLink: () => false
            }
          }
          return info
        },
        sync: async () => {
          await observe(`sync:${path}`)
          // Windows cannot fsync directory handles. The production primitive
          // downgrades that native capability gap; retain injected faults above.
          if (process.platform === 'win32' && (await handle.stat()).isDirectory()) return
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
  return { operations, events, opens, writtenBuffers }
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
    if (fsConstants.O_NOFOLLOW !== undefined) {
      expect((auditTargetOpen?.flags as number) & fsConstants.O_NOFOLLOW).toBe(fsConstants.O_NOFOLLOW)
    }
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

  it('linearizes concurrent identical same-save appends without duplicate header or entry rows', async () => {
    const root = await createRoot()
    const record = createRecord()
    const auditFile = auditPath(root, record)
    const firstStatStarted = deferred()
    const releaseFirstStat = deferred()
    let held = false
    const io = instrumentedAuditOperations({
      onEvent: (event) => {
        if (event === `stat:${auditFile}` && !held) firstStatStarted.resolve()
      },
      hold: (event) => {
        if (event === `stat:${auditFile}` && !held) {
          held = true
          return releaseFirstStat.promise
        }
        return undefined
      }
    })

    const first = appendWith(root, record, io.operations)
    await firstStatStarted.promise
    const second = appendWith(root, record, io.operations)
    // Queue must keep the second same-path open from starting while the first
    // save still owns the descriptor lifecycle.
    await Promise.resolve()
    await Promise.resolve()
    expect(io.opens.filter((open) => open.path === auditFile)).toHaveLength(1)

    releaseFirstStat.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([
      agentConversationSessionAuditRelativePathForMarkdown(record.relativePath),
      agentConversationSessionAuditRelativePathForMarkdown(record.relativePath)
    ])

    const raw = await readAudit(root, record)
    const lines = parseAgentConversationSessionAuditLines(raw)
    const entryIds = lines.filter((line) => line.type !== 'session').map((line) => line.id)
    const expectedIdentity = buildAgentConversationSessionAuditEntries(record)
      .map(({ type, id, parentId }) => ({ type, id, parentId }))

    expect(lines.filter((line) => line.type === 'session')).toHaveLength(1)
    expect(entryIds).toEqual(expectedIdentity.map((entry) => entry.id))
    expect(new Set(entryIds).size).toBe(entryIds.length)
    expect(
      lines
        .filter((line) => line.type !== 'session')
        .map(({ type, id, parentId }) => ({ type, id, parentId }))
    ).toEqual(expectedIdentity)
    // Exact bytes must match a single sequential write of the same record.
    const referenceRoot = await createRoot()
    const reference = instrumentedAuditOperations()
    await appendWith(referenceRoot, record, reference.operations)
    expect(raw).toBe(await readAudit(referenceRoot, record))
  })

  it('rejects concurrent same-ID canonical-body conflicts and preserves the queued winner bytes', async () => {
    // Directed residual evidence for the C-4P9 concurrency matrix only; this
    // is not the full C-4P9 close-out. Unlike the divergent-trace case, these
    // concurrent records have the same IDs but different canonical bodies.
    const root = await createRoot()
    const baseline = createRecord()
    const conflicting = createRecord({
      turns: [{ ...baseline.turns[0]!, content: 'Different concurrent canonical body' }, baseline.turns[1]!]
    })
    const auditFile = auditPath(root, baseline)
    const firstStatStarted = deferred()
    const releaseFirstStat = deferred()
    let held = false
    const io = instrumentedAuditOperations({
      onEvent: (event) => {
        if (event === `stat:${auditFile}` && !held) firstStatStarted.resolve()
      },
      hold: (event) => {
        if (event === `stat:${auditFile}` && !held) {
          held = true
          return releaseFirstStat.promise
        }
        return undefined
      }
    })

    const first = appendWith(root, baseline, io.operations)
    await firstStatStarted.promise
    const second = appendWith(root, conflicting, io.operations)
    // Per-path queue linearization keeps the conflicting save from opening the
    // audit file before the first descriptor lifecycle has completed.
    await Promise.resolve()
    await Promise.resolve()
    expect(io.opens.filter((open) => open.path === auditFile)).toHaveLength(1)

    releaseFirstStat.resolve()
    await expect(first).resolves.toBe(agentConversationSessionAuditRelativePathForMarkdown(baseline.relativePath))
    await expect(second).rejects.toThrow('conflicts with its canonical record')

    const raw = await readAudit(root, baseline)
    const lines = parseAgentConversationSessionAuditLines(raw)
    const entries = lines.filter((line) => line.type !== 'session')
    const referenceRoot = await createRoot()
    const reference = instrumentedAuditOperations()
    await appendWith(referenceRoot, baseline, reference.operations)

    // The successful winner is retained byte-for-byte: no mixed rows and no
    // rewrite that allows the conflicting canonical body to succeed.
    expect(raw).toBe(await readAudit(referenceRoot, baseline))
    expect(lines.filter((line) => line.type === 'session')).toHaveLength(1)
    expect(entries.filter((line) => line.id === 'turn:turn-one')).toHaveLength(1)
    expect(new Set(entries.map((line) => line.id)).size).toBe(entries.length)
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

  it('rejects on-disk same-identity rows whose traces diverge instead of treating them as exact dedupe', async () => {
    // Residual: C-5E write-once/trace conflict must fail closed. Two exact
    // non-trace bodies that differ only in traceState must not report success
    // as if exact-byte dedupe already applied.
    const root = await createRoot()
    const record = createRecord({ traceId: TRACE_A })
    const io = instrumentedAuditOperations()
    await appendWith(root, record, io.operations)
    const path = auditPath(root, record)
    const before = await readFile(path, 'utf8')
    const turnOne = parseAgentConversationSessionAuditLines(before).find((line) => line.id === 'turn:turn-one')
    expect(turnOne).toBeDefined()
    expect(turnOne?.traceId).toBe(TRACE_A)
    const poisoned = `${before}${JSON.stringify({ ...turnOne!, traceId: TRACE_B })}\n`
    await writeFile(path, poisoned, 'utf8')
    const poisonedBytes = await readFile(path)

    const writesBeforeConflict = io.events.filter((event) => event === `write:${path}`).length
    await expect(appendWith(root, record, io.operations)).rejects.toThrow(
      'Conversation session audit contains divergent duplicate records.'
    )
    expect(await readFile(path)).toEqual(poisonedBytes)
    // Fail closed before framed append: exact prior bytes stay, no rewrite, no
    // second write that would treat the divergent trace pair as exact dedupe.
    expect(io.events.filter((event) => event === `write:${path}`)).toHaveLength(writesBeforeConflict)
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
      try {
        await symlink(target, path)
      } catch (error) {
        // File symlinks require Developer Mode or elevation on many Windows
        // hosts. The paired directory case remains covered without that grant.
        if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return
        throw error
      }
    }
    const io = instrumentedAuditOperations()

    await expect(appendWith(root, record, io.operations)).rejects.toThrow('not a regular file')
    expect(io.events.some((event) => event === `open:a+:${path}`)).toBe(false)
  })

  it('fails closed without capability downgrade when post-open audit target stat reports a non-file', async () => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      statPlan: ({ path: candidate }) => candidate === path ? { isFile: false } : undefined
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toThrow('not a regular file')
    expect(io.events).toContain(`stat:${path}`)
    // open may succeed; post-open non-file must fail before read/write and directory durability.
    expect(io.events.some((event) => event === `read:${path}`)).toBe(false)
    expect(io.events.some((event) => event === `write:${path}`)).toBe(false)
    expect(io.events.some((event) => event === `open:r:${dirname(path)}`)).toBe(false)
    expect(warnings).toEqual([])
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
    ['inside the header', (canonical: Buffer) => Math.max(1, Math.floor(canonical.indexOf(0x0a) / 2)), false],
    ['after a complete header and inside the next row', (canonical: Buffer) => canonical.indexOf(0x0a) + 17, true]
  ])('preserves a partial-write prefix %s, frames its torn tail, and retries only missing canonical rows', async (_name, cutAtFor, hasCompleteHeader) => {
    const record = createRecord({ traceId: TRACE_A })
    const referenceRoot = await createRoot()
    const reference = instrumentedAuditOperations()
    await appendWith(referenceRoot, record, reference.operations)
    const canonical = await readFile(auditPath(referenceRoot, record))
    const cutAt = cutAtFor(canonical)
    expect(cutAt).toBeGreaterThan(0)
    expect(cutAt).toBeLessThan(canonical.byteLength)

    const root = await createRoot()
    const failed = instrumentedAuditOperations({
      writePlan: ({ writeCall }) => writeCall === 0
        ? { bytesWritten: cutAt }
        : { failure: errno('EIO') }
    })

    await expect(appendWith(root, record, failed.operations)).rejects.toMatchObject({ code: 'EIO' })
    const path = auditPath(root, record)
    const failurePrefix = await readFile(path)
    expect(failurePrefix).toEqual(canonical.subarray(0, cutAt))

    const retry = instrumentedAuditOperations()
    await expect(appendWith(root, record, retry.operations)).resolves.toBeDefined()
    const retried = await readFile(path)
    const lines = parseAgentConversationSessionAuditLines(retried.toString('utf8'))
    const canonicalIds = [record.id, ...buildAgentConversationSessionAuditEntries(record).map((entry) => entry.id)]

    expect(retried.subarray(0, failurePrefix.byteLength)).toEqual(failurePrefix)
    expect(retried[failurePrefix.byteLength]).toBe(0x0a)
    for (const id of canonicalIds) {
      expect(lines.filter((line) => line.id === id)).toHaveLength(1)
    }
    expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length)
    if (hasCompleteHeader) {
      expect(Buffer.concat(retry.writtenBuffers).toString('utf8')).not.toContain('"type":"session"')
    }
  })

  it('fails before the first audit byte when the first write rejects, then cleanly retries', async () => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const first = instrumentedAuditOperations({
      writePlan: ({ writeCall }) => writeCall === 0 ? { failure: errno('EIO') } : undefined
    })

    await expect(appendWith(root, record, first.operations)).rejects.toMatchObject({ code: 'EIO' })
    await expect(readFile(path)).resolves.toEqual(Buffer.alloc(0))

    const retry = instrumentedAuditOperations()
    await appendWith(root, record, retry.operations)
    const lines = parseAgentConversationSessionAuditLines(await readAudit(root, record))
    expect(lines.map((line) => line.id)).toEqual([
      record.id,
      ...buildAgentConversationSessionAuditEntries(record).map((entry) => entry.id)
    ])
  })

  it('completes repeated short writes before syncing and closing the file and both directory boundaries', async () => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const auditDirectory = dirname(path)
    const parentDirectory = dirname(auditDirectory)
    const io = instrumentedAuditOperations({
      writePlan: ({ bytes }) => ({ bytesWritten: Math.min(11, bytes.byteLength) })
    })

    await appendWith(root, record, io.operations)

    expect(io.events.filter((event) => event === `write:${path}`).length).toBeGreaterThan(1)
    const lastWrite = io.events.lastIndexOf(`write:${path}`)
    const fileSync = io.events.indexOf(`sync:${path}`)
    const fileClose = io.events.indexOf(`close:${path}`)
    const auditOpen = io.events.indexOf(`open:r:${auditDirectory}`)
    const auditSync = io.events.indexOf(`sync:${auditDirectory}`)
    const auditClose = io.events.indexOf(`close:${auditDirectory}`)
    const parentOpen = io.events.indexOf(`open:r:${parentDirectory}`)
    const parentSync = io.events.indexOf(`sync:${parentDirectory}`)
    const parentClose = io.events.indexOf(`close:${parentDirectory}`)
    expect(fileSync).toBeGreaterThan(lastWrite)
    expect(fileClose).toBeGreaterThan(fileSync)
    expect(auditOpen).toBeGreaterThan(fileClose)
    expect(auditSync).toBeGreaterThan(auditOpen)
    expect(auditClose).toBeGreaterThan(auditSync)
    expect(parentOpen).toBeGreaterThan(auditClose)
    expect(parentSync).toBeGreaterThan(parentOpen)
    expect(parentClose).toBeGreaterThan(parentSync)
    expect(parseAgentConversationSessionAuditLines(await readAudit(root, record))).toHaveLength(
      1 + buildAgentConversationSessionAuditEntries(record).length
    )
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

  it.each(
    (
      [
        ['EIO', errno('EIO')],
        ['EACCES', errno('EACCES')],
        ['EPERM', errno('EPERM')],
        ['ENOSPC', errno('ENOSPC')],
        ['EINVAL', errno('EINVAL')],
        ['unknown error', new Error('unexpected audit directory mkdir failure')]
      ] as const
    )
  )('fails closed without capability downgrade when audit directory mkdir returns %s', async (_name, failure) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const auditDirectory = dirname(path)
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      fail: (event) => event === `mkdir:${auditDirectory}` ? failure : undefined
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toBe(failure)
    expect(io.events).toContain(`mkdir:${auditDirectory}`)
    // mkdir is the first durable boundary; no lstat/open/write and no capability downgrade.
    expect(io.events.some((event) => event.startsWith('lstat:'))).toBe(false)
    expect(io.events.some((event) => event.startsWith('open:'))).toBe(false)
    expect(io.events.some((event) => event.startsWith('sync:'))).toBe(false)
    expect(warnings).toEqual([])
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(
    (['EIO', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EACCES'] as const)
  )('fails closed without capability downgrade when audit file open returns %s', async (code) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const flags =
      fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW
    const openEvent = `open:${flags}:${path}`
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      fail: (event) => event === openEvent ? errno(code) : undefined
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toMatchObject({ code })
    expect(io.events).toContain(openEvent)
    expect(io.events.some((event) => event === `write:${path}`)).toBe(false)
    expect(io.events.some((event) => event === `open:r:${dirname(path)}`)).toBe(false)
    expect(warnings).toEqual([])
    // Instrumented open fails before the real openFile call, so no audit file is created.
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(
    (['EIO', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EACCES'] as const)
  )('fails closed without capability downgrade when audit file sync returns %s', async (code) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      fail: (event) => event === `sync:${path}` ? errno(code) : undefined
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toMatchObject({ code })
    expect(io.events).toContain(`sync:${path}`)
    // open + write may have occurred before sync; directory durability must not start
    expect(io.events.some((event) => event === `open:r:${dirname(path)}`)).toBe(false)
    expect(warnings).toEqual([])
  })

  it.each(
    (['EIO', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EACCES'] as const)
  )('fails closed without capability downgrade when audit file close returns %s', async (code) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      fail: (event) => event === `close:${path}` ? errno(code) : undefined
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toMatchObject({ code })
    expect(io.events).toContain(`close:${path}`)
    // file open/write/sync may have occurred before close; directory durability must not start
    expect(io.events.some((event) => event === `open:r:${dirname(path)}`)).toBe(false)
    expect(warnings).toEqual([])
  })

  it.each(
    (['EIO', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EACCES'] as const)
  )('fails closed without capability downgrade when audit file lstat returns %s', async (code) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      fail: (event) => event === `lstat:${path}` ? errno(code) : undefined
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toMatchObject({ code })
    expect(io.events).toContain(`lstat:${path}`)
    // lstat fails before open; no open/write and no directory durability
    expect(io.events.some((event) => event.startsWith(`open:`))).toBe(false)
    expect(io.events.some((event) => event === `open:r:${dirname(path)}`)).toBe(false)
    expect(warnings).toEqual([])
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(
    (['EIO', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EACCES'] as const)
  )('fails closed without capability downgrade when audit file stat returns %s', async (code) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      fail: (event) => event === `stat:${path}` ? errno(code) : undefined
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toMatchObject({ code })
    expect(io.events).toContain(`stat:${path}`)
    // open happened before stat; write must not proceed; directory durability must not start
    expect(io.events.some((event) => event.startsWith('open:') && event.endsWith(`:${path}`))).toBe(true)
    expect(io.events.some((event) => event === `write:${path}`)).toBe(false)
    expect(io.events.some((event) => event === `open:r:${dirname(path)}`)).toBe(false)
    expect(warnings).toEqual([])
  })

  it.each([
    ['zero', 0],
    ['non-integer', Number.NaN]
  ] as const)('fails closed when audit file write returns %s bytesWritten', async (_name, bytesWritten) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      writePlan: () => ({ bytesWritten })
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toThrow(/could not be written completely/)
    expect(io.events).toContain(`write:${path}`)
    // Incomplete write is fatal: no directory durability / capability downgrade path.
    expect(io.events.some((event) => event === `open:r:${dirname(path)}`)).toBe(false)
    expect(warnings).toEqual([])
  })

  it.each([
    ['zero', 0],
    ['non-integer', Number.NaN]
  ] as const)('fails closed when audit file read returns %s bytesRead', async (_name, bytesRead) => {
    const root = await createRoot()
    const record = createRecord()
    const path = auditPath(root, record)
    // Seed a non-empty audit file so readExactAuditBytes enters its transfer loop.
    await appendWith(root, record, instrumentedAuditOperations().operations)
    const continuation = createRecord({
      updatedAt: '2026-07-18T00:02:00.000Z',
      turns: [
        ...record.turns,
        { id: 'turn-three', role: 'user', content: 'Follow-up residual', createdAt: '2026-07-18T00:02:00.000Z' }
      ]
    })
    const warnings: string[] = []
    const io = instrumentedAuditOperations({
      readPlan: () => ({ bytesRead })
    })

    await expect(appendWith(root, continuation, io.operations, (message) => warnings.push(message)))
      .rejects.toThrow(/could not be read exactly/)
    expect(io.events).toContain(`read:${path}`)
    expect(io.events.some((event) => event === `write:${path}`)).toBe(false)
    // Incomplete read is fatal: no directory durability / capability downgrade path.
    expect(io.events.some((event) => event === `open:r:${dirname(path)}`)).toBe(false)
    expect(warnings).toEqual([])
  })

  it.each(
    (['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'] as const).flatMap((code) => [
      ['audit-directory open', code, (root: string, record: AgentConversationRecord) => `open:r:${dirname(auditPath(root, record))}`],
      ['audit-directory sync', code, (root: string, record: AgentConversationRecord) => `sync:${dirname(auditPath(root, record))}`],
      ['parent-directory open', code, (root: string, record: AgentConversationRecord) => `open:r:${dirname(dirname(auditPath(root, record)))}`],
      ['parent-directory sync', code, (root: string, record: AgentConversationRecord) => `sync:${dirname(dirname(auditPath(root, record)))}`]
    ])
  )('downgrades supported %s capability error %s with one generic warning', async (_boundary, code, eventFor) => {
    const root = await createRoot()
    const record = createRecord({ traceId: TRACE_A })
    const warnings: string[] = []
    const path = auditPath(root, record)
    const auditDirectory = dirname(path)
    const parentDirectory = dirname(auditDirectory)
    const event = eventFor(root, record)
    let failed = false
    const io = instrumentedAuditOperations({
      fail: (candidate) => {
        if (!failed && candidate === event) {
          failed = true
          return errno(code)
        }
        return undefined
      }
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message))).resolves.toBeDefined()
    const lines = parseAgentConversationSessionAuditLines(await readAudit(root, record))
    const header = lines.find((line) => line.type === 'session')
    const entryIds = buildAgentConversationSessionAuditEntries(record).flatMap((entry) =>
      entry.parentId === null ? [entry.id] : [entry.id, entry.parentId]
    )

    expect(warnings).toEqual([DIRECTORY_FSYNC_WARNING])
    for (const sensitiveValue of [
      root,
      path,
      auditDirectory,
      parentDirectory,
      record.relativePath,
      record.absolutePath,
      record.title,
      ...record.turns.map((turn) => turn.content),
      JSON.stringify(header),
      record.id,
      ...entryIds,
      TRACE_A
    ]) {
      expect(warnings[0]).not.toContain(sensitiveValue)
    }
  })

  it.each(
    (
      [
        ['audit-directory', (root: string, record: AgentConversationRecord) => dirname(auditPath(root, record))],
        ['parent-directory', (root: string, record: AgentConversationRecord) => dirname(dirname(auditPath(root, record)))]
      ] as const
    ).flatMap(([boundary, directoryFor]) =>
      ([
        ['EACCES', errno('EACCES')],
        ['EPERM', errno('EPERM')],
        ['EIO', errno('EIO')],
        ['unknown error', new Error('unexpected directory open failure')]
      ] as const).map(([name, failure]) => [boundary, name, directoryFor, failure] as const)
    )
  )('fails closed without capability downgrade when %s open returns %s', async (_boundary, _name, directoryFor, failure) => {
    const root = await createRoot()
    const record = createRecord()
    const directory = directoryFor(root, record)
    const path = auditPath(root, record)
    const warnings: string[] = []
    const openEvent = `open:r:${directory}`
    const io = instrumentedAuditOperations({
      fail: (event) => event === openEvent ? failure : undefined
    })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message)))
      .rejects.toBe(failure)
    expect(io.events).toContain(openEvent)
    // File append completed before directory durability; open failure must not
    // be reinterpreted as an allowlist capability downgrade warning.
    expect(io.events.some((event) => event === `sync:${directory}`)).toBe(false)
    expect(warnings).toEqual([])
    await expect(readFile(path, 'utf8')).resolves.toContain(record.id)
  })

  it.each(
    (
      [
        ['audit-directory', (root: string, record: AgentConversationRecord) => dirname(auditPath(root, record))],
        ['parent-directory', (root: string, record: AgentConversationRecord) => dirname(dirname(auditPath(root, record)))]
      ] as const
    ).flatMap(([boundary, directoryFor]) =>
      ([
        ['EACCES', errno('EACCES')],
        ['EPERM', errno('EPERM')],
        ['EIO', errno('EIO')],
        ['unknown error', new Error('unexpected directory fsync failure')]
      ] as const).map(([name, failure]) => [boundary, name, directoryFor, failure] as const)
    )
  )('does not downgrade fatal %s sync %s', async (_boundary, _name, directoryFor, failure) => {
    const root = await createRoot()
    const record = createRecord()
    const directory = directoryFor(root, record)
    const path = auditPath(root, record)
    const warnings: string[] = []
    const io = instrumentedAuditOperations({ fail: (event) => event === `sync:${directory}` ? failure : undefined })

    await expect(appendWith(root, record, io.operations, (message) => warnings.push(message))).rejects.toBe(failure)
    expect(io.events).toContain(`sync:${directory}`)
    // Directory sync failure must remain fatal; do not emit capability-downgrade warning.
    expect(warnings).toEqual([])
    await expect(readFile(path, 'utf8')).resolves.toContain(record.id)
  })

  it.each([
    ['audit-directory', (root: string, record: AgentConversationRecord) => dirname(auditPath(root, record))],
    ['parent-directory', (root: string, record: AgentConversationRecord) => dirname(dirname(auditPath(root, record)))]
  ])('treats every %s close failure as fatal, including an otherwise-downgradeable code', async (_boundary, directoryFor) => {
    const root = await createRoot()
    const record = createRecord()
    const directory = directoryFor(root, record)
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
