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
  AgentRunUsageAggregate,
  AgentRunResourceGovernance,
  TeachingSettingsV1,
  TeachingModelProviderProfile
} from '../../shared/teaching-types'
import type { AgentLoopStatus } from '../../shared/teaching-types'
import { AgentLoopExecutionState } from './agent-loop-execution-state'
import type { AgentRunResourceGovernor } from './agent-run-resource-governance'
import { legacyRequestFromMessages, safeFallbackText } from './agent-loop-fallback'
import { closeOpenToolCalls } from './close-open-tool-calls'
import { TOOL_CANCELED_MESSAGE } from './tools/tool-arguments'
import { stripDsmlToolCallBlocks } from './provider-adapter/dsml-tool-calls'
import { classifyProviderRecovery } from '../../shared/provider-recovery'
import { effectiveMaxOutputTokens } from '../../shared/model-provider-catalog'
import {
  emptyContextFileLedger,
  recordFileTouchesFromToolBatch,
  type ContextFileLedger
} from './context-file-ledger'

export type AgentLoopStopReason =
  | 'final_answer'
  | 'error'
  | 'degraded'
  | 'canceled'
  | 'no_progress'
  | 'context_unrecoverable'
  | 'retry_exhausted'
  | 'resource_limit'
  | 'suspended'

export type AgentLoopUsage = AgentRunUsageAggregate

const CONTEXT_UNRECOVERABLE_MESSAGE = '上下文无法继续压缩。请开始新的续接，或选择更大的 context window。'

class ContextUnrecoverableError extends Error {
  constructor() {
    super(CONTEXT_UNRECOVERABLE_MESSAGE)
    this.name = 'ContextUnrecoverableError'
  }
}

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
  jsonMode?: boolean
  /**
   * Tightly bounded recovery for a required business tool that has not
   * received an execution opportunity before the model returns a final answer.
   * This is an explicit business-operation recovery, not a run quota.
   */
  iterationLimitRecovery?: {
    shouldAttempt: () => boolean
    instruction: string
    tools: ToolDefinition[]
    toolChoice: ToolChoice
    maxAttempts?: number
  }
  signal?: AbortSignal
  /**
   * Deterministic confirmation used when a durable operation succeeded but the
   * provider ignored no-tool finalization or returned an empty final answer.
   */
  durableSuccessFallback?: (transcript: readonly ChatMessage[]) => string | null | undefined
  /** Stop offering tools once a caller-observed durable operation has succeeded. */
  shouldFinalizeAfterToolExecution?: () => boolean
  /**
   * Optional maintenance tools offered in the durable-finalization round after
   * a caller-observed durable operation (for example generate_lesson) succeeded.
   * The model may call these once to finish workspace bookkeeping such as
   * syncing a glossary before the no-tool final answer is generated. Execution
   * is restricted to this allow-list and a single bounded round.
   */
  finalizationTools?: ToolDefinition[]
  /**
   * Host-owned last-mile normalization for a no-tool final answer. The callback
   * runs before the answer is streamed or retained in the transcript.
   */
  normalizeFinalAnswer?: (answerText: string) => { finalText: string; degradedReason?: string } | null | undefined
  now?: () => number
  callbacks?: { onEvent?: (e: AgentLoopEvent) => void }
  contextCompaction?: ContextCompactionOptions
  /** Explicit user/deployment constraints plus a high host emergency fuse. */
  resourceGovernance?: AgentRunResourceGovernance
  /** Internal host-owned shared ledger for delegated child runs. */
  resourceGovernor?: AgentRunResourceGovernor
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


/**
 * Non-streaming tool-calling loop (v1). Each turn calls callChatProvider; if
 * the response carries tool_calls, dispatches them (errors become tool results
 * so the model can self-correct) and loops; otherwise the text is the final
 * answer, emitted as a single token chunk. Unsupported endpoint formats
 * (messages/responses) degrade to one legacy single-shot call.
 */
