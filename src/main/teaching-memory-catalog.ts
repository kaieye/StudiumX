import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve, win32 } from 'node:path'
import { normalizeTraceId } from '../shared/trace-context'
import { closeContainedDurableDirectory, readRegularFileAtContainedDirectory, type ContainedDurableDirectory } from './persistence/contained-durable-directory'
import type {
  TeachingMemoryRecord,
  TeachingMemoryScope
} from '../shared/teaching-types'
import {
  closeTeachingMemoryRecordFileDiscovery,
  discoverTeachingMemoryRecordFiles,
  isCanonicalTeachingMemoryRecordFileName,
  isTeachingMemoryRecordFileName,
  openTeachingMemoryScopedRecordDirectory,
  replaceTeachingMemoryRecordFileAtSource,
  teachingMemoryRecordFileName,
  teachingMemoryRecordFilePath,
  teachingMemoryScopeDirectory,
  teachingMemoryScopedRecordFilePath,
  type TeachingMemoryRecordFileSource
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
  reason: 'invalid_json' | 'invalid_record' | 'file_name_mismatch' | 'scope_mismatch' | 'duplicate_conflict' | 'unsafe_path' | 'unrecognized_partition' | 'deep_directory'
}

/** Main-process-only durable scan used by disposable local projections. */
export type TeachingMemoryCatalogIndexScan = {
  records: TeachingMemoryRecord[]
  recoveryIssues: TeachingMemoryCatalogRecoveryIssue[]
  sourcePaths: string[]
  /** SHA-256 values of the exact bytes used to parse each discovered source. */
  sourceFingerprints: Array<{ path: string; fingerprint: string }>
  /** Exact source digest for the record selected after deterministic precedence. */
  recordFingerprints: Array<{ memoryId: string; fingerprint: string }>
}

type ParsedSource = TeachingMemoryRecordFileSource & {
  bytes: Buffer
  fingerprint: string
  record: TeachingMemoryRecord
}

type Discovery = {
  sources: Array<TeachingMemoryRecordFileSource & { bytes?: Buffer; fingerprint?: string }>
  selected: Map<string, ParsedSource>
  conflictedIds: Set<string>
  acceptedSourceCounts: Map<string, number>
  close: () => void
  rootDirectory?: ContainedDurableDirectory
}

/**
 * The durable local-file catalog for Teaching-memory records. The catalog owns
 * the internal partition key, restricted filesystem traversal, record
 * normalization, content-based scope authorization, and source-preserving
 * updates for legacy layouts. SQLite remains only a disposable projection.
 */
export class TeachingMemoryCatalog {
  private recoveryIssues: TeachingMemoryCatalogRecoveryIssue[] = []

  constructor(readonly rootDir: string) {}

  async commit(record: TeachingMemoryRecord): Promise<void> {
    const normalized = normalizeTeachingMemoryRecord(record)
    assertTeachingMemoryRecordIntegrity(normalized)
    this.resetRecoveryIssues()
    const discovered = await this.discover()
    let createdDirectory: ReturnType<typeof openTeachingMemoryScopedRecordDirectory>['directory'] | undefined
    try {
      const acceptedSourceCount = discovered.acceptedSourceCounts.get(normalized.id) ?? 0
      // Identical-byte duplicates are readable by deterministic precedence, but
      // mutation would create divergent durable bytes. Refuse every mutation
      // (including tombstones) before opening or writing a target source.
      if (discovered.conflictedIds.has(normalized.id)) {
        throw new Error(`Memory record has conflicting durable sources: ${normalized.id}`)
      }
      if (acceptedSourceCount > 1) {
        throw new Error(`Memory record has multiple accepted durable sources and cannot be mutated: ${normalized.id}`)
      }

      const existing = discovered.selected.get(normalized.id)
      if (existing) {
        if (existing.layout === 'scoped' && existing.partition !== teachingMemoryScopeDirectory(normalized)) {
          throw new Error(`Memory record scope change requires unsafe partition relocation and was refused: ${normalized.id}`)
        }
        await replaceTeachingMemoryRecordFileAtSource(existing, normalized)
        return
      }

      if (!discovered.rootDirectory) throw new Error('Teaching-memory catalog root is unavailable for descriptor-relative publication.')
      const scoped = openTeachingMemoryScopedRecordDirectory(this.rootDir, discovered.rootDirectory, normalized)
      createdDirectory = scoped.directory
      await replaceTeachingMemoryRecordFileAtSource({
        directory: scoped.directory,
        entryName: teachingMemoryRecordFileName(normalized.id)
      }, normalized)
    } finally {
      if (createdDirectory) closeContainedDurableDirectory(createdDirectory)
      discovered.close()
    }
  }

