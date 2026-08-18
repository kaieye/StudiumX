/**
 * Stream presentation adapter (ADOPTION B-06 / ADR-0004).
 *
 * Maps multi-shape agent stream signals (`AgentLoopEvent` and presentation
 * callbacks) into a single sink without owning timeline / EventBus storage.
 * Presentation exceptions are swallowed so they never rethrow into the agent loop.
 *
 * Settlement, toolsReplayed, sole-writer, and AgentEventBus replay remain
 * outside this module.
 */

import type {
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentLoopStatus
} from '../../shared/teaching-types'
import type { AgentLoopEvent } from './agent-loop'

/** Optional local-only presentation diagnostic sink (no remote telemetry). */
export type AgentStreamPresentationDiagnostic = {
  kind: 'presentation_error'
  method: string
  message: string
}

export type AgentStreamPresentationSink = {
  chunk: (chunk: AgentChatStreamChunk) => void
  status: (status: AgentChatStreamStatus) => void
  tool: (event: AgentChatStreamToolEvent) => void
  /** Optional passthrough for callers that still observe raw loop events. */
  loopEvent?: (event: AgentLoopEvent) => void
}

export type CreateAgentStreamPresentationAdapterOptions = {
  streamId: string
  sink: AgentStreamPresentationSink
  /**
   * Local-only diagnostic hook. Must not throw; the adapter also wraps it.
   * Never used for remote telemetry / phone-home.
   */
  onPresentationError?: (diagnostic: AgentStreamPresentationDiagnostic) => void
}

export type AgentStreamPresentationAdapter = {
  streamId: string
  presentLoopEvent: (event: AgentLoopEvent) => void
  presentChunk: (delta: string, channel?: 'answer' | 'reasoning') => void
  presentStatus: (status: AgentLoopStatus, message?: string) => void
  presentTool: (event: Omit<AgentChatStreamToolEvent, 'streamId'>) => void
}

/**
 * Invoke a presentation side-effect without letting exceptions escape.
 * Returns true when the callback completed normally.
 */
export function safePresent(
  method: string,
  fn: () => void,
  onPresentationError?: (diagnostic: AgentStreamPresentationDiagnostic) => void
): boolean {
  try {
    fn()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (onPresentationError) {
      try {
        onPresentationError({ kind: 'presentation_error', method, message })
      } catch {
        // Diagnostic sinks must never rethrow into the agent loop either.
      }
    }
    return false
  }
}

/**
 * Pure mapping of `AgentLoopEvent` → presentation actions.
 * Does not call sinks; does not own EventBus / replay state.
 */
export function mapAgentLoopEventToPresentation(
  streamId: string,
  event: AgentLoopEvent
): Array<
  | { kind: 'status'; status: AgentLoopStatus; message?: string }
  | { kind: 'chunk'; delta: string; channel: 'answer' | 'reasoning' }
  | { kind: 'tool'; event: Omit<AgentChatStreamToolEvent, 'streamId'> }
> {
  if (event.type === 'status') {
    return [{ kind: 'status', status: event.status, message: event.message }]
  }
  if (event.type === 'token') {
    return [{ kind: 'chunk', delta: event.delta, channel: 'answer' }]
  }
  if (event.type === 'reasoning') {
    return [{ kind: 'chunk', delta: event.delta, channel: 'reasoning' }]
  }
  if (event.type === 'tool_call') {
    return [
      {
        kind: 'tool',
        event: {
          toolCall: {
            id: event.toolCall.id,
            name: event.toolCall.function.name,
            arguments: event.toolCall.function.arguments
          }
        }
      }
    ]
  }
  if (event.type === 'tool_result') {
    return [
      {
        kind: 'tool',
        event: {
          toolCall: { id: event.toolCallId, name: event.name, arguments: '' },
          result: event.result,
          isError: event.isError
        }
      }
    ]
  }
  if (event.type === 'child_run_queued') {
    return [{ kind: 'status', status: 'tool_running', message: `子任务排队：${event.child.label}` }]
  }
  if (event.type === 'child_run_started') {
    return [{ kind: 'status', status: 'tool_running', message: `子任务开始：${event.child.label}` }]
  }
  if (event.type === 'child_run_delta') {
    return [
      {
        kind: 'status',
        status: 'tool_running',
        message: `子任务进度：${event.childRunId}：${event.message}`
      }
    ]
  }
  if (event.type === 'child_run_completed') {
    return [{ kind: 'status', status: 'tool_done', message: `子任务完成：${event.child.label}` }]
  }
  if (event.type === 'child_run_failed') {
    return [{ kind: 'status', status: 'tool_done', message: `子任务失败：${event.child.label}` }]
  }
  if (event.type === 'child_run_canceled') {
    return [{ kind: 'status', status: 'tool_done', message: `子任务取消：${event.child.label}` }]
  }
  if (event.type === 'context_compaction_started') {
    return [
      {
        kind: 'status',
        status: 'thinking',
        message: `上下文压缩开始：${contextCompactionReasonLabel(event.reason)}`
      }
    ]
  }
  if (event.type === 'context_compaction_completed') {
    return [
      {
        kind: 'status',
        status: 'thinking',
        message: `上下文压缩完成：约节省 ${Math.max(0, event.replacedTokens - event.summaryTokens)} token`
      }
    ]
  }
  if (event.type === 'context_compaction_failed') {
    return [
      {
        kind: 'status',
        status: 'thinking',
        message: `上下文压缩失败，已保留原始历史：${event.error}`
      }
    ]
  }

  // assistant_message, context_hygiene_applied, context_estimated, etc.
  // are loop-internal / audit-oriented and have no presentation surface here.
  void streamId
  return []
}

