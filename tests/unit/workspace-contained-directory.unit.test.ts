import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindWorkspaceContainedPath,
  closeContainedDurableDirectory,
  getContainedDurableDirectoryCapability,
  parseWorkspaceContainedRelativePath,
  type ContainedDurableDirectory,
  type WorkspaceContainedDirectoryOperations,
  WorkspaceContainedDirectoryError
} from '../../src/main/persistence/contained-durable-directory'

const roots: string[] = []
const execFileAsync = promisify(execFile)
// `mkfifo` returns a nonzero status without an operand, so only ENOENT means
// this host cannot exercise the FIFO classification.
const mkfifoUnavailable = spawnSync('mkfifo', [], { stdio: 'ignore' }).error?.code === 'ENOENT'
const supportsNativePosix = process.platform === 'darwin' || process.platform === 'linux'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace descriptor-relative path parser', () => {
  it('normalizes both separator forms into descriptor-safe POSIX components', () => {
    expect(parseWorkspaceContainedRelativePath('plans\\\\week-1//notes\\today.md')).toEqual({
      relativePath: 'plans/week-1/notes/today.md',
      parentComponents: ['plans', 'week-1', 'notes'],
      basename: 'today.md'
    })
  })

  it.each([
    ['', 'blank'],
    ['   ', 'blank'],
    ['leaf\0name', 'NUL'],
    ['/tmp/leaf', 'POSIX absolute'],
    ['\\tmp\\leaf', 'backslash absolute'],
    ['C:\\temp\\leaf', 'drive absolute'],
    ['C:/temp/leaf', 'drive absolute'],
    ['\\\\server\\share\\leaf', 'UNC absolute'],
    ['../leaf', 'parent traversal'],
    ['safe/../leaf', 'nested parent traversal'],
    ['./leaf', 'current-directory traversal'],
    ['safe/.', 'current-directory basename']
  ])('rejects %s (%s)', (value) => {
    const error = expectWorkspaceError(() => parseWorkspaceContainedRelativePath(value), 'invalid_relative_path')
    expect(error.message).toMatch(/empty|NUL|absolute|unsafe/i)
  })
})

