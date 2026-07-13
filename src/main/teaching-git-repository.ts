import { execFile as execFileCallback } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export const GIT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
export const GIT_DEFAULT_TIMEOUT_MS = 30_000
export const GIT_BRANCH_TIMEOUT_MS = 20_000

type GitCommandScope = 'workspace' | 'repository'

type GitCommandOptions = {
  scope?: GitCommandScope
  env?: Record<string, string>
  timeoutMs?: number
}

export type GitRepositoryFailure = {
  reason: 'not_git_repo' | 'git_unavailable' | 'error'
  message: string
}

/**
 * The canonical identity and controlled command execution policy for the Git
 * repository that contains a Teaching workspace. Branch/worktree and change
 * checkpoint modules deliberately share this seam rather than owning separate
 * subprocess, locale, error, and path rules.
 */
export type TeachingGitRepository = Readonly<{
  workspaceRoot: string
  repositoryRoot: string
  workspaceInRepository: string
  execute: (args: string[], options?: GitCommandOptions) => Promise<string>
}>

export async function openTeachingGitRepository(workspaceRoot: string): Promise<TeachingGitRepository> {
  const canonicalWorkspaceRoot = await canonicalizeGitPath(workspaceRoot)
  const repositoryOutput = await executeGitCommand(canonicalWorkspaceRoot, ['rev-parse', '--show-toplevel'])
  const repositoryRoot = await canonicalizeGitPath(repositoryOutput.trim())
  const workspaceInRepository = workspacePathInRepository(repositoryRoot, canonicalWorkspaceRoot)

  return {
    workspaceRoot: canonicalWorkspaceRoot,
    repositoryRoot,
    workspaceInRepository,
    execute: (args, options = {}) => executeGitCommand(
      options.scope === 'repository' ? repositoryRoot : canonicalWorkspaceRoot,
      args,
      options
    )
  }
}

/** Execute a Git command under StudiumX's shared process and locale policy. */
export async function executeGitCommand(
  workingPath: string,
  args: string[],
  options: Omit<GitCommandOptions, 'scope'> = {}
): Promise<string> {
  const cwd = resolve(workingPath)
  const { stdout } = await execFile('git', ['-C', cwd, ...args], {
    windowsHide: true,
    maxBuffer: GIT_MAX_OUTPUT_BYTES,
    timeout: normalizeTimeout(options.timeoutMs),
    // Git diagnostics must stay classifiable independent of the operating
    // system language. Call-specific environment values may add Git settings,
    // but may not override the stable diagnostic locale.
    env: { ...process.env, ...options.env, LC_ALL: 'C', LANG: 'C' }
  })
  return stdout
}

/** Resolve symlinks when possible so repository and workspace identity compare safely. */
export async function canonicalizeGitPath(path: string): Promise<string> {
  return realpath(resolve(path))
}

export function workspacePathInRepository(repositoryRoot: string, workspaceRoot: string): string {
  const workspaceFromRepository = relative(repositoryRoot, workspaceRoot)
  if (
    workspaceFromRepository === '..' ||
    workspaceFromRepository.startsWith(`..${sep}`) ||
    isAbsolute(workspaceFromRepository)
  ) {
    throw new Error('Workspace is outside the resolved Git repository.')
  }
  return normalizeGitPath(workspaceFromRepository) || '.'
}

export function sameGitPath(left: string, right: string): boolean {
  return normalizeComparableGitPath(left) === normalizeComparableGitPath(right)
}

export function normalizeGitPath(value: string): string {
  return value.split(sep).join('/').replace(/^\.\//, '').replace(/\/$/, '')
}

export function classifyGitRepositoryFailure(error: unknown): GitRepositoryFailure {
  const details = gitErrorDetails(error)
  if (/not a git repository/i.test(details)) {
    return { reason: 'not_git_repo', message: 'Current workspace is not a Git repository.' }
  }
  if (hasErrorCode(error, 'ENOENT') || /spawn git ENOENT/i.test(details) || /'git' is not recognized/i.test(details)) {
    return { reason: 'git_unavailable', message: 'Git is not available in PATH.' }
  }
  if (hasErrorCode(error, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') || /maxBuffer length exceeded/i.test(details)) {
    return { reason: 'error', message: 'Git command output exceeded the supported limit.' }
  }
  if (hasErrorCode(error, 'ETIMEDOUT') || /timed out/i.test(details)) {
    return { reason: 'error', message: 'Git command timed out.' }
  }
  return { reason: 'error', message: error instanceof Error ? error.message : String(error) }
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) return GIT_DEFAULT_TIMEOUT_MS
  return Math.max(1_000, Math.min(Math.floor(timeoutMs as number), 120_000))
}

function normalizeComparableGitPath(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

function gitErrorDetails(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error)
  const candidate = error as { message?: unknown; stderr?: unknown }
  return [candidate.message, candidate.stderr]
    .filter((value): value is string | Buffer => typeof value === 'string' || Buffer.isBuffer(value))
    .map((value) => value.toString())
    .join('\n')
}