/**
 * Factory: multi-callback presentation sinks behind a single safe API.
 * Compatible with existing AgentEventBus callback shapes without replacing the bus.
 */
export function createAgentStreamPresentationAdapter(
  options: CreateAgentStreamPresentationAdapterOptions
): AgentStreamPresentationAdapter {
  const { streamId, sink, onPresentationError } = options

  const presentChunk = (delta: string, channel: 'answer' | 'reasoning' = 'answer'): void => {
    const payload: AgentChatStreamChunk =
      channel === 'reasoning' ? { streamId, delta, channel } : { streamId, delta }
    safePresent('chunk', () => sink.chunk(payload), onPresentationError)
  }

  const presentStatus = (status: AgentLoopStatus, message?: string): void => {
    const payload: AgentChatStreamStatus =
      message === undefined ? { streamId, status } : { streamId, status, message }
    safePresent('status', () => sink.status(payload), onPresentationError)
  }

  const presentTool = (event: Omit<AgentChatStreamToolEvent, 'streamId'>): void => {
    const payload: AgentChatStreamToolEvent = { streamId, ...event }
    safePresent('tool', () => sink.tool(payload), onPresentationError)
  }

  const presentLoopEvent = (event: AgentLoopEvent): void => {
    if (sink.loopEvent) {
      safePresent('loopEvent', () => sink.loopEvent?.(event), onPresentationError)
    }
    for (const action of mapAgentLoopEventToPresentation(streamId, event)) {
      if (action.kind === 'status') presentStatus(action.status, action.message)
      else if (action.kind === 'chunk') presentChunk(action.delta, action.channel)
      else presentTool(action.event)
    }
  }

  return {
    streamId,
    presentLoopEvent,
    presentChunk,
    presentStatus,
    presentTool
  }
}

/**
 * Wrap multi-callback presentation sinks so each outbound delivery is
 * exception-isolated. Used by AgentEventBus so UI/IPC callback throws cannot
 * re-enter the agent loop via publishChunk/publishStatus/publishTool.
 */
export function wrapPresentationCallbacks(options: {
  onChunk: (chunk: AgentChatStreamChunk) => void
  onStatus: (status: AgentChatStreamStatus) => void
  onTool: (event: AgentChatStreamToolEvent) => void
  onRealtimeEvent?: (event: import('../../shared/teaching-types').AgentRealtimeEvent) => void
  onRecorded?: (event: import('../../shared/teaching-types').AgentRealtimeEvent) => void
  onPresentationError?: (diagnostic: AgentStreamPresentationDiagnostic) => void
}): {
  onChunk: (chunk: AgentChatStreamChunk) => void
  onStatus: (status: AgentChatStreamStatus) => void
  onTool: (event: AgentChatStreamToolEvent) => void
  onRealtimeEvent?: (event: import('../../shared/teaching-types').AgentRealtimeEvent) => void
  onRecorded?: (event: import('../../shared/teaching-types').AgentRealtimeEvent) => void
} {
  const { onPresentationError } = options
  return {
    onChunk: (chunk) => {
      safePresent('onChunk', () => options.onChunk(chunk), onPresentationError)
    },
    onStatus: (status) => {
      safePresent('onStatus', () => options.onStatus(status), onPresentationError)
    },
    onTool: (event) => {
      safePresent('onTool', () => options.onTool(event), onPresentationError)
    },
    onRealtimeEvent: options.onRealtimeEvent
      ? (event) => {
          safePresent('onRealtimeEvent', () => options.onRealtimeEvent?.(event), onPresentationError)
        }
      : undefined,
    onRecorded: options.onRecorded
      ? (event) => {
          safePresent('onRecorded', () => options.onRecorded?.(event), onPresentationError)
        }
      : undefined
  }
}

function contextCompactionReasonLabel(reason: string): string {
  if (reason === 'hard_threshold') return '接近硬阈值'
  if (reason === 'soft_threshold') return '接近上下文阈值'
  if (reason === 'manual') return '手动触发'
  return reason
}
