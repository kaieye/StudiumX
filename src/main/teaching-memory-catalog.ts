import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, win32 } from 'node:path'
import type {
  TeachingMemoryRecord,
  TeachingMemoryScope
} from '../shared/teaching-types'
import {
  isCanonicalTeachingMemoryRecordFileName,
  isTeachingMemoryRecordFileName,
  listTeachingMemoryRecordFiles,
  readTeachingMemoryRecordFile,
  replaceTeachingMemoryRecordFile,
  teachingMemoryRecordFilePath
} from './teaching-memory-catalog/record-file'

export type TeachingMemoryAccess = {
  workspaceRoot?: string
  projectRoot?: string
}

export type TeachingMemoryListQuery = {
  access?: TeachingMemoryAccess
  workspaceRoot?: string
  includeDeleted?: boolean
}

export type TeachingMemoryCatalogRecoveryIssue = {
  fileName: string
  filePath: string
  reason: 'invalid_json' | 'invalid_record' | 'file_name_mismatch'
}

/** Main-process-only durable scan used by disposable local projections. */
export type TeachingMemoryCatalogIndexScan = {
  records: TeachingMemoryRecord[]
  recoveryIssues: TeachingMemoryCatalogRecoveryIssue[]
  sourcePaths: string[]
  /** SHA-256 values of the exact bytes used to parse each discovered source. */
  sourceFingerprints: Array<{ path: string; fingerprint: string }>
  /** Exact source digest for the record selected after canonical-file precedence. */
  recordFingerprints: Array<{ memoryId: string; fingerprint: string }>
}

/**
 * The durable local-file catalog for Teaching-memory records.
 *
 * It owns the record-file convention, data normalization, access scope
 * evaluation, atomic replacement, tombstone filtering, and recovery from
 * malformed files. Recall, learning-record, and learner-profile policy remain
 * deliberately outside this boundary.
 */
export class TeachingMemoryCatalog {
  private recoveryIssues: TeachingMemoryCatalogRecoveryIssue[] = []

  constructor(readonly rootDir: string) {}

  async commit(record: TeachingMemoryRecord): Promise<void> {
    const normalized = normalizeTeachingMemoryRecord(record)
    assertTeachingMemoryRecordIntegrity(normalized)
    await replaceTeachingMemoryRecordFile(this.rootDir, normalized.id, normalized)
  }

  /** @deprecated Use commit. */
  async write(record: TeachingMemoryRecord): Promise<void> {
    await this.commit(record)
  }

  async find(id: string, access?: TeachingMemoryAccess): Promise<TeachingMemoryRecord> {
    this.resetRecoveryIssues()
    const record = await this.readById(id)
    if (!record || record.deletedAt || !inTeachingMemoryScope(record, access)) {
      throw new Error(`Memory not found: ${id}`)
    }
    return record
  }

  /** @deprecated Use find. */
  async get(id: string, access?: TeachingMemoryAccess): Promise<TeachingMemoryRecord> {
    return this.find(id, access)
  }

