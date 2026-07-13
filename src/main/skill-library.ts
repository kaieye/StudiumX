import { cp, lstat, mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { isSafeSkillId, leadingSkillIds } from '../shared/skill-command'
import type {
  InstalledSkillReference,
  SkillCatalogResult,
  SkillCategory,
  SkillPackManifest,
  SkillSummary
} from '../shared/teaching-types'
import {
  readVerifiedLegacySkillFile, SKILL_PACK_MANIFEST,
  type SkillFrontmatter, type VerifiedSkillPack, verifySkillPack
} from './skill-library/skill-pack-verifier'
import { resolveUniqueSkillPackDirectories, resolveUniqueSkillPackDirectory } from './skill-library/skill-pack-resolver'
import { isPathInsideRoot } from './path-access'

type SkillLibraryOptions = {
  builtInRoots: string[]
  personalRoot?: string
}

const DEFAULT_PERSONAL_SKILL_ROOT = join(homedir(), '.studiumx', 'skills')
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
    const existing = await readVerifiedLegacySkillFile(target, this.personalRoot)
    if (!existing) await cp(source.realDirectory, target, { recursive: true, errorOnExist: true, force: false })
    await copyDeclaredSharedResources(source, this.personalRoot)

    const targetManifest = await lstat(join(target, SKILL_PACK_MANIFEST)).catch(() => null)
    if (targetManifest) {
      await verifySkillPack(target, {
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
        const pack = await verifySkillPack(directory, {
          containingRoot: this.personalRoot,
          expectedId: id,
          manifestRequired: true,
          requireCompleteResourceList: true
        }).catch(() => null)
        if (!pack) continue
        const { source, content, metadata } = pack.instructions
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

      const legacy = await readVerifiedLegacySkillFile(directory, this.personalRoot)
      if (!legacy) continue
      const metadata = legacy.metadata
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

  private async findBuiltInSkillPack(skillId: string): Promise<VerifiedSkillPack | null> {
    if (!BUILTIN_SKILL_ID_SET.has(skillId)) return null
    const candidate = await resolveUniqueSkillPackDirectory(this.builtInRoots, skillId)
    if (!candidate) return null
    return verifySkillPack(candidate.directory, {
      containingRoot: candidate.containingRoot,
      expectedId: skillId,
      manifestRequired: true,
      requireCompleteResourceList: true
    })
  }

  private async readSkillsFromRoots(roots: string[], source: SkillSummary['source']): Promise<SkillSummary[]> {
    const byId = new Map<string, SkillSummary>()
    const directories = await resolveUniqueSkillPackDirectories(
      roots,
      (id) => source !== 'builtin' || BUILTIN_SKILL_ID_SET.has(id)
    )
    for (const { id, directory, containingRoot } of directories) {
      const manifestInfo = await lstat(join(directory, SKILL_PACK_MANIFEST)).catch(() => null)
      const pack = manifestInfo
        ? await verifySkillPack(directory, {
            containingRoot,
            expectedId: id,
            manifestRequired: true,
            requireCompleteResourceList: true
          }).catch(() => null)
        : null
      if (source === 'builtin' && !pack) continue
      if (manifestInfo && !pack) continue

      const legacy = pack ? null : await readVerifiedLegacySkillFile(directory, containingRoot)
      if ((!pack && !legacy) || byId.has(id)) continue
      const metadata = pack?.instructions.metadata ?? legacy?.metadata
      if (!metadata) continue
      byId.set(id, toSkillSummary(id, metadata, source, directory, pack?.manifest))
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

function requireSkillId(value: string): string {
  const skillId = String(value ?? '').trim().toLocaleLowerCase()
  if (!isSafeSkillId(skillId)) throw new Error('Invalid skill id.')
  return skillId
}

async function copyDeclaredSharedResources(pack: VerifiedSkillPack, personalRoot: string): Promise<void> {
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
