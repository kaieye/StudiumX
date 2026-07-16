import { Buffer } from 'node:buffer'

import type {
  AgentEventBusReplay,
  AgentRealtimeEvent,
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentLoopStatus
} from '../../shared/teaching-types'
import type { AgentLoopEvent } from './agent-loop'

export type AgentEventBusOptions = {
  streamId: string
  maxReplayBytes?: number
  now?: () => string
  onChunk: (chunk: AgentChatStreamChunk) => void
  onStatus: (status: AgentChatStreamStatus) => void
  onTool: (event: AgentChatStreamToolEvent) => void
  onRealtimeEvent?: (event: AgentRealtimeEvent) => void
  onRecorded?: (event: AgentRealtimeEvent) => void
}

const DEFAULT_MAX_REPLAY_BYTES = 64 * 1024

export class AgentEventBus {
  private readonly streamId: string
  private readonly maxReplayBytes: number
  private readonly now: () => string
  private readonly onChunk: (chunk: AgentChatStreamChunk) => void
  private readonly onStatus: (status: AgentChatStreamStatus) => void
  private readonly onTool: (event: AgentChatStreamToolEvent) => void
  private readonly onRealtimeEvent?: (event: AgentRealtimeEvent) => void
  private readonly onRecorded?: (event: AgentRealtimeEvent) => void
  private events: AgentRealtimeEvent[] = []
  private replayBytes = 0
  private sequence = 0
  private droppedEvents = 0
  private droppedBytes = 0
  private terminalEvent: AgentRealtimeEvent | null = null

  constructor(options: AgentEventBusOptions) {
    this.streamId = options.streamId
    this.maxReplayBytes = Math.max(1024, Math.floor(options.maxReplayBytes ?? DEFAULT_MAX_REPLAY_BYTES))
    this.now = options.now ?? (() => new Date().toISOString())
    this.onChunk = options.onChunk
    this.onStatus = options.onStatus
    this.onTool = options.onTool
    this.onRealtimeEvent = options.onRealtimeEvent
    this.onRecorded = options.onRecorded
  }

  publishLoopEvent(event: AgentLoopEvent): void {
    if (event.type === 'status') {
      this.publishStatus(event.status, event.message)
    } else if (event.type === 'token') {
      this.publishChunk(event.delta, 'answer')
    } else if (event.type === 'reasoning') {
      this.publishChunk(event.delta, 'reasoning')
    } else if (event.type === 'tool_call') {
      this.publishTool({
        toolCall: {
          id: event.toolCall.id,
          name: event.toolCall.function.name,
          arguments: event.toolCall.function.arguments
        }
      })
    } else if (event.type === 'tool_result') {
      this.publishTool({
        toolCall: { id: event.toolCallId, name: event.name, arguments: '' },
        result: event.result,
        isError: event.isError
      })
    } else if (event.type === 'child_run_queued') {
      this.publishStatus('tool_running', `子任务排队：${event.child.label}`)
    } else if (event.type === 'child_run_started') {
      this.publishStatus('tool_running', `子任务开始：${event.child.label}`)
    } else if (event.type === 'child_run_delta') {
      this.publishStatus('tool_running', `子任务进度：${event.childRunId}：${event.message}`)
    } else if (event.type === 'child_run_completed') {
      this.publishStatus('tool_done', `子任务完成：${event.child.label}`)
    } else if (event.type === 'child_run_failed') {
      this.publishStatus('tool_done', `子任务失败：${event.child.label}`)
    } else if (event.type === 'child_run_canceled') {
      this.publishStatus('tool_done', `子任务取消：${event.child.label}`)
    } else if (event.type === 'context_compaction_started') {
      this.publishStatus('thinking', `上下文压缩开始：${contextCompactionReasonLabel(event.reason)}`)
    } else if (event.type === 'context_compaction_completed') {
      this.publishStatus('thinking', `上下文压缩完成：约节省 ${Math.max(0, event.replacedTokens - event.summaryTokens)} token`)
    } else if (event.type === 'context_compaction_failed') {
      this.publishStatus('thinking', `上下文压缩失败，已保留原始历史：${event.error}`)
    }
  }

