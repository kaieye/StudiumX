import { lstat, open, readFile } from 'node:fs/promises'

import type { CreateWorkspaceContainedNoOverwriteInput } from '../../persistence/workspace-contained-create-no-overwrite'
import type { RestrictedOverwriteWorkspaceContainedPathInput } from '../../persistence/workspace-contained-restricted-overwrite'
import {
  prepareWorkspaceWriteTarget,
  resolveWorkspacePathTarget,
  verifyExistingWorkspaceTarget,
  verifyWrittenWorkspaceTarget
} from './workspace-path-target'

/**
 * Windows has no shipped HANDLE-relative equivalent of the POSIX descriptor
 * publisher. This profile deliberately follows Codex Rust's layered model:
 * the caller first limits a relative path to a trusted workspace root, then
 * this module performs a normal direct-path write. It is not a replacement for
 * the descriptor-bound POSIX protocol and must never be described as CAS.
 */
export type WindowsDirectPathWorkspaceWriteCapability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: 'unsupported_platform' }

export function getWindowsDirectPathWorkspaceWriteCapability(input: {
  platform?: NodeJS.Platform
} = {}): WindowsDirectPathWorkspaceWriteCapability {
  return (input.platform ?? process.platform) === 'win32'
    ? { available: true }
    : { available: false, reason: 'unsupported_platform' }
}

type DirectPathWriteErrorKind =
  | 'target_exists'
  | 'target_missing'
  | 'target_not_restricted_regular'
  | 'prepublication_failure'
  | 'possibly_published'

type DirectPathWriteErrorPhase = 'bind' | 'inspect' | 'open' | 'write' | 'file_sync' | 'file_close' | 'verify'

/** Safe internal boundary; its message intentionally contains no local path or I/O detail. */
export class WindowsDirectPathWorkspaceWriteError extends Error {
  readonly kind: DirectPathWriteErrorKind
  readonly phase: DirectPathWriteErrorPhase
  override readonly cause: unknown

  constructor(input: { kind: DirectPathWriteErrorKind; phase: DirectPathWriteErrorPhase; cause: unknown }) {
    super(messageFor(input.kind), { cause: input.cause })
    this.name = 'WindowsDirectPathWorkspaceWriteError'
    this.kind = input.kind
    this.phase = input.phase
    this.cause = input.cause
  }
}

/**
 * S2 for the Windows direct-path profile. `wx` provides the required no-clobber
 * leaf creation, but this is intentionally not the POSIX temp+directory-fsync
 * durable-publication protocol.
 */
