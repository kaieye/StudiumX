/**
 * Windows direct-path Teaching-memory catalog I/O (ADR-0126 Phase 2).
 *
 * Honesty contract (frozen names):
 * - Profile id: `windows_direct_path_non_cas`
 * - Root-constrained pathname list/read/write under the configured memory root
 * - NOT descriptor/CAS/openat-equivalent; never market as strict
 *
 * Containment mirrors P8 workspace direct-path checks (no-follow lstat + realpath
 * inside root) via shared path helpers — not a weaker ad-hoc resolve.
 */
import { lstat, mkdir, open, readdir, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { isPathInsideRoot } from '../path-access'
import {
  isCanonicalTeachingMemoryRecordFileName,
  isRecognizedTeachingMemoryScopeDirectory,
  teachingMemoryRecordFileName,
  teachingMemoryScopeDirectory,
  type TeachingMemoryRecordFileDiscovery,
  type TeachingMemoryRecordFileDiscoveryIssue,
  type TeachingMemoryRecordFileDiscoveryOptions,
  type TeachingMemoryRecordFileSource,
  type TeachingMemoryRecordLayout
} from './record-file'
import type { TeachingMemoryRecord } from '../../shared/teaching-types'

const RECORD_FILE_SUFFIX = '.json'

/** Safe internal boundary; messages never include local path or OS detail. */
export class WindowsDirectPathMemoryCatalogError extends Error {
  readonly kind:
    | 'root_unavailable'
    | 'path_rejected'
    | 'target_exists'
    | 'target_missing'
    | 'target_not_restricted_regular'
    | 'prepublication_failure'
    | 'possibly_published'
    | 'write_unavailable'

  constructor(kind: WindowsDirectPathMemoryCatalogError['kind'], cause?: unknown) {
    super(messageFor(kind), cause === undefined ? undefined : { cause })
    this.name = 'WindowsDirectPathMemoryCatalogError'
    this.kind = kind
  }
}

export function isWindowsDirectPathMemoryCatalogError(
  error: unknown
): error is WindowsDirectPathMemoryCatalogError {
  return error instanceof WindowsDirectPathMemoryCatalogError
}

/**
 * Discovers only root-flat JSON files plus canonical files one level below a
 * recognized partition. Symlinks and deep trees become recovery issues.
 */
export async function discoverWindowsDirectPathMemoryRecordFiles(
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
      return emptyDiscovery()
    }
    if (isWindowsDirectPathMemoryCatalogError(error) && error.kind === 'root_unavailable' && !createRoot) {
      return emptyDiscovery()
    }
    issues.push({ fileName: '', filePath: rootPath, reason: 'unsafe_path' })
    return { sources: [], issues, partitionDirectories: [] }
  }

  let rootEntries: string[]
  try {
    rootEntries = await readdir(rootPath)
  } catch {
    issues.push({ fileName: '', filePath: rootPath, reason: 'unsafe_path' })
    return { sources: [], issues, partitionDirectories: [] }
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
        sources.push(directSource(rootPath, name, 'flat', rootPath, name))
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

  return {
    sources,
    issues,
    // Direct-path profile does not retain native descriptors; catalog uses
    // rootAbsolutePath from sources / open helpers instead.
    rootDirectory: undefined,
    partitionDirectories: [],
    windowsDirectPathRoot: rootPath
  }
}

export async function readWindowsDirectPathMemoryRecordFile(
  source: Pick<TeachingMemoryRecordFileSource, 'backend' | 'entryName'>
): Promise<Buffer> {
  const backend = requireWindowsDirectPathBackend(source)
  const absolute = absoluteEntryPath(source)
  try {
    const info = await lstat(absolute)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new WindowsDirectPathMemoryCatalogError('target_not_restricted_regular')
    }
    await assertRealPathInsideRoot(backend.rootAbsolutePath, absolute)
    return await readFile(absolute)
  } catch (error) {
    if (isWindowsDirectPathMemoryCatalogError(error)) throw error
    throw new WindowsDirectPathMemoryCatalogError('path_rejected', error)
  }
}

/**
 * Creates or overwrites a memory record under an already-resolved parent.
 * Uses wx for create and r+/truncate for overwrite — same non-CAS contract as
 * P8 Windows workspace write. Failures after first mutation surface as
 * possibly_published (no automatic retry/delete).
 */
