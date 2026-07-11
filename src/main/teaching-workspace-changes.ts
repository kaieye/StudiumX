import { execFile as execFileCallback } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { isPathInsideRoot } from './path-access'
import {
  normalizeWorkspaceRelativePath
} from './teaching-workspace-paths'
import type {
  TeachingWorkspaceChangedFile,
  TeachingWorkspaceChangedFileKind,
  TeachingWorkspaceChangedFileStatus,
  TeachingWorkspaceChangeSummary,
  TeachingWorkspaceChangeTrigger,
  WorkspaceChangeDiffResult
} from '../shared/teaching-types'

const execFile = promisify(execFileCallback)
const MAX_GIT_OUTPUT = 8 * 1024 * 1024
const DEFAULT_DIFF_LIMIT = 220_000

type GitStatusEntry = {
  code: string
  relativePath: string
}

export type TeachingWorkspaceChangeSnapshot = {
  git: TeachingWorkspaceChangeSummary['git']
  statusByPath: Map<string, GitStatusEntry>
}

export async function captureWorkspaceChangeSnapshot(
  workspaceRoot: string
): Promise<TeachingWorkspaceChangeSnapshot> {
  try {
    const repositoryRoot = (await runGit(workspaceRoot, ['rev-parse', '--show-toplevel'])).trim()
    const status = await runGit(workspaceRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    return {
      git: { available: true, repositoryRoot },
      statusByPath: new Map(parseGitStatus(status).map((entry) => [entry.relativePath, entry]))
    }
  } catch (error) {
    return {
      git: gitUnavailable(error),
      statusByPath: new Map()
    }
  }
}

export async function summarizeWorkspaceChanges(options: {
  workspaceId: string
  workspaceRoot: string
  timestamp: string
  trigger: TeachingWorkspaceChangeTrigger
  before: TeachingWorkspaceChangeSnapshot
  affectedPaths: string[]
}): Promise<TeachingWorkspaceChangeSummary | null> {
  const after = await captureWorkspaceChangeSnapshot(options.workspaceRoot)
  const changedPaths = collectChangedPaths(options.before, after, options.affectedPaths)
  if (changedPaths.length === 0) return null

  const diffStats = after.git.available
    ? await readGitDiffStats(options.workspaceRoot, changedPaths)
    : new Map<string, { additions: number | null; deletions: number | null }>()

  const changedFiles = await Promise.all(changedPaths.map(async (relativePath): Promise<TeachingWorkspaceChangedFile> => {
    const beforeEntry = options.before.statusByPath.get(relativePath)
    const afterEntry = after.statusByPath.get(relativePath)
    const status = statusForChange(beforeEntry, afterEntry)
    const stats = diffStats.get(relativePath) ?? await fallbackStatsForPath(options.workspaceRoot, relativePath, status, after.git.available)
    return {
      relativePath,
      status,
      fileKind: fileKindForPath(relativePath),
      additions: stats.additions,
      deletions: stats.deletions,
      diffAvailable: status !== 'deleted' && isTextDiffPath(relativePath)
    }
  }))

  const additions = sumKnown(changedFiles.map((file) => file.additions))
  const deletions = sumKnown(changedFiles.map((file) => file.deletions))
  return {
    id: `${options.workspaceId}:${Date.parse(options.timestamp) || Date.now()}:${changedFiles.map((file) => file.relativePath).join('|')}`,
    workspaceId: options.workspaceId,
    timestamp: options.timestamp,
    trigger: options.trigger,
    changedFiles: changedFiles.sort(compareChangedFiles),
    additions,
    deletions,
    summary: buildChangeSummary(changedFiles, additions, deletions),
    git: after.git.available ? after.git : options.before.git.available ? options.before.git : after.git
  }
}

export async function readWorkspaceChangeDiff(options: {
  workspaceRoot: string
  relativePath: string
  maxBytes?: number
}): Promise<WorkspaceChangeDiffResult> {
  const relativePath = normalizeWorkspaceRelativePath(options.relativePath)
  if (!relativePath || relativePath.includes('../') || !isTextDiffPath(relativePath)) {
    return { ok: false, message: 'No text diff is available for this file.' }
  }
  const absolutePath = resolve(join(options.workspaceRoot, relativePath))
  if (!isPathInsideRoot(options.workspaceRoot, absolutePath)) {
    return { ok: false, message: 'Path is outside the workspace.' }
  }
  const limit = Math.max(1_000, Math.min(options.maxBytes ?? DEFAULT_DIFF_LIMIT, 1_000_000))
  const git = await captureWorkspaceChangeSnapshot(options.workspaceRoot)
  if (git.git.available) {
    const diff = await runGit(options.workspaceRoot, ['diff', '--no-ext-diff', '--no-color', 'HEAD', '--', relativePath]).catch(() => '')
    if (diff.trim()) return truncateDiff(relativePath, diff, limit)
    if (git.statusByPath.get(relativePath)?.code !== '??') {
      return { ok: false, message: 'No diff is available for this file yet.' }
    }
  }

  const added = await renderAddedFileDiff(absolutePath, relativePath, limit).catch(() => null)
  if (added) return added
  return { ok: false, message: 'No diff is available for this file yet.' }
}

function collectChangedPaths(
  before: TeachingWorkspaceChangeSnapshot,
  after: TeachingWorkspaceChangeSnapshot,
  affectedPaths: string[]
): string[] {
  const paths = new Set<string>()
  for (const [relativePath, afterEntry] of after.statusByPath) {
    const beforeEntry = before.statusByPath.get(relativePath)
    if (!beforeEntry || beforeEntry.code !== afterEntry.code) paths.add(relativePath)
  }
  for (const [relativePath] of before.statusByPath) {
    if (!after.statusByPath.has(relativePath)) paths.add(relativePath)
  }
  for (const rawPath of affectedPaths) {
    const relativePath = normalizeWorkspaceRelativePath(rawPath)
    if (relativePath) paths.add(relativePath)
  }
  return [...paths].filter((path) => !path.endsWith('/')).sort()
}

function parseGitStatus(output: string): GitStatusEntry[] {
  const chunks = output.split('\0')
  const entries: GitStatusEntry[] = []
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (!chunk || chunk.length < 4) continue
    const code = chunk.slice(0, 2)
    const relativePath = normalizeWorkspaceRelativePath(chunk.slice(3))
    if (!relativePath) continue
    entries.push({ code, relativePath })
    if (code.includes('R') || code.includes('C')) index += 1
  }
  return entries
}

