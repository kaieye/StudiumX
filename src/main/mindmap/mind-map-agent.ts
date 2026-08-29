/**
 * Mind-map generation as a bounded agent loop over the shared teaching agent
 * runner (runAgentLoop).
 *
 * The model decides which workspace reads it needs, streams its reasoning
 * between tool calls, and submits the strict mind-map envelope through a
 * terminal business tool — the same durable-tool pattern the teaching
 * conversation uses for `generate_lesson`
 * (`shouldFinalizeAfterToolExecution`). Tool execution stays inside this
 * module's bounds: read-only workspace registry tools plus the one submit
 * tool. Nothing here enters teaching settlement, the durable conversation
 * catalog, or the write/shell effect classes.
 */
import type {
  AgentChatImageAttachment,
  AgentRunResourceGovernance,
  TeachingSettingsV1
} from '../../shared/teaching-types'
import type { ChatMessage } from '../ai/provider-adapter'
import { resolveActiveProvider } from '../ai/provider-adapter'
import type { ToolDefinition } from '../ai/provider-adapter'
import { runAgentLoop, type AgentLoopStopReason } from '../ai/agent-loop'
import { ToolRegistry, buildDefaultRegistry, buildToolContext, type ToolHandlerMap } from '../ai/tools/registry'

export type MindMapAgentToolCall = {
  id: string
  name: string
  arguments: string
}

export type MindMapAgentEventHandlers = {
  /** Provider reasoning deltas, forwarded on the same channel as the homepage. */
  onReasoning?: (delta: string) => void
  /** Final no-tool answer deltas (the learner-facing reply). */
  onAnswer?: (delta: string) => void
  /** Model tool calls, published as real transcript tool rows. */
  onToolCall?: (toolCall: MindMapAgentToolCall) => void
  onToolResult?: (toolCall: MindMapAgentToolCall, result: string, isError: boolean) => void
}

export type MindMapAgentRunOk<T> = {
  ok: true
  /** Validated submit-tool capture. */
  captured: T
  /** Final no-tool answer text (may be empty when the host fallback applied). */
  finalText: string
}

export type MindMapAgentRunFailed = {
  ok: false
  stopReason: AgentLoopStopReason
  error?: string
}

export type MindMapAgentRunResult<T> = MindMapAgentRunOk<T> | MindMapAgentRunFailed

export type MindMapAgentRunOptions<T> = {
  settings: TeachingSettingsV1
  /** Workspace root for the read-only registry tools and tool-result spill. */
  workspaceRoot?: string
  generationId?: string
  signal?: AbortSignal
  resourceGovernance?: AgentRunResourceGovernance
  messages: ChatMessage[]
  /** Terminal business tool the model must call to hand over its result. */
  submitTool: ToolDefinition
  /** Validates the submit arguments; throws to feed a corrective tool result. */
  validateSubmitArguments: (argsText: string) => T
  /** Called once after a validated capture (canvas preview feed, bookkeeping). */
  onSubmitValidated?: (captured: T) => void
  /** Deterministic final answer when the provider skips no-tool finalization. */
  durableSuccessText: string
  eventHandlers?: MindMapAgentEventHandlers
}

/**
 * Active generation registry keyed by `generationId`. The IPC cancel path
 * (registered by the gateway) calls `cancelMindMapGeneration` so the abort
 * reaches the in-flight agent loop instead of only hiding renderer loading
 * state.
 */
const activeMindMapGenerations = new Map<string, AbortController>()

/** Abort the in-flight generation for `generationId`, if still active. */
export function cancelMindMapGeneration(generationId: string): boolean {
  const controller = activeMindMapGenerations.get(generationId)
  if (!controller) return false
  controller.abort()
  activeMindMapGenerations.delete(generationId)
  return true
}

function composeAbortSignals(
  ...candidates: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const signals = candidates.filter((signal): signal is AbortSignal => signal !== undefined)
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  return AbortSignal.any(signals)
}

/**
 * Run one bounded mind-map generation loop. The captured value is produced
 * only by the submit tool handler, which validates the model's arguments with
 * the caller's parser; an invalid submission becomes an error tool result so
 * the model can self-correct inside the loop.
 */
