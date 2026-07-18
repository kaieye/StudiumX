import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentConversationRecord, AgentConversationSummary, TeachingMemoryRecord, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'
import { TeachingMemoryCatalog } from '../../src/main/teaching-memory-catalog'
import { LocalDataIndex, type LocalDataIndexTestHooks } from '../../src/main/local-data-index'
import { LOCAL_DATA_INDEX_MIGRATIONS, migrateLocalDataIndex } from '../../src/main/local-data-index/schema-migration'
import { createIsolatedTestRuntime, type IsolatedTestRuntime } from '../helpers/runtime-isolation'

let runtime: IsolatedTestRuntime
beforeEach(async () => { runtime = await createIsolatedTestRuntime('local-data-index-unit') })
afterEach(async () => { await runtime.cleanup() })

const instant = '2026-07-11T12:00:00.000Z'

function record(id: string): AgentConversationRecord {
  return {
    id,
    title: `Conversation ${id}`,
    createdAt: instant,
    updatedAt: instant,
    relativePath: `conversation/${id}.md`,
    absolutePath: join(runtime.workspaceDir, 'conversation', `${id}.md`),
    messageCount: 1,
    turns: [{
      id: `${id}-turn`, role: 'assistant', content: 'private answer must not be projected', createdAt: instant,
      metadata: { version: 1, runUsage: { promptTokens: 3, completionTokens: 5, totalTokens: 8, providerCalls: 1, toolCalls: 0, toolErrors: 0, iterations: 1, childRuns: 0, durationMs: 12 } }
    }]
  }
}

function summary(conversations: AgentConversationSummary[]): TeachingWorkspaceSummary {
  return { id: 'ws-1', name: 'Visible workspace', rootPath: runtime.workspaceDir, conversations } as TeachingWorkspaceSummary
}

async function writeConversation(relativePath: string, value: AgentConversationRecord): Promise<void> {
  await mkdir(join(runtime.workspaceDir, relativePath, '..'), { recursive: true })
  await writeFile(join(runtime.workspaceDir, relativePath), JSON.stringify(value), 'utf8')
}

function makeIndex(input: { conversations?: AgentConversationSummary[]; temporary?: AgentConversationSummary[]; memory?: TeachingMemoryRecord[]; scanMemory?: () => ReturnType<TeachingMemoryCatalog['scanForLocalDataIndex']>; testHooks?: LocalDataIndexTestHooks } = {}) {
  const conversations = input.conversations ?? []
  return new LocalDataIndex({
    appDataRoot: runtime.userDataDir,
    sources: {
      listWorkspaces: async () => [{ workspaceId: 'ws-1', workspaceName: 'Visible workspace', rootPath: runtime.workspaceDir, summary: summary(conversations) }],
      listTemporaryConversations: async () => input.temporary ?? [],
      ...(input.scanMemory ? { scanMemory: input.scanMemory } : { listMemory: async () => input.memory ?? [] })
    },
    ...(input.testHooks ? { testHooks: input.testHooks } : {})
  })
}

describe('local data SQLite index migrations', () => {
  it('is idempotent and rejects a stable migration checksum conflict', () => {
    const db = new Database(join(runtime.userDataDir, 'migration.sqlite'))
    try {
      migrateLocalDataIndex(db)
      migrateLocalDataIndex(db)
      expect(db.prepare('SELECT COUNT(*) count FROM schema_migration').get()).toEqual({ count: LOCAL_DATA_INDEX_MIGRATIONS.length })
      db.prepare('UPDATE schema_migration SET checksum = ? WHERE id = ?').run('conflict', LOCAL_DATA_INDEX_MIGRATIONS[0]!.id)
      expect(() => migrateLocalDataIndex(db)).toThrow(/checksum conflict/i)
    } finally { db.close() }
  })
})

describe('local data SQLite availability', () => {
  it('quarantines a corrupt disposable database and opens an incomplete replacement without touching canonical sources', async () => {
    await writeFile(join(runtime.userDataDir, 'studiumx-index.sqlite'), 'not a sqlite database', 'utf8')
    const index = makeIndex()
    expect(index.open()).toBe(true)
    expect(index.status).toBe('incomplete')
    expect(index.tokenEvidenceAdapters()).toBeNull()
    const files = await (await import('node:fs/promises')).readdir(runtime.userDataDir)
    expect(files.some((name) => name.startsWith('studiumx-index.sqlite.quarantined-'))).toBe(true)
  })
})

