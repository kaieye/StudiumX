import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { resolveRegisteredGitWorkspaceRoot } from '../../src/main/teaching-git-access'
import {
  createAndSwitchGitBranchForWorkspace,
  getGitBranchesForWorkspace,
  switchGitBranchForWorkspace
} from '../../src/main/teaching-git'

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
  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-git-guards-'))
  const workspaceRoot = join(tempRoot, 'workspace')
  const outsideRoot = join(tempRoot, 'outside')

  const registered = [{ rootPath: workspaceRoot }]
  assert.deepEqual(resolveRegisteredGitWorkspaceRoot(registered, workspaceRoot), {
    ok: true,
    rootPath: workspaceRoot
  })
  assert.equal(resolveRegisteredGitWorkspaceRoot(registered, join(workspaceRoot, 'nested')).ok, false)
  assert.equal(resolveRegisteredGitWorkspaceRoot(registered, outsideRoot).ok, false)
  assert.equal(resolveRegisteredGitWorkspaceRoot(registered, '   ').reason, 'no_workspace')

  await execFile('git', ['init', workspaceRoot], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  await git(workspaceRoot, ['config', 'user.email', 'teachos@example.test'])
  await git(workspaceRoot, ['config', 'user.name', 'TeachOS Test'])
  await writeFile(join(workspaceRoot, 'README.md'), '# Workspace\n', 'utf8')
  await git(workspaceRoot, ['add', 'README.md'])
  await git(workspaceRoot, ['commit', '-m', 'Initial commit'])
  const initialBranch = await git(workspaceRoot, ['branch', '--show-current'])
  await git(workspaceRoot, ['branch', 'feature/git-guard'])

  const listed = await getGitBranchesForWorkspace(workspaceRoot)
  assert.equal(listed.ok, true, 'registered workspace git branch listing should succeed')
  assert.ok(listed.ok && listed.branches.some((branch) => branch.name === 'feature/git-guard'))

  const optionLikeSwitch = await switchGitBranchForWorkspace(workspaceRoot, '--detach')
  assert.equal(optionLikeSwitch.ok, false, 'option-like branch input should be rejected')
  assert.equal(await git(workspaceRoot, ['branch', '--show-current']), initialBranch)

  const reflogSwitch = await switchGitBranchForWorkspace(workspaceRoot, '@{-1}')
  assert.equal(reflogSwitch.ok, false, 'reflog branch shorthand should be rejected')
  assert.equal(await git(workspaceRoot, ['branch', '--show-current']), initialBranch)

  const missingBranchSwitch = await switchGitBranchForWorkspace(workspaceRoot, 'missing-local-branch')
  assert.equal(missingBranchSwitch.ok, false, 'switching to a non-local branch should be rejected')
  assert.equal(await git(workspaceRoot, ['branch', '--show-current']), initialBranch)

  const validSwitch = await switchGitBranchForWorkspace(workspaceRoot, 'feature/git-guard')
  assert.equal(validSwitch.ok, true, 'switching to an existing local branch should still work')
  assert.equal(await git(workspaceRoot, ['branch', '--show-current']), 'feature/git-guard')

  const shorthandCreate = await createAndSwitchGitBranchForWorkspace(workspaceRoot, '@{-1}')
  assert.equal(shorthandCreate.ok, false, 'new branch creation should reject reflog shorthand')
  assert.equal(await git(workspaceRoot, ['branch', '--show-current']), 'feature/git-guard')

  const validCreate = await createAndSwitchGitBranchForWorkspace(workspaceRoot, 'feature/new-local')
  assert.equal(validCreate.ok, true, 'creating a canonical local branch should still work')
  assert.equal(await git(workspaceRoot, ['branch', '--show-current']), 'feature/new-local')

  assert.equal(resolve(workspaceRoot), resolve(registered[0].rootPath))
  console.log('teaching git guards ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
