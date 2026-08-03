import type { ChatMessage, ToolDefinition } from './provider-adapter'
import { ContextEstimator, type TokenEstimate } from './context-estimator'
import {
  modelContextWindowTokens
} from '../../shared/model-provider-catalog'
import {
  CompactionPressureController,
  shouldSkipCompactionForHardBudget,
  type CompactionPressureOptionOverrides,
  type CompactionTriggerPoint
} from './compaction-pressure-controller'

export {
  COMPACTION_HARD_BUDGET_AUTHORITY,
  CompactionPressureController,
  CompactionSingleFlight,
  createCompactionPressureState,
  nextPressureState,
  pressureOptionOverrides,
  shouldSkipCompactionForHardBudget
} from './compaction-pressure-controller'
export type {
  CompactionPressureLevel,
  CompactionPressureOptionOverrides,
  CompactionPressureState,
  CompactionTriggerPoint
} from './compaction-pressure-controller'

export type ContextCompactionMode = 'normal' | 'aggressive' | 'manual'
export type ContextCompactionReason = 'soft_threshold' | 'hard_threshold' | 'manual'

/**
 * Closed outcome codes for compaction audit events.
 * Prefer these over free-form strings when interpreting failure/success.
 */
export type ContextCompactionOutcomeCode =
  | 'completed'
  | 'insufficient_reduction'
  | 'summary_empty'
  | 'summarize_error'

/**
 * Documented cut-point strategy for provider-projection compaction (ADR-0045 layer A / ADR-0064).
 *
 * Selection order (immutable product defaults — not a second engine):
 * 1. **System boundary** — keep a leading contiguous `system` prefix untouched.
 * 2. **Recent tail** — grow a suffix from the end within token budget
 *    (`normalTailRatio` / `aggressiveTailRatio`) and at least `minTailMessages`.
 * 3. **Latest user anchor** — never place the cut after the latest `user` message
 *    (recent dialogue stays in the kept suffix).
 * 4. **Tool-pair repair** — if a kept `tool` result would orphan its assistant
 *    `tool_calls`, pull the boundary earlier to include that assistant message.
 * 5. **Middle compact slice** — only `[systemCount, cutIndex)` is summarized;
 *    require `minMessagesToCompact` or skip.
 * 6. **Reference-only insert** — summary is a system message between prefix and tail;
 *    **no default durable rewrite** of the learner conversation body / session JSON.
 * 7. **Insufficient-reduction guard** — if token savings after replace fall below the
 *    configured floor, treat as no-op failure and keep the original transcript.
 */
export const CONTEXT_COMPACTOR_CUT_POINT_STRATEGY = {
  preserveLeadingSystem: true,
  preserveLatestUserInTail: true,
  repairToolPairs: true,
  referenceOnlySummary: true,
  durableRewriteDefault: false,
  insufficientReductionGuard: true
} as const

export type ContextCompactionSummaryRequest = {
  messages: ChatMessage[]
  mode: ContextCompactionMode
  reason: ContextCompactionReason
  sourceDigest: string
  inputTokens: number
  maxSummaryTokens: number
}

export type ContextCompactionOptions = {
  enabled?: boolean
  force?: boolean
  now?: () => number
  contextWindowTokens?: number
  softThresholdTokens?: number
  hardThresholdTokens?: number
  softThresholdRatio?: number
  hardThresholdRatio?: number
  normalTailRatio?: number
  aggressiveTailRatio?: number
  minTailMessages?: number
  minMessagesToCompact?: number
  summaryInputTokenLimit?: number
  maxSummaryTokens?: number
  failureCooldownMs?: number
  /**
   * Absolute minimum token savings (`before - after`) required to accept a compaction.
   * Defaults to a small floor so pure churn / inflate paths fail closed.
   */
  minTokenSavings?: number
  /**
   * Relative savings floor: `(before - after) / before` must be ≥ this ratio when
   * `before > 0`. Defaults to 5%. Either this or `minTokenSavings` may trip the guard.
   */
  minTokenReductionRatio?: number
  /**
   * Optional shared pressure controller (single-flight + ladder).
   * When omitted, the compactor owns a private controller for this instance.
   */
  pressureController?: CompactionPressureController
}

