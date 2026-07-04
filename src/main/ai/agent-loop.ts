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
import type { ToolHandlerMap } from './tools/registry'
import type {
  TeachingSettingsV1,
  TeachingModelProviderProfile
} from '../../shared/teaching-types'
import type { AgentLoopStatus } from '../../shared/teaching-types'

export type AgentLoopStopReason = 'final_answer' | 'max_iterations' | 'error' | 'degraded' | 'canceled'

export type AgentLoopEvent =
  | { type: 'status'; status: AgentLoopStatus; message?: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; name: string; result: string; isError: boolean }
  | { type: 'token'; delta: string }

export type RunAgentLoopOptions = {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  messages: ChatMessage[]
  tools: ToolDefinition[]
  toolHandlers: ToolHandlerMap
  maxIterations?: number
  signal?: AbortSignal
  callbacks?: { onEvent?: (e: AgentLoopEvent) => void }
}

export type RunAgentLoopResult = {
  messages: ChatMessage[]
  finalText: string
  iterations: number
  toolsSupported: boolean
  degradedReason?: string
  stopReason: AgentLoopStopReason
  error?: string
}

const DEFAULT_MAX_ITERATIONS = 4

/**
 * Non-streaming tool-calling loop (v1). Each turn calls callChatProvider; if
 * the response carries tool_calls, dispatches them (errors become tool results
 * so the model can self-correct) and loops; otherwise the text is the final
 * answer, emitted as a single token chunk. Unsupported endpoint formats
 * (messages/responses) degrade to one legacy single-shot call.
 */
