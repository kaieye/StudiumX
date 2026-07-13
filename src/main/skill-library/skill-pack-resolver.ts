import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { isSafeSkillId } from '../../shared/skill-command'
import { isPathInsideRoot } from '../path-access'

export type SkillPackDirectory = {
  id: string
  directory: string
  containingRoot: string
}

/** Resolves only unambiguous, physical skill-pack directories from configured source roots. */
export async function resolveUniqueSkillPackDirectories(
  roots: readonly string[],
  acceptsId: (id: string) => boolean = () => true
): Promise<SkillPackDirectory[]> {
  const candidates: SkillPackDirectory[] = []
  const seenRoots = new Set<string>()

  for (const configuredRoot of roots) {
    const realRoot = await realpath(configuredRoot).catch(() => null)
    if (!realRoot) continue
    const rootKey = canonicalPathKey(realRoot)
    if (seenRoots.has(rootKey)) continue
    seenRoots.add(rootKey)

    const entries = await readdir(configuredRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !isSafeSkillId(entry.name)) continue
      const id = entry.name.toLocaleLowerCase()
      if (!acceptsId(id)) continue
      const directory = join(configuredRoot, entry.name)
      const realDirectory = await realpath(directory).catch(() => null)
      if (!realDirectory || !isPathInsideRoot(realRoot, realDirectory)) continue
      candidates.push({ id, directory, containingRoot: configuredRoot })
    }
  }

  const byId = new Map<string, SkillPackDirectory[]>()
  for (const candidate of candidates) {
    const group = byId.get(candidate.id) ?? []
    group.push(candidate)
    byId.set(candidate.id, group)
  }
  return [...byId.values()].flatMap((group) => group.length === 1 ? group : [])
}

export async function resolveUniqueSkillPackDirectory(
  roots: readonly string[],
  expectedId: string
): Promise<SkillPackDirectory | null> {
  const candidates = await resolveUniqueSkillPackDirectories(roots, (id) => id === expectedId)
  return candidates[0] ?? null
}

function canonicalPathKey(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase() : path
}
