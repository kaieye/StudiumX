import { cp, lstat, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { isSafeSkillId, leadingSkillIds } from '../shared/skill-command'
import type {
  InstalledSkillReference,
  SkillCatalogResult,
  SkillCategory,
  SkillSummary
} from '../shared/teaching-types'

type SkillLibraryOptions = {
  builtInRoots: string[]
  personalRoot?: string
}

type SkillFrontmatter = Record<string, string>

const DEFAULT_PERSONAL_SKILL_ROOT = join(homedir(), '.studiumx', 'skills')
const VALID_CATEGORIES = new Set<SkillCategory>(['learning', 'productivity', 'development', 'lifestyle', 'other'])

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
    await mkdir(this.personalRoot, { recursive: true })
    const source = await this.findBuiltInSkillDirectory(skillId)
    if (!source) throw new Error(`Built-in skill "${skillId}" was not found.`)
    const target = join(this.personalRoot, skillId)
    const existing = await readSkillFile(target)
    if (!existing) await cp(source, target, { recursive: true, errorOnExist: true, force: false })
    await copyBuiltInSharedResources(source, this.personalRoot)
    const catalog = await this.listSkills()
    const installed = catalog.skills.find((skill) => skill.id.toLocaleLowerCase() === skillId.toLocaleLowerCase())
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
      const content = await readSkillFile(directory)
      if (!content) continue
      const metadata = parseSkillFrontmatter(content)
      references.push({
        id,
        name: metadata.name || id,
        source: join(directory, 'SKILL.md'),
        sharedRoot: join(this.personalRoot, '_shared'),
        content
      })
    }
    return references
  }

  private async findBuiltInSkillDirectory(skillId: string): Promise<string | null> {
    for (const root of this.builtInRoots) {
      const entries = await safeDirectoryEntries(root)
      const match = entries.find((entry) => entry.isDirectory() && entry.name.toLocaleLowerCase() === skillId.toLocaleLowerCase())
      if (!match) continue
      const directory = join(root, match.name)
      if (await readSkillFile(directory)) return directory
    }
    return null
  }

  private async readSkillsFromRoots(roots: string[], source: SkillSummary['source']): Promise<SkillSummary[]> {
    const byId = new Map<string, SkillSummary>()
    for (const root of roots) {
      const entries = await safeDirectoryEntries(root)
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeSkillId(entry.name)) continue
        const directory = join(root, entry.name)
        const content = await readSkillFile(directory)
        if (!content) continue
        const metadata = parseSkillFrontmatter(content)
        const id = entry.name.toLocaleLowerCase()
        if (byId.has(id)) continue
        byId.set(id, toSkillSummary(id, metadata, source, directory))
      }
    }
    return [...byId.values()]
  }
}

function toSkillSummary(
  id: string,
  metadata: SkillFrontmatter,
  source: SkillSummary['source'],
  directory: string
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
    ...(source === 'personal' ? { installedPath: directory } : {})
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

async function readSkillFile(directory: string): Promise<string> {
  const filePath = join(directory, 'SKILL.md')
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) return ''
  return readFile(filePath, 'utf8').catch(() => '')
}

async function copyBuiltInSharedResources(skillSourceDirectory: string, personalRoot: string): Promise<void> {
  const source = join(dirname(skillSourceDirectory), '_shared')
  const sourceInfo = await lstat(source).catch(() => null)
  if (!sourceInfo?.isDirectory() || sourceInfo.isSymbolicLink()) return
  const target = join(personalRoot, '_shared')
  await copyMissingSharedResourceTree(source, target)
}

async function copyMissingSharedResourceTree(source: string, target: string): Promise<void> {
  const targetInfo = await lstat(target).catch(() => null)
  if (targetInfo?.isSymbolicLink() || (targetInfo && !targetInfo.isDirectory())) {
    throw new Error('Shared skill resource path must be a regular directory.')
  }
  if (!targetInfo) await mkdir(target, { recursive: true })

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name)
    const targetPath = join(target, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await copyMissingSharedResourceTree(sourcePath, targetPath)
      continue
    }
    if (!entry.isFile()) continue
    const existing = await lstat(targetPath).catch(() => null)
    if (existing) continue
    await cp(sourcePath, targetPath, { errorOnExist: false, force: false })
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
