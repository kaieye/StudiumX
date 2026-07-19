import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type NativeContainedDirectoryEntry = {
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other'
}

type NativeContainedDirectoryLeaf =
  | { type: 'absent' }
  | { type: 'regular'; mode: number; linkCount: number }
  | { type: 'directory'; mode: number; linkCount: number }
  | { type: 'symlink'; mode: number; linkCount: number }
  | { type: 'other'; mode: number; linkCount: number }

type NativeContainedDurableReplace = {
  openContainedRootDirectory: (physicalParentPath: string, rootName: string, createIfMissing: boolean) => unknown
  openContainedDirectoryChild: (directory: unknown, name: string, createIfMissing: boolean) => unknown
  openContainedWorkspaceDirectoryChild: (directory: unknown, name: string, createIfMissing: boolean) => unknown
  inspectContainedDirectoryLeaf: (directory: unknown, name: string) => NativeContainedDirectoryLeaf
  syncContainedDirectory: (directory: unknown) => void
  listContainedDirectory: (directory: unknown) => NativeContainedDirectoryEntry[]
  readRegularFileAtContainedDirectory: (directory: unknown, filename: string) => Buffer
  replaceAtContainedDirectory: (
    directory: unknown,
    filename: string,
    temporaryName: string,
    content: Buffer
  ) => Promise<{ directorySyncUnsupported: boolean }>
  createContainedTemporaryFile: (directory: unknown, temporaryName: string) => unknown
  writeContainedTemporaryFile: (temporaryFile: unknown, content: Buffer) => void
  prepareContainedRestrictedOverwriteCandidate: (directory: unknown, temporaryFile: unknown, filename: string) => void
  swapContainedRestrictedOverwriteAtContainedDirectory: (directory: unknown, temporaryFile: unknown, temporaryName: string, filename: string) => void
  syncContainedTemporaryFile: (temporaryFile: unknown) => void
  closeContainedTemporaryFileChecked: (temporaryFile: unknown) => void
  publishNoOverwriteAtContainedDirectory: (directory: unknown, temporaryName: string, filename: string) => void
  removeContainedDirectoryEntry: (directory: unknown, name: string) => void
  syncContainedDirectoryForPublication: (directory: unknown) => { directorySyncUnsupported: boolean }
  closeContainedDirectoryChecked: (directory: unknown) => void
  closeContainedDirectory: (directory: unknown) => void
}

/** A normalized descriptor-relative target beneath a trusted workspace root. */
export type WorkspaceContainedRelativePath = {
  /** Canonical display/storage form. It always uses POSIX separators. */
  readonly relativePath: string
  /** The descriptor-relative directories to traverse before the final leaf. */
  readonly parentComponents: readonly string[]
  /** The safe final component; never a path fragment. */
  readonly basename: string
}

/** A no-follow final-leaf classification produced by fstatat(AT_SYMLINK_NOFOLLOW). */
export type WorkspaceContainedLeaf =
  | { readonly type: 'absent' }
  | { readonly type: 'regular'; readonly mode: number; readonly linkCount: number }
  | { readonly type: 'directory' }
  | { readonly type: 'symlink' }
  | { readonly type: 'other' }

export type WorkspaceContainedDirectoryErrorKind =
  | 'invalid_relative_path'
  | 'descriptor_capability_unavailable'
  | 'workspace_root_bind_failed'
  | 'parent_component_open_failed'
  | 'leaf_inspection_failed'
  | 'directory_sync_failed'
  | 'directory_close_failed'

/**
 * Internal boundary error for the descriptor-only workspace foundation.
 * Its detail is deliberately not a tool/API error contract.
 */
export class WorkspaceContainedDirectoryError extends Error {
  readonly kind: WorkspaceContainedDirectoryErrorKind

  constructor(kind: WorkspaceContainedDirectoryErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'WorkspaceContainedDirectoryError'
    this.kind = kind
  }
}

/**
 * The deliberately narrow S1 seam: it can record or deterministically fail
 * descriptor operations, but exposes no payload creation/publication hooks.
 */
