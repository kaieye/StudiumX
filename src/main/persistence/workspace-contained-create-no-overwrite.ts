import { randomUUID } from 'node:crypto'

import {
  bindWorkspaceContainedPath,
  closeContainedTemporaryFileChecked,
  createContainedTemporaryFile,
  publishNoOverwriteAtContainedDirectory,
  removeContainedDirectoryEntry,
  syncContainedDirectoryForPublication,
  syncContainedTemporaryFile,
  writeContainedTemporaryFile,
  type ContainedDurableDirectory,
  type ContainedTemporaryFile,
  type WorkspaceContainedLeaf,
  type WorkspaceContainedPathBinding
} from './contained-durable-directory'

/** Internal-only result classification for P8-S2; not a tool/API contract. */
export type WorkspaceContainedCreateNoOverwriteErrorKind =
  | 'target_exists'
  | 'atomic_no_clobber_unavailable'
  | 'prepublication_failure'
  | 'possibly_published'

export type WorkspaceContainedCreateNoOverwritePhase =
  | 'bind'
  | 'inspect'
  | 'temporary_create'
  | 'temporary_write'
  | 'temporary_file_sync'
  | 'temporary_file_close'
  | 'exclusive_publication'
  | 'temporary_cleanup'
  | 'directory_sync'
  | 'directory_close'
  | 'completion'

export type WorkspaceContainedCreateNoOverwritePublication = 'not_published' | 'published'

export type WorkspaceContainedCreateNoOverwriteDirectoryDurability =
  | 'not_attempted'
  | 'not_confirmed'
  | 'confirmed'
  | 'unsupported'

/**
 * A safe internal error boundary. Its message never contains a path, temporary
 * candidate name, payload, or raw native I/O detail. The original error is
 * retained only as an internal `cause` for diagnosis and deterministic tests.
 */
export class WorkspaceContainedCreateNoOverwriteError extends Error {
  readonly kind: WorkspaceContainedCreateNoOverwriteErrorKind
  readonly phase: WorkspaceContainedCreateNoOverwritePhase
  readonly publication: WorkspaceContainedCreateNoOverwritePublication
  readonly directoryDurability: WorkspaceContainedCreateNoOverwriteDirectoryDurability
  readonly temporaryMayRemain: boolean
  override readonly cause: unknown

  constructor(input: {
    kind: WorkspaceContainedCreateNoOverwriteErrorKind
    phase: WorkspaceContainedCreateNoOverwritePhase
    publication: WorkspaceContainedCreateNoOverwritePublication
    directoryDurability: WorkspaceContainedCreateNoOverwriteDirectoryDurability
    temporaryMayRemain: boolean
    cause: unknown
  }) {
    super(messageFor(input.kind), { cause: input.cause })
    this.name = 'WorkspaceContainedCreateNoOverwriteError'
    this.kind = input.kind
    this.phase = input.phase
    this.publication = input.publication
    this.directoryDurability = input.directoryDurability
    this.temporaryMayRemain = input.temporaryMayRemain
    this.cause = input.cause
  }
}

export type WorkspaceContainedCreateNoOverwriteBindInput = {
  readonly workspaceRootPath: string
  readonly relativePath: string
  readonly createParentDirectories: true
}

/**
 * Narrow P8-S2 protocol seam. All operations receive either the trusted-root
 * bind request or an already-bound descriptor capability; it deliberately
 * exposes neither pathname publication nor ordinary rename.
 */
export type WorkspaceContainedCreateNoOverwriteOperations = {
  bind: (input: WorkspaceContainedCreateNoOverwriteBindInput) => WorkspaceContainedPathBinding
  inspect: (binding: WorkspaceContainedPathBinding) => WorkspaceContainedLeaf
  createTemporary: (directory: ContainedDurableDirectory, temporaryName: string) => ContainedTemporaryFile
  writeTemporary: (file: ContainedTemporaryFile, bytes: Uint8Array) => void
  syncTemporary: (file: ContainedTemporaryFile) => void
  closeTemporary: (file: ContainedTemporaryFile) => void
  publishExclusive: (directory: ContainedDurableDirectory, temporaryName: string, basename: string) => void
  cleanupTemporary: (directory: ContainedDurableDirectory, temporaryName: string) => void
  syncDirectory: (directory: ContainedDurableDirectory) => { directorySyncUnsupported: boolean }
  closeDirectory: (binding: WorkspaceContainedPathBinding) => void
}

