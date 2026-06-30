import { stat } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  OpenPathResult,
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
        isManaged: isInside(worktreeRoot, worktree.path),
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

async function resolveRepositoryRoot(workspaceRoot: string): Promise<string> {
  return (await runGit(workspaceRoot, ['rev-parse', '--show-toplevel'])).trim()
}

async function readCurrentBranch(workspaceRoot: string): Promise<string | null> {
  const branch = (await runGit(workspaceRoot, ['branch', '--show-current'])).trim()
  return branch || null
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

async function runGit(workspaceRoot: string, args: string[]): Promise<string> {
  const cwd = resolve(workspaceRoot)
  const { stdout } = await execFile('git', ['-C', cwd, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
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

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isInside(rootPath: string, targetPath: string): boolean {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}