export type WorkspaceContainedDirectoryOperations = {
  openOrCreateComponent: (
    parent: ContainedDurableDirectory,
    component: string,
    createIfMissing: boolean
  ) => ContainedDurableDirectory
  inspectLeaf: (parent: ContainedDurableDirectory, basename: string) => WorkspaceContainedLeaf
  syncDirectory: (directory: ContainedDurableDirectory) => void
  closeDirectory: (directory: ContainedDurableDirectory) => void
}

export type WorkspaceContainedDirectoryOperation =
  | { readonly type: 'open_or_create_component'; readonly component: string; readonly createIfMissing: boolean }
  | { readonly type: 'inspect_leaf'; readonly basename: string }
  | { readonly type: 'sync_directory' }
  | { readonly type: 'close_directory' }

export type BindWorkspaceContainedPathInput = {
  /** Existing main-process-trusted workspace root. It is never created by S1. */
  workspaceRootPath: string
  relativePath: string
  /** Create only missing parent directories, never the final leaf. */
  createParentDirectories?: boolean
  /** Test-only/internal operation replacement; it is not a publication seam. */
  operations?: Partial<WorkspaceContainedDirectoryOperations>
  /** Lightweight operation recorder for deterministic foundation tests. */
  onOperation?: (operation: WorkspaceContainedDirectoryOperation) => void
}

/**
 * A retained descriptor to the parsed target's parent. S1 intentionally
 * provides no final-leaf writer, temporary-file, or publication operation.
 */
export type WorkspaceContainedPathBinding = WorkspaceContainedRelativePath & {
  readonly parentDirectory: ContainedDurableDirectory
  inspectLeaf: () => WorkspaceContainedLeaf
  syncParentDirectory: () => void
  close: () => void
}

export type NativeContainedDurableReplaceUnavailableReason = 'unsupported_platform' | 'native_unavailable'

export type NativeContainedDurableReplaceCapability =
  | { available: true }
  | { available: false; reason: NativeContainedDurableReplaceUnavailableReason }

export type NativeContainedDurableReplaceResolverInput = {
  /** Allows resolver tests and an unpackaged app wrapper to provide its known root. */
  projectRoot?: string
  moduleUrl?: string
  resourcesPath?: string
  defaultApp?: boolean
}

/** An opaque native directory descriptor retained across contained operations. */
export type ContainedDurableDirectory = {
  readonly nativeDirectory: unknown
}

/** Opaque descriptor-bound temporary file capability for P8 publication. */
export type ContainedTemporaryFile = {
  readonly nativeTemporaryFile: unknown
}

export type ContainedDirectoryEntry = NativeContainedDirectoryEntry

class NativeContainedDurableReplaceUnavailableError extends Error {
  readonly reason: NativeContainedDurableReplaceUnavailableReason

  constructor(reason: NativeContainedDurableReplaceUnavailableReason, cause?: unknown) {
    super(
      reason === 'unsupported_platform'
        ? 'Descriptor-relative contained directory access is unavailable on this platform.'
        : 'The optional descriptor-relative contained directory native capability is unavailable.',
      cause === undefined ? undefined : { cause }
    )
    this.name = 'NativeContainedDurableReplaceUnavailableError'
    this.reason = reason
  }
}

let loadedNative: NativeContainedDurableReplace | undefined

/**
 * Resolves the exact packaged resource only for a packaged Electron process.
 * Source, electron-vite output, and direct Node/Vitest execution discover the
 * project root from this module location instead of trusting process.cwd().
 */
export function resolveContainedDurableReplaceAddonPath(
  input: NativeContainedDurableReplaceResolverInput = {}
): string {
  const resourcesPath = input.resourcesPath ?? process.resourcesPath
  const defaultApp = input.defaultApp ?? process.defaultApp
  if (resourcesPath && defaultApp === false) {
    return join(resourcesPath, 'native', 'contained_durable_replace.node')
  }

  const projectRoot = input.projectRoot ?? findUnpackagedProjectRoot(input.moduleUrl ?? import.meta.url)
  return join(projectRoot, 'native', 'contained-durable-replace', 'build', 'Release', 'contained_durable_replace.node')
}

/**
 * Descriptor-relative storage is deliberately optional: only a host-built
 * POSIX addon is supported. Unsupported hosts never use a pathname fallback.
 */
