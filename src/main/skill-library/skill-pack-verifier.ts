import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { skillPackManifestSchema } from '../../shared/teaching-types'
import type { SkillPackManifest } from '../../shared/teaching-types'
import { isPathInsideRoot } from '../path-access'

export const SKILL_PACK_MANIFEST = 'skill-pack.json'
const SHARED_RESOURCE_PREFIX = '../_shared/'

export type SkillFrontmatter = Record<string, string>

export type VerifiedSkillPack = {
  directory: string
  realDirectory: string
  manifest: SkillPackManifest
  resources: Map<string, string>
  instructions: { source: string; content: string; metadata: SkillFrontmatter }
}

export type VerifySkillPackOptions = {
  containingRoot: string
  expectedId: string
  manifestRequired: boolean
  requireCompleteResourceList: boolean
}

/** Verifies every filesystem and manifest fact a manifest-backed skill pack exposes to callers. */
export async function verifySkillPack(
  directory: string,
  options: VerifySkillPackOptions
): Promise<VerifiedSkillPack | null> {
  const manifestPath = join(directory, SKILL_PACK_MANIFEST)
  const manifestInfo = await lstat(manifestPath).catch(() => null)
  if (!manifestInfo) {
    if (options.manifestRequired) throw new Error(`Skill pack is missing ${SKILL_PACK_MANIFEST}.`)
    return null
  }
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) {
    throw new Error('Skill pack manifest must be a regular file.')
  }

  const [realContainingRoot, realDirectory, realManifestPath] = await Promise.all([
    realpath(options.containingRoot),
    realpath(directory),
    realpath(manifestPath)
  ])
  if (!isPathInsideRoot(realContainingRoot, realDirectory) || !isPathInsideRoot(realDirectory, realManifestPath)) {
    throw new Error('Skill pack path escapes its configured root after resolving symlinks.')
  }

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(await readFile(realManifestPath, 'utf8'))
  } catch {
    throw new Error('Skill pack manifest is not valid JSON.')
  }
  const parsed = skillPackManifestSchema.safeParse(rawManifest)
  if (!parsed.success) throw new Error(`Invalid skill pack manifest: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`)
  const manifest = parsed.data
  if (manifest.id !== options.expectedId) {
    throw new Error(`Skill pack id "${manifest.id}" does not match directory "${options.expectedId}".`)
  }

  const resources = new Map<string, string>()
  for (const declaration of manifest.resources) {
    const shared = declaration.path.startsWith(SHARED_RESOURCE_PREFIX)
    const containmentRoot = shared ? await resolveSiblingSharedRoot(realDirectory) : realDirectory
    if (!containmentRoot) throw new Error(`Shared skill resource root is unavailable for "${declaration.path}".`)
    const relativePath = shared ? declaration.path.slice(SHARED_RESOURCE_PREFIX.length) : declaration.path
    const candidate = resolve(containmentRoot, relativePath)
    if (!isPathInsideRoot(containmentRoot, candidate)) {
      throw new Error(`Declared skill resource "${declaration.path}" escapes its resource root.`)
    }
    const [resourceInfo, realResource] = await Promise.all([
      lstat(candidate).catch(() => null),
      realpath(candidate).catch(() => null)
    ])
    if (!resourceInfo?.isFile() || resourceInfo.isSymbolicLink() || !realResource) {
      throw new Error(`Declared skill resource "${declaration.path}" must be a regular file.`)
    }
    if (!isPathInsideRoot(containmentRoot, realResource)) {
      throw new Error(`Declared skill resource "${declaration.path}" escapes its resource root after resolving symlinks.`)
    }
    resources.set(declaration.path, realResource)
  }

  const skillInstructions = resources.get('SKILL.md')
  if (!skillInstructions) throw new Error('Skill pack must declare SKILL.md as its instructions.')
  const instructionContent = await readFile(skillInstructions, 'utf8')
  const instructionMetadata = parseVerifiedSkillFrontmatter(instructionContent)

  if (options.requireCompleteResourceList) {
    const declaredLocalFiles = new Set(
      manifest.resources.filter((resource) => !resource.path.startsWith(SHARED_RESOURCE_PREFIX)).map((resource) => resource.path)
    )
    const actualLocalFiles = await listPackFiles(realDirectory)
    actualLocalFiles.delete(SKILL_PACK_MANIFEST)
    if (actualLocalFiles.size !== declaredLocalFiles.size || [...actualLocalFiles].some((path) => !declaredLocalFiles.has(path))) {
      throw new Error('Skill pack contains files that are missing from its manifest resource declarations.')
    }
  }

  return {
    directory,
    realDirectory,
    manifest,
    resources,
    instructions: { source: skillInstructions, content: instructionContent, metadata: instructionMetadata }
  }
}

/** Reads legacy instructions only after checking the configured root and every resolved path. */
export async function readVerifiedLegacySkillFile(
  directory: string,
  containingRoot: string
): Promise<{ content: string; source: string; metadata: SkillFrontmatter } | null> {
  const source = join(directory, 'SKILL.md')
  const info = await lstat(source).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink()) return null
  const [realContainingRoot, realDirectory, realSource] = await Promise.all([
    realpath(containingRoot).catch(() => null),
    realpath(directory).catch(() => null),
    realpath(source).catch(() => null)
  ])
  if (!realContainingRoot || !realDirectory || !realSource) return null
  if (!isPathInsideRoot(realContainingRoot, realDirectory) || !isPathInsideRoot(realDirectory, realSource)) return null
  const content = await readFile(realSource, 'utf8').catch(() => '')
  if (!content) return null
  try {
    return { content, source: realSource, metadata: parseLegacySkillFrontmatter(content) }
  } catch {
    return null
  }
}

function parseLegacySkillFrontmatter(content: string): SkillFrontmatter {
  try {
    return parseVerifiedSkillFrontmatter(content)
  } catch {
    return {}
  }
}

export function parseVerifiedSkillFrontmatter(content: string): SkillFrontmatter {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) throw new Error('Skill instructions must begin with YAML frontmatter.')
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) throw new Error('Skill instruction frontmatter is not terminated.')

  const metadata: SkillFrontmatter = {}
  for (const line of normalized.slice(4, end).split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error('Skill instruction frontmatter contains an invalid field.')
    const key = line.slice(0, separator).trim().toLocaleLowerCase()
    const value = unquote(line.slice(separator + 1).trim())
    if (!key || !value) throw new Error('Skill instruction frontmatter contains an empty field.')
    metadata[key] = value
  }
  if (!metadata.name) throw new Error('Skill instruction frontmatter must declare a name.')
  return metadata
}

async function listPackFiles(root: string, current = root): Promise<Set<string>> {
  const files = new Set<string>()
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const entryPath = join(current, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Skill pack must not contain symbolic links.')
    if (entry.isDirectory()) {
      const nested = await listPackFiles(root, entryPath)
      for (const file of nested) files.add(file)
      continue
    }
    if (!entry.isFile()) throw new Error('Skill pack must contain only regular files and directories.')
    files.add(toPosixPath(relative(root, entryPath)))
  }
  return files
}

async function resolveSiblingSharedRoot(realSkillDirectory: string): Promise<string | null> {
  const candidate = join(dirname(realSkillDirectory), '_shared')
  const info = await lstat(candidate).catch(() => null)
  if (!info?.isDirectory() || info.isSymbolicLink()) return null
  const realSharedRoot = await realpath(candidate).catch(() => null)
  if (!realSharedRoot) return null
  return toPosixPath(relative(dirname(realSkillDirectory), realSharedRoot)) === '_shared' ? realSharedRoot : null
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}
