import type { ChatMessage, ToolDefinition } from './provider-adapter'
import { ContextEstimator, type TokenEstimate } from './context-estimator'
import {
  ContextCompactor,
  inferContextWindowTokens,
  type ContextCompactionEvent,
  type ContextCompactionOptions,
  type ContextCompactorSummarizer
} from './context-compactor'
import {
  applyRequestHistoryHygiene,
  requestHistoryHygieneDiagnostic,
  type RequestHistoryHygieneOptions
} from './request-history-hygiene'

export type { ContextCompactionOptions } from './context-compactor'

export type RequestContextProjectionTrace =
  | {
      type: 'context_hygiene_applied'
      changed: boolean
      savedTokens: number
      compactedToolResults: number
      digestedToolResults: number
      compactedToolCallArgs: number
    }
  | ContextCompactionEvent
  | { type: 'context_estimated'; estimate: TokenEstimate }

export type RequestContextProjection = {
  messages: ChatMessage[]
  trace: RequestContextProjectionTrace[]
}

export type RequestContextProjectorOptions = {
  modelId: string
  provider?: { id?: string; baseUrl?: string }
  compaction?: ContextCompactionOptions
  hygiene?: RequestHistoryHygieneOptions
  summarize: ContextCompactorSummarizer
  onTrace?: (event: RequestContextProjectionTrace) => void
}

/**
 * Projects an Agent transcript into the bounded message sequence sent to a
 * provider. This is the request-context seam: hygiene, estimation,
 * compaction, trace ordering, and tool-pair safety live behind it.
 *
 * The summarizer is deliberately the sole injected adapter. Provider-specific
 * invocation and retry policy stay with the Agent loop, which supplies that
 * summarizer when it constructs this module.
 */
export class RequestContextProjector {
  private readonly estimator: ContextEstimator
  private readonly compactor: ContextCompactor
  private readonly hygiene: RequestHistoryHygieneOptions
  private readonly onTrace?: (event: RequestContextProjectionTrace) => void

  constructor(options: RequestContextProjectorOptions) {
    this.estimator = new ContextEstimator()
    this.hygiene = options.hygiene ?? {}
    this.onTrace = options.onTrace
    this.compactor = new ContextCompactor({
      estimator: this.estimator,
      enabled: options.compaction?.enabled ?? true,
      contextWindowTokens:
        options.compaction?.contextWindowTokens ?? inferContextWindowTokens(options.modelId, options.provider),
      softThresholdTokens: options.compaction?.softThresholdTokens,
      hardThresholdTokens: options.compaction?.hardThresholdTokens,
      softThresholdRatio: options.compaction?.softThresholdRatio,
      hardThresholdRatio: options.compaction?.hardThresholdRatio,
      normalTailRatio: options.compaction?.normalTailRatio,
      aggressiveTailRatio: options.compaction?.aggressiveTailRatio,
      minTailMessages: options.compaction?.minTailMessages,
      minMessagesToCompact: options.compaction?.minMessagesToCompact,
      summaryInputTokenLimit: options.compaction?.summaryInputTokenLimit,
      maxSummaryTokens: options.compaction?.maxSummaryTokens,
      failureCooldownMs: options.compaction?.failureCooldownMs,
      force: options.compaction?.force,
      now: options.compaction?.now,
      summarize: options.summarize
    })
  }

  async project(transcript: ChatMessage[], tools: ToolDefinition[]): Promise<RequestContextProjection> {
    const hygiene = applyRequestHistoryHygiene(transcript, this.hygiene, this.estimator)
    const estimate = this.estimator.estimateRequest(hygiene.messages, { tools })
    const trace: RequestContextProjectionTrace[] = []
    const recordTrace = (event: RequestContextProjectionTrace): void => {
      trace.push(event)
      this.onTrace?.(event)
    }
    recordTrace(requestHistoryHygieneDiagnostic(hygiene))
    const compaction = await this.compactor.compactIfNeeded({
      messages: hygiene.messages,
      tools,
      estimate
    })
    for (const event of compaction.events) recordTrace(event)
    recordTrace({ type: 'context_estimated', estimate: compaction.estimateAfter })
    return { messages: compaction.messages, trace }
  }
}
