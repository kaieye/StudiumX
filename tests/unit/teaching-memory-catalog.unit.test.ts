import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { TeachingMemoryStore } from '../../src/main/teaching-memory'
import { defaultSettings } from '../../src/main/teaching-settings'
import {
  TeachingMemoryCatalog,
  normalizeTeachingMemoryScopePath,
  teachingMemoryRecordFilePath,
  teachingMemoryScopeDirectory,
  teachingMemoryScopedRecordFilePath,
  type TeachingMemoryCatalogRecoveryIssue
} from '../../src/main/teaching-memory-catalog'
import type { TeachingMemoryRecord } from '../../src/shared/teaching-types'

const temporaryRoots: string[] = []

async function createCatalog(): Promise<TeachingMemoryCatalog> {
  const rootDir = await mkdtemp(join(tmpdir(), 'studiumx-teaching-memory-catalog-'))
  temporaryRoots.push(rootDir)
  return new TeachingMemoryCatalog(rootDir)
}

function record(id: string, overrides: Partial<TeachingMemoryRecord> = {}): TeachingMemoryRecord {
  return {
    id,
    content: `Memory ${id}`,
    scope: 'user',
    tags: [],
    confidence: 1,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides
  }
}

function serialized(input: TeachingMemoryRecord): string {
  return `${JSON.stringify(input, null, 2)}\n`
}

async function writeRecord(path: string, input: TeachingMemoryRecord): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, serialized(input), { mode: 0o600 })
}

async function writeRawFlat(rootDir: string, input: TeachingMemoryRecord): Promise<string> {
  const path = join(rootDir, `${input.id}.json`)
  await writeRecord(path, input)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })))
})

