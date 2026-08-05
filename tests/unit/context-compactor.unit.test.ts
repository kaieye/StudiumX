import { describe, expect, it } from 'vitest'

import {
  CONTEXT_COMPACTOR_CUT_POINT_STRATEGY,
  ContextCompactor,
  reductionMeetsGuard,
  selectCompactionCutIndex
} from '../../src/main/ai/context-compactor'
import { ContextEstimator } from '../../src/main/ai/context-estimator'
import type { ChatMessage, ToolCall } from '../../src/main/ai/provider-adapter'

const makeToolCall = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})

function buildLongTranscript(): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: 'System policy stays first.' }]
  for (let index = 0; index < 24; index += 1) {
    messages.push({
      role: 'user',
      content: `OLD_USER_${index}: ${'historical context '.repeat(30)}`
    })
    messages.push({
      role: 'assistant',
      content: `OLD_ASSISTANT_${index}: ${'resolved work '.repeat(26)}`
    })
  }
  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [makeToolCall('recent-call', 'lookup', { query: 'tail' })]
  })
  messages.push({
    role: 'tool',
    tool_call_id: 'recent-call',
    content: 'RECENT_TOOL_RESULT should keep its assistant pair.'
  })
  messages.push({ role: 'user', content: 'LATEST_USER: answer this now.' })
  return messages
}

function baseOptions(overrides: Partial<ConstructorParameters<typeof ContextCompactor>[0]> = {}) {
  return {
    estimator: new ContextEstimator(),
    contextWindowTokens: 1_600,
    softThresholdTokens: 500,
    hardThresholdTokens: 900,
    minTailMessages: 4,
    minMessagesToCompact: 4,
    summaryInputTokenLimit: 1_200,
    summarize: async () =>
      [
        'Preserved constraints: keep system policy and current task.',
        'Historical task snapshot: old turns were completed.',
        'Recent work state: continue from the retained tail.'
      ].join('\n'),
    ...overrides
  }
}

describe('CONTEXT_COMPACTOR_CUT_POINT_STRATEGY', () => {
  it('documents non-durable, tool-safe cut-point defaults', () => {
    expect(CONTEXT_COMPACTOR_CUT_POINT_STRATEGY.preserveLeadingSystem).toBe(true)
    expect(CONTEXT_COMPACTOR_CUT_POINT_STRATEGY.repairToolPairs).toBe(true)
    expect(CONTEXT_COMPACTOR_CUT_POINT_STRATEGY.durableRewriteDefault).toBe(false)
    expect(CONTEXT_COMPACTOR_CUT_POINT_STRATEGY.insufficientReductionGuard).toBe(true)
  })
})

describe('reductionMeetsGuard', () => {
  it('accepts savings that meet absolute and relative floors', () => {
    expect(
      reductionMeetsGuard({
        beforeTokens: 1000,
        afterTokens: 800,
        minTokenSavings: 32,
        minTokenReductionRatio: 0.05
      })
    ).toBe(true)
  })

  it('rejects absolute under-savings even when ratio looks fine on tiny numbers', () => {
    expect(
      reductionMeetsGuard({
        beforeTokens: 100,
        afterTokens: 90,
        minTokenSavings: 32,
        minTokenReductionRatio: 0.05
      })
    ).toBe(false)
  })

  it('rejects ratio under-savings', () => {
    expect(
      reductionMeetsGuard({
        beforeTokens: 10_000,
        afterTokens: 9_800,
        minTokenSavings: 32,
        minTokenReductionRatio: 0.05
      })
    ).toBe(false)
  })
})

describe('ContextCompactor cut-points', () => {
  it('keeps recent messages and latest user in the retained suffix', async () => {
    const messages = buildLongTranscript()
    const compactor = new ContextCompactor(baseOptions())
    const result = await compactor.compactIfNeeded({ messages })
    expect(result.changed).toBe(true)
    const text = JSON.stringify(result.messages)
    expect(text).toMatch(/LATEST_USER/)
    expect(text).toMatch(/CONTEXT COMPACTION - REFERENCE ONLY/)
    expect(text).not.toMatch(/OLD_USER_0/)
    expect(result.messages[0]?.content).toBe('System policy stays first.')

    const completed = result.events.find((e) => e.type === 'context_compaction_completed')
    expect(completed?.type).toBe('context_compaction_completed')
    if (completed?.type === 'context_compaction_completed') {
      expect(completed.keptSuffixCount).toBeGreaterThan(0)
      expect(completed.messagesRemovedCount).toBeGreaterThan(0)
      expect(completed.cutIndex).toBeGreaterThan(completed.systemPrefixCount)
      // Kept suffix must include the latest user turn.
      const suffix = messages.slice(completed.cutIndex)
      expect(suffix.some((m) => m.role === 'user' && m.content.includes('LATEST_USER'))).toBe(true)
    }
  })

  it('selectCompactionCutIndex repairs orphan tool pairs into the kept suffix', () => {
    const estimator = new ContextEstimator()
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old-1 ' + 'x'.repeat(200) },
      { role: 'assistant', content: 'old-a ' + 'y'.repeat(200) },
      {
        role: 'assistant',
        content: null,
        tool_calls: [makeToolCall('pair-1', 'lookup', { q: 1 })]
      },
      { role: 'tool', tool_call_id: 'pair-1', content: 'tool-body' },
      { role: 'user', content: 'latest user' }
    ]
    // Force a boundary that would split the tool pair if unrepaired.
    const cut = selectCompactionCutIndex({
      messages,
      systemCount: 1,
      tailBudgetTokens: 40,
      minTailMessages: 1,
      estimator
    })
    const suffix = messages.slice(cut)
    const hasTool = suffix.some((m) => m.role === 'tool' && m.tool_call_id === 'pair-1')
    const hasAssistant = suffix.some(
      (m) => m.role === 'assistant' && m.tool_calls?.some((c) => c.id === 'pair-1')
    )
    if (hasTool) expect(hasAssistant).toBe(true)
    expect(suffix.some((m) => m.role === 'user' && m.content === 'latest user')).toBe(true)
  })
})

