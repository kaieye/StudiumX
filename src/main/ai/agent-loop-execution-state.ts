import type { ChatAdapterResult, ChatMessage } from './provider-adapter'
import type {
  AgentRunUsageAggregate,
  AgentRunUsageProvenance,
  AgentRunResourceBoundarySnapshot,
  AgentRunResourceGovernance
} from '../../shared/teaching-types'
import type {
  AgentLoopEvent,
  AgentLoopStopReason,
  RunAgentLoopResult
} from './agent-loop'
import { ProviderHookLedger, type ProviderUsageSource } from './provider-hooks'
import { AgentRunResourceGovernor } from './agent-run-resource-governance'
import { estimateAgentRunUsage } from './agent-run-usage-estimator'

type TerminalResult = Omit<RunAgentLoopResult, 'usage' | 'iterations'>
type CompletedResult = Omit<TerminalResult, 'messages'>

type AgentLoopExecutionStateOptions = {
  now: () => number
  signal?: AbortSignal
  onEvent?: (event: AgentLoopEvent) => void
  resourceGovernance?: AgentRunResourceGovernance
  resourceGovernor?: AgentRunResourceGovernor
}

/**
 * Owns per-run accounting and terminal-result construction. Accounting remains
 * local observability rather than teaching authority; explicit host-owned resource
 * governance may use it to stop or suspend runtime work safely.
 */
function formatResourceBoundaryMessage(boundary: AgentRunResourceBoundarySnapshot): string {
  const layer = boundary.layer === 'user_budget'
    ? '用户预算'
    : boundary.layer === 'deployment_policy'
      ? '部署策略'
      : '紧急熔断器'
  const action = boundary.action === 'suspended' ? '运行已暂停' : '已达到资源边界'
  return `${action}：触发层=${layer}，计量=${boundary.meter}，已用=${boundary.used}/${boundary.limit}，scope=${boundary.scope}。不会自动重试或回放已完成工具；请显式开始新的续接。`
}

export class AgentLoopExecutionState {
  readonly signal: AbortSignal

  private readonly startedAt: number
  private readonly resourceGovernor: AgentRunResourceGovernor
  private readonly ownsResourceGovernor: boolean
  private readonly usage: AgentRunUsageAggregate = {
    providerCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    iterations: 0,
    childRuns: 0,
    durationMs: 0,
    operationAccounting: {
      logicalRequests: 0,
      providerTransportAttempts: 0,
      transportRetries: 0,
      overflowRecoveries: 0,
      compactionOperations: 0,
      compactionSummaryAttempts: 0,
      toolOperationAttempts: 0
    }
  }
  private readonly childRuns = new Set<string>()
  private readonly accountedChildRuns = new Set<string>()
  private readonly providerHooks = new ProviderHookLedger()
  private providerCallSeq = 0
  private currentProviderCallId?: string
  /** Provider calls with no usable report or bounded local estimate. */
  private hasUnknownProviderUsage = false
  /** Only provider-supplied totals are eligible for resource metering. */
  private providerReportedTotalTokens = 0
  private retryExhausted = false
  private iterations = 0

  constructor(private readonly options: AgentLoopExecutionStateOptions) {
    this.startedAt = options.now()
    this.ownsResourceGovernor = options.resourceGovernor === undefined
    this.resourceGovernor = options.resourceGovernor ?? new AgentRunResourceGovernor({
      governance: options.resourceGovernance,
      parentSignal: options.signal,
      now: options.now
    })
    const signals = [this.resourceGovernor.signal, options.signal]
      .filter((signal): signal is AbortSignal => signal !== undefined)
    this.signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
  }

  get isCanceled(): boolean {
    return this.signal.aborted && !this.resourceGovernor.isTerminated
  }

  get isResourceTerminated(): boolean {
    return this.resourceGovernor.isTerminated
  }

  get resourceBoundary(): AgentRunResourceBoundarySnapshot | undefined {
    return this.resourceGovernor.boundary
  }

  /** Internal child-run seam: descendants charge the same host governance ledger. */
  get resourceGovernorHandle(): AgentRunResourceGovernor {
    return this.resourceGovernor
  }

  setIterations(iterations: number): void {
    this.iterations = iterations
  }

  startLogicalRequest(): void {
    this.resourceGovernor.claim('logical_requests')
    this.usage.operationAccounting!.logicalRequests += 1
  }

  noteContextOverflowRecovery(): void {
    this.usage.operationAccounting!.overflowRecoveries += 1
  }

