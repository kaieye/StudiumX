import { describe, expect, it } from 'vitest'
import type { AgentConversationRecord, LearningAnalyticsQuery, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'
import {
  createDurableConversationEvidenceAdapter,
  discoverTokenEvidence,
  type LedgerSnapshot,
  type TokenEvidenceAdapters,
  type TokenEvidenceWorkspace
} from '../../src/main/teaching/services/analytics/token-evidence'

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

  it('turns a rejected durable read into an explicit unreadable source for ledger fallback', async () => {
    const conversationAdapter = createDurableConversationEvidenceAdapter(async () => {
      throw new Error('durable record is unavailable')
    })
    const result = await conversationAdapter.read('ws-1', 'conv-1')

    expect(result).toEqual({ state: 'unreadable' })
  })
})
