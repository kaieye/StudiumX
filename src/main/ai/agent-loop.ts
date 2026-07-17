import type {
  ChatMessage,
  ToolDefinition,
  ToolCall,
  ToolChoice,
  ChatAdapterResult
} from './provider-adapter'
import {
  callChatProvider,
  callProvider,
  streamChatProvider,
  streamProvider,
  toolsSupportedForFormat
} from './provider-adapter'
import {
  RequestContextProjector,
  type ContextCompactionOptions,
  type RequestContextProjectionTrace
} from './request-context-projection'
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
import { stripDsmlToolCallBlocks } from './provider-adapter/dsml-tool-calls'

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
  | RequestContextProjectionTrace
  | { type: 'token'; delta: string }
  | { type: 'reasoning'; delta: string }
  | ToolRuntimeEvent

export type RunAgentLoopOptions = {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  messages: ChatMessage[]
  /** Stable persisted turn IDs aligned with the initial conversation messages. */
  messageTurnIds?: readonly (string | undefined)[]
  tools: ToolDefinition[]
  toolHandlers: ToolHandlerMap
  maxIterations?: number
  jsonMode?: boolean
  maxIterationsBehavior?: 'force_final_answer' | 'error'
  shouldErrorOnMaxIterations?: () => boolean
  maxIterationsErrorMessage?: string
  /**
   * Tightly bounded recovery for a required business tool that has not
   * received an execution opportunity before the model returns a final answer
   * or the normal iteration cap is reached. Recovery calls remain subject to
   * the hard run budget.
   */
  iterationLimitRecovery?: {
    shouldAttempt: () => boolean
    instruction: string
    tools: ToolDefinition[]
    toolChoice: ToolChoice
    maxAttempts?: number
  }
  signal?: AbortSignal
  budget?: Partial<AgentRunBudget>
  /**
   * Deterministic last-resort answer for runs where a durable business action
   * already succeeded but no provider call remains to summarize it. Returning
   * text converts budget exhaustion into a degraded completion while retaining
   * the budget stop reason in usage.
   */
  budgetExhaustionFallback?: (reason: AgentRunBudgetStopReason, transcript: readonly ChatMessage[]) => string | null | undefined
  /**
   * Deterministic confirmation used when a durable operation succeeded but the
   * provider ignored no-tool finalization or returned an empty final answer.
   */
  durableSuccessFallback?: (transcript: readonly ChatMessage[]) => string | null | undefined
  /** Stop offering tools once a caller-observed durable operation has succeeded. */
  shouldFinalizeAfterToolExecution?: () => boolean
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
  const requestContext = new RequestContextProjector({
    modelId: opts.settings.generator.model,
    provider: opts.provider,
    compaction: opts.contextCompaction,
    onTrace: emit,
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
  const initialMessageCount = opts.messages.length
  const initialMessageTurnIds = opts.messageTurnIds?.slice(0, initialMessageCount)
  const prepareMessagesForProvider = async (messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatMessage[]> => {
    const messageTurnIds = messages.map((_, index) =>
      index < initialMessageCount ? initialMessageTurnIds?.[index] : undefined
    )
    return (await requestContext.project(messages, tools, messageTurnIds)).messages
  }
  let degradedReason: string | undefined
  let iterations = 0
  let exhausted: AgentRunBudgetStopReason | undefined
  let durableFinalizationRequested = false
  const canceledResult = (toolsSupported: boolean): RunAgentLoopResult => execution.canceled(transcript, toolsSupported, degradedReason)
  const exhaustedResult = (toolsSupported: boolean, reason: AgentRunBudgetStopReason): RunAgentLoopResult => {
    let fallbackText = ''
    try {
      fallbackText = opts.budgetExhaustionFallback?.(reason, transcript)?.trim() ?? ''
    } catch {
      // A fallback must never hide the original budget boundary.
    }
    if (!fallbackText) return execution.exhausted(transcript, toolsSupported, degradedReason, reason)

    const assistantMsg: ChatMessage = { role: 'assistant', content: fallbackText }
    transcript.push(assistantMsg)
    emit({ type: 'status', status: 'answering', message: '核心操作已完成，正在整理结果…' })
    emit({ type: 'token', delta: fallbackText })
    emit({ type: 'assistant_message', message: assistantMsg })
    return execution.completed(transcript, {
      finalText: fallbackText,
      toolsSupported,
      degradedReason: degradedReason ?? 'budget_exhausted_after_durable_success',
      stopReason: 'degraded'
    }, reason)
  }

  if (!supported) {
    if (execution.isCanceled) return canceledResult(false)
    iterations = 1
    execution.setIterations(iterations)
    emit({ type: 'status', status: 'answering', message: '当前端点格式不支持工具调用，已降级为纯文本生成。' })
    try {
      const stop = execution.budgetStop('provider')
      if (stop) return exhaustedResult(false, stop)
      execution.startProviderCall()
      let answerStarted = false
      const result = await streamProvider({
        settings: opts.settings,
        provider: opts.provider,
        request: legacyRequestFromMessages(await prepareMessagesForProvider(transcript, [])),
        callbacks: {
          onReasoning: (delta) => emit({ type: 'reasoning', delta }),
          onToken: (delta) => {
            if (!answerStarted) {
              answerStarted = true
              emit({ type: 'status', status: 'answering', message: '正在整理并生成回复…' })
            }
            emit({ type: 'token', delta })
          }
        },
        signal: runSignal
      })
      execution.recordProviderUsage(result.usage)
      execution.maybeWarnBudget()
      if (execution.isCanceled) return canceledResult(false)
      if (execution.isDurationExhausted) return exhaustedResult(false, 'duration')
      const cleanedText = stripDsmlToolCallBlocks(result.text)
      const assistantMsg: ChatMessage = { role: 'assistant', content: cleanedText }
      transcript.push(assistantMsg)
      emit({ type: 'assistant_message', message: assistantMsg })
      return execution.completed(transcript, {
        finalText: cleanedText,
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
    const bufferedAnswerDeltas: string[] = []
    try {
      const messages = await prepareMessagesForProvider(transcript, opts.tools)
      const afterCompactionStop = execution.budgetStop('provider')
      if (afterCompactionStop) {
        exhausted = afterCompactionStop
        break
      }
      execution.startProviderCall()
      result = await streamChatProvider({
        settings: opts.settings,
        provider: opts.provider,
        request: { messages, tools: opts.tools, toolChoice: 'auto', jsonMode: opts.jsonMode === true },
        callbacks: {
          onReasoning: (delta) => emit({ type: 'reasoning', delta }),
          // A provider may emit explanatory text before requesting a tool. Buffer the
          // iteration until we know it is the final answer so intermediate preambles do
          // not leak into (and get concatenated with) the user-facing response.
          onToken: (delta) => bufferedAnswerDeltas.push(delta)
        },
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

    const cleanedAssistantText = stripDsmlToolCallBlocks(result.text || '')
    const assistantMsg: ChatMessage = { role: 'assistant', content: cleanedAssistantText || null, tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })
    if (result.toolCalls.length === 0) {
      // Prefer the assembled/stripped answer text. Raw buffered deltas may still
      // contain DSML tool markup that only gets cleaned after the stream ends.
      const answerText = cleanedAssistantText || stripDsmlToolCallBlocks(bufferedAnswerDeltas.join(''))
      if (!answerText.trim()) {
        return execution.failed(transcript, true, degradedReason, '模型返回了空答复。')
      }
      // A model can prematurely produce prose even when the caller requires a
      // durable business action (for example generate_lesson). Keep that prose
      // internal and enter the same bounded recovery path used at the iteration
      // limit instead of presenting a successful answer followed by an error.
      if (opts.iterationLimitRecovery?.shouldAttempt() === true) break
      emit({ type: 'status', status: 'answering', message: '正在整理并生成回复…' })
      emit({ type: 'token', delta: answerText })
      return execution.completed(transcript, {
        finalText: answerText,
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
    if (opts.shouldFinalizeAfterToolExecution?.() === true) {
      durableFinalizationRequested = true
      break
    }
  }

  if (!exhausted && !durableFinalizationRequested && opts.iterationLimitRecovery?.shouldAttempt() === true) {
    const recovery = opts.iterationLimitRecovery
    const maxRecoveryAttempts = Number.isFinite(recovery.maxAttempts)
      ? Math.max(1, Math.floor(recovery.maxAttempts ?? 1))
      : 1
    const allowedRecoveryTools = new Set(recovery.tools.map((tool) => tool.function.name))

    for (let attempt = 1; attempt <= maxRecoveryAttempts && recovery.shouldAttempt(); attempt += 1) {
      if (execution.isCanceled) return canceledResult(true)
      const providerStop = execution.budgetStop('provider')
      if (providerStop) {
        exhausted = providerStop
        break
      }

      emit({
        type: 'status',
        status: 'thinking',
        message: `正在执行必要操作恢复（${attempt}/${maxRecoveryAttempts}）…`
      })

      let recoveryResult: ChatAdapterResult
      try {
        const recoveryMessages: ChatMessage[] = [
          ...transcript,
          { role: 'user', content: recovery.instruction }
        ]
        const messages = await prepareMessagesForProvider(recoveryMessages, recovery.tools)
        const afterCompactionStop = execution.budgetStop('provider')
        if (afterCompactionStop) {
          exhausted = afterCompactionStop
          break
        }
        execution.startProviderCall()
        recoveryResult = await streamChatProvider({
          settings: opts.settings,
          provider: opts.provider,
          request: {
            messages,
            tools: recovery.tools,
            toolChoice: recovery.toolChoice,
            jsonMode: opts.jsonMode === true
          },
          callbacks: {
            onReasoning: (delta) => emit({ type: 'reasoning', delta }),
            // Recovery prose is not user-facing; only the subsequent no-tool
            // finalization is streamed into the answer.
            onToken: () => undefined
          },
          signal: runSignal
        })
        execution.recordProviderUsage(recoveryResult.usage)
        execution.maybeWarnBudget()
        degradedReason ??= recoveryResult.degradedReason
      } catch (error) {
        if (execution.isCanceled) return canceledResult(true)
        if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
        const message = error instanceof Error ? error.message : String(error)
        return execution.failed(transcript, true, degradedReason, message)
      }

      if (recoveryResult.toolCalls.length === 0) continue
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: recoveryResult.text || null,
        tool_calls: recoveryResult.toolCalls
      }
      transcript.push(assistantMsg)
      emit({ type: 'assistant_message', message: assistantMsg })
      emit({ type: 'status', status: 'tool_running' })

      for (const call of recoveryResult.toolCalls) {
        if (execution.isCanceled) return canceledResult(true)
        const toolStop = execution.budgetStop('tool')
        if (toolStop) {
          exhausted = toolStop
          break
        }
        execution.startToolCall()
        emit({ type: 'tool_call', toolCall: call })
        const toolResult = allowedRecoveryTools.has(call.function.name) && recovery.shouldAttempt()
          ? await executeToolCall(opts.toolHandlers, call, {
              toolCallId: call.id,
              toolName: call.function.name,
              emit: (event) => emit(event),
              signal: runSignal
            })
          : {
              toolCallId: call.id,
              name: call.function.name,
              content: allowedRecoveryTools.has(call.function.name)
                ? `恢复阶段的必要操作已经尝试，不再重复执行 ${call.function.name}。`
                : `恢复阶段不允许调用工具 ${call.function.name}。`,
              isError: true
            }
        if (toolResult.isError) execution.recordToolError()
        if (execution.isCanceled) return canceledResult(true)
        if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
        transcript.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content })
        emit({
          type: 'tool_result',
          toolCallId: toolResult.toolCallId,
          name: toolResult.name,
          result: toolResult.content,
          isError: toolResult.isError
        })
      }
      emit({ type: 'status', status: 'tool_done' })
      if (exhausted) break
    }
  }

  if (!exhausted && !durableFinalizationRequested && (opts.maxIterationsBehavior === 'error' || opts.shouldErrorOnMaxIterations?.() === true)) {
    const message = opts.maxIterationsErrorMessage ?? '达到工具调用上限，任务尚未完成。请提高工具调用上限或简化请求后重试。'
    return execution.failed(transcript, true, degradedReason, message, 'max_iterations')
  }

  const finalStop = execution.budgetStop('provider') ?? (exhausted === 'tool_calls' ? undefined : exhausted)
  if (finalStop) return exhaustedResult(true, finalStop)
  emit({
    type: 'status',
    status: 'answering',
    message: exhausted
      ? '运行预算即将用完，生成最终答复。'
      : durableFinalizationRequested
        ? '核心操作已完成，正在生成最终答复。'
        : '达到工具调用上限，生成最终答复。'
  })
  try {
    const messages = await prepareMessagesForProvider(transcript, [])
    const afterCompactionStop = execution.budgetStop('provider')
    if (afterCompactionStop) return exhaustedResult(true, afterCompactionStop)
    execution.startProviderCall()
    let answerStarted = false
    const final = await streamChatProvider({
      settings: opts.settings,
      provider: opts.provider,
      request: { messages, tools: [], toolChoice: 'none', jsonMode: opts.jsonMode === true },
      callbacks: {
        onReasoning: (delta) => emit({ type: 'reasoning', delta }),
        onToken: (delta) => {
          if (!answerStarted) {
            answerStarted = true
            emit({ type: 'status', status: 'answering', message: '正在整理并生成回复…' })
          }
          emit({ type: 'token', delta })
        }
      },
      signal: runSignal
    })
    execution.recordProviderUsage(final.usage)
    if (execution.isCanceled) return canceledResult(true)
    if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
    degradedReason ??= final.degradedReason
    // Finalization already requested toolChoice:none with an empty tool list. Some
    // providers still emit native/DSML tool calls here; recover any prose first and
    // only fall back to a durable success summary when the model returns nothing usable.
    let finalText = stripDsmlToolCallBlocks(final.text || '')
    if (final.toolCalls.length > 0 && !finalText.trim()) {
      const durableFallback = durableFinalizationRequested
        ? safeFallbackText(opts.durableSuccessFallback, transcript)
        : ''
      if (durableFallback) {
        finalText = durableFallback
        degradedReason ??= 'final_answer_ignored_tool_calls'
      } else if (durableFinalizationRequested) {
        finalText = '核心操作已完成。最终答复阶段模型仍尝试继续调用工具，已停止并保留已完成结果。'
        degradedReason ??= 'final_answer_ignored_tool_calls'
      } else {
        return execution.failed(transcript, true, degradedReason, '达到限制后，模型仍请求继续调用工具，未返回最终答复。')
      }
    } else if (final.toolCalls.length > 0) {
      degradedReason ??= 'final_answer_ignored_tool_calls'
    }
    if (!finalText.trim()) {
      const exhaustedReason = exhausted
      const budgetFallback = exhaustedReason
        ? safeFallbackText((messages) => opts.budgetExhaustionFallback?.(exhaustedReason, messages), transcript)
        : ''
      const durableFallback = durableFinalizationRequested
        ? safeFallbackText(opts.durableSuccessFallback, transcript)
        : ''
      if (budgetFallback || durableFallback) {
        finalText = budgetFallback || durableFallback
        degradedReason ??= budgetFallback
          ? 'budget_exhausted_after_durable_success'
          : 'empty_final_answer_after_durable_success'
      } else if (durableFinalizationRequested) {
        finalText = '核心操作已完成。'
        degradedReason ??= 'empty_final_answer_after_durable_success'
      } else {
        return execution.failed(transcript, true, degradedReason, '达到限制后，模型返回了空答复。')
      }
    }
    const assistantMsg: ChatMessage = { role: 'assistant', content: finalText }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })
    return execution.completed(transcript, {
      finalText,
      toolsSupported: true,
      degradedReason,
      stopReason: exhausted ? 'budget_exhausted' : durableFinalizationRequested ? 'final_answer' : 'max_iterations'
    }, exhausted)
  } catch (error) {
    if (execution.isCanceled) return canceledResult(true)
    if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
    const message = error instanceof Error ? error.message : String(error)
    return execution.failed(transcript, true, degradedReason, message)
  }
}

function safeFallbackText(
  fallback: ((transcript: readonly ChatMessage[]) => string | null | undefined) | undefined,
  transcript: readonly ChatMessage[]
): string {
  if (!fallback) return ''
  try {
    return fallback(transcript)?.trim() ?? ''
  } catch {
    return ''
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

