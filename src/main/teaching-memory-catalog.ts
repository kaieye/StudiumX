import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  TeachingMemoryRecord,
  TeachingMemoryScope
} from '../shared/teaching-types'

export type TeachingMemoryAccess = {
  workspaceRoot?: string
}

/**
 * The internal durable seam for Teaching-memory records.
 *
 * It knows the on-disk JSON format, normalization, and scope-safe record
 * access. Recall policy deliberately stays outside this catalog.
 */
export class TeachingMemoryCatalog {
  constructor(readonly rootDir: string) {}

  async write(record: TeachingMemoryRecord): Promise<void> {
    await writeJson(join(this.rootDir, `${record.id}.json`), record)
  }

  async list(workspaceRoot?: string, includeDeleted = false): Promise<TeachingMemoryRecord[]> {
    const records = await this.readAll()
    return records
      .filter((record) => includeDeleted || !record.deletedAt)
      .filter((record) => inTeachingMemoryScope(record, workspaceRoot))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(id: string, access?: TeachingMemoryAccess): Promise<TeachingMemoryRecord> {
    const record = (await this.readAll()).find((item) => item.id === id)
    if (!record || (access && !inTeachingMemoryScope(record, access.workspaceRoot))) {
      throw new Error(`Memory not found: ${id}`)
    }
    return record
  }

  async readAll(): Promise<TeachingMemoryRecord[]> {
    await mkdir(this.rootDir, { recursive: true })
    const files = await readdir(this.rootDir).catch(() => [])
    const loaded = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          try {
            const parsed = JSON.parse(await readFile(join(this.rootDir, file), 'utf8')) as TeachingMemoryRecord
            return normalizeTeachingMemoryRecord(parsed)
          } catch {
            return null
          }
        })
    )
    return loaded.filter((record): record is TeachingMemoryRecord => Boolean(record))
  }
}

export function normalizeTeachingMemoryRecord(
  input: Partial<TeachingMemoryRecord> & Pick<TeachingMemoryRecord, 'id' | 'content' | 'scope' | 'createdAt' | 'updatedAt'>
): TeachingMemoryRecord {
  const scope = normalizeTeachingMemoryScope(input.scope)
  const workspace = scope === 'user' ? undefined : normalizeTeachingMemoryScopePath(input.workspace)
  const project = scope === 'project' ? normalizeTeachingMemoryScopePath(input.project ?? input.workspace) : undefined
  return {
    id: String(input.id),
    content: String(input.content ?? '').trim(),
    scope,
    ...(workspace ? { workspace } : {}),
    ...(project ? { project } : {}),
    sourceLessonId: typeof input.sourceLessonId === 'string' ? input.sourceLessonId : undefined,
    tags: normalizeTeachingMemoryTags(input.tags),
    confidence: clampNumber(input.confidence, 0, 1, 1),
    createdAt: String(input.createdAt),
    updatedAt: String(input.updatedAt),
    ...(typeof input.disabledAt === 'string' ? { disabledAt: input.disabledAt } : {}),
    ...(typeof input.deletedAt === 'string' ? { deletedAt: input.deletedAt } : {})
  }
}

export function normalizeTeachingMemoryScope(value: unknown): TeachingMemoryScope {
  return value === 'user' || value === 'project' ? value : 'workspace'
}

export function inTeachingMemoryScope(record: TeachingMemoryRecord, workspaceRoot: string | undefined): boolean {
  if (record.scope === 'user') return true
  const currentWorkspace = normalizeTeachingMemoryScopePath(workspaceRoot)
  if (!currentWorkspace) return false
  if (record.scope === 'workspace') {
    return normalizeTeachingMemoryScopePath(record.workspace) === currentWorkspace
  }
  return normalizeTeachingMemoryScopePath(record.project ?? record.workspace) === currentWorkspace
}

export async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}

function normalizeTeachingMemoryTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
}

function normalizeTeachingMemoryScopePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const normalized = resolve(trimmed)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
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
