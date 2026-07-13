import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  prepareWorkspaceWriteTarget,
  resolveWorkspacePathTarget,
  verifyExistingWorkspaceTarget
} from '../../src/main/ai/tools/workspace-path-target'

async function assertRejectsMessage(action: () => Promise<unknown> | unknown, expected: RegExp): Promise<void> {
  await assert.rejects(Promise.resolve().then(action), expected)
}

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-workspace-path-target-'))
  const workspaceRoot = join(tempRoot, 'workspace')
  const outsideRoot = join(tempRoot, 'outside')
  await Promise.all([mkdir(workspaceRoot), mkdir(outsideRoot)])

  assert.throws(
    () => resolveWorkspacePathTarget(workspaceRoot, '../outside/note.md'),
    /路径超出当前教学工作区/,
    'traversal should retain the Chinese containment error'
  )
  assert.throws(
    () => resolveWorkspacePathTarget(workspaceRoot, outsideRoot),
    /请使用相对工作区路径，不允许传入绝对路径/,
    'absolute paths should retain the Chinese relative-path error'
  )
  assert.throws(
    () => resolveWorkspacePathTarget(undefined, 'notes.md'),
    /当前没有绑定教学工作区/,
    'an unbound workspace should retain the Chinese workspace error'
  )

  const stable = resolveWorkspacePathTarget(workspaceRoot, 'reference\\nested\\note.md')
  assert.equal(stable.relativePath, 'reference/nested/note.md', 'provider display paths should be stable POSIX paths')

  const newTarget = resolveWorkspacePathTarget(workspaceRoot, 'notes/new/deep.md')
  const newState = await prepareWorkspaceWriteTarget(newTarget)
  assert.deepEqual(newState, { exists: false, kind: null })
  assert.equal(await stat(join(workspaceRoot, 'notes', 'new')).then((info) => info.isDirectory()), true)
  assert.equal(newTarget.relativePath, 'notes/new/deep.md')

  const escapeLink = join(workspaceRoot, 'escaped')
  let symlinkCreated = false
  try {
    await symlink(outsideRoot, escapeLink, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkCreated = true
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== 'EPERM' && code !== 'EACCES') throw error
    console.log('workspace path target symlink verification skipped: Windows symlink creation is not permitted on this host')
  }

  if (symlinkCreated) {
    const escapedExisting = resolveWorkspacePathTarget(workspaceRoot, 'escaped')
    await assertRejectsMessage(
      () => verifyExistingWorkspaceTarget(escapedExisting),
      /路径经过符号链接后超出当前教学工作区/
    )

    const escapedNew = resolveWorkspacePathTarget(workspaceRoot, 'escaped/new.md')
    await assertRejectsMessage(
      () => prepareWorkspaceWriteTarget(escapedNew),
      /路径经过符号链接后超出当前教学工作区/
    )
  }

  console.log('workspace path target boundaries ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}