export function getContainedDurableDirectoryCapability(input: {
  platform?: NodeJS.Platform
  resolver?: NativeContainedDurableReplaceResolverInput
} = {}): NativeContainedDurableReplaceCapability {
  if (!isHostBuiltPosixPlatform(input.platform ?? process.platform)) {
    return { available: false, reason: 'unsupported_platform' }
  }
  try {
    loadNativeContainedDurableReplace(input.resolver)
    return { available: true }
  } catch (error) {
    if (isNativeContainedDurableReplaceUnavailable(error)) {
      return { available: false, reason: error.reason }
    }
    return { available: false, reason: 'native_unavailable' }
  }
}

/** Alias naming the generic descriptor/no-follow capability used by C-6. */
export const getDescriptorRelativeDirectoryCapability = getContainedDurableDirectoryCapability

/**
 * Opens the configured storage root as a no-follow descriptor.
 *
 * The main-process-only configured pathname is the trust boundary. Its
 * existing parent is canonicalized once before native capability binding, so
 * OS-managed intermediate links such as macOS `/var -> /private/var` work.
 * The final root is deliberately not resolved: native opens it from the
 * retained physical parent with O_NOFOLLOW. Every child/file operation below
 * that root remains descriptor-relative and swap-resistant.
 */
export function openContainedRootDirectory(rootPath: string, createIfMissing: boolean): ContainedDurableDirectory {
  const configuredRoot = canonicalizeConfiguredRoot(rootPath)
  return {
    nativeDirectory: loadNativeContainedDurableReplace().openContainedRootDirectory(
      configuredRoot.physicalParentPath,
      configuredRoot.rootName,
      createIfMissing
    )
  }
}

/** Opens one no-follow child directory below a retained parent descriptor. */
export function openContainedDirectoryChild(
  parent: ContainedDurableDirectory,
  name: string,
  createIfMissing: boolean
): ContainedDurableDirectory {
  if (!isSafeBasename(name)) throw new Error('Contained child directory name is invalid.')
  return {
    nativeDirectory: loadNativeContainedDurableReplace().openContainedDirectoryChild(
      parent.nativeDirectory,
      name,
      createIfMissing
    )
  }
}

/** Lists one retained directory without re-traversing its pathname. */
export function listContainedDirectory(directory: ContainedDurableDirectory): readonly ContainedDirectoryEntry[] {
  return loadNativeContainedDurableReplace().listContainedDirectory(directory.nativeDirectory)
}

/** Reads a final regular file via openat(O_NOFOLLOW) under its retained parent. */
export function readRegularFileAtContainedDirectory(
  directory: ContainedDurableDirectory,
  filename: string
): Buffer {
  if (!isSafeBasename(filename)) throw new Error('Contained regular file name is invalid.')
  return loadNativeContainedDurableReplace().readRegularFileAtContainedDirectory(directory.nativeDirectory, filename)
}

/**
 * Opens the fixed C-2C output directory as a native directory capability.
 * The configured root is bound first; both fixed descendants are then opened
 * with no-follow descriptor-relative operations before the output descriptor is retained.
 */
export function openContainedDurableDirectory(rootPath: string): ContainedDurableDirectory {
  const rootDirectory = openContainedRootDirectory(rootPath, false)
  let studiumxDirectory: ContainedDurableDirectory | undefined
  try {
    studiumxDirectory = openContainedDirectoryChild(rootDirectory, '.studiumx', true)
    return openContainedDirectoryChild(studiumxDirectory, 'conversation-projections', true)
  } finally {
    if (studiumxDirectory) closeContainedDurableDirectory(studiumxDirectory)
    closeContainedDurableDirectory(rootDirectory)
  }
}

/**
 * Creates, fsyncs, renames, and directory-fsyncs entirely relative to the
 * previously acquired directory capability. Neither temporary nor final names
 * re-traverse a workspace pathname.
 */
export async function replaceDurablyInContainedDirectory(input: {
  directory: ContainedDurableDirectory
  filename: string
  content: string | Uint8Array
  onDirectoryBound?: () => void | Promise<void>
  warn?: (message: string) => void
}): Promise<void> {
  if (!isSafeBasename(input.filename)) throw new Error('Contained durable replacement filename is invalid.')
  await input.onDirectoryBound?.()
  const content = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : Buffer.from(input.content)
  const result = await loadNativeContainedDurableReplace().replaceAtContainedDirectory(
    input.directory.nativeDirectory,
    input.filename,
    `.${input.filename}.${process.pid}.${randomUUID()}.tmp`,
    content
  )
  if (result.directorySyncUnsupported) {
    ;(input.warn ?? console.warn)('[StudiumX] A required contained-directory fsync is unsupported; publication completed under the documented durability downgrade.')
  }
}


