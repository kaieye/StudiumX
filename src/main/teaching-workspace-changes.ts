import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { isPathInsideRoot } from './path-access'
import {
  canonicalizeGitPath,
  classifyGitRepositoryFailure,
  executeGitCommand,
  normalizeGitPath,
  openTeachingGitRepository,
  workspacePathInRepository
} from './teaching-git-repository'
import {
  normalizeWorkspaceRelativePath
} from './teaching-workspace-paths'
import type {
  TeachingWorkspaceChangedFile,
  TeachingWorkspaceChangedFileKind,
  TeachingWorkspaceChangedFileStatus,
  TeachingWorkspaceChangeSummary,
  TeachingWorkspaceChangeTrigger,
  TeachingWorkspaceGitCheckpoint,
  WorkspaceChangeDiffResult
} from '../shared/teaching-types'

const DEFAULT_DIFF_LIMIT = 220_000

type GitStatusEntry = {
  code: string
  relativePath: string
}

type GitTreeCheckpoint = {
  commitOid: string
  repositoryRoot: string
  workspaceInRepository: string
}

type GitCheckpointDiffEntry = {
  relativePath: string
  status: TeachingWorkspaceChangedFileStatus
}

type GitCheckpointPair = {
  before: GitTreeCheckpoint
  after: GitTreeCheckpoint
}

const latestCheckpointPairByWorkspace = new Map<string, GitCheckpointPair>()

export type TeachingWorkspaceChangeSnapshot = {
  git: TeachingWorkspaceChangeSummary['git']
  statusByPath: Map<string, GitStatusEntry>
  checkpoint?: GitTreeCheckpoint
}

