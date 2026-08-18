import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { syncSettlementDirectory } from './settlement-directory-sync'

export type DurableFileValidator<T> = (value: unknown) => value is T

type DurableFileHandle = {
  writeFile: (data: string | Uint8Array) => Promise<void>
  sync: () => Promise<void>
  close: () => Promise<void>
}

export type DurableFileOperations = {
  mkdir: typeof mkdir
  open: (path: string, flags: string, mode?: number) => Promise<DurableFileHandle>
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>
  rename: typeof rename
  rm: typeof rm
}

const defaultOperations: DurableFileOperations = { mkdir, open, readFile, rename, rm }
const PRIVATE_FILE_MODE = 0o600
const replaceWithBackupQueues = new Map<string, Promise<void>>()

export type DurablePathReplaceOptions = {
  path: string
  content: string | Uint8Array
  /**
   * Explicit create mode for the `replaceDurably()` path variant only. It is
   * applied to the same-directory temporary candidate before rename, so the
   * process umask retains its usual effect. Absent an explicit mode,
   * `replaceDurably()` remains private (0600). `replaceWithBackup()` always
   * normalizes its canonical files, backups, and candidates to private 0600.
   */
  mode?: number
  operations?: DurableFileOperations
  warn?: (message: string) => void
  /**
   * Optional seam after parent mkdir and before temporary creation.
   * Used by C-2C projection instrumentation; not a CAS boundary.
   */
  onDirectoryBound?: () => void | Promise<void>
}

/** Pathname-only replace options (ADR-0012). Contained/directory variant removed. */
export type DurableReplaceOptions = DurablePathReplaceOptions

export type ReplaceWithBackupOptions<T> = DurablePathReplaceOptions & {
  validate: DurableFileValidator<T>
}

export type ValidatedFileRead<T> = {
  value: T | null
  content: string | null
  source: 'canonical' | 'backup' | null
  canonicalStatus: 'valid' | 'missing' | 'invalid'
  backupStatus: 'valid' | 'missing' | 'invalid' | 'not-read'
}

export type ReadValidatedWithBackupOptions<T> = {
  path: string
  validate: DurableFileValidator<T>
  operations?: DurableFileOperations
}

/**
 * Replaces one file with a same-directory, private temporary file. The new
 * contents are synced before publication and the containing directory is
 * synced after the rename. It intentionally has no backup behavior.
 */
/**
 * Pathname-default durable replace (ADR-0012): temp → write → optional fsync → rename.
 * On Windows, rename cannot overwrite an existing leaf; unlink-then-rename once.
 * Deliberately non-CAS; no native contained_durable_replace dependency.
 */
export async function replaceDurably(options: DurableReplaceOptions): Promise<void> {
  const operations = options.operations ?? defaultOperations
  await operations.mkdir(dirname(options.path), { recursive: true })
  if (options.onDirectoryBound) await options.onDirectoryBound()
  const temporaryPath = temporaryPathFor(options.path)
  try {
    await writeSyncedFile(temporaryPath, options.content, operations, options.mode ?? PRIVATE_FILE_MODE)
    await renameIntoPlace(temporaryPath, options.path, operations)
    await syncDirectory(dirname(options.path), operations, options.warn)
  } catch (error) {
    await cleanupUnpublishedTemporary(temporaryPath, operations)
    throw error
  }
}

/**
 * Replaces critical JSON state while retaining the last validator-approved
 * canonical document as `<path>.bak`. No backup is created for a first write.
 * Replacements for the same canonical target are serialized so that the
 * retained backup is always the immediate predecessor of the published file.
 */
export function replaceWithBackup<T>(options: ReplaceWithBackupOptions<T>): Promise<void> {
  const next = parseAndValidate(options.content, options.validate)
  if (!next.valid) return Promise.reject(new Error('Refusing to publish JSON state that does not satisfy its durable-file validator.'))

  const queueKey = resolve(options.path)
  const previous = replaceWithBackupQueues.get(queueKey) ?? Promise.resolve()
  const replacement = previous
    .catch(() => undefined)
    .then(() => replaceWithBackupUnserialized(options))

  replaceWithBackupQueues.set(queueKey, replacement)
  return replacement.finally(() => {
    if (replaceWithBackupQueues.get(queueKey) === replacement) replaceWithBackupQueues.delete(queueKey)
  })
}

async function replaceWithBackupUnserialized<T>(options: ReplaceWithBackupOptions<T>): Promise<void> {
  const operations = options.operations ?? defaultOperations
  await operations.mkdir(dirname(options.path), { recursive: true })
  const canonicalTemporaryPath = temporaryPathFor(options.path)
  try {
    await writePrivateSyncedFile(canonicalTemporaryPath, options.content, operations)

    const prior = await readValidatedJson(options.path, options.validate, operations)
    if (prior.status === 'valid') {
      const backupTemporaryPath = temporaryPathFor(`${options.path}.bak`)
      try {
        await writePrivateSyncedFile(backupTemporaryPath, prior.content, operations)
        await replaceBackupSafely(`${options.path}.bak`, backupTemporaryPath, operations, options.warn)
      } catch (error) {
        await cleanupUnpublishedTemporary(backupTemporaryPath, operations)
        throw error
      }
    }

    await renameIntoPlace(canonicalTemporaryPath, options.path, operations)
    await syncDirectory(dirname(options.path), operations, options.warn)
  } catch (error) {
    await cleanupUnpublishedTemporary(canonicalTemporaryPath, operations)
    throw error
  }
}

/**
 * Reads canonical JSON first. A `.bak` is considered only when canonical is
 * absent, unparsable, or rejected by the domain validator. Permission and I/O
 * failures deliberately propagate rather than silently selecting a backup.
 */
