import { randomUUID } from 'node:crypto'

import {
  bindWorkspaceContainedPath,
  closeContainedTemporaryFileChecked,
  createContainedTemporaryFile,
  prepareContainedRestrictedOverwriteCandidate,
  removeContainedDirectoryEntry,
  swapContainedRestrictedOverwriteAtContainedDirectory,
  syncContainedDirectoryForPublication,
  syncContainedTemporaryFile,
  writeContainedTemporaryFile,
  type ContainedDurableDirectory,
  type ContainedTemporaryFile,
  type WorkspaceContainedLeaf,
  type WorkspaceContainedPathBinding
} from './contained-durable-directory'

/** Internal-only C-4P8-S3 failure classification; never an API/tool contract. */
export type WorkspaceContainedRestrictedOverwriteErrorKind =
  | 'target_missing'
  | 'target_not_restricted_regular'
  | 'atomic_exchange_unavailable'
  | 'prepublication_failure'
  | 'possibly_published'

/**
 * S3's deterministic protocol matrix. `prepublication_directory_sync` is
 * cleanup-only: it never changes publication state and cannot replace the
 * primary prepublication error.
 */
export type WorkspaceContainedRestrictedOverwritePhase =
  | 'bind'
  | 'inspect_initial'
  | 'temporary_create'
  | 'temporary_write'
  | 'inspect_before_swap'
  | 'temporary_chmod'
  | 'temporary_file_sync'
  | 'temporary_file_close'
  | 'swap_publication'
  | 'first_directory_sync'
  | 'temporary_alias_cleanup'
  | 'second_directory_sync'
  | 'prepublication_directory_sync'
  | 'directory_close'
  | 'warning'
  | 'completion'

export type WorkspaceContainedRestrictedOverwritePublication = 'not_published' | 'published'
export type WorkspaceContainedRestrictedOverwriteDirectoryDurability =
  | 'not_attempted'
  | 'not_confirmed'
  | 'confirmed'
  | 'unsupported'

/**
 * Safe internal error boundary. The message intentionally contains no path,
 * candidate name, prior bytes, or raw native error detail. `cause` remains
 * available only to main-process diagnostics and deterministic tests.
 */
export class WorkspaceContainedRestrictedOverwriteError extends Error {
  readonly kind: WorkspaceContainedRestrictedOverwriteErrorKind
  readonly phase: WorkspaceContainedRestrictedOverwritePhase
  readonly publication: WorkspaceContainedRestrictedOverwritePublication
  readonly directoryDurability: WorkspaceContainedRestrictedOverwriteDirectoryDurability
  readonly temporaryMayRemain: boolean
  override readonly cause: unknown

  constructor(input: {
    kind: WorkspaceContainedRestrictedOverwriteErrorKind
    phase: WorkspaceContainedRestrictedOverwritePhase
    publication: WorkspaceContainedRestrictedOverwritePublication
    directoryDurability: WorkspaceContainedRestrictedOverwriteDirectoryDurability
    temporaryMayRemain: boolean
    cause: unknown
  }) {
    super(messageFor(input.kind), { cause: input.cause })
    this.name = 'WorkspaceContainedRestrictedOverwriteError'
    this.kind = input.kind
    this.phase = input.phase
    this.publication = input.publication
    this.directoryDurability = input.directoryDurability
    this.temporaryMayRemain = input.temporaryMayRemain
    this.cause = input.cause
  }
}

export type WorkspaceContainedRestrictedOverwriteBindInput = {
  readonly workspaceRootPath: string
  readonly relativePath: string
  readonly createParentDirectories: false
}

/**
 * Injectable S3 protocol seam. Every filesystem operation receives an already
 * bound descriptor capability (or the trusted-root bind request). It exposes
 * neither a pathname overwrite, ordinary rename fallback, nor a hardlink
 * fallback. The mode argument on `createTemporary` is a seam observation only:
 * the native candidate creation primitive itself always requests `0666`, so
 * the effective on-disk creation mode remains `0666 & umask`.
 */
