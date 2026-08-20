/**
 * Main-process asset storage for v2 mind maps.
 *
 * Assets are copied into a caller-owned, dedicated root and are referenced by
 * stable id + filename.  The document stores metadata only; renderer code
 * never receives an absolute asset path.  This seam deliberately keeps the
 * filesystem policy local so future attachment IPC can reuse it without
 * opening a second, weaker path resolver.
 */
import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { MindMapAssetRef } from '../../shared/mindmap/domain/types'

export const DEFAULT_MIND_MAP_ASSET_MAX_BYTES = 16 * 1024 * 1024

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp'
}

export type MindMapAssetErrorCode =
  | 'invalid_asset_id'
  | 'invalid_file_name'
  | 'invalid_mime_type'
  | 'invalid_max_bytes'
  | 'asset_root_unsafe'
  | 'source_missing'
  | 'source_not_regular'
  | 'source_too_large'
  | 'embedded_asset_too_large'
  | 'asset_exists'
  | 'asset_missing'
  | 'asset_not_regular'
  | 'asset_too_large'
  | 'asset_integrity_mismatch'

export class MindMapAssetError extends Error {
  readonly code: MindMapAssetErrorCode

  constructor(code: MindMapAssetErrorCode, message: string) {
    super(message)
    this.name = 'MindMapAssetError'
    this.code = code
  }
}

export type MindMapAssetImport = {
  id: string
  fileName: string
  mimeType?: string
  sourcePath: string
  createdAt?: string
}

/** A bounded byte payload supplied by a trusted importer (for example StudiumX). */
export type MindMapAssetBytesImport = {
  id: string
  fileName: string
  mimeType?: string
  content: Uint8Array
  createdAt?: string
}

export type MindMapAssetStoreOptions = {
  /** Dedicated directory under a workspace; it is created when absent. */
  rootPath: string
  maxBytes?: number
  now?: () => string
}

/**
 * Store workspace-relative mind-map attachments without allowing path-bearing
 * values to escape the configured asset root.
 */
export class MindMapAssetStore {
  private readonly rootPath: string
  private readonly maxBytes: number
  private readonly now: () => string

  constructor(options: MindMapAssetStoreOptions) {
    const maxBytes = options.maxBytes ?? DEFAULT_MIND_MAP_ASSET_MAX_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new MindMapAssetError(
        'invalid_max_bytes',
        'Mind-map asset maxBytes must be a positive safe integer.'
      )
    }
    this.rootPath = resolve(options.rootPath)
    this.maxBytes = maxBytes
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /** Copy one user-selected regular file into the asset root. */
  async importFromFile(input: MindMapAssetImport): Promise<MindMapAssetRef> {
    const asset = normalizeAssetMetadata(input)
    const sourcePath = resolve(input.sourcePath)
    const sourceInfo = await lstat(sourcePath).catch((error: unknown) => {
      if (isErrno(error) && error.code === 'ENOENT') {
        throw new MindMapAssetError('source_missing', 'Mind-map asset source does not exist.')
      }
      throw error
    })
    if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
      throw new MindMapAssetError(
        'source_not_regular',
        'Mind-map asset source must be a regular file, not a directory or symlink.'
      )
    }
    if (sourceInfo.size > this.maxBytes) {
      throw new MindMapAssetError(
        'source_too_large',
        `Mind-map asset source exceeds the ${this.maxBytes} byte safety limit.`
      )
    }

