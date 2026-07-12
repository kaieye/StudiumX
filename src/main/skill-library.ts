import { cp, lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { isSafeSkillId, leadingSkillIds } from '../shared/skill-command'
import { skillPackManifestSchema } from '../shared/teaching-types'
import type {
  InstalledSkillReference,
  SkillCatalogResult,
  SkillCategory,
  SkillPackManifest,
  SkillSummary
} from '../shared/teaching-types'
import { isPathInsideRoot } from './path-access'

type SkillLibraryOptions = {
  builtInRoots: string[]
  personalRoot?: string
}

type SkillFrontmatter = Record<string, string>

type ValidatedSkillPack = {
  directory: string
  realDirectory: string
  manifest: SkillPackManifest
  resources: Map<string, string>
}

const DEFAULT_PERSONAL_SKILL_ROOT = join(homedir(), '.studiumx', 'skills')
const SKILL_PACK_MANIFEST = 'skill-pack.json'
const SHARED_RESOURCE_PREFIX = '../_shared/'
const VALID_CATEGORIES = new Set<SkillCategory>(['learning', 'productivity', 'development', 'lifestyle', 'other'])

export const BUILTIN_SKILL_IDS = [
  'course-content-authoring',
  'course-corporate-edition',
  'course-designer',
  'course-ebook-publishing',
  'course-outline-design',
  'learning-assessor',
  'static-spa-conversion',
  'static-spa-interactions',
  'teach',
  'teaching-resource-generator',
  'teaching-site',
  'teaching-site-design-system',
  'web-content-audit',
  'web-visual-assets',
  'web-visual-verification'
] as const

const BUILTIN_SKILL_ID_SET = new Set<string>(BUILTIN_SKILL_IDS)

export class SkillLibraryService {
  readonly personalRoot: string
  private readonly builtInRoots: string[]

  constructor(options: SkillLibraryOptions) {
    this.builtInRoots = uniqueResolvedPaths(options.builtInRoots)
    this.personalRoot = resolve(options.personalRoot ?? DEFAULT_PERSONAL_SKILL_ROOT)
  }

  async listSkills(): Promise<SkillCatalogResult> {
    await mkdir(this.personalRoot, { recursive: true })
    const builtIns = await this.readSkillsFromRoots(this.builtInRoots, 'builtin')
    const installed = await this.readSkillsFromRoots([this.personalRoot], 'personal')
    const installedById = new Map(installed.map((skill) => [skill.id.toLocaleLowerCase(), skill]))
    const merged: SkillSummary[] = builtIns.map((skill) => {
      const personal = installedById.get(skill.id.toLocaleLowerCase())
      if (!personal) return skill
      installedById.delete(skill.id.toLocaleLowerCase())
      return {
        ...skill,
        installed: true,
        installedPath: personal.installedPath
      }
    })
    merged.push(...installedById.values())
    merged.sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
    return { rootPath: this.personalRoot, skills: merged }
  }

  async installSkill(rawSkillId: string): Promise<SkillSummary> {
    const skillId = requireSkillId(rawSkillId)
    if (!BUILTIN_SKILL_ID_SET.has(skillId)) throw new Error(`Built-in skill "${skillId}" is not allowlisted.`)
    await mkdir(this.personalRoot, { recursive: true })
    const source = await this.findBuiltInSkillPack(skillId)
    if (!source) throw new Error(`Built-in skill "${skillId}" was not found.`)
    const target = join(this.personalRoot, skillId)
    const existing = await readLegacySkillFile(target, this.personalRoot)
    if (!existing) await cp(source.realDirectory, target, { recursive: true, errorOnExist: true, force: false })
    await copyDeclaredSharedResources(source, this.personalRoot)

    const targetManifest = await lstat(join(target, SKILL_PACK_MANIFEST)).catch(() => null)
    if (targetManifest) {
      await loadSkillPack(target, {
        containingRoot: this.personalRoot,
        expectedId: skillId,
        manifestRequired: true,
        requireCompleteResourceList: true
      })
    }

    const catalog = await this.listSkills()
    const installed = catalog.skills.find((skill) => skill.id.toLocaleLowerCase() === skillId)
    if (!installed?.installed) throw new Error(`Skill "${skillId}" could not be installed.`)
    return installed
  }

  async readInstalledSkillReferences(rawIds: string[]): Promise<InstalledSkillReference[]> {
    const catalog = await this.listSkills()
    return this.readReferencesFromCatalog(rawIds, catalog)
  }

  async readInvokedSkillReferences(userInput: string, explicitIds: string[] = []): Promise<InstalledSkillReference[]> {
    const catalog = await this.listSkills()
    const inferredIds = leadingSkillIds(userInput, catalog.skills)
    return this.readReferencesFromCatalog([...explicitIds, ...inferredIds], catalog)
  }

  private async readReferencesFromCatalog(
    rawIds: string[],
    catalog: SkillCatalogResult
  ): Promise<InstalledSkillReference[]> {
    const ids = [...new Set(rawIds.filter(isSafeSkillId).map((id) => id.trim().toLocaleLowerCase()))].slice(0, 8)
    const references: InstalledSkillReference[] = []
    for (const id of ids) {
      const installed = catalog.skills.find((skill) => skill.installed && skill.id.toLocaleLowerCase() === id)
      const directory = installed?.installedPath
      if (!directory) continue

      const manifestInfo = await lstat(join(directory, SKILL_PACK_MANIFEST)).catch(() => null)
      if (manifestInfo) {
        const pack = await loadSkillPack(directory, {
          containingRoot: this.personalRoot,
          expectedId: id,
          manifestRequired: true,
          requireCompleteResourceList: true
        }).catch(() => null)
        const source = pack?.resources.get('SKILL.md')
        if (!pack || !source) continue
        const content = await readFile(source, 'utf8').catch(() => '')
        if (!content) continue
        const metadata = parseSkillFrontmatter(content)
        references.push({
          id,
          name: metadata.name || id,
          source,
          ...(pack.manifest.capabilities.includes('read-shared-resources')
            ? { sharedRoot: join(this.personalRoot, '_shared') }
            : {}),
          content,
          manifest: pack.manifest
        })
        continue
      }

      const legacy = await readLegacySkillFile(directory, this.personalRoot)
      if (!legacy) continue
      const metadata = parseSkillFrontmatter(legacy.content)
      references.push({
        id,
        name: metadata.name || id,
        source: legacy.source,
        sharedRoot: join(this.personalRoot, '_shared'),
        content: legacy.content
      })
    }
    return references
  }

  private async findBuiltInSkillPack(skillId: string): Promise<ValidatedSkillPack | null> {
    if (!BUILTIN_SKILL_ID_SET.has(skillId)) return null
    for (const root of this.builtInRoots) {
      const entries = await safeDirectoryEntries(root)
      const match = entries.find((entry) => entry.isDirectory() && entry.name.toLocaleLowerCase() === skillId)
      if (!match) continue
      return loadSkillPack(join(root, match.name), {
        containingRoot: root,
        expectedId: skillId,
        manifestRequired: true,
        requireCompleteResourceList: true
      })
    }
    return null
  }

  private async readSkillsFromRoots(roots: string[], source: SkillSummary['source']): Promise<SkillSummary[]> {
    const byId = new Map<string, SkillSummary>()
    for (const root of roots) {
      const entries = await safeDirectoryEntries(root)
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeSkillId(entry.name)) continue
        const id = entry.name.toLocaleLowerCase()
        if (source === 'builtin' && !BUILTIN_SKILL_ID_SET.has(id)) continue
        const directory = join(root, entry.name)
        const manifestInfo = await lstat(join(directory, SKILL_PACK_MANIFEST)).catch(() => null)
        const pack = manifestInfo
          ? await loadSkillPack(directory, {
              containingRoot: root,
              expectedId: id,
              manifestRequired: true,
              requireCompleteResourceList: true
            }).catch(() => null)
          : null
        if (source === 'builtin' && !pack) continue
        if (manifestInfo && !pack) continue

        const skillFile = pack
          ? await readFile(pack.resources.get('SKILL.md') as string, 'utf8').catch(() => '')
          : (await readLegacySkillFile(directory, root))?.content ?? ''
        if (!skillFile || byId.has(id)) continue
        const metadata = parseSkillFrontmatter(skillFile)
        byId.set(id, toSkillSummary(id, metadata, source, directory, pack?.manifest))
      }
    }
    return [...byId.values()]
  }
}