export async function replaceWindowsDirectPathMemoryRecordFile(
  source: Pick<TeachingMemoryRecordFileSource, 'backend' | 'entryName'>,
  record: unknown
): Promise<void> {
  const content = `${JSON.stringify(record, null, 2)}\n`
  const backend = requireWindowsDirectPathBackend(source)
  const absolute = absoluteEntryPath(source)
  const parent = backend.parentAbsolutePath
  const root = backend.rootAbsolutePath

  try {
    await assertRealPathInsideRoot(root, parent)
    await mkdir(parent, { recursive: true })
    await assertRealPathInsideRoot(root, parent)
  } catch (error) {
    if (isWindowsDirectPathMemoryCatalogError(error)) throw error
    throw new WindowsDirectPathMemoryCatalogError('prepublication_failure', error)
  }

  let existing: Awaited<ReturnType<typeof lstat>> | null = null
  try {
    existing = await lstat(absolute)
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw new WindowsDirectPathMemoryCatalogError('prepublication_failure', error)
    }
  }

  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1) {
      throw new WindowsDirectPathMemoryCatalogError('target_not_restricted_regular')
    }
    await overwriteExisting(absolute, content, root)
    return
  }

  await createNoOverwrite(absolute, content, root)
}

/** Opens (creates) a scoped partition directory under the memory root. */
export async function openWindowsDirectPathMemoryScopedPartition(
  rootDir: string,
  record: Pick<TeachingMemoryRecord, 'id' | 'scope' | 'workspace' | 'project'>
): Promise<{ parentAbsolutePath: string; partition: string; entryName: string; rootAbsolutePath: string }> {
  const rootAbsolutePath = resolve(rootDir)
  const partition = teachingMemoryScopeDirectory(record)
  const parentAbsolutePath = join(rootAbsolutePath, partition)
  try {
    await ensureMemoryRoot(rootAbsolutePath, true)
    await mkdir(parentAbsolutePath, { recursive: true })
    const info = await lstat(parentAbsolutePath)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new WindowsDirectPathMemoryCatalogError('path_rejected')
    }
    await assertRealPathInsideRoot(rootAbsolutePath, parentAbsolutePath)
  } catch (error) {
    if (isWindowsDirectPathMemoryCatalogError(error)) throw error
    throw new WindowsDirectPathMemoryCatalogError('prepublication_failure', error)
  }
  return {
    parentAbsolutePath,
    partition,
    entryName: teachingMemoryRecordFileName(record.id),
    rootAbsolutePath
  }
}

export function windowsDirectPathSourceForNewRecord(
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
    backend: {
      kind: 'windows_direct_path',
      parentAbsolutePath: opened.parentAbsolutePath,
      rootAbsolutePath: opened.rootAbsolutePath
    }
  }
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
    sources.push(directSource(rootPath, fileName, 'scoped', partitionPath, name, partition))
  }
}

function directSource(
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
    backend: {
      kind: 'windows_direct_path',
      parentAbsolutePath,
      rootAbsolutePath: rootPath
    }
  }
}

function requireWindowsDirectPathBackend(
  source: Pick<TeachingMemoryRecordFileSource, 'backend'>
): Extract<TeachingMemoryRecordFileSource['backend'], { kind: 'windows_direct_path' }> {
  if (source.backend.kind !== 'windows_direct_path') {
    throw new WindowsDirectPathMemoryCatalogError('write_unavailable')
  }
  return source.backend
}

function absoluteEntryPath(
  source: Pick<TeachingMemoryRecordFileSource, 'backend' | 'entryName'>
): string {
  const backend = requireWindowsDirectPathBackend(source)
  // entryName is a single basename (no separators) by catalog convention.
  if (source.entryName.includes('/') || source.entryName.includes('\\') || source.entryName.includes('..')) {
    throw new WindowsDirectPathMemoryCatalogError('path_rejected')
  }
  return join(backend.parentAbsolutePath, source.entryName)
}