/** Creates one descriptor-relative, exclusive temporary candidate. */
export function createContainedTemporaryFile(
  directory: ContainedDurableDirectory,
  temporaryName: string
): ContainedTemporaryFile {
  if (!isSafeBasename(temporaryName)) throw new Error('Contained temporary filename is invalid.')
  return {
    nativeTemporaryFile: loadNativeContainedDurableReplace().createContainedTemporaryFile(
      directory.nativeDirectory,
      temporaryName
    )
  }
}

/** Writes bytes through the already-open temporary descriptor. */
export function writeContainedTemporaryFile(file: ContainedTemporaryFile, content: Uint8Array): void {
  // The S2 caller encodes text exactly once with Buffer.from(text, 'utf8').
  // Preserve those bytes without reinterpreting them as a host pathname/string.
  loadNativeContainedDurableReplace().writeContainedTemporaryFile(file.nativeTemporaryFile, Buffer.from(content))
}

/**
 * Re-inspects the existing no-follow target and applies its `mode & 0777` to
 * the still-open, descriptor-created candidate. It never accepts a missing,
 * linked, or non-regular target at the native boundary. It deliberately does
 * not retain or compare target identity/version: restricted overwrite is non-CAS.
 */
export function prepareContainedRestrictedOverwriteCandidate(
  directory: ContainedDurableDirectory,
  file: ContainedTemporaryFile,
  filename: string
): void {
  if (!isSafeBasename(filename)) throw new Error('Contained restricted-overwrite filename is invalid.')
  loadNativeContainedDurableReplace().prepareContainedRestrictedOverwriteCandidate(
    directory.nativeDirectory,
    file.nativeTemporaryFile,
    filename
  )
}

/**
 * Exchanges a prepared, checked-closed candidate with the pre-inspected
 * existing leaf using RENAME_SWAP/RENAME_EXCHANGE only. A return from this
 * primitive is the sole internal publication marker.
 */
export function swapContainedRestrictedOverwriteAtContainedDirectory(
  directory: ContainedDurableDirectory,
  file: ContainedTemporaryFile,
  temporaryName: string,
  filename: string
): void {
  if (!isSafeBasename(temporaryName) || !isSafeBasename(filename)) {
    throw new Error('Contained restricted-overwrite filenames are invalid.')
  }
  loadNativeContainedDurableReplace().swapContainedRestrictedOverwriteAtContainedDirectory(
    directory.nativeDirectory,
    file.nativeTemporaryFile,
    temporaryName,
    filename
  )
}

/** fsyncs the already-open temporary descriptor. */
export function syncContainedTemporaryFile(file: ContainedTemporaryFile): void {
  loadNativeContainedDurableReplace().syncContainedTemporaryFile(file.nativeTemporaryFile)
}

/** Checked close of the temporary descriptor; no retry occurs after failure. */
export function closeContainedTemporaryFileChecked(file: ContainedTemporaryFile): void {
  loadNativeContainedDurableReplace().closeContainedTemporaryFileChecked(file.nativeTemporaryFile)
}

/**
 * Atomically publishes the temporary candidate only if the final leaf is still
 * absent. Native uses renameatx_np(RENAME_EXCL) or renameat2(RENAME_NOREPLACE)
 * and fails closed when unavailable.
 */
export function publishNoOverwriteAtContainedDirectory(
  directory: ContainedDurableDirectory,
  temporaryName: string,
  filename: string
): void {
  if (!isSafeBasename(temporaryName) || !isSafeBasename(filename)) {
    throw new Error('Contained create-no-overwrite publication filename is invalid.')
  }
  loadNativeContainedDurableReplace().publishNoOverwriteAtContainedDirectory(
    directory.nativeDirectory,
    temporaryName,
    filename
  )
}