    const content = await readBoundedRegularFile(sourcePath, this.maxBytes, 'source')
    return this.writeImportedContent(asset, content)
  }

  /** Copy one bounded embedded payload into the asset root. */
  async importFromBytes(input: MindMapAssetBytesImport): Promise<MindMapAssetRef> {
    const asset = normalizeAssetMetadata(input)
    if (!isUint8Array(input.content)) {
      throw new TypeError('Mind-map embedded asset content must be a Uint8Array.')
    }
    if (input.content.byteLength > this.maxBytes) {
      throw new MindMapAssetError(
        'embedded_asset_too_large',
        `Mind-map embedded asset exceeds the ${this.maxBytes} byte safety limit.`
      )
    }
    return this.writeImportedContent(asset, input.content)
  }

  /** Read an existing asset after proving it is a contained regular file. */
  async read(asset: MindMapAssetRef): Promise<Buffer> {
    const targetPath = await this.resolveAssetPath(asset)
    const content = await readBoundedRegularFile(targetPath, this.maxBytes, 'asset')
    if (asset.sizeBytes !== undefined && asset.sizeBytes !== content.byteLength) {
      throw new MindMapAssetError(
        'asset_integrity_mismatch',
        'Mind-map asset metadata does not match the stored file.'
      )
    }
    if (asset.sha256 !== undefined) {
      const sha256 = createHash('sha256').update(content).digest('hex')
      if (sha256 !== asset.sha256) {
        throw new MindMapAssetError(
          'asset_integrity_mismatch',
          'Mind-map asset metadata does not match the stored file.'
        )
      }
    }
    return content
  }

  /** Remove one asset. Missing assets are treated as an idempotent delete. */
  async remove(asset: MindMapAssetRef): Promise<void> {
    let targetPath: string
    try {
      targetPath = await this.resolveAssetPath(asset)
    } catch (error) {
      if (error instanceof MindMapAssetError && error.code === 'asset_missing') return
      throw error
    }
    const info = await lstat(targetPath).catch((error: unknown) => {
      if (isErrno(error) && error.code === 'ENOENT') return null
      throw error
    })
    if (!info) return
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new MindMapAssetError(
        'asset_not_regular',
        'Mind-map asset target must be a regular file, not a directory or symlink.'
      )
    }
    await rm(targetPath, { force: false })
    await rmdir(resolve(targetPath, '..')).catch((error: unknown) => {
      if (!isErrno(error) || (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY')) throw error
    })
  }

  /**
   * Remove orphaned asset directories from this dedicated root.
   *
   * Only directories named by the same safe id grammar are considered.  A
   * symlink or non-directory entry is left untouched rather than followed or
   * deleted, keeping cleanup fail-closed for a compromised workspace.
   */
  async cleanupOrphans(retainedAssetIds: readonly string[]): Promise<string[]> {
    const rootPath = await this.ensureRoot()
    const retained = new Set(retainedAssetIds.map((id) => validateAssetId(id)))
    const entries = await readdir(rootPath, { withFileTypes: true })
    const removed: string[] = []
    for (const entry of entries) {
      if (!isSafeAssetId(entry.name) || retained.has(entry.name)) continue
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      await rm(join(rootPath, entry.name), { recursive: true, force: false })
      removed.push(entry.name)
    }
    return removed
  }

  private async resolveAssetPath(asset: MindMapAssetRef): Promise<string> {
    const normalized = normalizeAssetMetadata(asset)
    const rootPath = await this.ensureRoot()
    const directory = resolve(rootPath, normalized.id)
    assertContained(rootPath, directory)
    const directoryInfo = await lstat(directory).catch((error: unknown) => {
      if (isErrno(error) && error.code === 'ENOENT') return null
      throw error
    })
    if (!directoryInfo || directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throw new MindMapAssetError(
        'asset_missing',
        `Mind-map asset directory is missing: ${normalized.id}`
      )
    }
    const targetPath = resolve(directory, normalized.fileName)
    assertContained(rootPath, targetPath)
    return targetPath
  }

  private async ensureRoot(): Promise<string> {
    await mkdir(this.rootPath, { recursive: true })
    const info = await lstat(this.rootPath)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new MindMapAssetError(
        'asset_root_unsafe',
        'Mind-map asset root must be a real directory.'
      )
    }
    return resolve(this.rootPath)
  }

  private async writeImportedContent(
    asset: MindMapAssetRef,
    content: Uint8Array
  ): Promise<MindMapAssetRef> {
    const rootPath = await this.ensureRoot()
    const assetDirectory = await ensureDirectory(rootPath, asset.id, 'asset_root_unsafe')
    const targetPath = resolve(assetDirectory, asset.fileName)
    assertContained(rootPath, targetPath)

    // O_EXCL prevents a pre-existing target (including a symlink) from being
    // replaced. Callers should remove an old ref explicitly before importing
    // a new version of the same asset id + filename.
    try {
      await writeFile(targetPath, content, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (isErrno(error) && error.code === 'EEXIST') {
        throw new MindMapAssetError(
          'asset_exists',
          `Mind-map asset already exists: ${asset.id}/${asset.fileName}`
        )
      }
      throw error
    }

    return {
      ...asset,
      sizeBytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
      createdAt: asset.createdAt ?? this.now()
    }
  }
}

