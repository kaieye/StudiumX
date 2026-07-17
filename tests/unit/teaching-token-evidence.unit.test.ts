import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { AgentConversationRecord, LearningAnalyticsQuery, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'
import {
  createDurableConversationEvidenceAdapter,
  discoverTokenEvidence,
  readLatestLedgerSnapshots,
  type LedgerSnapshot,
  type TokenEvidenceAdapters,
  type TokenEvidenceWorkspace
} from '../../src/main/teaching/services/analytics/token-evidence'
import { durableJsonlSealedSegmentFileName } from '../../src/main/durable-jsonl'
import { LEARNING_WORK_LEDGER_RELATIVE_PATH } from '../../src/main/learning-work-ledger'

const usage = (totalTokens: number, promptTokens = 60, completionTokens = 40) => ({
  totalTokens,
  promptTokens,
  completionTokens,
  providerCalls: 1,
  toolCalls: 1,
  toolErrors: 0,
  iterations: 1,
  childRuns: 0,
  durationMs: 12
})

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const query: LearningAnalyticsQuery = {
  range: { from: '2026-07-10', to: '2026-07-12', preset: 'custom', fromInclusive: true, toInclusive: true, calendar: 'local_gregorian', weekStartsOn: 1 },
  scope: { personalFocus: { kind: 'none' }, teaching: { kind: 'workspace', workspaceId: 'ws-1' }, presence: { kind: 'none' } },
  calendarContext: { localToday: '2026-07-12', timeZone: 'UTC', weekStartsOn: 1 }
}

function record(id: string, turns: AgentConversationRecord['turns']): AgentConversationRecord {
  return {
    id,
    title: `${id} title`,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    relativePath: `courses/algebra/conversations/${id}.md`,
    absolutePath: `C:/isolated/${id}.md`,
    messageCount: turns.length,
    turns
  }
}


function conversationSummary(id: string, messageCount: number, updatedAt = '2026-07-12T12:00:00.000Z'): TeachingWorkspaceSummary['conversations'][number] {
  return {
    id,
    title: `${id} title`,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt,
    relativePath: `courses/algebra/conversations/${id}.md`,
    absolutePath: `C:/isolated/${id}.md`,
    messageCount
  }
}

function workspace(conversations: TeachingWorkspaceSummary['conversations']): TokenEvidenceWorkspace {
  return {
    workspaceId: 'ws-1',
    workspaceName: 'Algebra',
    rootPath: 'C:/isolated',
    summary: { conversations } as TeachingWorkspaceSummary
  }
}

function snapshot(conversationId: string): LedgerSnapshot {
  return {
    conversationId,
    title: 'Ledger fallback',
    courseRelativePath: 'courses/algebra',
    occurredAt: '2026-07-09T12:00:00.000Z',
    ledgerCreatedAt: '2026-07-09T12:01:00.000Z',
    messageCount: 1,
    usage: usage(80),
    componentsComplete: true,
    totalInconsistent: false
  }
}

describe('Teaching token evidence discovery', () => {
  it('reads latest ledger snapshots across strict sealed and active JSONL segments', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-token-evidence-'))
    roots.push(rootPath)
    const ledgerDirectory = join(rootPath, '.studiumx')
    await mkdir(ledgerDirectory, { recursive: true })
    const row = (createdAt: string, updatedAt: string, totalTokens: number) => JSON.stringify({
      version: 1,
      type: 'conversation_snapshot',
      createdAt,
      conversation: { id: 'fallback', title: 'Fallback', updatedAt, messageCount: 1, courseRelativePath: 'courses/algebra' },
      evidence: { runUsage: usage(totalTokens) }
    })
    await writeFile(
      join(ledgerDirectory, durableJsonlSealedSegmentFileName('learning-work.jsonl', '2026-06', 1)),
      `${row('2026-06-30T12:00:00.000Z', '2026-06-30T11:00:00.000Z', 20)}\n`,
      'utf8'
    )
    await writeFile(
      join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH),
      `${row('2026-07-01T12:00:00.000Z', '2026-07-01T11:00:00.000Z', 80)}\n`,
      'utf8'
    )

    const result = await readLatestLedgerSnapshots(rootPath)
    expect(result).toMatchObject({ scanned: 2, invalid: 0, readError: false })
    expect(result.latestByConversation.get('fallback')).toMatchObject({ usage: { totalTokens: 80 } })
  })

  it('reconciles readable, unreadable, missing, duplicate, invalid, stale, and fallback evidence through explicit adapters', async () => {
    const durable = record('durable', [
      {
        id: 'run-1',
        role: 'assistant',
        content: 'answer',
        createdAt: '2026-07-12T12:00:00.000Z',
        metadata: {
          version: 1,
          runUsage: usage(100),
          compactions: [{ replacedTokens: 15 }],
          contextHygiene: [{ savedTokens: 6 }]
        },
        toolCalls: [{ id: 'tool-1', name: 'search', arguments: '{}', isError: false }]
      },
      { id: 'run-1', role: 'assistant', content: 'replayed answer', createdAt: '2026-07-12T12:00:00.000Z', metadata: { version: 1, runUsage: usage(100) } }
    ])
    const missing = record('missing', [{ id: 'no-usage', role: 'assistant', content: 'answer', createdAt: '2026-07-12T12:00:00.000Z', metadata: { version: 1 } }])
    const reads: Record<string, Awaited<ReturnType<TokenEvidenceAdapters['conversations']['read']>>> = {
      durable: { state: 'readable', record: durable },
      fallback: { state: 'unreadable' },
      missing: { state: 'readable', record: missing }
    }
    const adapters: TokenEvidenceAdapters = {
      conversations: { read: async (_workspaceId, conversationId) => reads[conversationId] },
      ledger: { read: async () => ({ latestByConversation: new Map([['fallback', snapshot('fallback')]]), scanned: 3, invalid: 2, readError: false }) }
    }
    const catalog = workspace([
      conversationSummary('durable', durable.messageCount),
      conversationSummary('fallback', 2),
      conversationSummary('missing', missing.messageCount),
      conversationSummary('durable', durable.messageCount)
    ])

    const report = await discoverTokenEvidence({ query, workspaces: [catalog], inheritedWarnings: [], adapters })

    expect(report.facts).toHaveLength(2)
    expect(report.rangedFacts).toHaveLength(1)
    expect(report.rangedFacts[0]).toMatchObject({ source: 'conversation', courseRelativePath: 'courses/algebra', usage: { totalTokens: 100 } })
    expect(report.toolFacts).toEqual([expect.objectContaining({ name: 'search', error: false })])
    expect(report.governance).toEqual([expect.objectContaining({ compactionEvents: 1, replacedTokens: 15, hygieneSavedTokens: 6 })])
    expect(report.counters).toMatchObject({
      conversationsScanned: 3,
      conversationsReadable: 2,
      conversationsWithUsage: 1,
      ledgerSnapshotsScanned: 3,
      ledgerFallbackConversations: 1,
      invalidLedgerRows: 2,
      staleLedgerSnapshots: 1,
      missingUsageConversations: 1,
      duplicateRuns: 1
    })
    expect(report.complete).toBe(false)
    expect(report.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'source_scan_incomplete',
      'ledger_rows_invalid',
      'ledger_fallback_used',
      'conversation_usage_missing',
      'custom'
    ]))
  })

  it('combines Teaching and temporary conversations without colliding on conversation or turn ids', async () => {
    const teachingRecord = record('shared-id', [{
      id: 'shared-turn',
      role: 'assistant',
      content: 'teaching answer',
      createdAt: '2026-07-12T10:00:00.000Z',
      metadata: { version: 1, runUsage: usage(100) }
    }])
    const temporaryRecord: AgentConversationRecord = {
      ...record('shared-id', [{
        id: 'shared-turn',
        role: 'assistant',
        content: 'temporary answer',
        createdAt: '2026-07-12T11:00:00.000Z',
        metadata: { version: 1, runUsage: usage(25, 15, 10) }
      }]),
      relativePath: 'conversations/shared-id.md',
      absolutePath: 'C:/app-data/conversations/shared-id.md'
    }
    const report = await discoverTokenEvidence({
      query,
      workspaces: [workspace([conversationSummary('shared-id', teachingRecord.messageCount)])],
      temporaryConversations: [{
        id: temporaryRecord.id,
        workspaceId: 'ws-1',
        title: temporaryRecord.title,
        createdAt: temporaryRecord.createdAt,
        updatedAt: temporaryRecord.updatedAt,
        relativePath: temporaryRecord.relativePath,
        absolutePath: temporaryRecord.absolutePath,
        messageCount: temporaryRecord.messageCount
      }],
      inheritedWarnings: [],
      adapters: {
        conversations: { read: async () => ({ state: 'readable', record: teachingRecord }) },
        temporaryConversations: { read: async () => ({ state: 'readable', record: temporaryRecord }) },
        ledger: { read: async () => ({ latestByConversation: new Map(), scanned: 0, invalid: 0, readError: false }) }
      }
    })

    expect(report.facts).toHaveLength(2)
    expect(report.facts.map((fact) => fact.usage.totalTokens).sort((left, right) => left - right)).toEqual([25, 100])
    expect(new Set(report.facts.map((fact) => fact.dedupeKey)).size).toBe(2)
    expect(report.counters).toMatchObject({
      conversationsScanned: 2,
      conversationsReadable: 2,
      conversationsWithUsage: 2
    })
  })

  it('starts independent conversation reads concurrently instead of serializing the token scan', async () => {
    const resolvers: Array<(value: { state: 'unreadable' }) => void> = []
    const started: string[] = []
    const adapters: TokenEvidenceAdapters = {
      conversations: {
        read: async (_workspaceId, conversationId) => {
          started.push(conversationId)
          return await new Promise<{ state: 'unreadable' }>((resolve) => resolvers.push(resolve))
        }
      },
      ledger: { read: async () => ({ latestByConversation: new Map(), scanned: 0, invalid: 0, readError: false }) }
    }
    const reportPromise = discoverTokenEvidence({
      query,
      workspaces: [workspace([conversationSummary('one', 1), conversationSummary('two', 1), conversationSummary('three', 1)])],
      inheritedWarnings: [],
      adapters
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['one', 'two', 'three'])

    for (const resolve of resolvers) resolve({ state: 'unreadable' })
    await reportPromise
  })

  it('turns a rejected durable read into an explicit unreadable source for ledger fallback', async () => {
    const conversationAdapter = createDurableConversationEvidenceAdapter(async () => {
      throw new Error('durable record is unavailable')
    })
    const result = await conversationAdapter.read('ws-1', 'conv-1')

    expect(result).toEqual({ state: 'unreadable' })
  })
})