/** Removes a descriptor-relative temporary candidate with unlinkat(2). */
export function removeContainedDirectoryEntry(directory: ContainedDurableDirectory, name: string): void {
  if (!isSafeBasename(name)) throw new Error('Contained directory entry name is invalid.')
  loadNativeContainedDurableReplace().removeContainedDirectoryEntry(directory.nativeDirectory, name)
}

/**
 * Publication-only directory sync. It owns the exact five-code durability
 * downgrade and returns only the safe semantic result, never raw I/O detail.
 */
export function syncContainedDirectoryForPublication(
  directory: ContainedDurableDirectory
): { directorySyncUnsupported: boolean } {
  return loadNativeContainedDurableReplace().syncContainedDirectoryForPublication(directory.nativeDirectory)
}

/** Checked close used by an owned P8 request descriptor. */
export function closeContainedDurableDirectoryChecked(directory: ContainedDurableDirectory): void {
  loadNativeContainedDurableReplace().closeContainedDirectoryChecked(directory.nativeDirectory)
}

export function closeContainedDurableDirectory(directory: ContainedDurableDirectory): void {
  loadNativeContainedDurableReplace().closeContainedDirectory(directory.nativeDirectory)
}

/**
 * Parses a workspace target without using the host pathname normalizer. Both
 * slash forms are separators, preventing a display path from diverging from
 * the components later supplied to openat(2).
 */
export function parseWorkspaceContainedRelativePath(value: string): WorkspaceContainedRelativePath {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new WorkspaceContainedDirectoryError('invalid_relative_path', 'Workspace relative path is empty or contains a NUL byte.')
  }
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new WorkspaceContainedDirectoryError('invalid_relative_path', 'Workspace relative path must not be absolute.')
  }

  const components = value.split(/[\\/]+/)
  if (components.length === 0 || components.some((component) => component.length === 0 || component === '.' || component === '..')) {
    throw new WorkspaceContainedDirectoryError('invalid_relative_path', 'Workspace relative path contains an unsafe traversal component.')
  }

  const basename = components.at(-1)
  if (!basename || !isSafeBasename(basename)) {
    throw new WorkspaceContainedDirectoryError('invalid_relative_path', 'Workspace relative path has an unsafe basename.')
  }
  return {
    relativePath: components.join('/'),
    parentComponents: components.slice(0, -1),
    basename
  }
}

/** Short alias for the workspace-relative parser. */
export const parseWorkspaceRelativePath = parseWorkspaceContainedRelativePath
/** Alias emphasizing that the result is a safe descriptor-relative target. */
export const parseWorkspaceRelativePathForContainedDirectory = parseWorkspaceContainedRelativePath

/**
 * Binds an existing trusted workspace root, then opens or creates only the
 * parsed parent components beneath its retained descriptor. There is no
 * pathname fallback after the root has been bound.
 */