  publishChunk(delta: string, channel: 'answer' | 'reasoning' = 'answer'): void {
    const payload: AgentChatStreamChunk = channel === 'reasoning'
      ? { streamId: this.streamId, delta, channel }
      : { streamId: this.streamId, delta }
    this.record({ kind: 'chunk', payload })
    this.onChunk(payload)
  }

  publishStatus(status: AgentLoopStatus, message?: string): void {
    const payload = pruneUndefined({ streamId: this.streamId, status, message })
    this.record({ kind: 'status', payload })
    this.onStatus(payload)
    if (status === 'done' || status === 'canceled' || status === 'error') {
      this.publishTerminal(status, message)
    }
  }

  publishTool(event: Omit<AgentChatStreamToolEvent, 'streamId'>): void {
    const payload = pruneUndefined({ streamId: this.streamId, ...event })
    this.record({ kind: 'tool', payload })
    this.onTool(payload)
  }

  publishTerminal(
    outcome: Extract<AgentLoopStatus, 'done' | 'canceled' | 'error'>,
    message?: string
  ): void {
    if (this.terminalEvent) return
    const event = this.record({ kind: 'terminal', outcome, message })
    this.terminalEvent = event
  }

  replayAfter(afterSequence = 0): AgentEventBusReplay {
    const requestedAfterSequence = Math.max(0, Math.floor(afterSequence))
    const retainedFromSequence = this.events[0]?.sequence ?? this.sequence + 1
    return {
      streamId: this.streamId,
      available: true,
      requestedAfterSequence,
      fromSequence: Math.max(requestedAfterSequence + 1, retainedFromSequence),
      nextSequence: this.sequence + 1,
      hasGap: requestedAfterSequence + 1 < retainedFromSequence,
      droppedEvents: this.droppedEvents,
      droppedBytes: this.droppedBytes,
      events: this.events
        .filter((event) => event.sequence > requestedAfterSequence)
        .map((event) => ({ ...event }))
    }
  }

  recentReplay(): AgentEventBusReplay {
    return this.replayAfter(0)
  }

  terminal(): AgentRealtimeEvent | null {
    return this.terminalEvent ? { ...this.terminalEvent } : null
  }

  private record(
    event:
      | { kind: 'chunk'; payload: AgentChatStreamChunk }
      | { kind: 'status'; payload: AgentChatStreamStatus }
      | { kind: 'tool'; payload: AgentChatStreamToolEvent }
      | {
          kind: 'terminal'
          outcome: Extract<AgentLoopStatus, 'done' | 'canceled' | 'error'>
          message?: string
        }
  ): AgentRealtimeEvent {
    const stored = pruneUndefined({
      ...event,
      sequence: ++this.sequence,
      streamId: this.streamId,
      createdAt: this.now()
    }) as AgentRealtimeEvent
    const bytes = eventByteSize(stored)
    this.events.push(stored)
    this.replayBytes += bytes
    this.trimReplayWindow()
    this.onRecorded?.({ ...stored })
    this.onRealtimeEvent?.({ ...stored })
    return stored
  }

  private trimReplayWindow(): void {
    while (this.replayBytes > this.maxReplayBytes && this.events.length > 1) {
      const dropped = this.events.shift()
      if (!dropped) break
      const bytes = eventByteSize(dropped)
      this.replayBytes -= bytes
      this.droppedEvents += 1
      this.droppedBytes += bytes
    }
  }
}

export function createAgentEventBus(options: AgentEventBusOptions): AgentEventBus {
  return new AgentEventBus(options)
}

function contextCompactionReasonLabel(reason: string): string {
  if (reason === 'hard_threshold') return '接近硬阈值'
  if (reason === 'soft_threshold') return '接近上下文阈值'
  if (reason === 'manual') return '手动触发'
  return reason
}

function eventByteSize(event: AgentRealtimeEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item
  }
  return out as T
}