describe('local data SQLite projections', () => {
  it('rebuilds a safe SQLite title from a legacy raw archive without modifying its bytes', async () => {
    const secret = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const value = record('legacy-private-title')
    value.title = `Legacy title credential ${secret}`
    value.turns = [{ id: 'legacy-turn', role: 'user', content: `OAuth review credential ${secret}`, createdAt: instant }]
    const relativeJson = 'conversation/legacy-private-title.json'
    await writeConversation(relativeJson, value)
    const sourcePath = join(runtime.workspaceDir, relativeJson)
    const sourceBytes = await readFile(sourcePath, 'utf8')
    const catalogSummary = {
      ...value,
      workspaceId: 'ws-1',
      relativePath: 'conversation/legacy-private-title.md',
      absolutePath: join(runtime.workspaceDir, 'conversation/legacy-private-title.md')
    }

    const index = makeIndex({ conversations: [catalogSummary] })
    await index.rebuild()
    expect(index.status).toBe('ready')
    index.close()

    expect(await readFile(sourcePath, 'utf8')).toBe(sourceBytes)
    const db = new Database(index.path, { readonly: true })
    try {
      const row = db.prepare('SELECT title, turn_projection_json FROM conversation_projection WHERE conversation_id = ?').get(value.id) as { title: string; turn_projection_json: string }
      expect(row.title).toBe('Legacy title credential [redacted]')
      expect(JSON.stringify(row)).not.toContain(secret)
    } finally { db.close() }
  })
  it('indexes flat and UTC-partitioned conversations, sealed+active ledgers, and memory metadata without memory content', async () => {
    const flat = record('flat')
    const partitioned = record('partitioned')
    await writeConversation('conversation/flat.json', flat)
    await writeConversation('conversation/2026/07/partitioned.json', { ...partitioned, relativePath: 'conversation/2026/07/partitioned.md', absolutePath: join(runtime.workspaceDir, 'conversation/2026/07/partitioned.md') })
    await mkdir(join(runtime.workspaceDir, '.studiumx'), { recursive: true })
    const oldLedger = { version: 1, entryId: 'entry-old', type: 'conversation_snapshot', createdAt: '2026-07-11T12:01:00.000Z', conversation: { id: 'flat', title: 'flat', updatedAt: instant, messageCount: 1 }, evidence: { runUsage: { totalTokens: 9 } } }
    const newLedger = { ...oldLedger, entryId: 'entry-new', createdAt: '2026-07-11T12:02:00.000Z', evidence: { runUsage: { totalTokens: 11 } } }
    await writeFile(join(runtime.workspaceDir, '.studiumx', 'learning-work.sealed-2026-07-000001.jsonl'), `${JSON.stringify(oldLedger)}\n`)
    await writeFile(join(runtime.workspaceDir, '.studiumx', 'learning-work.jsonl'), `${JSON.stringify(newLedger)}\n`)
    const memories: TeachingMemoryRecord[] = [{ id: 'mem-secret', content: 'do not place this text in SQLite', scope: 'user', tags: ['tag-a', 'tag-b'], confidence: 0.9, createdAt: instant, updatedAt: instant }]
    const index = makeIndex({
      conversations: [
        { ...flat, relativePath: 'conversation/flat.md', absolutePath: join(runtime.workspaceDir, 'conversation/flat.md') },
        { ...partitioned, relativePath: 'conversation/2026/07/partitioned.md', absolutePath: join(runtime.workspaceDir, 'conversation/2026/07/partitioned.md') }
      ],
      memory: memories
    })
    expect(index.open()).toBe(true)
    await index.rebuild()
    expect(index.status).toBe('ready')
    expect(await index.isCompleteForCurrentSources()).toBe(true)
    const adapters = index.tokenEvidenceAdapters()
    expect(adapters).not.toBeNull()
    await expect(adapters!.conversations.read('ws-1', 'flat')).resolves.toMatchObject({ state: 'readable', record: { turns: [{ content: '' }] } })
    const ledger = await adapters!.ledger.read({ workspaceId: 'ws-1', workspaceName: 'Visible workspace', rootPath: runtime.workspaceDir, summary: summary([]) })
    expect(ledger.latestByConversation.get('flat')?.usage.totalTokens).toBe(11)
    index.close()

    const db = new Database(join(runtime.userDataDir, 'studiumx-index.sqlite'), { readonly: true })
    try {
      const columns = db.prepare('PRAGMA table_info(memory_projection)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).not.toContain('content')
      expect(JSON.stringify(db.prepare('SELECT * FROM memory_projection').all())).not.toContain('do not place this text in SQLite')
      const projectedTurns = JSON.stringify(db.prepare('SELECT turn_projection_json FROM conversation_projection').all())
      expect(projectedTurns).not.toContain('private answer must not be projected')
      expect(projectedTurns).not.toContain('\"content\"')
      expect(db.prepare('SELECT entry_id FROM learning_work_projection ORDER BY entry_id').all()).toEqual([{ entry_id: 'entry-new' }, { entry_id: 'entry-old' }])
    } finally { db.close() }
  })

  it('uses canonical durable JSONL discovery, excluding illegal, directory, and symlink sealed candidates', async () => {
    await mkdir(join(runtime.workspaceDir, '.studiumx'), { recursive: true })
    const ledgerDirectory = join(runtime.workspaceDir, '.studiumx')
    const ledger = (entryId: string, totalTokens: number) => JSON.stringify({
      version: 1, entryId, type: 'conversation_snapshot', createdAt: instant,
      conversation: { id: 'flat', title: 'flat', updatedAt: instant, messageCount: 1 },
      evidence: { runUsage: { totalTokens } }
    })
    await writeFile(join(ledgerDirectory, 'learning-work.sealed-2026-07-000001.jsonl'), `${ledger('accepted-sealed', 9)}\n`)
    await writeFile(join(ledgerDirectory, 'learning-work.jsonl'), `${ledger('accepted-active', 11)}\n`)
    await writeFile(join(ledgerDirectory, 'learning-work.sealed-2026-13-000002.jsonl'), `${ledger('invalid-month', 101)}\n`)
    await writeFile(join(ledgerDirectory, 'learning-work.sealed-2026-07-000000.jsonl'), `${ledger('invalid-sequence', 102)}\n`)
    await mkdir(join(ledgerDirectory, 'learning-work.sealed-2026-07-000002.jsonl'))
    const symlinkTarget = join(ledgerDirectory, 'outside-learning-work.jsonl')
    await writeFile(symlinkTarget, `${ledger('symlink', 103)}\n`)
    await symlink(symlinkTarget, join(ledgerDirectory, 'learning-work.sealed-2026-07-000003.jsonl'))

    const index = makeIndex()
    expect(index.open()).toBe(true)
    await index.rebuild()

    // The derived set matches durable-jsonl's canonical source set, so ignored
    // candidates neither project rows nor make a healthy projection incomplete.
    expect(index.status).toBe('ready')
    expect(await index.isCompleteForCurrentSources()).toBe(true)
    const db = new Database(index.path, { readonly: true })
    try {
      expect(db.prepare('SELECT entry_id FROM learning_work_projection ORDER BY entry_id').all()).toEqual([
        { entry_id: 'accepted-active' },
        { entry_id: 'accepted-sealed' }
      ])
      expect(db.prepare("SELECT source_path AS path FROM source_provenance WHERE source_kind = 'learning_work_jsonl' ORDER BY source_path").all()).toEqual([
        { path: join(ledgerDirectory, 'learning-work.jsonl') },
        { path: join(ledgerDirectory, 'learning-work.sealed-2026-07-000001.jsonl') }
      ])
    } finally { db.close() }
    index.close()
  })

  it('never marks ready when a canonical durable JSONL source joins between projection and the final manifest check', async () => {
    await mkdir(join(runtime.workspaceDir, '.studiumx'), { recursive: true })
    const ledgerDirectory = join(runtime.workspaceDir, '.studiumx')
    const row = JSON.stringify({
      version: 1, entryId: 'active', type: 'conversation_snapshot', createdAt: instant,
      conversation: { id: 'flat', title: 'flat', updatedAt: instant, messageCount: 1 },
      evidence: { runUsage: { totalTokens: 11 } }
    })
    await writeFile(join(ledgerDirectory, 'learning-work.jsonl'), `${row}\n`)
    const index = makeIndex({
      testHooks: {
        beforeFinalReadyTransition: () => writeFile(
          join(ledgerDirectory, 'learning-work.sealed-2026-07-000001.jsonl'),
          `${row.replace('"active"', '"joined-after-projection"')}\n`
        )
      }
    })
    expect(index.open()).toBe(true)
    await index.rebuild()

    expect(index.status).toBe('incomplete')
    expect(await index.isCompleteForCurrentSources()).toBe(false)
    expect(index.tokenEvidenceAdapters()).toBeNull()
    expect(index.issues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: 'source_manifest', code: 'source_drift', message: expect.stringMatching(/immediately before/i) })
    ]))
    index.close()
  })

  it('records source failures as incomplete and can be removed then rebuilt from canonical files', async () => {
    const missing: AgentConversationSummary = { id: 'missing', workspaceId: 'ws-1', title: 'missing', createdAt: instant, updatedAt: instant, relativePath: 'conversation/missing.md', absolutePath: join(runtime.workspaceDir, 'conversation/missing.md'), messageCount: 1 }
    const index = makeIndex({ conversations: [missing] })
    expect(index.open()).toBe(true)
    await index.rebuild()
    expect(index.status).toBe('incomplete')
    expect(index.tokenEvidenceAdapters()).toBeNull()
    expect(index.issues()).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'source_missing' })]))
    index.close()
    await rm(join(runtime.userDataDir, 'studiumx-index.sqlite'), { force: true })

    const valid = record('missing')
    await writeConversation('conversation/missing.json', valid)
    const rebuilt = makeIndex({ conversations: [missing] })
    expect(rebuilt.open()).toBe(true)
    await rebuilt.rebuild()
    expect(rebuilt.status).toBe('ready')
    expect(await rebuilt.isCompleteForCurrentSources()).toBe(true)
    rebuilt.close()
  })
  it('scans all Memory scopes and tombstones, records recovery issues, and never stores content', async () => {
    const root = join(runtime.userDataDir, 'memory')
    await mkdir(root, { recursive: true })
    const catalog = new TeachingMemoryCatalog(root)
    await catalog.commit({ id: 'user', content: 'user secret', scope: 'user', tags: ['user-tag'], confidence: 1, createdAt: instant, updatedAt: instant })
    await catalog.commit({ id: 'workspace', content: 'workspace secret', scope: 'workspace', workspace: runtime.workspaceDir, tags: ['workspace-tag'], confidence: 1, createdAt: instant, updatedAt: instant })
    await catalog.commit({ id: 'project-deleted', content: 'project secret', scope: 'project', project: runtime.workspaceDir, tags: ['project-tag'], confidence: 1, createdAt: instant, updatedAt: instant, deletedAt: instant })
    await writeFile(join(root, 'broken.json'), '{not json', 'utf8')
    const index = makeIndex({ scanMemory: () => catalog.scanForLocalDataIndex() })
    expect(index.open()).toBe(true)
    await index.rebuild()
    expect(index.status).toBe('incomplete')
    expect(index.tokenEvidenceAdapters()).toBeNull()
    expect(index.issues()).toEqual(expect.arrayContaining([expect.objectContaining({ sourceKey: 'memory:broken.json', code: 'invalid_json' })]))
    index.close()
    const db = new Database(index.path, { readonly: true })
    try {
      expect(db.prepare('SELECT memory_id, deleted_at FROM memory_projection ORDER BY memory_id').all()).toEqual([
        { memory_id: 'project-deleted', deleted_at: instant }, { memory_id: 'user', deleted_at: null }, { memory_id: 'workspace', deleted_at: null }
      ])
      expect(JSON.stringify(db.prepare('SELECT * FROM memory_projection').all())).not.toMatch(/user secret|workspace secret|project secret/)
    } finally { db.close() }
  })

  it('fails closed for the QA post-drift/pre-fingerprint window: projected bytes can never be marked current with a later source manifest', async () => {
    const value = record('post-drift')
    await writeConversation('conversation/post-drift.json', value)
    const item = { ...value, workspaceId: 'ws-1', relativePath: 'conversation/post-drift.md', absolutePath: join(runtime.workspaceDir, 'conversation/post-drift.md') }
    const path = join(runtime.workspaceDir, 'conversation/post-drift.json')
    const oldBytes = JSON.stringify(value)
    const changed = JSON.stringify({ ...value, title: value.title.replace('Conversation', 'Conxersation') })
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(oldBytes))
    // Establish the currentness fingerprint for the old exact source snapshot.
    const baseline = makeIndex({ conversations: [item] })
    expect(baseline.open()).toBe(true)
    await baseline.rebuild()
    baseline.close()
    const expectedInputFingerprint = new Database(baseline.path, { readonly: true })
    let oldInputFingerprint: string
    try { oldInputFingerprint = String(expectedInputFingerprint.prepare("SELECT value FROM index_state WHERE key = 'input_fingerprint'").get().value) } finally { expectedInputFingerprint.close() }

    const index = makeIndex({
      conversations: [item],
      // The deterministic seam fires after old bytes have been parsed/projected and
      // their captured manifest built, exactly where QA found the old/new pairing.
      testHooks: { beforeCurrentnessVerification: () => writeFile(path, changed, 'utf8') }
    })
    expect(index.open()).toBe(true)
    await index.rebuild()
    expect(index.status).toBe('incomplete')
    expect(index.tokenEvidenceAdapters()).toBeNull()
    expect(index.issues()).toEqual(expect.arrayContaining([expect.objectContaining({ sourceKey: 'source_manifest', code: 'source_drift' })]))
    index.close()

    const db = new Database(index.path, { readonly: true })
    try {
      // Rows are the old projection, but their persisted provenance remains the
      // exact old bytes and complete=0; it can never be paired with new bytes.
      expect(db.prepare('SELECT title, source_fingerprint FROM conversation_projection').get()).toEqual({
        title: value.title,
        source_fingerprint: createHash('sha256').update(oldBytes, 'utf8').digest('hex')
      })
      expect(db.prepare("SELECT value FROM index_state WHERE key = 'input_fingerprint'").get()).toEqual({ value: oldInputFingerprint })
      expect(db.prepare("SELECT value FROM index_state WHERE key = 'complete'").get()).toEqual({ value: '0' })
    } finally { db.close() }
  })

  it('fails closed when a source mutates after precommit verification but before projection replacement', async () => {
    const value = record('after-precommit')
    await writeConversation('conversation/after-precommit.json', value)
    const item = { ...value, workspaceId: 'ws-1', relativePath: 'conversation/after-precommit.md', absolutePath: join(runtime.workspaceDir, 'conversation/after-precommit.md') }
    const path = join(runtime.workspaceDir, 'conversation/after-precommit.json')
    const oldBytes = JSON.stringify(value)
    const changed = JSON.stringify({ ...value, title: value.title.replace('Conversation', 'Conxersation') })
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(oldBytes))

    const index = makeIndex({
      conversations: [item],
      testHooks: { afterPrecommitVerification: () => writeFile(path, changed, 'utf8') }
    })
    expect(index.open()).toBe(true)
    await index.rebuild()

    expect(index.status).toBe('incomplete')
    expect(await index.isCompleteForCurrentSources()).toBe(false)
    expect(index.tokenEvidenceAdapters()).toBeNull()
    expect(index.issues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: 'source_manifest', code: 'source_drift', message: expect.stringMatching(/after precommit verification/i) })
    ]))
    index.close()

    const db = new Database(index.path, { readonly: true })
    try {
      // The replacement contains the old snapshot, but complete=0 prevents analytics
      // from receiving adapters that could read those stale rows.
      expect(db.prepare('SELECT title, source_fingerprint FROM conversation_projection').get()).toEqual({
        title: value.title,
        source_fingerprint: createHash('sha256').update(oldBytes, 'utf8').digest('hex')
      })
      expect(db.prepare("SELECT value FROM index_state WHERE key = 'complete'").get()).toEqual({ value: '0' })
    } finally { db.close() }
  })

  it('fails closed when a source mutates immediately before the final ready transition', async () => {
    const value = record('before-ready')
    await writeConversation('conversation/before-ready.json', value)
    const item = { ...value, workspaceId: 'ws-1', relativePath: 'conversation/before-ready.md', absolutePath: join(runtime.workspaceDir, 'conversation/before-ready.md') }
    const path = join(runtime.workspaceDir, 'conversation/before-ready.json')
    const oldBytes = JSON.stringify(value)
    const changed = JSON.stringify({ ...value, title: value.title.replace('Conversation', 'Conxersation') })
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(oldBytes))

    const index = makeIndex({
      conversations: [item],
      testHooks: { beforeFinalReadyTransition: () => writeFile(path, changed, 'utf8') }
    })
    expect(index.open()).toBe(true)
    await index.rebuild()

    expect(index.status).toBe('incomplete')
    expect(await index.isCompleteForCurrentSources()).toBe(false)
    expect(index.tokenEvidenceAdapters()).toBeNull()
    expect(index.issues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: 'source_manifest', code: 'source_drift', message: expect.stringMatching(/immediately before/i) })
    ]))
    index.close()

    const db = new Database(index.path, { readonly: true })
    try {
      expect(db.prepare('SELECT title, source_fingerprint FROM conversation_projection').get()).toEqual({
        title: value.title,
        source_fingerprint: createHash('sha256').update(oldBytes, 'utf8').digest('hex')
      })
      expect(db.prepare("SELECT value FROM index_state WHERE key = 'complete'").get()).toEqual({ value: '0' })
    } finally { db.close() }
  })

  it('invalidates the projection when exact source bytes change even when mtime and size are preserved', async () => {
    const value = record('byte-drift')
    await writeConversation('conversation/byte-drift.json', value)
    const item = { ...value, workspaceId: 'ws-1', relativePath: 'conversation/byte-drift.md', absolutePath: join(runtime.workspaceDir, 'conversation/byte-drift.md') }
    const index = makeIndex({ conversations: [item] })
    expect(index.open()).toBe(true)
    await index.rebuild()
    const path = join(runtime.workspaceDir, 'conversation/byte-drift.json')
    const before = await stat(path)
    const changed = JSON.stringify({ ...value, title: value.title.replace('Conversation', 'Conxersation') })
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(JSON.stringify(value)))
    await writeFile(path, changed, 'utf8')
    await utimes(path, before.atime, before.mtime)
    expect(await index.isCompleteForCurrentSources()).toBe(false)
    expect(index.status).not.toBe('ready')
    expect(index.tokenEvidenceAdapters()).toBeNull()
    index.close()
  })

  it('uses the canonical strict conversation enumeration: deleted branches are excluded and malformed or duplicate records fail closed', async () => {
    const deleted = { ...record('deleted-branch'), branch: { schemaVersion: 1, sessionId: 'session-deleted', branchId: 'deleted-branch', revision: 0, status: 'deleted' } } as AgentConversationRecord
    await writeConversation('conversation/deleted-branch.json', deleted)
    const deletedIndex = makeIndex()
    expect(deletedIndex.open()).toBe(true)
    await deletedIndex.rebuild()
    expect(deletedIndex.status).toBe('ready')
    deletedIndex.close()
    const deletedDb = new Database(deletedIndex.path, { readonly: true })
    try { expect(deletedDb.prepare('SELECT conversation_id FROM conversation_projection').all()).toEqual([]) } finally { deletedDb.close() }

    await writeFile(join(runtime.workspaceDir, 'conversation', 'bad.json'), '{broken', 'utf8')
    const malformed = makeIndex()
    expect(malformed.open()).toBe(true)
    await malformed.rebuild()
    expect(malformed.status).toBe('incomplete')
    expect(malformed.issues()).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_persisted_records' })]))
    malformed.close()
    await rm(join(runtime.workspaceDir, 'conversation', 'bad.json'))

    const duplicate = record('duplicate')
    await writeConversation('conversation/duplicate.json', duplicate)
    await writeConversation('courses/demo/conversation/duplicate.json', { ...duplicate, relativePath: 'courses/demo/conversation/duplicate.md', absolutePath: join(runtime.workspaceDir, 'courses/demo/conversation/duplicate.md') })
    const duplicates = makeIndex()
    expect(duplicates.open()).toBe(true)
    await duplicates.rebuild()
    expect(duplicates.status).toBe('incomplete')
    expect(duplicates.issues()).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_persisted_records', message: expect.stringMatching(/duplicate/i) })]))
    duplicates.close()
  })

})
