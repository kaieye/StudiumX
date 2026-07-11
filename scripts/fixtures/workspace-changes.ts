import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  captureWorkspaceChangeSnapshot,
  readWorkspaceChangeDiff,
  summarizeWorkspaceChanges
} from '../../src/main/teaching-workspace-changes'

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

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-workspace-changes-'))
  const workspaceRoot = join(tempRoot, 'workspace')
  await execFile('git', ['init', workspaceRoot], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  await git(workspaceRoot, ['config', 'user.email', 'studiumx@example.test'])
  await git(workspaceRoot, ['config', 'user.name', 'StudiumX Test'])
  await writeFile(join(workspaceRoot, 'README.md'), '# Workspace\n', 'utf8')
  await writeFile(join(workspaceRoot, 'preexisting.md'), 'clean\n', 'utf8')
  await git(workspaceRoot, ['add', 'README.md', 'preexisting.md'])
  await git(workspaceRoot, ['commit', '-m', 'Initial commit'])

  await writeFile(join(workspaceRoot, 'preexisting.md'), 'dirty before snapshot\n', 'utf8')
  const before = await captureWorkspaceChangeSnapshot(workspaceRoot)
  assert.equal(before.git.available, true)

  await writeFile(join(workspaceRoot, 'README.md'), '# Workspace\n\nChanged by generation.\n', 'utf8')
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
      '.teachos/index.json',
      '.teachos/sessions.jsonl'
    ]
  })
  assert.ok(summary)
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
  assert.deepEqual(nonGitSummary.changedFiles.map((file) => file.relativePath), ['lesson.md'])

  console.log('workspace changes ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