  async list(query?: TeachingMemoryListQuery | string, includeDeleted = false): Promise<TeachingMemoryRecord[]> {
    const resolvedQuery = normalizeListQuery(query, includeDeleted)
    const records = await this.readAll()
    return records
      .filter((record) => resolvedQuery.includeDeleted || !record.deletedAt)
      .filter((record) => inTeachingMemoryScope(record, resolvedQuery.access))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /**
   * Returns every valid durable record, including tombstones, for diagnostics.
   * Malformed files are skipped and exposed through getRecoveryIssues().
   */
  async readAll(): Promise<TeachingMemoryRecord[]> {
    this.resetRecoveryIssues()
    const files = await listTeachingMemoryRecordFiles(this.rootDir)
    const recordsById = new Map<string, TeachingMemoryRecord>()
    const canonicalFirst = [...files].sort((left, right) => Number(isCanonicalTeachingMemoryRecordFileName(right)) - Number(isCanonicalTeachingMemoryRecordFileName(left)) || left.localeCompare(right))

    const loaded = await Promise.all(canonicalFirst.map((fileName) => this.readFromFile(fileName)))
    for (const record of loaded) {
      if (record && !recordsById.has(record.id)) recordsById.set(record.id, record)
    }

    return [...recordsById.values()]
  }

  getRecoveryIssues(): readonly TeachingMemoryCatalogRecoveryIssue[] {
    return this.recoveryIssues.map((issue) => ({ ...issue }))
  }

  /** Returns all valid scopes and tombstones plus malformed-file recovery facts. */
  async scanForLocalDataIndex(): Promise<TeachingMemoryCatalogIndexScan> {
    this.resetRecoveryIssues()
    const files = await listTeachingMemoryRecordFiles(this.rootDir)
    const canonicalFirst = [...files].sort((left, right) => Number(isCanonicalTeachingMemoryRecordFileName(right)) - Number(isCanonicalTeachingMemoryRecordFileName(left)) || left.localeCompare(right))
    const recordsById = new Map<string, { record: TeachingMemoryRecord; fingerprint: string }>()
    const sources = await Promise.all(canonicalFirst.map(async (fileName) => {
      const path = join(this.rootDir, fileName)
      try {
        const bytes = await readFile(path)
        return { fileName, path, record: this.parseRecordFile(fileName, bytes.toString('utf8')), fingerprint: createHash('sha256').update(bytes).digest('hex') }
      } catch {
        this.report(fileName, 'invalid_json')
        return { fileName, path, record: null, fingerprint: null }
      }
    }))
    for (const source of sources) if (source.record && source.fingerprint && !recordsById.has(source.record.id)) recordsById.set(source.record.id, { record: source.record, fingerprint: source.fingerprint })
    return {
      records: [...recordsById.values()].map((source) => source.record),
      recoveryIssues: [...this.getRecoveryIssues()],
      sourcePaths: sources.map((source) => source.path).sort(),
      sourceFingerprints: sources.flatMap((source) => source.fingerprint ? [{ path: source.path, fingerprint: source.fingerprint }] : []).sort((left, right) => left.path.localeCompare(right.path)),
      recordFingerprints: [...recordsById.entries()].map(([memoryId, source]) => ({ memoryId, fingerprint: source.fingerprint })).sort((left, right) => left.memoryId.localeCompare(right.memoryId))
    }
  }

  private async readById(id: string): Promise<TeachingMemoryRecord | null> {
    let file
    try {
      file = await readTeachingMemoryRecordFile(this.rootDir, id)
    } catch {
      return null
    }
    if (!file) return null
    return this.parseRecordFile(file.fileName, file.content)
  }

  private async readFromFile(fileName: string): Promise<TeachingMemoryRecord | null> {
    try {
      return this.parseRecordFile(fileName, await readFile(join(this.rootDir, fileName), 'utf8'))
    } catch {
      this.report(fileName, 'invalid_json')
      return null
    }
  }

  private parseRecordFile(fileName: string, content: string): TeachingMemoryRecord | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(content) as unknown
    } catch {
      this.report(fileName, 'invalid_json')
      return null
    }

    const record = tryNormalizeTeachingMemoryRecord(parsed)
    if (!record) {
      this.report(fileName, 'invalid_record')
      return null
    }
    if (!isTeachingMemoryRecordFileName(fileName, record.id)) {
      this.report(fileName, 'file_name_mismatch')
      return null
    }
    return record
  }

  private resetRecoveryIssues(): void {
    this.recoveryIssues = []
  }

  private report(fileName: string, reason: TeachingMemoryCatalogRecoveryIssue['reason']): void {
    this.recoveryIssues.push({ fileName, filePath: join(this.rootDir, fileName), reason })
  }
}