export async function runMindMapAgentGeneration<T>(
  opts: MindMapAgentRunOptions<T>
): Promise<MindMapAgentRunResult<T>> {
  const provider = resolveActiveProvider(opts.settings)
  if (!provider || !provider.apiKey.trim()) {
    return { ok: false, stopReason: 'error', error: '未配置可用的 AI Provider 或 API Key。' }
  }

  // Register the cancellation lease so `cancelMindMapGeneration(generationId)`
  // aborts the loop even when the caller did not pass its own signal.
  const runController = opts.generationId ? new AbortController() : undefined
  if (runController && opts.generationId) {
    activeMindMapGenerations.set(opts.generationId, runController)
  }
  const signal = composeAbortSignals(opts.signal, runController?.signal)

  // Read-only workspace tools only: no workspaceWrite option is passed, so the
  // registry never exposes file writers or the shell to this loop.
  const registry = opts.settings.tools.workspaceRead && opts.workspaceRoot
    ? buildDefaultRegistry(opts.settings, { workspaceRoot: opts.workspaceRoot })
    : new ToolRegistry()
  const context = buildToolContext(opts.settings, {
    workspaceRoot: opts.workspaceRoot,
    signal: opts.signal,
    runId: opts.generationId
  })
  const toolHandlers: ToolHandlerMap = registry.handlerMap(context)

  let captured: { value: T } | undefined
  const seenToolCalls = new Map<string, MindMapAgentToolCall>()
  const submitName = opts.submitTool.function.name
  const tools: ToolDefinition[] = [...registry.definitions(), opts.submitTool]

  toolHandlers[submitName] = async (args) => {
    const argsText = typeof args === 'string' ? args : JSON.stringify(args ?? {})
    const value = opts.validateSubmitArguments(argsText)
    captured = { value }
    opts.onSubmitValidated?.(value)
    return JSON.stringify({ ok: true })
  }

  const loopResult = await runAgentLoop({
    settings: opts.settings,
    provider,
    messages: opts.messages,
    tools,
    toolHandlers,
    runId: opts.generationId,
    workspaceRoot: opts.workspaceRoot,
    signal,
    resourceGovernance: opts.resourceGovernance,
    shouldFinalizeAfterToolExecution: () => captured !== undefined,
    durableSuccessFallback: () => (captured !== undefined ? opts.durableSuccessText : null),
    iterationLimitRecovery: {
      shouldAttempt: () => captured === undefined,
      instruction: `立即调用 ${submitName} 工具提交最终结果；不要调用其他工具，也不要继续提问。`,
      tools: [opts.submitTool],
      toolChoice: { type: 'function', function: { name: submitName } },
      maxAttempts: 2
    },
    callbacks: {
      onEvent: (event) => {
        switch (event.type) {
          case 'reasoning':
            opts.eventHandlers?.onReasoning?.(event.delta)
            break
          case 'token':
            opts.eventHandlers?.onAnswer?.(event.delta)
            break
          case 'tool_call': {
            const call: MindMapAgentToolCall = {
              id: event.toolCall.id,
              name: event.toolCall.function.name,
              arguments: event.toolCall.function.arguments
            }
            seenToolCalls.set(call.id, call)
            opts.eventHandlers?.onToolCall?.(call)
            break
          }
          case 'tool_result': {
            const call = seenToolCalls.get(event.toolCallId) ?? {
              id: event.toolCallId,
              name: event.name,
              arguments: ''
            }
            opts.eventHandlers?.onToolResult?.(call, event.result, event.isError)
            break
          }
          default:
            break
        }
      }
    }
  }).finally(() => {
    if (runController && opts.generationId && activeMindMapGenerations.get(opts.generationId) === runController) {
      activeMindMapGenerations.delete(opts.generationId)
    }
  })

  if (captured === undefined) {
    return {
      ok: false,
      stopReason: loopResult.stopReason,
      ...(loopResult.error ? { error: loopResult.error } : {})
    }
  }
  return { ok: true, captured: captured.value, finalText: loopResult.finalText }
}

/** Attach images to the leading user message of a mind-map agent run. */
export function mindMapAgentMessages(
  systemPrompt: string,
  userPrompt: string,
  imageAttachments?: AgentChatImageAttachment[]
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: userPrompt,
      ...(imageAttachments?.length ? { imageAttachments } : {})
    }
  ]
}