/** Semantic protocol record for deterministic fault-injection tests. */
export type WorkspaceContainedCreateNoOverwriteOperation = {
  readonly type: WorkspaceContainedCreateNoOverwritePhase
}

export type CreateWorkspaceContainedNoOverwriteInput = {
  /** Main-process-trusted, existing workspace root. S2 itself binds it. */
  workspaceRootPath: string
  /** Validated relative target supplied to the descriptor-bound S1 binder. */
  relativePath: string
  /** Text is encoded once as exact UTF-8 bytes before the temporary write. */
  content: string
  operations?: Partial<WorkspaceContainedCreateNoOverwriteOperations>
  onOperation?: (operation: WorkspaceContainedCreateNoOverwriteOperation) => void
  /** Receives the one generic directory-durability downgrade warning, if applicable. */
  warn?: (message: string) => void
}

type ProtocolFailure = {
  readonly kind: WorkspaceContainedCreateNoOverwriteErrorKind
  readonly phase: WorkspaceContainedCreateNoOverwritePhase
  readonly cause: unknown
}

const defaultOperations: WorkspaceContainedCreateNoOverwriteOperations = {
  bind: (input) => bindWorkspaceContainedPath(input),
  inspect: (binding) => binding.inspectLeaf(),
  createTemporary: createContainedTemporaryFile,
  writeTemporary: writeContainedTemporaryFile,
  syncTemporary: syncContainedTemporaryFile,
  closeTemporary: closeContainedTemporaryFileChecked,
  publishExclusive: publishNoOverwriteAtContainedDirectory,
  cleanupTemporary: removeContainedDirectoryEntry,
  syncDirectory: syncContainedDirectoryForPublication,
  closeDirectory: (binding) => binding.close()
}

const directorySyncDowngradeWarning =
  '[StudiumX] A required contained-directory fsync is unsupported; durability confirmation was downgraded.'

/**
 * Creates a text file only when its final descriptor-relative leaf is absent
 * at publication. The initial no-follow inspection rejects every existing
 * leaf type immediately, but is intentionally not used as the concurrency
 * decision: exclusive native publication is the sole success marker.
 *
 * S2 binds the trusted root and creates parent directories itself. It owns the
 * binding from successful bind through its single checked directory close.
 */
