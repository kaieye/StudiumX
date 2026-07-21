import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDataIndex } from '../../src/main/local-data-index'
import {
  appendUsageLedgerEntry,
  buildUsageLedgerEntry,
  parseUsageLedgerLine,
  recordTurnUsageObservation,
  recordUsageBestEffort,
  summarizeUsageEntries,
  usageLedgerActivePath
} from '../../src/main/usage-ledger'
import { readUsageAnalyticsSummary } from '../../src/main/usage-analytics'
import { createIsolatedTestRuntime, type IsolatedTestRuntime } from '../helpers/runtime-isolation'

let runtime: IsolatedTestRuntime
beforeEach(async () => { runtime = await createIsolatedTestRuntime('usage-ledger-unit') })
afterEach(async () => { await runtime.cleanup() })

const now = () => new Date('2026-07-21T08:00:00.000Z')

describe('usage ledger write and redaction', () => {
  it('appends secret-free rows and rejects prompt-like / secret fields', async () => {
    const entry = await appendUsageLedgerEntry({
      appDataRoot: runtime.userDataDir,
      workspaceRoot: runtime.workspaceDir,
      now,
      entry: {
        kind: 'turn_usage',
        provider: 'openai',
        model: 'gpt-test',
        status: 'completed',
        inputTokens: 12,
        outputTokens: 4,
        conversationId: 'conv-1',
        traceId: 'trace-1',
        turnId: 'turn-1'
      }
    })
    expect(entry.version).toBe(1)
    expect(entry.provider).toBe('openai')

    const appPath = usageLedgerActivePath(runtime.userDataDir)
    const body = await readFile(appPath, 'utf8')
    expect(body).toContain('"kind":"turn_usage"')
    expect(body).not.toContain('apiKey')

    const workspaceBody = await readFile(join(runtime.workspaceDir, '.studiumx', 'usage.jsonl'), 'utf8')
    expect(workspaceBody).toContain(entry.entryId)

    const secretProvider = buildUsageLedgerEntry({
      kind: 'model_usage',
      provider: 'sk-abcdefghijklmnopqrstuvwxyz012345'
    })
    expect(secretProvider.provider).toBeUndefined()

    const secretLine = JSON.stringify({
      version: 1,
      entryId: 'bad-1',
      kind: 'turn_usage',
      timestamp: '2026-07-21T08:00:00.000Z',
      prompt: 'system: you are a helpful assistant with secret policy'
    })
    expect(parseUsageLedgerLine(secretLine)).toBeNull()
  })

  it('recordUsageBestEffort never rejects when the ledger path is unwritable', async () => {
    const blocked = join(runtime.userDataDir, 'blocked-as-file')
    await writeFile(blocked, 'not-a-directory', 'utf8')
    const result = await recordUsageBestEffort({
      appDataRoot: blocked,
      now,
      entry: { kind: 'turn_usage', status: 'completed' }
    })
    expect(result).toBeNull()
  })

  it('recordTurnUsageObservation writes turn/model/tool rows without secrets', async () => {
    await recordTurnUsageObservation({
      appDataRoot: runtime.userDataDir,
      workspaceRoot: runtime.workspaceDir,
      provider: 'openai',
      model: 'gpt-test',
      conversationId: 'conv-2',
      traceId: 'stream-2',
      turnId: 'stream-2',
      status: 'completed',
      startedAt: '2026-07-21T07:59:00.000Z',
      completedAt: '2026-07-21T08:00:00.000Z',
      usage: {
        providerCalls: 1,
        toolCalls: 1,
        toolErrors: 0,
        iterations: 1,
        childRuns: 0,
        durationMs: 1000,
        promptTokens: 20,
        completionTokens: 8,
        totalTokens: 28
      },
      tools: [{ toolName: 'read_file', isError: false, approvalStatus: 'not_required' }],
      now
    })
    const lines = (await readFile(usageLedgerActivePath(runtime.userDataDir), 'utf8')).trim().split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(3)
    const kinds = lines.map((line) => JSON.parse(line).kind)
    expect(kinds).toEqual(expect.arrayContaining(['model_usage', 'tool_usage', 'turn_usage']))
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(parsed).not.toHaveProperty('prompt')
      expect(parsed).not.toHaveProperty('arguments')
      expect(parsed).not.toHaveProperty('apiKey')
      expect(JSON.stringify(parsed)).not.toMatch(/sk-[A-Za-z0-9]{16,}/)
    }
  })
})

