import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, stat } from 'node:fs/promises'
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
  assertLexicallyInsideRoot(rootPath, targetPath)
  await assertFinalRegularFile(targetPath)
  const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  if (!isPathInsideRoot(realRoot, realTarget)) {
    throw new Error('Path escapes the configured root after resolving symlinks.')
  }
  return readFile(realTarget)
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
  await createContainedParentDirectory(input.rootPath, dirname(input.targetPath))

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

async function createContainedParentDirectory(rootPath: string, targetDirectory: string): Promise<void> {
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