export function bindWorkspaceContainedPath(input: BindWorkspaceContainedPathInput): WorkspaceContainedPathBinding {
  const target = parseWorkspaceContainedRelativePath(input.relativePath)
  const capability = getContainedDurableDirectoryCapability()
  if (!capability.available) {
    throw new WorkspaceContainedDirectoryError(
      'descriptor_capability_unavailable',
      'Descriptor-relative workspace containment is unavailable on this host.'
    )
  }

  let current: ContainedDurableDirectory
  try {
    // S1 binds only an already-existing workspace root. It never creates a
    // workspace root from an untrusted target pathname.
    current = openContainedRootDirectory(input.workspaceRootPath, false)
  } catch (cause) {
    throw new WorkspaceContainedDirectoryError(
      'workspace_root_bind_failed',
      'Unable to bind the existing trusted workspace root.',
      cause
    )
  }

  const operations: WorkspaceContainedDirectoryOperations = {
    ...defaultWorkspaceContainedDirectoryOperations,
    ...input.operations
  }
  const createParentDirectories = input.createParentDirectories === true
  let currentNeedsCleanup = true
  try {
    for (const component of target.parentComponents) {
      input.onOperation?.({ type: 'open_or_create_component', component, createIfMissing: createParentDirectories })
      let child: ContainedDurableDirectory
      try {
        child = operations.openOrCreateComponent(current, component, createParentDirectories)
      } catch (cause) {
        throw new WorkspaceContainedDirectoryError(
          'parent_component_open_failed',
          'Unable to open or create a workspace parent directory component.',
          cause
        )
      }
      let currentCloseAttempted = false
      try {
        input.onOperation?.({ type: 'close_directory' })
        currentCloseAttempted = true
        operations.closeDirectory(current)
      } catch (cause) {
        if (currentCloseAttempted) {
          // A checked close has already been attempted for this descriptor; never retry it in outer cleanup.
          currentNeedsCleanup = false
        }
        try {
          operations.closeDirectory(child)
        } catch {
          // The original checked-close failure remains the useful foundation error.
        }
        throw new WorkspaceContainedDirectoryError(
          'directory_close_failed',
          'Unable to close a superseded workspace parent directory descriptor.',
          cause
        )
      }
      current = child
    }
  } catch (error) {
    if (currentNeedsCleanup) {
      try {
        input.onOperation?.({ type: 'close_directory' })
        operations.closeDirectory(current)
      } catch {
        // Do not hide the traversal failure with cleanup detail.
      }
    }
    throw error
  }

  let closed = false
  return {
    ...target,
    parentDirectory: current,
    inspectLeaf: () => {
      ensureWorkspaceBindingOpen(closed)
      input.onOperation?.({ type: 'inspect_leaf', basename: target.basename })
      try {
        return operations.inspectLeaf(current, target.basename)
      } catch (cause) {
        throw new WorkspaceContainedDirectoryError(
          'leaf_inspection_failed',
          'Unable to inspect the workspace target leaf.',
          cause
        )
      }
    },
    syncParentDirectory: () => {
      ensureWorkspaceBindingOpen(closed)
      input.onOperation?.({ type: 'sync_directory' })
      try {
        operations.syncDirectory(current)
      } catch (cause) {
        throw new WorkspaceContainedDirectoryError(
          'directory_sync_failed',
          'Unable to sync the workspace target parent directory.',
          cause
        )
      }
    },
    close: () => {
      if (closed) return
      closed = true
      input.onOperation?.({ type: 'close_directory' })
      try {
        operations.closeDirectory(current)
      } catch (cause) {
        throw new WorkspaceContainedDirectoryError(
          'directory_close_failed',
          'Unable to close the workspace target parent directory descriptor.',
          cause
        )
      }
    }
  }
}

/** Alias for callers that want to make the trusted-root boundary explicit. */
export const bindTrustedWorkspaceContainedPath = bindWorkspaceContainedPath
/** Alias using the target-opening vocabulary used by later descriptor-only stages. */
export const openWorkspaceContainedPath = bindWorkspaceContainedPath

/** Performs one typed no-follow final-leaf inspection below a retained descriptor. */
export function inspectWorkspaceContainedLeaf(
  directory: ContainedDurableDirectory,
  basename: string,
  operations: Pick<WorkspaceContainedDirectoryOperations, 'inspectLeaf'> = defaultWorkspaceContainedDirectoryOperations
): WorkspaceContainedLeaf {
  if (!isSafeBasename(basename)) {
    throw new WorkspaceContainedDirectoryError('invalid_relative_path', 'Workspace target leaf basename is invalid.')
  }
  try {
    return operations.inspectLeaf(directory, basename)
  } catch (cause) {
    throw new WorkspaceContainedDirectoryError('leaf_inspection_failed', 'Unable to inspect the workspace target leaf.', cause)
  }
}

/** Explicit descriptor-directory fsync with the S1 typed internal error boundary. */
export function syncWorkspaceContainedDirectory(
  directory: ContainedDurableDirectory,
  operations: Pick<WorkspaceContainedDirectoryOperations, 'syncDirectory'> = defaultWorkspaceContainedDirectoryOperations
): void {
  try {
    operations.syncDirectory(directory)
  } catch (cause) {
    throw new WorkspaceContainedDirectoryError('directory_sync_failed', 'Unable to sync the workspace directory.', cause)
  }
}

/** Checked descriptor close with the S1 typed internal error boundary. */
export function closeWorkspaceContainedDirectory(
  directory: ContainedDurableDirectory,
  operations: Pick<WorkspaceContainedDirectoryOperations, 'closeDirectory'> = defaultWorkspaceContainedDirectoryOperations
): void {
  try {
    operations.closeDirectory(directory)
  } catch (cause) {
    throw new WorkspaceContainedDirectoryError('directory_close_failed', 'Unable to close the workspace directory.', cause)
  }
}

