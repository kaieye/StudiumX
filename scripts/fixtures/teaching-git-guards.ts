import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { resolveOptionalRegisteredWorkspaceRoot, resolveRegisteredWorkspaceRoot } from '../../src/main/teaching-workspace-access'
import {
  GIT_MAX_OUTPUT_BYTES,
  classifyGitRepositoryFailure,
  executeGitCommand
} from '../../src/main/teaching-git-repository'
import {
  createAndSwitchGitBranchForWorkspace,
  getGitBranchesForWorkspace,
  listGitWorktreesForWorkspace,
  removeGitWorktreeForWorkspace,
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
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-git-guards-'))
  const workspaceRoot = join(tempRoot, 'workspace')
  const outsideRoot = join(tempRoot, 'outside')

  const registered = [{ rootPath: workspaceRoot }]
  assert.deepEqual(resolveRegisteredWorkspaceRoot(registered, workspaceRoot), {
    ok: true,
    rootPath: workspaceRoot
  })
  assert.equal(resolveRegisteredWorkspaceRoot(registered, join(workspaceRoot, 'nested')).ok, false)
  assert.equal(resolveRegisteredWorkspaceRoot(registered, outsideRoot).ok, false)
  assert.equal(resolveRegisteredWorkspaceRoot(registered, '   ').reason, 'no_workspace')
  assert.deepEqual(resolveOptionalRegisteredWorkspaceRoot(registered, undefined), { ok: true })
  assert.deepEqual(resolveOptionalRegisteredWorkspaceRoot(registered, workspaceRoot), {
    ok: true,
    rootPath: workspaceRoot
  })
  assert.equal(resolveOptionalRegisteredWorkspaceRoot(registered, outsideRoot).ok, false)

  await execFile('git', ['init', workspaceRoot], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  await git(workspaceRoot, ['config', 'user.email', 'studiumx@example.test'])
  await git(workspaceRoot, ['config', 'user.name', 'StudiumX Test'])
  await writeFile(join(workspaceRoot, 'README.md'), '# Workspace\n', 'utf8')
  await git(workspaceRoot, ['add', 'README.md'])
  await git(workspaceRoot, ['commit', '-m', 'Initial commit'])
  const initialBranch = await git(workspaceRoot, ['branch', '--show-current'])
  await git(workspaceRoot, ['branch', 'feature/git-guard'])

  const listed = await getGitBranchesForWorkspace(workspaceRoot)
  assert.equal(listed.ok, true, 'registered workspace git branch listing should succeed')
  assert.ok(listed.ok && listed.branches.some((branch) => branch.name === 'feature/git-guard'))

  await mkdir(outsideRoot, { recursive: true })
  const nonRepositoryBranches = await getGitBranchesForWorkspace(outsideRoot)
  assert.deepEqual(nonRepositoryBranches, {
    ok: false,
    reason: 'not_git_repo',
    message: 'Current workspace is not a Git repository.'
  })

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

  const managedWorktreeRoot = join(tempRoot, 'managed-worktrees')
  const managedWorktreePath = join(managedWorktreeRoot, 'teaching-worktree')
  await mkdir(managedWorktreeRoot, { recursive: true })
  await git(workspaceRoot, ['worktree', 'add', '-b', 'feature/managed-worktree', managedWorktreePath])
  const worktreeBranches = await getGitBranchesForWorkspace(managedWorktreePath)
  assert.equal(worktreeBranches.ok, true, 'linked worktrees should retain their own canonical repository root')
  assert.equal(worktreeBranches.ok && worktreeBranches.repositoryRoot, resolve(managedWorktreePath))
  assert.equal(worktreeBranches.ok && worktreeBranches.primaryRepositoryRoot, resolve(workspaceRoot))

  const worktreeList = await listGitWorktreesForWorkspace(workspaceRoot, managedWorktreeRoot)
  assert.equal(worktreeList.ok, true)
  const managedWorktree = worktreeList.ok && worktreeList.worktrees.find((row) => row.path === resolve(managedWorktreePath))
  assert.ok(managedWorktree?.isManaged)
  assert.equal(managedWorktree?.isPrimary, false)

  const primaryRemoval = await removeGitWorktreeForWorkspace({
    workspaceRoot,
    worktreePath: workspaceRoot,
    worktreeRoot: managedWorktreeRoot
  })
  assert.deepEqual(primaryRemoval, { ok: false, message: 'Primary worktree cannot be removed.' })

  const unmanagedWorktreePath = join(tempRoot, 'unmanaged-worktree')
  await git(workspaceRoot, ['worktree', 'add', '-b', 'feature/unmanaged-worktree', unmanagedWorktreePath])
  const unmanagedRemoval = await removeGitWorktreeForWorkspace({
    workspaceRoot,
    worktreePath: unmanagedWorktreePath,
    worktreeRoot: managedWorktreeRoot
  })
  assert.deepEqual(unmanagedRemoval, {
    ok: false,
    message: 'Worktree path is outside the configured worktree root.'
  })

  await withGitUnavailable(async () => {
    const unavailableBranches = await getGitBranchesForWorkspace(workspaceRoot)
    assert.deepEqual(unavailableBranches, {
      ok: false,
      reason: 'git_unavailable',
      message: 'Git is not available in PATH.'
    })
    const unavailableWorktrees = await listGitWorktreesForWorkspace(workspaceRoot, managedWorktreeRoot)
    assert.deepEqual(unavailableWorktrees, {
      ok: false,
      reason: 'git_unavailable',
      message: 'Git is not available in PATH.'
    })
  })

  // A real Git config value larger than the shared stdout limit proves that
  // the repository module turns oversized command output into one stable
  // failure classification, independent of which caller crosses its seam.
  await appendFile(
    join(workspaceRoot, '.git', 'config'),
    `\n[studiumx "fixture"]\nlarge = ${'x'.repeat(GIT_MAX_OUTPUT_BYTES + 1_024)}\n`,
    'utf8'
  )
  await assert.rejects(
    () => executeGitCommand(workspaceRoot, ['config', '--get', 'studiumx.fixture.large']),
    (error: unknown) => {
      assert.deepEqual(classifyGitRepositoryFailure(error), {
        reason: 'error',
        message: 'Git command output exceeded the supported limit.'
      })
      return true
    }
  )

  assert.equal(resolve(workspaceRoot), resolve(registered[0].rootPath))
  console.log('teaching git guards ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
