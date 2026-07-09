import type { ChatMessage, ToolDefinition } from './provider-adapter'
import { ContextEstimator, type TokenEstimate } from './context-estimator'

export type ContextCompactionMode = 'normal' | 'aggressive' | 'manual'
export type ContextCompactionReason = 'soft_threshold' | 'hard_threshold' | 'manual'

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
    }
  | {
      type: 'context_compaction_completed'
      reason: ContextCompactionReason
      mode: ContextCompactionMode
      replacedTokens: number
      summaryTokens: number
      beforeTokens: number
      afterTokens: number
      replacedMessages: number
      tailMessages: number
      sourceDigest: string
      cached: boolean
    }
  | {
      type: 'context_compaction_failed'
      reason: ContextCompactionReason
      mode: ContextCompactionMode
      error: string
      cooldownUntil: string
      sourceDigest: string
    }

export type ContextCompactionResult = {
  messages: ChatMessage[]
  changed: boolean
  estimateBefore: TokenEstimate
  estimateAfter: TokenEstimate
  events: ContextCompactionEvent[]
}

export type ContextCompactorSummarizer = (request: ContextCompactionSummaryRequest) => Promise<string>

type NormalizedContextCompactionOptions = Required<Omit<ContextCompactionOptions, 'softThresholdTokens' | 'hardThresholdTokens'>> & {
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
  sourceDigest: string
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
const SUMMARY_START = '[CONTEXT COMPACTION - REFERENCE ONLY]'
const SUMMARY_END = '[END CONTEXT COMPACTION]'

export class ContextCompactor {
  private readonly estimator: ContextEstimator
  private readonly options: NormalizedContextCompactionOptions
  private readonly summarize: ContextCompactorSummarizer
  private readonly summaries = new Map<string, string>()
  private failureCooldownUntil = 0

  constructor(options: ContextCompactionOptions & {
    estimator?: ContextEstimator
    summarize: ContextCompactorSummarizer
  }) {
    this.estimator = options.estimator ?? new ContextEstimator()
    this.summarize = options.summarize
    this.options = normalizeOptions(options)
  }

  async compactIfNeeded(input: {
    messages: ChatMessage[]
    tools?: ToolDefinition[]
    estimate?: TokenEstimate
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
    if (!this.options.force && this.options.now() < this.failureCooldownUntil) return unchanged()

    const plan = this.plan(input.messages, input.tools, estimateBefore)
    if (!plan) return unchanged()

    const events: ContextCompactionEvent[] = [
      {
        type: 'context_compaction_started',
        reason: plan.reason,
        mode: plan.mode,
        estimate: estimateBefore,
        thresholdTokens: plan.thresholdTokens,
        contextWindowTokens: plan.contextWindowTokens,
        sourceDigest: plan.sourceDigest
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
      if (!cleanSummary) throw new Error('Compaction summary was empty.')
      this.summaries.set(plan.sourceDigest, cleanSummary)

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
      const messages = [...plan.systemPrefix, summaryMessage, ...plan.tailMessages]
      const estimateAfter = this.estimator.estimateRequest(messages, { tools: input.tools })
      const replacedTokens = this.estimator.estimateMessages(plan.compactedMessages)
      const summaryTokens = this.estimator.estimateMessage(summaryMessage)
      events.push({
        type: 'context_compaction_completed',
        reason: plan.reason,
        mode: plan.mode,
        replacedTokens,
        summaryTokens,
        beforeTokens: estimateBefore.totalTokens,
        afterTokens: estimateAfter.totalTokens,
        replacedMessages: plan.compactedMessages.length,
        tailMessages: plan.tailMessages.length,
        sourceDigest: plan.sourceDigest,
        cached: Boolean(cached)
      })
      return {
        messages,
        changed: true,
        estimateBefore,
        estimateAfter,
        events
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cooldownUntilMs = this.options.now() + this.options.failureCooldownMs
      this.failureCooldownUntil = cooldownUntilMs
      events.push({
        type: 'context_compaction_failed',
        reason: plan.reason,
        mode: plan.mode,
        error: message,
        cooldownUntil: new Date(cooldownUntilMs).toISOString(),
        sourceDigest: plan.sourceDigest
      })
      return {
        messages: input.messages,
        changed: false,
        estimateBefore,
        estimateAfter: estimateBefore,
        events
      }
    }
  }

  private plan(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    estimate: TokenEstimate
  ): CompactionPlan | null {
    const contextWindowTokens = this.options.contextWindowTokens
    const softThreshold = this.options.softThresholdTokens ?? Math.floor(contextWindowTokens * this.options.softThresholdRatio)
    const hardThreshold = this.options.hardThresholdTokens ?? Math.floor(contextWindowTokens * this.options.hardThresholdRatio)
    const trigger = triggerForEstimate({
      estimate,
      force: this.options.force,
      softThreshold,
      hardThreshold
    })
    if (!trigger) return null

    const systemCount = leadingSystemMessageCount(messages)
    const tailBudget = Math.max(
      256,
      Math.floor(contextWindowTokens * (trigger.mode === 'aggressive' ? this.options.aggressiveTailRatio : this.options.normalTailRatio))
    )
    const boundary = repairToolPairBoundary(
      messages,
      chooseTailBoundary(messages, systemCount, tailBudget, this.options.minTailMessages, this.estimator),
      systemCount
    )
    if (boundary <= systemCount) return null

    const compactedMessages = messages.slice(systemCount, boundary)
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
      sourceDigest,
      summaryInput,
      summaryInputTokens: rendered.tokens
    }
  }
}

export function inferContextWindowTokens(modelId: string): number {
  const model = modelId.toLowerCase()
  const explicit = /(?:^|[^0-9])(\d{2,3})k(?:[^0-9]|$)/i.exec(model)?.[1]
  if (explicit) return Number(explicit) * 1000
  if (/gpt-5|gpt-4\.1|gpt-4o|claude|deepseek|glm-4\.5|mimo|grok|gemini/.test(model)) {
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
  return [
    {
      role: 'system',
      content: [
        'You are a context compaction assistant for TeachOS.',
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
    now: options.now ?? (() => Date.now())
  }
}

function triggerForEstimate(input: {
  estimate: TokenEstimate
  force: boolean
  softThreshold: number
  hardThreshold: number
}): { mode: ContextCompactionMode; reason: ContextCompactionReason; thresholdTokens: number } | null {
  if (input.force) return { mode: 'manual', reason: 'manual', thresholdTokens: input.softThreshold }
  if (input.estimate.totalTokens >= input.hardThreshold) {
    return { mode: 'aggressive', reason: 'hard_threshold', thresholdTokens: input.hardThreshold }
  }
  if (input.estimate.totalTokens >= input.softThreshold) {
    return { mode: 'normal', reason: 'soft_threshold', thresholdTokens: input.softThreshold }
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
