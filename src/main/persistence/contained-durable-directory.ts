import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type NativeContainedDirectoryEntry = {
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other'
}

type NativeContainedDurableReplace = {
  openContainedRootDirectory: (physicalParentPath: string, rootName: string, createIfMissing: boolean) => unknown
  openContainedDirectoryChild: (directory: unknown, name: string, createIfMissing: boolean) => unknown
  listContainedDirectory: (directory: unknown) => NativeContainedDirectoryEntry[]
  readRegularFileAtContainedDirectory: (directory: unknown, filename: string) => Buffer
  replaceAtContainedDirectory: (
    directory: unknown,
    filename: string,
    temporaryName: string,
    content: Buffer
  ) => Promise<{ directorySyncUnsupported: boolean }>
  closeContainedDirectory: (directory: unknown) => void
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

export function closeContainedDurableDirectory(directory: ContainedDurableDirectory): void {
  loadNativeContainedDurableReplace().closeContainedDirectory(directory.nativeDirectory)
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
  return platform !== 'win32'
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
