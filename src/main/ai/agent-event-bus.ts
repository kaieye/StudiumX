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
import {
  mapAgentLoopEventToPresentation,
  wrapPresentationCallbacks,
  type AgentStreamPresentationDiagnostic
} from './agent-stream-events'

export type AgentEventBusOptions = {
  streamId: string
  maxReplayBytes?: number
  now?: () => string
  onChunk: (chunk: AgentChatStreamChunk) => void
  onStatus: (status: AgentChatStreamStatus) => void
  onTool: (event: AgentChatStreamToolEvent) => void
  onRealtimeEvent?: (event: AgentRealtimeEvent) => void
  onRecorded?: (event: AgentRealtimeEvent) => void
  /**
   * Local-only presentation diagnostic (B-06). Never remote telemetry.
   * Presentation callback throws are swallowed after this hook runs.
   */
  onPresentationError?: (diagnostic: AgentStreamPresentationDiagnostic) => void
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
    // B-06: isolate presentation callbacks so UI/IPC throws never re-enter the agent loop.
    const safe = wrapPresentationCallbacks({
      onChunk: options.onChunk,
      onStatus: options.onStatus,
      onTool: options.onTool,
      onRealtimeEvent: options.onRealtimeEvent,
      onRecorded: options.onRecorded,
      onPresentationError: options.onPresentationError
    })
    this.onChunk = safe.onChunk
    this.onStatus = safe.onStatus
    this.onTool = safe.onTool
    this.onRealtimeEvent = safe.onRealtimeEvent
    this.onRecorded = safe.onRecorded
  }

  publishLoopEvent(event: AgentLoopEvent): void {
    for (const action of mapAgentLoopEventToPresentation(this.streamId, event)) {
      if (action.kind === 'status') {
        this.publishStatus(action.status, action.message)
      } else if (action.kind === 'chunk') {
        this.publishChunk(action.delta, action.channel)
      } else {
        this.publishTool(action.event)
      }
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