export type ContextCompactionCutAudit = {
  /** Index of the first kept tail message in the original array (exclusive end of compact slice). */
  cutIndex: number
  /** Leading system messages retained as prefix. */
  systemPrefixCount: number
  /** Messages in the compact slice that would be replaced by the summary. */
  messagesRemovedCount: number
  /** Messages retained after the cut (kept suffix). */
  keptSuffixCount: number
}

export type ContextCompactionEvent =
  | {
      type: 'context_compaction_started'
      reason: ContextCompactionReason
      mode: ContextCompactionMode
      estimate: TokenEstimate
      thresholdTokens: number
      contextWindowTokens: number
      sourceDigest: string
      cutIndex: number
      systemPrefixCount: number
      messagesRemovedCount: number
      keptSuffixCount: number
    }
  | {
      type: 'context_compaction_completed'
      reason: ContextCompactionReason
      mode: ContextCompactionMode
      replacedTokens: number
      summaryTokens: number
      beforeTokens: number
      afterTokens: number
      /** @deprecated Prefer `messagesRemovedCount` — same value. */
      replacedMessages: number
      /** @deprecated Prefer `keptSuffixCount` — same value. */
      tailMessages: number
      messagesRemovedCount: number
      keptSuffixCount: number
      cutIndex: number
      systemPrefixCount: number
      tokenSavings: number
      outcomeCode: 'completed'
      sourceDigest: string
      cached: boolean
      compactionId: string
      createdAt: string
      replacedTurnIds: string[]
    }
  | {
      type: 'context_compaction_failed'
      reason: ContextCompactionReason
      mode: ContextCompactionMode
      error: string
      cooldownUntil: string
      sourceDigest: string
      compactionId: string
      createdAt: string
      replacedTurnIds: string[]
      outcomeCode: ContextCompactionOutcomeCode
      cutIndex: number
      systemPrefixCount: number
      messagesRemovedCount: number
      keptSuffixCount: number
      beforeTokens?: number
      afterTokens?: number
      tokenSavings?: number
    }

export type ContextCompactionResult = {
  messages: ChatMessage[]
  changed: boolean
  estimateBefore: TokenEstimate
  estimateAfter: TokenEstimate
  /** Ordered lifecycle trace for this compaction attempt. */
  events: readonly ContextCompactionEvent[]
}

export type ContextCompactorSummarizer = (request: ContextCompactionSummaryRequest) => Promise<string>

type NormalizedContextCompactionOptions = Required<
  Omit<
    ContextCompactionOptions,
    'softThresholdTokens' | 'hardThresholdTokens' | 'pressureController'
  >
> & {
  softThresholdTokens?: number
  hardThresholdTokens?: number
}

