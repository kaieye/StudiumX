import { lstat, mkdir, open, readdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** The default maximum active JSONL size before its next append is sealed. */
export const DEFAULT_DURABLE_JSONL_MAX_BYTES = 50 * 1024 * 1024

const SEALED_SEGMENT_SEQUENCE_WIDTH = 6
const pendingOperations = new Map<string, Promise<void>>()

export type DurableJsonlOptions = {
  /** Path whose basename is retained for the writable active JSONL file. */
  activePath: string
  /** Rotate before an append that would exceed this size. */
  maxBytes?: number
  /** Injectable clock for deterministic callers and tests. */
  now?: () => Date
  /**
   * Optional directory durability seam. Production callers normally leave this
   * unset; tests can inject platform or I/O failures without monkey-patching fs.
   */
  syncDirectory?: (directory: string) => Promise<void>
}

export type DurableJsonlSegment = {
  path: string
  kind: 'sealed' | 'active'
  month?: string
  sequence?: number
}

/**
 * One canonical durable JSONL source read. `bytes` are the exact bytes consumed
 * for `lines`, so derived stores can retain exact-byte provenance without
 * independently discovering or rereading ledger segments.
 */
export type DurableJsonlSource = DurableJsonlSegment & {
  bytes: Buffer
  lines: string[]
}

/**
 * Appends one complete JSONL line. Appends and rotations for an active path are
 * serialized in-process; callers may safely issue concurrent writes.
 */
export async function appendDurableJsonlLine(options: DurableJsonlOptions, line: string): Promise<void> {
  const normalizedLine = normalizeJsonlLine(line)
  await serialize(options.activePath, async () => {
    await appendLine(options, normalizedLine)
  })
}

/**
 * Explicitly seals a non-empty active JSONL file. The active basename is never
 * changed permanently: after the rename, the next append recreates it.
 */
export async function rotateDurableJsonl(options: DurableJsonlOptions): Promise<string | null> {
  let sealedPath: string | null = null
  await serialize(options.activePath, async () => {
    sealedPath = await rotateActiveFile(options)
  })
  return sealedPath
}

/** Returns sealed segments in chronological sequence followed by the active file. */
export async function discoverDurableJsonlSegments(activePath: string): Promise<DurableJsonlSegment[]> {
  const directory = dirname(activePath)
  const activeName = basename(activePath)
  const sealed = await readdir(directory, { withFileTypes: true }).then(async (entries) => {
    const candidates = entries
      // Dirent keeps symlinks out; lstat below repeats the regular-file check
      // immediately before the candidate becomes a canonical source.
      .filter((entry) => entry.isFile())
      .map((entry) => parseSealedSegmentName(activeName, entry.name))
      .filter((segment): segment is { name: string; month: string; sequence: number } => segment !== null)
      .sort(compareSealedSegments)
    const accepted: DurableJsonlSegment[] = []
    for (const segment of candidates) {
      const path = join(directory, segment.name)
      if (await isRegularFile(path)) accepted.push({ path, kind: 'sealed', month: segment.month, sequence: segment.sequence })
    }
    return accepted
  }).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  })

  return await isRegularFile(activePath) ? [...sealed, { path: activePath, kind: 'active' }] : sealed
}

/**
 * Reads every strictly recognized sealed segment and then the active JSONL file.
 * This is the canonical discovery-and-read seam for consumers needing exact
 * source provenance in addition to parsed non-blank JSONL lines.
 */
export async function readDurableJsonlSources(activePath: string): Promise<DurableJsonlSource[]> {
  const segments = await discoverDurableJsonlSegments(activePath)
  const sources: DurableJsonlSource[] = []
  for (const segment of segments) sources.push({ ...segment, ...await readRegularFile(segment.path) })
  return sources
}

/** Reads every strictly recognized sealed segment and then the active JSONL file. */
export async function readDurableJsonlLines(activePath: string): Promise<string[]> {
  return (await readDurableJsonlSources(activePath)).flatMap((source) => source.lines)
}

/** Builds the only accepted filename shape for a sealed sibling segment. */
export function durableJsonlSealedSegmentFileName(activeFileName: string, month: string, sequence: number): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Durable JSONL segment month must use YYYY-MM.')
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence >= 10 ** SEALED_SEGMENT_SEQUENCE_WIDTH) {
    throw new Error('Durable JSONL segment sequence is out of range.')
  }
  const stem = activeFileName.endsWith('.jsonl')
    ? activeFileName.slice(0, -'.jsonl'.length)
    : activeFileName
  return `${stem}.sealed-${month}-${String(sequence).padStart(SEALED_SEGMENT_SEQUENCE_WIDTH, '0')}.jsonl`
}

