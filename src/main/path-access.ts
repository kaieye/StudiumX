import { Buffer, kMaxLength } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import * as fs from 'node:fs/promises'
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export function isLexicallyInsideRoot(rootPath: string, targetPath: string): boolean {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

/** Backward-compatible lexical containment check. Use isRealPathInsideRoot when symlinks matter. */
export function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  return isLexicallyInsideRoot(rootPath, targetPath)
}

export function isPathInsideConfiguredRoot(rootPath: string, targetPath: string): boolean {
  return rootPath.trim().length > 0 && isPathInsideRoot(rootPath, targetPath)
}

export async function isRealPathInsideRoot(rootPath: string, targetPath: string): Promise<boolean> {
  if (rootPath.trim().length === 0) return false
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
    return isPathInsideRoot(realRoot, realTarget)
  } catch {
    return false
  }
}

export async function assertRealPathInsideRoot(rootPath: string, targetPath: string): Promise<void> {
  if (!(await isRealPathInsideRoot(rootPath, targetPath))) {
    throw new Error('Path escapes the configured root after resolving symlinks.')
  }
}

/**
 * Reads an existing regular file without following a final symlink and only
 * after its resolved path has been proven to remain under the configured root.
 */
export async function readContainedRegularFile(rootPath: string, targetPath: string): Promise<Buffer> {
  return readFile(await resolveContainedRegularFile(rootPath, targetPath))
}

export type BoundedContainedRegularFileRead =
  | { status: 'ok', content: Buffer }
  | { status: 'over_limit' }

/**
 * Reads at most maxBytes from an existing contained regular file. It proves
 * containment before opening the resolved file and never calls readFile for a
 * potentially oversized artifact.
 */
export async function readContainedRegularFileBounded(
  rootPath: string,
  targetPath: string,
  maxBytes: number
): Promise<BoundedContainedRegularFileRead> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes >= kMaxLength) {
    throw new Error('Bounded file read limit must be a non-negative safe buffer length.')
  }

  // `open(path)` cannot bind every traversed Windows/POSIX path component to a
  // directory handle. Instead, after preflight we atomically hard-link the
  // candidate into a new private directory under the trusted root and verify
  // the linked inode/file-ID against the captured regular file *before* any
  // bytes are opened. A final-file or parent reparse swap can only link a
  // different object, which fails the identity check; the original path is
  // never opened for content after it has been checked.
  const before = await captureContainedRegularFile(rootPath, targetPath)
  const snapshotDirectory = await mkdtemp(join(resolve(rootPath), '.studiumx-bounded-read-'))
  const snapshotPath = join(snapshotDirectory, 'artifact')
  try {
    const snapshotDirectoryInfo = await lstat(snapshotDirectory)
    if (snapshotDirectoryInfo.isSymbolicLink() || !snapshotDirectoryInfo.isDirectory()) {
      throw new Error('Bounded read snapshot directory is unsafe.')
    }
    await fs.link(before.targetPath, snapshotPath)
    const linked = await lstat(snapshotPath)
    assertSameRegularFile(before.file, linked, 'Final file identity changed before it could be snapshotted.')

    const handle = await open(snapshotPath, 'r')
    try {
      const handleBefore = await handle.stat()
      assertSameRegularFile(linked, handleBefore, 'Bounded read snapshot identity changed before it could be read.')
      if (handleBefore.size > maxBytes) return { status: 'over_limit' }

      const content = await readFileHandleBounded(handle, maxBytes)
      const handleAfter = await handle.stat()
      assertSameRegularFile(handleBefore, handleAfter, 'Bounded read snapshot changed while it was being read.')
      if (handleAfter.size > maxBytes || content.byteLength > maxBytes) return { status: 'over_limit' }

      const after = await captureContainedRegularFile(rootPath, targetPath)
      if (!sameContainedDirectoryChain(before.directories, after.directories)) {
        throw new Error('Contained directory identity changed while the file was being read.')
      }
      assertSameRegularFile(linked, after.file, 'Final file identity changed while it was being read.')
      return { status: 'ok', content }
    } finally {
      await handle.close()
    }
  } finally {
    await rm(snapshotDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

type DirectoryIdentity = {
  path: string
  dev: number
  ino: number
}

type ContainedRegularFileIdentity = {
  targetPath: string
  directories: DirectoryIdentity[]
  file: Stats
}

async function captureContainedRegularFile(rootPath: string, targetPath: string): Promise<ContainedRegularFileIdentity> {
  const absoluteRoot = resolve(rootPath)
  const absoluteTarget = resolve(targetPath)
  assertLexicallyInsideRoot(absoluteRoot, absoluteTarget)

  const relation = relative(absoluteRoot, absoluteTarget)
  const parts = relation.split(sep).filter(Boolean)
  if (parts.length === 0) throw new Error('Final path must name a regular file below the configured root.')

  const directories: DirectoryIdentity[] = []
  let current = absoluteRoot
  for (let index = 0; index < parts.length - 1; index += 1) {
    const info = await lstat(current)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Contained path must not contain a symbolic link or junction.')
    }
    directories.push({ path: current, dev: info.dev, ino: info.ino })
    current = join(current, parts[index]!)
  }
  const parentInfo = await lstat(current)
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) {
    throw new Error('Contained path must not contain a symbolic link or junction.')
  }
  directories.push({ path: current, dev: parentInfo.dev, ino: parentInfo.ino })

  const file = await lstat(absoluteTarget)
  if (file.isSymbolicLink() || !file.isFile()) {
    throw new Error('Final path must be a regular file.')
  }

  const [realRoot, realTarget] = await Promise.all([realpath(absoluteRoot), realpath(absoluteTarget)])
  if (!isPathInsideRoot(realRoot, realTarget)) {
    throw new Error('Path escapes the configured root after resolving symlinks.')
  }
  return { targetPath: absoluteTarget, directories, file }
}

