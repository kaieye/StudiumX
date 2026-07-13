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
import { AgentLoopExecutionState } from './agent-loop-execution-state'

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
  const execution = new AgentLoopExecutionState({
    budget,
    now: opts.now ?? Date.now,
    signal: opts.signal,
    onEvent: opts.callbacks?.onEvent
  })
  const runSignal = execution.signal
  const format = opts.settings.generator.endpointFormat
  const supported = toolsSupportedForFormat(format)
  const requestedMaxIter = opts.maxIterations ?? opts.settings.tools.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const maxIter = Number.isFinite(requestedMaxIter) ? Math.max(0, Math.floor(requestedMaxIter)) : DEFAULT_MAX_ITERATIONS
  const hasIterationLimit = maxIter > 0
  const transcript: ChatMessage[] = [...opts.messages]
  const emit = (event: AgentLoopEvent): void => execution.emit(event)
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
        const stop = execution.budgetStop('provider')
        if (stop) throw new Error(`agent budget exhausted: ${stop}`)
        execution.startProviderCall()
        const summary = await callProvider({
          settings: summarySettings,
          provider: opts.provider,
          request: legacyRequestFromMessages(request.messages),
          signal: runSignal
        })
        execution.recordProviderUsage(summary.usage)
        execution.maybeWarnBudget()
        return summary.text
      }
      const stop = execution.budgetStop('provider')
      if (stop) throw new Error(`agent budget exhausted: ${stop}`)
      execution.startProviderCall()
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
      execution.recordProviderUsage(summary.usage)
      execution.maybeWarnBudget()
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
  const canceledResult = (toolsSupported: boolean): RunAgentLoopResult => execution.canceled(transcript, toolsSupported, degradedReason)
  const exhaustedResult = (toolsSupported: boolean, reason: AgentRunBudgetStopReason): RunAgentLoopResult =>
    execution.exhausted(transcript, toolsSupported, degradedReason, reason)

  if (!supported) {
    if (execution.isCanceled) return canceledResult(false)
    iterations = 1
    execution.setIterations(iterations)
    emit({ type: 'status', status: 'answering', message: '当前端点格式不支持工具调用，已降级为纯文本生成。' })
    try {
      const stop = execution.budgetStop('provider')
      if (stop) return exhaustedResult(false, stop)
      execution.startProviderCall()
      const result = await callProvider({
        settings: opts.settings,
        provider: opts.provider,
        request: legacyRequestFromMessages(await prepareMessagesForProvider(transcript, [])),
        signal: runSignal
      })
      execution.recordProviderUsage(result.usage)
      execution.maybeWarnBudget()
      if (execution.isCanceled) return canceledResult(false)
      if (execution.isDurationExhausted) return exhaustedResult(false, 'duration')
      const assistantMsg: ChatMessage = { role: 'assistant', content: result.text }
      transcript.push(assistantMsg)
      emit({ type: 'assistant_message', message: assistantMsg })
      emit({ type: 'token', delta: result.text })
      return execution.completed(transcript, {
        finalText: result.text,
        toolsSupported: false,
        degradedReason: 'unsupported_endpoint_format',
        stopReason: 'degraded'
      })
    } catch (error) {
      if (execution.isCanceled) return canceledResult(false)
      if (execution.isDurationExhausted) return exhaustedResult(false, 'duration')
      const message = error instanceof Error ? error.message : String(error)
      return execution.failed(transcript, false, 'unsupported_endpoint_format', message)
    }
  }

  for (let index = 0; !hasIterationLimit || index < maxIter; index++) {
    if (execution.isCanceled) return canceledResult(true)
    const providerStop = execution.budgetStop('provider')
    if (providerStop) {
      exhausted = providerStop
      break
    }
    iterations = index + 1
    execution.setIterations(iterations)
    emit({ type: 'status', status: 'thinking' })
    let result: ChatAdapterResult
    try {
      const messages = await prepareMessagesForProvider(transcript, opts.tools)
      const afterCompactionStop = execution.budgetStop('provider')
      if (afterCompactionStop) {
        exhausted = afterCompactionStop
        break
      }
      execution.startProviderCall()
      result = await callChatProvider({
        settings: opts.settings,
        provider: opts.provider,
        request: { messages, tools: opts.tools, toolChoice: 'auto', jsonMode: opts.jsonMode === true },
        signal: runSignal
      })
      execution.recordProviderUsage(result.usage)
      execution.maybeWarnBudget()
    } catch (error) {
      if (execution.isCanceled) return canceledResult(true)
      if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
      const message = error instanceof Error ? error.message : String(error)
      return execution.failed(transcript, true, degradedReason, message)
    }
    if (execution.isCanceled) return canceledResult(true)
    if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
    degradedReason ??= result.degradedReason

    const assistantMsg: ChatMessage = { role: 'assistant', content: result.text || null, tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })
    if (result.toolCalls.length === 0) {
      if (!result.text.trim()) {
        return execution.failed(transcript, true, degradedReason, '模型返回了空答复。')
      }
      if (result.text) emit({ type: 'token', delta: result.text })
      return execution.completed(transcript, {
        finalText: result.text,
        toolsSupported: true,
        degradedReason,
        stopReason: 'final_answer'
      })
    }

    emit({ type: 'status', status: 'tool_running' })
    for (const call of result.toolCalls) {
      if (execution.isCanceled) return canceledResult(true)
      const toolStop = execution.budgetStop('tool')
      if (toolStop) {
        exhausted = toolStop
        break
      }
      execution.startToolCall()
      emit({ type: 'tool_call', toolCall: call })
      const toolResult = await executeToolCall(opts.toolHandlers, call, {
        toolCallId: call.id,
        toolName: call.function.name,
        emit: (event) => emit(event),
        signal: runSignal
      })
      if (toolResult.isError) execution.recordToolError()
      if (execution.isCanceled) return canceledResult(true)
      if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
      transcript.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content })
      emit({ type: 'tool_result', toolCallId: toolResult.toolCallId, name: toolResult.name, result: toolResult.content, isError: toolResult.isError })
    }
    emit({ type: 'status', status: 'tool_done' })
    if (exhausted) break
  }

  if (!exhausted && (opts.maxIterationsBehavior === 'error' || opts.shouldErrorOnMaxIterations?.() === true)) {
    const message = opts.maxIterationsErrorMessage ?? '达到工具调用上限，任务尚未完成。请提高工具调用上限或简化请求后重试。'
    return execution.failed(transcript, true, degradedReason, message, 'max_iterations')
  }

  const finalStop = execution.budgetStop('provider') ?? (exhausted === 'tool_calls' ? undefined : exhausted)
  if (finalStop) return exhaustedResult(true, finalStop)
  emit({ type: 'status', status: 'answering', message: exhausted ? '运行预算即将用完，生成最终答复。' : '达到工具调用上限，生成最终答复。' })
  try {
    const messages = await prepareMessagesForProvider(transcript, [])
    const afterCompactionStop = execution.budgetStop('provider')
    if (afterCompactionStop) return exhaustedResult(true, afterCompactionStop)
    execution.startProviderCall()
    const final = await callChatProvider({
      settings: opts.settings,
      provider: opts.provider,
      request: { messages, tools: [], toolChoice: 'none', jsonMode: opts.jsonMode === true },
      signal: runSignal
    })
    execution.recordProviderUsage(final.usage)
    if (execution.isCanceled) return canceledResult(true)
    if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
    degradedReason ??= final.degradedReason
    if (final.toolCalls.length > 0) {
      return execution.failed(transcript, true, degradedReason, '达到限制后，模型仍请求继续调用工具，未返回最终答复。')
    }
    const assistantMsg: ChatMessage = { role: 'assistant', content: final.text || null }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })
    if (!final.text.trim()) {
      return execution.failed(transcript, true, degradedReason, '达到限制后，模型返回了空答复。')
    }
    if (final.text) emit({ type: 'token', delta: final.text })
    return execution.completed(transcript, {
      finalText: final.text,
      toolsSupported: true,
      degradedReason,
      stopReason: exhausted ? 'budget_exhausted' : 'max_iterations'
    }, exhausted)
  } catch (error) {
    if (execution.isCanceled) return canceledResult(true)
    if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
    const message = error instanceof Error ? error.message : String(error)
    return execution.failed(transcript, true, degradedReason, message)
  }
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
