import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { TeachingMemoryCatalog } from '../../src/main/teaching-memory-catalog'
import { teachingMemoryRecordFileName, teachingMemoryScopeDirectory } from '../../src/main/teaching-memory-catalog/record-file'
import type { TeachingMemoryRecord } from '../../src/shared/teaching-types'

const temporaryRoots: string[] = []

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

describe('TeachingMemoryCatalog pathname_default (ADR-0012)', () => {
  it('lists and commits through trusted-root pathname persistence (non-CAS)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'studiumx-memory-pathname-'))
    temporaryRoots.push(rootDir)
    const catalog = new TeachingMemoryCatalog(rootDir, { profile: 'pathname_default' })
    expect(catalog.ioProfile).toBe('pathname_default')

    const user = record('user-1', { content: 'Pathname non-CAS memory' })
    await catalog.commit(user)

    const listed = await catalog.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      id: 'user-1',
      content: 'Pathname non-CAS memory',
      scope: 'user'
    })

    const partition = teachingMemoryScopeDirectory(user)
    const fileName = teachingMemoryRecordFileName(user.id)
    const onDisk = await readFile(join(rootDir, partition, fileName), 'utf8')
    expect(onDisk).toContain('Pathname non-CAS memory')
  })

  it('updates an existing record without claiming CAS semantics', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'studiumx-memory-pathname-overwrite-'))
    temporaryRoots.push(rootDir)
    const catalog = new TeachingMemoryCatalog(rootDir, { profile: 'pathname_default' })
    const first = record('upd-1', { content: 'v1' })
    await catalog.commit(first)
    await catalog.commit({ ...first, content: 'v2', updatedAt: '2026-07-14T01:00:00.000Z' })
    const listed = await catalog.list()
    expect(listed[0]?.content).toBe('v2')
  })

  it('reads legacy flat JSON files already under the root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'studiumx-memory-pathname-flat-'))
    temporaryRoots.push(rootDir)
    const flat = record('flat-1', { content: 'legacy flat' })
    await writeFile(join(rootDir, `${flat.id}.json`), `${JSON.stringify(flat, null, 2)}\n`, 'utf8')
    const catalog = new TeachingMemoryCatalog(rootDir, { profile: 'pathname_default' })
    const listed = await catalog.list()
    expect(listed.map((entry) => entry.id)).toContain('flat-1')
  })

  it('reports unavailable profile without inventing descriptor success', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'studiumx-memory-unavailable-'))
    temporaryRoots.push(rootDir)
    const catalog = new TeachingMemoryCatalog(rootDir, { profile: 'unavailable' })
    expect(catalog.ioProfile).toBe('unavailable')
    await expect(catalog.list()).resolves.toEqual([])
    await expect(catalog.commit(record('nope'))).rejects.toThrow()
  })
})