  startCompactionOperation(): void {
    this.usage.operationAccounting!.compactionOperations += 1
  }

  startCompactionSummaryAttempt(): void {
    this.usage.operationAccounting!.compactionSummaryAttempts += 1
  }

  startProviderCall(): void {
    this.resourceGovernor.claim('provider_transport_attempts')
    this.usage.providerCalls += 1
    this.usage.operationAccounting!.providerTransportAttempts += 1
    this.providerCallSeq += 1
    this.currentProviderCallId = `provider-${this.providerCallSeq}`
    this.providerHooks.record({ kind: 'request_started', callId: this.currentProviderCallId })
  }

  recordProviderUsage(
    providerUsage: ChatAdapterResult['usage'],
    source: ProviderUsageSource = 'provider_reported',
    finishReason?: ChatAdapterResult['finishReason']
  ): void {
    const resolved = this.resolveProviderUsage(providerUsage, source)
    const callId = this.currentProviderCallId
    if (callId) {
      if (resolved.usage) this.providerHooks.record({
        kind: 'usage',
        callId,
        usage: resolved.usage,
        source: resolved.source
      })
      if (finishReason) this.providerHooks.record({ kind: 'stop', callId, reason: finishReason })
    }
    if (!resolved.usage) {
      this.hasUnknownProviderUsage = true
      return
    }
    if (resolved.usage.promptTokens !== undefined) {
      this.usage.promptTokens = (this.usage.promptTokens ?? 0) + resolved.usage.promptTokens
    }
    if (resolved.usage.completionTokens !== undefined) {
      this.usage.completionTokens = (this.usage.completionTokens ?? 0) + resolved.usage.completionTokens
    }
    if (resolved.usage.totalTokens !== undefined) {
      this.usage.totalTokens = (this.usage.totalTokens ?? 0) + resolved.usage.totalTokens
    }
    // ADR-0010: a local arithmetic estimate is observability only. Resource
    // governance charges the provider's explicit measured total, never a
    // synthetic total or a label that could be presented as provider quota.
    if (source === 'provider_reported' && providerUsage?.totalTokens !== undefined) {
      this.providerReportedTotalTokens += providerUsage.totalTokens
      this.resourceGovernor.consume('total_tokens', this.providerReportedTotalTokens)
    }
  }

  /** Feed an already-normalized provider hook event into the ledger (SDK adapters). */
  recordProviderHookEvent(event: Parameters<ProviderHookLedger['record']>[0]): void {
    this.providerHooks.record(event)
  }

  /** Records a bounded transport-level retry against the current provider request. */
  noteProviderRetryExhausted(): void {
    this.retryExhausted = true
  }

  noteProviderRetry(attempt: number, reason?: string, delayMs?: number): void {
    this.usage.operationAccounting!.transportRetries += 1
    const callId = this.currentProviderCallId
    if (!callId) return
    this.providerHooks.record({ kind: 'retry', callId, attempt, reason, delayMs })
    if (reason === 'rate_limit') {
      this.providerHooks.record({ kind: 'rate_limit', callId, attempt, retryAfterMs: delayMs })
    }
  }

  ensureToolOperationCapacity(attempts: number): void {
    this.resourceGovernor.preflight('tool_operation_attempts', attempts)
  }

  startToolCall(): void {
    this.resourceGovernor.claim('tool_operation_attempts')
    this.usage.toolCalls += 1
    this.usage.operationAccounting!.toolOperationAttempts += 1
  }

  recordToolError(): void {
    this.usage.toolErrors += 1
  }

  emit(event: AgentLoopEvent): void {
    this.recordChildRun(event)
    this.options.onEvent?.(event)
  }

  canceled(transcript: ChatMessage[], toolsSupported: boolean, degradedReason?: string): RunAgentLoopResult {
    this.emit({ type: 'status', status: 'canceled' })
    return this.withUsage({
      messages: transcript,
      finalText: '',
      toolsSupported,
      degradedReason,
      stopReason: 'canceled'
    })
  }

  failed(
    transcript: ChatMessage[],
    toolsSupported: boolean,
    degradedReason: string | undefined,
    error: string,
    stopReason: Extract<AgentLoopStopReason, 'error' | 'no_progress' | 'context_unrecoverable' | 'retry_exhausted'> =
      this.retryExhausted ? 'retry_exhausted' : 'error'
  ): RunAgentLoopResult {
    this.emit({
      type: 'status',
      status: stopReason,
      message: error
    })
    return this.withUsage({
      messages: transcript,
      finalText: '',
      toolsSupported,
      degradedReason,
      stopReason,
      error
    })
  }

