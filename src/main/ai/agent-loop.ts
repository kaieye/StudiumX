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
import type { ToolExecutionResult } from './tools/execution'
import { executeToolBatch } from './tools/batch-dispatch'
import {
  enforceToolResultTurnBudget,
  type ToolResultTurnBudgetConfig
} from './tools/tool-result-budget'
import {
  DEFAULT_PROVIDER_RETRY_MAX_ATTEMPTS,
  extractRetryAfterMsFromError,
  withProviderRetry
} from '../../shared/provider-retry'
import { createToolsSchemaGuardState } from './tools/tools-schema-fingerprint'
import { applyToolsSchemaGuard } from './agent-loop-schema-guard'
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
import { legacyRequestFromMessages, safeFallbackText } from './agent-loop-fallback'
import { budgetStopReasonFromError } from './agent-loop-budget-reason'
import { closeOpenToolCalls } from './close-open-tool-calls'
import { TOOL_CANCELED_MESSAGE } from './tools/tool-arguments'
import { stripDsmlToolCallBlocks } from './provider-adapter/dsml-tool-calls'
import {
  emptyContextFileLedger,
  recordFileTouchesFromToolBatch,
  type ContextFileLedger
} from './context-file-ledger'

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
  /**
   * Workspace root used for turn-level tool-result spill paths
   * (`.studiumx/tool-results/<runId>/`). Optional; when missing, over-budget
   * results fall back to inline preview without writing files.
   */
  workspaceRoot?: string
  /**
   * Agent run id for spill sandbox directory. Prefer the durable run/stream id.
   * When missing, spill falls back to inline truncation.
   */
  runId?: string
  /** Optional overrides for turn-aggregate tool result budget (B-04 / ADR-0056). */
  toolResultTurnBudget?: Partial<ToolResultTurnBudgetConfig>
  /** Applied only to the first normal model request; subsequent turns return to automatic tool selection. */
  initialToolChoice?: ToolChoice
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
  /**
   * Host-owned last-mile normalization for a no-tool final answer. The callback
   * runs before the answer is streamed or retained in the transcript.
   */
  normalizeFinalAnswer?: (answerText: string) => { finalText: string; degradedReason?: string } | null | undefined
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
  /** Live deterministic file-touch ledger (projection floor; not settlement). */
  let fileTouchLedger: ContextFileLedger = emptyContextFileLedger()
  const requestContext = new RequestContextProjector({
    modelId: opts.settings.generator.model,
    provider: opts.provider,
    compaction: opts.contextCompaction,
    onTrace: emit,
    fileTouchLedger: () => fileTouchLedger,
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
      execution.recordProviderUsage(summary.usage, 'provider_reported', summary.finishReason)
      execution.maybeWarnBudget()
      return summary.text
    }
  })
  const initialMessageCount = opts.messages.length
  const initialMessageTurnIds = opts.messageTurnIds?.slice(0, initialMessageCount)
  const prepareMessagesForProvider = async (
    messages: ChatMessage[],
    tools: ToolDefinition[],
    projection?: {
      compactionTriggerPoint?: 'pre_send' | 'mid_stream' | 'post_tool'
      hardBudgetExhausted?: boolean
      runBudgetStopPending?: boolean
    }
  ): Promise<ChatMessage[]> => {
    const messageTurnIds = messages.map((_, index) =>
      index < initialMessageCount ? initialMessageTurnIds?.[index] : undefined
    )
    // Hard budget remains sole authority when already exhausted; skip compaction work.
    const hardBudgetExhausted = projection?.hardBudgetExhausted === true || Boolean(execution.budgetStop('provider'))
    return (
      await requestContext.project(messages, tools, messageTurnIds, {
        compactionTriggerPoint: projection?.compactionTriggerPoint ?? 'pre_send',
        hardBudgetExhausted,
        runBudgetStopPending: projection?.runBudgetStopPending
      })
    ).messages
  }
  const toolsSchemaGuard = createToolsSchemaGuardState()
  let degradedReason: string | undefined
  let iterations = 0
  let exhausted: AgentRunBudgetStopReason | undefined
  let durableFinalizationRequested = false
  const canceledResult = (toolsSupported: boolean): RunAgentLoopResult => {
    // B-12: close unpaired tool_calls so canceled transcripts stay pair-closed.
    const closed = closeOpenToolCalls(transcript)
    if (closed.closed.length > 0) {
      transcript.splice(0, transcript.length, ...closed.messages)
      const canceledContent = JSON.stringify({
        error: 'tool_canceled',
        message: TOOL_CANCELED_MESSAGE
      })
      for (const item of closed.closed) {
        emit({
          type: 'tool_result',
          toolCallId: item.toolCallId,
          name: item.name,
          result: canceledContent,
          isError: true
        })
      }
    }
    return execution.canceled(transcript, toolsSupported, degradedReason)
  }
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
      const preStop = execution.budgetStop('provider')
      if (preStop) return exhaustedResult(false, preStop)
      let answerStarted = false
      const request = legacyRequestFromMessages(
        await prepareMessagesForProvider(transcript, [], { compactionTriggerPoint: 'pre_send' })
      )
      const result = await invokeProviderWithRetry({
        execution,
        emit,
        signal: runSignal,
        invoke: async () =>
          streamProvider({
            settings: opts.settings,
            provider: opts.provider,
            request,
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
      const budgetReason = budgetStopReasonFromError(error)
      if (budgetReason) return exhaustedResult(false, budgetReason)
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
      const messages = await prepareMessagesForProvider(transcript, opts.tools, {
        compactionTriggerPoint: index === 0 ? 'pre_send' : 'post_tool'
      })
      const afterCompactionStop = execution.budgetStop('provider')
      if (afterCompactionStop) {
        exhausted = afterCompactionStop
        break
      }
      const schemaDecision = applyToolsSchemaGuard(toolsSchemaGuard, opts.tools, emit)
      if (!schemaDecision.ok) {
        return execution.failed(
          transcript,
          true,
          degradedReason,
          schemaDecision.reason
        )
      }
      result = await invokeProviderWithRetry({
        execution,
        emit,
        signal: runSignal,
        invoke: async () =>
          streamChatProvider({
            settings: opts.settings,
            provider: opts.provider,
            request: {
              messages,
              tools: opts.tools,
              toolChoice: index === 0 ? (opts.initialToolChoice ?? 'auto') : 'auto',
              jsonMode: opts.jsonMode === true
            },
            callbacks: {
              onReasoning: (delta) => emit({ type: 'reasoning', delta }),
              // A provider may emit explanatory text before requesting a tool. Buffer the
              // iteration until we know it is the final answer so intermediate preambles do
              // not leak into (and get concatenated with) the user-facing response.
              onToken: (delta) => bufferedAnswerDeltas.push(delta)
            },
            signal: runSignal
          })
      })
      execution.recordProviderUsage(result.usage, 'provider_reported', result.finishReason)
      execution.maybeWarnBudget()
    } catch (error) {
      if (execution.isCanceled) return canceledResult(true)
      if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
      const budgetReason = budgetStopReasonFromError(error)
      if (budgetReason) return exhaustedResult(true, budgetReason)
      const message = error instanceof Error ? error.message : String(error)
      return execution.failed(transcript, true, degradedReason, message)
    }
    if (execution.isCanceled) return canceledResult(true)
    if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
    degradedReason ??= result.degradedReason

    const cleanedAssistantText = stripDsmlToolCallBlocks(result.text || '')
    if (result.toolCalls.length === 0) {
      // Prefer the assembled/stripped answer text. Raw buffered deltas may still
      // contain DSML tool markup that only gets cleaned after the stream ends.
      let answerText = cleanedAssistantText || stripDsmlToolCallBlocks(bufferedAnswerDeltas.join(''))
      if (!answerText.trim()) {
        return execution.failed(transcript, true, degradedReason, '模型返回了空答复。')
      }
      const normalized = opts.normalizeFinalAnswer?.(answerText)
      if (normalized?.finalText.trim()) {
        answerText = normalized.finalText
        degradedReason ??= normalized.degradedReason
      }
      const assistantMsg: ChatMessage = { role: 'assistant', content: answerText }
      transcript.push(assistantMsg)
      emit({ type: 'assistant_message', message: assistantMsg })
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
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: cleanedAssistantText || null,
      tool_calls: result.toolCalls
    }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })

    // A-02: never execute tools when the provider finished due to length/truncation.
    // Partial tool_calls under length are unsafe; reject the whole batch with zero handlers.
    if (result.finishReason === 'length' && result.toolCalls.length > 0) {
      const rejectedCount = result.toolCalls.length
      emit({
        type: 'status',
        status: 'error',
        message: `输出因长度截断，已拒绝执行 ${rejectedCount} 个工具调用，避免不完整参数导致副作用。`
      })
      for (const call of result.toolCalls) {
        const content = JSON.stringify({
          error: 'tool_calls_rejected_due_to_length',
          message: '模型输出因 length/max_tokens 截断，本批工具调用未执行。',
          toolName: call.function.name
        })
        transcript.push({ role: 'tool', tool_call_id: call.id, content })
        emit({
          type: 'tool_result',
          toolCallId: call.id,
          name: call.function.name,
          result: content,
          isError: true
        })
        execution.recordToolError()
      }
      // Keep the transcript pair closed and ask the model (or finalization) to continue without side effects.
      continue
    }

    emit({ type: 'status', status: 'tool_running' })
    const batchOutcome = await executeToolBatch(result.toolCalls, opts.toolHandlers, {
      emit: (event) => emit(event),
      signal: runSignal,
      runId: opts.runId
    }, {
      isCanceled: () => execution.isCanceled,
      budgetStop: () => execution.budgetStop('tool'),
      startToolCall: () => execution.startToolCall(),
      recordToolError: () => execution.recordToolError(),
      isDurationExhausted: () => execution.isDurationExhausted,
      onToolCall: (call) => emit({ type: 'tool_call', toolCall: call })
    })
    if (batchOutcome.canceled) {
      for (const toolResult of batchOutcome.results) {
        transcript.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content })
        emit({ type: 'tool_result', toolCallId: toolResult.toolCallId, name: toolResult.name, result: toolResult.content, isError: toolResult.isError })
      }
      return canceledResult(true)
    }
    if (batchOutcome.durationExhausted) return exhaustedResult(true, 'duration')
    if (batchOutcome.exhausted) exhausted = batchOutcome.exhausted
    const turnToolResults = batchOutcome.results
    fileTouchLedger = recordFileTouchesFromToolBatch({
      ledger: fileTouchLedger,
      calls: result.toolCalls,
      results: turnToolResults
    })
    const budgetedTurnResults = await applyTurnToolResultBudget(turnToolResults, opts)
    for (const toolResult of budgetedTurnResults) {
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
        const messages = await prepareMessagesForProvider(recoveryMessages, recovery.tools, {
          compactionTriggerPoint: 'mid_stream'
        })
        const afterCompactionStop = execution.budgetStop('provider')
        if (afterCompactionStop) {
          exhausted = afterCompactionStop
          break
        }
        const recoverySchemaDecision = applyToolsSchemaGuard(toolsSchemaGuard, recovery.tools, emit)
        if (!recoverySchemaDecision.ok) {
          return execution.failed(
            transcript,
            true,
            degradedReason,
            recoverySchemaDecision.reason
          )
        }
        recoveryResult = await invokeProviderWithRetry({
          execution,
          emit,
          signal: runSignal,
          invoke: async () =>
            streamChatProvider({
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
        })
        execution.recordProviderUsage(recoveryResult.usage, 'provider_reported', recoveryResult.finishReason)
        execution.maybeWarnBudget()
        degradedReason ??= recoveryResult.degradedReason
      } catch (error) {
        if (execution.isCanceled) return canceledResult(true)
        if (execution.isDurationExhausted) return exhaustedResult(true, 'duration')
        const budgetReason = budgetStopReasonFromError(error)
        if (budgetReason) {
          exhausted = budgetReason
          break
        }
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

      // A-02: recovery path also rejects tool execution under length truncation.
      if (recoveryResult.finishReason === 'length') {
        const rejectedCount = recoveryResult.toolCalls.length
        emit({
          type: 'status',
          status: 'error',
          message: `恢复阶段输出因长度截断，已拒绝执行 ${rejectedCount} 个工具调用。`
        })
        for (const call of recoveryResult.toolCalls) {
          const content = JSON.stringify({
            error: 'tool_calls_rejected_due_to_length',
            message: '模型输出因 length/max_tokens 截断，本批工具调用未执行。',
            toolName: call.function.name
          })
          transcript.push({ role: 'tool', tool_call_id: call.id, content })
          emit({
            type: 'tool_result',
            toolCallId: call.id,
            name: call.function.name,
            result: content,
            isError: true
          })
          execution.recordToolError()
        }
        continue
      }

      emit({ type: 'status', status: 'tool_running' })
      const recoveryBatch = await executeToolBatch(recoveryResult.toolCalls, opts.toolHandlers, {
        emit: (event) => emit(event),
        signal: runSignal,
        runId: opts.runId
      }, {
        isCanceled: () => execution.isCanceled,
        budgetStop: () => execution.budgetStop('tool'),
        startToolCall: () => execution.startToolCall(),
        recordToolError: () => execution.recordToolError(),
        isDurationExhausted: () => execution.isDurationExhausted,
        onToolCall: (call) => emit({ type: 'tool_call', toolCall: call }),
        resolveCall: (call) => {
          if (allowedRecoveryTools.has(call.function.name) && recovery.shouldAttempt()) {
            return 'execute'
          }
          return {
            skip: {
              toolCallId: call.id,
              name: call.function.name,
              content: allowedRecoveryTools.has(call.function.name)
                ? `恢复阶段的必要操作已经尝试，不再重复执行 ${call.function.name}。`
                : `恢复阶段不允许调用工具 ${call.function.name}。`,
              isError: true
            }
          }
        }
      })
      if (recoveryBatch.canceled) {
        for (const toolResult of recoveryBatch.results) {
          transcript.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content })
          emit({ type: 'tool_result', toolCallId: toolResult.toolCallId, name: toolResult.name, result: toolResult.content, isError: toolResult.isError })
        }
        return canceledResult(true)
      }
      if (recoveryBatch.durationExhausted) return exhaustedResult(true, 'duration')
      if (recoveryBatch.exhausted) exhausted = recoveryBatch.exhausted
      const recoveryTurnResults = recoveryBatch.results
      fileTouchLedger = recordFileTouchesFromToolBatch({
        ledger: fileTouchLedger,
        calls: recoveryResult.toolCalls,
        results: recoveryTurnResults
      })
      const budgetedRecoveryResults = await applyTurnToolResultBudget(recoveryTurnResults, opts)
      for (const toolResult of budgetedRecoveryResults) {
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
    const messages = await prepareMessagesForProvider(transcript, [], {
      compactionTriggerPoint: 'mid_stream'
    })
    const afterCompactionStop = execution.budgetStop('provider')
    if (afterCompactionStop) return exhaustedResult(true, afterCompactionStop)
    let answerStarted = false
    const final = await invokeProviderWithRetry({
      execution,
      emit,
      signal: runSignal,
      invoke: async () =>
        streamChatProvider({
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
    })
    execution.recordProviderUsage(final.usage, 'provider_reported', final.finishReason)
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
    const budgetReason = budgetStopReasonFromError(error)
    if (budgetReason) return exhaustedResult(true, budgetReason)
    const message = error instanceof Error ? error.message : String(error)
    return execution.failed(transcript, true, degradedReason, message)
  }
}



async function invokeProviderWithRetry<T>(opts: {
  execution: AgentLoopExecutionState
  emit: (event: AgentLoopEvent) => void
  signal: AbortSignal
  invoke: () => Promise<T>
  maxAttempts?: number
}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_PROVIDER_RETRY_MAX_ATTEMPTS
  return withProviderRetry({
    budget: { maxAttempts, attemptsUsed: 0 },
    signal: opts.signal,
    extractRetryAfterMs: extractRetryAfterMsFromError,
    onRetry: (info) => {
      opts.execution.noteProviderRetry(info.attempt, info.reasonCode, info.delayMs)
      opts.emit({
        type: 'status',
        status: 'thinking',
        message: `auto_retry_scheduled:${info.reasonCode}:attempt=${info.attempt}:delayMs=${info.delayMs}`
      })
    },
    onExhausted: (info) => {
      // Non-retryable first-failure keeps silent UX (immediate fail).
      // Exhausted attempt budget or multi-attempt fail surfaces a stable code.
      if (info.reasonCode !== 'auto_retry_exhausted' && info.attemptsUsed <= 1) return
      opts.emit({
        type: 'status',
        status: 'thinking',
        message: `auto_retry_exhausted:${info.decision.reasonCode}:attempts=${info.attemptsUsed}`
      })
    },
    run: async () => {
      const stop = opts.execution.budgetStop('provider')
      if (stop) {
        throw Object.assign(new Error(`agent budget exhausted: ${stop}`), {
          name: 'AgentBudgetExhaustedError',
          budgetStopReason: stop
        })
      }
      opts.execution.startProviderCall()
      return opts.invoke()
    }
  })
}

async function applyTurnToolResultBudget(
  results: ToolExecutionResult[],
  opts: Pick<RunAgentLoopOptions, 'workspaceRoot' | 'runId' | 'toolResultTurnBudget'>
): Promise<ToolExecutionResult[]> {
  if (results.length === 0) return results
  const outcome = await enforceToolResultTurnBudget(
    results.map((result) => ({
      toolCallId: result.toolCallId,
      name: result.name,
      content: result.content,
      isError: result.isError
    })),
    {
      workspaceRoot: opts.workspaceRoot ?? '',
      runId: opts.runId ?? '',
      config: opts.toolResultTurnBudget
    }
  )
  return outcome.entries.map((entry) => ({
    toolCallId: entry.toolCallId,
    name: entry.name,
    content: entry.content,
    isError: entry.isError === true
  }))
}

