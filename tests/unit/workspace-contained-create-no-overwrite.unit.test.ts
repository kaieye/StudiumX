import { execFile, spawnSync } from 'node:child_process'
import { link, lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ContainedDurableDirectory,
  type ContainedTemporaryFile,
  type WorkspaceContainedLeaf,
  type WorkspaceContainedPathBinding
} from '../../src/main/persistence/contained-durable-directory'
import {
  createNoOverwriteAtWorkspaceContainedPath,
  WorkspaceContainedCreateNoOverwriteError,
  type CreateWorkspaceContainedNoOverwriteInput,
  type WorkspaceContainedCreateNoOverwriteOperations
} from '../../src/main/persistence/workspace-contained-create-no-overwrite'

const roots: string[] = []
const execFileAsync = promisify(execFile)
const mkfifoUnavailable = (spawnSync('mkfifo', [], { stdio: 'ignore' }).error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
const directorySyncWarning =
  '[StudiumX] A required contained-directory fsync is unsupported; durability confirmation was downgraded.'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace contained create-no-overwrite protocol', () => {
  it.each([
    ['empty content', '', Buffer.alloc(0)],
    ['non-ASCII UTF-8 content', '你好, 🧪\n', Buffer.from('你好, 🧪\n', 'utf8')]
  ])('writes %s as exact bytes in the strict durable protocol order', async (_name, content, expectedBytes) => {
    const seam = memoryProtocol()
    const observed: string[] = []

    await expect(createNoOverwriteAtWorkspaceContainedPath({
      workspaceRootPath: '/trusted/workspace',
      relativePath: 'notes/entry.txt',
      content,
      operations: seam.operations,
      onOperation: ({ type }) => observed.push(type)
    })).resolves.toBeUndefined()

    expect(seam.final).toEqual(expectedBytes)
    expect(observed).toEqual([
      'bind',
      'inspect',
      'temporary_create',
      'temporary_write',
      'temporary_file_sync',
      'temporary_file_close',
      'exclusive_publication',
      'directory_sync',
      'directory_close'
    ])
    expect(seam.calls).toEqual([
      'bind',
      'inspect',
      'temporary_create',
      'temporary_write',
      'temporary_file_sync',
      'temporary_file_close',
      'exclusive_publication',
      'directory_sync',
      'directory_close'
    ])
    expect(seam.closeCount).toBe(1)
    expect(seam.temporaryExists).toBe(false)
  })

  it.each<[string, WorkspaceContainedLeaf]>([
    ['regular file', { type: 'regular', mode: 0o666, linkCount: 1 }],
    ['hard-linked regular file', { type: 'regular', mode: 0o666, linkCount: 2 }],
    ['directory', { type: 'directory' }],
    ['symlink', { type: 'symlink' }],
    ['FIFO/other leaf', { type: 'other' }]
  ])('classifies an initial existing %s as target_exists before temporary work', async (_name, leaf) => {
    const seam = memoryProtocol({ leaf })

    const error = await rejectProtocol({ operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'target_exists',
      phase: 'inspect',
      publication: 'not_published',
      directoryDurability: 'not_attempted',
      temporaryMayRemain: false
    })
    expect(seam.calls).toEqual(['bind', 'inspect', 'directory_close'])
    expect(seam.closeCount).toBe(1)
    expect(seam.final).toBeUndefined()
  })

  it('keeps a post-inspection EEXIST competitor intact, never publishes S2 bytes, and removes its temporary candidate', async () => {
    const competitorBytes = Buffer.from('winner wrote this first', 'utf8')
    const s2Bytes = Buffer.from('S2 must not overwrite this', 'utf8')
    const seam = memoryProtocol({
      publicationFailure: Object.assign(new Error('already exists'), { code: 'EEXIST' }),
      onPublicationFailure: (state) => { state.final = competitorBytes }
    })

    const error = await rejectProtocol({ content: s2Bytes.toString('utf8'), operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'target_exists',
      phase: 'exclusive_publication',
      publication: 'not_published',
      temporaryMayRemain: false
    })
    expect(seam.final).toEqual(competitorBytes)
    expect(seam.final).not.toEqual(s2Bytes)
    expect(seam.temporaryExists).toBe(false)
    expect(seam.calls).toEqual([
      'bind',
      'inspect',
      'temporary_create',
      'temporary_write',
      'temporary_file_sync',
      'temporary_file_close',
      'exclusive_publication',
      'temporary_cleanup',
      'directory_sync',
      'directory_close'
    ])
  })

  it.each([
    ['temporary create', 'temporary_create', undefined, false, ['bind', 'inspect', 'temporary_create', 'directory_close']],
    ['temporary write', 'temporary_write', undefined, false, [
      'bind', 'inspect', 'temporary_create', 'temporary_write', 'temporary_file_close', 'temporary_cleanup', 'directory_sync', 'directory_close'
    ]],
    ['temporary fsync', 'temporary_file_sync', undefined, false, [
      'bind', 'inspect', 'temporary_create', 'temporary_write', 'temporary_file_sync', 'temporary_file_close', 'temporary_cleanup', 'directory_sync', 'directory_close'
    ]],
    ['temporary close', 'temporary_file_close', undefined, false, [
      'bind', 'inspect', 'temporary_create', 'temporary_write', 'temporary_file_sync', 'temporary_file_close', 'temporary_cleanup', 'directory_sync', 'directory_close'
    ]],
    ['generic publication', 'exclusive_publication', undefined, false, [
      'bind', 'inspect', 'temporary_create', 'temporary_write', 'temporary_file_sync', 'temporary_file_close', 'exclusive_publication', 'temporary_cleanup', 'directory_sync', 'directory_close'
    ]],
    ['atomic primitive unavailable', 'exclusive_publication', 'ERR_CONTAINED_CREATE_NO_OVERWRITE_UNAVAILABLE', false, [
      'bind', 'inspect', 'temporary_create', 'temporary_write', 'temporary_file_sync', 'temporary_file_close', 'exclusive_publication', 'temporary_cleanup', 'directory_sync', 'directory_close'
    ]],
    ['pre-publication directory close', 'directory_close', undefined, false, [
      'bind', 'inspect', 'directory_close'
    ]]
  ])('reports %s failure as non-published, does not retry, and accurately tracks temporary cleanup', async (
    _name,
    failingCall,
    code,
    temporaryMayRemain,
    expectedCalls
  ) => {
    const failure = Object.assign(new Error(`injected ${failingCall}`), code ? { code } : {})
    const seam = memoryProtocol({
      leaf: failingCall === 'directory_close' ? { type: 'regular', mode: 0o666, linkCount: 1 } : { type: 'absent' },
      failures: { [operationForPhase(failingCall)]: failure }
    })

    const error = await rejectProtocol({ operations: seam.operations })

    expect(error.publication).toBe('not_published')
    expect(error.temporaryMayRemain).toBe(temporaryMayRemain)
    expect(seam.final).toBeUndefined()
    expect(seam.calls).toEqual(expectedCalls)
    expect(seam.calls.filter((call) => call === failingCall)).toHaveLength(1)
    expect(seam.calls.filter((call) => call === 'exclusive_publication')).toHaveLength(
      expectedCalls.includes('exclusive_publication') ? 1 : 0
    )
    expect(seam.closeCount).toBe(1)

    if (code === 'ERR_CONTAINED_CREATE_NO_OVERWRITE_UNAVAILABLE') {
      expect(error).toMatchObject({ kind: 'atomic_no_clobber_unavailable', phase: 'exclusive_publication' })
    } else {
      expect(error).toMatchObject({ kind: 'prepublication_failure', phase: failingCall })
    }
  })

  it('preserves the non-published result when cleanup unlink or cleanup directory fsync also fails', async () => {
    const publicationFailure = new Error('publication failed before success')
    const cleanupFailure = new Error('cleanup unlink failed')
    const unlinkSeam = memoryProtocol({
      publicationFailure,
      failures: { cleanupTemporary: cleanupFailure }
    })
    const unlinkError = await rejectProtocol({ operations: unlinkSeam.operations })
    expect(unlinkError).toMatchObject({
      kind: 'prepublication_failure',
      phase: 'temporary_cleanup',
      publication: 'not_published',
      temporaryMayRemain: true,
      cause: cleanupFailure
    })
    expect(unlinkSeam.final).toBeUndefined()
    expect(unlinkSeam.calls.filter((call) => call === 'exclusive_publication')).toHaveLength(1)
    expect(unlinkSeam.calls.filter((call) => call === 'temporary_cleanup')).toHaveLength(1)

    const syncFailure = new Error('cleanup directory fsync failed')
    const syncSeam = memoryProtocol({
      publicationFailure,
      failures: { syncDirectory: syncFailure }
    })
    const syncError = await rejectProtocol({ operations: syncSeam.operations })
    expect(syncError).toMatchObject({
      kind: 'prepublication_failure',
      phase: 'directory_sync',
      publication: 'not_published',
      directoryDurability: 'not_confirmed',
      temporaryMayRemain: false,
      cause: syncFailure
    })
    expect(syncSeam.final).toBeUndefined()
    expect(syncSeam.temporaryExists).toBe(false)
    expect(syncSeam.calls.filter((call) => call === 'exclusive_publication')).toHaveLength(1)
    expect(syncSeam.calls.filter((call) => call === 'directory_sync')).toHaveLength(1)
  })

  it.each([
    ['directory fsync', 'directory_sync'],
    ['directory close', 'directory_close']
  ])('reports post-publication %s failure as possibly_published without rollback or temporary residue', async (_name, failingCall) => {
    const s2Bytes = Buffer.from('published before completion failure', 'utf8')
    const seam = memoryProtocol({ failures: { [operationForPhase(failingCall)]: new Error(`injected ${failingCall}`) } })

    const error = await rejectProtocol({ content: s2Bytes.toString('utf8'), operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'possibly_published',
      phase: failingCall,
      publication: 'published',
      directoryDurability: failingCall === 'directory_sync' ? 'not_confirmed' : 'confirmed',
      temporaryMayRemain: false
    })
    expect(seam.final).toEqual(s2Bytes)
    expect(seam.temporaryExists).toBe(false)
    expect(seam.calls.filter((call) => call === 'exclusive_publication')).toHaveLength(1)
  })

  it('reports a completion warning failure after publication as possibly_published while retaining the final bytes', async () => {
    const s2Bytes = Buffer.from('bytes survive warning failure', 'utf8')
    const seam = memoryProtocol({ directorySyncUnsupported: true })

    const error = await rejectProtocol({
      content: s2Bytes.toString('utf8'),
      operations: seam.operations,
      warn: () => { throw new Error('warning observer failed') }
    })

    expect(error).toMatchObject({
      kind: 'possibly_published',
      phase: 'completion',
      publication: 'published',
      directoryDurability: 'unsupported',
      temporaryMayRemain: false
    })
    expect(seam.final).toEqual(s2Bytes)
    expect(seam.temporaryExists).toBe(false)
  })

  it('uses the only semantic directory-fsync downgrade, emits one generic warning, and treats EIO/EPERM/EACCES as fatal', async () => {
    const warnings: string[] = []
    const downgraded = memoryProtocol({ directorySyncUnsupported: true })

    await expect(createNoOverwriteAtWorkspaceContainedPath({
      workspaceRootPath: '/trusted/workspace',
      relativePath: 'notes/entry.txt',
      content: 'durable bytes',
      operations: downgraded.operations,
      warn: (message) => warnings.push(message)
    })).resolves.toBeUndefined()

    expect(warnings).toEqual([directorySyncWarning])
    expect(warnings[0]).not.toContain('/trusted/workspace')
    expect(warnings[0]).not.toContain('entry.txt')
    expect(warnings[0]).not.toContain('durable bytes')

    for (const code of ['EIO', 'EPERM', 'EACCES']) {
      const seam = memoryProtocol({ failures: { syncDirectory: Object.assign(new Error(code), { code }) } })
      const error = await rejectProtocol({ operations: seam.operations })
      expect(error).toMatchObject({
        kind: 'possibly_published',
        phase: 'directory_sync',
        publication: 'published',
        directoryDurability: 'not_confirmed',
        temporaryMayRemain: false
      })
    }
  })

  it('keeps the uninjectable native directory-fsync downgrade allowlist limited to five errno codes', async () => {
    // The public publication seam deliberately exposes only the safe boolean
    // downgrade result. Assert the native compatibility boundary separately,
    // while the preceding test covers its observable warning/fatal behavior.
    const nativeSource = await readFile(
      join(process.cwd(), 'native', 'contained-durable-replace', 'contained_durable_replace.cc'),
      'utf8'
    )
    const allowlist = nativeSource.match(/bool IsUnsupportedDirectorySync\(int error\) \{([\s\S]*?)\n\}/)?.[1]
    expect(allowlist).toBeDefined()
    for (const code of ['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR']) {
      expect(allowlist).toContain(`error == ${code}`)
    }
    for (const code of ['EIO', 'EPERM', 'EACCES']) expect(allowlist).not.toContain(code)
  })

  it('fails closed at bind without subsequent filesystem protocol work or a pathname fallback', async () => {
    const secretRoot = '/private/secret-workspace'
    const secretRelative = 'nested/secret.txt'
    const secretContent = 'do not leak this payload'
    const bindFailure = Object.assign(new Error('descriptor capability unavailable'), { code: 'ENOTSUP' })
    const seam = memoryProtocol({ failures: { bind: bindFailure } })

    const error = await rejectProtocol({
      workspaceRootPath: secretRoot,
      relativePath: secretRelative,
      content: secretContent,
      operations: seam.operations
    })

    expect(error).toMatchObject({
      kind: 'prepublication_failure',
      phase: 'bind',
      publication: 'not_published',
      directoryDurability: 'not_attempted',
      temporaryMayRemain: false,
      cause: bindFailure
    })
    expect(error.message).not.toContain(secretRoot)
    expect(error.message).not.toContain(secretRelative)
    expect(error.message).not.toContain(secretContent)
    expect(seam.calls).toEqual(['bind'])
  })
})

