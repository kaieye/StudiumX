/**
 * Git-free write pre-image journal for a single agent run.
 * Captures first-touch state under `.studiumx/checkpoints/<runId>/write-journal.jsonl`.
 * Does not own permission, containment, or durable publication — callers do.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

export type WriteRewindJournalEntry = Readonly<{
  version: 1
  runId: string
  relativePath: string
  capturedAt: string
  existed: boolean
  /** Pre-image UTF-8 text when the path existed as a regular file before write. */
  preImageUtf8: string | null
  /** SHA-256 of the content that was about to be written (for safe create-rewind). */
  writtenContentSha256: string
  bytes: number
  /**
   * Optional permission audit metadata (ADR-0063 residual / C2).
   * Policy allow|prompt|forbidden, or interactive deny. Omitted when capture path
   * does not know a decision; journal does not own permission settlement.
   */
  permissionDecision?: 'allow' | 'prompt' | 'forbidden' | 'deny'
}>

export type CaptureWritePreImageInput = Readonly<{
  workspaceRoot: string
  relativePath: string
  runId: string
  content: string
  nowIso?: () => string
  /** Optional permission audit when capture path already knows the decision. */
  permissionDecision?: 'allow' | 'prompt' | 'forbidden' | 'deny'
}>

export type RestoreWriteRewindResult = Readonly<{
  restored: string[]
  deleted: string[]
  skipped: Array<{ path: string; reason: string }>
}>

const JOURNAL_FILE = 'write-journal.jsonl'
const MAX_PRE_IMAGE_BYTES = 1_500_000

export function writeRewindJournalDirectory(workspaceRoot: string, runId: string): string {
  return join(resolve(workspaceRoot), '.studiumx', 'checkpoints', sanitizeRunId(runId))
}

export function writeRewindJournalPath(workspaceRoot: string, runId: string): string {
  return join(writeRewindJournalDirectory(workspaceRoot, runId), JOURNAL_FILE)
}

export function sanitizeRunId(runId: string): string {
  const trimmed = runId.trim()
  if (!trimmed) return 'unknown-run'
  return trimmed.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
}

export function sha256Utf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Capture first-touch pre-image for a relative workspace path.
 * Idempotent per path within a run: later writes to the same path reuse the first entry.
 */
export async function captureAndAppendWritePreImage(
  input: CaptureWritePreImageInput
): Promise<WriteRewindJournalEntry | null> {
  const runId = input.runId.trim()
  const workspaceRoot = resolve(input.workspaceRoot)
  const relativePath = normalizeRelativeWorkspacePath(input.relativePath)
  if (!runId || !relativePath) return null

  const existingJournal = await readWriteRewindJournal({ workspaceRoot, runId })
  if (existingJournal.some((entry) => entry.relativePath === relativePath)) {
    return null
  }

  const absolutePath = resolve(workspaceRoot, ...relativePath.split('/'))
  if (!isPathInsideRoot(workspaceRoot, absolutePath)) return null

  let existed = false
  let preImageUtf8: string | null = null
  try {
    const info = await stat(absolutePath)
    if (!info.isFile()) {
      // Non-regular targets are refused by the durable writer; do not journal them.
      return null
    }
    if (info.size > MAX_PRE_IMAGE_BYTES) return null
    const bytes = await readFile(absolutePath)
    if (bytes.includes(0)) return null
    preImageUtf8 = bytes.toString('utf8')
    existed = true
  } catch {
    existed = false
    preImageUtf8 = null
  }

  const entry: WriteRewindJournalEntry = {
    version: 1,
    runId,
    relativePath,
    capturedAt: (input.nowIso ?? (() => new Date().toISOString()))(),
    existed,
    preImageUtf8,
    writtenContentSha256: sha256Utf8(input.content),
    bytes: Buffer.byteLength(input.content, 'utf8'),
    ...(input.permissionDecision === 'allow' ||
    input.permissionDecision === 'prompt' ||
    input.permissionDecision === 'forbidden' ||
    input.permissionDecision === 'deny'
      ? { permissionDecision: input.permissionDecision }
      : {})
  }

  await appendWriteRewindJournalEntry({ workspaceRoot, runId, entry })
  return entry
}