type CompactionPlan = {
  mode: ContextCompactionMode
  reason: ContextCompactionReason
  thresholdTokens: number
  contextWindowTokens: number
  systemPrefix: ChatMessage[]
  compactedMessages: ChatMessage[]
  tailMessages: ChatMessage[]
  /** Exclusive end of the compact slice / first kept tail index. */
  cutIndex: number
  systemPrefixCount: number
  sourceDigest: string
  replacedTurnIds: string[]
  summaryInput: ChatMessage[]
  summaryInputTokens: number
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000
const DEFAULT_SOFT_THRESHOLD_RATIO = 0.6
const DEFAULT_HARD_THRESHOLD_RATIO = 0.8
const DEFAULT_NORMAL_TAIL_RATIO = 0.35
const DEFAULT_AGGRESSIVE_TAIL_RATIO = 0.25
const DEFAULT_MIN_TAIL_MESSAGES = 8
const DEFAULT_MIN_MESSAGES_TO_COMPACT = 4
const DEFAULT_SUMMARY_INPUT_TOKEN_LIMIT = 16_000
const DEFAULT_MAX_SUMMARY_TOKENS = 1_200
const DEFAULT_FAILURE_COOLDOWN_MS = 5 * 60 * 1000
const DEFAULT_MIN_TOKEN_SAVINGS = 32
const DEFAULT_MIN_TOKEN_REDUCTION_RATIO = 0.05
const SUMMARY_START = '[CONTEXT COMPACTION - REFERENCE ONLY]'
const SUMMARY_END = '[END CONTEXT COMPACTION]'

export class ContextCompactor {
  private readonly estimator: ContextEstimator
  private readonly options: NormalizedContextCompactionOptions
  private readonly summarize: ContextCompactorSummarizer
  private readonly summaries = new Map<string, string>()
  private readonly pressure: CompactionPressureController
  private failureCooldownUntil = 0

  constructor(options: ContextCompactionOptions & {
    estimator?: ContextEstimator
    summarize: ContextCompactorSummarizer
  }) {
    this.estimator = options.estimator ?? new ContextEstimator()
    this.summarize = options.summarize
    this.options = normalizeOptions(options)
    this.pressure = options.pressureController ?? new CompactionPressureController()
  }

  /** Run-scoped pressure ladder state (read-only snapshot). */
  get pressureState() {
    return this.pressure.pressure
  }

  get isCompactionInFlight(): boolean {
    return this.pressure.isCompactionInFlight
  }

  /**
   * Project-only compaction entry. Call sites may label pre_send / mid_stream /
   * post_tool for audit; labels do **not** change algorithm or start a second flight.
   * Concurrent callers join the first in-flight compact (see CompactionSingleFlight).
   * Shipping mid_stream is a trigger label only — not a true mid-token overflow
   * interceptor. Hard run budget remains authoritative: exhausted/pending → no-op.
   */
  async compactIfNeeded(input: {
    messages: ChatMessage[]
    tools?: ToolDefinition[]
    estimate?: TokenEstimate
    /** IDs aligned with messages, used only for persisted conversation lineage. */
    messageTurnIds?: readonly (string | undefined)[]
    /**
     * Optional multi-point trigger label for audit / call-site classification.
     * Currently unused by the compact body (join + ladder are label-agnostic).
     */
    triggerPoint?: CompactionTriggerPoint
    /** When true, skip compaction (hard run budget / durable-success authority). */
    hardBudgetExhausted?: boolean
    runBudgetStopPending?: boolean
  }): Promise<ContextCompactionResult> {
    // Label retained for future policy / audit; body is trigger-agnostic today.
    void input.triggerPoint
    return this.pressure.runSingleFlight(() => this.compactIfNeededExclusive(input))
  }

  private async compactIfNeededExclusive(input: {
    messages: ChatMessage[]
    tools?: ToolDefinition[]
    estimate?: TokenEstimate
    messageTurnIds?: readonly (string | undefined)[]
    hardBudgetExhausted?: boolean
    runBudgetStopPending?: boolean
  }): Promise<ContextCompactionResult> {
    const estimateBefore = input.estimate ?? this.estimator.estimateRequest(input.messages, { tools: input.tools })
    const unchanged = (): ContextCompactionResult => ({
      messages: input.messages,
      changed: false,
      estimateBefore,
      estimateAfter: estimateBefore,
      events: []
    })

    if (!this.options.enabled) return unchanged()
    if (
      shouldSkipCompactionForHardBudget({
        hardBudgetExhausted: input.hardBudgetExhausted,
        runBudgetStopPending: input.runBudgetStopPending
      })
    ) {
      return unchanged()
    }
    if (!this.options.force && this.options.now() < this.failureCooldownUntil) return unchanged()

    const pressureOverrides = this.pressure.optionOverrides()
    const plan = this.plan(input.messages, input.tools, estimateBefore, input.messageTurnIds, pressureOverrides)
    if (!plan) return unchanged()

    const cutAudit = cutAuditFromPlan(plan)
    const events: ContextCompactionEvent[] = [
      {
        type: 'context_compaction_started',
        reason: plan.reason,
        mode: plan.mode,
        estimate: estimateBefore,
        thresholdTokens: plan.thresholdTokens,
        contextWindowTokens: plan.contextWindowTokens,
        sourceDigest: plan.sourceDigest,
        ...cutAudit
      }
    ]

    try {
      const cached = this.summaries.get(plan.sourceDigest)
      const summary = cached ?? await this.summarize({
        messages: plan.summaryInput,
        mode: plan.mode,
        reason: plan.reason,
        sourceDigest: plan.sourceDigest,
        inputTokens: plan.summaryInputTokens,
        maxSummaryTokens: this.options.maxSummaryTokens
      })
      const cleanSummary = cleanSummaryText(summary)
      if (!cleanSummary) {
        this.pressure.recordOutcome({ stillOverThreshold: true, compacted: false })
        return this.failClosed({
          inputMessages: input.messages,
          estimateBefore,
          events,
          plan,
          cutAudit,
          error: 'Compaction summary was empty.',
          outcomeCode: 'summary_empty',
          replacedTurnIds: []
        })
      }

      const summaryMessage: ChatMessage = {
        role: 'system',
        content: formatReferenceOnlySummary({
          summary: cleanSummary,
          mode: plan.mode,
          reason: plan.reason,
          sourceDigest: plan.sourceDigest,
          replacedMessages: plan.compactedMessages.length
        })
      }
      const candidateMessages = [...plan.systemPrefix, summaryMessage, ...plan.tailMessages]
      const estimateAfter = this.estimator.estimateRequest(candidateMessages, { tools: input.tools })
      const replacedTokens = this.estimator.estimateMessages(plan.compactedMessages)
      const summaryTokens = this.estimator.estimateMessage(summaryMessage)
      const beforeTokens = estimateBefore.totalTokens
      const afterTokens = estimateAfter.totalTokens
      const tokenSavings = beforeTokens - afterTokens

      if (!reductionMeetsGuard({
        beforeTokens,
        afterTokens,
        minTokenSavings: this.options.minTokenSavings,
        minTokenReductionRatio: this.options.minTokenReductionRatio
      })) {
        // Do not cache a summary that produced insufficient reduction.
        this.pressure.recordOutcome({ stillOverThreshold: true, compacted: false })
        return this.failClosed({
          inputMessages: input.messages,
          estimateBefore,
          events,
          plan,
          cutAudit,
          error: `Insufficient reduction: saved ${tokenSavings} token(s) (before=${beforeTokens}, after=${afterTokens}).`,
          outcomeCode: 'insufficient_reduction',
          replacedTurnIds: plan.replacedTurnIds,
          beforeTokens,
          afterTokens,
          tokenSavings
        })
      }

      this.summaries.set(plan.sourceDigest, cleanSummary)
      // Ladder uses soft threshold: if we would still trigger on the next projection,
      // escalate prune pressure (avoid thrash via single-flight + consecutive only-on-compact).
      const softThreshold =
        this.options.softThresholdTokens ??
        Math.floor(this.options.contextWindowTokens * this.options.softThresholdRatio)
      const stillOverThreshold = afterTokens >= softThreshold
      this.pressure.recordOutcome({ stillOverThreshold, compacted: true })
      events.push({
        type: 'context_compaction_completed',
        reason: plan.reason,
        mode: plan.mode,
        replacedTokens,
        summaryTokens,
        beforeTokens,
        afterTokens,
        replacedMessages: plan.compactedMessages.length,
        tailMessages: plan.tailMessages.length,
        messagesRemovedCount: cutAudit.messagesRemovedCount,
        keptSuffixCount: cutAudit.keptSuffixCount,
        cutIndex: cutAudit.cutIndex,
        systemPrefixCount: cutAudit.systemPrefixCount,
        tokenSavings,
        outcomeCode: 'completed',
        sourceDigest: plan.sourceDigest,
        cached: Boolean(cached),
        compactionId: `compaction:${plan.sourceDigest}`,
        createdAt: new Date(this.options.now()).toISOString(),
        replacedTurnIds: plan.replacedTurnIds
      })
      return {
        messages: candidateMessages,
        changed: true,
        estimateBefore,
        estimateAfter,
        events
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.pressure.recordOutcome({ stillOverThreshold: true, compacted: false })
      return this.failClosed({
        inputMessages: input.messages,
        estimateBefore,
        events,
        plan,
        cutAudit,
        error: message,
        outcomeCode: 'summarize_error',
        replacedTurnIds: []
      })
    }
  }

  private failClosed(input: {
    inputMessages: ChatMessage[]
    estimateBefore: TokenEstimate
    events: ContextCompactionEvent[]
    plan: CompactionPlan
    cutAudit: ContextCompactionCutAudit
    error: string
    outcomeCode: Exclude<ContextCompactionOutcomeCode, 'completed'>
    replacedTurnIds: string[]
    beforeTokens?: number
    afterTokens?: number
    tokenSavings?: number
  }): ContextCompactionResult {
    const failedAtMs = this.options.now()
    const cooldownUntilMs = failedAtMs + this.options.failureCooldownMs
    this.failureCooldownUntil = cooldownUntilMs
    input.events.push({
      type: 'context_compaction_failed',
      reason: input.plan.reason,
      mode: input.plan.mode,
      error: input.error,
      cooldownUntil: new Date(cooldownUntilMs).toISOString(),
      sourceDigest: input.plan.sourceDigest,
      compactionId: `compaction:${input.plan.sourceDigest}:failed`,
      createdAt: new Date(failedAtMs).toISOString(),
      replacedTurnIds: input.replacedTurnIds,
      outcomeCode: input.outcomeCode,
      cutIndex: input.cutAudit.cutIndex,
      systemPrefixCount: input.cutAudit.systemPrefixCount,
      messagesRemovedCount: input.cutAudit.messagesRemovedCount,
      keptSuffixCount: input.cutAudit.keptSuffixCount,
      beforeTokens: input.beforeTokens,
      afterTokens: input.afterTokens,
      tokenSavings: input.tokenSavings
    })
    // Product floor: never drop or rewrite the original transcript on failure.
    return {
      messages: input.inputMessages,
      changed: false,
      estimateBefore: input.estimateBefore,
      estimateAfter: input.estimateBefore,
      events: input.events
    }
  }

  private plan(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    estimate: TokenEstimate,
    messageTurnIds: readonly (string | undefined)[] | undefined,
    pressureOverrides: CompactionPressureOptionOverrides
  ): CompactionPlan | null {
    const contextWindowTokens = this.options.contextWindowTokens
    const softThreshold = this.options.softThresholdTokens ?? Math.floor(contextWindowTokens * this.options.softThresholdRatio)
    const hardThreshold = this.options.hardThresholdTokens ?? Math.floor(contextWindowTokens * this.options.hardThresholdRatio)
    const trigger = triggerForEstimate({
      estimate,
      force: this.options.force,
      softThreshold,
      hardThreshold,
      preferAggressive: pressureOverrides.preferAggressive
    })
    if (!trigger) return null

    const systemCount = leadingSystemMessageCount(messages)
    const baseTailRatio =
      trigger.mode === 'aggressive' ? this.options.aggressiveTailRatio : this.options.normalTailRatio
    const scaledTailRatio = Math.min(0.95, Math.max(0.05, baseTailRatio * pressureOverrides.tailRatioScale))
    const tailBudget = Math.max(256, Math.floor(contextWindowTokens * scaledTailRatio))
    const minTailMessages = Math.max(1, this.options.minTailMessages + pressureOverrides.minTailMessagesDelta)
    const boundary = repairToolPairBoundary(
      messages,
      chooseTailBoundary(messages, systemCount, tailBudget, minTailMessages, this.estimator),
      systemCount
    )
    if (boundary <= systemCount) return null

    const compactedMessages = messages.slice(systemCount, boundary)
    const replacedTurnIds = uniqueTurnIds(messageTurnIds?.slice(systemCount, boundary))
    if (compactedMessages.length < this.options.minMessagesToCompact) return null

    const tailMessages = messages.slice(boundary)
    const systemPrefix = messages.slice(0, systemCount)
    const sourceDigest = digestMessages(compactedMessages)
    const rendered = renderMessagesForSummary(compactedMessages, this.estimator, this.options.summaryInputTokenLimit)
    const summaryInput = buildSummaryRequestMessages({
      renderedMessages: rendered.text,
      mode: trigger.mode,
      reason: trigger.reason,
      sourceDigest,
      toolSchemaTokens: this.estimator.estimateTools(tools)
    })
    return {
      mode: trigger.mode,
      reason: trigger.reason,
      thresholdTokens: trigger.thresholdTokens,
      contextWindowTokens,
      systemPrefix,
      compactedMessages,
      tailMessages,
      cutIndex: boundary,
      systemPrefixCount: systemCount,
      sourceDigest,
      replacedTurnIds,
      summaryInput,
      summaryInputTokens: rendered.tokens
    }
  }
}

export function inferContextWindowTokens(
  modelId: string,
  provider?: { id?: string; baseUrl?: string }
): number {
  const catalogContextWindow = modelContextWindowTokens({
    providerId: provider?.id,
    providerBaseUrl: provider?.baseUrl,
    modelId
  })
  if (catalogContextWindow) return catalogContextWindow
  const model = modelId.toLowerCase()
  const explicit = /(?:^|[^0-9])(\d{2,3})k(?:[^0-9]|$)/i.exec(model)?.[1]
  if (explicit) return Number(explicit) * 1000
  if (/gpt-5|gpt-4\.1|gpt-4o|claude|deepseek|glm-5|mimo|grok|gemini/.test(model)) {
    return 128_000
  }
  if (/32k/.test(model)) return 32_000
  if (/16k/.test(model)) return 16_000
  return DEFAULT_CONTEXT_WINDOW_TOKENS
}

export function buildSummaryRequestMessages(input: {
  renderedMessages: string
  mode: ContextCompactionMode
  reason: ContextCompactionReason
  sourceDigest: string
  toolSchemaTokens: number
}): ChatMessage[] {
  // File-touch ledger is never part of this payload: callers pass only
  // rendered compacted transcript text (ledger is injected post-compaction).
  return [
    {
      role: 'system',
      content: [
        'You are a context compaction assistant for StudiumX.',
        'Summarize earlier conversation turns so the main assistant can continue the current conversation safely.',
        'Return only the summary. Do not answer any old user request. Do not invent facts.',
        'Preserve stable user constraints, resolved decisions, file paths, source IDs, errors, and open risks.',
        'Make it clear which facts are historical background. Prefer Chinese when the source conversation is Chinese.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `<compaction-request mode="${input.mode}" reason="${input.reason}" sourceDigest="${input.sourceDigest}">`,
        `toolSchemaTokens: ${input.toolSchemaTokens}`,
        '<messages-to-compact>',
        input.renderedMessages,
        '</messages-to-compact>',
        '</compaction-request>'
      ].join('\n')
    }
  ]
}

/**
 * Pure guard used after a candidate compaction estimate is available.
 * Returns true when savings meet both absolute and relative floors.
 */
export function reductionMeetsGuard(input: {
  beforeTokens: number
  afterTokens: number
  minTokenSavings: number
  minTokenReductionRatio: number
}): boolean {
  const before = Math.max(0, Math.floor(input.beforeTokens))
  const after = Math.max(0, Math.floor(input.afterTokens))
  const savings = before - after
  if (savings < input.minTokenSavings) return false
  if (before <= 0) return savings > 0
  const ratio = savings / before
  return ratio + Number.EPSILON >= input.minTokenReductionRatio
}

/**
 * Select the exclusive cut index for the compact slice using the documented
 * cut-point strategy (tail budget + min messages + latest-user anchor).
 * Exported for unit verification of cut-point behaviour.
 */
export function selectCompactionCutIndex(input: {
  messages: ChatMessage[]
  systemCount: number
  tailBudgetTokens: number
  minTailMessages: number
  estimator: ContextEstimator
}): number {
  const initial = chooseTailBoundary(
    input.messages,
    input.systemCount,
    input.tailBudgetTokens,
    input.minTailMessages,
    input.estimator
  )
  return repairToolPairBoundary(input.messages, initial, input.systemCount)
}

function cutAuditFromPlan(plan: CompactionPlan): ContextCompactionCutAudit {
  return {
    cutIndex: plan.cutIndex,
    systemPrefixCount: plan.systemPrefixCount,
    messagesRemovedCount: plan.compactedMessages.length,
    keptSuffixCount: plan.tailMessages.length
  }
}

function normalizeOptions(
  options: ContextCompactionOptions & { summarize: ContextCompactorSummarizer }
): NormalizedContextCompactionOptions {
  const contextWindowTokens = clampInteger(
    options.contextWindowTokens,
    2_000,
    2_000_000,
    DEFAULT_CONTEXT_WINDOW_TOKENS
  )
  const softThresholdTokens =
    options.softThresholdTokens === undefined
      ? undefined
      : clampInteger(options.softThresholdTokens, 512, contextWindowTokens, Math.floor(contextWindowTokens * DEFAULT_SOFT_THRESHOLD_RATIO))
  const hardThresholdTokens =
    options.hardThresholdTokens === undefined
      ? undefined
      : clampInteger(options.hardThresholdTokens, 512, contextWindowTokens, Math.floor(contextWindowTokens * DEFAULT_HARD_THRESHOLD_RATIO))
  return {
    enabled: options.enabled !== false,
    force: options.force === true,
    contextWindowTokens,
    softThresholdTokens,
    hardThresholdTokens,
    softThresholdRatio: clampRatio(options.softThresholdRatio, DEFAULT_SOFT_THRESHOLD_RATIO),
    hardThresholdRatio: clampRatio(options.hardThresholdRatio, DEFAULT_HARD_THRESHOLD_RATIO),
    normalTailRatio: clampRatio(options.normalTailRatio, DEFAULT_NORMAL_TAIL_RATIO),
    aggressiveTailRatio: clampRatio(options.aggressiveTailRatio, DEFAULT_AGGRESSIVE_TAIL_RATIO),
    minTailMessages: clampInteger(options.minTailMessages, 1, 40, DEFAULT_MIN_TAIL_MESSAGES),
    minMessagesToCompact: clampInteger(options.minMessagesToCompact, 1, 40, DEFAULT_MIN_MESSAGES_TO_COMPACT),
    summaryInputTokenLimit: clampInteger(
      options.summaryInputTokenLimit,
      512,
      200_000,
      DEFAULT_SUMMARY_INPUT_TOKEN_LIMIT
    ),
    maxSummaryTokens: clampInteger(options.maxSummaryTokens, 128, 8_000, DEFAULT_MAX_SUMMARY_TOKENS),
    failureCooldownMs: clampInteger(options.failureCooldownMs, 1_000, 60 * 60 * 1000, DEFAULT_FAILURE_COOLDOWN_MS),
    minTokenSavings: clampInteger(options.minTokenSavings, 0, 1_000_000, DEFAULT_MIN_TOKEN_SAVINGS),
    minTokenReductionRatio: clampRatio(options.minTokenReductionRatio, DEFAULT_MIN_TOKEN_REDUCTION_RATIO),
    now: options.now ?? (() => Date.now())
  }
}

function uniqueTurnIds(values: readonly (string | undefined)[] | undefined): string[] {
  if (!values) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function triggerForEstimate(input: {
  estimate: TokenEstimate
  force: boolean
  softThreshold: number
  hardThreshold: number
  /** Pressure ladder: escalate soft triggers to aggressive prune. */
  preferAggressive?: boolean
}): { mode: ContextCompactionMode; reason: ContextCompactionReason; thresholdTokens: number } | null {
  if (input.force) return { mode: 'manual', reason: 'manual', thresholdTokens: input.softThreshold }
  if (input.estimate.totalTokens >= input.hardThreshold) {
    return { mode: 'aggressive', reason: 'hard_threshold', thresholdTokens: input.hardThreshold }
  }
  if (input.estimate.totalTokens >= input.softThreshold) {
    const mode: ContextCompactionMode = input.preferAggressive ? 'aggressive' : 'normal'
    return { mode, reason: 'soft_threshold', thresholdTokens: input.softThreshold }
  }
  return null
}

function leadingSystemMessageCount(messages: ChatMessage[]): number {
  let count = 0
  for (const message of messages) {
    if (message.role !== 'system') break
    count += 1
  }
  return count
}

function chooseTailBoundary(
  messages: ChatMessage[],
  systemCount: number,
  tailBudgetTokens: number,
  minTailMessages: number,
  estimator: ContextEstimator
): number {
  const latestUserIndex = latestRoleIndex(messages, 'user')
  let boundary = messages.length
  let tailTokens = 0
  for (let index = messages.length - 1; index >= systemCount; index -= 1) {
    const cost = estimator.estimateMessage(messages[index]!)
    const tailMessageCount = messages.length - index
    if (tailMessageCount > minTailMessages && tailTokens + cost > tailBudgetTokens) break
    tailTokens += cost
    boundary = index
  }
  if (latestUserIndex >= systemCount && latestUserIndex < boundary) boundary = latestUserIndex
  return boundary
}

function repairToolPairBoundary(messages: ChatMessage[], initialBoundary: number, systemCount: number): number {
  let boundary = initialBoundary
  let changed = true
  while (changed) {
    changed = false
    for (let index = boundary; index < messages.length; index += 1) {
      const message = messages[index]
      if (message?.role !== 'tool') continue
      const assistantIndex = findAssistantToolCallIndex(messages, message.tool_call_id, index - 1)
      if (assistantIndex >= systemCount && assistantIndex < boundary) {
        boundary = assistantIndex
        changed = true
        break
      }
    }
  }
  return boundary
}

function findAssistantToolCallIndex(messages: ChatMessage[], toolCallId: string, startIndex: number): number {
  for (let index = startIndex; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    if (message.tool_calls?.some((call) => call.id === toolCallId)) return index
  }
  return -1
}

function latestRoleIndex(messages: ChatMessage[], role: ChatMessage['role']): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) return index
  }
  return -1
}