export type WorkspaceContainedRestrictedOverwriteOperations = {
  bind: (input: WorkspaceContainedRestrictedOverwriteBindInput) => WorkspaceContainedPathBinding
  inspectInitial: (binding: WorkspaceContainedPathBinding) => WorkspaceContainedLeaf
  createTemporary: (directory: ContainedDurableDirectory, temporaryName: string, requestedMode: number) => ContainedTemporaryFile
  writeTemporary: (file: ContainedTemporaryFile, bytes: Uint8Array) => void
  inspectBeforeSwap: (binding: WorkspaceContainedPathBinding) => WorkspaceContainedLeaf
  chmodTemporary: (
    file: ContainedTemporaryFile,
    mode: number,
    directory: ContainedDurableDirectory,
    basename: string
  ) => void
  syncTemporary: (file: ContainedTemporaryFile) => void
  closeTemporary: (file: ContainedTemporaryFile) => void
  publishSwap: (
    directory: ContainedDurableDirectory,
    temporaryName: string,
    basename: string,
    file: ContainedTemporaryFile
  ) => void
  syncDirectory: (directory: ContainedDurableDirectory) => { directorySyncUnsupported: boolean }
  cleanupTemporaryAlias: (directory: ContainedDurableDirectory, temporaryName: string) => void
  closeDirectory: (binding: WorkspaceContainedPathBinding) => void
  /** Success acknowledgement: injectable failures are publication-uncertain after swap. */
  complete: () => void
}

export type WorkspaceContainedRestrictedOverwriteOperation = {
  readonly type: WorkspaceContainedRestrictedOverwritePhase
}

export type RestrictedOverwriteWorkspaceContainedPathInput = {
  /** Main-process-trusted existing workspace root; S3 only binds this root. */
  workspaceRootPath: string
  /** Validated descriptor-relative target; S3 never creates parent directories. */
  relativePath: string
  /** Text is encoded once as exact UTF-8 before candidate creation. */
  content: string
  operations?: Partial<WorkspaceContainedRestrictedOverwriteOperations>
  onOperation?: (operation: WorkspaceContainedRestrictedOverwriteOperation) => void
  /** Receives one generic directory-durability downgrade warning at most once. */
  warn?: (message: string) => void
}

type ProtocolFailure = {
  readonly kind: WorkspaceContainedRestrictedOverwriteErrorKind
  readonly phase: WorkspaceContainedRestrictedOverwritePhase
  readonly cause: unknown
}

const defaultOperations: WorkspaceContainedRestrictedOverwriteOperations = {
  bind: (input) => bindWorkspaceContainedPath(input),
  inspectInitial: (binding) => binding.inspectLeaf(),
  // The native primitive fixes its openat mode at 0666; the seam's mode is
  // intentionally not forwarded as an alternate creation primitive.
  createTemporary: (directory, temporaryName) => createContainedTemporaryFile(directory, temporaryName),
  writeTemporary: writeContainedTemporaryFile,
  inspectBeforeSwap: (binding) => binding.inspectLeaf(),
  // Native performs a second descriptor-relative AT_SYMLINK_NOFOLLOW inspect
  // and derives `mode & 0777` itself immediately before fchmod.
  chmodTemporary: (file, _mode, directory, basename) =>
    prepareContainedRestrictedOverwriteCandidate(directory, file, basename),
  syncTemporary: syncContainedTemporaryFile,
  closeTemporary: closeContainedTemporaryFileChecked,
  publishSwap: (directory, temporaryName, basename, file) =>
    swapContainedRestrictedOverwriteAtContainedDirectory(directory, file, temporaryName, basename),
  syncDirectory: syncContainedDirectoryForPublication,
  cleanupTemporaryAlias: removeContainedDirectoryEntry,
  closeDirectory: (binding) => binding.close(),
  complete: () => undefined
}

const directorySyncDowngradeWarning =
  '[StudiumX] A required contained-directory fsync is unsupported; durability confirmation was downgraded.'

// The native creator requests 0666 and the process umask determines the
// actual mode. The seam receives that pre-umask creation request directly.
const seamCandidateCreationMode = 0o666