export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<RunAgentLoopResult> {
  const execution = new AgentLoopExecutionState({
    now: opts.now ?? Date.now,
    signal: opts.signal,
    onEvent: opts.callbacks?.onEvent,
    resourceGovernance: opts.resourceGovernance,
    resourceGovernor: opts.resourceGovernor
  })
  const runSignal = execution.signal
  const format = opts.settings.generator.endpointFormat
  const supported = toolsSupportedForFormat(format)
  const transcript: ChatMessage[] = [...opts.messages]
  const emit = (event: AgentLoopEvent): void => {
    if (event.type === 'context_compaction_started') execution.startCompactionOperation()
    execution.emit(event)
  }
  /** Live deterministic file-touch ledger (projection floor; not settlement). */
  let fileTouchLedger: ContextFileLedger = emptyContextFileLedger()
  const requestContext = new RequestContextProjector({
    modelId: opts.settings.generator.model,
    provider: opts.provider,
    compaction: opts.contextCompaction,
    // Reserve exactly the completion ceiling serialized by the provider adapter.
    // Catalog caps remain a request-geometry rule rather than an invisible
    // conservative buffer, so pre-dispatch fit checks and wire payload agree.
    outputReserveTokens: effectiveMaxOutputTokens(
      opts.provider,
      opts.settings.generator.model,
      opts.settings.generator.maxOutputTokens
    ),
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
      execution.startCompactionSummaryAttempt()
      if (!toolsSupportedForFormat(summarySettings.generator.endpointFormat)) {
        const summary = await callProvider({
          settings: summarySettings,
          provider: opts.provider,
          request: legacyRequestFromMessages(request.messages),
          signal: request.signal ?? runSignal,
          beforeTransportDispatch: () => execution.startProviderCall()
        })
        execution.recordProviderUsage(summary.usage)
        return summary.text
      }
      const summary = await callChatProvider({
        settings: summarySettings,
        provider: opts.provider,
        request: {
          messages: request.messages,
          tools: [],
          toolChoice: 'none',
          jsonMode: false
        },
        signal: request.signal ?? runSignal,
        beforeTransportDispatch: () => execution.startProviderCall()
      })
      execution.recordProviderUsage(summary.usage, 'provider_reported', summary.finishReason)
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
      forceCompaction?: boolean
    }
  ) => {
    const messageTurnIds = messages.map((_, index) =>
      index < initialMessageCount ? initialMessageTurnIds?.[index] : undefined
    )
    return requestContext.project(messages, tools, messageTurnIds, {
      compactionTriggerPoint: projection?.compactionTriggerPoint ?? 'pre_send',
      forceCompaction: projection?.forceCompaction,
      signal: runSignal
    })
  }
  const toolsSchemaGuard = createToolsSchemaGuardState()
  /**
   * A provider overflow is scoped to one logical provider request. It gets one
   * forced, projection-only compaction retry; it never becomes a run budget or
   * an unbounded compact/retry loop. Each caller supplies its own request
   * projection so unsupported endpoints and finalization share the same rule.
   */
  const invokeWithContextOverflowRecovery = async <T>(input: {
    prepare: (forceCompaction: boolean) => Promise<{
      messages: ChatMessage[]
      estimatedTokens: number
      contextWindowTokens: number
    }>
    invoke: (messages: ChatMessage[]) => Promise<T>
  }): Promise<T> => {
    execution.startLogicalRequest()
    let overflowRecoveryAttempted = false
    for (;;) {
      const projection = await input.prepare(overflowRecoveryAttempted)
      if (projection.estimatedTokens >= projection.contextWindowTokens) {
        throw new ContextUnrecoverableError()
      }
      try {
        return await input.invoke(projection.messages)
      } catch (error) {
        if (!classifyProviderRecovery(error).shouldCompress) throw error
        if (overflowRecoveryAttempted) throw new ContextUnrecoverableError()
        overflowRecoveryAttempted = true
        execution.noteContextOverflowRecovery()
        emit({ type: 'status', status: 'thinking', message: '检测到上下文溢出，正在压缩上下文后重试一次…' })
      }
    }
  }
  let degradedReason: string | undefined
  let iterations = 0
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


  if (!supported) {
    if (execution.isResourceTerminated) return execution.resourceStopped(transcript, false, degradedReason)
    if (execution.isCanceled) return canceledResult(false)
    iterations = 1
    execution.setIterations(iterations)
    emit({ type: 'status', status: 'answering', message: '当前端点格式不支持工具调用，已降级为纯文本生成。' })
    try {
      let answerStarted = false
      const result = await invokeWithContextOverflowRecovery({
        prepare: (forceCompaction) => prepareMessagesForProvider(transcript, [], {
          compactionTriggerPoint: 'pre_send',
          forceCompaction
        }),
        invoke: async (messages) =>
          invokeProviderWithRetry({
            execution,
            emit,
            signal: runSignal,
            logicalRequest: false,
            invoke: async () =>
              streamProvider({
                settings: opts.settings,
                provider: opts.provider,
                request: legacyRequestFromMessages(messages),
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
                signal: runSignal,
                beforeTransportDispatch: () => execution.startProviderCall()
              })
          })
      })
      execution.recordProviderUsage(result.usage)
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, false, degradedReason)
      if (execution.isCanceled) return canceledResult(false)
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
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, false, degradedReason)
      if (execution.isCanceled) return canceledResult(false)
      const message = error instanceof Error ? error.message : String(error)
      return execution.failed(
        transcript,
        false,
        'unsupported_endpoint_format',
        message,
        error instanceof ContextUnrecoverableError ? 'context_unrecoverable' : undefined
      )
    }
  }

  let firstNormalRequest = true
  let overflowRecoveryAttempted = false
  let forceContextCompaction = false
  let previousNoProgressPattern: string | undefined
  let consecutiveNoProgressPatterns = 0

  for (let index = 0; ; index += 1) {
    if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
    if (execution.isCanceled) return canceledResult(true)
    iterations = index + 1
    execution.setIterations(iterations)
    emit({ type: 'status', status: 'thinking' })
    let result: ChatAdapterResult
    const bufferedAnswerDeltas: string[] = []
    try {
      // Pre-send compaction belongs to an already-authorized logical request. An
      // overflow retry keeps the logical request claimed by its original attempt.
      if (!forceContextCompaction) execution.startLogicalRequest()
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
      const projection = await prepareMessagesForProvider(transcript, opts.tools, {
        compactionTriggerPoint: index === 0 ? 'pre_send' : 'post_tool',
        forceCompaction: forceContextCompaction
      })
      // Never dispatch a request whose final projection is already known not to
      // fit the advertised context window. This applies to normal sends as well
      // as the one forced overflow-recovery compaction attempt.
      if (projection.estimatedTokens >= projection.contextWindowTokens) {
        return execution.failed(
          transcript,
          true,
          degradedReason,
          '上下文在压缩后仍超过模型窗口。请开始新的续接，或选择更大的 context window。',
          'context_unrecoverable'
        )
      }
      const schemaDecision = applyToolsSchemaGuard(toolsSchemaGuard, opts.tools, emit)
      if (!schemaDecision.ok) return execution.failed(transcript, true, degradedReason, schemaDecision.reason)
      result = await invokeProviderWithRetry({
        execution,
        emit,
        signal: runSignal,
        logicalRequest: false,
        invoke: async () =>
          streamChatProvider({
            settings: opts.settings,
            provider: opts.provider,
            request: {
              messages: projection.messages,
              tools: opts.tools,
              toolChoice: firstNormalRequest ? (opts.initialToolChoice ?? 'auto') : 'auto',
              jsonMode: opts.jsonMode === true
            },
            callbacks: {
              onReasoning: (delta) => emit({ type: 'reasoning', delta }),
              onToken: (delta) => bufferedAnswerDeltas.push(delta)
            },
            signal: runSignal,
            beforeTransportDispatch: () => execution.startProviderCall()
          })
      })
      execution.recordProviderUsage(result.usage, 'provider_reported', result.finishReason)
      firstNormalRequest = false
      overflowRecoveryAttempted = false
      forceContextCompaction = false
    } catch (error) {
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
      if (execution.isCanceled) return canceledResult(true)
      const recovery = classifyProviderRecovery(error)
      if (recovery.shouldCompress) {
        if (overflowRecoveryAttempted) {
          return execution.failed(
            transcript,
            true,
            degradedReason,
            '上下文仍无法继续压缩。请开始新的续接，或选择更大的 context window。',
            'context_unrecoverable'
          )
        }
        overflowRecoveryAttempted = true
        execution.noteContextOverflowRecovery()
        forceContextCompaction = true
        emit({ type: 'status', status: 'thinking', message: '检测到上下文溢出，正在压缩上下文后重试一次…' })
        continue
      }
      const message = error instanceof Error ? error.message : String(error)
      return execution.failed(transcript, true, degradedReason, message)
    }
    if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
    if (execution.isCanceled) return canceledResult(true)
    degradedReason ??= result.degradedReason

    const cleanedAssistantText = stripDsmlToolCallBlocks(result.text || '')
    if (result.toolCalls.length === 0) {
      let answerText = cleanedAssistantText || stripDsmlToolCallBlocks(bufferedAnswerDeltas.join(''))
      if (!answerText.trim()) return execution.failed(transcript, true, degradedReason, '模型返回了空答复。')
      const normalized = opts.normalizeFinalAnswer?.(answerText)
      if (normalized?.finalText.trim()) {
        answerText = normalized.finalText
        degradedReason ??= normalized.degradedReason
      }
      const assistantMsg: ChatMessage = { role: 'assistant', content: answerText }
      transcript.push(assistantMsg)
      emit({ type: 'assistant_message', message: assistantMsg })
      // A caller may require a durable business action. That dedicated recovery is
      // not an iteration quota and is kept separate from normal learning runs.
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

    if (result.finishReason === 'length') {
      const rejectedCount = result.toolCalls.length
      emit({ type: 'status', status: 'error', message: `输出因长度截断，已拒绝执行 ${rejectedCount} 个工具调用，避免不完整参数导致副作用。` })
      for (const call of result.toolCalls) {
        const content = JSON.stringify({ error: 'tool_calls_rejected_due_to_length', message: '模型输出因 length/max_tokens 截断，本批工具调用未执行。', toolName: call.function.name })
        transcript.push({ role: 'tool', tool_call_id: call.id, content })
        emit({ type: 'tool_result', toolCallId: call.id, name: call.function.name, result: content, isError: true })
        execution.recordToolError()
      }
      continue
    }

    emit({ type: 'status', status: 'tool_running' })
    try {
      execution.ensureToolOperationCapacity(result.toolCalls.length)
    } catch {
      return execution.resourceStopped(transcript, true, degradedReason)
    }
    const batchOutcome = await executeToolBatch(result.toolCalls, opts.toolHandlers, {
      emit: (event) => emit(event), signal: runSignal, runId: opts.runId, resourceGovernor: execution.resourceGovernorHandle
    }, {
      // Stop admitting operations for either parent cancellation or a resource boundary.
      // The caller below preserves the distinct terminal classification.
      isCanceled: () => execution.signal.aborted,
      startToolCall: () => execution.startToolCall(),
      recordToolError: () => execution.recordToolError(),
      onToolCall: (call) => emit({ type: 'tool_call', toolCall: call })
    })
    if (batchOutcome.canceled) {
      for (const toolResult of batchOutcome.results) {
        transcript.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content })
        emit({ type: 'tool_result', toolCallId: toolResult.toolCallId, name: toolResult.name, result: toolResult.content, isError: toolResult.isError })
      }
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
      return canceledResult(true)
    }
    if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
    const turnToolResults = batchOutcome.results
    fileTouchLedger = recordFileTouchesFromToolBatch({ ledger: fileTouchLedger, calls: result.toolCalls, results: turnToolResults })
    const budgetedTurnResults = await applyTurnToolResultBudget(turnToolResults, opts)
    if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
    for (const toolResult of budgetedTurnResults) {
      transcript.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content })
      emit({ type: 'tool_result', toolCallId: toolResult.toolCallId, name: toolResult.name, result: toolResult.content, isError: toolResult.isError })
    }
    emit({ type: 'status', status: 'tool_done' })

    const pattern = result.toolCalls.map((call) => `${call.function.name}:${call.function.arguments}`).join('|')
    const madeNoProgress = turnToolResults.length > 0 && turnToolResults.every((item) => item.isError)
    if (madeNoProgress && pattern === previousNoProgressPattern) {
      consecutiveNoProgressPatterns += 1
    } else {
      previousNoProgressPattern = madeNoProgress ? pattern : undefined
      consecutiveNoProgressPatterns = madeNoProgress ? 1 : 0
    }
    if (consecutiveNoProgressPatterns >= 3) {
      return execution.failed(
        transcript,
        true,
        degradedReason,
        '工具调用重复且没有产生新的进展，已暂停本段执行。请调整请求或开始新的续接。',
        'no_progress'
      )
    }
    if (opts.shouldFinalizeAfterToolExecution?.() === true) {
      durableFinalizationRequested = true
      break
    }
  }

  if (!durableFinalizationRequested && opts.iterationLimitRecovery?.shouldAttempt() === true) {
    const recovery = opts.iterationLimitRecovery
    const maxRecoveryAttempts = Number.isFinite(recovery.maxAttempts)
      ? Math.max(1, Math.floor(recovery.maxAttempts ?? 1))
      : 1
    const allowedRecoveryTools = new Set(recovery.tools.map((tool) => tool.function.name))

    for (let attempt = 1; attempt <= maxRecoveryAttempts && recovery.shouldAttempt(); attempt += 1) {
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
      if (execution.isCanceled) return canceledResult(true)
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
        const recoverySchemaDecision = applyToolsSchemaGuard(toolsSchemaGuard, recovery.tools, emit)
        if (!recoverySchemaDecision.ok) {
          return execution.failed(
            transcript,
            true,
            degradedReason,
            recoverySchemaDecision.reason
          )
        }
        recoveryResult = await invokeWithContextOverflowRecovery({
          prepare: (forceCompaction) => prepareMessagesForProvider(recoveryMessages, recovery.tools, {
            compactionTriggerPoint: 'mid_stream',
            forceCompaction
          }),
          invoke: async (messages) =>
            invokeProviderWithRetry({
              execution,
              emit,
              signal: runSignal,
              logicalRequest: false,
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
                  signal: runSignal,
                  beforeTransportDispatch: () => execution.startProviderCall()
                })
            })
        })
        execution.recordProviderUsage(recoveryResult.usage, 'provider_reported', recoveryResult.finishReason)
        if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
        degradedReason ??= recoveryResult.degradedReason
      } catch (error) {
        if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
        if (execution.isCanceled) return canceledResult(true)
        const message = error instanceof Error ? error.message : String(error)
        return execution.failed(
          transcript,
          true,
          degradedReason,
          message,
          error instanceof ContextUnrecoverableError ? 'context_unrecoverable' : undefined
        )
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
      try {
        execution.ensureToolOperationCapacity(recoveryResult.toolCalls.length)
      } catch {
        return execution.resourceStopped(transcript, true, degradedReason)
      }
      const recoveryBatch = await executeToolBatch(recoveryResult.toolCalls, opts.toolHandlers, {
        emit: (event) => emit(event),
        signal: runSignal,
        runId: opts.runId,
        resourceGovernor: execution.resourceGovernorHandle
      }, {
        // Stop admitting operations for either parent cancellation or a resource boundary.
        // The caller below preserves the distinct terminal classification.
        isCanceled: () => execution.signal.aborted,
        startToolCall: () => execution.startToolCall(),
        recordToolError: () => execution.recordToolError(),
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
        if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
        return canceledResult(true)
      }
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
      const recoveryTurnResults = recoveryBatch.results
      fileTouchLedger = recordFileTouchesFromToolBatch({
        ledger: fileTouchLedger,
        calls: recoveryResult.toolCalls,
        results: recoveryTurnResults
      })
      const budgetedRecoveryResults = await applyTurnToolResultBudget(recoveryTurnResults, opts)
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
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
    }
  }

  // The recovery is bounded because it protects one explicit business
  // operation—not because it limits the run. If the required operation is
  // still absent after those attempts, do not silently continue to a normal
  // final answer that would misrepresent the state of the work.
  if (!durableFinalizationRequested && opts.iterationLimitRecovery?.shouldAttempt() === true) {
    return execution.failed(
      transcript,
      true,
      degradedReason,
      '必要操作未完成，无法安全继续本段执行。请调整请求或开始新的续接。'
    )
  }

  emit({
    type: 'status',
    status: 'answering',
    message: durableFinalizationRequested
      ? '核心操作已完成，正在生成最终答复。'
      : '正在生成最终答复。'
  })
  try {
    // Optional bounded maintenance round before the no-tool final answer. After
    // a durable operation (for example generate_lesson) succeeded, the model may
    // need to finish workspace bookkeeping such as syncing a glossary. Offering
    // the maintenance tools once lets it do so; the round is restricted to the
    // allow-list and runs at most one provider call plus one tool batch. When
    // the model answers directly, that prose is the final answer; otherwise the
    // maintenance results feed the no-tool round below.
    let finalText: string | null = null
    let final: ChatAdapterResult | null = null
    if (durableFinalizationRequested && opts.finalizationTools && opts.finalizationTools.length > 0) {
      const maintenanceTools = opts.finalizationTools
      const maintenance = await invokeWithContextOverflowRecovery({
        prepare: (forceCompaction) => prepareMessagesForProvider(transcript, maintenanceTools, {
          compactionTriggerPoint: 'mid_stream',
          forceCompaction
        }),
        invoke: async (messages) =>
          invokeProviderWithRetry({
            execution,
            emit,
            signal: runSignal,
            logicalRequest: false,
            invoke: async () =>
              streamChatProvider({
                settings: opts.settings,
                provider: opts.provider,
                request: { messages, tools: maintenanceTools, toolChoice: 'auto', jsonMode: opts.jsonMode === true },
                callbacks: {
                  onReasoning: (delta) => emit({ type: 'reasoning', delta }),
                  // Maintenance prose is not user-facing until it becomes the final
                  // answer; only the no-tool round streams tokens as they arrive.
                  onToken: () => undefined
                },
                signal: runSignal,
                beforeTransportDispatch: () => execution.startProviderCall()
              })
          })
      })
      execution.recordProviderUsage(maintenance.usage, 'provider_reported', maintenance.finishReason)
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
      if (execution.isCanceled) return canceledResult(true)
      degradedReason ??= maintenance.degradedReason

      if (maintenance.toolCalls.length === 0) {
        const directText = stripDsmlToolCallBlocks(maintenance.text || '')
        if (directText.trim()) {
          finalText = directText
          emit({ type: 'status', status: 'answering', message: '正在整理并生成回复…' })
          emit({ type: 'token', delta: directText })
        }
      } else {
        // Keep the maintenance assistant tool_calls message in the transcript so the
        // tool results below stay pair-closed (B-12). Without it, the no-tool final
        // round sends orphan tool messages and providers reject the request with 400
        // "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'".
        const maintenanceAssistant: ChatMessage = {
          role: 'assistant',
          content: stripDsmlToolCallBlocks(maintenance.text || '') || null,
          tool_calls: maintenance.toolCalls
        }
        transcript.push(maintenanceAssistant)
        emit({ type: 'assistant_message', message: maintenanceAssistant })
        emit({ type: 'status', status: 'tool_running' })
        try {
          execution.ensureToolOperationCapacity(maintenance.toolCalls.length)
        } catch {
          return execution.resourceStopped(transcript, true, degradedReason)
        }
        const maintenanceBatch = await executeToolBatch(maintenance.toolCalls, opts.toolHandlers, {
          emit,
          signal: runSignal,
          runId: opts.runId,
          resourceGovernor: execution.resourceGovernorHandle
        }, {
          // Stop admitting operations for either parent cancellation or a resource boundary.
        // The caller below preserves the distinct terminal classification.
        isCanceled: () => execution.signal.aborted,
          startToolCall: () => execution.startToolCall(),
          recordToolError: () => execution.recordToolError(),
          onToolCall: (call) => emit({ type: 'tool_call', toolCall: call }),
          resolveCall: (call) => {
            if (maintenanceTools.some((tool) => tool.function.name === call.function.name)) return 'execute'
            return {
              skip: {
                toolCallId: call.id,
                name: call.function.name,
                content: JSON.stringify({
                  error: 'finalization_tool_not_allowed',
                  message: `收尾阶段不允许调用工具 ${call.function.name}。`
                }),
                isError: true
              }
            }
          }
        })
        for (const toolResult of maintenanceBatch.results) {
          transcript.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content })
          emit({ type: 'tool_result', toolCallId: toolResult.toolCallId, name: toolResult.name, result: toolResult.content, isError: toolResult.isError })
        }
        emit({ type: 'status', status: 'tool_done' })
        if (maintenanceBatch.canceled) {
          if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
          return canceledResult(true)
        }
        if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
      }
    }

    // No-tool final answer round. Skipped when the maintenance round already
    // produced direct final prose.
    if (!finalText) {
      let answerStarted = false
      final = await invokeWithContextOverflowRecovery({
        prepare: (forceCompaction) => prepareMessagesForProvider(transcript, [], {
          compactionTriggerPoint: 'mid_stream',
          forceCompaction
        }),
        invoke: async (messages) =>
          invokeProviderWithRetry({
            execution,
            emit,
            signal: runSignal,
            logicalRequest: false,
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
                signal: runSignal,
                beforeTransportDispatch: () => execution.startProviderCall()
              })
          })
      })
      execution.recordProviderUsage(final.usage, 'provider_reported', final.finishReason)
      if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
      if (execution.isCanceled) return canceledResult(true)
      degradedReason ??= final.degradedReason
      // Finalization already requested toolChoice:none with an empty tool list. Some
      // providers still emit native/DSML tool calls here; recover any prose first and
      // only fall back to a durable success summary when the model returns nothing usable.
      finalText = stripDsmlToolCallBlocks(final.text || '')
    }
    if (final && final.toolCalls.length > 0 && !finalText.trim()) {
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
        return execution.failed(transcript, true, degradedReason, '模型仍请求继续调用工具，未返回最终答复。')
      }
    } else if (final && final.toolCalls.length > 0) {
      degradedReason ??= 'final_answer_ignored_tool_calls'
    }
    if (!finalText.trim()) {
      const durableFallback = durableFinalizationRequested
        ? safeFallbackText(opts.durableSuccessFallback, transcript)
        : ''
      if (durableFallback) {
        finalText = durableFallback
        degradedReason ??= 'empty_final_answer_after_durable_success'
      } else if (durableFinalizationRequested) {
        finalText = '核心操作已完成。'
        degradedReason ??= 'empty_final_answer_after_durable_success'
      } else {
        return execution.failed(transcript, true, degradedReason, '模型返回了空答复。')
      }
    }
    const assistantMsg: ChatMessage = { role: 'assistant', content: finalText }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })
    return execution.completed(transcript, {
      finalText,
      toolsSupported: true,
      degradedReason,
      stopReason: 'final_answer'
    })
  } catch (error) {
    if (execution.isResourceTerminated) return execution.resourceStopped(transcript, true, degradedReason)
    if (execution.isCanceled) return canceledResult(true)
    const message = error instanceof Error ? error.message : String(error)
    return execution.failed(
      transcript,
      true,
      degradedReason,
      message,
      error instanceof ContextUnrecoverableError ? 'context_unrecoverable' : undefined
    )
  }
}



async function invokeProviderWithRetry<T>(opts: {
  execution: AgentLoopExecutionState
  emit: (event: AgentLoopEvent) => void
  signal: AbortSignal
  invoke: () => Promise<T>
  maxAttempts?: number
  /** False when an outer logical request owns compact-and-resend recovery. */
  logicalRequest?: boolean
}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_PROVIDER_RETRY_MAX_ATTEMPTS
  if (opts.logicalRequest !== false) opts.execution.startLogicalRequest()
  return withProviderRetry({
    budget: { maxAttempts, attemptsUsed: 0 },
    signal: opts.signal,
    extractRetryAfterMs: extractRetryAfterMsFromError,
    onRetry: (info) => {
      if (opts.execution.isResourceTerminated) return
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
      opts.execution.noteProviderRetryExhausted()
      opts.emit({
        type: 'status',
        status: 'retry_exhausted',
        message: `自动重试已耗尽：${info.decision.reasonCode}（尝试 ${info.attemptsUsed} 次）`
      })
    },
    run: () => opts.invoke()
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