export async function readValidatedWithBackup<T>(
  options: ReadValidatedWithBackupOptions<T>
): Promise<ValidatedFileRead<T>> {
  const operations = options.operations ?? defaultOperations
  const canonical = await readValidatedJson(options.path, options.validate, operations)
  if (canonical.status === 'valid') {
    return {
      value: canonical.value,
      content: canonical.content,
      source: 'canonical',
      canonicalStatus: 'valid',
      backupStatus: 'not-read'
    }
  }

  const backup = await readValidatedJson(`${options.path}.bak`, options.validate, operations)
  if (backup.status === 'valid') {
    return {
      value: backup.value,
      content: backup.content,
      source: 'backup',
      canonicalStatus: canonical.status,
      backupStatus: 'valid'
    }
  }

  return {
    value: null,
    content: null,
    source: null,
    canonicalStatus: canonical.status,
    backupStatus: backup.status
  }
}

async function readValidatedJson<T>(
  path: string,
  validate: DurableFileValidator<T>,
  operations: DurableFileOperations
): Promise<{ status: 'valid'; value: T; content: string } | { status: 'missing' | 'invalid' }> {
  let content: string
  try {
    content = await operations.readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return { status: 'missing' }
    throw error
  }
  const parsed = parseAndValidate(content, validate)
  return parsed.valid
    ? { status: 'valid', value: parsed.value, content }
    : { status: 'invalid' }
}

function parseAndValidate<T>(content: string | Uint8Array, validate: DurableFileValidator<T>): { valid: true; value: T } | { valid: false } {
  try {
    const parsed = JSON.parse(typeof content === 'string' ? content : Buffer.from(content).toString('utf8')) as unknown
    return validate(parsed) ? { valid: true, value: parsed } : { valid: false }
  } catch {
    return { valid: false }
  }
}

async function writePrivateSyncedFile(
  path: string,
  content: string | Uint8Array,
  operations: DurableFileOperations
): Promise<void> {
  return writeSyncedFile(path, content, operations, PRIVATE_FILE_MODE)
}

async function writeSyncedFile(
  path: string,
  content: string | Uint8Array,
  operations: DurableFileOperations,
  mode: number
): Promise<void> {
  const handle = await operations.open(path, 'wx', mode)
  let writeFailure: unknown
  try {
    await handle.writeFile(content)
    await handle.sync()
  } catch (error) {
    writeFailure = error
    throw error
  } finally {
    try {
      await handle.close()
    } catch (closeError) {
      if (!writeFailure) throw closeError
    }
  }
}

async function replaceBackupSafely(
  backupPath: string,
  candidatePath: string,
  operations: DurableFileOperations,
  warn: DurableReplaceOptions['warn']
): Promise<void> {
  const previousBackupPath = temporaryPathFor(`${backupPath}.previous`)
  let previousBackupMoved = false
  try {
    try {
      await operations.rename(backupPath, previousBackupPath)
      previousBackupMoved = true
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }

    await operations.rename(candidatePath, backupPath)

    await syncDirectory(dirname(backupPath), operations, warn)
    if (previousBackupMoved) await operations.rm(previousBackupPath, { force: true }).catch(() => undefined)
  } catch (error) {
    if (previousBackupMoved) {
      await restorePreviousBackup(backupPath, previousBackupPath, operations, warn).catch(() => undefined)
    }
    throw error
  }
}

async function restorePreviousBackup(
  backupPath: string,
  previousBackupPath: string,
  operations: DurableFileOperations,
  warn: DurableReplaceOptions['warn']
): Promise<void> {
  await operations.rm(backupPath, { force: true }).catch(() => undefined)
  await operations.rename(previousBackupPath, backupPath)
  await syncDirectory(dirname(backupPath), operations, warn)
}

async function syncDirectory(
  directoryPath: string,
  operations: DurableFileOperations,
  warn: DurableReplaceOptions['warn']
): Promise<void> {
  // Shared settlement directory-sync policy (ADR-0002):
  // production Windows may skip only on the default open seam; injected
  // operations remain strict so permission/I/O faults stay fatal.
  await syncSettlementDirectory({
    directoryPath,
    operations,
    warn,
    allowWindowsProductionSkip: operations === defaultOperations
  })
}

/**
 * Rename temporary → canonical. On Windows, rename cannot replace an existing
 * file; unlink the target once and retry. Intentionally non-CAS.
 */
async function renameIntoPlace(
  temporaryPath: string,
  path: string,
  operations: DurableFileOperations
): Promise<void> {
  try {
    await operations.rename(temporaryPath, path)
  } catch (error) {
    if (process.platform !== 'win32') throw error
    const code = isErrno(error) ? error.code : undefined
    if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EACCES') throw error
    await operations.rm(path, { force: true })
    await operations.rename(temporaryPath, path)
  }
}

function temporaryPathFor(path: string): string {
  return join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
}

async function cleanupUnpublishedTemporary(path: string, operations: DurableFileOperations): Promise<void> {
  await operations.rm(path, { force: true }).catch(() => undefined)
}

function isMissingFile(error: unknown): boolean {
  return isErrno(error) && error.code === 'ENOENT'
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

/**
 * C-2C projection capability under pathname-default durable I/O (ADR-0012).
 * Always available; there is no native-addon gate.
 */
export function getC2CProjectionOutputDirectoryCapability(): { available: true } {
  return { available: true }
}

/** Historical no-op: pathname publication does not retain open directory handles. */
export function closeC2CProjectionOutputDirectory(_directory?: unknown): void {
  // no-op
}

/**
 * Historical compatibility export. Prefer path-based `replaceDurably({ path })`.
 */
export function openC2CProjectionOutputDirectory(rootPath: string): { rootPath: string } {
  return { rootPath }
}
