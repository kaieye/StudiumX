import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open as openFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  releaseWorkspaceChangeCheckpoint,
  TeachingWorkspaceChangeAudit
} from '../../src/main/teaching-workspace-change-audit'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const execFile = promisify(execFileCallback)
const runtimeScope = createVitestRuntimeScope()

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
  })
  return stdout.trim()
}

async function createRepository(name: string): Promise<string> {
  const runtime = await runtimeScope.create(`change-audit-${name}`)
  const root = runtime.paths.workspace
  await execFile('git', ['init', root], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  await git(root, ['config', 'user.email', 'audit@example.test'])
  await git(root, ['config', 'user.name', 'Change Audit Test'])
  await writeFile(join(root, 'modified.md'), '# Before\n')
  await writeFile(join(root, 'deleted.md'), '# Delete me\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'Baseline'])
  return root
}

function directorySyncFailingOperations(options: {
  directoryPath: string
  shouldFail: () => boolean
}): DurableFileOperations {
  return {
    mkdir,
    readFile,
    rename,
    rm,
    open: async (path, flags, mode) => {
      const handle = await openFile(path, flags, mode)
      return {
        writeFile: (content) => handle.writeFile(content),
        sync: async () => {
          // Injected operations stay on the strict error path (see durable-file
          // syncDirectory). Prefer throwing the simulated I/O failure without
          // calling the real directory handle.sync(), which returns EPERM on
          // Windows and would mask the intended EIO publication failure.
          if (path === options.directoryPath && options.shouldFail()) {
            throw Object.assign(new Error('EIO'), { code: 'EIO' })
          }
          if (path === options.directoryPath) return
          await handle.sync()
        },
        close: () => handle.close()
      }
    }
  }
}

async function withGitUnavailable<T>(root: string, action: () => Promise<T>): Promise<T> {
  const emptyPath = join(root, 'no-git-in-path')
  await mkdir(emptyPath, { recursive: true })
  const path = process.env.PATH
  const pathCase = process.env.Path
  process.env.PATH = emptyPath
  process.env.Path = emptyPath
  try {
    return await action()
  } finally {
    if (path === undefined) delete process.env.PATH
    else process.env.PATH = path
    if (pathCase === undefined) delete process.env.Path
    else process.env.Path = pathCase
  }
}

describe('TeachingWorkspaceChangeAudit', () => {
  it('captures, persists, reloads, selects, and cleans up durable Git-backed audits', async () => {
    const workspaceA = await createRepository('workspace-a')
    const workspaceB = await createRepository('workspace-b')
    const historyFilePath = join(workspaceA, '.git', 'audit-history.json')
    const audit = new TeachingWorkspaceChangeAudit({ historyFilePath, maxEntriesPerWorkspace: 2 })

    const before = await audit.capturePreMutation(workspaceA)
    await writeFile(join(workspaceA, 'modified.md'), '# After\n')
    await rm(join(workspaceA, 'deleted.md'))
    await writeFile(join(workspaceA, 'added.md'), '# Added\n')
    await writeFile(join(workspaceA, 'binary.bin'), Buffer.from([0, 255, 17, 128]))
    const first = await audit.recordCompletedMutation({
      workspaceId: 'workspace-a',
      workspaceRoot: workspaceA,
      timestamp: '2026-07-14T00:00:01.000Z',
      trigger: { kind: 'lesson_generation', label: 'Generated lesson' },
      before,
      affectedPaths: ['modified.md', 'deleted.md', 'added.md', 'binary.bin']
    })

    expect(first).not.toBeNull()
    expect(first?.checkpoint).toBeDefined()
    expect(Object.fromEntries(first!.changedFiles.map((file) => [file.relativePath, file.status]))).toMatchObject({
      'modified.md': 'modified',
      'deleted.md': 'deleted',
      'added.md': 'added',
      'binary.bin': 'added'
    })
    expect(first!.changedFiles.find((file) => file.relativePath === 'binary.bin')).toMatchObject({
      additions: null,
      deletions: null,
      diffAvailable: false
    })

    const selected = await audit.readSelectedDiff({
      workspaceId: 'workspace-a',
      workspaceRoot: workspaceA,
      relativePath: 'modified.md',
      changeId: first!.id
    })
    expect(selected).toMatchObject({ ok: true, relativePath: 'modified.md' })
    expect(selected.ok && selected.diff).toContain('+# After')

    const reloaded = new TeachingWorkspaceChangeAudit({ historyFilePath, maxEntriesPerWorkspace: 2 })
    expect((await reloaded.listSummaries('workspace-a')).map((entry) => entry.id)).toEqual([first!.id])

    const beforeB = await audit.capturePreMutation(workspaceB)
    await writeFile(join(workspaceB, 'other.md'), '# Other workspace\n')
    const workspaceBChange = await audit.recordCompletedMutation({
      workspaceId: 'workspace-b',
      workspaceRoot: workspaceB,
      timestamp: '2026-07-14T00:00:02.000Z',
      trigger: { kind: 'lesson_generation', label: 'Generated lesson' },
      before: beforeB,
      affectedPaths: ['other.md']
    })
    expect(workspaceBChange).not.toBeNull()
    expect((await audit.listSummaries('workspace-a')).map((entry) => entry.id)).toEqual([first!.id])
    expect((await audit.listSummaries('workspace-b')).map((entry) => entry.id)).toEqual([workspaceBChange!.id])

    const secondBefore = await audit.capturePreMutation(workspaceA)
    await writeFile(join(workspaceA, 'added.md'), '# Added twice\n')
    const second = await audit.recordCompletedMutation({
      workspaceId: 'workspace-a', workspaceRoot: workspaceA,
      timestamp: '2026-07-14T00:00:03.000Z', trigger: { kind: 'workspace_markdown_save', label: 'Saved Markdown' },
      before: secondBefore, affectedPaths: ['added.md']
    })
    const thirdBefore = await audit.capturePreMutation(workspaceA)
    await writeFile(join(workspaceA, 'added.md'), '# Added three times\n')
    const third = await audit.recordCompletedMutation({
      workspaceId: 'workspace-a', workspaceRoot: workspaceA,
      timestamp: '2026-07-14T00:00:04.000Z', trigger: { kind: 'workspace_markdown_save', label: 'Saved Markdown' },
      before: thirdBefore, affectedPaths: ['added.md']
    })
    expect((await audit.listSummaries('workspace-a')).map((entry) => entry.id)).toEqual([third!.id, second!.id])
    expect((await git(workspaceA, ['for-each-ref', '--format=%(refname)', 'refs/studiumx/checkpoints']))
      .split(/\r?\n/).filter(Boolean)).toHaveLength(4)

    await releaseWorkspaceChangeCheckpoint(third!)
    await git(workspaceA, ['reflog', 'expire', '--expire=now', '--all'])
    await git(workspaceA, ['gc', '--prune=now'])
    await expect(audit.readSelectedDiff({
      workspaceId: 'workspace-a', workspaceRoot: workspaceA, relativePath: 'added.md', changeId: third!.id
    })).resolves.toEqual({ ok: false, message: 'No diff is available for this file yet.' })
  })

  it('does not release an evicted checkpoint when durable history publication fails', async () => {
    const workspace = await createRepository('checkpoint-release-after-history')
    const historyFilePath = join(workspace, '.git', 'audit-history.json')
    let failHistoryDirectorySync = false
    const audit = new TeachingWorkspaceChangeAudit({
      historyFilePath,
      maxEntriesPerWorkspace: 1,
      durableFileOperations: directorySyncFailingOperations({
        directoryPath: dirname(historyFilePath),
        shouldFail: () => failHistoryDirectorySync
      })
    })

    const firstBefore = await audit.capturePreMutation(workspace)
    await writeFile(join(workspace, 'modified.md'), '# First durable history\n')
    const first = await audit.recordCompletedMutation({
      workspaceId: 'workspace-a', workspaceRoot: workspace, timestamp: '2026-07-18T00:00:01.000Z',
      trigger: { kind: 'workspace_markdown_save', label: 'Saved Markdown' }, before: firstBefore, affectedPaths: ['modified.md']
    })
    expect(first?.checkpoint).toBeDefined()
    const firstCheckpointPrefix = `refs/studiumx/checkpoints/${createHash('sha256').update(first!.id).digest('hex').slice(0, 24)}`
    await expect(git(workspace, ['rev-parse', '--verify', `${firstCheckpointPrefix}/before`])).resolves.toMatch(/^[0-9a-f]{40}$/)

    failHistoryDirectorySync = true
    const secondBefore = await audit.capturePreMutation(workspace)
    await writeFile(join(workspace, 'modified.md'), '# Second history cannot be acknowledged\n')
    await expect(audit.recordCompletedMutation({
      workspaceId: 'workspace-a', workspaceRoot: workspace, timestamp: '2026-07-18T00:00:02.000Z',
      trigger: { kind: 'workspace_markdown_save', label: 'Saved Markdown' }, before: secondBefore, affectedPaths: ['modified.md']
    })).rejects.toMatchObject({ code: 'EIO' })

    // The second append would evict `first` at the configured limit, but its
    // directory sync was not acknowledged, so the retention checkpoint must
    // not be released. The published history file may contain the second row.
    await expect(git(workspace, ['rev-parse', '--verify', `${firstCheckpointPrefix}/before`])).resolves.toMatch(/^[0-9a-f]{40}$/)
    await expect(git(workspace, ['rev-parse', '--verify', `${firstCheckpointPrefix}/after`])).resolves.toMatch(/^[0-9a-f]{40}$/)
  })

  it('keeps fallback summaries and error semantics when Git or history persistence is unavailable', async () => {
    const runtime = await runtimeScope.create('change-audit-fallback')
    const root = runtime.paths.workspace
    const nonGitRoot = join(root, 'non-git')
    await mkdir(nonGitRoot)
    const audit = new TeachingWorkspaceChangeAudit({ historyFilePath: join(root, 'history.json') })
    const before = await audit.capturePreMutation(nonGitRoot)
    await writeFile(join(nonGitRoot, 'lesson.md'), '# Lesson\n')
    const fallback = await audit.recordCompletedMutation({
      workspaceId: 'non-git', workspaceRoot: nonGitRoot, timestamp: '2026-07-14T01:00:00.000Z',
      trigger: { kind: 'lesson_generation', label: 'Generated lesson' }, before, affectedPaths: ['lesson.md']
    })
    expect(fallback).toMatchObject({ git: { available: false, reason: 'not_git_repo' } })
    expect((await audit.listSummaries('non-git')).map((entry) => entry.id)).toEqual([fallback!.id])

    await withGitUnavailable(root, async () => {
      const unavailable = await audit.capturePreMutation(nonGitRoot)
      expect(unavailable.git).toEqual({
        available: false,
        reason: 'git_unavailable',
        message: 'Git is not available in PATH.'
      })
    })

    const malformedPath = join(root, 'malformed.json')
    await writeFile(malformedPath, '{not json')
    const malformedAudit = new TeachingWorkspaceChangeAudit({ historyFilePath: malformedPath })
    await expect(malformedAudit.listSummaries('non-git')).resolves.toEqual([])

    const blockingPath = join(root, 'history-parent')
    await writeFile(blockingPath, 'not a directory')
    const failingAudit = new TeachingWorkspaceChangeAudit({ historyFilePath: join(blockingPath, 'history.json') })
    const failingBefore = await failingAudit.capturePreMutation(nonGitRoot)
    await writeFile(join(nonGitRoot, 'second.md'), '# Second\n')
    await expect(failingAudit.recordCompletedMutation({
      workspaceId: 'non-git', workspaceRoot: nonGitRoot, timestamp: '2026-07-14T01:00:01.000Z',
      trigger: { kind: 'workspace_markdown_save', label: 'Saved Markdown' }, before: failingBefore, affectedPaths: ['second.md']
    })).rejects.toThrow()
  })
})