import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { TeachingMemoryRecord } from '../../shared/teaching-types'
import {
  closeContainedDurableDirectory,
  isNativeContainedDurableReplaceUnavailable,
  listContainedDirectory,
  openContainedDirectoryChild,
  openContainedRootDirectory,
  replaceDurablyInContainedDirectory,
  type ContainedDurableDirectory,
  type ContainedDirectoryEntry
} from '../persistence/contained-durable-directory'

const RECORD_FILE_PREFIX = 'memory-'
const RECORD_FILE_SUFFIX = '.json'
const GLOBAL_PARTITION = '_global'
const PARTITION_VERSION = 'v1'
const PARTITION_PATTERN = /^(workspace|project)-[A-Za-z0-9_-]{43}\.v1$/

export type TeachingMemoryRecordLayout = 'flat' | 'scoped'

/**
 * An accepted source remains bound to the no-follow descriptor that listed its
 * parent directory. `filePath` is display/index metadata only; catalog reads
 * and writes use `directory` + `entryName`, never that pathname.
 */
export type TeachingMemoryRecordFileSource = {
  fileName: string
  filePath: string
  layout: TeachingMemoryRecordLayout
  partition?: string
  directory: ContainedDurableDirectory
  entryName: string
}

export type TeachingMemoryRecordFileDiscoveryIssue = {
  fileName: string
  filePath: string
  reason: 'unsafe_path' | 'unrecognized_partition' | 'deep_directory' | 'file_name_mismatch'
}

