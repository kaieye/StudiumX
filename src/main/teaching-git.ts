import { stat } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { isPathInsideRoot } from './path-access'
import type {
  OpenPathResult,
  TeachingGitBranchesResult,
  TeachingGitBranchRow,
  TeachingGitWorkspaceInfo,
  TeachingGitWorktreeRow,
  TeachingGitWorktreesResult
} from '../shared/teaching-types'

const execFile = promisify(execFileCallback)

type ParsedWorktree = {
  path: string
  head: string
  branch: string | null
}

export async function inspectGitWorkspace(workspaceRoot: string): Promise<TeachingGitWorkspaceInfo | null> {
  try {
    const repositoryRoot = await resolveRepositoryRoot(workspaceRoot)
    const worktrees = await listWorktreesInternal(workspaceRoot)
    const primaryWorktreePath = worktrees[0]?.path ?? repositoryRoot
    const currentBranch = await readCurrentBranch(workspaceRoot)
    return {
      repositoryRoot,
      primaryWorktreePath,
      currentBranch,
      isWorktree: !samePath(repositoryRoot, primaryWorktreePath)
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
    const repositoryRoot = await resolveRepositoryRoot(workspaceRoot)
    const worktrees = await listWorktreesInternal(workspaceRoot)
    const primaryWorktreePath = worktrees[0]?.path ?? repositoryRoot
    const rows = await Promise.all(
      worktrees.map(async (worktree) => ({
        path: worktree.path,
        branch: worktree.branch,
        head: worktree.head,
        isPrimary: samePath(worktree.path, primaryWorktreePath),
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
    const target = listed.worktrees.find((worktree) => samePath(worktree.path, input.worktreePath))
    if (!target) {
      return { ok: false, message: 'Worktree not found.' }
    }
    if (target.isPrimary) {
      return { ok: false, message: 'Primary worktree cannot be removed.' }
    }
    if (!target.isManaged) {
      return { ok: false, message: 'Worktree path is outside the configured worktree root.' }
    }
    await runGit(input.workspaceRoot, ['worktree', 'remove', '--force', resolve(input.worktreePath)])
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
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
    const repositoryRoot = (await runGit(trimmed, ['rev-parse', '--show-toplevel'])).trim()
    const currentRaw = (await runGit(trimmed, ['branch', '--show-current'])).trim()
    const currentBranch = currentRaw || null
    const branchLines = await listLocalBranchNames(trimmed)
    const branchSet = new Set(branchLines)
    if (currentBranch && !branchSet.has(currentBranch)) branchSet.add(currentBranch)

    const worktreeRows = await listWorktreesInternal(trimmed)
    const primaryRepositoryRoot = worktreeRows[0]?.path ?? repositoryRoot
    const worktreeByBranch = new Map<string, { path: string; primary: boolean }>()
    for (const row of worktreeRows) {
      if (row.branch && !worktreeByBranch.has(row.branch)) {
        worktreeByBranch.set(row.branch, {
          path: row.path,
          primary: samePath(row.path, primaryRepositoryRoot)
        })
      }
    }

    const branches: TeachingGitBranchRow[] = [...branchSet].map((name) => {
      // A branch checked out in *another* worktree cannot be switched to here.
      // (The current branch lives in this worktree, so it is never "elsewhere".)
      const elsewhere = name === currentBranch ? undefined : worktreeByBranch.get(name)
      const offsite = elsewhere && !samePath(elsewhere.path, repositoryRoot) ? elsewhere : undefined
      return {
        name,
        current: currentBranch === name,
        ...(offsite ? { worktreePath: offsite.path, worktreePrimary: offsite.primary } : {})
      }
    })

    const dirtyCount = (await runGit(trimmed, ['status', '--porcelain=v1']))
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
    await requireCanonicalBranchName(workspaceRoot, branch)
    const branchSet = new Set(await listLocalBranchNames(workspaceRoot))
    if (!branchSet.has(branch)) {
      return { ok: false, reason: 'error', message: 'Branch does not exist in this repository.' }
    }
    try {
      await runGit(workspaceRoot, ['switch', '--no-guess', branch], 20_000)
    } catch {
      // Older git (< 2.23) has no `switch`; fall back to `checkout`.
      await runGit(workspaceRoot, ['checkout', branch], 20_000)
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
    await requireCanonicalBranchName(workspaceRoot, branch)
    try {
      await runGit(workspaceRoot, ['switch', '-c', branch], 20_000)
    } catch {
      await runGit(workspaceRoot, ['checkout', '-b', branch], 20_000)
    }
    return getGitBranchesForWorkspace(workspaceRoot)
  } catch (error) {
    return mapGitBranchError(error)
  }
}

async function resolveRepositoryRoot(workspaceRoot: string): Promise<string> {
  return (await runGit(workspaceRoot, ['rev-parse', '--show-toplevel'])).trim()
}

async function readCurrentBranch(workspaceRoot: string): Promise<string | null> {
  const branch = (await runGit(workspaceRoot, ['branch', '--show-current'])).trim()
  return branch || null
}

async function listLocalBranchNames(workspaceRoot: string): Promise<string[]> {
  return (await runGit(workspaceRoot, ['branch', '--format=%(refname:short)']))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function requireCanonicalBranchName(workspaceRoot: string, branch: string): Promise<void> {
  const canonical = (await runGit(workspaceRoot, ['check-ref-format', '--branch', branch])).trim()
  if (canonical !== branch) {
    throw new Error('Branch name must be a canonical local branch name.')
  }
}

async function listWorktreesInternal(workspaceRoot: string): Promise<ParsedWorktree[]> {
  const output = await runGit(workspaceRoot, ['worktree', 'list', '--porcelain'])
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

async function runGit(workspaceRoot: string, args: string[], timeout?: number): Promise<string> {
  const cwd = resolve(workspaceRoot)
  const { stdout } = await execFile('git', ['-C', cwd, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    // Force a C locale so git emits English diagnostics — keeps the error
    // classification below stable regardless of the user's system language.
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    ...(timeout ? { timeout } : {})
  })
  return stdout
}

function mapGitError(error: unknown): TeachingGitWorktreesResult {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'Current workspace is not a Git repository.' }
  }
  if (/spawn git ENOENT/i.test(message) || /'git' is not recognized/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git is not available in PATH.' }
  }
  return { ok: false, reason: 'error', message }
}

function mapGitBranchError(error: unknown): TeachingGitBranchesResult {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'Current workspace is not a Git repository.' }
  }
  if (/spawn git ENOENT/i.test(message) || /'git' is not recognized/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git is not available in PATH.' }
  }
  return { ok: false, reason: 'error', message }
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