describe('workspace descriptor-relative capability boundary', () => {
  it('fails closed on an unsupported host before it can bind or traverse a workspace pathname', async () => {
    const workspaceRoot = await temporaryRoot()
    const missingParent = join(workspaceRoot, 'must-not-be-created')

    withProcessPlatform('win32', () => {
      expect(getContainedDurableDirectoryCapability()).toEqual({
        available: false,
        reason: 'unsupported_platform'
      })
      expectWorkspaceError(
        () => bindWorkspaceContainedPath({
          workspaceRootPath: missingParent,
          relativePath: 'nested/leaf.txt',
          createParentDirectories: true
        }),
        'descriptor_capability_unavailable'
      )
    })

    await expect(stat(missingParent)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a missing addon capability as unavailable without a pathname fallback', async () => {
    vi.resetModules()
    const persistence = await import('../../src/main/persistence/contained-durable-directory')
    const nonexistentProjectRoot = join(await temporaryRoot(), 'no-native-addon-here')

    expect(persistence.getContainedDurableDirectoryCapability({
      platform: supportsNativePosix ? process.platform : 'win32',
      resolver: { projectRoot: nonexistentProjectRoot }
    })).toEqual(supportsNativePosix
      ? { available: false, reason: 'native_unavailable' }
      : { available: false, reason: 'unsupported_platform' })
  })
})

describe.runIf(supportsNativePosix)('workspace descriptor-bound directory foundation', () => {
  it('binds only an existing trusted root and rejects root and child symlinks', async () => {
    const workspaceRoot = await temporaryRoot()
    const external = await temporaryRoot()
    const missingRoot = join(workspaceRoot, 'missing-workspace-root')
    const linkedRoot = join(workspaceRoot, 'linked-workspace-root')
    await symlink(external, linkedRoot)

    expectWorkspaceError(
      () => bindWorkspaceContainedPath({
        workspaceRootPath: missingRoot,
        relativePath: 'notes/today.md',
        createParentDirectories: true
      }),
      'workspace_root_bind_failed'
    )
    await expect(stat(missingRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    expectWorkspaceError(
      () => bindWorkspaceContainedPath({
        workspaceRootPath: linkedRoot,
        relativePath: 'notes/today.md',
        createParentDirectories: true
      }),
      'workspace_root_bind_failed'
    )

    await symlink(external, join(workspaceRoot, 'linked-parent'))
    expectWorkspaceError(
      () => bindWorkspaceContainedPath({
        workspaceRootPath: workspaceRoot,
        relativePath: 'linked-parent/today.md',
        createParentDirectories: true
      }),
      'parent_component_open_failed'
    )
    await expect(stat(join(external, 'today.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates nested workspace parent components with ordinary mkdir permissions', async () => {
    const workspaceRoot = await temporaryRoot()
    const originalUmask = process.umask(0)
    try {
      const binding = bindWorkspaceContainedPath({
        workspaceRootPath: workspaceRoot,
        relativePath: 'one/two/final.txt',
        createParentDirectories: true
      })
      try {
        expect(binding.parentComponents).toEqual(['one', 'two'])
        expect(binding.basename).toBe('final.txt')
        expect((await stat(join(workspaceRoot, 'one'))).mode & 0o777).toBe(0o777)
        expect((await stat(join(workspaceRoot, 'one', 'two'))).mode & 0o777).toBe(0o777)
        expect(binding.inspectLeaf()).toEqual({ type: 'absent' })
      } finally {
        binding.close()
      }
    } finally {
      process.umask(originalUmask)
    }
  })

  it('classifies absent, regular, directory, and symlink final leaves without following links', async () => {
    const workspaceRoot = await temporaryRoot()
    const external = await temporaryRoot()
    const parentPath = join(workspaceRoot, 'targets', 'nested')
    const setup = bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'targets/nested/setup.txt',
      createParentDirectories: true
    })
    setup.close()

    await writeFile(join(parentPath, 'regular.txt'), 'safe')
    await mkdir(join(parentPath, 'directory.txt'))
    await symlink(join(external, 'elsewhere.txt'), join(parentPath, 'symlink.txt'))

    const absent = bindWorkspaceContainedPath({ workspaceRootPath: workspaceRoot, relativePath: 'targets/nested/absent.txt' })
    const regular = bindWorkspaceContainedPath({ workspaceRootPath: workspaceRoot, relativePath: 'targets/nested/regular.txt' })
    const directory = bindWorkspaceContainedPath({ workspaceRootPath: workspaceRoot, relativePath: 'targets/nested/directory.txt' })
    const linked = bindWorkspaceContainedPath({ workspaceRootPath: workspaceRoot, relativePath: 'targets/nested/symlink.txt' })
    try {
      expect(absent.inspectLeaf()).toEqual({ type: 'absent' })
      const regularLeaf = regular.inspectLeaf()
      expect(regularLeaf).toMatchObject({ type: 'regular', mode: expect.any(Number), linkCount: expect.any(Number) })
      if (regularLeaf.type === 'regular') expect(regularLeaf.linkCount).toBeGreaterThan(0)
      expect(directory.inspectLeaf()).toEqual({ type: 'directory' })
      expect(linked.inspectLeaf()).toEqual({ type: 'symlink' })
    } finally {
      linked.close()
      directory.close()
      regular.close()
      absent.close()
    }
  })

  it.runIf(!mkfifoUnavailable)('classifies a FIFO final leaf as other where the host permits FIFOs', async () => {
    const workspaceRoot = await temporaryRoot()
    const setup = bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'targets/nested/setup.txt',
      createParentDirectories: true
    })
    setup.close()

    const fifoPath = join(workspaceRoot, 'targets', 'nested', 'pipe')
    await execFileAsync('mkfifo', [fifoPath])
    const binding = bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'targets/nested/pipe'
    })
    try {
      expect(binding.inspectLeaf()).toEqual({ type: 'other' })
    } finally {
      binding.close()
    }
  })

  it('keeps leaf inspection bound to the original parent descriptor through a pathname swap', async () => {
    const workspaceRoot = await temporaryRoot()
    const external = await temporaryRoot()
    const parentPath = join(workspaceRoot, 'records')
    const movedParentPath = join(workspaceRoot, 'records-original')
    await mkdir(parentPath)
    await writeFile(join(parentPath, 'today.md'), 'original descriptor target')
    await mkdir(join(external, 'today.md'))

    const binding = bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'records/today.md'
    })
    try {
      await rename(parentPath, movedParentPath)
      await symlink(external, parentPath)

      expect(binding.inspectLeaf()).toMatchObject({ type: 'regular' })
      expect((await stat(join(movedParentPath, 'today.md'))).isFile()).toBe(true)
      expect((await stat(join(external, 'today.md'))).isDirectory()).toBe(true)
    } finally {
      binding.close()
    }
  })

  it('orders injected descriptor operations deterministically and closes superseded parents exactly once', async () => {
    const workspaceRoot = await temporaryRoot()
    const operations: string[] = []
    const observed: string[] = []
    let rootDirectory: ContainedDurableDirectory | undefined
    const alpha: ContainedDurableDirectory = { nativeDirectory: { name: 'alpha' } }
    const beta: ContainedDurableDirectory = { nativeDirectory: { name: 'beta' } }

    const binding = bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'alpha/beta/leaf.txt',
      createParentDirectories: true,
      onOperation: (operation) => observed.push(operation.type === 'open_or_create_component'
        ? `${operation.type}:${operation.component}:${operation.createIfMissing}`
        : operation.type === 'inspect_leaf'
          ? `${operation.type}:${operation.basename}`
          : operation.type),
      operations: {
        openOrCreateComponent(parent, component, createIfMissing) {
          operations.push(`open:${component}:${createIfMissing}`)
          if (!rootDirectory) rootDirectory = parent
          return component === 'alpha' ? alpha : beta
        },
        inspectLeaf(directory, basename) {
          operations.push(`inspect:${directory === beta ? 'beta' : 'unexpected'}:${basename}`)
          return { type: 'absent' }
        },
        syncDirectory(directory) {
          operations.push(`sync:${directory === beta ? 'beta' : 'unexpected'}`)
        },
        closeDirectory(directory) {
          operations.push(`close:${directory === rootDirectory ? 'root' : directory === alpha ? 'alpha' : 'beta'}`)
          if (directory === rootDirectory) closeContainedDurableDirectory(directory)
        }
      }
    })
    try {
      expect(binding.inspectLeaf()).toEqual({ type: 'absent' })
      binding.syncParentDirectory()
    } finally {
      binding.close()
    }

    expect(operations).toEqual([
      'open:alpha:true',
      'close:root',
      'open:beta:true',
      'close:alpha',
      'inspect:beta:leaf.txt',
      'sync:beta',
      'close:beta'
    ])
    expect(observed).toEqual([
      'open_or_create_component:alpha:true',
      'close_directory',
      'open_or_create_component:beta:true',
      'close_directory',
      'inspect_leaf:leaf.txt',
      'sync_directory',
      'close_directory'
    ])
  })

  it('wraps an injected parent open/create failure and closes the retained root', async () => {
    const workspaceRoot = await temporaryRoot()
    const events: string[] = []
    let rootDirectory: ContainedDurableDirectory | undefined
    const cause = new Error('parent open failed')

    const error = expectWorkspaceError(() => bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'parent/leaf.txt',
      createParentDirectories: true,
      operations: {
        openOrCreateComponent(parent, component, createIfMissing) {
          rootDirectory = parent
          events.push(`open:${component}:${createIfMissing}`)
          throw cause
        },
        closeDirectory(directory) {
          events.push(`close:${directory === rootDirectory ? 'root' : 'unexpected'}`)
          if (directory === rootDirectory) closeContainedDurableDirectory(directory)
        }
      }
    }), 'parent_component_open_failed')

    expect(error.cause).toBe(cause)
    expect(events).toEqual(['open:parent:true', 'close:root'])
  })

  it('wraps an injected leaf inspection failure and leaves closing explicit to the binding owner', async () => {
    const workspaceRoot = await temporaryRoot()
    const events: string[] = []
    const cause = new Error('inspection failed')
    const binding = bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'leaf.txt',
      onOperation: (operation) => events.push(operation.type),
      operations: {
        inspectLeaf() {
          throw cause
        },
        closeDirectory(directory) {
          events.push('close-implementation')
          closeContainedDurableDirectory(directory)
        }
      }
    })
    try {
      const error = expectWorkspaceError(() => binding.inspectLeaf(), 'leaf_inspection_failed')
      expect(error.cause).toBe(cause)
      expect(events).toEqual(['inspect_leaf'])
    } finally {
      binding.close()
    }
    expect(events).toEqual(['inspect_leaf', 'close_directory', 'close-implementation'])
  })

  it('wraps an injected directory sync failure without closing the retained binding', async () => {
    const workspaceRoot = await temporaryRoot()
    const events: string[] = []
    const cause = new Error('sync failed')
    const binding = bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'leaf.txt',
      onOperation: (operation) => events.push(operation.type),
      operations: {
        syncDirectory() {
          throw cause
        },
        closeDirectory(directory) {
          events.push('close-implementation')
          closeContainedDurableDirectory(directory)
        }
      }
    })
    try {
      const error = expectWorkspaceError(() => binding.syncParentDirectory(), 'directory_sync_failed')
      expect(error.cause).toBe(cause)
      expect(events).toEqual(['sync_directory'])
    } finally {
      binding.close()
    }
    expect(events).toEqual(['sync_directory', 'close_directory', 'close-implementation'])
  })

  it('preserves a superseded-parent checked-close failure while cleaning the new child without retrying the failed root', async () => {
    const workspaceRoot = await temporaryRoot()
    const events: string[] = []
    const cause = new Error('root close failed')
    let rootDirectory: ContainedDurableDirectory | undefined
    const child: ContainedDurableDirectory = { nativeDirectory: { name: 'child' } }

    try {
      const error = expectWorkspaceError(() => bindWorkspaceContainedPath({
        workspaceRootPath: workspaceRoot,
        relativePath: 'child/leaf.txt',
        operations: {
          openOrCreateComponent(parent) {
            rootDirectory = parent
            events.push('open:child')
            return child
          },
          closeDirectory(directory) {
            events.push(directory === rootDirectory ? 'close:root' : 'close:child')
            if (directory === rootDirectory) throw cause
          }
        }
      }), 'directory_close_failed')
      expect(error.kind).toBe('directory_close_failed')
      expect(error.cause).toBe(cause)
      expect(events).toEqual(['open:child', 'close:root', 'close:child'])
    } finally {
      if (rootDirectory) closeContainedDurableDirectory(rootDirectory)
    }
  })

  it('wraps a final binding close failure once, marks the binding closed, and never performs an implicit retry', async () => {
    const workspaceRoot = await temporaryRoot()
    const events: string[] = []
    const cause = new Error('final close failed')
    let retainedDirectory: ContainedDurableDirectory | undefined
    const operations: Pick<WorkspaceContainedDirectoryOperations, 'closeDirectory' | 'inspectLeaf'> = {
      inspectLeaf() {
        events.push('inspect-implementation')
        return { type: 'absent' }
      },
      closeDirectory(directory) {
        retainedDirectory = directory
        events.push('close-implementation')
        throw cause
      }
    }
    const binding = bindWorkspaceContainedPath({
      workspaceRootPath: workspaceRoot,
      relativePath: 'leaf.txt',
      onOperation: (operation) => events.push(operation.type),
      operations
    })

    try {
      const error = expectWorkspaceError(() => binding.close(), 'directory_close_failed')
      expect(error.cause).toBe(cause)
      expectWorkspaceError(() => binding.inspectLeaf(), 'directory_close_failed')
      binding.close()
      expect(events).toEqual(['close_directory', 'close-implementation'])
    } finally {
      if (retainedDirectory) closeContainedDurableDirectory(retainedDirectory)
    }
  })
})

function expectWorkspaceError(call: () => unknown, kind: WorkspaceContainedDirectoryError['kind']): WorkspaceContainedDirectoryError {
  try {
    call()
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceContainedDirectoryError)
    expect((error as WorkspaceContainedDirectoryError).kind).toBe(kind)
    return error as WorkspaceContainedDirectoryError
  }
  throw new Error(`Expected WorkspaceContainedDirectoryError(${kind}).`)
}

function withProcessPlatform<T>(platform: NodeJS.Platform, action: () => T): T {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!originalDescriptor) throw new Error('Unable to read process.platform descriptor.')
  Object.defineProperty(process, 'platform', { ...originalDescriptor, value: platform })
  try {
    return action()
  } finally {
    Object.defineProperty(process, 'platform', originalDescriptor)
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-workspace-contained-directory-'))
  roots.push(root)
  return root
}
