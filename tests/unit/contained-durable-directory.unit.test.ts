import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  closeContainedDurableDirectory,
  getDescriptorRelativeDirectoryCapability,
  listContainedDirectory,
  openContainedDirectoryChild,
  openContainedDurableDirectory,
  openContainedRootDirectory,
  readRegularFileAtContainedDirectory,
  replaceDurablyInContainedDirectory,
  resolveContainedDurableReplaceAddonPath
} from '../../src/main/persistence/contained-durable-directory'

const roots: string[] = []
const execFileAsync = promisify(execFile)
// `mkfifo` returns a nonzero status with no operands, so only ENOENT means the
// environment lacks the tool. Any other execution failure remains a test error.
const mkfifoUnavailable = spawnSync('mkfifo', [], { stdio: 'ignore' }).error?.code === 'ENOENT'

type NativeAddonForTest = {
  openContainedRootDirectory: (physicalParentPath: string, rootName: string, createIfMissing: boolean) => unknown
  openContainedDirectoryChild: (directory: unknown, name: string, createIfMissing: boolean) => unknown
  readRegularFileAtContainedDirectory: (directory: unknown, filename: string) => Buffer
  replaceAtContainedDirectory: (directory: unknown, filename: string, temporaryName: string, content: Buffer) => Promise<unknown>
  closeContainedDirectory: (directory: unknown) => void
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('descriptor-relative contained directory capability', () => {
  it('fails closed for an unsupported platform and rejects invalid configured roots', () => {
    expect(getDescriptorRelativeDirectoryCapability({ platform: 'win32' })).toEqual({
      available: false,
      reason: 'unsupported_platform'
    })
    expect(() => openContainedRootDirectory('  ', false)).toThrow('root directory path is invalid')
    expect(() => openContainedRootDirectory('/safe\0root', false)).toThrow('root directory path is invalid')
    expect(() => openContainedDurableDirectory('/safe\0root')).toThrow('root directory path is invalid')
  })
})

describe.runIf(process.platform !== 'win32')('POSIX descriptor-relative contained directory operations', () => {
  it('rejects symlink children/final files and never accepts traversal components', async () => {
    const root = await temporaryRoot()
    const external = await temporaryRoot()
    const rootDirectory = openContainedRootDirectory(root, false)
    try {
      expect(() => openContainedDirectoryChild(rootDirectory, '../outside', false)).toThrow('child directory name is invalid')
      await symlink(external, join(root, 'partition'))
      expect(() => openContainedDirectoryChild(rootDirectory, 'partition', false)).toThrow()

      await writeFile(join(root, 'regular.json'), 'safe')
      await symlink(join(external, 'outside.json'), join(root, 'linked.json'))
      expect(listContainedDirectory(rootDirectory)).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'linked.json', type: 'symlink' }),
        expect.objectContaining({ name: 'regular.json', type: 'file' })
      ]))
      expect(readRegularFileAtContainedDirectory(rootDirectory, 'regular.json').toString()).toBe('safe')
      expect(() => readRegularFileAtContainedDirectory(rootDirectory, 'linked.json')).toThrow()
      expect(() => readRegularFileAtContainedDirectory(rootDirectory, '../regular.json')).toThrow('regular file name is invalid')
    } finally {
      closeContainedDurableDirectory(rootDirectory)
    }
  })

  it('canonicalizes the trusted configured parent but rejects a malicious final-root symlink', async () => {
    const parent = await temporaryRoot()
    const external = await temporaryRoot()
    const rootPath = join(parent, 'memory-root')
    const rootDirectory = openContainedRootDirectory(rootPath, true)
    try {
      expect((await stat(rootPath)).isDirectory()).toBe(true)
      await symlink(external, join(parent, 'linked-root'))
      expect(() => openContainedRootDirectory(join(parent, 'linked-root'), true)).toThrow()
      expect(() => openContainedRootDirectory(join(parent, 'missing-parent', 'blocked-root'), true)).toThrow(
        'cannot be canonicalized'
      )
    } finally {
      closeContainedDurableDirectory(rootDirectory)
    }
  })

  it('opens a logical /var configured root by binding its canonical parent once', async () => {
    const logicalParent = await mkdtemp('/var/tmp/studiumx-contained-directory-var-')
    roots.push(logicalParent)
    const physicalParent = await realpath(logicalParent)
    const rootPath = join(logicalParent, 'memory-root')
    const rootDirectory = openContainedRootDirectory(rootPath, true)
    try {
      expect(logicalParent.startsWith('/var/')).toBe(true)
      if (process.platform === 'darwin') expect(physicalParent.startsWith('/private/var/')).toBe(true)
      expect((await stat(join(physicalParent, 'memory-root'))).isDirectory()).toBe(true)
    } finally {
      closeContainedDurableDirectory(rootDirectory)
    }
  })

  it.skipIf(mkfifoUnavailable)('rejects a FIFO immediately rather than blocking on a descriptor-relative read', async () => {
    const root = await temporaryRoot()
    const fifoName = 'blocked.fifo'
    await execFileAsync('mkfifo', [join(root, fifoName)])

    const addonPath = resolveContainedDurableReplaceAddonPath()
    const result = await execFileAsync(process.execPath, [
      '-e',
      [
        'const addon = require(process.argv[1]);',
        'const directory = addon.openContainedRootDirectory(process.argv[2], process.argv[3], false);',
        'try {',
        '  try { addon.readRegularFileAtContainedDirectory(directory, process.argv[4]); process.exitCode = 1; }',
        '  catch { process.exitCode = 0; }',
        '} finally { addon.closeContainedDirectory(directory); }'
      ].join('\n'),
      addonPath,
      dirname(root),
      basename(root),
      fifoName
    ], { timeout: 2_000, killSignal: 'SIGKILL' })
    expect(result.stderr).toBe('')
  })

  it('rejects embedded NUL paths and names in both wrapper and native-facing calls', async () => {
    const root = await temporaryRoot()
    const rootDirectory = openContainedRootDirectory(root, false)
    const native = loadNativeAddon()
    try {
      expect(() => openContainedDirectoryChild(rootDirectory, 'child\0name', false)).toThrow('child directory name is invalid')
      expect(() => readRegularFileAtContainedDirectory(rootDirectory, 'file\0name.json')).toThrow('regular file name is invalid')
      await expect(replaceDurablyInContainedDirectory({
        directory: rootDirectory,
        filename: 'final\0name.json',
        content: 'blocked'
      })).rejects.toThrow('filename is invalid')

      expect(() => native.openContainedRootDirectory(`${dirname(root)}\0suffix`, basename(root), false)).toThrow()
      expect(() => native.openContainedRootDirectory(dirname(root), `${basename(root)}\0suffix`, false)).toThrow()
      expect(() => native.openContainedDirectoryChild(rootDirectory.nativeDirectory, 'child\0name', false)).toThrow()
      expect(() => native.readRegularFileAtContainedDirectory(rootDirectory.nativeDirectory, 'file\0name.json')).toThrow()
      expect(() => native.replaceAtContainedDirectory(rootDirectory.nativeDirectory, 'final\0name.json', '.temporary', Buffer.from('blocked'))).toThrow()
      expect(() => native.replaceAtContainedDirectory(rootDirectory.nativeDirectory, 'final.json', '.temporary\0name', Buffer.from('blocked'))).toThrow()
    } finally {
      closeContainedDurableDirectory(rootDirectory)
    }
  })

  it('keeps reads and durable writes bound to the opened directory through a pathname swap', async () => {
    const root = await temporaryRoot()
    const external = await temporaryRoot()
    const partitionPath = join(root, 'partition')
    const movedPartitionPath = join(root, 'partition-moved')
    await mkdir(partitionPath)
    await writeFile(join(partitionPath, 'memory.json'), 'before')

    const rootDirectory = openContainedRootDirectory(root, false)
    const partitionDirectory = openContainedDirectoryChild(rootDirectory, 'partition', false)
    try {
      await rename(partitionPath, movedPartitionPath)
      await symlink(external, partitionPath)

      expect(readRegularFileAtContainedDirectory(partitionDirectory, 'memory.json').toString()).toBe('before')
      await replaceDurablyInContainedDirectory({
        directory: partitionDirectory,
        filename: 'memory.json',
        content: 'after'
      })

      await expect(readFile(join(movedPartitionPath, 'memory.json'), 'utf8')).resolves.toBe('after')
      await expect(readFile(join(external, 'memory.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      closeContainedDurableDirectory(partitionDirectory)
      closeContainedDurableDirectory(rootDirectory)
    }
  })

  it('retains native no-follow, CLOEXEC, nonblocking, and durable-root seams without a C-6 pathname fallback', async () => {
    const nativeSource = await readFile(join(process.cwd(), 'native', 'contained-durable-replace', 'contained_durable_replace.cc'), 'utf8')
    const recordFileSource = await readFile(join(process.cwd(), 'src', 'main', 'teaching-memory-catalog', 'record-file.ts'), 'utf8')
    const catalogSource = await readFile(join(process.cwd(), 'src', 'main', 'teaching-memory-catalog.ts'), 'utf8')
    expect(nativeSource).toContain('openat(')
    expect(nativeSource).toContain('fstatat(')
    expect(nativeSource).toContain('readRegularFileAtContainedDirectory')
    expect(nativeSource).toContain('renameat(')
    expect(nativeSource).toContain('O_NOFOLLOW')
    expect(nativeSource).toContain('O_NONBLOCK')
    expect(nativeSource).toContain('F_DUPFD_CLOEXEC')
    expect(nativeSource).toContain('FD_CLOEXEC')
    expect(nativeSource).not.toContain('F_DUPFD,')
    expect(nativeSource).not.toContain('F_GETFD')
    expect(nativeSource).not.toContain('F_SETFD')
    expect(nativeSource).toContain('DuplicateFileDescriptorCloseOnExec(capability->fd, &listing_fd')
    expect(nativeSource).toContain('DuplicateFileDescriptorCloseOnExec(capability->fd, &work->directory_fd')
    expect(nativeSource).toContain('OpenConfiguredRootDirectory')
    expect(nativeSource).toContain('mkdirat(parent_fd.get(), root_name.c_str(), 0700)')
    expect(nativeSource).toContain('SyncDirectoryEntry(parent_fd.get(), directory_sync_unsupported, "contained root directory", error)')
    expect(nativeSource).toContain('openat(parent_fd.get(), root_name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)')
    expect(catalogSource).toContain('readRegularFileAtContainedDirectory')
    expect(recordFileSource).toContain('replaceDurablyInContainedDirectory')
    expect(catalogSource).not.toContain('readContainedRegularFile')
    expect(recordFileSource).not.toContain('replaceDurably({')
  })
})

function loadNativeAddon(): NativeAddonForTest {
  return createRequire(import.meta.url)(resolveContainedDurableReplaceAddonPath()) as NativeAddonForTest
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-contained-directory-'))
  roots.push(root)
  // Preserve the configured logical pathname. On macOS this commonly begins
  // under /var and verifies canonical-parent binding in ordinary catalog tests.
  return root
}
