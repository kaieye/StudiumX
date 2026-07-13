import type { ChatAdapterResult, ChatMessage } from './provider-adapter'
import type {
  AgentRunBudget,
  AgentRunBudgetStopReason,
  AgentRunUsageAggregate
} from '../../shared/teaching-types'
import type {
  AgentLoopEvent,
  AgentLoopStopReason,
  RunAgentLoopResult
} from './agent-loop'

export type AgentLoopCallKind = 'provider' | 'tool'

type TerminalResult = Omit<RunAgentLoopResult, 'usage' | 'iterations'>
type CompletedResult = Omit<TerminalResult, 'messages'>

type AgentLoopExecutionStateOptions = {
  budget: AgentRunBudget
  now: () => number
  signal?: AbortSignal
  onEvent?: (event: AgentLoopEvent) => void
}

/**
 * Owns the accounting and terminal-state policy for one Agent conversation
 * model loop. Provider requests, tool execution, and transcript evolution
 * remain outside this module; callers only record lifecycle facts and ask it
 * to construct a terminal outcome.
 */
export class AgentLoopExecutionState {
  readonly signal: AbortSignal

  private readonly startedAt: number
  private readonly durationSignal: AbortSignal
  private readonly usage: AgentRunUsageAggregate = {
    providerCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    iterations: 0,
    childRuns: 0,
    durationMs: 0
  }
  private readonly childRuns = new Set<string>()
  private readonly accountedChildRuns = new Set<string>()
  private tokenUsageComplete = true
  private iterations = 0
  private budgetWarningEmitted = false

  constructor(private readonly options: AgentLoopExecutionStateOptions) {
    this.startedAt = options.now()
    this.durationSignal = AbortSignal.timeout(options.budget.maxDurationMs)
    this.signal = options.signal
      ? AbortSignal.any([options.signal, this.durationSignal])
      : this.durationSignal
  }

  get isCanceled(): boolean {
    return this.options.signal?.aborted === true
  }

  get isDurationExhausted(): boolean {
    return this.durationSignal.aborted
  }

  setIterations(iterations: number): void {
    this.iterations = iterations
  }

  budgetStop(kind: AgentLoopCallKind): AgentRunBudgetStopReason | undefined {
    if (this.isDurationExhausted || this.options.now() - this.startedAt >= this.options.budget.maxDurationMs) return 'duration'
    if (this.usage.totalTokens !== undefined && this.usage.totalTokens >= this.options.budget.maxTotalTokens) return 'total_tokens'
    if (kind === 'provider' && this.usage.providerCalls >= this.options.budget.maxProviderCalls) return 'provider_calls'
    if (kind === 'tool' && this.usage.toolCalls >= this.options.budget.maxToolCalls) return 'tool_calls'
    return undefined
  }

  startProviderCall(): void {
    this.usage.providerCalls += 1
  }

  recordProviderUsage(providerUsage: ChatAdapterResult['usage']): void {
    if (!providerUsage || providerUsage.promptTokens === undefined || providerUsage.completionTokens === undefined || providerUsage.totalTokens === undefined) {
      this.tokenUsageComplete = false
      return
    }
    this.usage.promptTokens = (this.usage.promptTokens ?? 0) + providerUsage.promptTokens
    this.usage.completionTokens = (this.usage.completionTokens ?? 0) + providerUsage.completionTokens
    this.usage.totalTokens = (this.usage.totalTokens ?? 0) + providerUsage.totalTokens
  }

  startToolCall(): void {
    this.usage.toolCalls += 1
    this.maybeWarnBudget()
  }

  recordToolError(): void {
    this.usage.toolErrors += 1
  }

  emit(event: AgentLoopEvent): void {
    this.recordChildRun(event)
    this.options.onEvent?.(event)
  }

  maybeWarnBudget(): void {
    if (this.budgetWarningEmitted) return
    const ratios = [
      (this.options.now() - this.startedAt) / this.options.budget.maxDurationMs,
      this.usage.providerCalls / this.options.budget.maxProviderCalls,
      this.usage.toolCalls / this.options.budget.maxToolCalls,
      this.usage.totalTokens === undefined ? 0 : this.usage.totalTokens / this.options.budget.maxTotalTokens
    ]
    if (Math.max(...ratios) < this.options.budget.warningThreshold) return
    this.budgetWarningEmitted = true
    this.emit({ type: 'status', status: 'thinking', message: '本轮运行已接近安全预算上限；后续调用将按预算边界停止。' })
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

  exhausted(transcript: ChatMessage[], toolsSupported: boolean, degradedReason: string | undefined, reason: AgentRunBudgetStopReason): RunAgentLoopResult {
    const message = budgetStopMessage(reason)
    this.emit({ type: 'status', status: 'error', message })
    return this.withUsage({
      messages: transcript,
      finalText: '',
      toolsSupported,
      degradedReason,
      stopReason: 'budget_exhausted',
      error: message
    }, reason)
  }

  failed(transcript: ChatMessage[], toolsSupported: boolean, degradedReason: string | undefined, error: string, stopReason: Extract<AgentLoopStopReason, 'error' | 'max_iterations'> = 'error'): RunAgentLoopResult {
    this.emit({ type: 'status', status: 'error', message: error })
    return this.withUsage({
      messages: transcript,
      finalText: '',
      toolsSupported,
      degradedReason,
      stopReason,
      error
    })
  }

  completed(transcript: ChatMessage[], terminal: CompletedResult, budgetStopReason?: AgentRunBudgetStopReason): RunAgentLoopResult {
    this.emit({ type: 'status', status: 'done' })
    return this.withUsage({
      ...terminal,
      messages: transcript
    }, budgetStopReason)
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
    if (!childUsage || childUsage.promptTokens === undefined || childUsage.completionTokens === undefined || childUsage.totalTokens === undefined) {
      this.tokenUsageComplete = false
      return
    }
    this.usage.promptTokens = (this.usage.promptTokens ?? 0) + childUsage.promptTokens
    this.usage.completionTokens = (this.usage.completionTokens ?? 0) + childUsage.completionTokens
    this.usage.totalTokens = (this.usage.totalTokens ?? 0) + childUsage.totalTokens
  }

  private withUsage(result: TerminalResult, budgetStopReason?: AgentRunBudgetStopReason): RunAgentLoopResult {
    const usage: AgentRunUsageAggregate = {
      ...this.usage,
      iterations: this.iterations,
      childRuns: this.childRuns.size,
      durationMs: Math.max(0, Math.floor(this.options.now() - this.startedAt)),
      ...(budgetStopReason ? { budgetStopReason } : {})
    }
    if (!this.tokenUsageComplete) {
      delete usage.promptTokens
      delete usage.completionTokens
      delete usage.totalTokens
    }
    return {
      ...result,
      iterations: this.iterations,
      usage
    }
  }
}

function budgetStopMessage(reason: AgentRunBudgetStopReason): string {
  if (reason === 'duration') return '本轮运行已达到时长预算，未继续启动新的模型或工具调用。'
  if (reason === 'provider_calls') return '本轮运行已达到模型调用预算，未继续调用模型。'
  if (reason === 'tool_calls') return '本轮运行已达到工具调用预算，未继续执行工具。'
  return '本轮运行已达到 provider 报告的 token 预算，未继续调用模型或工具。'
}