/**
 * Replaces exactly one existing regular, single-link workspace file through a
 * descriptor-bound exchange. The native exchange return is the only known
 * publication marker; from then on this function never rolls back, retries
 * exchange, or removes the final target.
 */
export async function overwriteExistingRestrictedAtWorkspaceContainedPath(
  input: RestrictedOverwriteWorkspaceContainedPathInput
): Promise<void> {
  const operations: WorkspaceContainedRestrictedOverwriteOperations = {
    ...defaultOperations,
    ...input.operations
  }
  const bytes = Buffer.from(input.content, 'utf8')
  const run = <T>(phase: WorkspaceContainedRestrictedOverwritePhase, action: () => T): T => {
    try {
      input.onOperation?.({ type: phase })
    } catch {
      // Pure observability cannot affect ownership or publication.
    }
    return action()
  }

  let binding: WorkspaceContainedPathBinding
  try {
    binding = run('bind', () => operations.bind({
      workspaceRootPath: input.workspaceRootPath,
      relativePath: input.relativePath,
      createParentDirectories: false
    }))
  } catch (cause) {
    throw errorFrom({ kind: 'prepublication_failure', phase: 'bind', cause }, 'not_published', 'not_attempted', false)
  }

  let candidate: ContainedTemporaryFile | undefined
  let candidateName: string | undefined
  let candidateNeedsClose = false
  let candidateMayRemain = false
  let primary: ProtocolFailure | undefined

  try {
    primary = classifyLeaf(run('inspect_initial', () => operations.inspectInitial(binding)), 'inspect_initial')
  } catch (cause) {
    primary = { kind: 'prepublication_failure', phase: 'inspect_initial', cause }
  }

  if (!primary) {
    try {
      candidateName = makeCandidateName(binding.basename)
      candidate = run('temporary_create', () => operations.createTemporary(
        binding.parentDirectory,
        candidateName!,
        seamCandidateCreationMode
      ))
      candidateNeedsClose = true
      candidateMayRemain = true
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_create', cause }
    }
  }
  if (!primary && candidate) {
    try {
      run('temporary_write', () => operations.writeTemporary(candidate!, bytes))
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_write', cause }
    }
  }
  let beforeSwapLeaf: WorkspaceContainedLeaf | undefined
  if (!primary) {
    try {
      beforeSwapLeaf = run('inspect_before_swap', () => operations.inspectBeforeSwap(binding))
      primary = classifyLeaf(beforeSwapLeaf, 'inspect_before_swap')
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'inspect_before_swap', cause }
    }
  }
  if (!primary && candidate && beforeSwapLeaf?.type === 'regular') {
    try {
      run('temporary_chmod', () => operations.chmodTemporary(
        candidate!,
        beforeSwapLeaf!.mode & 0o777,
        binding.parentDirectory,
        binding.basename
      ))
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_chmod', cause }
    }
  }
  if (!primary && candidate) {
    try {
      run('temporary_file_sync', () => operations.syncTemporary(candidate!))
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_file_sync', cause }
    }
  }
  if (!primary && candidate) {
    candidateNeedsClose = false // checked close must never be retried
    try {
      run('temporary_file_close', () => operations.closeTemporary(candidate!))
    } catch (cause) {
      primary = { kind: 'prepublication_failure', phase: 'temporary_file_close', cause }
    }
  }

  if (!primary && candidate && candidateName) {
    try {
      run('swap_publication', () => operations.publishSwap(
        binding.parentDirectory,
        candidateName!,
        binding.basename,
        candidate!
      ))
    } catch (cause) {
      // The native primitive obtains its return value before the syscall and
      // has no fallible N-API work after a successful exchange. Therefore a
      // thrown swap call is known not to have crossed publication.
      primary = classifyExchangeFailure(cause)
    }
  }

  if (!primary && candidateName) {
    return finishPublished(input, operations, run, binding, candidateName)
  }
  return finishNotPublished({
    input,
    operations,
    run,
    binding,
    primary: primary ?? { kind: 'prepublication_failure', phase: 'temporary_create', cause: undefined },
    candidate,
    candidateName,
    candidateNeedsClose,
    candidateMayRemain
  })
}