export async function createNoOverwriteAtWorkspaceContainedPath(
  input: CreateWorkspaceContainedNoOverwriteInput
): Promise<void> {
  const operations: WorkspaceContainedCreateNoOverwriteOperations = {
    ...defaultOperations,
    ...input.operations
  }
  const bytes = Buffer.from(input.content, 'utf8')
  const run = <T>(phase: WorkspaceContainedCreateNoOverwritePhase, action: () => T): T => {
    // The recorder is observational only. Fault injection belongs in the
    // operation seam, so a recorder mistake cannot strand an owned descriptor.
    try {
      input.onOperation?.({ type: phase })
    } catch {
      // Intentionally ignored: this is not a publication/reporting surface.
    }
    return action()
  }

  let binding: WorkspaceContainedPathBinding
  try {
    binding = run('bind', () => operations.bind({
      workspaceRootPath: input.workspaceRootPath,
      relativePath: input.relativePath,
      createParentDirectories: true
    }))
  } catch (cause) {
    throw errorFrom({ kind: 'prepublication_failure', phase: 'bind', cause }, 'not_published', 'not_attempted', false)
  }

  let primary: ProtocolFailure | undefined
  let temporary: ContainedTemporaryFile | undefined
  let temporaryName: string | undefined
  let temporaryMayRemain = false
  let temporaryNeedsClose = false
  let temporaryWasCreated = false

  try {
    const leaf = run('inspect', () => operations.inspect(binding))
    if (leaf.type !== 'absent') {
      primary = { kind: 'target_exists', phase: 'inspect', cause: undefined }
    }
  } catch (cause) {
    primary = { kind: 'prepublication_failure', phase: 'inspect', cause }
  }

  if (!primary) {
    try {
      temporaryName = makeTemporaryName(binding.basename)
      temporary = run('temporary_create', () => operations.createTemporary(binding.parentDirectory, temporaryName!))
      temporaryWasCreated = true
      temporaryMayRemain = true
      temporaryNeedsClose = true
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_create', cause }
    }
  }

  if (!primary && temporary) {
    try {
      run('temporary_write', () => operations.writeTemporary(temporary!, bytes))
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_write', cause }
    }
  }

  if (!primary && temporary) {
    try {
      run('temporary_file_sync', () => operations.syncTemporary(temporary!))
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_file_sync', cause }
    }
  }

  if (!primary && temporary) {
    temporaryNeedsClose = false // A checked close must never be retried after it throws.
    try {
      run('temporary_file_close', () => operations.closeTemporary(temporary!))
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_file_close', cause }
    }
  }

  let published = false
  if (!primary && temporaryName) {
    try {
      run('exclusive_publication', () => operations.publishExclusive(binding.parentDirectory, temporaryName!, binding.basename))
      // Only successful renameatx_np(RENAME_EXCL)/renameat2(RENAME_NOREPLACE)
      // proves publication. Never infer publication from an error path.
      published = true
    } catch (cause) {
      primary = classifyPublicationFailure(cause)
    }
  }

  if (published) return finishPublished(input, operations, run, binding)

  return finishNotPublished({
    input,
    operations,
    run,
    binding,
    primary: primary ?? { kind: 'prepublication_failure', phase: 'temporary_create', cause: undefined },
    temporary,
    temporaryName,
    temporaryWasCreated,
    temporaryNeedsClose,
    temporaryMayRemain
  })
}

function finishNotPublished(input: {
  input: CreateWorkspaceContainedNoOverwriteInput
  operations: WorkspaceContainedCreateNoOverwriteOperations
  run: <T>(phase: WorkspaceContainedCreateNoOverwritePhase, action: () => T) => T
  binding: WorkspaceContainedPathBinding
  primary: ProtocolFailure
  temporary: ContainedTemporaryFile | undefined
  temporaryName: string | undefined
  temporaryWasCreated: boolean
  temporaryNeedsClose: boolean
  temporaryMayRemain: boolean
}): void {
  let { temporaryMayRemain } = input
  let finalizationFailure: ProtocolFailure | undefined
  let directoryDurability: WorkspaceContainedCreateNoOverwriteDirectoryDurability = 'not_attempted'

  if (input.temporaryNeedsClose && input.temporary) {
    // Close after write/fsync failure so descriptor ownership is still checked
    // before descriptor-relative unlink. Mark it attempted before the call.
    try {
      input.run('temporary_file_close', () => input.operations.closeTemporary(input.temporary!))
    } catch (cause) {
      finalizationFailure ??= { kind: 'prepublication_failure', phase: 'temporary_file_close', cause }
    }
  }

  if (input.temporaryMayRemain && input.temporaryName) {
    try {
      input.run('temporary_cleanup', () => input.operations.cleanupTemporary(input.binding.parentDirectory, input.temporaryName!))
      temporaryMayRemain = false
    } catch (cause) {
      // Any unlink failure is conservatively reported as a remaining candidate.
      finalizationFailure ??= { kind: 'prepublication_failure', phase: 'temporary_cleanup', cause }
    }
  }

  if (input.temporaryWasCreated) {
    directoryDurability = 'not_confirmed'
    try {
      const result = input.run('directory_sync', () => input.operations.syncDirectory(input.binding.parentDirectory))
      directoryDurability = result.directorySyncUnsupported ? 'unsupported' : 'confirmed'
    } catch (cause) {
      finalizationFailure ??= { kind: 'prepublication_failure', phase: 'directory_sync', cause }
    }
  }

  try {
    input.run('directory_close', () => input.operations.closeDirectory(input.binding))
  } catch (cause) {
    finalizationFailure ??= { kind: 'prepublication_failure', phase: 'directory_close', cause }
  }

  if (directoryDurability === 'unsupported') {
    try {
      ;(input.input.warn ?? console.warn)(directorySyncDowngradeWarning)
    } catch (cause) {
      finalizationFailure ??= { kind: 'prepublication_failure', phase: 'completion', cause }
    }
  }

  const failure = finalizationFailure ?? input.primary
  const cleanTargetConflict = input.primary.kind === 'target_exists' && !finalizationFailure
  const cleanUnavailable = input.primary.kind === 'atomic_no_clobber_unavailable' && !finalizationFailure
  const kind = cleanTargetConflict
    ? 'target_exists'
    : cleanUnavailable
      ? 'atomic_no_clobber_unavailable'
      : 'prepublication_failure'

  throw errorFrom({ kind, phase: failure.phase, cause: failure.cause }, 'not_published', directoryDurability, temporaryMayRemain)
}

