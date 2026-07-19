import { existsSync } from 'node:fs'
import { chmod, link, lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * C-4P8-S3 contract test.
 *
 * The production module is intentionally loaded dynamically: S3 is being
 * implemented independently, while this test locks down the narrow internal
 * seam it must export without adding a test-only production adapter. Once
 * present, it must export `overwriteExistingRestrictedAtWorkspaceContainedPath` and use
 * the operation names/types modelled below.
 */
const implementationPath = join(
  process.cwd(),
  'src',
  'main',
  'persistence',
  'workspace-contained-restricted-overwrite.ts'
)
const runS3Contract = existsSync(implementationPath)
const directorySyncWarning =
  '[StudiumX] A required contained-directory fsync is unsupported; durability confirmation was downgraded.'

const nativeRoots: string[] = []

afterEach(async () => {
  await Promise.all(nativeRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

type Leaf =
  | { type: 'absent' }
  | { type: 'regular'; mode: number; linkCount: number }
  | { type: 'directory' }
  | { type: 'symlink' }
  | { type: 'other' }

type Directory = { readonly nativeDirectory: unknown }
type Binding = {
  readonly relativePath: string
  readonly basename: string
  readonly parentDirectory: Directory
}
type Temporary = { readonly nativeTemporaryFile: unknown }

type RestrictedOverwritePhase =
  | 'bind'
  | 'inspect_initial'
  | 'temporary_create'
  | 'temporary_write'
  | 'inspect_before_swap'
  | 'temporary_chmod'
  | 'temporary_file_sync'
  | 'temporary_file_close'
  | 'swap_publication'
  | 'first_directory_sync'
  | 'temporary_alias_cleanup'
  | 'second_directory_sync'
  | 'prepublication_directory_sync'
  | 'directory_close'
  | 'warning'
  | 'completion'

type RestrictedOverwriteError = Error & {
  readonly kind: 'target_missing' | 'target_not_restricted_regular' | 'atomic_exchange_unavailable' | 'prepublication_failure' | 'possibly_published'
  readonly phase: RestrictedOverwritePhase
  readonly publication: 'not_published' | 'published'
  readonly directoryDurability: 'not_attempted' | 'not_confirmed' | 'confirmed' | 'unsupported'
  readonly temporaryMayRemain: boolean
  readonly cause: unknown
}

type RestrictedOverwriteOperations = {
  bind: (input: { workspaceRootPath: string; relativePath: string; createParentDirectories: false }) => Binding
  inspectInitial: (binding: Binding) => Leaf
  createTemporary: (directory: Directory, temporaryName: string, requestedMode: number) => Temporary
  writeTemporary: (temporary: Temporary, bytes: Uint8Array) => void
  inspectBeforeSwap: (binding: Binding) => Leaf
  chmodTemporary: (temporary: Temporary, mode: number, directory: Directory, basename: string) => void
  syncTemporary: (temporary: Temporary) => void
  closeTemporary: (temporary: Temporary) => void
  publishSwap: (directory: Directory, temporaryName: string, basename: string, temporary: Temporary) => void
  syncDirectory: (directory: Directory) => { directorySyncUnsupported: boolean }
  cleanupTemporaryAlias: (directory: Directory, temporaryName: string) => void
  closeDirectory: (binding: Binding) => void
  complete: () => void
}

type RestrictedOverwriteInput = {
  workspaceRootPath: string
  relativePath: string
  content: string
  operations?: Partial<RestrictedOverwriteOperations>
  onOperation?: (operation: { type: RestrictedOverwritePhase }) => void
  warn?: (message: string) => void
}

type RestrictedOverwriteModule = {
  overwriteExistingRestrictedAtWorkspaceContainedPath(input: RestrictedOverwriteInput): Promise<void>
}

type OperationCall = keyof RestrictedOverwriteOperations

type MemoryProtocolOptions = {
  initialLeaf?: Leaf
  beforeSwapLeaf?: Leaf
  failures?: Partial<Record<OperationCall, Error>>
  directorySyncUnsupportedAt?: readonly number[]
}

describe.runIf(runS3Contract)('workspace contained restricted-overwrite protocol', () => {
  it.each([
    ['empty UTF-8 content', '', Buffer.alloc(0)],
    ['non-ASCII UTF-8 content', '你好, 🧪\n', Buffer.from('你好, 🧪\n', 'utf8')]
  ])('performs %s in the strict durable order and preserves the existing private mode', async (_name, content, expectedBytes) => {
    const api = await restrictedOverwrite()
    const seam = memoryProtocol({ initialLeaf: regular(0o640) })
    const observed: RestrictedOverwritePhase[] = []

    await expect(api.overwriteExistingRestrictedAtWorkspaceContainedPath({
      workspaceRootPath: '/trusted/workspace',
      relativePath: 'notes/entry.txt',
      content,
      operations: seam.operations,
      onOperation: ({ type }) => observed.push(type)
    })).resolves.toBeUndefined()

    const successOrder: RestrictedOverwritePhase[] = [
      'bind',
      'inspect_initial',
      'temporary_create',
      'temporary_write',
      'inspect_before_swap',
      'temporary_chmod',
      'temporary_file_sync',
      'temporary_file_close',
      'swap_publication',
      'first_directory_sync',
      'temporary_alias_cleanup',
      'second_directory_sync',
      'directory_close',
      'completion'
    ]
    expect(observed).toEqual(successOrder)
    expect(seam.calls).toEqual(successOrder)
    expect(seam.final).toEqual(expectedBytes)
    expect(seam.finalMode).toBe(0o640)
    expect(seam.temporaryCreateMode).toBe(0o666)
    expect(seam.temporaryChmodMode).toBe(0o640)
    expect(seam.temporaryAliasExists).toBe(false)
    expect(seam.directoryCloseCount).toBe(1)
  })

  it.each<[string, Leaf]>([
    ['absent leaf', { type: 'absent' }],
    ['hard-linked regular leaf', { type: 'regular', mode: 0o640, linkCount: 2 }],
    ['directory leaf', { type: 'directory' }],
    ['symlink leaf', { type: 'symlink' }],
    ['FIFO/other leaf', { type: 'other' }]
  ])('rejects an initial %s before temporary work and never falls back to pathname replacement', async (_name, initialLeaf) => {
    const api = await restrictedOverwrite()
    const seam = memoryProtocol({ initialLeaf })

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    expect(error).toMatchObject({
      kind: initialLeaf.type === 'absent' ? 'target_missing' : 'target_not_restricted_regular',
      phase: 'inspect_initial',
      publication: 'not_published',
      directoryDurability: 'not_attempted',
      temporaryMayRemain: false
    })
    expect(seam.calls).toEqual(['bind', 'inspect_initial', 'directory_close', 'completion'])
    expect(seam.temporaryAliasExists).toBe(false)
    expect(seam.final).toEqual(Buffer.from('original target bytes', 'utf8'))
    expect(seam.pathnameFallbackCalled).toBe(false)
  })

  it('rejects an unsafe target observed immediately before swap, cleans its unpublished temporary, and never swaps', async () => {
    const api = await restrictedOverwrite()
    const seam = memoryProtocol({ beforeSwapLeaf: { type: 'symlink' } })

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'target_not_restricted_regular',
      phase: 'inspect_before_swap',
      publication: 'not_published',
      temporaryMayRemain: false
    })
    expect(seam.calls).toEqual([
      'bind',
      'inspect_initial',
      'temporary_create',
      'temporary_write',
      'inspect_before_swap',
      'temporary_file_close',
      'temporary_alias_cleanup',
      'prepublication_directory_sync',
      'directory_close',
      'completion'
    ])
    expect(seam.calls).not.toContain('swap_publication')
    expect(seam.temporaryAliasExists).toBe(false)
    expect(seam.final).toEqual(Buffer.from('original target bytes', 'utf8'))
  })

  it('allows a concurrent replacement by another single-link regular target: S3 is non-CAS', async () => {
    const api = await restrictedOverwrite()
    const seam = memoryProtocol({
      initialLeaf: regular(0o640),
      // This deliberately represents a different regular target. The seam
      // exposes no inode/device identity: S3 must re-check only type/nlink and
      // may publish over a concurrent regular replacement rather than acting as CAS.
      beforeSwapLeaf: regular(0o600)
    })

    await expect(api.overwriteExistingRestrictedAtWorkspaceContainedPath({
      workspaceRootPath: '/trusted/workspace',
      relativePath: 'notes/entry.txt',
      content: 'non-CAS replacement',
      operations: seam.operations
    })).resolves.toBeUndefined()

    expect(seam.calls).toContain('inspect_before_swap')
    expect(seam.calls).toContain('swap_publication')
    expect(seam.final).toEqual(Buffer.from('non-CAS replacement', 'utf8'))
    expect(seam.temporaryChmodMode).toBe(0o600)
    expect(seam.finalMode).toBe(0o600)
  })

  it('treats a target that becomes a directory during the swap syscall as not_published, cleans the candidate, and never retries the canonical target', async () => {
    const api = await restrictedOverwrite()
    const raceFailure = errno('target became a directory during the atomic swap', 'EISDIR')
    const seam = memoryProtocol({ failures: { publishSwap: raceFailure } })

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    // A throwing swap syscall has not crossed the sole publication marker.
    // `EISDIR` must not be guessed to mean publication might have happened.
    expect(error).toMatchObject({
      kind: 'prepublication_failure',
      phase: 'swap_publication',
      publication: 'not_published',
      temporaryMayRemain: false
    })
    expect(error.cause).toBe(raceFailure)
    expect(seam.calls.filter((call) => call === 'swap_publication')).toHaveLength(1)
    expect(seam.calls).toContain('temporary_alias_cleanup')
    expect(seam.final).toEqual(Buffer.from('original target bytes', 'utf8'))
    expect(seam.pathnameFallbackCalled).toBe(false)
  })

  it('fails closed when atomic exchange is unavailable: it cleans the unpublished candidate and never falls back to pathname replacement', async () => {
    const api = await restrictedOverwrite()
    const unavailable = errno('atomic exchange unavailable', 'ERR_CONTAINED_RESTRICTED_OVERWRITE_UNAVAILABLE')
    const seam = memoryProtocol({ failures: { publishSwap: unavailable } })

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'atomic_exchange_unavailable',
      phase: 'swap_publication',
      publication: 'not_published',
      temporaryMayRemain: false
    })
    expect(error.cause).toBe(unavailable)
    expect(seam.calls).toContain('temporary_alias_cleanup')
    expect(seam.calls.filter((call) => call === 'swap_publication')).toHaveLength(1)
    expect(seam.pathnameFallbackCalled).toBe(false)
  })

  it.each<[string, OperationCall]>([
    ['bind', 'bind'],
    ['initial inspection', 'inspectInitial'],
    ['temporary creation', 'createTemporary'],
    ['temporary write', 'writeTemporary'],
    ['pre-swap inspection', 'inspectBeforeSwap'],
    ['temporary chmod', 'chmodTemporary'],
    ['temporary file sync', 'syncTemporary'],
    ['temporary file close', 'closeTemporary'],
    ['swap publication', 'publishSwap']
  ])('classifies a pre-swap %s failure as not_published and cleans an owned temporary', async (_name, failingCall) => {
    const api = await restrictedOverwrite()
    const failure = errno(`failed ${failingCall}`, 'EIO')
    const seam = memoryProtocol({ failures: { [failingCall]: failure } })

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'prepublication_failure',
      phase: phaseForCall(failingCall),
      publication: 'not_published'
    })
    expect(error.cause).toBe(failure)
    // A throwing swap syscall is attempted exactly once but has not crossed
    // the publication marker. Earlier prepublication failures never invoke it.
    expect(seam.calls.filter((call) => call === 'swap_publication')).toHaveLength(
      failingCall === 'publishSwap' ? 1 : 0
    )
    if (failingCall !== 'bind' && failingCall !== 'inspectInitial' && failingCall !== 'createTemporary') {
      expect(seam.calls).toContain('temporary_alias_cleanup')
      expect(seam.calls).toContain('prepublication_directory_sync')
    }
    if (failingCall !== 'bind') expect(seam.calls).toContain('completion')
    expect(error.temporaryMayRemain).toBe(false)
    expect(seam.pathnameFallbackCalled).toBe(false)
  })

  it('keeps the original prepublication failure when candidate cleanup, cleanup directory sync, directory close, and completion all fail', async () => {
    const api = await restrictedOverwrite()
    const primaryFailure = errno('candidate write failed', 'EIO')
    const cleanupFailure = errno('candidate cleanup failed', 'EIO')
    const cleanupSyncFailure = errno('candidate cleanup sync failed', 'EIO')
    const closeFailure = errno('directory close failed', 'EIO')
    const completionFailure = errno('completion acknowledgement failed', 'EIO')
    const seam = memoryProtocol({
      failures: {
        writeTemporary: primaryFailure,
        cleanupTemporaryAlias: cleanupFailure,
        syncDirectory: cleanupSyncFailure,
        closeDirectory: closeFailure,
        complete: completionFailure
      }
    })

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'prepublication_failure',
      phase: 'temporary_write',
      publication: 'not_published',
      directoryDurability: 'not_confirmed',
      temporaryMayRemain: true
    })
    expect(error.cause).toBe(primaryFailure)
    expect(seam.calls).toEqual([
      'bind',
      'inspect_initial',
      'temporary_create',
      'temporary_write',
      'temporary_file_close',
      'temporary_alias_cleanup',
      'prepublication_directory_sync',
      'directory_close',
      'completion'
    ])
  })

  it.each<[string, OperationCall, RestrictedOverwritePhase, boolean]>([
    ['first directory sync', 'syncDirectory', 'first_directory_sync', true],
    ['temporary alias cleanup', 'cleanupTemporaryAlias', 'temporary_alias_cleanup', true],
    ['second directory sync', 'syncDirectory', 'second_directory_sync', false],
    ['directory close', 'closeDirectory', 'directory_close', false]
  ])('treats published %s failure as possibly_published without retrying the swap', async (
    _name,
    failingCall,
    expectedPhase,
    expectedTemporaryMayRemain
  ) => {
    const api = await restrictedOverwrite()
    const failure = errno(`failed ${failingCall}`, 'EIO')
    const seam = memoryProtocol({
      failures: { [failingCall]: failure },
      // The phase-specific tests for the two sync calls use an operation-count
      // gate below because both share the same seam operation.
      ...(failingCall === 'syncDirectory' && expectedPhase === 'second_directory_sync'
        ? { failures: {}, directorySyncUnsupportedAt: [] }
        : {})
    })
    if (failingCall === 'syncDirectory' && expectedPhase === 'second_directory_sync') {
      seam.failOnDirectorySyncCall(2, failure)
    }

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'possibly_published',
      phase: expectedPhase,
      publication: 'published',
      temporaryMayRemain: expectedTemporaryMayRemain
    })
    expect(error.cause).toBe(failure)
    expect(seam.calls.filter((call) => call === 'swap_publication')).toHaveLength(1)
    expect(seam.calls).toContain('completion')
    expect(seam.pathnameFallbackCalled).toBe(false)
  })

  it('requires first directory sync before cleanup and second directory sync after cleanup', async () => {
    const api = await restrictedOverwrite()
    const seam = memoryProtocol()

    await api.overwriteExistingRestrictedAtWorkspaceContainedPath({
      workspaceRootPath: '/trusted/workspace',
      relativePath: 'notes/entry.txt',
      content: 'replacement',
      operations: seam.operations
    })

    expect(seam.calls.indexOf('first_directory_sync')).toBeLessThan(seam.calls.indexOf('temporary_alias_cleanup'))
    expect(seam.calls.indexOf('temporary_alias_cleanup')).toBeLessThan(seam.calls.indexOf('second_directory_sync'))
  })

  it('allows only the directory-fsync capability downgrade, emits one generic warning, and never exposes sensitive values', async () => {
    const api = await restrictedOverwrite()
    const warnings: string[] = []
    const secretRoot = '/private/secret-workspace'
    const secretPath = 'secrets/private-note.txt'
    const secretContent = 'do not disclose this payload'
    const seam = memoryProtocol({ directorySyncUnsupportedAt: [1, 2] })
    const observed: RestrictedOverwritePhase[] = []

    await expect(api.overwriteExistingRestrictedAtWorkspaceContainedPath({
      workspaceRootPath: secretRoot,
      relativePath: secretPath,
      content: secretContent,
      operations: seam.operations,
      onOperation: ({ type }) => observed.push(type),
      warn: (message) => warnings.push(message)
    })).resolves.toBeUndefined()

    expect(warnings).toEqual([directorySyncWarning])
    expect(observed.filter((phase) => phase === 'warning')).toEqual(['warning'])
    for (const message of warnings) {
      expect(message).not.toContain(secretRoot)
      expect(message).not.toContain(secretPath)
      expect(message).not.toContain(secretContent)
    }
  })

  it('keeps the native directory-fsync capability downgrade limited to its five-errno allowlist', async () => {
    // The S3 seam intentionally receives the already-classified boolean so it
    // cannot widen the low-level compatibility policy. Read the native helper
    // directly, mirroring the S2 boundary test, to lock down all and only the
    // allowed downgrade errnos.
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

  it.each(['EIO', 'EPERM', 'EACCES'])('does not downgrade fatal directory-sync errno %s', async (code) => {
    const api = await restrictedOverwrite()
    const failure = errno(code, code)
    const seam = memoryProtocol()
    seam.failOnDirectorySyncCall(1, failure)

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'possibly_published',
      phase: 'first_directory_sync',
      publication: 'published',
      directoryDurability: 'not_confirmed',
      temporaryMayRemain: true
    })
    expect(error.cause).toBe(failure)
  })

  it('classifies an injected completion acknowledgement failure after publication as possibly_published without retrying the swap', async () => {
    const api = await restrictedOverwrite()
    const completionFailure = new Error('completion acknowledgement failed')
    const seam = memoryProtocol({ failures: { complete: completionFailure } })

    const error = await rejectRestrictedOverwrite(api, { operations: seam.operations })

    expect(error).toMatchObject({
      kind: 'possibly_published',
      phase: 'completion',
      publication: 'published',
      directoryDurability: 'confirmed',
      temporaryMayRemain: false
    })
    expect(error.cause).toBe(completionFailure)
    expect(seam.calls.filter((call) => call === 'swap_publication')).toHaveLength(1)
    expect(seam.calls.filter((call) => call === 'completion')).toHaveLength(1)
  })

  it('classifies a throwing warning observer after durable completion as possibly_published without retrying the swap', async () => {
    const api = await restrictedOverwrite()
    const warningFailure = new Error('warning listener failure')
    const seam = memoryProtocol({ directorySyncUnsupportedAt: [1] })

    const error = await rejectRestrictedOverwrite(api, {
      operations: seam.operations,
      warn: () => { throw warningFailure }
    })

    expect(error).toMatchObject({
      kind: 'possibly_published',
      phase: 'warning',
      publication: 'published',
      temporaryMayRemain: false
    })
    expect(error.cause).toBe(warningFailure)
    expect(seam.calls.filter((call) => call === 'swap_publication')).toHaveLength(1)
    expect(seam.calls.filter((call) => call === 'completion')).toHaveLength(1)
  })
})