describe.runIf(process.platform === 'darwin' || process.platform === 'linux')('workspace contained create-no-overwrite native macOS/Linux integration', () => {
  it('creates empty and non-ASCII content with 0666 & umask mode and no temporary alias', async () => {
    const root = await temporaryRoot()
    const originalUmask = process.umask(0o027)
    try {
      await createNoOverwriteAtWorkspaceContainedPath({
        workspaceRootPath: root,
        relativePath: 'created/empty.txt',
        content: ''
      })
      await createNoOverwriteAtWorkspaceContainedPath({
        workspaceRootPath: root,
        relativePath: 'created/你好.txt',
        content: '你好, 🧪\n'
      })

      expect(await readFile(join(root, 'created', 'empty.txt'))).toEqual(Buffer.alloc(0))
      expect(await readFile(join(root, 'created', '你好.txt'))).toEqual(Buffer.from('你好, 🧪\n', 'utf8'))
      expect((await stat(join(root, 'created', '你好.txt'))).mode & 0o777).toBe(0o640)
      expect(await readdir(join(root, 'created'))).toEqual(['empty.txt', '你好.txt'])
    } finally {
      process.umask(originalUmask)
    }
  })

  it('rejects existing regular, hard-linked, directory, symlink, and FIFO leaves without creating temporary aliases', async () => {
    const root = await temporaryRoot()
    const external = await temporaryRoot()
    const parent = join(root, 'existing')
    await mkdir(parent)
    await writeFile(join(parent, 'regular.txt'), 'regular stays')
    await writeFile(join(parent, 'hardlink-source.txt'), 'hardlink stays')
    await link(join(parent, 'hardlink-source.txt'), join(parent, 'hardlink.txt'))
    await mkdir(join(parent, 'directory.txt'))
    await symlink(external, join(parent, 'symlink.txt'))
    if (!mkfifoUnavailable) await execFileAsync('mkfifo', [join(parent, 'fifo.txt')])

    const cases: Array<[string, () => Promise<void>]> = [
      ['regular.txt', async () => { expect(await readFile(join(parent, 'regular.txt'), 'utf8')).toBe('regular stays') }],
      ['hardlink.txt', async () => {
        expect((await stat(join(parent, 'hardlink.txt'))).nlink).toBeGreaterThanOrEqual(2)
        expect(await readFile(join(parent, 'hardlink.txt'), 'utf8')).toBe('hardlink stays')
      }],
      ['directory.txt', async () => { expect((await stat(join(parent, 'directory.txt'))).isDirectory()).toBe(true) }],
      ['symlink.txt', async () => { expect((await lstat(join(parent, 'symlink.txt'))).isSymbolicLink()).toBe(true) }]
    ]
    if (!mkfifoUnavailable) {
      cases.push(['fifo.txt', async () => { expect((await lstat(join(parent, 'fifo.txt'))).isFIFO()).toBe(true) }])
    }

    for (const [basename, verify] of cases) {
      const error = await rejectProtocol({ workspaceRootPath: root, relativePath: `existing/${basename}`, content: 'must not write' })
      expect(error).toMatchObject({ kind: 'target_exists', phase: 'inspect', publication: 'not_published', temporaryMayRemain: false })
      await verify()
    }
    expect((await readdir(parent)).sort()).toEqual([
      'directory.txt',
      'hardlink-source.txt',
      'hardlink.txt',
      'regular.txt',
      'symlink.txt',
      ...mkfifoUnavailable ? [] : ['fifo.txt']
    ].sort())
  })

  it('allows exactly one winner among concurrent native creates and leaves no temporary aliases', async () => {
    const root = await temporaryRoot()
    const contents = Array.from({ length: 12 }, (_, index) => `writer-${index}-你好`)
    const results = await Promise.all(contents.map(async (content) => {
      try {
        await createNoOverwriteAtWorkspaceContainedPath({
          workspaceRootPath: root,
          relativePath: 'race/final.txt',
          content
        })
        return { status: 'success' as const, content }
      } catch (error) {
        if (error instanceof WorkspaceContainedCreateNoOverwriteError && error.kind === 'target_exists') {
          return { status: 'target_exists' as const, content }
        }
        throw error
      }
    }))

    const winners = results.filter((result) => result.status === 'success')
    const losers = results.filter((result) => result.status === 'target_exists')
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(contents.length - 1)
    expect(await readFile(join(root, 'race', 'final.txt'), 'utf8')).toBe(winners[0]?.content)
    expect(await readdir(join(root, 'race'))).toEqual(['final.txt'])
  })
})