export async function captureWorkspaceChangeSnapshot(
  workspaceRoot: string
): Promise<TeachingWorkspaceChangeSnapshot> {
  try {
    const checkpoint = await createGitTreeCheckpoint(workspaceRoot)
    return {
      git: { available: true, repositoryRoot: checkpoint.repositoryRoot },
      statusByPath: new Map(),
      checkpoint
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
  const checkpointPair = comparableCheckpointPair(options.before, after)
  if (checkpointPair) latestCheckpointPairByWorkspace.set(resolve(options.workspaceRoot), checkpointPair)
  const checkpointEntries = checkpointPair
    ? await readCheckpointDiffEntries(checkpointPair)
    : null
  const changedPaths = checkpointEntries
    ? checkpointEntries.map((entry) => entry.relativePath)
    : collectChangedPaths(options.before, after, options.affectedPaths)
  if (changedPaths.length === 0) return null

  const diffStats = checkpointPair
    ? await readCheckpointDiffStats(checkpointPair, changedPaths)
    : after.git.available
      ? await readGitDiffStats(options.workspaceRoot, changedPaths)
    : new Map<string, { additions: number | null; deletions: number | null }>()
  const checkpointStatusByPath = new Map(checkpointEntries?.map((entry) => [entry.relativePath, entry.status]) ?? [])

  const changedFiles = await Promise.all(changedPaths.map(async (relativePath): Promise<TeachingWorkspaceChangedFile> => {
    const beforeEntry = options.before.statusByPath.get(relativePath)
    const afterEntry = after.statusByPath.get(relativePath)
    const status = checkpointStatusByPath.get(relativePath) ?? statusForChange(beforeEntry, afterEntry)
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
  const id = `${options.workspaceId}:${Date.parse(options.timestamp) || Date.now()}:${changedFiles.map((file) => file.relativePath).join('|')}`
  const summary: TeachingWorkspaceChangeSummary = {
    id,
    workspaceId: options.workspaceId,
    timestamp: options.timestamp,
    trigger: options.trigger,
    changedFiles: changedFiles.sort(compareChangedFiles),
    additions,
    deletions,
    summary: buildChangeSummary(changedFiles, additions, deletions),
    ...(checkpointPair ? { checkpoint: serializeCheckpointPair(checkpointPair) } : {}),
    git: after.git.available ? after.git : options.before.git.available ? options.before.git : after.git
  }
  if (checkpointPair) await retainCheckpointPair(checkpointPair, id).catch(() => {})
  return summary
}

export async function readWorkspaceChangeDiff(options: {
  workspaceRoot: string
  relativePath: string
  checkpoint?: TeachingWorkspaceGitCheckpoint
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
  const checkpointPair = options.checkpoint
    ? await deserializeCheckpointPair(options.workspaceRoot, options.checkpoint)
    : latestCheckpointPairByWorkspace.get(resolve(options.workspaceRoot))
  if (checkpointPair) {
    const repoRelativePath = toRepositoryRelativePath(checkpointPair.after, relativePath)
    const diff = await executeGitCommand(checkpointPair.after.repositoryRoot, [
      'diff',
      '--no-ext-diff',
      '--no-color',
      checkpointPair.before.commitOid,
      checkpointPair.after.commitOid,
      '--',
      repoRelativePath
    ]).catch(() => '')
    if (diff.trim()) return truncateDiff(relativePath, diff, limit)
    return { ok: false, message: 'No diff is available for this file yet.' }
  }
  const git = await captureWorkspaceChangeSnapshot(options.workspaceRoot)
  if (git.git.available) {
    const diff = await executeGitCommand(options.workspaceRoot, ['diff', '--no-ext-diff', '--no-color', 'HEAD', '--', relativePath]).catch(() => '')
    if (diff.trim()) return truncateDiff(relativePath, diff, limit)
    if (git.statusByPath.get(relativePath)?.code !== '??') {
      return { ok: false, message: 'No diff is available for this file yet.' }
    }
  }

  const added = await renderAddedFileDiff(absolutePath, relativePath, limit).catch(() => null)
  if (added) return added
  return { ok: false, message: 'No diff is available for this file yet.' }
}

function serializeCheckpointPair(pair: GitCheckpointPair): TeachingWorkspaceGitCheckpoint {
  return {
    repositoryRoot: pair.after.repositoryRoot,
    workspaceInRepository: pair.after.workspaceInRepository,
    beforeCommitOid: pair.before.commitOid,
    afterCommitOid: pair.after.commitOid
  }
}

async function deserializeCheckpointPair(
  workspaceRoot: string,
  checkpoint: TeachingWorkspaceGitCheckpoint
): Promise<GitCheckpointPair | null> {
  if (!/^[0-9a-f]{40,64}$/i.test(checkpoint.beforeCommitOid) || !/^[0-9a-f]{40,64}$/i.test(checkpoint.afterCommitOid)) {
    return null
  }
  const resolvedWorkspaceRoot = await canonicalizeGitPath(workspaceRoot).catch(() => '')
  const repositoryRoot = await canonicalizeGitPath(checkpoint.repositoryRoot).catch(() => '')
  if (!resolvedWorkspaceRoot || !repositoryRoot) return null
  const workspaceInRepository = (() => {
    try {
      return workspacePathInRepository(repositoryRoot, resolvedWorkspaceRoot)
    } catch {
      return ''
    }
  })()
  if (!workspaceInRepository) return null
  if (workspaceInRepository !== checkpoint.workspaceInRepository) return null
  return {
    before: {
      commitOid: checkpoint.beforeCommitOid,
      repositoryRoot,
      workspaceInRepository
    },
    after: {
      commitOid: checkpoint.afterCommitOid,
      repositoryRoot,
      workspaceInRepository
    }
  }
}

async function retainCheckpointPair(pair: GitCheckpointPair, id: string): Promise<void> {
  const key = createHash('sha256').update(id).digest('hex').slice(0, 24)
  const prefix = `refs/studiumx/checkpoints/${key}`
  await Promise.all([
    executeGitCommand(pair.after.repositoryRoot, ['update-ref', `${prefix}/before`, pair.before.commitOid]),
    executeGitCommand(pair.after.repositoryRoot, ['update-ref', `${prefix}/after`, pair.after.commitOid])
  ])
}

async function createGitTreeCheckpoint(workspaceRoot: string): Promise<GitTreeCheckpoint> {
  const repository = await openTeachingGitRepository(workspaceRoot)
  const { repositoryRoot, workspaceInRepository } = repository
  const tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-git-checkpoint-'))
  const temporaryIndex = join(tempRoot, 'index')
  const checkpointEnv = {
    GIT_INDEX_FILE: temporaryIndex,
    GIT_AUTHOR_NAME: 'StudiumX Checkpoint',
    GIT_AUTHOR_EMAIL: 'checkpoint@studiumx.local',
    GIT_COMMITTER_NAME: 'StudiumX Checkpoint',
    GIT_COMMITTER_EMAIL: 'checkpoint@studiumx.local'
  }

  try {
    const indexPathOutput = (await repository.execute(['rev-parse', '--git-path', 'index'], { scope: 'repository' })).trim()
    const indexPath = isAbsolute(indexPathOutput) ? indexPathOutput : resolve(repositoryRoot, indexPathOutput)
    const copiedIndex = await copyFile(indexPath, temporaryIndex).then(() => true).catch(() => false)
    if (!copiedIndex) {
      const hasHead = await repository.execute(['rev-parse', '--verify', 'HEAD'], { scope: 'repository' }).then(() => true).catch(() => false)
      await repository.execute(hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], {
        scope: 'repository',
        env: checkpointEnv
      })
    }
    await repository.execute(['add', '-A', '--', workspaceInRepository], { scope: 'repository', env: checkpointEnv })
    const treeOid = (await repository.execute(['write-tree'], { scope: 'repository', env: checkpointEnv })).trim()
    const commitOid = (await repository.execute(
      ['commit-tree', treeOid, '-m', `studiumx checkpoint ${Date.now()}`],
      { scope: 'repository', env: checkpointEnv }
    )).trim()
    return { commitOid, repositoryRoot, workspaceInRepository }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function comparableCheckpointPair(
  before: TeachingWorkspaceChangeSnapshot,
  after: TeachingWorkspaceChangeSnapshot
): GitCheckpointPair | null {
  if (!before.checkpoint || !after.checkpoint) return null
  if (before.checkpoint.repositoryRoot !== after.checkpoint.repositoryRoot) return null
  if (before.checkpoint.workspaceInRepository !== after.checkpoint.workspaceInRepository) return null
  return { before: before.checkpoint, after: after.checkpoint }
}

async function readCheckpointDiffEntries(pair: GitCheckpointPair): Promise<GitCheckpointDiffEntry[]> {
  const output = await executeGitCommand(pair.after.repositoryRoot, [
    'diff',
    '--name-status',
    '--find-renames',
    '-z',
    pair.before.commitOid,
    pair.after.commitOid,
    '--',
    pair.after.workspaceInRepository
  ])
  const chunks = output.split('\0').filter(Boolean)
  const entries: GitCheckpointDiffEntry[] = []
  for (let index = 0; index < chunks.length;) {
    const code = chunks[index++] ?? ''
    const status = checkpointStatusForCode(code)
    if (status === 'renamed') {
      index += 1
      const newPath = chunks[index++] ?? ''
      const relativePath = fromRepositoryRelativePath(pair.after, newPath)
      if (relativePath) entries.push({ relativePath, status })
      continue
    }
    const repositoryRelativePath = chunks[index++] ?? ''
    const relativePath = fromRepositoryRelativePath(pair.after, repositoryRelativePath)
    if (relativePath) entries.push({ relativePath, status })
  }
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function readCheckpointDiffStats(
  pair: GitCheckpointPair,
  relativePaths: string[]
): Promise<Map<string, { additions: number | null; deletions: number | null }>> {
  const stats = new Map<string, { additions: number | null; deletions: number | null }>()
  await Promise.all(relativePaths.map(async (relativePath) => {
    const output = await executeGitCommand(pair.after.repositoryRoot, [
      'diff',
      '--numstat',
      '--no-ext-diff',
      pair.before.commitOid,
      pair.after.commitOid,
      '--',
      toRepositoryRelativePath(pair.after, relativePath)
    ]).catch(() => '')
    const line = output.split(/\r?\n/).find((candidate) => candidate.trim())
    if (!line) return
    const [additionsRaw, deletionsRaw] = line.split('\t')
    const additions = additionsRaw === '-' ? null : Number.parseInt(additionsRaw ?? '', 10)
    const deletions = deletionsRaw === '-' ? null : Number.parseInt(deletionsRaw ?? '', 10)
    stats.set(relativePath, {
      additions: Number.isFinite(additions) ? additions : null,
      deletions: Number.isFinite(deletions) ? deletions : null
    })
  }))
  return stats
}

function checkpointStatusForCode(code: string): TeachingWorkspaceChangedFileStatus {
  if (code.startsWith('A')) return 'added'
  if (code.startsWith('D')) return 'deleted'
  if (code.startsWith('R') || code.startsWith('C')) return 'renamed'
  return 'modified'
}

function fromRepositoryRelativePath(checkpoint: GitTreeCheckpoint, rawPath: string): string | null {
  const repositoryRelativePath = normalizeGitPath(rawPath)
  const workspacePrefix = checkpoint.workspaceInRepository === '.' ? '' : `${checkpoint.workspaceInRepository}/`
  if (workspacePrefix && !repositoryRelativePath.startsWith(workspacePrefix)) return null
  const relativePath = normalizeWorkspaceRelativePath(workspacePrefix
    ? repositoryRelativePath.slice(workspacePrefix.length)
    : repositoryRelativePath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) return null
  return relativePath
}

function toRepositoryRelativePath(checkpoint: GitTreeCheckpoint, relativePath: string): string {
  return checkpoint.workspaceInRepository === '.'
    ? normalizeGitPath(relativePath)
    : `${checkpoint.workspaceInRepository}/${normalizeGitPath(relativePath)}`
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

async function readGitDiffStats(
  workspaceRoot: string,
  relativePaths: string[]
): Promise<Map<string, { additions: number | null; deletions: number | null }>> {
  const stats = new Map<string, { additions: number | null; deletions: number | null }>()
  if (relativePaths.length === 0) return stats
  const output = await executeGitCommand(workspaceRoot, ['diff', '--numstat', '--no-ext-diff', 'HEAD', '--', ...relativePaths]).catch(() => '')
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

function gitUnavailable(error: unknown): TeachingWorkspaceChangeSummary['git'] {
  const failure = classifyGitRepositoryFailure(error)
  return { available: false, ...failure }
}