async function readGitDiffStats(
  workspaceRoot: string,
  relativePaths: string[]
): Promise<Map<string, { additions: number | null; deletions: number | null }>> {
  const stats = new Map<string, { additions: number | null; deletions: number | null }>()
  if (relativePaths.length === 0) return stats
  const output = await runGit(workspaceRoot, ['diff', '--numstat', '--no-ext-diff', 'HEAD', '--', ...relativePaths]).catch(() => '')
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [additionsRaw, deletionsRaw, rawPath] = line.split('\t')
    const relativePath = normalizeWorkspaceRelativePath(rawPath ?? '')
    if (!relativePath) continue
    const additions = additionsRaw === '-' ? null : Number.parseInt(additionsRaw ?? '', 10)
    const deletions = deletionsRaw === '-' ? null : Number.parseInt(deletionsRaw ?? '', 10)
    stats.set(relativePath, {
      additions: Number.isFinite(additions) ? additions : null,
      deletions: Number.isFinite(deletions) ? deletions : null
    })
  }
  return stats
}

async function fallbackStatsForPath(
  workspaceRoot: string,
  relativePath: string,
  status: TeachingWorkspaceChangedFileStatus,
  gitAvailable: boolean
): Promise<{ additions: number | null; deletions: number | null }> {
  if (gitAvailable && status !== 'untracked') return { additions: null, deletions: null }
  if (!isTextDiffPath(relativePath) || status === 'deleted') return { additions: null, deletions: null }
  try {
    const content = await readFile(resolve(join(workspaceRoot, relativePath)), 'utf8')
    return { additions: countLines(content), deletions: 0 }
  } catch {
    return { additions: null, deletions: null }
  }
}

function statusForChange(
  before: GitStatusEntry | undefined,
  after: GitStatusEntry | undefined
): TeachingWorkspaceChangedFileStatus {
  if (!after && before) return 'deleted'
  if (!after) return 'changed'
  if (after.code === '??') return 'untracked'
  if (after.code.includes('R')) return 'renamed'
  if (after.code.includes('D')) return 'deleted'
  if (after.code.includes('A')) return 'added'
  if (after.code.trim()) return 'modified'
  return 'changed'
}

