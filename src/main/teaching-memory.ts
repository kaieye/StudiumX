import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  CreateTeachingMemoryPayload,
  TeachingMemoryDiagnostics,
  TeachingMemoryRecord,
  TeachingMemoryScope,
  TeachingSettingsV1,
  UpdateTeachingMemoryPayload
} from '../shared/teaching-types'

type MemoryAccess = {
  workspaceRoot?: string
}

export class TeachingMemoryStore {
  private lastInjectedIds: string[] = []

  constructor(
    private readonly options: {
      rootDir: string
      settingsProvider: () => Promise<TeachingSettingsV1>
      nowIso?: () => string
      idGenerator?: () => string
    }
  ) {}

  async create(input: CreateTeachingMemoryPayload): Promise<TeachingMemoryRecord> {
    await mkdir(this.options.rootDir, { recursive: true })
    const now = this.now()
    const scope = normalizeScope(input.scope)
    const workspaceRoot = normalizeScopePath(input.workspaceRoot)
    const record = normalizeMemoryRecord({
      id: this.options.idGenerator?.() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      content: input.content,
      scope,
      workspace: scope !== 'user' ? workspaceRoot : undefined,
      project: scope === 'project' ? workspaceRoot : undefined,
      tags: input.tags ?? [],
      confidence: input.confidence ?? 1,
      createdAt: now,
      updatedAt: now
    })
    await writeJson(join(this.options.rootDir, `${record.id}.json`), record)
    return record
  }

  async update(id: string, patch: UpdateTeachingMemoryPayload, access?: MemoryAccess): Promise<TeachingMemoryRecord> {
    const current = await this.mustGet(id, access)
    const now = this.now()
    const next = normalizeMemoryRecord({
      ...current,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.disabled === true ? { disabledAt: current.disabledAt ?? now } : {}),
      ...(patch.disabled === false ? { disabledAt: undefined } : {}),
      updatedAt: now
    })
    await writeJson(join(this.options.rootDir, `${next.id}.json`), next)
    return next
  }

  async delete(id: string, access?: MemoryAccess): Promise<void> {
    const current = await this.mustGet(id, access)
    const now = this.now()
    const next = normalizeMemoryRecord({
      ...current,
      deletedAt: current.deletedAt ?? now,
      updatedAt: now
    })
    await writeJson(join(this.options.rootDir, `${next.id}.json`), next)
  }

  async list(workspaceRoot?: string, includeDeleted = false): Promise<TeachingMemoryRecord[]> {
    const records = await this.readAll()
    return records
      .filter((record) => includeDeleted || !record.deletedAt)
      .filter((record) => inScope(record, workspaceRoot))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async retrieve(input: {
    query: string
    workspaceRoot?: string
    limit?: number
  }): Promise<TeachingMemoryRecord[]> {
    const settings = await this.options.settingsProvider()
    if (!settings.memory.enabled) {
      this.setLastInjected([])
      return []
    }
    const limit = Math.max(1, input.limit ?? settings.memory.maxInjected)
    const active = (await this.list(input.workspaceRoot)).filter((record) => !record.disabledAt)
    const userMemories = active.filter((record) => record.scope === 'user')
    const scored = active
      .filter((record) => record.scope !== 'user')
      .map((record) => ({ record, score: scoreMemory(record, input.query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .map((entry) => entry.record)
    const result = [...userMemories, ...scored].slice(0, limit)
    this.setLastInjected(result.map((record) => record.id))
    return result
  }

  async diagnostics(): Promise<TeachingMemoryDiagnostics> {
    const settings = await this.options.settingsProvider()
    const records = await this.readAll()
    return {
      enabled: settings.memory.enabled,
      rootDir: this.options.rootDir,
      activeCount: records.filter((record) => !record.deletedAt && !record.disabledAt).length,
      tombstoneCount: records.filter((record) => Boolean(record.deletedAt)).length,
      lastInjectedIds: [...this.lastInjectedIds]
    }
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
  }

  private async mustGet(id: string, access?: MemoryAccess): Promise<TeachingMemoryRecord> {
    const record = (await this.readAll()).find((item) => item.id === id)
    if (!record || (access && !inScope(record, access.workspaceRoot))) {
      throw new Error(`Memory not found: ${id}`)
    }
    return record
  }

  private async readAll(): Promise<TeachingMemoryRecord[]> {
    await mkdir(this.options.rootDir, { recursive: true })
    const files = await readdir(this.options.rootDir).catch(() => [])
    const loaded = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          try {
            const parsed = JSON.parse(await readFile(join(this.options.rootDir, file), 'utf8')) as TeachingMemoryRecord
            return normalizeMemoryRecord(parsed)
          } catch {
            return null
          }
        })
    )
    return loaded.filter((record): record is TeachingMemoryRecord => Boolean(record))
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

function normalizeMemoryRecord(
  input: Partial<TeachingMemoryRecord> & Pick<TeachingMemoryRecord, 'id' | 'content' | 'scope' | 'createdAt' | 'updatedAt'>) : TeachingMemoryRecord {
  const scope = normalizeScope(input.scope)
  const workspace = scope === 'user' ? undefined : normalizeScopePath(input.workspace)
  const project = scope === 'project' ? normalizeScopePath(input.project ?? input.workspace) : undefined
  return {
    id: String(input.id),
    content: String(input.content ?? '').trim(),
    scope,
    ...(workspace ? { workspace } : {}),
    ...(project ? { project } : {}),
    sourceLessonId: typeof input.sourceLessonId === 'string' ? input.sourceLessonId : undefined,
    tags: normalizeTags(input.tags),
    confidence: clampNumber(input.confidence, 0, 1, 1),
    createdAt: String(input.createdAt),
    updatedAt: String(input.updatedAt),
    ...(typeof input.disabledAt === 'string' ? { disabledAt: input.disabledAt } : {}),
    ...(typeof input.deletedAt === 'string' ? { deletedAt: input.deletedAt } : {})
  }
}

function normalizeScope(value: unknown): TeachingMemoryScope {
  return value === 'user' || value === 'project' ? value : 'workspace'
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
}

function normalizeScopePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const normalized = resolve(trimmed)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function inScope(record: TeachingMemoryRecord, workspaceRoot: string | undefined): boolean {
  if (record.scope === 'user') return true
  const currentWorkspace = normalizeScopePath(workspaceRoot)
  if (!currentWorkspace) return false
  if (record.scope === 'workspace') {
    return normalizeScopePath(record.workspace) === currentWorkspace
  }
  return normalizeScopePath(record.project ?? record.workspace) === currentWorkspace
}

function scoreMemory(record: TeachingMemoryRecord, query: string): number {
  const queryGrams = ngrams(query)
  if (queryGrams.size === 0) return 0
  const textGrams = ngrams(`${record.content} ${record.tags.join(' ')}`)
  let overlap = 0
  for (const gram of queryGrams) {
    if (textGrams.has(gram)) overlap += 1
  }
  const coverage = overlap / queryGrams.size
  return (overlap + coverage) * record.confidence
}

function ngrams(input: string): Set<string> {
  const grams = new Set<string>()
  const normalized = input.toLowerCase()
  const asciiWords = normalized.match(/[a-z0-9_]{3,}/g) ?? []
  for (const word of asciiWords) {
    for (let index = 0; index + 3 <= word.length; index += 1) {
      grams.add(word.slice(index, index + 3))
    }
  }
  const cjkRuns = normalized.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
  for (const run of cjkRuns) {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      grams.add(run.slice(index, index + 2))
    }
    if (run.length < 2) grams.add(run)
  }
  return grams
}

function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tempPath, path)
}

export async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}
