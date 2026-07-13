import type {
  ChatMessage,
  ToolDefinition,
  ToolCall,
  ChatAdapterResult
} from './provider-adapter'
import {
  callChatProvider,
  callProvider,
  toolsSupportedForFormat
} from './provider-adapter'
import { ContextEstimator, type TokenEstimate } from './context-estimator'
import { applyRequestHistoryHygiene } from './request-history-hygiene'
import {
  ContextCompactor,
  inferContextWindowTokens,
  type ContextCompactionEvent,
  type ContextCompactionOptions
} from './context-compactor'
import type { ToolHandlerMap, ToolRuntimeEvent } from './tools/registry'
import { executeToolCall } from './tools/execution'
import type {
  AgentRunBudget,
  AgentRunBudgetStopReason,
  AgentRunUsageAggregate,
  TeachingSettingsV1,
  TeachingModelProviderProfile
} from '../../shared/teaching-types'
import type { AgentLoopStatus } from '../../shared/teaching-types'
import { normalizeAgentRunBudget } from './agent-run-store'

export type AgentLoopStopReason = 'final_answer' | 'max_iterations' | 'budget_exhausted' | 'error' | 'degraded' | 'canceled'

export type AgentLoopUsage = AgentRunUsageAggregate

export type AgentLoopDiagnostic = {
  kind: 'provider_call' | 'tool_call' | 'tool_result' | 'stop'
  message?: string
  data?: Record<string, string | number | boolean | null | undefined>
}

export type AgentLoopEvent =
  | { type: 'status'; status: AgentLoopStatus; message?: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; name: string; result: string; isError: boolean }
  | { type: 'context_estimated'; estimate: TokenEstimate }
  | { type: 'context_hygiene_applied'; changed: boolean; savedTokens: number; compactedToolResults: number; digestedToolResults: number; compactedToolCallArgs: number }
  | ContextCompactionEvent
  | { type: 'token'; delta: string }
  | ToolRuntimeEvent

export type RunAgentLoopOptions = {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  messages: ChatMessage[]
  tools: ToolDefinition[]
  toolHandlers: ToolHandlerMap
  maxIterations?: number
  jsonMode?: boolean
  maxIterationsBehavior?: 'force_final_answer' | 'error'
  shouldErrorOnMaxIterations?: () => boolean
  maxIterationsErrorMessage?: string
  signal?: AbortSignal
  budget?: Partial<AgentRunBudget>
  now?: () => number
  callbacks?: { onEvent?: (e: AgentLoopEvent) => void }
  contextCompaction?: ContextCompactionOptions
}

export type RunAgentLoopResult = {
  messages: ChatMessage[]
  finalText: string
  iterations: number
  toolsSupported: boolean
  degradedReason?: string
  stopReason: AgentLoopStopReason
  error?: string
  usage: AgentRunUsageAggregate
}

const DEFAULT_MAX_ITERATIONS = 8

/**
 * Non-streaming tool-calling loop (v1). Each turn calls callChatProvider; if
 * the response carries tool_calls, dispatches them (errors become tool results
 * so the model can self-correct) and loops; otherwise the text is the final
 * answer, emitted as a single token chunk. Unsupported endpoint formats
 * (messages/responses) degrade to one legacy single-shot call.
 */