type ProtocolCall = keyof WorkspaceContainedCreateNoOverwriteOperations

type MemoryProtocolOptions = {
  leaf?: WorkspaceContainedLeaf
  failures?: Partial<Record<ProtocolCall, Error>>
  publicationFailure?: Error
  onPublicationFailure?: (state: { final: Buffer | undefined }) => void
  directorySyncUnsupported?: boolean
}

function memoryProtocol(options: MemoryProtocolOptions = {}) {
  const calls: string[] = []
  const parentDirectory = { nativeDirectory: { test: 'parent' } } as ContainedDurableDirectory
  const temporaryFile = { nativeTemporaryFile: { test: 'temporary' } } as ContainedTemporaryFile
  let final: Buffer | undefined
  let temporary: Buffer | undefined
  let closeCount = 0
  const fail = (call: ProtocolCall): void => {
    const failure = options.failures?.[call]
    if (failure) throw failure
  }
  const binding = {
    relativePath: 'notes/entry.txt',
    parentComponents: ['notes'],
    basename: 'entry.txt',
    parentDirectory,
    inspectLeaf: () => options.leaf ?? { type: 'absent' },
    syncParentDirectory: () => undefined,
    close: () => undefined
  } as WorkspaceContainedPathBinding
  const record = (call: ProtocolCall): void => {
    calls.push(operationName(call))
    fail(call)
  }
  const operations: WorkspaceContainedCreateNoOverwriteOperations = {
    bind: () => {
      record('bind')
      return binding
    },
    inspect: () => {
      record('inspect')
      return options.leaf ?? { type: 'absent' }
    },
    createTemporary: () => {
      record('createTemporary')
      temporary = Buffer.alloc(0)
      return temporaryFile
    },
    writeTemporary: (_file, bytes) => {
      record('writeTemporary')
      temporary = Buffer.from(bytes)
    },
    syncTemporary: () => { record('syncTemporary') },
    closeTemporary: () => { record('closeTemporary') },
    publishExclusive: () => {
      record('publishExclusive')
      if (options.publicationFailure) {
        options.onPublicationFailure?.({ get final() { return final }, set final(value: Buffer | undefined) { final = value } })
        throw options.publicationFailure
      }
      final = temporary
      temporary = undefined
    },
    cleanupTemporary: () => {
      record('cleanupTemporary')
      temporary = undefined
    },
    syncDirectory: () => {
      record('syncDirectory')
      return { directorySyncUnsupported: options.directorySyncUnsupported === true }
    },
    closeDirectory: () => {
      closeCount += 1
      record('closeDirectory')
    }
  }

  return {
    operations,
    calls,
    get final() { return final },
    get temporaryExists() { return temporary !== undefined },
    get closeCount() { return closeCount }
  }
}

