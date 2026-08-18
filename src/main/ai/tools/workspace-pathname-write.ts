/**
 * Pathname-default workspace write publishers (ADR-0012).
 *
 * Single I/O path for create and overwrite: trusted-root path containment via
 * `workspace-path-target`, then `replaceDurably` (temp → write → optional fsync →
 * rename). No descriptor-bound native stack, no Windows/POSIX dual protocol,
 * and no CAS claims.
 */
import { lstat, rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'

import { replaceDurably } from '../../persistence/durable-file'
import {
  prepareWorkspaceWriteTarget,
  resolveWorkspacePathTarget,
  verifyExistingWorkspaceTarget,
  verifyWrittenWorkspaceTarget,
  type WorkspacePathTarget
} from './workspace-path-target'

export type PathnameWorkspaceWriteInput = {
  /** Main-process-trusted workspace root. */
  workspaceRootPath: string
  /** Relative target (validated by resolveWorkspacePathTarget). */
  relativePath: string
  /** Exact UTF-8 text payload. */
  content: string
}

export type PathnameWorkspaceWriteErrorKind =
  | 'target_exists'
  | 'target_missing'
  | 'target_not_restricted_regular'
  | 'prepublication_failure'
  | 'possibly_published'

export type PathnameWorkspaceWriteErrorPhase =
  | 'bind'
  | 'inspect'
  | 'write'
  | 'verify'

/**
 * Safe internal boundary. Message never contains a path, temporary name, or
 * raw host I/O detail. `cause` remains for diagnostics and tests only.
 */
export class PathnameWorkspaceWriteError extends Error {
  readonly kind: PathnameWorkspaceWriteErrorKind
  readonly phase: PathnameWorkspaceWriteErrorPhase
  override readonly cause: unknown

  constructor(input: {
    kind: PathnameWorkspaceWriteErrorKind
    phase: PathnameWorkspaceWriteErrorPhase
    cause: unknown
  }) {
    super(messageFor(input.kind), { cause: input.cause })
    this.name = 'PathnameWorkspaceWriteError'
    this.kind = input.kind
    this.phase = input.phase
    this.cause = input.cause
  }
}

/**
 * Create a new workspace file with no-overwrite intent. Publication uses
 * pathname temp+rename via `replaceDurably`. Pre-existence is rejected; races
 * are not CAS and may surface as target_exists / possibly_published.
 */
export async function createNoOverwriteAtWorkspacePath(
  input: PathnameWorkspaceWriteInput
): Promise<void> {
  const target = resolveTarget(input)
  try {
    await prepareWorkspaceWriteTarget(target)
  } catch (cause) {
    throw writeError('prepublication_failure', 'bind', cause)
  }

  try {
    const existing = await lstatIfExists(target.absolutePath)
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw writeError(
          'target_not_restricted_regular',
          'inspect',
          new Error('Target leaf is not an eligible regular file for create.')
        )
      }
      throw writeError('target_exists', 'inspect', new Error('Target already exists.'))
    }
  } catch (cause) {
    if (cause instanceof PathnameWorkspaceWriteError) throw cause
    throw writeError('prepublication_failure', 'inspect', cause)
  }

  await publishWithRecovery(target, input.content, 'created')
}

/**
 * Overwrite an existing single-link regular file via pathname temp+rename.
 * Deliberately non-CAS: external replacement races are outside this contract.
 */
export async function overwriteExistingRestrictedAtWorkspacePath(
  input: PathnameWorkspaceWriteInput
): Promise<void> {
  const target = resolveTarget(input)
  try {
    const prepared = await prepareWorkspaceWriteTarget(target)
    if (!prepared.exists) {
      throw writeError('target_missing', 'inspect', new Error('Target is absent.'))
    }
    if (prepared.kind !== 'file') {
      throw writeError(
        'target_not_restricted_regular',
        'inspect',
        new Error('Target is not a file.')
      )
    }

    const targetInfo = await lstat(target.absolutePath)
    if (targetInfo.isSymbolicLink() || !targetInfo.isFile() || targetInfo.nlink !== 1) {
      throw writeError(
        'target_not_restricted_regular',
        'inspect',
        new Error('Target is not a single-link regular file.')
      )
    }
  } catch (cause) {
    if (cause instanceof PathnameWorkspaceWriteError) throw cause
    if (errorCode(cause) === 'ENOENT') throw writeError('target_missing', 'inspect', cause)
    throw writeError('prepublication_failure', 'bind', cause)
  }

  await publishWithRecovery(target, input.content, 'overwritten')
}

