import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isSettlementDirectoryFsyncUnsupported,
  replaceContainedSettlementFile,
  resolveContainedWorkspaceFilePath,
  SettlementPathError,
  SETTLEMENT_DIRECTORY_FSYNC_UNSUPPORTED_CODES,
  syncSettlementDirectory
} from '../../src/main/persistence/settlement-durable-io'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-settlement-io-'))
  roots.push(root)
  await mkdir(join(root, 'learning-sessions', 'session-1'), { recursive: true })
  return root
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('settlement-durable-io', () => {
  it('exports the frozen soft-unsupported directory fsync allowlist', () => {
    expect([...SETTLEMENT_DIRECTORY_FSYNC_UNSUPPORTED_CODES]).toEqual([
      'EINVAL',
      'ENOSYS',
      'ENOTSUP',
      'EOPNOTSUPP',
      'EISDIR'
    ])
    for (const code of SETTLEMENT_DIRECTORY_FSYNC_UNSUPPORTED_CODES) {
      expect(isSettlementDirectoryFsyncUnsupported(errno(code))).toBe(true)
    }
    for (const code of ['EPERM', 'EACCES', 'EIO', 'EBADF']) {
      expect(isSettlementDirectoryFsyncUnsupported(errno(code))).toBe(false)
    }
  })

  it('soft-downgrades only the shared unsupported set and keeps permission faults fatal', async () => {
    for (const code of SETTLEMENT_DIRECTORY_FSYNC_UNSUPPORTED_CODES) {
      const warnings: string[] = []
      await expect(syncSettlementDirectory({
        directoryPath: '/tmp',
        operations: {
          open: async () => {
            throw errno(code)
          }
        },
        warn: (message) => warnings.push(message)
      })).resolves.toBe('unsupported')
      expect(warnings).toEqual([
        '[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'
      ])
    }

    for (const code of ['EPERM', 'EACCES', 'EIO']) {
      await expect(syncSettlementDirectory({
        directoryPath: '/tmp',
        operations: {
          open: async () => {
            throw errno(code)
          }
        }
      })).rejects.toMatchObject({ code })
    }
  })

  it('publishes settlement files only after parent Session containment succeeds', async () => {
    const workspaceRoot = await createWorkspace()
    const relativePath = 'learning-sessions/session-1/outcome.json'
    await replaceContainedSettlementFile({
      workspaceRoot,
      relativePath,
      content: '{"k":1}'
    })
    await expect(readFile(join(workspaceRoot, relativePath), 'utf8')).resolves.toBe('{"k":1}')
  })

  it('fails closed on symlink parents without publishing', async () => {
    const workspaceRoot = await createWorkspace()
    const outside = await mkdtemp(join(tmpdir(), 'studiumx-settlement-outside-'))
    roots.push(outside)
    const sessionPath = join(workspaceRoot, 'learning-sessions', 'session-1')
    await rm(sessionPath, { recursive: true, force: true })
    try {
      await symlink(outside, sessionPath, 'dir')
    } catch (error) {
      // Directory symlinks require Developer Mode or elevation on many Windows hosts.
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    await expect(replaceContainedSettlementFile({
      workspaceRoot,
      relativePath: 'learning-sessions/session-1/outcome.json',
      content: 'poison'
    })).rejects.toBeInstanceOf(SettlementPathError)

    await expect(readFile(join(outside, 'outcome.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed on relative path escape without publishing', async () => {
    const workspaceRoot = await createWorkspace()
    await expect(resolveContainedWorkspaceFilePath(workspaceRoot, '../escape.json'))
      .rejects.toMatchObject({ code: 'invalid_relative_path' })
    await expect(replaceContainedSettlementFile({
      workspaceRoot,
      relativePath: '../escape.json',
      content: 'poison'
    })).rejects.toMatchObject({ code: 'invalid_relative_path' })
  })

  it('fails closed when the Session parent directory is missing', async () => {
    const workspaceRoot = await createWorkspace()
    await expect(resolveContainedWorkspaceFilePath(
      workspaceRoot,
      'learning-sessions/missing-session/outcome.json'
    )).rejects.toMatchObject({ code: 'parent_missing' })
  })
})