export async function createNoOverwriteAtWindowsDirectWorkspacePath(
  input: CreateWorkspaceContainedNoOverwriteInput
): Promise<void> {
  const target = resolveWorkspacePathTarget(input.workspaceRootPath, input.relativePath)
  try {
    await prepareWorkspaceWriteTarget(target)
  } catch (cause) {
    throw directError('prepublication_failure', 'bind', cause)
  }

  let file: Awaited<ReturnType<typeof open>> | undefined
  let mayBePublished = false
  try {
    try {
      file = await open(target.absolutePath, 'wx', 0o600)
    } catch (cause) {
      if (errorCode(cause) === 'EEXIST') throw directError('target_exists', 'open', cause)
      throw directError('prepublication_failure', 'open', cause)
    }

    // CREATE_NEW has made the leaf visible. From this point any failure may
    // have left the requested bytes (or a prefix) in the workspace.
    mayBePublished = true
    await file.writeFile(input.content, 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await verifyWrittenWorkspaceTarget(target)
    if (!(await directPathWorkspaceReadIsExact({
      workspaceRootPath: input.workspaceRootPath,
      relativePath: input.relativePath,
      expectedBytes: Buffer.from(input.content, 'utf8')
    }))) {
      throw new Error('Windows direct-path create could not be confirmed.')
    }
  } catch (cause) {
    if (cause instanceof WindowsDirectPathWorkspaceWriteError) throw cause
    throw directError(mayBePublished ? 'possibly_published' : 'prepublication_failure', phaseFor(cause), cause)
  } finally {
    if (file) {
      try {
        await file.close()
      } catch (cause) {
        if (!mayBePublished) throw directError('prepublication_failure', 'file_close', cause)
      }
    }
  }
}

/**
 * S3 for the Windows direct-path profile. It validates an existing regular,
 * single-link target, then opens that pathname and writes through the returned
 * file handle. There is intentionally no expected-target-ID CAS: an external
 * replacement race is outside this profile's direct-path contract.
 */
export async function overwriteExistingRestrictedAtWindowsDirectWorkspacePath(
  input: RestrictedOverwriteWorkspaceContainedPathInput
): Promise<void> {
  const target = resolveWorkspacePathTarget(input.workspaceRootPath, input.relativePath)
  try {
    const prepared = await prepareWorkspaceWriteTarget(target)
    if (!prepared.exists) throw directError('target_missing', 'inspect', new Error('Target is absent.'))
    if (prepared.kind !== 'file') throw directError('target_not_restricted_regular', 'inspect', new Error('Target is not a file.'))

    const targetInfo = await lstat(target.absolutePath)
    if (targetInfo.isSymbolicLink() || !targetInfo.isFile() || targetInfo.nlink !== 1) {
      throw directError('target_not_restricted_regular', 'inspect', new Error('Target is not a single-link regular file.'))
    }
  } catch (cause) {
    if (cause instanceof WindowsDirectPathWorkspaceWriteError) throw cause
    if (errorCode(cause) === 'ENOENT') throw directError('target_missing', 'inspect', cause)
    throw directError('prepublication_failure', 'bind', cause)
  }

  let file: Awaited<ReturnType<typeof open>> | undefined
  let mayBePublished = false
  try {
    try {
      // r+ is deliberately non-creating: if the target disappears after the
      // S3 check, this operation cannot turn into a create.
      file = await open(target.absolutePath, 'r+')
    } catch (cause) {
      if (errorCode(cause) === 'ENOENT') throw directError('target_missing', 'open', cause)
      throw directError('prepublication_failure', 'open', cause)
    }

    const openedInfo = await file.stat()
    if (!openedInfo.isFile() || openedInfo.nlink !== 1) {
      throw directError('target_not_restricted_regular', 'inspect', new Error('Opened target is not a single-link regular file.'))
    }

    // truncate is the first externally visible S3 mutation. Do not retry or
    // roll back after this point; the caller performs one exact recovery read.
    mayBePublished = true
    await file.truncate(0)
    await file.writeFile(input.content, 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await verifyWrittenWorkspaceTarget(target)
    if (!(await directPathWorkspaceReadIsExact({
      workspaceRootPath: input.workspaceRootPath,
      relativePath: input.relativePath,
      expectedBytes: Buffer.from(input.content, 'utf8')
    }))) {
      throw new Error('Windows direct-path overwrite could not be confirmed.')
    }
  } catch (cause) {
    if (cause instanceof WindowsDirectPathWorkspaceWriteError) throw cause
    throw directError(mayBePublished ? 'possibly_published' : 'prepublication_failure', phaseFor(cause), cause)
  } finally {
    if (file) {
      try {
        await file.close()
      } catch (cause) {
        if (!mayBePublished) throw directError('prepublication_failure', 'file_close', cause)
      }
    }
  }
}

/** Best-effort post-write confirmation for the deliberately non-CAS profile. */
export async function directPathWorkspaceReadIsExact(input: {
  workspaceRootPath: string
  relativePath: string
  expectedBytes: Buffer
}): Promise<boolean> {
  try {
    const target = resolveWorkspacePathTarget(input.workspaceRootPath, input.relativePath)
    const info = await lstat(target.absolutePath)
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) return false
    await verifyExistingWorkspaceTarget(target)
    return (await readFile(target.absolutePath)).equals(input.expectedBytes)
  } catch {
    return false
  }
}

function directError(kind: DirectPathWriteErrorKind, phase: DirectPathWriteErrorPhase, cause: unknown): WindowsDirectPathWorkspaceWriteError {
  return new WindowsDirectPathWorkspaceWriteError({ kind, phase, cause })
}

function phaseFor(_cause: unknown): DirectPathWriteErrorPhase {
  // Callers set more precise phases around open; the remaining fs operations
  // are intentionally collapsed to avoid exposing host I/O specifics.
  return 'write'
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

function messageFor(kind: DirectPathWriteErrorKind): string {
  switch (kind) {
    case 'target_exists':
      return 'The workspace target already exists.'
    case 'target_missing':
      return 'The workspace target is absent.'
    case 'target_not_restricted_regular':
      return 'The workspace target is not an eligible regular file.'
    case 'possibly_published':
      return 'The direct-path workspace write may already have changed the target.'
    case 'prepublication_failure':
      return 'The direct-path workspace write failed before publication was confirmed.'
  }
}
