import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import {
  captureWorkspaceChangeSnapshot,
  readWorkspaceChangeDiff,
  summarizeWorkspaceChanges
} from '../../src/main/teaching-workspace-changes'
import { TeachingWorkspaceChangeHistoryStore } from '../../src/main/teaching-workspace-change-history'

const execFile = promisify(execFileCallback)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    maxBuffer: 1024 * 1024
  })
  return stdout.trim()
}

let tempRoot = ''

async function withGitUnavailable(action: () => Promise<void>): Promise<void> {
  const emptyPath = join(tempRoot, 'empty-git-path')
  await mkdir(emptyPath, { recursive: true })
  const previousPath = process.env.PATH
  const previousPathCase = process.env.Path
  process.env.PATH = emptyPath
  process.env.Path = emptyPath
  try {
    await action()
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousPathCase === undefined) delete process.env.Path
    else process.env.Path = previousPathCase
  }
}

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-workspace-changes-'))
  const workspaceRoot = join(tempRoot, 'workspace')
  await execFile('git', ['init', workspaceRoot], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  await git(workspaceRoot, ['config', 'user.email', 'studiumx@example.test'])
  await git(workspaceRoot, ['config', 'user.name', 'StudiumX Test'])
  await writeFile(join(workspaceRoot, 'README.md'), '# Workspace\n', 'utf8')
  await writeFile(join(workspaceRoot, 'preexisting.md'), 'clean\n', 'utf8')
  await writeFile(join(workspaceRoot, 'dirty-target.md'), 'clean\n', 'utf8')
  await git(workspaceRoot, ['add', 'README.md', 'preexisting.md', 'dirty-target.md'])
  await git(workspaceRoot, ['commit', '-m', 'Initial commit'])

  await writeFile(join(workspaceRoot, 'preexisting.md'), 'dirty before snapshot\n', 'utf8')
  await writeFile(join(workspaceRoot, 'dirty-target.md'), 'dirty before snapshot\n', 'utf8')
  const before = await captureWorkspaceChangeSnapshot(workspaceRoot)
  assert.equal(before.git.available, true, before.git.message)

  await writeFile(join(workspaceRoot, 'README.md'), '# Workspace\n\nChanged by generation.\n', 'utf8')
  await writeFile(join(workspaceRoot, 'dirty-target.md'), 'dirty before snapshot\nchanged by generation\n', 'utf8')
  await mkdir(join(workspaceRoot, 'courses', 'ai', 'sessions', '0001-intro', 'lessons'), { recursive: true })
  await writeFile(
    join(workspaceRoot, 'courses', 'ai', 'sessions', '0001-intro', 'lessons', '0001-intro.html'),
    '<!doctype html>\n<h1>Intro</h1>\n',
    'utf8'
  )
  await mkdir(join(workspaceRoot, '.teachos'), { recursive: true })
  await writeFile(join(workspaceRoot, '.teachos', 'index.json'), '{"lessons":[]}\n', 'utf8')
  await writeFile(join(workspaceRoot, '.teachos', 'sessions.jsonl'), '{"kind":"lesson_generated"}\n', 'utf8')

  const summary = await summarizeWorkspaceChanges({
    workspaceId: 'workspace-1',
    workspaceRoot,
    timestamp: '2026-07-11T00:00:00.000Z',
    trigger: { kind: 'lesson_generation', label: 'Generated lesson', detail: 'Intro' },
    before,
    affectedPaths: [
      'courses/ai/sessions/0001-intro/lessons/0001-intro.html',
      'dirty-target.md',
      '.teachos/index.json',
      '.teachos/sessions.jsonl'
    ]
  })
  assert.ok(summary)
  assert.ok(summary.checkpoint)
  assert.equal(summary.git.available, true)
  assert.equal(summary.changedFiles.some((file) => file.relativePath === 'preexisting.md'), false)
  assert.equal(summary.changedFiles.some((file) => file.relativePath === 'README.md'), true)
  assert.equal(summary.changedFiles.some((file) => file.fileKind === 'lesson'), true)
  assert.ok(summary.additions > 0)

  const lessonDiff = await readWorkspaceChangeDiff({
    workspaceRoot,
    relativePath: 'courses/ai/sessions/0001-intro/lessons/0001-intro.html'
  })
  assert.equal(lessonDiff.ok, true)
  assert.ok(lessonDiff.ok && lessonDiff.diff.includes('+<h1>Intro</h1>'))

  const readmeDiff = await readWorkspaceChangeDiff({ workspaceRoot, relativePath: 'README.md' })
  assert.equal(readmeDiff.ok, true)
  assert.ok(readmeDiff.ok && readmeDiff.diff.includes('+Changed by generation.'))

  const dirtyTargetDiff = await readWorkspaceChangeDiff({
    workspaceRoot,
    relativePath: 'dirty-target.md',
    checkpoint: summary.checkpoint
  })
  assert.equal(dirtyTargetDiff.ok, true)
  assert.ok(dirtyTargetDiff.ok && dirtyTargetDiff.diff.includes('+changed by generation'))
  assert.ok(dirtyTargetDiff.ok && !dirtyTargetDiff.diff.includes('-clean'))
  const retainedRefs = await git(workspaceRoot, ['for-each-ref', '--format=%(refname)', 'refs/studiumx/checkpoints'])
  assert.equal(retainedRefs.split('\n').filter(Boolean).length, 2)

  const historyPath = join(tempRoot, 'change-history.json')
  await new TeachingWorkspaceChangeHistoryStore({ filePath: historyPath }).append('workspace-1', summary)
  const restoredSummary = await new TeachingWorkspaceChangeHistoryStore({ filePath: historyPath }).latest('workspace-1')
  assert.ok(restoredSummary?.checkpoint)
  const restoredDiff = await readWorkspaceChangeDiff({
    workspaceRoot,
    relativePath: 'dirty-target.md',
    checkpoint: restoredSummary.checkpoint
  })
  assert.equal(restoredDiff.ok, true)
  assert.ok(restoredDiff.ok && restoredDiff.diff.includes('+changed by generation'))
  assert.ok(restoredDiff.ok && !restoredDiff.diff.includes('-clean'))

  const nestedRepositoryRoot = join(tempRoot, 'nested-repository')
  const nestedWorkspaceRoot = join(nestedRepositoryRoot, 'courses', 'workspace')
  await execFile('git', ['init', nestedRepositoryRoot], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  await git(nestedRepositoryRoot, ['config', 'user.email', 'studiumx@example.test'])
  await git(nestedRepositoryRoot, ['config', 'user.name', 'StudiumX Test'])
  await mkdir(nestedWorkspaceRoot, { recursive: true })
  await writeFile(join(nestedRepositoryRoot, 'outside.md'), 'outside clean\n', 'utf8')
  await writeFile(join(nestedWorkspaceRoot, 'MISSION.md'), '# Original mission\n', 'utf8')
  await git(nestedRepositoryRoot, ['add', '.'])
  await git(nestedRepositoryRoot, ['commit', '-m', 'Nested workspace baseline'])

  const nestedBefore = await captureWorkspaceChangeSnapshot(nestedWorkspaceRoot)
  await writeFile(join(nestedRepositoryRoot, 'outside.md'), 'outside changed during generation\n', 'utf8')
  await writeFile(join(nestedWorkspaceRoot, 'MISSION.md'), '# Generated mission\n', 'utf8')
  await writeFile(join(nestedWorkspaceRoot, 'lesson.md'), '# Nested lesson\n', 'utf8')
  const nestedSummary = await summarizeWorkspaceChanges({
    workspaceId: 'workspace-nested',
    workspaceRoot: nestedWorkspaceRoot,
    timestamp: '2026-07-11T00:00:00.000Z',
    trigger: { kind: 'lesson_generation', label: 'Generated lesson' },
    before: nestedBefore,
    affectedPaths: ['MISSION.md', 'lesson.md']
  })
  assert.ok(nestedSummary, nestedBefore.git.message)
  assert.deepEqual(
    nestedSummary.changedFiles.map((file) => file.relativePath).sort(),
    ['MISSION.md', 'lesson.md']
  )
  assert.equal(nestedSummary.changedFiles.some((file) => file.relativePath.includes('outside.md')), false)
  const nestedDiff = await readWorkspaceChangeDiff({ workspaceRoot: nestedWorkspaceRoot, relativePath: 'MISSION.md' })
  assert.equal(nestedDiff.ok, true)
  assert.ok(nestedDiff.ok && nestedDiff.diff.includes('+# Generated mission'))
  assert.ok(nestedDiff.ok && !nestedDiff.diff.includes('outside changed during generation'))

  const linkedWorktreeRoot = join(tempRoot, 'linked-worktree')
  await git(workspaceRoot, ['worktree', 'add', '-b', 'feature/checkpoint-worktree', linkedWorktreeRoot])
  const linkedBefore = await captureWorkspaceChangeSnapshot(linkedWorktreeRoot)
  assert.equal(linkedBefore.git.available, true, linkedBefore.git.message)
  assert.equal(linkedBefore.git.repositoryRoot, resolve(linkedWorktreeRoot))
  await writeFile(join(linkedWorktreeRoot, 'worktree-lesson.md'), '# Linked worktree lesson\n', 'utf8')
  const linkedSummary = await summarizeWorkspaceChanges({
    workspaceId: 'workspace-linked-worktree',
    workspaceRoot: linkedWorktreeRoot,
    timestamp: '2026-07-11T00:00:00.000Z',
    trigger: { kind: 'lesson_generation', label: 'Generated lesson' },
    before: linkedBefore,
    affectedPaths: ['worktree-lesson.md']
  })
  assert.ok(linkedSummary, linkedBefore.git.message)
  assert.equal(linkedSummary.git.repositoryRoot, resolve(linkedWorktreeRoot))
  assert.deepEqual(linkedSummary.changedFiles.map((file) => file.relativePath), ['worktree-lesson.md'])

  const nonGitRoot = join(tempRoot, 'non-git')
  await mkdir(nonGitRoot, { recursive: true })
  const nonGitBefore = await captureWorkspaceChangeSnapshot(nonGitRoot)
  await writeFile(join(nonGitRoot, 'lesson.md'), '# Lesson\n', 'utf8')
  const nonGitSummary = await summarizeWorkspaceChanges({
    workspaceId: 'workspace-2',
    workspaceRoot: nonGitRoot,
    timestamp: '2026-07-11T00:00:00.000Z',
    trigger: { kind: 'lesson_generation', label: 'Generated lesson' },
    before: nonGitBefore,
    affectedPaths: ['lesson.md']
  })
  assert.ok(nonGitSummary)
  assert.equal(nonGitSummary.git.available, false)
  assert.equal(nonGitSummary.git.reason, 'not_git_repo')
  assert.equal(nonGitSummary.git.message, 'Current workspace is not a Git repository.')
  assert.deepEqual(nonGitSummary.changedFiles.map((file) => file.relativePath), ['lesson.md'])

  await withGitUnavailable(async () => {
    const unavailableSnapshot = await captureWorkspaceChangeSnapshot(workspaceRoot)
    assert.deepEqual(unavailableSnapshot.git, {
      available: false,
      reason: 'git_unavailable',
      message: 'Git is not available in PATH.'
    })
  })

  console.log('workspace changes ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