function fileKindForPath(relativePath: string): TeachingWorkspaceChangedFileKind {
  const path = relativePath.toLowerCase()
  if (path === 'mission.md') return 'mission'
  if (path === 'resources.md') return 'resource'
  if (path.startsWith('reference/')) return 'reference'
  if (path.startsWith('learning-records/')) return 'learning_record'
  if (path.startsWith('reviews/')) return 'review'
  if (path.startsWith('assets/')) return 'asset'
  if (path === '.teachos/index.json') return 'workspace_index'
  if (path === '.teachos/sessions.jsonl') return 'session_event'
  if (path.startsWith('conversation/') || path.includes('/conversation/')) return 'conversation'
  if (path.endsWith('.html') && (path.startsWith('lessons/') || path.startsWith('courses/'))) return 'lesson'
  return 'other'
}

function isTextDiffPath(relativePath: string): boolean {
  return /\.(?:css|html?|js|json|jsonl|md|markdown|svg|txt)$/i.test(relativePath)
}

function compareChangedFiles(left: TeachingWorkspaceChangedFile, right: TeachingWorkspaceChangedFile): number {
  const priority = (file: TeachingWorkspaceChangedFile): number => {
    if (file.fileKind === 'lesson') return 0
    if (file.fileKind === 'reference') return 1
    if (file.fileKind === 'learning_record') return 2
    if (file.fileKind === 'review') return 3
    if (file.fileKind === 'workspace_index' || file.fileKind === 'session_event') return 8
    return 5
  }
  return priority(left) - priority(right) || left.relativePath.localeCompare(right.relativePath)
}

function buildChangeSummary(files: TeachingWorkspaceChangedFile[], additions: number, deletions: number): string {
  const lessonCount = files.filter((file) => file.fileKind === 'lesson').length
  const referenceCount = files.filter((file) => file.fileKind === 'reference').length
  const recordCount = files.filter((file) => file.fileKind === 'learning_record').length
  const reviewCount = files.filter((file) => file.fileKind === 'review').length
  const parts = [
    lessonCount ? `${lessonCount} lesson` : '',
    referenceCount ? `${referenceCount} reference` : '',
    recordCount ? `${recordCount} learning record` : '',
    reviewCount ? `${reviewCount} review asset` : ''
  ].filter(Boolean)
  const artifactPart = parts.length ? parts.join(', ') : `${files.length} workspace file${files.length === 1 ? '' : 's'}`
  const diffPart = additions || deletions ? ` (${additions} additions, ${deletions} deletions)` : ''
  return `Updated ${artifactPart}${diffPart}.`
}

function sumKnown(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0)
}

async function renderAddedFileDiff(
  absolutePath: string,
  relativePath: string,
  limit: number
): Promise<WorkspaceChangeDiffResult | null> {
  const info = await stat(absolutePath)
  if (!info.isFile() || info.size > 700_000) return null
  const content = await readFile(absolutePath, 'utf8')
  const lines = content.split(/\r?\n/)
  const body = lines.map((line) => `+${line}`).join('\n')
  return truncateDiff(
    relativePath,
    `diff --git a/${relativePath} b/${relativePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +1,${countLines(content)} @@\n${body}\n`,
    limit
  )
}

function truncateDiff(relativePath: string, diff: string, limit: number): WorkspaceChangeDiffResult {
  if (diff.length <= limit) return { ok: true, relativePath, diff, truncated: false }
  return {
    ok: true,
    relativePath,
    diff: `${diff.slice(0, limit)}\n\n[diff truncated]\n`,
    truncated: true
  }
}

function countLines(text: string): number {
  if (!text) return 0
  return text.endsWith('\n') ? text.split(/\r?\n/).length - 1 : text.split(/\r?\n/).length
}

async function runGit(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', ['-C', resolve(workspaceRoot), ...args], {
    windowsHide: true,
    maxBuffer: MAX_GIT_OUTPUT,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
  })
  return stdout
}

function gitUnavailable(error: unknown): TeachingWorkspaceChangeSummary['git'] {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { available: false, reason: 'not_git_repo', message: 'Current workspace is not a Git repository.' }
  }
  if (/spawn git ENOENT/i.test(message) || /'git' is not recognized/i.test(message)) {
    return { available: false, reason: 'git_unavailable', message: 'Git is not available in PATH.' }
  }
  return { available: false, reason: 'error', message }
}
