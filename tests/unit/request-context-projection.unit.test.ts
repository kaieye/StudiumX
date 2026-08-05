import { describe, expect, it } from 'vitest'

import { ContextEstimator } from '../../src/main/ai/context-estimator'
import { DEFAULT_CONTEXT_WINDOW_TOKENS } from '../../src/main/ai/context-compactor'
import { RequestContextProjector } from '../../src/main/ai/request-context-projection'
import type { ChatMessage, ToolDefinition } from '../../src/main/ai/provider-adapter'

const tool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'workspace_lookup',
    description: 'Look up a workspace resource.',
    parameters: { type: 'object', properties: { path: { type: 'string' } } }
  }
}

function projector(overrides: ConstructorParameters<typeof RequestContextProjector>[0] = {}) {
  return new RequestContextProjector({
    modelId: 'unknown-local-model',
    injectFileTouchLedger: false,
    summarize: async () => 'Earlier request facts retained as reference only.',
    ...overrides
  })
}

describe('request context projection request-fit geometry', () => {
  it('accounts separately for messages, schemas, framing, reserve, and extra endpoint overhead', () => {
    const estimator = new ContextEstimator()
    const messages: ChatMessage[] = [{ role: 'user', content: 'Explain the derivative of x squared.' }]
    const estimate = estimator.estimateRequest(messages, {
      tools: [tool],
      framingTokens: 17,
      outputReserveTokens: 71,
      extraTokens: 9
    })

    expect(estimate.toolSchemaTokens).toBeGreaterThan(0)
    expect(estimate.framingTokens).toBe(17)
    expect(estimate.outputReserveTokens).toBe(71)
    expect(estimate.extraTokens).toBe(9)
    expect(estimate.overheadTokens).toBe(
      estimate.toolSchemaTokens + estimate.framingTokens + estimate.outputReserveTokens + estimate.extraTokens
    )
    expect(estimate.totalTokens).toBe(estimate.messageTokens + estimate.overheadTokens)
  })

  it('records configured window provenance and redacted request-fit geometry', async () => {
    const projected = await projector({
      compaction: { enabled: false, contextWindowTokens: 4_000 },
      providerFramingTokens: 37,
      outputReserveTokens: 83,
      extraRequestTokens: 11
    }).project([{ role: 'user', content: 'Private learner question must not be written into the report.' }], [tool])

    expect(projected.contextWindowTokens).toBe(4_000)
    expect(projected.contextWindowSource).toBe('configured')
    expect(projected.report.requestFit).toMatchObject({
      framingTokens: 37,
      outputReserveTokens: 83,
      extraTokens: 11,
      effectiveContextWindowTokens: 4_000,
      contextWindowSource: 'configured',
      estimateSource: 'local'
    })
    expect(projected.report.requestFit?.toolSchemaTokens).toBeGreaterThan(0)
    expect(projected.estimatedTokens).toBe(projected.report.requestFit?.projectedTokens)
    expect(JSON.stringify(projected.report)).not.toContain('Private learner question')
  })

  it('uses the conservative fallback source for an unknown model', async () => {
    const projected = await projector({
      compaction: { enabled: false },
      outputReserveTokens: 0,
      providerFramingTokens: 0
    }).project([{ role: 'user', content: 'short prompt' }], [])

    expect(projected.contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
    expect(projected.contextWindowSource).toBe('conservative_default')
    expect(projected.report.requestFit?.contextWindowSource).toBe('conservative_default')
  })

  it('includes framing and completion reserve in the compaction trigger and candidate re-estimate', async () => {
    let summaryCalls = 0
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Keep this system rule.' },
      ...Array.from({ length: 6 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `turn ${index}: ${'x'.repeat(600)}`
      }))
    ]
    const projected = await projector({
      compaction: {
        contextWindowTokens: 2_000,
        softThresholdTokens: 1_000,
        minMessagesToCompact: 2,
        minTailMessages: 2,
        minTokenSavings: 1,
        minTokenReductionRatio: 0
      },
      providerFramingTokens: 100,
      outputReserveTokens: 900,
      summarize: async () => {
        summaryCalls += 1
        return 'Compacted prior turns.'
      }
    }).project(messages, [tool])

    const start = projected.trace.find((event) => event.type === 'context_compaction_started')
    expect(summaryCalls).toBe(1)
    expect(start).toMatchObject({
      type: 'context_compaction_started',
      estimate: { framingTokens: 100, outputReserveTokens: 900 }
    })
    expect(projected.report.requestFit).toMatchObject({ framingTokens: 100, outputReserveTokens: 900 })
  })
})