function renderMessagesForSummary(
  messages: ChatMessage[],
  estimator: ContextEstimator,
  maxTokens: number
): { text: string; tokens: number } {
  const blocks: string[] = []
  let tokens = 0
  for (let index = 0; index < messages.length; index += 1) {
    const block = renderMessageForSummary(messages[index]!, index)
    const cost = estimator.estimateText(block)
    if (tokens + cost > maxTokens) {
      const remaining = Math.max(0, maxTokens - tokens)
      if (remaining > 64) {
        const clipped = truncateTextToTokenBudget(block, remaining, estimator)
        if (clipped.trim()) blocks.push(clipped)
      }
      blocks.push(`[compaction input truncated: omitted ${messages.length - index} message(s)]`)
      break
    }
    blocks.push(block)
    tokens += cost
  }
  return { text: blocks.join('\n\n'), tokens }
}

function renderMessageForSummary(message: ChatMessage, index: number): string {
  if (message.role === 'assistant') {
    const toolCalls = message.tool_calls?.length
      ? `\ntool_calls: ${safeStringify(message.tool_calls)}`
      : ''
    return `<message index="${index}" role="assistant">\n${message.content ?? ''}${toolCalls}\n</message>`
  }
  if (message.role === 'tool') {
    return `<message index="${index}" role="tool" tool_call_id="${escapeAttribute(message.tool_call_id)}">\n${message.content}\n</message>`
  }
  return `<message index="${index}" role="${message.role}">\n${message.content}\n</message>`
}