export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<RunAgentLoopResult> {
  const format = opts.settings.generator.endpointFormat
  const supported = toolsSupportedForFormat(format)
  const maxIter = Math.max(1, opts.maxIterations ?? opts.settings.tools.maxIterations ?? DEFAULT_MAX_ITERATIONS)
  const transcript: ChatMessage[] = [...opts.messages]
  const emit = (e: AgentLoopEvent): void => {
    opts.callbacks?.onEvent?.(e)
  }
  let degradedReason: string | undefined
  let iterations = 0
  const isCanceled = (): boolean => opts.signal?.aborted === true
  const canceledResult = (toolsSupported: boolean): RunAgentLoopResult => {
    emit({ type: 'status', status: 'canceled' })
    return {
      messages: transcript,
      finalText: '',
      iterations,
      toolsSupported,
      degradedReason,
      stopReason: 'canceled'
    }
  }

  // Degraded path: endpoint format can't carry tools.
  if (!supported) {
    if (isCanceled()) return canceledResult(false)
    iterations = 1
    emit({ type: 'status', status: 'answering', message: '当前端点格式不支持工具调用，已降级为纯文本生成。' })
    try {
      const result = await callProvider({
        settings: opts.settings,
        provider: opts.provider,
        request: legacyRequestFromMessages(transcript),
        signal: opts.signal
      })
      if (isCanceled()) return canceledResult(false)
      const assistantMsg: ChatMessage = { role: 'assistant', content: result.text }
      transcript.push(assistantMsg)
      emit({ type: 'assistant_message', message: assistantMsg })
      emit({ type: 'token', delta: result.text })
      emit({ type: 'status', status: 'done' })
      return {
        messages: transcript,
        finalText: result.text,
        iterations: 1,
        toolsSupported: false,
        degradedReason: 'unsupported_endpoint_format',
        stopReason: 'degraded'
      }
    } catch (e) {
      if (isCanceled()) return canceledResult(false)
      const message = e instanceof Error ? e.message : String(e)
      emit({ type: 'status', status: 'error', message })
      return {
        messages: transcript,
        finalText: '',
        iterations: 1,
        toolsSupported: false,
        degradedReason: 'unsupported_endpoint_format',
        stopReason: 'error',
        error: message
      }
    }
  }

  for (let i = 0; i < maxIter; i++) {
    if (isCanceled()) return canceledResult(true)
    iterations = i + 1
    emit({ type: 'status', status: 'thinking' })
    let result: ChatAdapterResult
    try {
      result = await callChatProvider({
        settings: opts.settings,
        provider: opts.provider,
        request: {
          messages: transcript,
          tools: opts.tools,
          toolChoice: 'auto'
        },
        signal: opts.signal
      })
    } catch (e) {
      if (isCanceled()) return canceledResult(true)
      const message = e instanceof Error ? e.message : String(e)
      emit({ type: 'status', status: 'error', message })
      return {
        messages: transcript,
        finalText: '',
        iterations,
        toolsSupported: true,
        degradedReason,
        stopReason: 'error',
        error: message
      }
    }
    if (isCanceled()) return canceledResult(true)
    degradedReason ??= result.degradedReason

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined
    }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })

    if (result.toolCalls.length === 0) {
      // Final answer. Emit the whole text as one token chunk (v1; no per-token
      // streaming to avoid streaming tool_call-accumulation fragility).
      if (!result.text.trim()) {
        const message = '模型返回了空答复。'
        emit({ type: 'status', status: 'error', message })
        return {
          messages: transcript,
          finalText: '',
          iterations,
          toolsSupported: true,
          degradedReason,
          stopReason: 'error',
          error: message
        }
      }
      if (result.text) emit({ type: 'token', delta: result.text })
      emit({ type: 'status', status: 'done' })
      return {
        messages: transcript,
        finalText: result.text,
        iterations,
        toolsSupported: true,
        degradedReason,
        stopReason: 'final_answer'
      }
    }

    emit({ type: 'status', status: 'tool_running' })
    for (const call of result.toolCalls) {
      if (isCanceled()) return canceledResult(true)
      emit({ type: 'tool_call', toolCall: call })
      let payload: string
      let isError = false
      try {
        const args = safeParseArgs(call.function.arguments)
        const handler = opts.toolHandlers[call.function.name]
        if (!handler) throw new Error(`未知工具：${call.function.name}`)
        payload = await handler(args)
      } catch (e) {
        isError = true
        payload = JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
      }
      if (isCanceled()) return canceledResult(true)
      transcript.push({ role: 'tool', tool_call_id: call.id, content: payload })
      emit({
        type: 'tool_result',
        toolCallId: call.id,
        name: call.function.name,
        result: payload,
        isError
      })
    }
    emit({ type: 'status', status: 'tool_done' })
  }

  // Budget exhausted: force one final no-tools turn to produce an answer.
  emit({ type: 'status', status: 'answering', message: '达到工具调用上限，生成最终答复。' })
  try {
    if (isCanceled()) return canceledResult(true)
    const final = await callChatProvider({
      settings: opts.settings,
      provider: opts.provider,
      request: { messages: transcript, tools: [], toolChoice: 'none' },
      signal: opts.signal
    })
    if (isCanceled()) return canceledResult(true)
    degradedReason ??= final.degradedReason
    const assistantMsg: ChatMessage = { role: 'assistant', content: final.text || null }
    transcript.push(assistantMsg)
    emit({ type: 'assistant_message', message: assistantMsg })
    if (!final.text.trim()) {
      const message = final.toolCalls.length > 0
        ? '达到工具调用上限后，模型仍请求继续调用工具，未返回最终答复。请提高工具调用上限或简化请求。'
        : '达到工具调用上限后，模型返回了空答复。'
      emit({ type: 'status', status: 'error', message })
      return {
        messages: transcript,
        finalText: '',
        iterations,
        toolsSupported: true,
        degradedReason,
        stopReason: 'error',
        error: message
      }
    }
    if (final.text) emit({ type: 'token', delta: final.text })
    emit({ type: 'status', status: 'done' })
    return {
      messages: transcript,
      finalText: final.text,
      iterations,
      toolsSupported: true,
      degradedReason,
      stopReason: 'max_iterations'
    }
  } catch (e) {
    if (isCanceled()) return canceledResult(true)
    const message = e instanceof Error ? e.message : String(e)
    emit({ type: 'status', status: 'error', message })
    return {
      messages: transcript,
      finalText: '',
      iterations,
      toolsSupported: true,
      degradedReason,
      stopReason: 'error',
      error: message
    }
  }
}

function legacyRequestFromMessages(messages: ChatMessage[]): {
  systemPrompt: string
  userPrompt: string
  jsonMode: boolean
} {
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
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

function safeParseArgs(raw: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
