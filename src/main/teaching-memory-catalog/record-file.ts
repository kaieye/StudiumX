import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { TeachingMemoryRecord } from '../../shared/teaching-types'
import { ensureContainedDirectory, isPathInsideRoot } from '../path-access'
import { replaceDurably } from '../persistence/durable-file'

const RECORD_FILE_PREFIX = 'memory-'
const RECORD_FILE_SUFFIX = '.json'
const GLOBAL_PARTITION = '_global'
const PARTITION_VERSION = 'v1'
const PARTITION_PATTERN = /^(workspace|project)-[A-Za-z0-9_-]{43}\.v1$/

export type TeachingMemoryRecordLayout = 'flat' | 'scoped'

/**
 * An accepted memory source under a trusted memory root.
 * Paths are root-constrained pathname metadata; publication uses replaceDurably.
 * Not descriptor/CAS-equivalent (ADR-0012).
 */
export type TeachingMemoryRecordFileSource = {
  fileName: string
  filePath: string
  layout: TeachingMemoryRecordLayout
  partition?: string
  entryName: string
  parentAbsolutePath: string
  rootAbsolutePath: string
}

export type TeachingMemoryRecordFileDiscoveryIssue = {
  fileName: string
  filePath: string
  reason: 'unsafe_path' | 'unrecognized_partition' | 'deep_directory' | 'file_name_mismatch'
}

export type TeachingMemoryRecordFileDiscovery = {
  sources: TeachingMemoryRecordFileSource[]
  issues: TeachingMemoryRecordFileDiscoveryIssue[]
  /** Absolute resolved memory root when the root is available. */
  rootAbsolutePath?: string
}

/**
 * The durable file convention for a Teaching-memory record. Record IDs are
 * encoded rather than interpolated into paths, so every ID has one safe,
 * deterministic canonical name on every supported platform.
 */
export function teachingMemoryRecordFileName(id: string): string {
  const normalizedId = normalizeRecordId(id)
  return `${RECORD_FILE_PREFIX}${Buffer.from(normalizedId, 'utf8').toString('base64url')}${RECORD_FILE_SUFFIX}`
}

/** The legacy flat canonical location. New records are written to a partition. */
export function teachingMemoryRecordFilePath(rootDir: string, id: string): string {
  return join(rootDir, teachingMemoryRecordFileName(id))
}

/**
 * Computes the internal-only partition name from a normalized durable record.
 * The caller must normalize and validate the record in main before invoking
 * this helper; renderer-provided paths and keys are never accepted here.
 */
export function teachingMemoryScopeDirectory(record: Pick<TeachingMemoryRecord, 'scope' | 'workspace' | 'project'>): string {
  if (record.scope === 'user') return GLOBAL_PARTITION
  const normalizedScopeRoot = record.scope === 'workspace' ? record.workspace : record.project
  if (!normalizedScopeRoot) throw new Error(`${record.scope} Teaching-memory records require a normalized scope root.`)
  const digest = createHash('sha256')
    .update(`studiumx:teaching-memory-scope:v1\0${record.scope}\0${normalizedScopeRoot}`, 'utf8')
    .digest('base64url')
  if (digest.length !== 43) throw new Error('Unexpected Teaching-memory scope digest length.')
  return `${record.scope}-${digest}.${PARTITION_VERSION}`
}

export function teachingMemoryScopedRecordFilePath(rootDir: string, record: Pick<TeachingMemoryRecord, 'id' | 'scope' | 'workspace' | 'project'>): string {
  return join(rootDir, teachingMemoryScopeDirectory(record), teachingMemoryRecordFileName(record.id))
}

export function isCanonicalTeachingMemoryRecordFileName(fileName: string): boolean {
  return fileName.startsWith(RECORD_FILE_PREFIX) && fileName.endsWith(RECORD_FILE_SUFFIX)
}

export function isTeachingMemoryRecordFileName(fileName: string, id: string): boolean {
  const legacyFileName = legacyTeachingMemoryRecordFileName(id)
  return fileName === teachingMemoryRecordFileName(id) || fileName === legacyFileName
}

export function isRecognizedTeachingMemoryScopeDirectory(name: string): boolean {
  return name === GLOBAL_PARTITION || PARTITION_PATTERN.test(name)
}

/** Discovery normally creates the configured Memory root for legacy CRUD compatibility. */
export type TeachingMemoryRecordFileDiscoveryOptions = {
  /** Diagnostics opt out so a missing Memory root stays absent. */
  createRoot?: boolean
}