function normalizeAssetMetadata(
  input: Pick<MindMapAssetRef, 'id' | 'fileName' | 'mimeType' | 'createdAt'>
): MindMapAssetRef {
  const id = validateAssetId(input.id)
  const fileName = validateFileName(input.fileName)
  const mimeType = normalizeMimeType(fileName, input.mimeType)
  return {
    id,
    fileName,
    ...(mimeType ? { mimeType } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {})
  }
}

function validateAssetId(id: string): string {
  if (!isSafeAssetId(id)) {
    throw new MindMapAssetError(
      'invalid_asset_id',
      'Mind-map asset id must be 1–128 ASCII letters, numbers, dot, dash, or underscore.'
    )
  }
  return id
}

function isSafeAssetId(id: string): boolean {
  return typeof id === 'string' && /^(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)
}

function validateFileName(fileName: string): string {
  if (
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('\0') ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes(':') ||
    [...fileName].some((character) => character < ' ')
  ) {
    throw new MindMapAssetError(
      'invalid_file_name',
      'Mind-map asset fileName must be one non-empty path segment.'
    )
  }
  return fileName
}

function normalizeMimeType(fileName: string, mimeType: string | undefined): string | undefined {
  const inferred = MIME_BY_EXTENSION[extname(fileName).toLowerCase()]
  if (mimeType === undefined || mimeType.trim() === '') return inferred
  const normalized = mimeType.split(';', 1)[0]!.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
    throw new MindMapAssetError('invalid_mime_type', 'Mind-map asset mimeType is invalid.')
  }
  if (inferred && normalized !== inferred) {
    throw new MindMapAssetError(
      'invalid_mime_type',
      `Mind-map asset mimeType ${normalized} does not match ${extname(fileName)}.`
    )
  }
  return normalized
}

async function ensureDirectory(rootPath: string, id: string, code: 'asset_root_unsafe'): Promise<string> {
  const directory = resolve(rootPath, id)
  assertContained(rootPath, directory)
  await mkdir(directory, { recursive: true })
  const info = await lstat(directory)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new MindMapAssetError(code, 'Mind-map asset directory must be a real directory.')
  }
  return directory
}

function assertContained(rootPath: string, targetPath: string): void {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new MindMapAssetError(
      'asset_root_unsafe',
      'Mind-map asset path escapes the configured asset root.'
    )
  }
}

async function readBoundedRegularFile(
  targetPath: string,
  maxBytes: number,
  kind: 'source' | 'asset'
): Promise<Buffer> {
  const info = await lstat(targetPath).catch((error: unknown) => {
    if (isErrno(error) && error.code === 'ENOENT') {
      throw new MindMapAssetError(
        kind === 'source' ? 'source_missing' : 'asset_missing',
        `Mind-map ${kind} file does not exist.`
      )
    }
    throw error
  })
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new MindMapAssetError(
      kind === 'source' ? 'source_not_regular' : 'asset_not_regular',
      `Mind-map ${kind} file must be a regular file.`
    )
  }
  if (info.size > maxBytes) {
    throw new MindMapAssetError(
      kind === 'source' ? 'source_too_large' : 'asset_too_large',
      `Mind-map ${kind} file exceeds the ${maxBytes} byte safety limit.`
    )
  }

  const handle = await open(targetPath, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > maxBytes) {
      throw new MindMapAssetError(
        kind === 'source' ? 'source_too_large' : 'asset_too_large',
        `Mind-map ${kind} file exceeds the ${maxBytes} byte safety limit.`
      )
    }
    const content = await handle.readFile()
    if (content.byteLength > maxBytes) {
      throw new MindMapAssetError(
        kind === 'source' ? 'source_too_large' : 'asset_too_large',
        `Mind-map ${kind} file exceeds the ${maxBytes} byte safety limit.`
      )
    }
    return content
  } finally {
    await handle.close()
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

/**
 * Buffers and Uint8Arrays can cross Electron/Vitest realms. `instanceof` is
 * realm-local, so use the typed-array internal-slot predicate plus the actual
 * Uint8Array tag instead of rejecting otherwise valid embedded media.
 */
function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
}
