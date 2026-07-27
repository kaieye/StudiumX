import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TeachingMemoryCatalog, teachingMemoryRecordFilePath } from '../../src/main/teaching-memory-catalog'
import { TeachingMemoryRecall } from '../../src/main/teaching-memory-recall'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingMemoryRecord } from '../../src/shared/teaching-types'

const temporaryRoots: string[] = []

async function createCatalog(): Promise<TeachingMemoryCatalog> {
  const rootDir = await mkdtemp(join(tmpdir(), 'studiumx-teaching-memory-recall-'))
  temporaryRoots.push(rootDir)
  return new TeachingMemoryCatalog(rootDir)
}

function legacyRecord(id: string): TeachingMemoryRecord {
  return {
    id,
    content: 'Sensitive legacy Memory content must not enter diagnostics.',
    scope: 'user',
    tags: [],
    confidence: 1,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z'
  }
}

async function writeLegacyRecord(catalog: TeachingMemoryCatalog, record: TeachingMemoryRecord): Promise<void> {
  const path = teachingMemoryRecordFilePath(catalog.rootDir, record.id)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })))
})

describe.runIf(process.platform !== 'win32')('TeachingMemoryRecall diagnostics', () => {
  it('returns only renderer-safe aggregate diagnostics from the catalog preflight', async () => {
    const catalog = await createCatalog()
    const record = legacyRecord('legacy-diagnostic-record')
    await writeLegacyRecord(catalog, record)
    const recall = new TeachingMemoryRecall({
      catalog,
      settingsProvider: async () => defaultSettings(catalog.rootDir)
    })
    recall.setLastInjected([record.id])

    const diagnostics = await recall.diagnostics()

    expect(diagnostics).toEqual({
      enabled: true,
      activeCount: 1,
      tombstoneCount: 0,
      lastInjectedCount: 1,
      legacyMigrationPreflight: {
        legacyFlatEligibleCount: 1,
        alreadyPartitionedCount: 0,
        blockedDuplicateCount: 0,
        blockedRecoveryIssueCount: 0,
        migrationReady: true
      },
      platformIoProfile: 'pathname_default',
      platformCapabilityCode: 'ok',
      platformCapabilityMessageKey: 'platformCapability.pathnameDefault'
    })
    expect(JSON.stringify(diagnostics)).not.toContain(catalog.rootDir)
    expect(JSON.stringify(diagnostics)).not.toContain(record.id)
    expect(JSON.stringify(diagnostics)).not.toContain(record.content)
    expect(Object.values(diagnostics.legacyMigrationPreflight).every((value) => typeof value === 'number' || typeof value === 'boolean')).toBe(true)
  })
})
