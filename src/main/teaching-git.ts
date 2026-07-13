import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isPathInsideRoot } from './path-access'
import {
  GIT_BRANCH_TIMEOUT_MS,
  classifyGitRepositoryFailure,
  openTeachingGitRepository,
  sameGitPath,
  type TeachingGitRepository
} from './teaching-git-repository'
import type {
  OpenPathResult,
  TeachingGitBranchesResult,
  TeachingGitBranchRow,
  TeachingGitWorkspaceInfo,
  TeachingGitWorktreesResult
} from '../shared/teaching-types'

type ParsedWorktree = {
  path: string
  head: string
  branch: string | null
}

export async function inspectGitWorkspace(workspaceRoot: string): Promise<TeachingGitWorkspaceInfo | null> {
  try {
    const repository = await openTeachingGitRepository(workspaceRoot)
    const repositoryRoot = repository.repositoryRoot
    const worktrees = await listWorktreesInternal(repository)
    const primaryWorktreePath = worktrees[0]?.path ?? repositoryRoot
    const currentBranch = await readCurrentBranch(repository)
    return {
      repositoryRoot,
      primaryWorktreePath,
      currentBranch,
      isWorktree: !sameGitPath(repositoryRoot, primaryWorktreePath)
    }
  } catch {
    return null
  }
}

export async function listGitWorktreesForWorkspace(
  workspaceRoot: string,
  worktreeRoot: string
): Promise<TeachingGitWorktreesResult> {
  try {
    const repository = await openTeachingGitRepository(workspaceRoot)
    const repositoryRoot = repository.repositoryRoot
    const worktrees = await listWorktreesInternal(repository)
    const primaryWorktreePath = worktrees[0]?.path ?? repositoryRoot
    const rows = await Promise.all(
      worktrees.map(async (worktree) => ({
        path: worktree.path,
        branch: worktree.branch,
        head: worktree.head,
        isPrimary: sameGitPath(worktree.path, primaryWorktreePath),
        isManaged: isPathInsideRoot(worktreeRoot, worktree.path),
        createdAt: await readCreatedAt(worktree.path)
      }))
    )
    return {
      ok: true,
      repositoryRoot,
      primaryWorktreePath,
      worktreeRoot: resolve(worktreeRoot),
      worktrees: rows
    }
  } catch (error) {
    return mapGitError(error)
  }
}

export async function removeGitWorktreeForWorkspace(input: {
  workspaceRoot: string
  worktreePath: string
  worktreeRoot: string
}): Promise<OpenPathResult> {
  try {
    const listed = await listGitWorktreesForWorkspace(input.workspaceRoot, input.worktreeRoot)
    if (!listed.ok) return { ok: false, message: listed.message }
    const target = listed.worktrees.find((worktree) => sameGitPath(worktree.path, input.worktreePath))
    if (!target) {
      return { ok: false, message: 'Worktree not found.' }
    }
    if (target.isPrimary) {
      return { ok: false, message: 'Primary worktree cannot be removed.' }
    }
    if (!target.isManaged) {
      return { ok: false, message: 'Worktree path is outside the configured worktree root.' }
    }
    const repository = await openTeachingGitRepository(input.workspaceRoot)
    await repository.execute(['worktree', 'remove', '--force', resolve(input.worktreePath)])
    return { ok: true }
  } catch (error) {
    return { ok: false, message: classifyGitRepositoryFailure(error).message }
  }
}

/**
 * List every local branch of the repository that contains `workspaceRoot`,
 * along with the current branch and a dirty-file count for the working tree.
 * Branches already checked out in another worktree carry that worktree's path
 * so the UI can navigate there instead of attempting a doomed `git switch`.
 */
export async function getGitBranchesForWorkspace(
  workspaceRoot: string
): Promise<TeachingGitBranchesResult> {
  const trimmed = workspaceRoot.trim()
  if (!trimmed) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    const repository = await openTeachingGitRepository(trimmed)
    const repositoryRoot = repository.repositoryRoot
    const currentRaw = (await repository.execute(['branch', '--show-current'])).trim()
    const currentBranch = currentRaw || null
    const branchLines = await listLocalBranchNames(repository)
    const branchSet = new Set(branchLines)
    if (currentBranch && !branchSet.has(currentBranch)) branchSet.add(currentBranch)

    const worktreeRows = await listWorktreesInternal(repository)
    const primaryRepositoryRoot = worktreeRows[0]?.path ?? repositoryRoot
    const worktreeByBranch = new Map<string, { path: string; primary: boolean }>()
    for (const row of worktreeRows) {
      if (row.branch && !worktreeByBranch.has(row.branch)) {
        worktreeByBranch.set(row.branch, {
          path: row.path,
          primary: sameGitPath(row.path, primaryRepositoryRoot)
        })
      }
    }

    const branches: TeachingGitBranchRow[] = [...branchSet].map((name) => {
      // A branch checked out in *another* worktree cannot be switched to here.
      // (The current branch lives in this worktree, so it is never "elsewhere".)
      const elsewhere = name === currentBranch ? undefined : worktreeByBranch.get(name)
      const offsite = elsewhere && !sameGitPath(elsewhere.path, repositoryRoot) ? elsewhere : undefined
      return {
        name,
        current: currentBranch === name,
        ...(offsite ? { worktreePath: offsite.path, worktreePrimary: offsite.primary } : {})
      }
    })

    const dirtyCount = (await repository.execute(['status', '--porcelain=v1']))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length

    return { ok: true, repositoryRoot, primaryRepositoryRoot, currentBranch, branches, dirtyCount }
  } catch (error) {
    return mapGitBranchError(error)
  }
}

