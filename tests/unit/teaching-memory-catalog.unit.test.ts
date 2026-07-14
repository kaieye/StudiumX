import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TeachingMemoryCatalog,
  normalizeTeachingMemoryScopePath,
  teachingMemoryRecordFilePath,
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })))
})

describe('TeachingMemoryCatalog', () => {
  it('finds a committed record by direct ID without scanning the catalog', async () => {
    const catalog = await createCatalog()
    const id = 'direct/id:with?unsafe*filename'
    await catalog.commit(record(id))
    const readAll = vi.spyOn(catalog, 'readAll')

    await expect(catalog.find(id)).resolves.toMatchObject({ id, content: `Memory ${id}` })
    expect(readAll).not.toHaveBeenCalled()
    await expect(readFile(teachingMemoryRecordFilePath(catalog.rootDir, id), 'utf8')).resolves.toContain(`"id": "${id}"`)
  })

  it('isolates workspace and project records while retaining user records', async () => {
    const catalog = await createCatalog()
    await catalog.commit(record('user'))
    await catalog.commit(record('workspace-alpha', {
      scope: 'workspace',
      workspace: 'C:\\Courses\\Alpha\\lessons\\..'
    }))
    await catalog.commit(record('workspace-beta', {
      scope: 'workspace',
      workspace: 'C:\\Courses\\Beta'
    }))
    await catalog.commit(record('project-alpha', {
      scope: 'project',
      workspace: 'C:\\Courses\\Alpha',
      project: 'D:\\Projects\\Alpha\\chapter\\..'
    }))

    await expect(catalog.list({ workspaceRoot: 'c:/courses/alpha' })).resolves.toSatisfy((records) =>
      records.map((item) => item.id).sort().join(',') === 'user,workspace-alpha'
    )
    await expect(catalog.list({ workspaceRoot: 'c:/courses/beta' })).resolves.toSatisfy((records) =>
      records.map((item) => item.id).sort().join(',') === 'user,workspace-beta'
    )
    await expect(catalog.list({ access: { projectRoot: 'd:/projects/alpha' } })).resolves.toSatisfy((records) =>
      records.map((item) => item.id).sort().join(',') === 'project-alpha,user'
    )
    await expect(catalog.find('workspace-alpha', { workspaceRoot: 'C:\\Courses\\Beta' })).rejects.toThrow('Memory not found')
    await expect(catalog.find('project-alpha', { projectRoot: 'D:\\Projects\\Alpha' })).resolves.toMatchObject({ id: 'project-alpha' })
  })

  it('canonicalizes Windows scope paths independently of the host platform', () => {
    expect(normalizeTeachingMemoryScopePath('C:\\Study\\Course\\..\\Course\\')).toBe('c:\\study\\course')
    expect(normalizeTeachingMemoryScopePath('c:/STUDY/course')).toBe('c:\\study\\course')
  })

  it('atomically replaces a record at its canonical file without leaving temporary files', async () => {
    const catalog = await createCatalog()
    await catalog.commit(record('atomic', { content: 'first version' }))
    await catalog.commit(record('atomic', {
      content: 'replacement version',
      updatedAt: '2026-07-14T00:01:00.000Z'
    }))

    await expect(catalog.find('atomic')).resolves.toMatchObject({ content: 'replacement version' })
    await expect(readFile(teachingMemoryRecordFilePath(catalog.rootDir, 'atomic'), 'utf8')).resolves.toContain('replacement version')
    await expect(readdir(catalog.rootDir)).resolves.toEqual([teachingMemoryRecordFilePath('', 'atomic')])
  })

  it('filters tombstones from list and direct-ID find unless explicitly included in a list query', async () => {
    const catalog = await createCatalog()
    await catalog.commit(record('deleted', { deletedAt: '2026-07-14T00:02:00.000Z' }))

    await expect(catalog.list()).resolves.toEqual([])
    await expect(catalog.list({ includeDeleted: true })).resolves.toMatchObject([{ id: 'deleted' }])
    await expect(catalog.find('deleted')).rejects.toThrow('Memory not found')
  })

  it('recovers from malformed files, reports them, and allows an atomic repair', async () => {
    const catalog = await createCatalog()
    await catalog.commit(record('healthy'))
    const damagedPath = teachingMemoryRecordFilePath(catalog.rootDir, 'damaged')
    await writeFile(damagedPath, '{ not valid JSON', 'utf8')

    await expect(catalog.list()).resolves.toMatchObject([{ id: 'healthy' }])
    expect(catalog.getRecoveryIssues()).toEqual<TeachingMemoryCatalogRecoveryIssue[]>([
      expect.objectContaining({ filePath: damagedPath, reason: 'invalid_json' })
    ])

    await catalog.commit(record('damaged', { content: 'repaired' }))
    await expect(catalog.list()).resolves.toSatisfy((records) => records.map((item) => item.id).sort().join(',') === 'damaged,healthy')
    expect(catalog.getRecoveryIssues()).toEqual([])
  })
})