function formatReferenceOnlySummary(input: {
  summary: string
  mode: ContextCompactionMode
  reason: ContextCompactionReason
  sourceDigest: string
  replacedMessages: number
}): string {
  return [
    SUMMARY_START,
    'Earlier turns were compacted into the summary below.',
    'Use this only as background. The latest user message after this summary is authoritative.',
    `mode: ${input.mode}`,
    `reason: ${input.reason}`,
    `sourceDigest: ${input.sourceDigest}`,
    `replacedMessages: ${input.replacedMessages}`,
    '',
    input.summary,
    SUMMARY_END
  ].join('\n')
}

function cleanSummaryText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function digestMessages(messages: ChatMessage[]): string {
  return stableHash(messages.map((message) => renderMessageForDigest(message)).join('\n\n'))
}

function renderMessageForDigest(message: ChatMessage): string {
  if (message.role === 'assistant') return `assistant:${message.content ?? ''}:${safeStringify(message.tool_calls ?? [])}`
  if (message.role === 'tool') return `tool:${message.tool_call_id}:${message.content}`
  return `${message.role}:${message.content}`
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `ctx_${(hash >>> 0).toString(36)}`
}

function truncateTextToTokenBudget(text: string, maxTokens: number, estimator: ContextEstimator): string {
  let out = ''
  let tokens = 0
  for (const char of text) {
    const cost = estimator.estimateText(char)
    if (tokens + cost > maxTokens) break
    out += char
    tokens += cost
  }
  return out
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function clampRatio(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(0.95, Math.max(0.05, parsed))
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "'")
}