/** Switch the workspace's working tree to an existing local branch. */
export async function switchGitBranchForWorkspace(
  workspaceRoot: string,
  branchName: string
): Promise<TeachingGitBranchesResult> {
  const branch = branchName.trim()
  if (!workspaceRoot.trim()) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    const repository = await openTeachingGitRepository(workspaceRoot)
    await requireCanonicalBranchName(repository, branch)
    const branchSet = new Set(await listLocalBranchNames(repository))
    if (!branchSet.has(branch)) {
      return { ok: false, reason: 'error', message: 'Branch does not exist in this repository.' }
    }
    try {
      await repository.execute(['switch', '--no-guess', branch], { timeoutMs: GIT_BRANCH_TIMEOUT_MS })
    } catch {
      // Older git (< 2.23) has no `switch`; fall back to `checkout`.
      await repository.execute(['checkout', branch], { timeoutMs: GIT_BRANCH_TIMEOUT_MS })
    }
    return getGitBranchesForWorkspace(workspaceRoot)
  } catch (error) {
    return mapGitBranchError(error)
  }
}

/** Create a new local branch from HEAD and check it out in the workspace. */
export async function createAndSwitchGitBranchForWorkspace(
  workspaceRoot: string,
  branchName: string
): Promise<TeachingGitBranchesResult> {
  const branch = branchName.trim()
  if (!workspaceRoot.trim()) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    const repository = await openTeachingGitRepository(workspaceRoot)
    await requireCanonicalBranchName(repository, branch)
    try {
      await repository.execute(['switch', '-c', branch], { timeoutMs: GIT_BRANCH_TIMEOUT_MS })
    } catch {
      await repository.execute(['checkout', '-b', branch], { timeoutMs: GIT_BRANCH_TIMEOUT_MS })
    }
    return getGitBranchesForWorkspace(workspaceRoot)
  } catch (error) {
    return mapGitBranchError(error)
  }
}

async function readCurrentBranch(repository: TeachingGitRepository): Promise<string | null> {
  const branch = (await repository.execute(['branch', '--show-current'])).trim()
  return branch || null
}

async function listLocalBranchNames(repository: TeachingGitRepository): Promise<string[]> {
  return (await repository.execute(['branch', '--format=%(refname:short)']))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function requireCanonicalBranchName(repository: TeachingGitRepository, branch: string): Promise<void> {
  const canonical = (await repository.execute(['check-ref-format', '--branch', branch])).trim()
  if (canonical !== branch) {
    throw new Error('Branch name must be a canonical local branch name.')
  }
}

async function listWorktreesInternal(repository: TeachingGitRepository): Promise<ParsedWorktree[]> {
  const output = await repository.execute(['worktree', 'list', '--porcelain'])
  const rows: ParsedWorktree[] = []
  let current: ParsedWorktree | null = null
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) rows.push(current)
      current = null
      continue
    }
    if (line.startsWith('worktree ')) {
      if (current) rows.push(current)
      current = {
        path: resolve(line.slice('worktree '.length).trim()),
        head: '',
        branch: null
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim()
      continue
    }
    if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim()
      current.branch = ref.replace(/^refs\/heads\//, '') || null
    }
  }
  if (current) rows.push(current)
  return rows
}

async function readCreatedAt(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    const date = info.birthtimeMs > 0 ? info.birthtime : info.mtime
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  } catch {
    return null
  }
}

function mapGitError(error: unknown): TeachingGitWorktreesResult {
  const failure = classifyGitRepositoryFailure(error)
  return { ok: false, ...failure }
}

function mapGitBranchError(error: unknown): TeachingGitBranchesResult {
  const failure = classifyGitRepositoryFailure(error)
  return { ok: false, ...failure }
}
