import { mkdir, mkdtemp, open as openFile, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH,
  readAgentConversationOpenStateAtRoot,
  writeAgentConversationOpenStateAtRoot,
  type AgentConversationOpenStateEntry
} from '../../src/main/agent-conversation-session-tree'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'

const roots: string[] = []

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

async function createRoot(): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-session-open-state-durable-'))
  roots.push(rootPath)
  await mkdir(dirname(join(rootPath, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)), { recursive: true })
  return rootPath
}

function entries(branchId: string): AgentConversationOpenStateEntry[] {
  return [{ sessionId: 'session-root', branchId, updatedAt: '2026-07-18T01:00:00.000Z' }]
}

function instrumentedDurableOperations(options: {
  fail?: (event: string) => Error | undefined
  onEvent?: (event: string) => void | Promise<void>
} = {}): {
  operations: DurableFileOperations
  events: string[]
  modes: Array<{ path: string; mode: number | undefined }>
} {
  const events: string[] = []
  const modes: Array<{ path: string; mode: number | undefined }> = []
  const observe = async (event: string): Promise<void> => {
    events.push(event)
    await options.onEvent?.(event)
    const failure = options.fail?.(event)
    if (failure) throw failure
  }
  const operations: DurableFileOperations = {
    mkdir,
    readFile,
    open: async (path, flags, mode) => {
      await observe(`open:${flags}:${path}`)
      modes.push({ path, mode })
      const handle = await openFile(path, flags, mode)
      return {
        writeFile: async (content) => {
          await observe(`write:${path}`)
          await handle.writeFile(content)
        },
        sync: async () => {
          await observe(`sync:${path}`)
          // Windows cannot fsync directory handles. The production primitive
          // downgrades that native capability gap; retain injected faults above.
          if (process.platform === 'win32' && (await handle.stat()).isDirectory()) return
          await handle.sync()
        },
        close: async () => {
          const event = `close:${path}`
          events.push(event)
          await options.onEvent?.(event)
          const failure = options.fail?.(event)
          await handle.close()
          if (failure) throw failure
        }
      }
    },
    rename: async (from, to) => {
      await observe(`rename:${from}->${to}`)
      await rename(from, to)
    },
    rm
  }
  return { operations, events, modes }
}

function durableCandidate(events: readonly string[]): string {
  const event = events.find((item) => item.startsWith('open:wx:') && item.endsWith('.tmp'))
  if (!event) throw new Error('Missing same-directory durable temporary candidate.')
  return event.slice('open:wx:'.length)
}

async function temporaryFiles(rootPath: string): Promise<string[]> {
  const visit = async (directory: string): Promise<string[]> => {
    const nested = await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return visit(path)
      return entry.name.endsWith('.tmp') ? [relative(rootPath, path)] : []
    }))
    return nested.flat()
  }
  return visit(rootPath)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