export type TeachingMemoryRecordFileDiscovery = {
  sources: TeachingMemoryRecordFileSource[]
  issues: TeachingMemoryRecordFileDiscoveryIssue[]
  rootDirectory?: ContainedDurableDirectory
  partitionDirectories: ContainedDurableDirectory[]
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

/**
 * Discovers only root-flat JSON files plus canonical files one level below an
 * explicitly recognized partition. Native directory descriptors bind every
 * listing/read/write parent; no C-6 operation performs a post-check pathname
 * traversal or follows a symlink.
 */
export async function discoverTeachingMemoryRecordFiles(rootDir: string): Promise<TeachingMemoryRecordFileDiscovery> {
  const rootPath = resolve(rootDir)
  const issues: TeachingMemoryRecordFileDiscoveryIssue[] = []
  let rootDirectory: ContainedDurableDirectory
  try {
    rootDirectory = openContainedRootDirectory(rootPath, true)
  } catch (error) {
    if (isNativeContainedDurableReplaceUnavailable(error)) throw error
    issues.push({ fileName: '', filePath: rootPath, reason: 'unsafe_path' })
    return { sources: [], issues, partitionDirectories: [] }
  }

  const partitionDirectories: ContainedDurableDirectory[] = []
  try {
    const rootEntries = listContainedDirectory(rootDirectory)
    const sources: TeachingMemoryRecordFileSource[] = []
    for (const entry of sortedEntries(rootEntries)) {
      const entryPath = join(rootPath, entry.name)
      if (entry.type === 'symlink') {
        issues.push({ fileName: entry.name, filePath: entryPath, reason: 'unsafe_path' })
        continue
      }
      if (entry.type === 'file') {
        if (entry.name.endsWith(RECORD_FILE_SUFFIX)) {
          sources.push(source(rootPath, entry.name, 'flat', rootDirectory))
        }
        continue
      }
      if (entry.type !== 'directory') continue
      if (!isRecognizedTeachingMemoryScopeDirectory(entry.name)) {
        issues.push({ fileName: entry.name, filePath: entryPath, reason: 'unrecognized_partition' })
        continue
      }

      let partitionDirectory: ContainedDurableDirectory
      try {
        partitionDirectory = openContainedDirectoryChild(rootDirectory, entry.name, false)
      } catch (error) {
        if (isNativeContainedDurableReplaceUnavailable(error)) throw error
        issues.push({ fileName: entry.name, filePath: entryPath, reason: 'unsafe_path' })
        continue
      }
      partitionDirectories.push(partitionDirectory)
      discoverPartitionFiles(rootPath, entry.name, partitionDirectory, sources, issues)
    }
    return { sources, issues, rootDirectory, partitionDirectories }
  } catch (error) {
    closeTeachingMemoryRecordFileDiscovery({ sources: [], issues, rootDirectory, partitionDirectories })
    if (isNativeContainedDurableReplaceUnavailable(error)) throw error
    issues.push({ fileName: '', filePath: rootPath, reason: 'unsafe_path' })
    return { sources: [], issues, partitionDirectories: [] }
  }
}

/** Closes every directory descriptor retained by one discovery result. */
export function closeTeachingMemoryRecordFileDiscovery(discovery: TeachingMemoryRecordFileDiscovery): void {
  for (const directory of discovery.partitionDirectories) closeContainedDurableDirectory(directory)
  if (discovery.rootDirectory) closeContainedDurableDirectory(discovery.rootDirectory)
}

/** Opens a newly derived scoped output parent below an already-bound memory root. */
export function openTeachingMemoryScopedRecordDirectory(
  rootDir: string,
  rootDirectory: ContainedDurableDirectory,
  record: Pick<TeachingMemoryRecord, 'scope' | 'workspace' | 'project'>
): { directory: ContainedDurableDirectory; partition: string; directoryPath: string } {
  const partition = teachingMemoryScopeDirectory(record)
  return {
    directory: openContainedDirectoryChild(rootDirectory, partition, true),
    partition,
    directoryPath: join(resolve(rootDir), partition)
  }
}

/** Writes only through an already-bound no-follow source parent descriptor. */
export async function replaceTeachingMemoryRecordFileAtSource(
  source: Pick<TeachingMemoryRecordFileSource, 'directory' | 'entryName'>,
  record: unknown
): Promise<void> {
  await replaceDurablyInContainedDirectory({
    directory: source.directory,
    filename: source.entryName,
    content: `${JSON.stringify(record, null, 2)}\n`
  })
}

function discoverPartitionFiles(
  rootPath: string,
  partition: string,
  partitionDirectory: ContainedDurableDirectory,
  sources: TeachingMemoryRecordFileSource[],
  issues: TeachingMemoryRecordFileDiscoveryIssue[]
): void {
  let entries: readonly ContainedDirectoryEntry[]
  try {
    entries = listContainedDirectory(partitionDirectory)
  } catch {
    issues.push({ fileName: partition, filePath: join(rootPath, partition), reason: 'unsafe_path' })
    return
  }
  for (const entry of sortedEntries(entries)) {
    const filePath = join(rootPath, partition, entry.name)
    const fileName = join(partition, entry.name)
    if (entry.type === 'symlink') {
      issues.push({ fileName, filePath, reason: 'unsafe_path' })
      continue
    }
    if (entry.type === 'directory') {
      issues.push({ fileName, filePath, reason: 'deep_directory' })
      continue
    }
    if (entry.type !== 'file') continue
    if (!isCanonicalTeachingMemoryRecordFileName(entry.name)) {
      if (entry.name.endsWith(RECORD_FILE_SUFFIX)) issues.push({ fileName, filePath, reason: 'file_name_mismatch' })
      continue
    }
    sources.push(source(rootPath, fileName, 'scoped', partitionDirectory, partition, entry.name))
  }
}

function source(
  rootPath: string,
  fileName: string,
  layout: TeachingMemoryRecordLayout,
  directory: ContainedDurableDirectory,
  partition?: string,
  entryName = fileName
): TeachingMemoryRecordFileSource {
  return {
    fileName,
    filePath: join(rootPath, fileName),
    layout,
    ...(partition ? { partition } : {}),
    directory,
    entryName
  }
}

function sortedEntries(entries: readonly ContainedDirectoryEntry[]): ContainedDirectoryEntry[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name))
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