function finishPublished(
  input: CreateWorkspaceContainedNoOverwriteInput,
  operations: WorkspaceContainedCreateNoOverwriteOperations,
  run: <T>(phase: WorkspaceContainedCreateNoOverwritePhase, action: () => T) => T,
  binding: WorkspaceContainedPathBinding
): void {
  let directoryDurability: WorkspaceContainedCreateNoOverwriteDirectoryDurability = 'not_confirmed'
  let failure: ProtocolFailure | undefined

  try {
    const result = run('directory_sync', () => operations.syncDirectory(binding.parentDirectory))
    directoryDurability = result.directorySyncUnsupported ? 'unsupported' : 'confirmed'
  } catch (cause) {
    failure = { kind: 'possibly_published', phase: 'directory_sync', cause }
  }

  try {
    run('directory_close', () => operations.closeDirectory(binding))
  } catch (cause) {
    failure ??= { kind: 'possibly_published', phase: 'directory_close', cause }
  }

  if (directoryDurability === 'unsupported') {
    try {
      ;(input.warn ?? console.warn)(directorySyncDowngradeWarning)
    } catch (cause) {
      failure ??= { kind: 'possibly_published', phase: 'completion', cause }
    }
  }

  if (failure) {
    throw errorFrom(failure, 'published', directoryDurability, false)
  }
}

function classifyPublicationFailure(cause: unknown): ProtocolFailure {
  if (errorCode(cause) === 'EEXIST') {
    return { kind: 'target_exists', phase: 'exclusive_publication', cause }
  }
  if (errorCode(cause) === 'ERR_CONTAINED_CREATE_NO_OVERWRITE_UNAVAILABLE') {
    return { kind: 'atomic_no_clobber_unavailable', phase: 'exclusive_publication', cause }
  }
  return { kind: 'prepublication_failure', phase: 'exclusive_publication', cause }
}

function errorFrom(
  failure: ProtocolFailure,
  publication: WorkspaceContainedCreateNoOverwritePublication,
  directoryDurability: WorkspaceContainedCreateNoOverwriteDirectoryDurability,
  temporaryMayRemain: boolean
): WorkspaceContainedCreateNoOverwriteError {
  return new WorkspaceContainedCreateNoOverwriteError({
    kind: failure.kind,
    phase: failure.phase,
    publication,
    directoryDurability,
    temporaryMayRemain,
    cause: failure.cause
  })
}

function makeTemporaryName(basename: string): string {
  return `.${basename}.${process.pid}.${randomUUID()}.tmp`
}

function errorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('code' in value)) return null
  return typeof value.code === 'string' ? value.code : null
}

function messageFor(kind: WorkspaceContainedCreateNoOverwriteErrorKind): string {
  switch (kind) {
    case 'target_exists':
      return 'The workspace target already exists.'
    case 'atomic_no_clobber_unavailable':
      return 'Atomic descriptor-bound create-no-overwrite is unavailable.'
    case 'possibly_published':
      return 'Create-no-overwrite may already have been published.'
    case 'prepublication_failure':
      return 'Create-no-overwrite failed before publication was confirmed.'
  }
}