function finishNotPublished(input: {
  input: RestrictedOverwriteWorkspaceContainedPathInput
  operations: WorkspaceContainedRestrictedOverwriteOperations
  run: <T>(phase: WorkspaceContainedRestrictedOverwritePhase, action: () => T) => T
  binding: WorkspaceContainedPathBinding
  primary: ProtocolFailure
  candidate: ContainedTemporaryFile | undefined
  candidateName: string | undefined
  candidateNeedsClose: boolean
  candidateMayRemain: boolean
}): never {
  let candidateMayRemain = input.candidateMayRemain
  let cleanupAttempted = false
  let directoryDurability: WorkspaceContainedRestrictedOverwriteDirectoryDurability = 'not_attempted'
  let directorySyncUnsupported = false

  if (input.candidateNeedsClose && input.candidate) {
    try {
      input.run('temporary_file_close', () => input.operations.closeTemporary(input.candidate!))
    } catch {
      // The primary prepublication failure is authoritative. A checked close
      // never retries; cleanup below still attempts the descriptor-relative name.
    }
  }
  if (candidateMayRemain && input.candidateName) {
    cleanupAttempted = true
    try {
      input.run('temporary_alias_cleanup', () => input.operations.cleanupTemporaryAlias(
        input.binding.parentDirectory,
        input.candidateName!
      ))
      candidateMayRemain = false
    } catch {
      // Keep the initial primary cause/phase/kind; this only means the
      // disposable candidate might still be present.
    }
  }
  if (cleanupAttempted) {
    try {
      const result = input.run('prepublication_directory_sync', () =>
        input.operations.syncDirectory(input.binding.parentDirectory)
      )
      directorySyncUnsupported = result.directorySyncUnsupported
      directoryDurability = result.directorySyncUnsupported ? 'unsupported' : 'confirmed'
    } catch {
      directoryDurability = 'not_confirmed'
    }
  }

  // A directory capability is always closed once after bind, regardless of
  // prior cleanup/fsync failures. Its failure cannot eclipse the primary.
  try {
    input.run('directory_close', () => input.operations.closeDirectory(input.binding))
  } catch {
    // Primary failure remains authoritative.
  }

  if (directorySyncUnsupported) {
    emitDowngradeWarningWithoutChangingPrimary(input.input, input.run)
  }
  // Acknowledge completion after directory close but do not allow an injected
  // acknowledgement failure to reclassify a known-unpublished primary.
  try {
    input.run('completion', () => input.operations.complete())
  } catch {
    // Primary failure remains authoritative.
  }

  throw errorFrom(input.primary, 'not_published', directoryDurability, candidateMayRemain)
}