describe.runIf(process.platform === 'darwin' || process.platform === 'linux')('workspace contained restricted-overwrite native macOS/Linux integration', () => {
  it.each([
    ['empty content', '', Buffer.alloc(0)],
    ['non-ASCII UTF-8 content', '你好, 🧪\n', Buffer.from('你好, 🧪\n', 'utf8')]
  ])('atomically replaces the complete old target with %s, preserves only ordinary mode bits, and leaves no alias', async (_name, content, expectedBytes) => {
    const root = await nativeTemporaryRoot()
    const parent = join(root, 'notes')
    const target = join(parent, 'entry.txt')
    const oldBytes = Buffer.from('complete old target bytes\n', 'utf8')

    await mkdir(parent)
    await writeFile(target, oldBytes)
    await chmod(target, 0o754)
    expect(await readFile(target)).toEqual(oldBytes)

    const api = await restrictedOverwrite()
    await expect(api.overwriteExistingRestrictedAtWorkspaceContainedPath({
      workspaceRootPath: root,
      relativePath: 'notes/entry.txt',
      content
    })).resolves.toBeUndefined()

    expect(await readFile(target)).toEqual(expectedBytes)
    // S3 preserves only ordinary permission bits. This intentionally makes no
    // assertion about setuid/setgid/sticky bits or any other metadata.
    expect((await stat(target)).mode & 0o777).toBe(0o754)
    expect((await stat(target)).isFile()).toBe(true)
    expect(await readdir(parent)).toEqual(['entry.txt'])
  })

  it('rejects absent, hard-linked, and symlink targets without changing any final leaf or leaving an alias', async () => {
    const root = await nativeTemporaryRoot()
    const parent = join(root, 'existing')
    const hardlinkSource = join(parent, 'hardlink-source.txt')
    const hardlinkTarget = join(parent, 'hardlink-target.txt')
    const symlinkTarget = join(parent, 'symlink-target.txt')
    const outsideTarget = join(root, 'outside.txt')
    const hardlinkBytes = Buffer.from('hardlink original bytes', 'utf8')
    const outsideBytes = Buffer.from('symlink destination original bytes', 'utf8')

    await mkdir(parent)
    await writeFile(hardlinkSource, hardlinkBytes)
    await link(hardlinkSource, hardlinkTarget)
    await writeFile(outsideTarget, outsideBytes)
    await symlink('../outside.txt', symlinkTarget)

    const api = await restrictedOverwrite()
    const cases: Array<{
      relativePath: string
      expectedKind: 'target_missing' | 'target_not_restricted_regular'
      verify: () => Promise<void>
    }> = [
      {
        relativePath: 'existing/missing.txt',
        expectedKind: 'target_missing',
        verify: async () => { await expect(lstat(join(parent, 'missing.txt'))).rejects.toMatchObject({ code: 'ENOENT' }) }
      },
      {
        relativePath: 'existing/hardlink-target.txt',
        expectedKind: 'target_not_restricted_regular',
        verify: async () => {
          expect(await readFile(hardlinkSource)).toEqual(hardlinkBytes)
          expect(await readFile(hardlinkTarget)).toEqual(hardlinkBytes)
          expect((await stat(hardlinkTarget)).nlink).toBeGreaterThanOrEqual(2)
        }
      },
      {
        relativePath: 'existing/symlink-target.txt',
        expectedKind: 'target_not_restricted_regular',
        verify: async () => {
          expect((await lstat(symlinkTarget)).isSymbolicLink()).toBe(true)
          expect(await readFile(outsideTarget)).toEqual(outsideBytes)
        }
      }
    ]

    for (const item of cases) {
      await expect(api.overwriteExistingRestrictedAtWorkspaceContainedPath({
        workspaceRootPath: root,
        relativePath: item.relativePath,
        content: 'must not publish'
      })).rejects.toMatchObject({
        kind: item.expectedKind,
        publication: 'not_published',
        temporaryMayRemain: false
      })
      await item.verify()
    }

    expect((await readdir(parent)).sort()).toEqual([
      'hardlink-source.txt',
      'hardlink-target.txt',
      'symlink-target.txt'
    ])
  })
})