describe('ContextCompactor audit fields', () => {
  it('emits cut indices and outcome codes on success', async () => {
    const messages = buildLongTranscript()
    const compactor = new ContextCompactor(baseOptions())
    const result = await compactor.compactIfNeeded({ messages })
    expect(result.events[0]?.type).toBe('context_compaction_started')
    const started = result.events[0]
    if (started?.type === 'context_compaction_started') {
      expect(started.cutIndex).toBeGreaterThan(0)
      expect(started.messagesRemovedCount).toBeGreaterThan(0)
      expect(started.keptSuffixCount).toBeGreaterThan(0)
      expect(started.systemPrefixCount).toBe(1)
    }
    const completed = result.events.find((e) => e.type === 'context_compaction_completed')
    expect(completed?.type).toBe('context_compaction_completed')
    if (completed?.type === 'context_compaction_completed') {
      expect(completed.outcomeCode).toBe('completed')
      expect(completed.tokenSavings).toBe(completed.beforeTokens - completed.afterTokens)
      expect(completed.messagesRemovedCount).toBe(completed.replacedMessages)
      expect(completed.keptSuffixCount).toBe(completed.tailMessages)
      expect(completed.cutIndex).toBe(started?.type === 'context_compaction_started' ? started.cutIndex : -1)
    }
  })
})

describe('ContextCompactor failure paths', () => {
  it('preserves original transcript when summarize throws and records failed event', async () => {
    const messages = buildLongTranscript()
    let attempts = 0
    const compactor = new ContextCompactor(
      baseOptions({
        failureCooldownMs: 60_000,
        now: () => Date.parse('2026-07-06T00:00:00.000Z'),
        summarize: async () => {
          attempts += 1
          throw new Error('summary provider unavailable')
        }
      })
    )
    const failed = await compactor.compactIfNeeded({ messages })
    expect(failed.changed).toBe(false)
    expect(failed.messages).toBe(messages)
    expect(attempts).toBe(1)
    const event = failed.events.find((e) => e.type === 'context_compaction_failed')
    expect(event?.type).toBe('context_compaction_failed')
    if (event?.type === 'context_compaction_failed') {
      expect(event.outcomeCode).toBe('summarize_error')
      expect(event.error).toMatch(/summary provider unavailable/)
      expect(event.messagesRemovedCount).toBeGreaterThan(0)
      expect(event.keptSuffixCount).toBeGreaterThan(0)
      expect(typeof event.cutIndex).toBe('number')
    }
  })

  it('lets an explicit forced compaction bypass a prior ordinary failure cooldown', async () => {
    const messages = buildLongTranscript()
    let attempts = 0
    const compactor = new ContextCompactor(
      baseOptions({
        failureCooldownMs: 60_000,
        now: () => Date.parse('2026-07-06T00:00:00.000Z'),
        summarize: async () => {
          attempts += 1
          throw new Error('summary provider unavailable')
        }
      })
    )

    await compactor.compactIfNeeded({ messages })
    const forced = await compactor.compactIfNeeded({ messages, forceCompaction: true })

    expect(forced.changed).toBe(false)
    expect(attempts).toBe(2)
    expect(forced.events.some((event) => event.type === 'context_compaction_failed')).toBe(true)
  })

  it('preserves original transcript when reduction is insufficient', async () => {
    const messages = buildLongTranscript()
    const estimator = new ContextEstimator()
    // Inflated "summary" larger than the middle slice → negative or tiny savings.
    const hugeSummary = `INFLATED_SUMMARY ${'pad '.repeat(50_000)}`
    const compactor = new ContextCompactor(
      baseOptions({
        estimator,
        minTokenSavings: 32,
        minTokenReductionRatio: 0.05,
        summarize: async () => hugeSummary
      })
    )
    const result = await compactor.compactIfNeeded({ messages })
    expect(result.changed).toBe(false)
    expect(result.messages).toBe(messages)
    expect(result.estimateAfter).toEqual(result.estimateBefore)
    const event = result.events.find((e) => e.type === 'context_compaction_failed')
    expect(event?.type).toBe('context_compaction_failed')
    if (event?.type === 'context_compaction_failed') {
      expect(event.outcomeCode).toBe('insufficient_reduction')
      expect(event.error).toMatch(/Insufficient reduction/)
      expect(typeof event.beforeTokens).toBe('number')
      expect(typeof event.afterTokens).toBe('number')
      expect(typeof event.tokenSavings).toBe('number')
      if (event.tokenSavings !== undefined && event.beforeTokens !== undefined) {
        expect(event.tokenSavings).toBeLessThan(event.beforeTokens * 0.05)
      }
    }
  })

  it('preserves original transcript when summary is empty', async () => {
    const messages = buildLongTranscript()
    const compactor = new ContextCompactor(
      baseOptions({
        summarize: async () => '   \n\n  '
      })
    )
    const result = await compactor.compactIfNeeded({ messages })
    expect(result.changed).toBe(false)
    expect(result.messages).toBe(messages)
    const event = result.events.find((e) => e.type === 'context_compaction_failed')
    expect(event?.type).toBe('context_compaction_failed')
    if (event?.type === 'context_compaction_failed') {
      expect(event.outcomeCode).toBe('summary_empty')
    }
  })
})