function ensureWorkspaceBindingOpen(closed: boolean): void {
  if (closed) {
    throw new WorkspaceContainedDirectoryError('directory_close_failed', 'Workspace target parent directory descriptor is already closed.')
  }
}

const defaultWorkspaceContainedDirectoryOperations: WorkspaceContainedDirectoryOperations = {
  openOrCreateComponent(parent, component, createIfMissing) {
    return {
      nativeDirectory: loadNativeContainedDurableReplace().openContainedWorkspaceDirectoryChild(
        parent.nativeDirectory,
        component,
        createIfMissing
      )
    }
  },
  inspectLeaf(parent, basename) {
    const inspected = loadNativeContainedDurableReplace().inspectContainedDirectoryLeaf(parent.nativeDirectory, basename)
    switch (inspected.type) {
      case 'absent':
        return { type: 'absent' }
      case 'regular':
        return { type: 'regular', mode: inspected.mode, linkCount: inspected.linkCount }
      case 'directory':
        return { type: 'directory' }
      case 'symlink':
        return { type: 'symlink' }
      default:
        return { type: 'other' }
    }
  },
  syncDirectory(directory) {
    loadNativeContainedDurableReplace().syncContainedDirectory(directory.nativeDirectory)
  },
  closeDirectory(directory) {
    loadNativeContainedDurableReplace().closeContainedDirectoryChecked(directory.nativeDirectory)
  }
}

export function isNativeContainedDurableReplaceUnavailable(
  error: unknown
): error is NativeContainedDurableReplaceUnavailableError {
  return error instanceof NativeContainedDurableReplaceUnavailableError
}

function canonicalizeConfiguredRoot(rootPath: string): { physicalParentPath: string; rootName: string } {
  if (!isSafeRootPath(rootPath)) throw new Error('Contained root directory path is invalid.')
  const logicalRootPath = resolve(rootPath)
  const rootName = basename(logicalRootPath)
  if (!isSafeBasename(rootName)) throw new Error('Contained root directory path is invalid.')

  let physicalParentPath: string
  try {
    // Do not fall back to the logical pathname: a canonical parent is the
    // explicit configured-root boundary required before native binding.
    physicalParentPath = realpathSync.native(dirname(logicalRootPath))
  } catch {
    throw new Error('Configured contained root parent directory cannot be canonicalized.')
  }
  if (!isAbsolute(physicalParentPath) || !isSafeRootPath(physicalParentPath)) {
    throw new Error('Configured contained root parent directory is invalid.')
  }
  return { physicalParentPath, rootName }
}

function isSafeRootPath(value: string): boolean {
  return value.trim().length > 0 && !value.includes('\0')
}

function isSafeBasename(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
}

function isHostBuiltPosixPlatform(platform: NodeJS.Platform): boolean {
  // The addon is built in the packaging host and is verified only for the
  // POSIX targets we ship. Other platforms fail closed rather than attempting
  // to load a possibly incompatible native artifact.
  return platform === 'darwin' || platform === 'linux'
}

function loadNativeContainedDurableReplace(
  resolver?: NativeContainedDurableReplaceResolverInput
): NativeContainedDurableReplace {
  if (!isHostBuiltPosixPlatform(process.platform)) {
    throw new NativeContainedDurableReplaceUnavailableError('unsupported_platform')
  }
  if (loadedNative) return loadedNative

  try {
    const require = createRequire(import.meta.url)
    loadedNative = require(resolveContainedDurableReplaceAddonPath(resolver)) as NativeContainedDurableReplace
    return loadedNative
  } catch (error) {
    throw new NativeContainedDurableReplaceUnavailableError('native_unavailable', error)
  }
}

function findUnpackagedProjectRoot(moduleUrl: string): string {
  let current = dirname(fileURLToPath(moduleUrl))
  while (dirname(current) !== current) {
    if (existsSync(join(current, 'package.json'))) return current
    current = dirname(current)
  }
  throw new NativeContainedDurableReplaceUnavailableError('native_unavailable')
}