  /** @deprecated Use commit. */
  async write(record: TeachingMemoryRecord): Promise<void> {
    await this.commit(record)
  }

  async find(id: string, access?: TeachingMemoryAccess): Promise<TeachingMemoryRecord> {
    this.resetRecoveryIssues()
    const discovered = await this.discover()
    try {
      const record = discovered.selected.get(id)?.record
      if (!record || record.deletedAt || !inTeachingMemoryScope(record, access)) {
        throw new Error(`Memory not found: ${id}`)
      }
      return record
    } finally {
      discovered.close()
    }
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

  /** Returns every valid selected durable record, including tombstones. */
  async readAll(): Promise<TeachingMemoryRecord[]> {
    this.resetRecoveryIssues()
    const discovered = await this.discover()
    try {
      return [...discovered.selected.values()].map((source) => source.record)
    } finally {
      discovered.close()
    }
  }

  getRecoveryIssues(): readonly TeachingMemoryCatalogRecoveryIssue[] {
    return this.recoveryIssues.map((issue) => ({ ...issue }))
  }

  /** Returns all valid scopes/tombstones and recovery facts for the SQLite projection. */
  async scanForLocalDataIndex(): Promise<TeachingMemoryCatalogIndexScan> {
    this.resetRecoveryIssues()
    const discovered = await this.discover()
    try {
      return {
        records: [...discovered.selected.values()].map((source) => source.record),
        recoveryIssues: [...this.getRecoveryIssues()],
        sourcePaths: discovered.sources.map((source) => source.filePath).sort(),
        sourceFingerprints: discovered.sources.flatMap((source) => source.fingerprint ? [{ path: source.filePath, fingerprint: source.fingerprint }] : []).sort((left, right) => left.path.localeCompare(right.path)),
        recordFingerprints: [...discovered.selected.entries()].map(([memoryId, source]) => ({ memoryId, fingerprint: source.fingerprint })).sort((left, right) => left.memoryId.localeCompare(right.memoryId))
      }
    } finally {
      discovered.close()
    }
  }

  private async discover(): Promise<Discovery> {
    const listed = await discoverTeachingMemoryRecordFiles(this.rootDir)
    try {
      for (const issue of listed.issues) this.report(issue.fileName, issue.filePath, issue.reason)

      const sources: Discovery['sources'] = []
      const parsed: ParsedSource[] = []
      for (const source of listed.sources) {
        try {
          const bytes = readRegularFileAtContainedDirectory(source.directory, source.entryName)
          const fingerprint = createHash('sha256').update(bytes).digest('hex')
          sources.push({ ...source, bytes, fingerprint })
          const record = this.parseRecordFile(source, bytes.toString('utf8'))
          if (record) parsed.push({ ...source, bytes, fingerprint, record })
        } catch {
          sources.push(source)
          this.report(source.fileName, source.filePath, 'unsafe_path')
        }
      }

      const selected = new Map<string, ParsedSource>()
      const conflictedIds = new Set<string>()
      const acceptedSourceCounts = new Map<string, number>()
      for (const candidates of groupById(parsed).values()) {
        acceptedSourceCounts.set(candidates[0]!.record.id, candidates.length)
        if (!identicalBytes(candidates)) {
          conflictedIds.add(candidates[0]!.record.id)
          for (const candidate of candidates) this.report(candidate.fileName, candidate.filePath, 'duplicate_conflict')
          continue
        }
        candidates.sort(compareSourcePrecedence)
        selected.set(candidates[0]!.record.id, candidates[0]!)
      }
      return {
        sources,
        selected,
        conflictedIds,
        acceptedSourceCounts,
        rootDirectory: listed.rootDirectory,
        close: () => closeTeachingMemoryRecordFileDiscovery(listed)
      }
    } catch (error) {
      closeTeachingMemoryRecordFileDiscovery(listed)
      throw error
    }
  }

  private parseRecordFile(source: TeachingMemoryRecordFileSource, content: string): TeachingMemoryRecord | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(content) as unknown
    } catch {
      this.report(source.fileName, source.filePath, 'invalid_json')
      return null
    }

