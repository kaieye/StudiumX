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
import {
  buildRequestContextProjectionReport,
  type ContextProjectionReport
} from './context-projection-report'

export type { ContextCompactionOptions } from './context-compactor'
export type { ContextProjectionReport } from './context-projection-report'

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
  /** Privacy-safe budget/provenance audit of this projection (P1-6). */
  report: ContextProjectionReport
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
  private readonly contextWindowTokens: number

  constructor(options: RequestContextProjectorOptions) {
    this.estimator = new ContextEstimator()
    this.hygiene = options.hygiene ?? {}
    this.onTrace = options.onTrace
    this.contextWindowTokens =
      options.compaction?.contextWindowTokens ?? inferContextWindowTokens(options.modelId, options.provider)
    this.compactor = new ContextCompactor({
      estimator: this.estimator,
      enabled: options.compaction?.enabled ?? true,
      contextWindowTokens: this.contextWindowTokens,
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

  async project(
    transcript: ChatMessage[],
    tools: ToolDefinition[],
    messageTurnIds?: readonly (string | undefined)[]
  ): Promise<RequestContextProjection> {
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
      estimate,
      messageTurnIds: messageTurnIds?.length === transcript.length ? messageTurnIds : undefined
    })
    for (const event of compaction.events) recordTrace(event)
    recordTrace({ type: 'context_estimated', estimate: compaction.estimateAfter })
    const report = buildRequestContextProjectionReport({
      transcriptLength: transcript.length,
      projectedMessages: compaction.messages,
      tools,
      estimate: compaction.estimateAfter,
      contextWindowTokens: this.contextWindowTokens,
      trace
    })
    return { messages: compaction.messages, trace, report }
  }
}