/** Best-effort post-write confirmation for the pathname (non-CAS) profile. */
export async function pathnameWorkspaceReadIsExact(input: {
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

async function publishWithRecovery(
  target: WorkspacePathTarget,
  content: string,
  mode: 'created' | 'overwritten'
): Promise<void> {
  const expectedBytes = Buffer.from(content, 'utf8')
  try {
    await pathnameReplaceDurably(target.absolutePath, content, mode)
    await verifyWrittenWorkspaceTarget(target)
    if (!(await pathnameWorkspaceReadIsExact({
      workspaceRootPath: target.root,
      relativePath: target.relativePath,
      expectedBytes
    }))) {
      throw writeError(
        'possibly_published',
        'verify',
        new Error('Pathname workspace write could not be confirmed.')
      )
    }
  } catch (cause) {
    if (cause instanceof PathnameWorkspaceWriteError) throw cause

    if (await pathnameWorkspaceReadIsExact({
      workspaceRootPath: target.root,
      relativePath: target.relativePath,
      expectedBytes
    })) {
      // rename may have published before a later failure (e.g. dir sync).
      throw writeError('possibly_published', 'write', cause)
    }

    if (mode === 'created') {
      const after = await lstatIfExists(target.absolutePath)
      if (after?.isFile()) {
        throw writeError('target_exists', 'write', cause)
      }
    } else if (errorCode(cause) === 'ENOENT') {
      throw writeError('target_missing', 'write', cause)
    }

    throw writeError('prepublication_failure', 'write', cause)
  }
}

/**
 * Pathname temp+rename via durable-file. On Windows, rename cannot replace an
 * existing file, so the overwrite path removes the prior leaf then republishes.
 * This is intentionally non-CAS and must not be described as atomic exchange.
 */
async function pathnameReplaceDurably(
  absolutePath: string,
  content: string,
  mode: 'created' | 'overwritten'
): Promise<void> {
  try {
    await replaceDurably({
      path: absolutePath,
      content,
      mode: 0o600
    })
  } catch (cause) {
    if (mode !== 'overwritten' || process.platform !== 'win32') throw cause
    const code = errorCode(cause)
    // Node on Windows commonly surfaces EPERM (sometimes EEXIST) when rename
    // would clobber an existing path. Drop the prior leaf and retry once.
    if (code !== 'EPERM' && code !== 'EEXIST') throw cause
    await rm(absolutePath, { force: true })
    await replaceDurably({
      path: absolutePath,
      content,
      mode: 0o600
    })
  }
}

function resolveTarget(input: PathnameWorkspaceWriteInput): WorkspacePathTarget {
  try {
    return resolveWorkspacePathTarget(input.workspaceRootPath, input.relativePath)
  } catch (cause) {
    throw writeError('prepublication_failure', 'bind', cause)
  }
}

function writeError(
  kind: PathnameWorkspaceWriteErrorKind,
  phase: PathnameWorkspaceWriteErrorPhase,
  cause: unknown
): PathnameWorkspaceWriteError {
  return new PathnameWorkspaceWriteError({ kind, phase, cause })
}

async function lstatIfExists(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

function messageFor(kind: PathnameWorkspaceWriteErrorKind): string {
  switch (kind) {
    case 'target_exists':
      return 'The workspace target already exists.'
    case 'target_missing':
      return 'The workspace target is absent.'
    case 'target_not_restricted_regular':
      return 'The workspace target is not an eligible regular file.'
    case 'possibly_published':
      return 'The pathname workspace write may already have changed the target.'
    case 'prepublication_failure':
      return 'The pathname workspace write failed before publication was confirmed.'
  }
}