/**
 * Discovers only root-flat JSON files plus canonical files one level below an
 * explicitly recognized partition. Symlinks and deep trees become recovery issues.
 * Single pathname backend for every platform (no native descriptor dependency).
 */
export async function discoverTeachingMemoryRecordFiles(
  rootDir: string,
  options: TeachingMemoryRecordFileDiscoveryOptions = {}
): Promise<TeachingMemoryRecordFileDiscovery> {
  const rootPath = resolve(rootDir)
  const createRoot = options.createRoot ?? true
  const issues: TeachingMemoryRecordFileDiscoveryIssue[] = []

  try {
    await ensureMemoryRoot(rootPath, createRoot)
  } catch (error) {
    if (!createRoot && isNotFoundError(error)) {
      return { sources: [], issues }
    }
    issues.push({ fileName: '', filePath: rootPath, reason: 'unsafe_path' })
    return { sources: [], issues }
  }

  let rootEntries: string[]
  try {
    rootEntries = await readdir(rootPath)
  } catch {
    issues.push({ fileName: '', filePath: rootPath, reason: 'unsafe_path' })
    return { sources: [], issues }
  }

  const sources: TeachingMemoryRecordFileSource[] = []
  for (const name of rootEntries.sort((a, b) => a.localeCompare(b))) {
    const entryPath = join(rootPath, name)
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(entryPath)
    } catch {
      issues.push({ fileName: name, filePath: entryPath, reason: 'unsafe_path' })
      continue
    }
    if (info.isSymbolicLink()) {
      issues.push({ fileName: name, filePath: entryPath, reason: 'unsafe_path' })
      continue
    }
    if (info.isFile()) {
      if (name.endsWith(RECORD_FILE_SUFFIX)) {
        sources.push(pathnameSource(rootPath, name, 'flat', rootPath, name))
      }
      continue
    }
    if (!info.isDirectory()) continue
    if (!isRecognizedTeachingMemoryScopeDirectory(name)) {
      issues.push({ fileName: name, filePath: entryPath, reason: 'unrecognized_partition' })
      continue
    }
    await discoverPartition(rootPath, name, entryPath, sources, issues)
  }

  return { sources, issues, rootAbsolutePath: rootPath }
}

/** Opens (creates) a scoped partition directory under the memory root. */
export async function openTeachingMemoryScopedRecordDirectory(
  rootDir: string,
  record: Pick<TeachingMemoryRecord, 'scope' | 'workspace' | 'project'>
): Promise<{ parentAbsolutePath: string; partition: string; rootAbsolutePath: string }> {
  const rootAbsolutePath = resolve(rootDir)
  const partition = teachingMemoryScopeDirectory(record)
  const parentAbsolutePath = join(rootAbsolutePath, partition)
  await ensureMemoryRoot(rootAbsolutePath, true)
  await ensureContainedDirectory(rootAbsolutePath, parentAbsolutePath)
  return { parentAbsolutePath, partition, rootAbsolutePath }
}

export function teachingMemorySourceForNewRecord(
  rootDir: string,
  record: Pick<TeachingMemoryRecord, 'id' | 'scope' | 'workspace' | 'project'>,
  opened: { parentAbsolutePath: string; partition: string; rootAbsolutePath: string }
): TeachingMemoryRecordFileSource {
  const entryName = teachingMemoryRecordFileName(record.id)
  const fileName = join(opened.partition, entryName)
  return {
    fileName,
    filePath: join(resolve(rootDir), fileName),
    layout: 'scoped',
    partition: opened.partition,
    entryName,
    parentAbsolutePath: opened.parentAbsolutePath,
    rootAbsolutePath: opened.rootAbsolutePath
  }
}

/** Reads one accepted source through root-constrained pathname I/O. */
export async function readTeachingMemoryRecordFileAtSource(
  source: Pick<TeachingMemoryRecordFileSource, 'parentAbsolutePath' | 'rootAbsolutePath' | 'entryName'>
): Promise<Buffer> {
  const absolute = absoluteEntryPath(source)
  try {
    const info = await lstat(absolute)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error('Memory source is not an eligible regular file.')
    }
    await assertRealPathInsideRoot(source.rootAbsolutePath, absolute)
    return await readFile(absolute)
  } catch (error) {
    if (error instanceof Error && error.message === 'Memory source is not an eligible regular file.') throw error
    throw new Error('Memory source path is outside the configured root or unsafe.', { cause: error })
  }
}

/**
 * Writes only through replaceDurably under an already-resolved parent path.
 * Same-directory temp -> write -> optional fsync -> rename (durable-file).
 */