async function createNoOverwrite(absolute: string, content: string, root: string): Promise<void> {
  let file: Awaited<ReturnType<typeof open>> | undefined
  let mayBePublished = false
  try {
    try {
      file = await open(absolute, 'wx', 0o600)
    } catch (cause) {
      if (errorCode(cause) === 'EEXIST') throw new WindowsDirectPathMemoryCatalogError('target_exists', cause)
      throw new WindowsDirectPathMemoryCatalogError('prepublication_failure', cause)
    }
    mayBePublished = true
    await file.writeFile(content, 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await assertRealPathInsideRoot(root, absolute)
  } catch (cause) {
    if (isWindowsDirectPathMemoryCatalogError(cause)) throw cause
    throw new WindowsDirectPathMemoryCatalogError(
      mayBePublished ? 'possibly_published' : 'prepublication_failure',
      cause
    )
  } finally {
    if (file) {
      try {
        await file.close()
      } catch (cause) {
        if (!mayBePublished) throw new WindowsDirectPathMemoryCatalogError('prepublication_failure', cause)
      }
    }
  }
}

async function overwriteExisting(absolute: string, content: string, root: string): Promise<void> {
  let file: Awaited<ReturnType<typeof open>> | undefined
  let mayBePublished = false
  try {
    try {
      file = await open(absolute, 'r+')
    } catch (cause) {
      if (errorCode(cause) === 'ENOENT') throw new WindowsDirectPathMemoryCatalogError('target_missing', cause)
      throw new WindowsDirectPathMemoryCatalogError('prepublication_failure', cause)
    }
    const openedInfo = await file.stat()
    if (!openedInfo.isFile() || openedInfo.nlink !== 1) {
      throw new WindowsDirectPathMemoryCatalogError('target_not_restricted_regular')
    }
    mayBePublished = true
    await file.truncate(0)
    await file.writeFile(content, 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await assertRealPathInsideRoot(root, absolute)
  } catch (cause) {
    if (isWindowsDirectPathMemoryCatalogError(cause)) throw cause
    throw new WindowsDirectPathMemoryCatalogError(
      mayBePublished ? 'possibly_published' : 'prepublication_failure',
      cause
    )
  } finally {
    if (file) {
      try {
        await file.close()
      } catch (cause) {
        if (!mayBePublished) throw new WindowsDirectPathMemoryCatalogError('prepublication_failure', cause)
      }
    }
  }
}

async function ensureMemoryRoot(rootPath: string, createIfMissing: boolean): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>> | null = null
  try {
    info = await lstat(rootPath)
  } catch (error) {
    if (!isNotFoundError(error)) throw new WindowsDirectPathMemoryCatalogError('root_unavailable', error)
    if (!createIfMissing) throw new WindowsDirectPathMemoryCatalogError('root_unavailable', error)
    await mkdir(rootPath, { recursive: true })
    info = await lstat(rootPath)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new WindowsDirectPathMemoryCatalogError('root_unavailable')
  }
}

async function assertRealPathInsideRoot(rootPath: string, targetPath: string): Promise<void> {
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
    if (!isPathInsideRoot(realRoot, realTarget)) {
      throw new WindowsDirectPathMemoryCatalogError('path_rejected')
    }
  } catch (error) {
    if (isWindowsDirectPathMemoryCatalogError(error)) throw error
    // Parent may not exist yet during create; lexical check is the fallback.
    if (!isPathInsideRoot(resolve(rootPath), resolve(targetPath))) {
      throw new WindowsDirectPathMemoryCatalogError('path_rejected', error)
    }
  }
}

function emptyDiscovery(): TeachingMemoryRecordFileDiscovery {
  return { sources: [], issues: [], partitionDirectories: [] }
}

function isNotFoundError(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

function messageFor(kind: WindowsDirectPathMemoryCatalogError['kind']): string {
  switch (kind) {
    case 'root_unavailable':
      return 'Teaching-memory catalog root is unavailable for direct-path access.'
    case 'path_rejected':
      return 'Teaching-memory path is outside the configured root or unsafe.'
    case 'target_exists':
      return 'The memory target already exists.'
    case 'target_missing':
      return 'The memory target is absent.'
    case 'target_not_restricted_regular':
      return 'The memory target is not an eligible regular file.'
    case 'possibly_published':
      return 'The direct-path memory write may already have changed the target.'
    case 'prepublication_failure':
      return 'The direct-path memory write failed before publication was confirmed.'
    case 'write_unavailable':
      return 'Teaching-memory direct-path write is unavailable for this source.'
  }
}

