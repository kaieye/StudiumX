import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { TeachingMemoryCatalog, teachingMemoryRecordFilePath, teachingMemoryScopedRecordFilePath } from '../../src/main/teaching-memory-catalog'
import {
  TeachingMemoryLegacyMigrationDryRun,
  parseReadonlyDryRunRequest
} from '../../src/main/teaching-memory-catalog/migration-dry-run'
import { TeachingMemoryStore } from '../../src/main/teaching-memory'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingMemoryRecord } from '../../src/shared/teaching-types'

const temporaryRoots: string[] = []

async function createCatalog(): Promise<TeachingMemoryCatalog> {
  const rootDir = await mkdtemp(join(tmpdir(), 'studiumx-memory-dry-run-'))
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

async function snapshotMemoryTree(rootDir: string): Promise<Array<{ path: string; bytes: string; mtimeMs: number }>> {
  const entries = await readdir(rootDir, { recursive: true, withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort()
  return Promise.all(files.map(async (path) => ({
    path: path.slice(rootDir.length),
    bytes: (await readFile(path)).toString('base64'),
    mtimeMs: (await stat(path)).mtimeMs
  })))
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })))
})

describe.runIf(process.platform !== 'win32')('TeachingMemoryLegacyMigrationDryRun', () => {
  it('creates aggregate-only intent + receipt without mutating Memory bytes, mtimes, or layout', async () => {
    const catalog = await createCatalog()
    const legacy = record('legacy-flat-eligible')
    await writeRawFlat(catalog.rootDir, legacy)
    const before = await snapshotMemoryTree(catalog.rootDir)
    let nowMs = Date.parse('2026-07-20T00:00:00.000Z')
    const dryRun = new TeachingMemoryLegacyMigrationDryRun(catalog, {
      nowMs: () => nowMs,
      idGenerator: () => 'intent-preview-1',
      ttlMs: 60_000
    })

    const intent = await dryRun.previewIntent()
    expect(intent).toEqual({
      intentId: 'intent-preview-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      expiresAt: '2026-07-20T00:01:00.000Z',
      authorizationClass: 'readonly_preview_only',
      accessClass: 'catalog',
      disposition: 'preview_only',
      preflight: {
        legacyFlatEligibleCount: 1,
        alreadyPartitionedCount: 0,
        blockedDuplicateCount: 0,
        blockedRecoveryIssueCount: 0,
        migrationReady: true
      },
      destructiveAuthorized: false,
      memoryMutated: false
    })

    nowMs = Date.parse('2026-07-20T00:00:30.000Z')
    const receipt = await dryRun.completeReceipt(intent.intentId)
    expect(receipt).toEqual({
      intentId: 'intent-preview-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      completedAt: '2026-07-20T00:00:30.000Z',
      authorizationClass: 'readonly_preview_only',
      accessClass: 'catalog',
      disposition: 'preview_only',
      preflight: {
        legacyFlatEligibleCount: 1,
        alreadyPartitionedCount: 0,
        blockedDuplicateCount: 0,
        blockedRecoveryIssueCount: 0,
        migrationReady: true
      },
      destructiveAuthorized: false,
      memoryMutated: false
    })

    expect(await snapshotMemoryTree(catalog.rootDir)).toEqual(before)
    expect(JSON.stringify(intent)).not.toContain(catalog.rootDir)
    expect(JSON.stringify(intent)).not.toContain(legacy.id)
    expect(JSON.stringify(intent)).not.toContain(legacy.content)
    expect(JSON.stringify(receipt)).not.toContain(catalog.rootDir)
    expect(JSON.stringify(receipt)).not.toContain(legacy.id)
    expect(JSON.stringify(receipt)).not.toContain(legacy.content)
  })

  it('does not create a missing Memory root during dry-run', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'studiumx-memory-dry-run-missing-parent-'))
    temporaryRoots.push(parent)
    const rootDir = join(parent, 'memory')
    const catalog = new TeachingMemoryCatalog(rootDir)
    const beforeEntries = await readdir(parent)
    const beforeParent = await stat(parent)
    const dryRun = new TeachingMemoryLegacyMigrationDryRun(catalog, {
      nowMs: () => Date.parse('2026-07-20T00:00:00.000Z'),
      idGenerator: () => 'intent-missing-root'
    })

    const intent = await dryRun.previewIntent()
    expect(intent.disposition).toBe('not_ready')
    expect(intent.preflight.migrationReady).toBe(false)
    expect(intent.destructiveAuthorized).toBe(false)
    expect(intent.memoryMutated).toBe(false)

    await expect(stat(rootDir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(parent)).toEqual(beforeEntries)
    expect((await stat(parent)).mtimeMs).toBe(beforeParent.mtimeMs)
  })

  it('fail-closes privileged path/locator request fields', async () => {
    const catalog = await createCatalog()
    const legacy = record('legacy-should-stay')
    await writeRawFlat(catalog.rootDir, legacy)
    const before = await snapshotMemoryTree(catalog.rootDir)
    const dryRun = new TeachingMemoryLegacyMigrationDryRun(catalog, {
      nowMs: () => Date.parse('2026-07-20T00:00:00.000Z'),
      idGenerator: () => 'should-not-mint'
    })

    const rejected = await dryRun.previewIntent({
      path: catalog.rootDir,
      root: catalog.rootDir,
      target: '/tmp/evil',
      checksum: 'abc'
    })
    expect(rejected).toMatchObject({
      intentId: '',
      disposition: 'not_authorized',
      destructiveAuthorized: false,
      memoryMutated: false,
      preflight: {
        legacyFlatEligibleCount: 0,
        alreadyPartitionedCount: 0,
        blockedDuplicateCount: 0,
        blockedRecoveryIssueCount: 0,
        migrationReady: false
      }
    })
    expect(await snapshotMemoryTree(catalog.rootDir)).toEqual(before)
  })

  it('scopes eligible aggregates to trusted access and keeps catalog-wide blockers', async () => {
    const catalog = await createCatalog()
    const inScope = record('workspace-alpha', { scope: 'workspace', workspace: '/courses/alpha' })
    const outOfScope = record('workspace-beta', { scope: 'workspace', workspace: '/courses/beta' })
    await writeRawFlat(catalog.rootDir, inScope)
    await writeRawFlat(catalog.rootDir, outOfScope)
    await writeFile(join(catalog.rootDir, 'invalid.json'), '{not json', { mode: 0o600 })
    const dryRun = new TeachingMemoryLegacyMigrationDryRun(catalog, {
      nowMs: () => Date.parse('2026-07-20T00:00:00.000Z'),
      idGenerator: () => 'intent-scoped'
    })

    const intent = await dryRun.previewIntent({ access: { workspaceRoot: '/courses/alpha' } })
    expect(intent.accessClass).toBe('workspace')
    expect(intent.disposition).toBe('blocked')
    expect(intent.preflight).toMatchObject({
      legacyFlatEligibleCount: 1,
      alreadyPartitionedCount: 0,
      blockedRecoveryIssueCount: 1,
      migrationReady: false
    })
    expect(JSON.stringify(intent)).not.toContain('/courses/alpha')
    expect(JSON.stringify(intent)).not.toContain(inScope.id)
    expect(JSON.stringify(intent)).not.toContain(outOfScope.id)
  })

  it('expires short-lived intents and refuses unknown receipt ids without mutation', async () => {
    const catalog = await createCatalog()
    const legacy = record('legacy-expire')
    await writeRawFlat(catalog.rootDir, legacy)
    const before = await snapshotMemoryTree(catalog.rootDir)
    let nowMs = Date.parse('2026-07-20T00:00:00.000Z')
    const dryRun = new TeachingMemoryLegacyMigrationDryRun(catalog, {
      nowMs: () => nowMs,
      idGenerator: () => 'intent-expire',
      ttlMs: 1_000
    })

    const intent = await dryRun.previewIntent()
    expect(intent.disposition).toBe('preview_only')

    nowMs = Date.parse('2026-07-20T00:00:02.000Z')
    const expired = await dryRun.completeReceipt(intent.intentId)
    expect(expired.disposition).toBe('expired')
    expect(expired.destructiveAuthorized).toBe(false)
    expect(expired.memoryMutated).toBe(false)

    const unknown = await dryRun.completeReceipt('never-issued')
    expect(unknown.disposition).toBe('expired')
    expect(await snapshotMemoryTree(catalog.rootDir)).toEqual(before)
  })

  it('blocks same-ID flat/scoped duplicates and never treats dry-run as destructive consent', async () => {
    const catalog = await createCatalog()
    const duplicate = record('flat-and-scoped')
    await catalog.commit(duplicate)
    const scopedBytes = await readFile(teachingMemoryScopedRecordFilePath(catalog.rootDir, duplicate))
    await writeFile(teachingMemoryRecordFilePath(catalog.rootDir, duplicate.id), scopedBytes, { mode: 0o600 })
    const before = await snapshotMemoryTree(catalog.rootDir)
    const dryRun = new TeachingMemoryLegacyMigrationDryRun(catalog, {
      nowMs: () => Date.parse('2026-07-20T00:00:00.000Z'),
      idGenerator: () => 'intent-duplicate'
    })

    const intent = await dryRun.previewIntent()
    expect(intent.disposition).toBe('blocked')
    expect(intent.preflight.blockedDuplicateCount).toBe(1)
    expect(intent.destructiveAuthorized).toBe(false)
    expect(() => dryRun.authorizeDestructiveMigration()).toThrow(/not authorized/i)
    expect(await snapshotMemoryTree(catalog.rootDir)).toEqual(before)
  })

  it('exposes dry-run only through main TeachingMemoryStore facade without path input', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'studiumx-memory-store-dry-run-'))
    temporaryRoots.push(rootDir)
    const store = new TeachingMemoryStore({
      rootDir,
      settingsProvider: async () => defaultSettings()
    })
    await writeRawFlat(rootDir, record('store-flat'))
    const before = await snapshotMemoryTree(rootDir)

    const intent = await store.previewLegacyMigrationDryRun()
    expect(intent.authorizationClass).toBe('readonly_preview_only')
    expect(intent.destructiveAuthorized).toBe(false)
    expect(intent.memoryMutated).toBe(false)
    expect(intent.disposition).toBe('preview_only')

    const receipt = await store.completeLegacyMigrationDryRun(intent.intentId)
    expect(receipt.destructiveAuthorized).toBe(false)
    expect(receipt.memoryMutated).toBe(false)
    expect(receipt.disposition).toBe('preview_only')
    expect(await snapshotMemoryTree(rootDir)).toEqual(before)

    const rejected = await store.previewLegacyMigrationDryRun({ rootDir, path: rootDir })
    expect(rejected.disposition).toBe('not_authorized')
  })

  it('parseReadonlyDryRunRequest accepts only trusted access bags', () => {
    expect(parseReadonlyDryRunRequest(undefined)).toEqual({ ok: true, accessClass: 'catalog' })
    expect(parseReadonlyDryRunRequest({ access: { workspaceRoot: '/courses/alpha' } })).toEqual({
      ok: true,
      access: { workspaceRoot: '/courses/alpha' },
      accessClass: 'workspace'
    })
    expect(parseReadonlyDryRunRequest({ access: { projectRoot: '/projects/alpha' } })).toEqual({
      ok: true,
      access: { projectRoot: '/projects/alpha' },
      accessClass: 'project'
    })
    expect(parseReadonlyDryRunRequest({ path: '/tmp' }).ok).toBe(false)
    expect(parseReadonlyDryRunRequest({ access: { workspaceRoot: '/x', extra: 1 } }).ok).toBe(false)
    expect(parseReadonlyDryRunRequest({ access: {} }).ok).toBe(false)
    expect(parseReadonlyDryRunRequest({ access: { workspaceRoot: '   ' } }).ok).toBe(false)
  })

  it('aggregates recovery/unsafe inputs without leaking locators in dry-run output', async () => {
    const catalog = await createCatalog()
    const legacy = record('blocked-by-recovery', { scope: 'workspace', workspace: '/courses/alpha' })
    await writeRawFlat(catalog.rootDir, legacy)
    await writeRecord(join(catalog.rootDir, '_global', teachingMemoryRecordFilePath('', legacy.id).replace(/^[/\\]+/, '')), legacy)
    await writeFile(join(catalog.rootDir, 'invalid.json'), '{not json', { mode: 0o600 })
    const external = await mkdtemp(join(tmpdir(), 'studiumx-memory-dry-run-external-'))
    temporaryRoots.push(external)
    await symlink(external, join(catalog.rootDir, 'workspace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.v1'))
    const before = await snapshotMemoryTree(catalog.rootDir)
    const dryRun = new TeachingMemoryLegacyMigrationDryRun(catalog, {
      nowMs: () => Date.parse('2026-07-20T00:00:00.000Z'),
      idGenerator: () => 'intent-recovery'
    })

    const intent = await dryRun.previewIntent()
    expect(intent.disposition).toBe('blocked')
    expect(intent.preflight.migrationReady).toBe(false)
    expect(intent.preflight.blockedRecoveryIssueCount).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(intent)).not.toContain(catalog.rootDir)
    expect(JSON.stringify(intent)).not.toContain(legacy.id)
    expect(JSON.stringify(intent)).not.toContain(legacy.content)
    expect(JSON.stringify(intent)).not.toContain(external)
    expect(await snapshotMemoryTree(catalog.rootDir)).toEqual(before)
  })
})
