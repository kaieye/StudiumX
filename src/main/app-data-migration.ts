import { access, copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const APP_DATA_LEGACY_DIR_NAMES = [
  'TeachOS',
  'AI Teaching System',
  'ai-teaching-system'
] as const

export function legacyUserDataCandidatePaths(appDataPath: string, currentUserDataPath: string): string[] {
  const currentKey = pathKey(currentUserDataPath)
  const candidates = APP_DATA_LEGACY_DIR_NAMES
    .map((name) => join(appDataPath, name))
    .filter((candidate) => pathKey(candidate) !== currentKey)
  return [...new Map(candidates.map((candidate) => [pathKey(candidate), candidate])).values()]
}

export async function copyFirstExistingLegacyFileIfMissing(
  targetPath: string,
  legacyPaths: string[]
): Promise<string | null> {
  try {
    await access(targetPath)
    return null
  } catch {
    // Continue and try legacy files.
  }

  const targetKey = pathKey(targetPath)
  for (const legacyPath of legacyPaths) {
    if (pathKey(legacyPath) === targetKey) continue
    try {
      await mkdir(dirname(targetPath), { recursive: true })
      await copyFile(legacyPath, targetPath)
      return legacyPath
    } catch (error) {
      if (isErrno(error) && error.code === 'ENOENT') continue
      throw error
    }
  }
  return null
}

function pathKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}