describe('agent conversation open-state durable publication', () => {
  it('uses the shared private same-directory publisher in file-sync, rename, directory-sync order without changing bytes or parser reads', async () => {
    const rootPath = await createRoot()
    const targetPath = join(rootPath, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)
    const durable = instrumentedDurableOperations()

    const state = await writeAgentConversationOpenStateAtRoot(rootPath, entries('branch-durable'), {
      durableFileOperations: durable.operations
    })

    const candidate = durableCandidate(durable.events)
    const directory = dirname(targetPath)
    expect(dirname(candidate)).toBe(directory)
    expect(durable.events).toEqual([
      `open:wx:${candidate}`,
      `write:${candidate}`,
      `sync:${candidate}`,
      `close:${candidate}`,
      `rename:${candidate}->${targetPath}`,
      `open:r:${directory}`,
      `sync:${directory}`,
      `close:${directory}`
    ])
    expect(durable.modes).toContainEqual({ path: candidate, mode: 0o600 })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(`${JSON.stringify(state, null, 2)}\n`)
    await expect(readAgentConversationOpenStateAtRoot(rootPath)).resolves.toEqual(state)
    await expect(temporaryFiles(rootPath)).resolves.toEqual([])
  })

  it('keeps parent and target symlink preflight outside the shared publisher', async () => {
    const rootPath = await createRoot()
    const targetPath = join(rootPath, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)
    const sidecarDirectory = dirname(targetPath)
    const outsideRoot = await mkdtemp(join(tmpdir(), 'studiumx-session-open-state-outside-'))
    roots.push(outsideRoot)
    const durableTarget = instrumentedDurableOperations()
    const outsideTarget = join(outsideRoot, 'state.json')
    await writeFile(outsideTarget, '{"outside":"target"}\n', 'utf8')
    try {
      await symlink(outsideTarget, targetPath)
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    await expect(writeAgentConversationOpenStateAtRoot(rootPath, entries('branch-symlink-target'), {
      durableFileOperations: durableTarget.operations
    })).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('{"outside":"target"}\n')
    expect(durableTarget.events).toEqual([])

    await rm(targetPath)
    await rm(sidecarDirectory, { recursive: true })
    const durableParent = instrumentedDurableOperations()
    await symlink(outsideRoot, sidecarDirectory)

    await expect(writeAgentConversationOpenStateAtRoot(rootPath, entries('branch-symlink-parent'), {
      durableFileOperations: durableParent.operations
    })).rejects.toMatchObject({ code: 'invalid_path' })
    expect(durableParent.events).toEqual([])
  })

  it.each([
    ['write', (event: string, candidate: string, targetPath: string) => event === `write:${candidate}`],
    ['file sync', (event: string, candidate: string, targetPath: string) => event === `sync:${candidate}`],
    ['file close', (event: string, candidate: string, targetPath: string) => event === `close:${candidate}`],
    ['rename', (event: string, candidate: string, targetPath: string) => event === `rename:${candidate}->${targetPath}`]
  ])('rejects and leaves the prior sidecar untouched when durable %s fails before rename', async (_name, matches) => {
    const rootPath = await createRoot()
    const targetPath = join(rootPath, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)
    const oldContent = '{"legacy":"open"}\n'
    await writeFile(targetPath, oldContent, 'utf8')
    let candidate = ''
    const durable = instrumentedDurableOperations({
      fail: (event) => matches(event, candidate, targetPath) ? errno('EIO') : undefined,
      onEvent: (event) => {
        if (event.startsWith('open:wx:')) candidate = event.slice('open:wx:'.length)
      }
    })

    await expect(writeAgentConversationOpenStateAtRoot(rootPath, entries('branch-next'), {
      durableFileOperations: durable.operations
    })).rejects.toMatchObject({ code: 'EIO' })

    await expect(readFile(targetPath, 'utf8')).resolves.toBe(oldContent)
    await expect(temporaryFiles(rootPath)).resolves.toEqual([])
    expect(durable.events).not.toContain(`sync:${dirname(targetPath)}`)
  })

  it.each([
    ['directory sync EIO', (event: string, directory: string) => event === `sync:${directory}`, errno('EIO')],
    ['directory sync EACCES', (event: string, directory: string) => event === `sync:${directory}`, errno('EACCES')],
    ['directory sync EPERM', (event: string, directory: string) => event === `sync:${directory}`, errno('EPERM')],
    ['directory sync unknown error', (event: string, directory: string) => event === `sync:${directory}`, new Error('unexpected directory failure')],
    ['directory close', (event: string, directory: string) => event === `close:${directory}`, errno('EIO')]
  ])('fails closed after rename for fatal %s failures without rolling back the new sidecar', async (_name, matches, failure) => {
    const rootPath = await createRoot()
    const targetPath = join(rootPath, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)
    const directory = dirname(targetPath)
    const durable = instrumentedDurableOperations({
      fail: (event) => matches(event, directory) ? failure : undefined
    })

    await expect(writeAgentConversationOpenStateAtRoot(rootPath, entries('branch-published'), {
      durableFileOperations: durable.operations
    })).rejects.toBe(failure)

    expect(durable.events).toContain(`rename:${durableCandidate(durable.events)}->${targetPath}`)
    await expect(readAgentConversationOpenStateAtRoot(rootPath)).resolves.toMatchObject({
      sessions: [{ sessionId: 'session-root', branchId: 'branch-published' }]
    })
    await expect(temporaryFiles(rootPath)).resolves.toEqual([])
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'only downgrades the shared allowed directory-fsync capability code %s',
    async (code) => {
      const rootPath = await createRoot()
      const targetPath = join(rootPath, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)
      const directory = dirname(targetPath)
      const warnings: string[] = []
      const durable = instrumentedDurableOperations({
        fail: (event) => event === `sync:${directory}` ? errno(code) : undefined
      })

      await expect(writeAgentConversationOpenStateAtRoot(rootPath, entries('branch-capability'), {
        durableFileOperations: durable.operations,
        durableWarn: (message) => warnings.push(message)
      })).resolves.toMatchObject({ sessions: [{ branchId: 'branch-capability' }] })

      expect(warnings).toEqual(['[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'])
      expect(warnings[0]).not.toContain(rootPath)
      await expect(readAgentConversationOpenStateAtRoot(rootPath)).resolves.toMatchObject({
        sessions: [{ sessionId: 'session-root', branchId: 'branch-capability' }]
      })
      await expect(temporaryFiles(rootPath)).resolves.toEqual([])
    }
  )

  it('serializes same-root writes and leaves a valid parser-readable final sidecar', async () => {
    const rootPath = await createRoot()
    let releaseFirstWrite!: () => void
    const firstWriteBlocked = new Promise<void>((resolve) => { releaseFirstWrite = resolve })
    let firstWriteStarted!: () => void
    const firstWriteStartedPromise = new Promise<void>((resolve) => { firstWriteStarted = resolve })
    let blockFirst = true
    const first = instrumentedDurableOperations({
      onEvent: async (event) => {
        if (blockFirst && event.startsWith('write:')) {
          firstWriteStarted()
          await firstWriteBlocked
        }
      }
    })
    const second = instrumentedDurableOperations()

    const firstWrite = writeAgentConversationOpenStateAtRoot(rootPath, entries('branch-first'), {
      durableFileOperations: first.operations
    })
    await firstWriteStartedPromise
    const secondWrite = writeAgentConversationOpenStateAtRoot(rootPath, entries('branch-second'), {
      durableFileOperations: second.operations
    })

    await Promise.resolve()
    expect(second.events).toEqual([])
    blockFirst = false
    releaseFirstWrite()
    await Promise.all([firstWrite, secondWrite])

    await expect(readAgentConversationOpenStateAtRoot(rootPath)).resolves.toMatchObject({
      sessions: [{ sessionId: 'session-root', branchId: 'branch-second' }]
    })
    await expect(temporaryFiles(rootPath)).resolves.toEqual([])
  })
})