async function appendLine(options: DurableJsonlOptions, line: string): Promise<void> {
  const activePath = options.activePath
  const maxBytes = options.maxBytes ?? DEFAULT_DURABLE_JSONL_MAX_BYTES
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('Durable JSONL maxBytes must be a positive finite number.')
  }

  await mkdir(dirname(activePath), { recursive: true })
  const activeInfo = await lstat(activePath).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  })
  if (activeInfo && !activeInfo.isFile()) {
    throw new Error('Durable JSONL active path is not a regular file.')
  }

  const now = currentTime(options)
  const lineBytes = Buffer.byteLength(line, 'utf8')
  if (activeInfo && activeInfo.size > 0 && (
    monthKey(activeInfo.mtime) !== monthKey(now) || activeInfo.size + lineBytes > maxBytes
  )) {
    await rotateActiveFile(options, activeInfo.mtime)
  }

  const file = await open(activePath, 'a', 0o600)
  try {
    await file.writeFile(line, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  await syncDirectory(dirname(activePath), options.syncDirectory)
}

async function rotateActiveFile(options: DurableJsonlOptions, knownMtime?: Date): Promise<string | null> {
  const activePath = options.activePath
  const activeInfo = await lstat(activePath).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  })
  if (!activeInfo || activeInfo.size === 0) return null
  if (!activeInfo.isFile()) throw new Error('Durable JSONL active path is not a regular file.')

  // Windows requires a writable handle for fsync even though this operation
  // only confirms the already-appended active file before rename.
  const file = await open(activePath, process.platform === 'win32' ? 'r+' : 'r')
  try {
    await file.sync()
  } finally {
    await file.close()
  }

  const directory = dirname(activePath)
  const activeName = basename(activePath)
  // Automatic rotations preserve the month of the pre-existing file. An
  // explicit rotation instead represents a caller-created boundary, so use
  // the injectable clock rather than the filesystem's wall-clock mtime.
  const month = monthKey(knownMtime ?? currentTime(options))
  const sealedPath = await nextSealedSegmentPath(directory, activeName, month)
  await rename(activePath, sealedPath)
  await createSyncedEmptyActiveFile(activePath)
  await syncDirectory(directory, options.syncDirectory)
  return sealedPath
}

async function createSyncedEmptyActiveFile(activePath: string): Promise<void> {
  const file = await open(activePath, 'a', 0o600)
  try {
    await file.sync()
  } finally {
    await file.close()
  }
}

async function nextSealedSegmentPath(directory: string, activeName: string, month: string): Promise<string> {
  const existing = (await discoverDurableJsonlSegments(join(directory, activeName)))
    .filter((segment) => segment.kind === 'sealed' && segment.month === month)
    .map((segment) => segment.sequence!)
  const sequence = existing.length === 0 ? 1 : Math.max(...existing) + 1
  return join(directory, durableJsonlSealedSegmentFileName(activeName, month, sequence))
}

async function isRegularFile(path: string): Promise<boolean> {
  return lstat(path).then((info) => info.isFile()).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  })
}

async function readRegularFile(path: string): Promise<{ bytes: Buffer; lines: string[] }> {
  // lstat rejects symlinks. Retain device/inode identity through open so a
  // replacement between discovery and read cannot silently redirect a source.
  const before = await lstat(path)
  if (!before.isFile()) throw new Error('Durable JSONL source path is not a regular file.')
  const file = await open(path, 'r')
  try {
    const opened = await file.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('Durable JSONL source changed while it was being opened.')
    }
    const bytes = await file.readFile()
    return { bytes, lines: bytes.toString('utf8').split(/\r?\n/).filter((line) => line.trim()) }
  } finally {
    await file.close()
  }
}

function compareSealedSegments(left: { month: string; sequence: number }, right: { month: string; sequence: number }): number {
  return left.month < right.month ? -1 : left.month > right.month ? 1 : left.sequence - right.sequence
}

function parseSealedSegmentName(activeFileName: string, candidate: string): { name: string; month: string; sequence: number } | null {
  const stem = activeFileName.endsWith('.jsonl')
    ? activeFileName.slice(0, -'.jsonl'.length)
    : activeFileName
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${escapedStem}\\.sealed-(\\d{4}-(?:0[1-9]|1[0-2]))-(\\d{${SEALED_SEGMENT_SEQUENCE_WIDTH}})\\.jsonl$`).exec(candidate)
  if (!match) return null
  const sequence = Number(match[2])
  if (!Number.isInteger(sequence) || sequence < 1) return null
  return { name: candidate, month: match[1]!, sequence }
}

function normalizeJsonlLine(line: string): string {
  const normalized = line.replace(/\r?\n$/, '')
  if (!normalized.trim()) throw new Error('Durable JSONL append requires a non-empty line.')
  if (/\r|\n/.test(normalized)) throw new Error('Durable JSONL append requires exactly one line.')
  return `${normalized}\n`
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function currentTime(options: DurableJsonlOptions): Date {
  const now = (options.now ?? (() => new Date()))()
  if (Number.isNaN(now.getTime())) throw new Error('Durable JSONL clock returned an invalid date.')
  return now
}

async function serialize(activePath: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingOperations.get(activePath) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  pendingOperations.set(activePath, current)
  try {
    await current
  } finally {
    if (pendingOperations.get(activePath) === current) pendingOperations.delete(activePath)
  }
}

/**
 * Sync the containing directory after a create or rename. Directory fsync is
 * unavailable on some platform/filesystem combinations; only their documented
 * "operation unsupported" errors are downgraded. Permission, I/O, and all
 * other failures reject the append/rotate so the caller is never told that a
 * durability boundary succeeded when it did not.
 */
async function syncDirectory(
  directory: string,
  injectedSync?: (directory: string) => Promise<void>
): Promise<void> {
  // Node on Windows cannot fsync a directory handle (it returns EPERM). This
  // is the same unsupported-directory capability downgrade that applies to
  // documented filesystem errors. Do not apply it to injected seams: tests
  // and callers use those to surface genuine permission and I/O failures.
  if (!injectedSync && process.platform === 'win32') return

  try {
    await (injectedSync ?? syncDirectoryOnDisk)(directory)
  } catch (error) {
    if (isDirectorySyncUnsupportedError(error)) return
    throw error
  }
}

async function syncDirectoryOnDisk(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function isDirectorySyncUnsupportedError(error: unknown): boolean {
  return ['EOPNOTSUPP', 'ENOTSUP', 'ENOSYS', 'EINVAL', 'EISDIR'].includes(errorCode(error) ?? '')
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code as string | undefined
    : undefined
}
