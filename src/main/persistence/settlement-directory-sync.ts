/**
 * C-4P6 Phase 1 shared directory-sync policy for settlement publishers.
 *
 * Soft-unsupported errno allowlist and Windows production skip rules live here
 * so pathname durable-file and ledger can share one mapping without a module
 * cycle against replaceDurably (see ADR-0002).
 */
import { open } from 'node:fs/promises'

export const SETTLEMENT_DIRECTORY_FSYNC_UNSUPPORTED_CODES = [
  'EINVAL',
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EISDIR'
] as const

export type SettlementDirectorySyncResult = 'synced' | 'unsupported'

type DirectoryOpen = (path: string, flags: string, mode?: number) => Promise<{
  sync: () => Promise<void>
  close: () => Promise<void>
}>

export type SettlementDirectorySyncOptions = {
  directoryPath: string
  /**
   * When true, treat production Windows as unsupported without opening a handle.
   * Injected operation seams must keep this false so permission/I/O faults stay strict.
   */
  allowWindowsProductionSkip?: boolean
  operations?: { open?: DirectoryOpen }
  warn?: (message: string) => void
  warningMessage?: string
}

const DEFAULT_DIRECTORY_FSYNC_WARNING =
  '[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'

export function isSettlementDirectoryFsyncUnsupported(error: unknown): boolean {
  if (!isErrno(error)) return false
  return (SETTLEMENT_DIRECTORY_FSYNC_UNSUPPORTED_CODES as readonly string[]).includes(error.code ?? '')
}

/**
 * Syncs a parent directory under the settlement durability policy.
 * Permission and unknown I/O failures remain fatal; only the frozen unsupported
 * errno allowlist (and production Windows skip) may return `unsupported`.
 */
export async function syncSettlementDirectory(
  options: SettlementDirectorySyncOptions
): Promise<SettlementDirectorySyncResult> {
  const openFn = options.operations?.open ?? open
  const usingDefaultOpen = openFn === open
  if (options.allowWindowsProductionSkip && usingDefaultOpen && process.platform === 'win32') {
    ;(options.warn ?? console.warn)(options.warningMessage ?? DEFAULT_DIRECTORY_FSYNC_WARNING)
    return 'unsupported'
  }

  let handle: Awaited<ReturnType<DirectoryOpen>> | undefined
  try {
    handle = await openFn(options.directoryPath, 'r')
    await handle.sync()
    return 'synced'
  } catch (error) {
    if (isSettlementDirectoryFsyncUnsupported(error)) {
      ;(options.warn ?? console.warn)(options.warningMessage ?? DEFAULT_DIRECTORY_FSYNC_WARNING)
      return 'unsupported'
    }
    throw error
  } finally {
    if (handle) await handle.close()
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