function assertSameRegularFile(expected: Stats, actual: Stats, message: string): void {
  if (!actual.isFile() || !sameFileIdentity(expected, actual) || expected.size !== actual.size || expected.mtimeMs !== actual.mtimeMs) {
    throw new Error(message)
  }
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameContainedDirectoryChain(left: DirectoryIdentity[], right: DirectoryIdentity[]): boolean {
  return left.length === right.length && left.every((expected, index) => {
    const current = right[index]
    return current !== undefined && expected.path === current.path && expected.dev === current.dev && expected.ino === current.ino
  })
}

async function readFileHandleBounded(handle: Awaited<ReturnType<typeof open>>, maxBytes: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(maxBytes + 1)
  let offset = 0
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

async function resolveContainedRegularFile(rootPath: string, targetPath: string): Promise<string> {
  assertLexicallyInsideRoot(rootPath, targetPath)
  await assertFinalRegularFile(targetPath)
  const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  if (!isPathInsideRoot(realRoot, realTarget)) {
    throw new Error('Path escapes the configured root after resolving symlinks.')
  }
  return realTarget
}

/**
 * Materializes immutable content-addressed content. Existing identical files
 * are accepted, while symlinks, non-files, and digest conflicts are rejected.
 */
export async function writeContentAddressedFile(input: {
  rootPath: string
  targetPath: string
  content: string | Buffer
  sha256: string
}): Promise<void> {
  const content = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content
  const actualSha256 = createHash('sha256').update(content).digest('hex')
  if (actualSha256 !== input.sha256) {
    throw new Error('Content-addressed file digest does not match its content.')
  }

  assertLexicallyInsideRoot(input.rootPath, input.targetPath)
  await ensureContainedDirectory(input.rootPath, dirname(input.targetPath))

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await readExistingContainedFile(input.rootPath, input.targetPath)
    if (existing !== null) {
      const existingSha256 = createHash('sha256').update(existing).digest('hex')
      if (existingSha256 === input.sha256 && existing.equals(content)) return
      throw new Error('Content-addressed file already exists with different content.')
    }

    try {
      const handle = await open(input.targetPath, 'wx', 0o600)
      try {
        await handle.writeFile(content)
      } finally {
        await handle.close()
      }
      return
    } catch (error) {
      if (isErrnoException(error, 'EEXIST')) continue
      throw error
    }
  }

  const existing = await readExistingContainedFile(input.rootPath, input.targetPath)
  if (existing !== null) {
    const existingSha256 = createHash('sha256').update(existing).digest('hex')
    if (existingSha256 === input.sha256 && existing.equals(content)) return
  }
  throw new Error('Content-addressed file could not be created safely.')
}

/**
 * Ensures an output directory is below root without accepting a symlink,
 * junction, or non-directory in any component. Callers that publish a file
 * must perform this check before invoking their same-directory durable write.
 */
export async function ensureContainedDirectory(rootPath: string, targetDirectory: string): Promise<void> {
  const absoluteRoot = resolve(rootPath)
  const absoluteDirectory = resolve(targetDirectory)
  assertLexicallyInsideRoot(absoluteRoot, absoluteDirectory)

  const rootStats = await stat(absoluteRoot)
  if (!rootStats.isDirectory()) throw new Error('Configured root is not a directory.')

  const relation = relative(absoluteRoot, absoluteDirectory)
  let current = absoluteRoot
  for (const part of relation.split(sep).filter(Boolean)) {
    current = join(current, part)
    const currentStats = await lstat(current).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (currentStats) {
      assertSafeDirectory(current, currentStats.isSymbolicLink(), currentStats.isDirectory())
      continue
    }

    try {
      await mkdir(current)
    } catch (error) {
      if (!isErrnoException(error, 'EEXIST')) throw error
    }
    const createdStats = await lstat(current)
    assertSafeDirectory(current, createdStats.isSymbolicLink(), createdStats.isDirectory())
  }

  await assertRealPathInsideRoot(absoluteRoot, absoluteDirectory)
}

async function readExistingContainedFile(rootPath: string, targetPath: string): Promise<Buffer | null> {
  try {
    return await readContainedRegularFile(rootPath, targetPath)
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  }
}

async function assertFinalRegularFile(targetPath: string): Promise<void> {
  const targetStats = await lstat(targetPath)
  if (targetStats.isSymbolicLink()) {
    throw new Error('Final path must not be a symbolic link or junction.')
  }
  if (!targetStats.isFile()) {
    throw new Error('Final path must be a regular file.')
  }
}

function assertLexicallyInsideRoot(rootPath: string, targetPath: string): void {
  if (rootPath.trim().length === 0 || !isPathInsideRoot(rootPath, targetPath)) {
    throw new Error('Path is outside the configured root.')
  }
}

function assertSafeDirectory(path: string, isSymbolicLink: boolean, isDirectory: boolean): void {
  if (isSymbolicLink) throw new Error(`Directory path must not contain a symbolic link or junction: ${path}`)
  if (!isDirectory) throw new Error(`Directory path component is not a directory: ${path}`)
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
