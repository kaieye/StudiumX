import type { ChatMessage, ToolDefinition } from './provider-adapter'
import { ContextEstimator, type TokenEstimate } from './context-estimator'
import {
  ContextCompactor,
  inferContextWindowTokens,
  type CompactionTriggerPoint,
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
import {
  appendFileTouchLedgerDataMessage,
  rebuildFileTouchLedgerFromTranscript,
  stripFileTouchLedgerMessages,
  type ContextFileLedger,
  type ContextFileLedgerBudget
} from './context-file-ledger'

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
  /**
   * Deterministic file-touch ledger used for this projection (data only).
   * Not teaching-evidence / settlement authority.
   */
  fileTouchLedger?: ContextFileLedger
}

export type RequestContextProjectorOptions = {
  modelId: string
  provider?: { id?: string; baseUrl?: string }
  compaction?: ContextCompactionOptions
  hygiene?: RequestHistoryHygieneOptions
  summarize: ContextCompactorSummarizer
  onTrace?: (event: RequestContextProjectionTrace) => void
  /**
   * Optional live file-touch ledger snapshot or getter (agent loop updates).
   * When omitted, the projector rebuilds from tool_calls in the transcript.
   * Ledger is injected **after** compaction so it never enters summarizer input.
   */
  fileTouchLedger?: ContextFileLedger | (() => ContextFileLedger | undefined)
  fileTouchLedgerBudget?: Partial<ContextFileLedgerBudget>
  /** When false, skip ledger injection (default true). */
  injectFileTouchLedger?: boolean
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
  private readonly fileTouchLedgerSource?:
    | ContextFileLedger
    | (() => ContextFileLedger | undefined)
  private readonly fileTouchLedgerBudget?: Partial<ContextFileLedgerBudget>
  private readonly injectFileTouchLedger: boolean

  constructor(options: RequestContextProjectorOptions) {
    this.estimator = new ContextEstimator()
    this.hygiene = options.hygiene ?? {}
    this.onTrace = options.onTrace
    this.fileTouchLedgerSource = options.fileTouchLedger
    this.fileTouchLedgerBudget = options.fileTouchLedgerBudget
    this.injectFileTouchLedger = options.injectFileTouchLedger !== false
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
    messageTurnIds?: readonly (string | undefined)[],
    options?: {
      /** Multi-point trigger for compaction single-flight / audit (pre_send | mid_stream | post_tool). */
      compactionTriggerPoint?: CompactionTriggerPoint
      hardBudgetExhausted?: boolean
      runBudgetStopPending?: boolean
    }
  ): Promise<RequestContextProjection> {
    // Strip prior ledger data messages so hygiene/compaction never treat them as history.
    const cleanedTranscript = stripFileTouchLedgerMessages(transcript)
    const hygiene = applyRequestHistoryHygiene(cleanedTranscript, this.hygiene, this.estimator)
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
      messageTurnIds:
        messageTurnIds?.length === cleanedTranscript.length || messageTurnIds?.length === transcript.length
          ? messageTurnIds
          : undefined,
      triggerPoint: options?.compactionTriggerPoint ?? 'pre_send',
      hardBudgetExhausted: options?.hardBudgetExhausted,
      runBudgetStopPending: options?.runBudgetStopPending
    })
    for (const event of compaction.events) recordTrace(event)
    recordTrace({ type: 'context_estimated', estimate: compaction.estimateAfter })

    // Inject ledger **after** compaction: structured data, not summarizer input.
    const fileTouchLedger = this.resolveFileTouchLedger(cleanedTranscript)
    const projectedMessages = this.injectFileTouchLedger
      ? appendFileTouchLedgerDataMessage(compaction.messages, fileTouchLedger)
      : compaction.messages

    const report = buildRequestContextProjectionReport({
      transcriptLength: transcript.length,
      projectedMessages,
      tools,
      estimate: compaction.estimateAfter,
      contextWindowTokens: this.contextWindowTokens,
      trace
    })
    return {
      messages: projectedMessages,
      trace,
      report,
      ...(fileTouchLedger.entries.length > 0 ? { fileTouchLedger } : {})
    }
  }

  private resolveFileTouchLedger(transcript: readonly ChatMessage[]): ContextFileLedger {
    const source = this.fileTouchLedgerSource
    if (typeof source === 'function') {
      const live = source()
      if (live) return live
    } else if (source) {
      return source
    }
    return rebuildFileTouchLedgerFromTranscript(transcript, this.fileTouchLedgerBudget)
  }
}