describe('TeachingMemoryCatalog scope partitions', () => {
  it('derives stable full SHA-256 base64url partitions only from normalized main-process records', async () => {
    const workspace = record('workspace', { scope: 'workspace', workspace: 'C:\\Courses\\Alpha\\lessons\\..' })
    const project = record('project', { scope: 'project', workspace: 'C:\\Courses\\Alpha', project: 'D:\\Projects\\Alpha\\chapter\\..' })
    const normalizedWorkspace = 'c:\\courses\\alpha'
    const normalizedProject = 'd:\\projects\\alpha'
    const workspaceDigest = createHash('sha256').update(`studiumx:teaching-memory-scope:v1\0workspace\0${normalizedWorkspace}`).digest('base64url')
    const projectDigest = createHash('sha256').update(`studiumx:teaching-memory-scope:v1\0project\0${normalizedProject}`).digest('base64url')

    expect(workspaceDigest).toHaveLength(43)
    expect(teachingMemoryScopeDirectory({ ...workspace, workspace: normalizedWorkspace })).toBe(`workspace-${workspaceDigest}.v1`)
    expect(teachingMemoryScopeDirectory({ ...project, project: normalizedProject })).toBe(`project-${projectDigest}.v1`)
    expect(teachingMemoryScopeDirectory(record('user'))).toBe('_global')
  })

  it('writes new user, workspace, and project records to internal scope partitions', async () => {
    const catalog = await createCatalog()
    const user = record('user')
    const workspace = record('workspace', { scope: 'workspace', workspace: '/courses/alpha/lessons/..' })
    const project = record('project', { scope: 'project', workspace: '/courses/alpha', project: '/projects/alpha/chapter/..' })
    await catalog.commit(user)
    await catalog.commit(workspace)
    await catalog.commit(project)

    const expected = [user, workspace, project].map((item) => teachingMemoryScopedRecordFilePath(catalog.rootDir, {
      ...item,
      workspace: item.workspace && normalizeTeachingMemoryScopePath(item.workspace),
      project: item.project && normalizeTeachingMemoryScopePath(item.project)
    }))
    await expect(Promise.all(expected.map((path) => readFile(path, 'utf8')))).resolves.toHaveLength(3)
    await expect(readFile(teachingMemoryRecordFilePath(catalog.rootDir, 'user'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(expected[0]!)).mode & 0o777).toBe(0o600)
  })

  it('retains content-based workspace/project authorization regardless of partition location', async () => {
    const catalog = await createCatalog()
    await catalog.commit(record('user'))
    await catalog.commit(record('workspace-alpha', { scope: 'workspace', workspace: 'C:\\Courses\\Alpha\\lessons\\..' }))
    await catalog.commit(record('workspace-beta', { scope: 'workspace', workspace: 'C:\\Courses\\Beta' }))
    await catalog.commit(record('project-alpha', { scope: 'project', workspace: 'C:\\Courses\\Alpha', project: 'D:\\Projects\\Alpha\\chapter\\..' }))

    await expect(catalog.list({ workspaceRoot: 'c:/courses/alpha' })).resolves.toSatisfy((records) =>
      records.map((item) => item.id).sort().join(',') === 'user,workspace-alpha'
    )
    await expect(catalog.list({ access: { projectRoot: 'd:/projects/alpha' } })).resolves.toSatisfy((records) =>
      records.map((item) => item.id).sort().join(',') === 'project-alpha,user'
    )
    await expect(catalog.find('workspace-alpha', { workspaceRoot: 'C:\\Courses\\Beta' })).rejects.toThrow('Memory not found')
    await expect(catalog.find('project-alpha', { projectRoot: 'D:\\Projects\\Alpha' })).resolves.toMatchObject({ id: 'project-alpha' })
  })

  it('reads mixed scoped, flat canonical, and flat raw legacy records and preserves a discovered raw source on updates and tombstones', async () => {
    const catalog = await createCatalog()
    const flatCanonical = record('flat-canonical')
    const flatRaw = record('flat-raw')
    await writeRecord(teachingMemoryRecordFilePath(catalog.rootDir, flatCanonical.id), flatCanonical)
    const rawPath = await writeRawFlat(catalog.rootDir, flatRaw)
    await catalog.commit(record('scoped'))

    await expect(catalog.list()).resolves.toSatisfy((records) => records.map((item) => item.id).sort().join(',') === 'flat-canonical,flat-raw,scoped')
    const current = await catalog.find(flatRaw.id)
    await catalog.commit({ ...current, content: 'updated legacy source', updatedAt: '2026-07-14T00:01:00.000Z' })
    await expect(readFile(rawPath, 'utf8')).resolves.toContain('updated legacy source')
    await expect(readFile(teachingMemoryScopedRecordFilePath(catalog.rootDir, flatRaw), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(teachingMemoryRecordFilePath(catalog.rootDir, flatRaw.id), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await catalog.commit({ ...(await catalog.find(flatRaw.id)), deletedAt: '2026-07-14T00:02:00.000Z', updatedAt: '2026-07-14T00:02:00.000Z' })
    await expect(catalog.find(flatRaw.id)).rejects.toThrow('Memory not found')
    await expect(readFile(rawPath, 'utf8')).resolves.toContain('deletedAt')
  })

  it('selects byte-identical duplicate copies deterministically and leaves all copies untouched', async () => {
    const catalog = await createCatalog()
    const input = record('duplicate-identical', { scope: 'workspace', workspace: '/courses/alpha' })
    const scopedPath = teachingMemoryScopedRecordFilePath(catalog.rootDir, input)
    const flatCanonicalPath = teachingMemoryRecordFilePath(catalog.rootDir, input.id)
    const rawPath = join(catalog.rootDir, `${input.id}.json`)
    const content = serialized(input)
    await Promise.all([scopedPath, flatCanonicalPath, rawPath].map(async (path) => {
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, content, { mode: 0o600 })
    }))

    const scan = await catalog.scanForLocalDataIndex()
    expect(scan.records).toMatchObject([{ id: input.id }])
    expect(scan.sourcePaths).toEqual([flatCanonicalPath, rawPath, scopedPath].sort())
    expect(scan.recordFingerprints).toEqual([{
      memoryId: input.id,
      fingerprint: createHash('sha256').update(Buffer.from(content)).digest('hex')
    }])
    expect(await Promise.all([scopedPath, flatCanonicalPath, rawPath].map((path) => readFile(path, 'utf8')))).toEqual([content, content, content])
  })

  it('rejects mutation of exact-byte duplicate sources before update, delete/tombstone, or direct commit writes', async () => {
    const catalog = await createCatalog()
    const input = record('duplicate-identical-mutation')
    await catalog.commit(input)
    const scopedPath = teachingMemoryScopedRecordFilePath(catalog.rootDir, input)
    const flatPath = teachingMemoryRecordFilePath(catalog.rootDir, input.id)
    const originalBytes = await readFile(scopedPath)
    await writeFile(flatPath, originalBytes, { mode: 0o600 })
    const store = new TeachingMemoryStore({
      rootDir: catalog.rootDir,
      settingsProvider: async () => defaultSettings(catalog.rootDir),
      nowIso: () => '2026-07-18T00:01:00.000Z'
    })

    await expect(store.update(input.id, { content: 'attempted update' })).rejects.toThrow('multiple accepted durable sources')
    await expect(store.delete(input.id)).rejects.toThrow('multiple accepted durable sources')
    await expect(catalog.commit({ ...input, content: 'attempted direct commit', updatedAt: '2026-07-18T00:02:00.000Z' }))
      .rejects.toThrow('multiple accepted durable sources')
    await expect(catalog.commit({ ...input, deletedAt: '2026-07-18T00:03:00.000Z', updatedAt: '2026-07-18T00:03:00.000Z' }))
      .rejects.toThrow('multiple accepted durable sources')

    expect(await Promise.all([scopedPath, flatPath].map((path) => readFile(path)))).toEqual([originalBytes, originalBytes])
  })

  it('refuses a scoped record scope-partition change before writing or creating a new partition', async () => {
    const catalog = await createCatalog()
    const input = record('scoped-scope-change', { scope: 'workspace', workspace: '/courses/alpha' })
    await catalog.commit(input)
    const normalizedPath = teachingMemoryScopedRecordFilePath(catalog.rootDir, {
      ...input,
      workspace: normalizeTeachingMemoryScopePath(input.workspace)
    })
    const before = await readFile(normalizedPath)
    const changedScope = {
      ...input,
      scope: 'user' as const,
      workspace: undefined,
      project: undefined,
      content: 'attempted partition migration',
      updatedAt: '2026-07-18T00:04:00.000Z'
    }

    await expect(catalog.commit(changedScope)).rejects.toThrow('scope change requires unsafe partition relocation')
    await expect(readFile(normalizedPath)).resolves.toEqual(before)
    await expect(readFile(teachingMemoryScopedRecordFilePath(catalog.rootDir, changedScope))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains C-5 tombstone filtering and malformed-file recovery semantics', async () => {
    const catalog = await createCatalog()
    const tombstone = record('deleted', { deletedAt: '2026-07-14T00:02:00.000Z' })
    await catalog.commit(tombstone)
    const damagedPath = teachingMemoryRecordFilePath(catalog.rootDir, 'damaged')
    await writeFile(damagedPath, '{ not valid JSON', 'utf8')

    await expect(catalog.list()).resolves.toEqual([])
    await expect(catalog.list({ includeDeleted: true })).resolves.toMatchObject([{ id: 'deleted' }])
    await expect(catalog.find('deleted')).rejects.toThrow('Memory not found')
    expect(catalog.getRecoveryIssues()).toEqual<TeachingMemoryCatalogRecoveryIssue[]>([
      expect.objectContaining({ filePath: damagedPath, reason: 'invalid_json' })
    ])
  })

  it('rejects differing duplicate candidates from every read, direct lookup, and index projection', async () => {
    const catalog = await createCatalog()
    const input = record('duplicate-conflict')
    await writeRecord(teachingMemoryRecordFilePath(catalog.rootDir, input.id), input)
    await writeRawFlat(catalog.rootDir, { ...input, content: 'different bytes' })

    await expect(catalog.list()).resolves.toEqual([])
    await expect(catalog.find(input.id)).rejects.toThrow('Memory not found')
    await expect(catalog.commit(input)).rejects.toThrow('conflicting durable sources')
    const scan = await catalog.scanForLocalDataIndex()
    expect(scan.records).toEqual([])
    expect(scan.recordFingerprints).toEqual([])
    expect(scan.recoveryIssues.filter((issue) => issue.reason === 'duplicate_conflict')).toHaveLength(2)
  })

  it('rejects scoped directory mismatches after parsing and normalizing the record', async () => {
    const catalog = await createCatalog()
    const input = record('wrong-partition', { scope: 'workspace', workspace: '/courses/alpha' })
    const wrongPath = join(catalog.rootDir, '_global', teachingMemoryRecordFilePath('', input.id))
    await writeRecord(wrongPath, input)

    await expect(catalog.list()).resolves.toEqual([])
    expect(catalog.getRecoveryIssues()).toEqual<TeachingMemoryCatalogRecoveryIssue[]>([
      expect.objectContaining({ filePath: wrongPath, reason: 'scope_mismatch' })
    ])
  })

  it('does not follow root, partition, or record symlinks; ignores arbitrary/deep directories', async () => {
    const rootCatalog = await createCatalog()
    const external = await mkdtemp(join(tmpdir(), 'studiumx-teaching-memory-external-'))
    temporaryRoots.push(external)
    await rm(rootCatalog.rootDir, { recursive: true, force: true })
    await symlink(external, rootCatalog.rootDir)
    await expect(rootCatalog.list()).resolves.toEqual([])
    expect(rootCatalog.getRecoveryIssues()).toEqual([expect.objectContaining({ filePath: rootCatalog.rootDir, reason: 'unsafe_path' })])

    const catalog = await createCatalog()
    await mkdir(join(catalog.rootDir, 'arbitrary-dir'))
    await mkdir(join(catalog.rootDir, '_global', 'nested'), { recursive: true })
    await symlink(external, join(catalog.rootDir, 'workspace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.v1'))
    await symlink(join(external, 'outside.json'), join(catalog.rootDir, '_global', 'memory-b3V0c2lkZQ.json'))
    await expect(catalog.list()).resolves.toEqual([])
    expect(catalog.getRecoveryIssues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'unrecognized_partition' }),
      expect.objectContaining({ reason: 'deep_directory' }),
      expect.objectContaining({ reason: 'unsafe_path' })
    ]))
  })

  it('canonicalizes Windows scope paths independently of the host platform', () => {
    expect(normalizeTeachingMemoryScopePath('C:\\Study\\Course\\..\\Course\\')).toBe('c:\\study\\course')
    expect(normalizeTeachingMemoryScopePath('c:/STUDY/course')).toBe('c:\\study\\course')
  })
})
