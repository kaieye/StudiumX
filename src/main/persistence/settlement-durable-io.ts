/**
 * C-4P6 Phase 1 settlement I/O helpers.
 *
 * Shared, auditable containment + directory-sync policy for learning-outcome
 * durable settlement participants. This is not a cross-file transaction layer
 * and does not introduce pathname fallbacks after a failed capability check.
 *
 * Profile: see ADR-0019 (P6-macOS-local-APFS-strict-candidate first).
 * Windows production directory fsync remains an explicit non-strict skip.
 */
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { isPathInsideRoot } from '../path-access'
import { replaceDurably, type DurableFileOperations } from './durable-file'
export {
  SETTLEMENT_DIRECTORY_FSYNC_UNSUPPORTED_CODES,
  isSettlementDirectoryFsyncUnsupported,
  syncSettlementDirectory,
  type SettlementDirectorySyncOptions,
  type SettlementDirectorySyncResult
} from './settlement-directory-sync'

/**
 * Validates a workspace-relative POSIX path and returns absolute + parent paths
 * only when the parent is a real directory contained in the resolved workspace root.
 * Symlink parents and `..` escape fail closed; no pathname fallback after failure.
 */
export async function resolveContainedWorkspaceFilePath(
  workspaceRoot: string,
  relativePath: string
): Promise<{ absolutePath: string; parentPath: string; realParentPath: string; basename: string }> {
  const components = splitSafeRelativeComponents(relativePath)
  if (components.length === 0) throw new SettlementPathError('empty_relative_path')

  const leaf = components[components.length - 1]!
  const parentComponents = components.slice(0, -1)
  const absolutePath = join(workspaceRoot, ...components)
  const parentPath = parentComponents.length === 0 ? workspaceRoot : join(workspaceRoot, ...parentComponents)

  const realRoot = await realpath(workspaceRoot)
  const realParentPath = await assertContainedRealDirectory(realRoot, parentPath)
  const parentInfo = await lstat(parentPath)
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) {
    throw new SettlementPathError('parent_not_real_directory')
  }
  return { absolutePath, parentPath, realParentPath, basename: leaf }
}

/**
 * Publishes one settlement participant (outcome.json / outcome-settlement.json)
 * only after the parent Session directory has been proven contained.
 */
export async function replaceContainedSettlementFile(options: {
  workspaceRoot: string
  relativePath: string
  content: string | Uint8Array
  operations?: DurableFileOperations
  warn?: (message: string) => void
}): Promise<void> {
  const resolved = await resolveContainedWorkspaceFilePath(options.workspaceRoot, options.relativePath)
  await replaceDurably({
    path: resolved.absolutePath,
    content: options.content,
    operations: options.operations,
    warn: options.warn
  })
}

export class SettlementPathError extends Error {
  readonly code:
    | 'empty_relative_path'
    | 'invalid_relative_path'
    | 'parent_missing'
    | 'parent_not_real_directory'
    | 'path_escapes_workspace'

  constructor(code: SettlementPathError['code'], message?: string) {
    super(message ?? code)
    this.name = 'SettlementPathError'
    this.code = code
  }
}

function splitSafeRelativeComponents(relativePath: string): string[] {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) throw new SettlementPathError('invalid_relative_path')
  const parts = normalized.split('/').filter((part) => part.length > 0)
  if (parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) {
    throw new SettlementPathError('invalid_relative_path')
  }
  if (parts.some((part) => part.includes(':') || isAbsolute(part))) {
    throw new SettlementPathError('invalid_relative_path')
  }
  return parts
}

async function assertContainedRealDirectory(realRoot: string, directoryPath: string): Promise<string> {
  let info
  try {
    info = await lstat(directoryPath)
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') throw new SettlementPathError('parent_missing')
    throw error
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new SettlementPathError('parent_not_real_directory')
  }
  let realDirectory: string
  try {
    realDirectory = await realpath(directoryPath)
  } catch {
    throw new SettlementPathError('parent_not_real_directory')
  }
  if (resolve(realRoot) !== resolve(realDirectory) && !isPathInsideRoot(realRoot, realDirectory)) {
    throw new SettlementPathError('path_escapes_workspace')
  }
  const relation = relative(realRoot, realDirectory)
  if ((relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) && resolve(realRoot) !== resolve(realDirectory)) {
    throw new SettlementPathError('path_escapes_workspace')
  }
  return realDirectory
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