export async function readWriteRewindJournal(input: {
  workspaceRoot: string
  runId: string
}): Promise<WriteRewindJournalEntry[]> {
  const path = writeRewindJournalPath(input.workspaceRoot, input.runId)
  try {
    const text = await readFile(path, 'utf8')
    const entries: WriteRewindJournalEntry[] = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as WriteRewindJournalEntry
        if (parsed?.version === 1 && typeof parsed.relativePath === 'string') entries.push(parsed)
      } catch {
        // skip corrupt line
      }
    }
    return entries
  } catch {
    return []
  }
}

export async function appendWriteRewindJournalEntry(input: {
  workspaceRoot: string
  runId: string
  entry: WriteRewindJournalEntry
}): Promise<void> {
  const dir = writeRewindJournalDirectory(input.workspaceRoot, input.runId)
  await mkdir(dir, { recursive: true })
  const path = writeRewindJournalPath(input.workspaceRoot, input.runId)
  const line = `${JSON.stringify(input.entry)}\n`
  // Append-only best effort; Windows-friendly via read-merge-write for small journals.
  let prior = ''
  try {
    prior = await readFile(path, 'utf8')
  } catch {
    prior = ''
  }
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${prior}${line}`, 'utf8')
  await rename(tmp, path)
}

/**
 * Restore journaled pre-images for a run.
 * - existed: rewrite file with pre-image (plain write; caller may prefer durable publisher)
 * - !existed: delete only if current content still matches the journaled write hash
 *
 * Distinct from conversation prefix checkpoint; this only rewinds tool writes for one run.
 */
export async function restoreWriteRewindJournal(input: {
  workspaceRoot: string
  runId: string
}): Promise<RestoreWriteRewindResult> {
  const workspaceRoot = resolve(input.workspaceRoot)
  const entries = await readWriteRewindJournal({ workspaceRoot, runId: input.runId })
  const restored: string[] = []
  const deleted: string[] = []
  const skipped: Array<{ path: string; reason: string }> = []

  // Reverse chronological restore so last write rewinds first.
  for (const entry of [...entries].reverse()) {
    const absolutePath = resolve(workspaceRoot, ...entry.relativePath.split('/'))
    if (!isPathInsideRoot(workspaceRoot, absolutePath)) {
      skipped.push({ path: entry.relativePath, reason: 'path_outside_workspace' })
      continue
    }
    try {
      if (entry.existed) {
        if (entry.preImageUtf8 == null) {
          skipped.push({ path: entry.relativePath, reason: 'missing_pre_image' })
          continue
        }
        await mkdir(dirname(absolutePath), { recursive: true })
        await writeFile(absolutePath, entry.preImageUtf8, 'utf8')
        restored.push(entry.relativePath)
      } else {
        try {
          const current = await readFile(absolutePath)
          if (sha256Utf8(current.toString('utf8')) !== entry.writtenContentSha256) {
            skipped.push({ path: entry.relativePath, reason: 'content_changed_since_write' })
            continue
          }
          await rm(absolutePath, { force: true })
          deleted.push(entry.relativePath)
        } catch {
          skipped.push({ path: entry.relativePath, reason: 'create_target_absent' })
        }
      }
    } catch {
      skipped.push({ path: entry.relativePath, reason: 'restore_failed' })
    }
  }

  return { restored, deleted, skipped }
}

export function normalizeRelativeWorkspacePath(value: string): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim().replace(/\\/g, '/')
  if (!candidate || candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate)) return null
  const parts: string[] = []
  for (const part of candidate.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : null
}

function isPathInsideRoot(root: string, absolutePath: string): boolean {
  const rel = relative(resolve(root), resolve(absolutePath))
  return rel !== '' && !rel.startsWith(`..${sep}`) && !rel.startsWith('..') && rel !== '..'
}
/**
 * Pure association for audit metadata (does not write FS).
 * Prefer captureAndAppendWritePreImage({ permissionDecision }) at write time.
 */
export function withPermissionDecision(
  entry: WriteRewindJournalEntry,
  decision: WriteRewindJournalEntry['permissionDecision']
): WriteRewindJournalEntry {
  if (
    decision !== 'allow' &&
    decision !== 'prompt' &&
    decision !== 'forbidden' &&
    decision !== 'deny'
  ) {
    return entry
  }
  return { ...entry, permissionDecision: decision }
}