    const record = tryNormalizeTeachingMemoryRecord(parsed)
    if (!record) {
      this.report(source.fileName, source.filePath, 'invalid_record')
      return null
    }
    if (source.layout === 'flat' && !isTeachingMemoryRecordFileName(lastPathSegment(source.fileName), record.id)) {
      this.report(source.fileName, source.filePath, 'file_name_mismatch')
      return null
    }
    if (source.layout === 'scoped') {
      const fileName = lastPathSegment(source.fileName)
      if (!isCanonicalTeachingMemoryRecordFileName(fileName) || fileName !== teachingMemoryRecordFilePath('', record.id)) {
        this.report(source.fileName, source.filePath, 'file_name_mismatch')
        return null
      }
      if (source.partition !== teachingMemoryScopeDirectory(record)) {
        this.report(source.fileName, source.filePath, 'scope_mismatch')
        return null
      }
    }
    return record
  }

  private resetRecoveryIssues(): void {
    this.recoveryIssues = []
  }

  private report(fileName: string, filePath: string, reason: TeachingMemoryCatalogRecoveryIssue['reason']): void {
    this.recoveryIssues.push({ fileName, filePath, reason })
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
  // Trace metadata is strictly opaque UUID correlation data. Invalid values are
  // intentionally omitted so durable records cannot carry diagnostic text.
  const traceId = normalizeTraceId(input.traceId)
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
    ...(traceId ? { traceId } : {}),
    ...(typeof input.disabledAt === 'string' ? { disabledAt: input.disabledAt } : {}),
    ...(typeof input.deletedAt === 'string' ? { deletedAt: input.deletedAt } : {})
  }
}

export function normalizeTeachingMemoryScope(value: unknown): TeachingMemoryScope {
  return value === 'user' || value === 'project' ? value : 'workspace'
}

export function normalizeTeachingMemoryScopePath(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const trimmed = value.trim()
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

export { teachingMemoryRecordFilePath, teachingMemoryScopeDirectory, teachingMemoryScopedRecordFilePath }

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

function groupById(sources: ParsedSource[]): Map<string, ParsedSource[]> {
  const byId = new Map<string, ParsedSource[]>()
  for (const source of sources) {
    const candidates = byId.get(source.record.id)
    if (candidates) candidates.push(source)
    else byId.set(source.record.id, [source])
  }
  return byId
}

function identicalBytes(candidates: ParsedSource[]): boolean {
  return candidates.every((candidate) => candidate.bytes.equals(candidates[0]!.bytes))
}

function compareSourcePrecedence(left: ParsedSource, right: ParsedSource): number {
  return sourcePrecedence(left) - sourcePrecedence(right) || left.fileName.localeCompare(right.fileName)
}

function sourcePrecedence(source: ParsedSource): number {
  if (source.layout === 'scoped') return 0
  return isCanonicalTeachingMemoryRecordFileName(lastPathSegment(source.fileName)) ? 1 : 2
}

function lastPathSegment(fileName: string): string {
  const parts = fileName.split(/[\\/]/)
  return parts[parts.length - 1] ?? fileName
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