  resourceStopped(
    transcript: ChatMessage[],
    toolsSupported: boolean,
    degradedReason?: string
  ): RunAgentLoopResult {
    const boundary = this.resourceGovernor.boundary
    if (!boundary) return this.failed(transcript, toolsSupported, degradedReason, '资源治理状态不可用。')
    const status = boundary.action === 'suspended' ? 'suspended' : 'resource_limit'
    this.emit({
      type: 'status',
      status,
      message: formatResourceBoundaryMessage(boundary)
    })
    return this.withUsage({
      messages: transcript,
      finalText: '',
      toolsSupported,
      degradedReason,
      stopReason: status
    })
  }

  completed(transcript: ChatMessage[], terminal: CompletedResult): RunAgentLoopResult {
    // Account duration before publishing success so a final duration boundary cannot
    // leave a `done` event paired with a resource-terminal audit record.
    this.recordDuration()
    if (this.isResourceTerminated) return this.resourceStopped(transcript, terminal.toolsSupported, terminal.degradedReason)
    this.emit({ type: 'status', status: 'done' })
    return this.withUsage({
      ...terminal,
      messages: transcript
    })
  }

  private recordChildRun(event: AgentLoopEvent): void {
    if (!('child' in event) || !event.child?.id) return
    this.childRuns.add(event.child.id)
    if (
      event.type !== 'child_run_completed' &&
      event.type !== 'child_run_failed' &&
      event.type !== 'child_run_canceled'
    ) return
    if (this.accountedChildRuns.has(event.child.id)) return

    this.accountedChildRuns.add(event.child.id)
    const childUsage = event.child.usage
    this.usage.providerCalls += childUsage?.providerCalls ?? 0
    this.usage.toolCalls += childUsage?.toolCalls ?? 0
    if (!childUsage) return
    if (childUsage.promptTokens !== undefined) {
      this.usage.promptTokens = (this.usage.promptTokens ?? 0) + childUsage.promptTokens
    }
    if (childUsage.completionTokens !== undefined) {
      this.usage.completionTokens = (this.usage.completionTokens ?? 0) + childUsage.completionTokens
    }
    if (childUsage.totalTokens !== undefined) {
      this.usage.totalTokens = (this.usage.totalTokens ?? 0) + childUsage.totalTokens
    }
  }

  private withUsage(result: TerminalResult): RunAgentLoopResult {
    this.recordDuration()
    const usage: AgentRunUsageAggregate = {
      ...this.usage,
      iterations: this.iterations,
      childRuns: this.childRuns.size,
      durationMs: Math.max(0, Math.floor(this.options.now() - this.startedAt)),
      resourceGovernance: this.resourceGovernor.audit(),
      ...this.usageProvenanceField()
    }
    // A caller may deliberately share the host ledger across nested and direct
    // provider work. Only the execution state that constructed it may tear down
    // its duration timer / abort forwarding.
    if (this.ownsResourceGovernor) this.resourceGovernor.dispose()
    return {
      ...result,
      iterations: this.iterations,
      usage
    }
  }

  private resolveProviderUsage(
    providerUsage: ChatAdapterResult['usage'],
    source: ProviderUsageSource
  ): { usage?: NonNullable<ChatAdapterResult['usage']>; source: ProviderUsageSource } {
    if (!providerUsage) return { source }
    if (source === 'local_estimate') {
      const estimate = estimateAgentRunUsage(providerUsage)
      return estimate
        ? { usage: { ...providerUsage, totalTokens: estimate.totalTokens }, source: 'local_estimate' }
        : { source }
    }
    if (providerUsage.totalTokens !== undefined) return { usage: providerUsage, source }

    const estimate = estimateAgentRunUsage(providerUsage)
    return estimate
      ? { usage: { ...providerUsage, totalTokens: estimate.totalTokens }, source: 'local_estimate' }
      : { usage: providerUsage, source }
  }

  private recordDuration(): void {
    this.resourceGovernor.consume('duration_ms', Math.max(0, Math.floor(this.options.now() - this.startedAt)))
  }

  private usageProvenanceField(): { usageProvenance: AgentRunUsageProvenance } {
    const snapshot = this.providerHooks.snapshot()
    return {
      usageProvenance: this.hasUnknownProviderUsage || snapshot.hasUnknownUsage
        ? 'unknown'
        : snapshot.usageProvenance
    }
  }
}
