import { describe, expect, it } from 'vitest'
import type { AgentConversationRecord, TokenUsageFact } from '../../src/shared/teaching-types'
import {
  aggregateTokenFacts,
  collectConversationTokenFacts
} from '../../src/main/teaching/services/learning-analytics'

const usage = (totalTokens: number, promptTokens?: number, completionTokens?: number) => ({
  totalTokens,
  ...(promptTokens === undefined ? {} : { promptTokens }),
  ...(completionTokens === undefined ? {} : { completionTokens }),
  providerCalls: 1,
  toolCalls: 0,
  toolErrors: 0,
  iterations: 1,
  childRuns: 0,
  durationMs: 10
})

function conversation(turns: AgentConversationRecord['turns']): AgentConversationRecord {
  return {
    id: 'conv-1',
    title: 'Fixture conversation',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    relativePath: 'courses/algebra/conversations/conv-1.md',
    absolutePath: 'C:/isolated/conv-1.md',
    messageCount: turns.length,
    turns
  }
}

describe('teaching analytics token aggregation', () => {
  it('prefers assistant turn usage and deduplicates repeated run identity', () => {
    const result = collectConversationTokenFacts(conversation([
      { id: 'run-1', role: 'assistant', content: 'answer', createdAt: '2026-07-11T23:30:00.000Z', metadata: { version: 1, runUsage: usage(150, 100, 50) } },
      { id: 'run-1', role: 'assistant', content: 'replayed answer', createdAt: '2026-07-11T23:30:00.000Z', metadata: { version: 1, runUsage: usage(150, 100, 50) } }
    ]), 'ws-1', 'Workspace', 'America/Los_Angeles')

    expect(result.facts).toHaveLength(1)
    expect(result.facts[0].source).toBe('conversation')
    expect(result.facts[0].usage.totalTokens).toBe(150)
    expect(result.duplicateRuns).toBe(1)
  })

  it('calculates total tokens from prompt and completion when the provider omits total', () => {
    const result = collectConversationTokenFacts(conversation([
      {
        id: 'run-components',
        role: 'assistant',
        content: 'answer',
        createdAt: '2026-07-11T23:30:00.000Z',
        metadata: {
          version: 1,
          runUsage: {
            promptTokens: 120,
            completionTokens: 30,
            providerCalls: 1,
            toolCalls: 0,
            toolErrors: 0,
            iterations: 1,
            childRuns: 0,
            durationMs: 10
          }
        }
      }
    ]), 'ws-1', 'Workspace', 'UTC')

    expect(result.facts).toHaveLength(1)
    expect(result.facts[0].usage).toMatchObject({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150
    })
  })

  it('keeps total-only usage without fabricating prompt or completion', () => {
    const result = collectConversationTokenFacts(conversation([
      { id: 'run-total', role: 'assistant', content: 'answer', createdAt: '2026-07-11T23:30:00.000Z', metadata: { version: 1, runUsage: usage(77) } }
    ]), 'ws-1', 'Workspace', 'UTC')
    const aggregate = aggregateTokenFacts(result.facts, [], {
      conversationsScanned: 1,
      conversationsReadable: 1,
      conversationsWithUsage: 1,
      conversationsPartiallyMissingUsage: 0,
      ledgerSnapshotsScanned: 0,
      ledgerFallbackConversations: 0,
      invalidLedgerRows: 0,
      governance: result.governance
    })

    expect(aggregate.totals).not.toHaveProperty('promptTokens')
    expect(aggregate.totals).not.toHaveProperty('completionTokens')
    expect(aggregate.totals.totalTokens).toBe(77)
  })

  it('uses query timezone for inclusive local-date buckets', () => {
    const result = collectConversationTokenFacts(conversation([
      { id: 'run-zone', role: 'assistant', content: 'answer', createdAt: '2026-07-12T00:30:00.000Z', metadata: { version: 1, runUsage: usage(10, 6, 4) } }
    ]), 'ws-1', 'Workspace', 'America/Los_Angeles')
    const aggregate = aggregateTokenFacts(result.facts, [], {
      conversationsScanned: 1,
      conversationsReadable: 1,
      conversationsWithUsage: 1,
      conversationsPartiallyMissingUsage: 0,
      ledgerSnapshotsScanned: 0,
      ledgerFallbackConversations: 0,
      invalidLedgerRows: 0
    })

    expect(aggregate.byDay).toEqual([{ date: '2026-07-11', promptTokens: 6, completionTokens: 4, totalTokens: 10, runs: 1 }])
  })

  it('preserves source total when components disagree', () => {
    const result = collectConversationTokenFacts(conversation([
      { id: 'run-inconsistent', role: 'assistant', content: 'answer', createdAt: '2026-07-11T12:00:00.000Z', metadata: { version: 1, runUsage: usage(99, 60, 30) } }
    ]), 'ws-1', 'Workspace', 'UTC')
    const aggregate = aggregateTokenFacts(result.facts, [], {
      conversationsScanned: 1,
      conversationsReadable: 1,
      conversationsWithUsage: 1,
      conversationsPartiallyMissingUsage: 0,
      ledgerSnapshotsScanned: 0,
      ledgerFallbackConversations: 0,
      invalidLedgerRows: 0
    })

    expect(aggregate.totals.totalTokens).toBe(99)
    expect(aggregate.totals.promptTokens).toBe(60)
    expect(aggregate.totals.completionTokens).toBe(30)
  })

  it('deduplicates facts by stable identity before summing', () => {
    const fact: TokenUsageFact = {
      source: 'conversation',
      dedupeKey: 'ws-1:conv-1:run-1',
      conversationKey: 'ws-1:conv-1',
      conversationId: 'conv-1',
      conversationTitle: 'Fixture',
      workspaceId: 'ws-1',
      workspaceName: 'Workspace',
      turnId: 'run-1',
      occurredAt: '2026-07-11T12:00:00.000Z',
      localDate: '2026-07-11',
      localDateSource: 'query_timezone',
      usage: usage(10, 6, 4),
      componentsComplete: true
    }
    const aggregate = aggregateTokenFacts([fact, { ...fact }], [], {
      conversationsScanned: 1,
      conversationsReadable: 1,
      conversationsWithUsage: 1,
      conversationsPartiallyMissingUsage: 0,
      ledgerSnapshotsScanned: 0,
      ledgerFallbackConversations: 0,
      invalidLedgerRows: 0
    })
    expect(aggregate.totals.totalTokens).toBe(10)
    expect(aggregate.byConversation).toHaveLength(1)
  })
})
