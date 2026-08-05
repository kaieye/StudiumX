import { describe, expect, it } from 'vitest'

import {
  CompactionPressureController,
  CompactionSingleFlight,
  CONTEXT_COMPACTOR_CUT_POINT_STRATEGY,
  ContextCompactor,
  createCompactionPressureState,
  nextPressureState,
  pressureOptionOverrides,
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

describe('CompactionSingleFlight', () => {
  it('runs at most one body and joins concurrent callers', async () => {
    const flight = new CompactionSingleFlight()
    let starts = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const work = async () => {
      starts += 1
      await gate
      return starts
    }

    const p1 = flight.run(work)
    // Allow first work to mark starts before second join.
    await Promise.resolve()
    const p2 = flight.run(work)
    expect(flight.isInFlight).toBe(true)
    expect(starts).toBe(1)

    release()
    const [a, b] = await Promise.all([p1, p2])
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(starts).toBe(1)
    expect(flight.isInFlight).toBe(false)

    // After release, a new flight may run.
    const p3 = await flight.run(async () => {
      starts += 1
      return starts
    })
    expect(p3).toBe(2)
    expect(starts).toBe(2)
  })
})

describe('pressure ladder pure helpers', () => {
  it('escalates only when compact completed and still over threshold', () => {
    let state = createCompactionPressureState()
    state = nextPressureState(state, { stillOverThreshold: true, compacted: true })
    expect(state.level).toBe(1)
    expect(state.consecutiveStillOver).toBe(1)

    // No thrash: still over but no compact applied keeps level.
    state = nextPressureState(state, { stillOverThreshold: true, compacted: false })
    expect(state.level).toBe(1)
    expect(state.consecutiveStillOver).toBe(1)

    state = nextPressureState(state, { stillOverThreshold: true, compacted: true })
    expect(state.level).toBe(2)

    state = nextPressureState(state, { stillOverThreshold: false, compacted: true })
    expect(state).toEqual(createCompactionPressureState())
  })

  it('caps at level 3 and tightens tail overrides', () => {
    let state = createCompactionPressureState()
    for (let i = 0; i < 6; i += 1) {
      state = nextPressureState(state, { stillOverThreshold: true, compacted: true })
    }
    expect(state.level).toBe(3)
    const overrides = pressureOptionOverrides(3)
    expect(overrides.preferAggressive).toBe(true)
    expect(overrides.tailRatioScale).toBeLessThan(1)
    expect(overrides.minTailMessagesDelta).toBeLessThan(0)
  })
})

describe('ContextCompactor single-flight mutex', () => {
  it('dedupes concurrent compactIfNeeded on the same instance', async () => {
    const messages = buildLongTranscript()
    let summarizeCalls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const compactor = new ContextCompactor(
      baseOptions({
        summarize: async () => {
          summarizeCalls += 1
          await gate
          return 'Shared summary for single-flight.'
        }
      })
    )

    const a = compactor.compactIfNeeded({ messages, triggerPoint: 'pre_send' })
    await Promise.resolve()
    expect(compactor.isCompactionInFlight).toBe(true)
    const b = compactor.compactIfNeeded({ messages, triggerPoint: 'post_tool' })
    await Promise.resolve()
    expect(summarizeCalls).toBe(1)

    release()
    const [ra, rb] = await Promise.all([a, b])
    expect(summarizeCalls).toBe(1)
    expect(ra.changed).toBe(true)
    expect(rb.changed).toBe(true)
    expect(ra.messages).toEqual(rb.messages)
    expect(compactor.isCompactionInFlight).toBe(false)
  })
})

describe('ContextCompactor pressure ladder escalate-on-still-over', () => {
  it('raises pressure level when completed compact remains over soft threshold', async () => {
    const messages = buildLongTranscript()
    // Soft threshold set high enough that a short summary still leaves estimate ≥ soft.
    const softThresholdTokens = 50
    const compactor = new ContextCompactor(
      baseOptions({
        contextWindowTokens: 2_000,
        softThresholdTokens,
        hardThresholdTokens: 1_900,
        minTokenSavings: 0,
        minTokenReductionRatio: 0.05,
        // Summary still leaves a long kept tail → afterTokens stay large.
        summarize: async () => 'tiny'
      })
    )

    const first = await compactor.compactIfNeeded({ messages, triggerPoint: 'pre_send' })
    expect(first.changed).toBe(true)
    expect(first.estimateAfter.totalTokens).toBeGreaterThanOrEqual(softThresholdTokens)
    expect(compactor.pressureState.level).toBeGreaterThanOrEqual(1)
    expect(compactor.pressureState.consecutiveStillOver).toBeGreaterThanOrEqual(1)

    // Controller pure escalate path (mid-run protect: only on compact+still-over).
    const controller = new CompactionPressureController()
    controller.recordOutcome({ stillOverThreshold: true, compacted: true })
    expect(controller.pressure.level).toBe(1)
    controller.recordOutcome({ stillOverThreshold: true, compacted: true })
    expect(controller.pressure.level).toBe(2)
    expect(controller.optionOverrides().preferAggressive).toBe(true)
  })
})

describe('aggregate observability never suppresses compaction', () => {
  it('continues a projection-only compaction without any aggregate budget authority', async () => {
    const messages = buildLongTranscript()
    let summarizeCalls = 0
    const compactor = new ContextCompactor(
      baseOptions({
        summarize: async () => {
          summarizeCalls += 1
          return 'aggregate usage is observability only'
        }
      })
    )

    const result = await compactor.compactIfNeeded({ messages, forceCompaction: true })
    expect(result.changed).toBe(true)
    expect(summarizeCalls).toBe(1)
    expect(messages).toEqual(buildLongTranscript())
  })
})

describe('default compaction remains reference-only / non-durable', () => {
  it('keeps ADR-0064 product defaults and reference-only summary markers', async () => {
    expect(CONTEXT_COMPACTOR_CUT_POINT_STRATEGY.durableRewriteDefault).toBe(false)
    expect(CONTEXT_COMPACTOR_CUT_POINT_STRATEGY.referenceOnlySummary).toBe(true)

    const messages = buildLongTranscript()
    const original = messages.map((m) => ({ ...m }))
    const compactor = new ContextCompactor(baseOptions())
    const result = await compactor.compactIfNeeded({ messages })
    expect(result.changed).toBe(true)
    // Input transcript identity not mutated (projection-only).
    expect(messages).toEqual(original)
    const joined = JSON.stringify(result.messages)
    expect(joined).toMatch(/CONTEXT COMPACTION - REFERENCE ONLY/)
    expect(joined).toMatch(/END CONTEXT COMPACTION/)
  })
})