describe('usage projection rebuild', () => {
  it('projects usage JSONL into usage_projection and exposes aggregate-only analytics', async () => {
    await appendUsageLedgerEntry({
      appDataRoot: runtime.userDataDir,
      workspaceRoot: runtime.workspaceDir,
      now,
      entry: {
        kind: 'model_usage',
        provider: 'openai',
        model: 'gpt-test',
        status: 'completed',
        inputTokens: 5,
        outputTokens: 2,
        conversationId: 'conv-p',
        entryId: 'usage-entry-1'
      }
    })
    await appendUsageLedgerEntry({
      appDataRoot: runtime.userDataDir,
      now,
      entry: {
        kind: 'tool_usage',
        toolName: 'read_file',
        readOnly: true,
        destructive: false,
        status: 'completed',
        approvalStatus: 'not_required',
        entryId: 'usage-entry-2'
      }
    })

    const index = new LocalDataIndex({
      appDataRoot: runtime.userDataDir,
      sources: {
        listWorkspaces: async () => [{
          workspaceId: 'ws-1',
          workspaceName: 'Visible workspace',
          rootPath: runtime.workspaceDir,
          summary: { id: 'ws-1', name: 'Visible workspace', rootPath: runtime.workspaceDir, conversations: [] } as never
        }],
        listTemporaryConversations: async () => [],
        listMemory: async () => []
      }
    })
    expect(index.open()).toBe(true)
    await index.rebuild()
    expect(index.status).toBe('ready')

    const adapter = index.usageAnalyticsAdapter()
    expect(adapter).not.toBeNull()
    const summary = await adapter!.summarize()
    expect(summary).toMatchObject({
      state: 'readable',
      summary: {
        entryCount: 2,
        modelUsageCount: 1,
        toolUsageCount: 1,
        totalInputTokens: 5,
        totalOutputTokens: 2
      }
    })

    const fileSummary = await readUsageAnalyticsSummary({
      appDataRoot: runtime.userDataDir,
      workspaceRoots: [runtime.workspaceDir],
      projection: adapter
    })
    expect(fileSummary.state).toBe('readable')
    if (fileSummary.state === 'readable') {
      expect(fileSummary.source).toBe('sqlite_projection')
      expect(fileSummary.summary.entryCount).toBe(2)
    }

    index.close()
    const db = new Database(join(runtime.userDataDir, 'studiumx-index.sqlite'), { readonly: true })
    try {
      const rows = db.prepare('SELECT * FROM usage_projection ORDER BY entry_id').all() as Array<Record<string, unknown>>
      expect(rows).toHaveLength(2)
      const payload = JSON.stringify(rows)
      expect(payload).not.toContain('apiKey')
      expect(payload).not.toMatch(/sk-[A-Za-z0-9]{16,}/)
      const columns = (db.prepare('PRAGMA table_info(usage_projection)').all() as Array<{ name: string }>).map((c) => c.name)
      expect(columns).not.toContain('prompt')
      expect(columns).not.toContain('arguments')
      expect(columns).not.toContain('content')
    } finally {
      db.close()
    }
  })

  it('damaged usage projection does not break turn success path', async () => {
    const blocked = join(runtime.userDataDir, 'not-a-dir-file')
    await writeFile(blocked, 'x', 'utf8')
    await recordTurnUsageObservation({
      appDataRoot: blocked,
      status: 'completed',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        providerCalls: 1, toolCalls: 0, toolErrors: 0, iterations: 1, childRuns: 0, durationMs: 10,
        promptTokens: 1, completionTokens: 1, totalTokens: 2
      },
      now
    })
    // If we got here without throw, turn path is intact.
    expect(true).toBe(true)

    await mkdir(join(runtime.userDataDir, 'usage'), { recursive: true })
    await appendUsageLedgerEntry({
      appDataRoot: runtime.userDataDir,
      now,
      entry: { kind: 'turn_usage', status: 'completed', entryId: 'fallback-1', inputTokens: 3 }
    })
    const damagedProjection = {
      summarize: async () => { throw new Error('sqlite projection damaged') }
    }
    const summary = await readUsageAnalyticsSummary({
      appDataRoot: runtime.userDataDir,
      projection: damagedProjection
    })
    expect(summary.state).toBe('readable')
    if (summary.state === 'readable') {
      expect(summary.source).toBe('jsonl_ledger')
      expect(summary.summary.entryCount).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('usage analytics aggregates', () => {
  it('summarizeUsageEntries never returns raw payload fields', () => {
    const summary = summarizeUsageEntries([
      buildUsageLedgerEntry({
        kind: 'model_usage',
        provider: 'openai',
        model: 'gpt-test',
        inputTokens: 1,
        outputTokens: 2,
        entryId: 'a1',
        timestamp: '2026-07-21T08:00:00.000Z'
      }),
      buildUsageLedgerEntry({
        kind: 'tool_usage',
        toolName: 'write_file',
        destructive: true,
        entryId: 'a2',
        timestamp: '2026-07-21T08:00:01.000Z'
      })
    ])
    expect(summary.byProvider[0]).toEqual({ provider: 'openai', count: 1, inputTokens: 1, outputTokens: 2 })
    expect(summary.byTool[0]).toMatchObject({ toolName: 'write_file', count: 1, destructive: 1 })
    expect(JSON.stringify(summary)).not.toContain('arguments')
  })
})

describe('DB-OPT-3 usage latency fields', () => {
  it('round-trips ttftMs/retryCount/truncated/errorType through JSONL and projection', async () => {
    await appendUsageLedgerEntry({
      appDataRoot: runtime.userDataDir,
      now,
      entry: {
        kind: 'model_usage',
        provider: 'openai',
        model: 'gpt-test',
        status: 'failed',
        entryId: 'opt3-1',
        ttftMs: 120,
        retryCount: 2,
        truncated: true,
        errorType: 'timeout',
        inputTokens: 3,
        outputTokens: 0
      }
    })
    const appPath = usageLedgerActivePath(runtime.userDataDir)
    const line = (await readFile(appPath, 'utf8')).trim().split('\n').at(-1)!
    const parsed = parseUsageLedgerLine(line)
    expect(parsed).toMatchObject({
      entryId: 'opt3-1',
      ttftMs: 120,
      retryCount: 2,
      truncated: true,
      errorType: 'timeout'
    })

    // Unknown error type is dropped (not raw exception message).
    expect(buildUsageLedgerEntry({
      kind: 'turn_usage',
      errorType: 'Error: secret stack at /Users/me/app.ts' as never
    }).errorType).toBeUndefined()

    const index = new LocalDataIndex({
      appDataRoot: runtime.userDataDir,
      sources: {
        listWorkspaces: async () => [],
        listTemporaryConversations: async () => [],
        listMemory: async () => []
      }
    })
    expect(index.open()).toBe(true)
    await index.rebuild()
    expect(index.status).toBe('ready')
    index.close()
    const db = new Database(join(runtime.userDataDir, 'studiumx-index.sqlite'), { readonly: true })
    try {
      const row = db.prepare('SELECT ttft_ms, retry_count, truncated, error_type, source_path FROM usage_projection WHERE entry_id = ?').get('opt3-1') as {
        ttft_ms: number
        retry_count: number
        truncated: number
        error_type: string
        source_path: string
      }
      expect(row).toMatchObject({ ttft_ms: 120, retry_count: 2, truncated: 1, error_type: 'timeout' })
      expect(row.source_path).not.toContain(runtime.userDataDir)
      expect(row.source_path).toMatch(/usage/)
    } finally {
      db.close()
    }
  })

  it('missing OPT-3 fields remain readable (legacy rows)', async () => {
    await appendUsageLedgerEntry({
      appDataRoot: runtime.userDataDir,
      now,
      entry: {
        kind: 'tool_usage',
        toolName: 'read_file',
        status: 'completed',
        entryId: 'legacy-opt3'
      }
    })
    const index = new LocalDataIndex({
      appDataRoot: runtime.userDataDir,
      sources: {
        listWorkspaces: async () => [],
        listTemporaryConversations: async () => [],
        listMemory: async () => []
      }
    })
    expect(index.open()).toBe(true)
    await index.rebuild()
    index.close()
    const db = new Database(join(runtime.userDataDir, 'studiumx-index.sqlite'), { readonly: true })
    try {
      const row = db.prepare('SELECT ttft_ms, retry_count, truncated, error_type FROM usage_projection WHERE entry_id = ?').get('legacy-opt3') as {
        ttft_ms: number | null
        retry_count: number | null
        truncated: number | null
        error_type: string | null
      }
      expect(row.ttft_ms).toBeNull()
      expect(row.retry_count).toBeNull()
      expect(row.truncated).toBeNull()
      expect(row.error_type).toBeNull()
    } finally {
      db.close()
    }
  })
})
