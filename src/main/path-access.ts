import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

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