function toSkillSummary(
  id: string,
  metadata: SkillFrontmatter,
  source: SkillSummary['source'],
  directory: string,
  manifest?: SkillPackManifest
): SkillSummary {
  const category = VALID_CATEGORIES.has(metadata.category as SkillCategory)
    ? metadata.category as SkillCategory
    : id === 'teach' ? 'learning' : 'other'
  return {
    id,
    name: metadata.name || id,
    description: metadata.description || `Run the ${metadata.name || id} skill.`,
    ...(metadata['argument-hint'] ? { argumentHint: metadata['argument-hint'] } : {}),
    category,
    icon: metadata.icon || (id === 'teach' ? 'graduation-cap' : 'sparkles'),
    author: metadata.author || (source === 'builtin' ? 'StudiumX' : 'Personal'),
    command: `/${id}`,
    source,
    installed: source === 'personal',
    ...(source === 'personal' ? { installedPath: directory } : {}),
    ...(manifest ? { version: manifest.version, capabilities: [...manifest.capabilities] } : {})
  }
}

function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return {}
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) return {}
  const metadata: SkillFrontmatter = {}
  for (const line of normalized.slice(4, end).split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim().toLocaleLowerCase()
    const value = unquote(line.slice(separator + 1).trim())
    if (key && value) metadata[key] = value
  }
  return metadata
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