export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<RunAgentLoopResult> {
  const budget = normalizeAgentRunBudget(opts.budget ?? opts.settings.tools.runBudget)
  const now = opts.now ?? Date.now
  const startedAt = now()
  const durationSignal = AbortSignal.timeout(budget.maxDurationMs)
  const runSignal = opts.signal ? AbortSignal.any([opts.signal, durationSignal]) : durationSignal
  const usage: AgentRunUsageAggregate = {
    providerCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    iterations: 0,
    childRuns: 0,
    durationMs: 0
  }
  let tokenUsageComplete = true
  const childRuns = new Set<string>()
  const accountedChildRuns = new Set<string>()
  const finishUsage = (budgetStopReason?: AgentRunBudgetStopReason): AgentRunUsageAggregate => {
    const finalUsage: AgentRunUsageAggregate = {
      ...usage,
      iterations,
      childRuns: childRuns.size,
      durationMs: Math.max(0, Math.floor(now() - startedAt)),
      ...(budgetStopReason ? { budgetStopReason } : {})
    }
    if (!tokenUsageComplete) {
      delete finalUsage.promptTokens
      delete finalUsage.completionTokens
      delete finalUsage.totalTokens
    }
    return finalUsage
  }
  const withUsage = (result: Omit<RunAgentLoopResult, 'usage'>, budgetStopReason?: AgentRunBudgetStopReason): RunAgentLoopResult => ({
    ...result,
    usage: finishUsage(budgetStopReason)
  })
  const recordProviderUsage = (providerUsage: ChatAdapterResult['usage']): void => {
    if (!providerUsage) {
      tokenUsageComplete = false
      return
    }
    if (providerUsage.promptTokens === undefined || providerUsage.completionTokens === undefined || providerUsage.totalTokens === undefined) {
      tokenUsageComplete = false
      return
    }
    usage.promptTokens = (usage.promptTokens ?? 0) + providerUsage.promptTokens
    usage.completionTokens = (usage.completionTokens ?? 0) + providerUsage.completionTokens
    usage.totalTokens = (usage.totalTokens ?? 0) + providerUsage.totalTokens
  }
  const budgetStop = (kind: 'provider' | 'tool'): AgentRunBudgetStopReason | undefined => {
    if (durationSignal.aborted || now() - startedAt >= budget.maxDurationMs) return 'duration'
    if (usage.totalTokens !== undefined && usage.totalTokens >= budget.maxTotalTokens) return 'total_tokens'
    if (kind === 'provider' && usage.providerCalls >= budget.maxProviderCalls) return 'provider_calls'
    if (kind === 'tool' && usage.toolCalls >= budget.maxToolCalls) return 'tool_calls'
    return undefined
  }
  const format = opts.settings.generator.endpointFormat
  const supported = toolsSupportedForFormat(format)
  const requestedMaxIter = opts.maxIterations ?? opts.settings.tools.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const maxIter = Number.isFinite(requestedMaxIter) ? Math.max(0, Math.floor(requestedMaxIter)) : DEFAULT_MAX_ITERATIONS
  const hasIterationLimit = maxIter > 0
  const transcript: ChatMessage[] = [...opts.messages]
  const emit = (e: AgentLoopEvent): void => {
    if ('child' in e && e.child?.id) childRuns.add(e.child.id)
    if (
      'child' in e &&
      (e.type === 'child_run_completed' || e.type === 'child_run_failed' || e.type === 'child_run_canceled') &&
      !accountedChildRuns.has(e.child.id)
    ) {
      accountedChildRuns.add(e.child.id)
      usage.providerCalls += e.child.usage?.providerCalls ?? 0
      usage.toolCalls += e.child.usage?.toolCalls ?? 0
      const childUsage = e.child.usage
      if (!childUsage || childUsage.promptTokens === undefined || childUsage.completionTokens === undefined || childUsage.totalTokens === undefined) {
        tokenUsageComplete = false
      } else {
        usage.promptTokens = (usage.promptTokens ?? 0) + childUsage.promptTokens
        usage.completionTokens = (usage.completionTokens ?? 0) + childUsage.completionTokens
        usage.totalTokens = (usage.totalTokens ?? 0) + childUsage.totalTokens
      }
    }
    opts.callbacks?.onEvent?.(e)
  }
  let budgetWarningEmitted = false
  const maybeWarnBudget = (): void => {
    if (budgetWarningEmitted) return
    const ratios = [
      (now() - startedAt) / budget.maxDurationMs,
      usage.providerCalls / budget.maxProviderCalls,
      usage.toolCalls / budget.maxToolCalls,
      usage.totalTokens === undefined ? 0 : usage.totalTokens / budget.maxTotalTokens
    ]
    if (Math.max(...ratios) < budget.warningThreshold) return
    budgetWarningEmitted = true
    emit({ type: 'status', status: 'thinking', message: '本轮运行已接近安全预算上限；后续调用将按预算边界停止。' })
  }
  const estimator = new ContextEstimator()
  const compactor = new ContextCompactor({
    estimator,
    enabled: opts.contextCompaction?.enabled ?? true,
    contextWindowTokens:
      opts.contextCompaction?.contextWindowTokens ?? inferContextWindowTokens(opts.settings.generator.model, opts.provider),
    softThresholdTokens: opts.contextCompaction?.softThresholdTokens,
    hardThresholdTokens: opts.contextCompaction?.hardThresholdTokens,
    softThresholdRatio: opts.contextCompaction?.softThresholdRatio,
    hardThresholdRatio: opts.contextCompaction?.hardThresholdRatio,
    normalTailRatio: opts.contextCompaction?.normalTailRatio,
    aggressiveTailRatio: opts.contextCompaction?.aggressiveTailRatio,
    minTailMessages: opts.contextCompaction?.minTailMessages,
    minMessagesToCompact: opts.contextCompaction?.minMessagesToCompact,
    summaryInputTokenLimit: opts.contextCompaction?.summaryInputTokenLimit,
    maxSummaryTokens: opts.contextCompaction?.maxSummaryTokens,
    failureCooldownMs: opts.contextCompaction?.failureCooldownMs,
    force: opts.contextCompaction?.force,
    now: opts.contextCompaction?.now,
    summarize: async (request) => {
      const summarySettings: TeachingSettingsV1 = {
        ...opts.settings,
        generator: {
          ...opts.settings.generator,
          maxOutputTokens: Math.min(opts.settings.generator.maxOutputTokens, request.maxSummaryTokens)
        }
      }
      if (!toolsSupportedForFormat(summarySettings.generator.endpointFormat)) {
        const stop = budgetStop('provider')
        if (stop) throw new Error(`agent budget exhausted: ${stop}`)
        usage.providerCalls += 1
        const summary = await callProvider({
          settings: summarySettings,
          provider: opts.provider,
          request: legacyRequestFromMessages(request.messages),
          signal: runSignal
        })
        recordProviderUsage(summary.usage)
        maybeWarnBudget()
        return summary.text
      }
      const stop = budgetStop('provider')
      if (stop) throw new Error(`agent budget exhausted: ${stop}`)
      usage.providerCalls += 1
      const summary = await callChatProvider({
        settings: summarySettings,
        provider: opts.provider,
        request: {
          messages: request.messages,
          tools: [],
          toolChoice: 'none',
          jsonMode: false
        },
        signal: runSignal
      })
      recordProviderUsage(summary.usage)
      maybeWarnBudget()
      return summary.text
    }
  })
  const prepareMessagesForProvider = async (messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatMessage[]> => {
    const hygiene = applyRequestHistoryHygiene(messages, {}, estimator)
    const estimate = estimator.estimateRequest(hygiene.messages, { tools })
    emit({
      type: 'context_hygiene_applied',
      changed: hygiene.changed,
      savedTokens: hygiene.savedTokens,
      compactedToolResults: hygiene.stats.compactedToolResults,
      digestedToolResults: hygiene.stats.digestedToolResults,
      compactedToolCallArgs: hygiene.stats.compactedToolCallArgs
    })
    const compaction = await compactor.compactIfNeeded({
      messages: hygiene.messages,
      tools,
      estimate
    })
    for (const event of compaction.events) emit(event)
    emit({ type: 'context_estimated', estimate: compaction.estimateAfter })
    return compaction.messages
  }
  let degradedReason: string | undefined
  let iterations = 0
  let exhausted: AgentRunBudgetStopReason | undefined
  const isCanceled = (): boolean => opts.signal?.aborted === true
  const canceledResult = (toolsSupported: boolean): RunAgentLoopResult => {
    emit({ type: 'status', status: 'canceled' })
    return withUsage({ messages: transcript, finalText: '', iterations, toolsSupported, degradedReason, stopReason: 'canceled' })
  }
  const exhaustedResult = (toolsSupported: boolean, reason: AgentRunBudgetStopReason): RunAgentLoopResult => {
    const message = budgetStopMessage(reason)
    emit({ type: 'status', status: 'error', message })
    return withUsage({
      messages: transcript,
      finalText: '',
      iterations,
      toolsSupported,
      degradedReason,
      stopReason: 'budget_exhausted',
      error: message
    }, reason)
  }

  if (!supported) {
    if (isCanceled()) return canceledResult(false)
    iterations = 1
    emit({ type: 'status', status: 'answering', message: '当前端点格式不支持工具调用，已降级为纯文本生成。' })
    try {
      const stop = budgetStop('provider')
      if (stop) return exhaustedResult(false, stop)
      usage.providerCalls += 1
      const result = await callProvider({
        settings: opts.settings,
        provider: opts.provider,
        request: legacyRequestFromMessages(await prepareMessagesForProvider(transcript, [])),
        signal: runSignal
      })
      recordProviderUsage(result.usage)
      maybeWarnBudget()
      if (isCanceled()) return canceledResult(false)
      if (durationSignal.aborted) return exhaustedResult(false, 'duration')
      const assistantMsg: ChatMessage = { role: 'assistant', content: result.text }
      transcript.push(assistantMsg)
      emit({ type: 'assistant_message', message: assistantMsg })
      emit({ type: 'token', delta: result.text })
      emit({ type: 'status', status: 'done' })
      return withUsage({ messages: transcript, finalText: result.text, iterations: 1, toolsSupported: false, degradedReason: 'unsupported_endpoint_format', stopReason: 'degraded' })
    } catch (e) {
      if (isCanceled()) return canceledResult(false)
      if (durationSignal.aborted) return exhaustedResult(false, 'duration')
      const message = e instanceof Error ? e.message : String(e)
      emit({ type: 'status', status: 'error', message })
      return withUsage({ messages: transcript, finalText: '', iterations: 1, toolsSupported: false, degradedReason: 'unsupported_endpoint_format', stopReason: 'error', error: message })
    }
  }

  for (let i = 0; !hasIterationLimit || i < maxIter; i++) {
    if (isCanceled()) return canceledResult(true)
    const providerStop = budgetStop('provider')
    if (providerStop) {
      exhausted = providerStop
      break
    }
    iterations = i + 1
    emit({ type: 'status', status: 'thinking' })
    let result: ChatAdapterResult
    try {
      const messages = await prepareMessagesForProvider(transcript, opts.tools)
      const afterCompactionStop = budgetStop('provider')
      if (afterCompactionStop) {
        exhausted = afterCompactionStop
        break
      }
      usage.providerCalls += 1
      result = await callChatProvider({
        settings: opts.settings,
        provider: opts.provider,
        request: { messages, tools: opts.tools, toolChoice: 'auto', jsonMode: opts.jsonMode === true },
        signal: runSignal
      })
      recordProviderUsage(result.usage)
      maybeWarnBudget()
    } catch (e) {
      if (isCanceled()) return canceledResult(true)
      if (durationSignal.aborted) return exhaustedResult(true, 'duration')
      const message = e instanceof Error ? e.message : String(e)
      emit({ type: 'status', status: 'error', message })
      return withUsage({ messages: transcript, finalText: '', iterations, toolsSupported: true, degradedReason, stopReason: 'error', error: message })
    }
    if (isCanceled()) return canceledResult(true)
    if (durationSignal.aborted) return exhaustedResult(true, 'duration')
    degradedReason ??= result.degradedReason

    const assistantMsg: ChatMessage = { role: 'assistant', content: result.text || null, tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })
    if (result.toolCalls.length === 0) {
      if (!result.text.trim()) {
        const message = '模型返回了空答复。'
        emit({ type: 'status', status: 'error', message })
        return withUsage({ messages: transcript, finalText: '', iterations, toolsSupported: true, degradedReason, stopReason: 'error', error: message })
      }
      if (result.text) emit({ type: 'token', delta: result.text })
      emit({ type: 'status', status: 'done' })
      return withUsage({ messages: transcript, finalText: result.text, iterations, toolsSupported: true, degradedReason, stopReason: 'final_answer' })
    }

    emit({ type: 'status', status: 'tool_running' })
    for (const call of result.toolCalls) {
      if (isCanceled()) return canceledResult(true)
      const toolStop = budgetStop('tool')
      if (toolStop) {
        exhausted = toolStop
        break
      }
      usage.toolCalls += 1
      maybeWarnBudget()
      emit({ type: 'tool_call', toolCall: call })
      const toolResult = await executeToolCall(opts.toolHandlers, call, {
        toolCallId: call.id,
        toolName: call.function.name,
        emit: (event) => emit(event),
        signal: runSignal
      })
      if (toolResult.isError) usage.toolErrors += 1
      if (isCanceled()) return canceledResult(true)
      if (durationSignal.aborted) return exhaustedResult(true, 'duration')
      transcript.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content })
      emit({ type: 'tool_result', toolCallId: toolResult.toolCallId, name: toolResult.name, result: toolResult.content, isError: toolResult.isError })
    }
    emit({ type: 'status', status: 'tool_done' })
    if (exhausted) break
  }

  if (!exhausted && (opts.maxIterationsBehavior === 'error' || opts.shouldErrorOnMaxIterations?.() === true)) {
    const message = opts.maxIterationsErrorMessage ?? '达到工具调用上限，任务尚未完成。请提高工具调用上限或简化请求后重试。'
    emit({ type: 'status', status: 'error', message })
    return withUsage({ messages: transcript, finalText: '', iterations, toolsSupported: true, degradedReason, stopReason: 'max_iterations', error: message })
  }

  const finalStop = budgetStop('provider') ?? (exhausted === 'tool_calls' ? undefined : exhausted)
  if (finalStop) return exhaustedResult(true, finalStop)
  emit({ type: 'status', status: 'answering', message: exhausted ? '运行预算即将用完，生成最终答复。' : '达到工具调用上限，生成最终答复。' })
  try {
    const messages = await prepareMessagesForProvider(transcript, [])
    const afterCompactionStop = budgetStop('provider')
    if (afterCompactionStop) return exhaustedResult(true, afterCompactionStop)
    usage.providerCalls += 1
    const final = await callChatProvider({
      settings: opts.settings,
      provider: opts.provider,
      request: { messages, tools: [], toolChoice: 'none', jsonMode: opts.jsonMode === true },
      signal: runSignal
    })
    recordProviderUsage(final.usage)
    if (isCanceled()) return canceledResult(true)
    if (durationSignal.aborted) return exhaustedResult(true, 'duration')
    degradedReason ??= final.degradedReason
    if (final.toolCalls.length > 0) {
      const message = '达到限制后，模型仍请求继续调用工具，未返回最终答复。'
      emit({ type: 'status', status: 'error', message })
      return withUsage({ messages: transcript, finalText: '', iterations, toolsSupported: true, degradedReason, stopReason: 'error', error: message })
    }
    const assistantMsg: ChatMessage = { role: 'assistant', content: final.text || null }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })
    if (!final.text.trim()) {
      const message = '达到限制后，模型返回了空答复。'
      emit({ type: 'status', status: 'error', message })
      return withUsage({ messages: transcript, finalText: '', iterations, toolsSupported: true, degradedReason, stopReason: 'error', error: message })
    }
    if (final.text) emit({ type: 'token', delta: final.text })
    emit({ type: 'status', status: 'done' })
    return withUsage({ messages: transcript, finalText: final.text, iterations, toolsSupported: true, degradedReason, stopReason: exhausted ? 'budget_exhausted' : 'max_iterations' }, exhausted)
  } catch (e) {
    if (isCanceled()) return canceledResult(true)
    if (durationSignal.aborted) return exhaustedResult(true, 'duration')
    const message = e instanceof Error ? e.message : String(e)
    emit({ type: 'status', status: 'error', message })
    return withUsage({ messages: transcript, finalText: '', iterations, toolsSupported: true, degradedReason, stopReason: 'error', error: message })
  }
}

function budgetStopMessage(reason: AgentRunBudgetStopReason): string {
  if (reason === 'duration') return '本轮运行已达到时长预算，未继续启动新的模型或工具调用。'
  if (reason === 'provider_calls') return '本轮运行已达到模型调用预算，未继续调用模型。'
  if (reason === 'tool_calls') return '本轮运行已达到工具调用预算，未继续执行工具。'
  return '本轮运行已达到 provider 报告的 token 预算，未继续调用模型或工具。'
}

function legacyRequestFromMessages(messages: ChatMessage[]): {
  systemPrompt: string
  userPrompt: string
  jsonMode: boolean
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .filter(Boolean)
    .join('\n\n')
  // Fold prior turns into the user prompt so the degraded path retains context.
  const turns = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const role = m.role === 'user' ? '用户' : '助手'
      return `${role}：${m.content ?? ''}`
    })
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const userPrompt = turns.length > 1 ? `${turns.slice(0, -1).join('\n\n')}\n\n最新用户消息：${lastUser}` : lastUser
  return { systemPrompt: system, userPrompt, jsonMode: false }
}