export async function replaceTeachingMemoryRecordFileAtSource(
  source: Pick<TeachingMemoryRecordFileSource, 'parentAbsolutePath' | 'rootAbsolutePath' | 'entryName'>,
  record: unknown
): Promise<void> {
  if (!isSafeBasename(source.entryName)) {
    throw new Error('Memory entry name is invalid.')
  }
  await ensureContainedDirectory(source.rootAbsolutePath, source.parentAbsolutePath)
  const absolute = absoluteEntryPath(source)
  await assertRealPathInsideRoot(source.rootAbsolutePath, source.parentAbsolutePath)
  await replaceDurably({
    path: absolute,
    content: `${JSON.stringify(record, null, 2)}\n`
  })
  await assertRealPathInsideRoot(source.rootAbsolutePath, absolute)
}

/** Pathname discovery does not retain open directory descriptors. */
export function closeTeachingMemoryRecordFileDiscovery(_discovery: TeachingMemoryRecordFileDiscovery): void {
  // no-op
}

// --- internals ---

async function discoverPartition(
  rootPath: string,
  partition: string,
  partitionPath: string,
  sources: TeachingMemoryRecordFileSource[],
  issues: TeachingMemoryRecordFileDiscoveryIssue[]
): Promise<void> {
  let names: string[]
  try {
    const info = await lstat(partitionPath)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      issues.push({ fileName: partition, filePath: partitionPath, reason: 'unsafe_path' })
      return
    }
    await assertRealPathInsideRoot(rootPath, partitionPath)
    names = await readdir(partitionPath)
  } catch {
    issues.push({ fileName: partition, filePath: partitionPath, reason: 'unsafe_path' })
    return
  }

  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    const filePath = join(partitionPath, name)
    const fileName = join(partition, name)
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(filePath)
    } catch {
      issues.push({ fileName, filePath, reason: 'unsafe_path' })
      continue
    }
    if (info.isSymbolicLink()) {
      issues.push({ fileName, filePath, reason: 'unsafe_path' })
      continue
    }
    if (info.isDirectory()) {
      issues.push({ fileName, filePath, reason: 'deep_directory' })
      continue
    }
    if (!info.isFile()) continue
    if (!isCanonicalTeachingMemoryRecordFileName(name)) {
      if (name.endsWith(RECORD_FILE_SUFFIX)) issues.push({ fileName, filePath, reason: 'file_name_mismatch' })
      continue
    }
    sources.push(pathnameSource(rootPath, fileName, 'scoped', partitionPath, name, partition))
  }
}

function pathnameSource(
  rootPath: string,
  fileName: string,
  layout: TeachingMemoryRecordLayout,
  parentAbsolutePath: string,
  entryName: string,
  partition?: string
): TeachingMemoryRecordFileSource {
  return {
    fileName,
    filePath: join(rootPath, fileName),
    layout,
    ...(partition ? { partition } : {}),
    entryName,
    parentAbsolutePath,
    rootAbsolutePath: rootPath
  }
}

function absoluteEntryPath(
  source: Pick<TeachingMemoryRecordFileSource, 'parentAbsolutePath' | 'entryName'>
): string {
  if (!isSafeBasename(source.entryName)) {
    throw new Error('Memory entry name is invalid.')
  }
  return join(source.parentAbsolutePath, source.entryName)
}

async function ensureMemoryRoot(rootPath: string, createIfMissing: boolean): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>> | null = null
  try {
    info = await lstat(rootPath)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
    if (!createIfMissing) throw error
    await mkdir(rootPath, { recursive: true })
    info = await lstat(rootPath)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Teaching-memory catalog root is unavailable.')
  }
}

async function assertRealPathInsideRoot(rootPath: string, targetPath: string): Promise<void> {
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
    if (!isPathInsideRoot(realRoot, realTarget)) {
      throw new Error('Path escapes the configured memory root after resolving symlinks.')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Path escapes')) throw error
    // Parent may not exist yet during create; lexical check is the fallback.
    if (!isPathInsideRoot(resolve(rootPath), resolve(targetPath))) {
      throw new Error('Path is outside the configured memory root.', { cause: error })
    }
  }
}

function isSafeBasename(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes('\0') &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\')
  )
}

function legacyTeachingMemoryRecordFileName(id: string): string | null {
  const normalizedId = normalizeRecordId(id)
  return /^[^\\/:*?"<>|]+$/.test(normalizedId) ? `${normalizedId}${RECORD_FILE_SUFFIX}` : null
}

function normalizeRecordId(id: string): string {
  const normalized = String(id).trim()
  if (!normalized) throw new Error('Teaching-memory record IDs must not be empty')
  return normalized
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