async function restrictedOverwrite(): Promise<RestrictedOverwriteModule> {
  // A non-literal dynamic specifier intentionally keeps this contract file
  // type-checkable before the independently delivered S3 implementation lands.
  return await import(pathToFileURL(implementationPath).href) as RestrictedOverwriteModule
}

async function nativeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-restricted-overwrite-'))
  nativeRoots.push(root)
  return root
}

function regular(mode = 0o640): Extract<Leaf, { type: 'regular' }> {
  return { type: 'regular', mode, linkCount: 1 }
}

function errno(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function phaseForCall(call: OperationCall): RestrictedOverwritePhase {
  switch (call) {
    case 'bind': return 'bind'
    case 'inspectInitial': return 'inspect_initial'
    case 'createTemporary': return 'temporary_create'
    case 'writeTemporary': return 'temporary_write'
    case 'inspectBeforeSwap': return 'inspect_before_swap'
    case 'chmodTemporary': return 'temporary_chmod'
    case 'syncTemporary': return 'temporary_file_sync'
    case 'closeTemporary': return 'temporary_file_close'
    case 'publishSwap': return 'swap_publication'
    case 'syncDirectory': return 'first_directory_sync'
    case 'cleanupTemporaryAlias': return 'temporary_alias_cleanup'
    case 'closeDirectory': return 'directory_close'
    case 'complete': return 'completion'
  }
}

async function rejectRestrictedOverwrite(
  api: RestrictedOverwriteModule,
  input: Partial<RestrictedOverwriteInput> = {}
): Promise<RestrictedOverwriteError> {
  try {
    await api.overwriteExistingRestrictedAtWorkspaceContainedPath({
      workspaceRootPath: '/trusted/workspace',
      relativePath: 'notes/entry.txt',
      content: 'candidate content',
      ...input
    })
  } catch (error) {
    return error as RestrictedOverwriteError
  }
  throw new Error('Expected restricted overwrite to reject.')
}

function memoryProtocol(options: MemoryProtocolOptions = {}) {
  const calls: RestrictedOverwritePhase[] = []
  const parentDirectory: Directory = { nativeDirectory: { test: 'parent' } }
  const temporary: Temporary = { nativeTemporaryFile: { test: 'temporary' } }
  const binding: Binding = {
    relativePath: 'notes/entry.txt',
    basename: 'entry.txt',
    parentDirectory
  }
  let final = Buffer.from('original target bytes', 'utf8')
  let finalMode = options.initialLeaf?.type === 'regular' ? options.initialLeaf.mode : 0o640
  let temporaryBytes: Buffer | undefined
  let temporaryAliasExists = false
  let temporaryCreateMode: number | undefined
  let temporaryChmodMode: number | undefined
  let directoryCloseCount = 0
  let directorySyncCount = 0
  let published = false
  let pathnameFallbackCalled = false
  const directorySyncFailures = new Map<number, Error>()
  const fail = (call: OperationCall): void => {
    const failure = options.failures?.[call]
    if (failure) throw failure
  }
  const record = (phase: RestrictedOverwritePhase, call: OperationCall): void => {
    calls.push(phase)
    fail(call)
  }
  const operations: RestrictedOverwriteOperations = {
    bind: () => {
      record('bind', 'bind')
      return binding
    },
    inspectInitial: () => {
      record('inspect_initial', 'inspectInitial')
      return options.initialLeaf ?? regular()
    },
    createTemporary: (_directory, _temporaryName, requestedMode) => {
      record('temporary_create', 'createTemporary')
      temporaryCreateMode = requestedMode
      temporaryBytes = Buffer.alloc(0)
      return temporary
    },
    writeTemporary: (_temporary, bytes) => {
      record('temporary_write', 'writeTemporary')
      temporaryBytes = Buffer.from(bytes)
    },
    inspectBeforeSwap: () => {
      record('inspect_before_swap', 'inspectBeforeSwap')
      return options.beforeSwapLeaf ?? options.initialLeaf ?? regular()
    },
    chmodTemporary: (_temporary, mode, _directory, _basename) => {
      record('temporary_chmod', 'chmodTemporary')
      temporaryChmodMode = mode
    },
    syncTemporary: () => { record('temporary_file_sync', 'syncTemporary') },
    closeTemporary: () => { record('temporary_file_close', 'closeTemporary') },
    publishSwap: (_directory, _temporaryName, _basename, _temporary) => {
      record('swap_publication', 'publishSwap')
      final = temporaryBytes ?? Buffer.alloc(0)
      finalMode = temporaryChmodMode ?? finalMode
      temporaryAliasExists = true
      published = true
    },
    syncDirectory: () => {
      directorySyncCount += 1
      const phase: RestrictedOverwritePhase = !published
        ? 'prepublication_directory_sync'
        : directorySyncCount === 1 ? 'first_directory_sync' : 'second_directory_sync'
      calls.push(phase)
      const injected = directorySyncFailures.get(directorySyncCount)
      if (injected) throw injected
      fail('syncDirectory')
      return { directorySyncUnsupported: options.directorySyncUnsupportedAt?.includes(directorySyncCount) === true }
    },
    cleanupTemporaryAlias: () => {
      record('temporary_alias_cleanup', 'cleanupTemporaryAlias')
      temporaryBytes = undefined
      temporaryAliasExists = false
    },
    closeDirectory: () => {
      directoryCloseCount += 1
      record('directory_close', 'closeDirectory')
    },
    complete: () => { record('completion', 'complete') }
  }

  return {
    operations,
    calls,
    get final() { return final },
    get finalMode() { return finalMode },
    get temporaryAliasExists() { return temporaryAliasExists || temporaryBytes !== undefined },
    get temporaryCreateMode() { return temporaryCreateMode },
    get temporaryChmodMode() { return temporaryChmodMode },
    get directoryCloseCount() { return directoryCloseCount },
    get pathnameFallbackCalled() { return pathnameFallbackCalled },
    failOnDirectorySyncCall(call: number, failure: Error): void {
      directorySyncFailures.set(call, failure)
    }
  }
}
