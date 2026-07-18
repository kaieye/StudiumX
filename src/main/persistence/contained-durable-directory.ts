import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type NativeContainedDurableReplace = {
  openContainedDirectory: (rootPath: string, firstComponent: string, secondComponent: string) => unknown
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

export type ContainedDurableDirectory = {
  readonly nativeDirectory: unknown
}

class NativeContainedDurableReplaceUnavailableError extends Error {
  readonly reason: NativeContainedDurableReplaceUnavailableReason

  constructor(reason: NativeContainedDurableReplaceUnavailableReason, cause?: unknown) {
    super(
      reason === 'unsupported_platform'
        ? 'Descriptor-relative C-2C publication is unavailable on this platform.'
        : 'The optional descriptor-relative C-2C native capability is unavailable.',
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
 * C-2C is deliberately optional: only a host-built POSIX addon is supported.
 * Windows returns a narrow capability result and never falls back to pathname
 * traversal. Calling this function is the first point that may load the addon.
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

/**
 * Opens the fixed C-2C output directory as a native directory capability.
 * The native implementation traverses each component with no-follow semantics
 * and retains the output directory descriptor for later relative operations.
 */
export function openContainedDurableDirectory(rootPath: string): ContainedDurableDirectory {
  return {
    nativeDirectory: loadNativeContainedDurableReplace().openContainedDirectory(
      rootPath,
      '.studiumx',
      'conversation-projections'
    )
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
    ;(input.warn ?? console.warn)('[StudiumX] A required C-2C directory fsync is unsupported; publication completed under the documented durability downgrade.')
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

function isSafeBasename(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
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