function finishPublished(
  input: RestrictedOverwriteWorkspaceContainedPathInput,
  operations: WorkspaceContainedRestrictedOverwriteOperations,
  run: <T>(phase: WorkspaceContainedRestrictedOverwritePhase, action: () => T) => T,
  binding: WorkspaceContainedPathBinding,
  oldAliasName: string,
  initialFailure?: ProtocolFailure
): void {
  let directoryDurability: WorkspaceContainedRestrictedOverwriteDirectoryDurability = 'not_confirmed'
  let failure = initialFailure
  let temporaryMayRemain = true
  let directorySyncUnsupported = false

  const observeDirectorySync = (phase: 'first_directory_sync' | 'second_directory_sync'): void => {
    try {
      const result = run(phase, () => operations.syncDirectory(binding.parentDirectory))
      if (result.directorySyncUnsupported) {
        directorySyncUnsupported = true
        directoryDurability = 'unsupported'
      } else if (directoryDurability !== 'unsupported') {
        directoryDurability = 'confirmed'
      }
    } catch (cause) {
      failure ??= { kind: 'possibly_published', phase, cause }
    }
  }

  // From here on, exchange may already be the sole publication marker. Never
  // unlink/retry the final leaf, regardless of any later failure.
  if (!failure) observeDirectorySync('first_directory_sync')
  if (!failure) {
    try {
      run('temporary_alias_cleanup', () => operations.cleanupTemporaryAlias(binding.parentDirectory, oldAliasName))
      temporaryMayRemain = false
    } catch (cause) {
      failure ??= { kind: 'possibly_published', phase: 'temporary_alias_cleanup', cause }
    }
  }
  if (!failure) observeDirectorySync('second_directory_sync')

  // Always attempt one close after publication, even after fsync or alias
  // cleanup fails. It cannot make the published state safe to roll back.
  try {
    run('directory_close', () => operations.closeDirectory(binding))
  } catch (cause) {
    failure ??= { kind: 'possibly_published', phase: 'directory_close', cause }
  }

  if (directorySyncUnsupported) {
    try {
      run('warning', () => (input.warn ?? console.warn)(directorySyncDowngradeWarning))
    } catch (cause) {
      failure ??= { kind: 'possibly_published', phase: 'warning', cause }
    }
  }

  // This is an injectable acknowledgement seam, unlike `onOperation`, whose
  // observer exceptions are deliberately ignored. It runs after every
  // published directory close and retains the post-publication classification.
  try {
    run('completion', () => operations.complete())
  } catch (cause) {
    failure ??= { kind: 'possibly_published', phase: 'completion', cause }
  }

  if (failure) throw errorFrom(failure, 'published', directoryDurability, temporaryMayRemain)
}

function classifyLeaf(
  leaf: WorkspaceContainedLeaf,
  phase: 'inspect_initial' | 'inspect_before_swap'
): ProtocolFailure | undefined {
  if (leaf.type === 'absent') return { kind: 'target_missing', phase, cause: undefined }
  if (leaf.type !== 'regular' || leaf.linkCount !== 1) {
    return { kind: 'target_not_restricted_regular', phase, cause: undefined }
  }
  return undefined
}

function classifyExchangeFailure(cause: unknown): ProtocolFailure {
  if (errorCode(cause) === 'ERR_CONTAINED_RESTRICTED_OVERWRITE_UNAVAILABLE') {
    return { kind: 'atomic_exchange_unavailable', phase: 'swap_publication', cause }
  }
  return { kind: 'prepublication_failure', phase: 'swap_publication', cause }
}

function emitDowngradeWarningWithoutChangingPrimary(
  input: RestrictedOverwriteWorkspaceContainedPathInput,
  run: <T>(phase: WorkspaceContainedRestrictedOverwritePhase, action: () => T) => T
): void {
  try {
    run('warning', () => (input.warn ?? console.warn)(directorySyncDowngradeWarning))
  } catch {
    // Finalization observations must not replace the original primary error.
  }
}

function errorFrom(
  failure: ProtocolFailure,
  publication: WorkspaceContainedRestrictedOverwritePublication,
  directoryDurability: WorkspaceContainedRestrictedOverwriteDirectoryDurability,
  temporaryMayRemain: boolean
): WorkspaceContainedRestrictedOverwriteError {
  return new WorkspaceContainedRestrictedOverwriteError({
    kind: failure.kind,
    phase: failure.phase,
    publication,
    directoryDurability,
    temporaryMayRemain,
    cause: failure.cause
  })
}

function makeCandidateName(basename: string): string {
  return `.${basename}.${process.pid}.${randomUUID()}.restricted-overwrite.tmp`
}

function errorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('code' in value)) return null
  return typeof value.code === 'string' ? value.code : null
}

function messageFor(kind: WorkspaceContainedRestrictedOverwriteErrorKind): string {
  switch (kind) {
    case 'target_missing':
      return 'Restricted overwrite requires an existing workspace target.'
    case 'target_not_restricted_regular':
      return 'Restricted overwrite requires a single-link regular workspace target.'
    case 'atomic_exchange_unavailable':
      return 'Atomic descriptor-bound restricted overwrite is unavailable.'
    case 'possibly_published':
      return 'Restricted overwrite may already have been published.'
    case 'prepublication_failure':
      return 'Restricted overwrite failed before publication was confirmed.'
  }
}