function operationForPhase(phase: string): ProtocolCall {
  switch (phase) {
    case 'temporary_create': return 'createTemporary'
    case 'temporary_write': return 'writeTemporary'
    case 'temporary_file_sync': return 'syncTemporary'
    case 'temporary_file_close': return 'closeTemporary'
    case 'exclusive_publication': return 'publishExclusive'
    case 'temporary_cleanup': return 'cleanupTemporary'
    case 'directory_sync': return 'syncDirectory'
    case 'directory_close': return 'closeDirectory'
    case 'bind': return 'bind'
    case 'inspect': return 'inspect'
    default: throw new Error(`Unknown protocol phase: ${phase}`)
  }
}

function operationName(call: ProtocolCall): string {
  switch (call) {
    case 'createTemporary': return 'temporary_create'
    case 'writeTemporary': return 'temporary_write'
    case 'syncTemporary': return 'temporary_file_sync'
    case 'closeTemporary': return 'temporary_file_close'
    case 'publishExclusive': return 'exclusive_publication'
    case 'cleanupTemporary': return 'temporary_cleanup'
    case 'syncDirectory': return 'directory_sync'
    case 'closeDirectory': return 'directory_close'
    default: return call
  }
}

async function rejectProtocol(input: Partial<CreateWorkspaceContainedNoOverwriteInput> = {}): Promise<WorkspaceContainedCreateNoOverwriteError> {
  try {
    await createNoOverwriteAtWorkspaceContainedPath({
      workspaceRootPath: '/trusted/workspace',
      relativePath: 'notes/entry.txt',
      content: 'candidate content',
      ...input
    })
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceContainedCreateNoOverwriteError)
    return error as WorkspaceContainedCreateNoOverwriteError
  }
  throw new Error('Expected createNoOverwriteAtWorkspaceContainedPath to reject.')
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-create-no-overwrite-'))
  roots.push(root)
  return root
}