export function normalizeTeachingMemoryRecord(
  input: Partial<TeachingMemoryRecord> & Pick<TeachingMemoryRecord, 'id' | 'content' | 'scope' | 'createdAt' | 'updatedAt'>
): TeachingMemoryRecord {
  const id = normalizeRequiredText(input.id, 'Teaching-memory record IDs')
  const createdAt = normalizeRequiredText(input.createdAt, 'Teaching-memory createdAt values')
  const updatedAt = normalizeRequiredText(input.updatedAt, 'Teaching-memory updatedAt values')
  const scope = normalizeTeachingMemoryScope(input.scope)
  const workspace = scope === 'user' ? undefined : normalizeTeachingMemoryScopePath(input.workspace)
  const project = scope === 'project' ? normalizeTeachingMemoryScopePath(input.project ?? input.workspace) : undefined
  return {
    id,
    content: String(input.content ?? '').trim(),
    scope,
    ...(workspace ? { workspace } : {}),
    ...(project ? { project } : {}),
    ...(typeof input.sourceLessonId === 'string' ? { sourceLessonId: input.sourceLessonId } : {}),
    tags: normalizeTeachingMemoryTags(input.tags),
    confidence: clampNumber(input.confidence, 0, 1, 1),
    createdAt,
    updatedAt,
    ...(typeof input.disabledAt === 'string' ? { disabledAt: input.disabledAt } : {}),
    ...(typeof input.deletedAt === 'string' ? { deletedAt: input.deletedAt } : {})
  }
}

export function normalizeTeachingMemoryScope(value: unknown): TeachingMemoryScope {
  return value === 'user' || value === 'project' ? value : 'workspace'
}

export function normalizeTeachingMemoryScopePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (isWindowsPath(trimmed)) {
    const normalized = win32.normalize(trimmed.replaceAll('/', '\\'))
    return (normalized.length > 3 ? normalized.replace(/\\+$/, '') : normalized).toLowerCase()
  }
  const normalized = resolve(trimmed)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function inTeachingMemoryScope(record: TeachingMemoryRecord, access?: TeachingMemoryAccess | string): boolean {
  if (record.scope === 'user') return true
  const normalizedAccess = typeof access === 'string' ? { workspaceRoot: access } : access
  const workspace = normalizeTeachingMemoryScopePath(normalizedAccess?.workspaceRoot)
  if (record.scope === 'workspace') {
    return Boolean(workspace) && normalizeTeachingMemoryScopePath(record.workspace) === workspace
  }
  const project = normalizeTeachingMemoryScopePath(normalizedAccess?.projectRoot ?? normalizedAccess?.workspaceRoot)
  return Boolean(project) && normalizeTeachingMemoryScopePath(record.project ?? record.workspace) === project
}

export async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}

export { teachingMemoryRecordFilePath }

function normalizeListQuery(query: TeachingMemoryListQuery | string | undefined, includeDeleted: boolean): Required<Pick<TeachingMemoryListQuery, 'includeDeleted'>> & Pick<TeachingMemoryListQuery, 'access'> {
  if (typeof query === 'string') return { access: { workspaceRoot: query }, includeDeleted }
  return {
    access: query?.access ?? (query?.workspaceRoot ? { workspaceRoot: query.workspaceRoot } : undefined),
    includeDeleted: query?.includeDeleted ?? includeDeleted
  }
}

function tryNormalizeTeachingMemoryRecord(value: unknown): TeachingMemoryRecord | null {
  if (!isPlainObject(value)) return null
  if (typeof value.id !== 'string' || !value.id.trim()) return null
  if (typeof value.content !== 'string') return null
  if (typeof value.createdAt !== 'string' || !value.createdAt.trim()) return null
  if (typeof value.updatedAt !== 'string' || !value.updatedAt.trim()) return null

  try {
    const record = normalizeTeachingMemoryRecord(value as Partial<TeachingMemoryRecord> & Pick<TeachingMemoryRecord, 'id' | 'content' | 'scope' | 'createdAt' | 'updatedAt'>)
    assertTeachingMemoryRecordIntegrity(record)
    return record
  } catch {
    return null
  }
}

function assertTeachingMemoryRecordIntegrity(record: TeachingMemoryRecord): void {
  if (record.scope === 'workspace' && !record.workspace) {
    throw new Error('Workspace-scoped Teaching-memory records require a workspace path')
  }
  if (record.scope === 'project' && !record.project) {
    throw new Error('Project-scoped Teaching-memory records require a project path')
  }
}

function normalizeTeachingMemoryTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
}

function normalizeRequiredText(value: unknown, description: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${description} must not be empty`)
  return normalized
}

function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100))
}

function isWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