function requireSkillId(value: string): string {
  const skillId = String(value ?? '').trim().toLocaleLowerCase()
  if (!isSafeSkillId(skillId)) throw new Error('Invalid skill id.')
  return skillId
}

async function loadSkillPack(
  directory: string,
  options: {
    containingRoot: string
    expectedId: string
    manifestRequired: boolean
    requireCompleteResourceList: boolean
  }
): Promise<ValidatedSkillPack | null> {
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
    const containmentRoot = shared
      ? await resolveSiblingSharedRoot(realDirectory)
      : realDirectory
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

  return { directory, realDirectory, manifest, resources }
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

async function readLegacySkillFile(
  directory: string,
  containingRoot: string
): Promise<{ content: string; source: string } | null> {
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
  return content ? { content, source: realSource } : null
}

async function resolveSiblingSharedRoot(realSkillDirectory: string): Promise<string | null> {
  const candidate = join(dirname(realSkillDirectory), '_shared')
  const info = await lstat(candidate).catch(() => null)
  if (!info?.isDirectory() || info.isSymbolicLink()) return null
  const realSharedRoot = await realpath(candidate).catch(() => null)
  if (!realSharedRoot) return null
  return toPosixPath(relative(dirname(realSkillDirectory), realSharedRoot)) === '_shared' ? realSharedRoot : null
}

async function copyDeclaredSharedResources(pack: ValidatedSkillPack, personalRoot: string): Promise<void> {
  const declarations = pack.manifest.resources.filter((resource) => resource.path.startsWith(SHARED_RESOURCE_PREFIX))
  if (declarations.length === 0) return

  const targetRoot = join(personalRoot, '_shared')
  const targetRootInfo = await lstat(targetRoot).catch(() => null)
  if (targetRootInfo?.isSymbolicLink() || (targetRootInfo && !targetRootInfo.isDirectory())) {
    throw new Error('Shared skill resource path must be a regular directory.')
  }
  if (!targetRootInfo) await mkdir(targetRoot, { recursive: true })
  const realTargetRoot = await realpath(targetRoot)

  for (const declaration of declarations) {
    const source = pack.resources.get(declaration.path)
    if (!source) throw new Error(`Declared shared resource "${declaration.path}" was not validated.`)
    const relativePath = declaration.path.slice(SHARED_RESOURCE_PREFIX.length)
    const target = resolve(realTargetRoot, relativePath)
    if (!isPathInsideRoot(realTargetRoot, target)) throw new Error('Shared skill resource path escapes its target root.')
    await mkdir(dirname(target), { recursive: true })
    const realParent = await realpath(dirname(target))
    if (!isPathInsideRoot(realTargetRoot, realParent)) throw new Error('Shared skill resource path escapes its target root.')
    const existing = await lstat(target).catch(() => null)
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
      throw new Error('Shared skill resource target must be a regular file.')
    }
    if (!existing) await cp(source, target, { errorOnExist: true, force: false })
  }
}

async function safeDirectoryEntries(root: string) {
  return readdir(root, { withFileTypes: true }).catch(() => [])
}

function uniqueResolvedPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!path) continue
    const resolved = resolve(path)
    const key = process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved
    if (seen.has(key)) continue
    seen.add(key)
    result.push(resolved)
  }
  return result
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}
