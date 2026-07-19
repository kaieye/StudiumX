/**
 * Per-turn teaching event bus.
 *
 * Architecture mirrors AgentEventBus (monotonic sequence, bounded replay, sticky
 * terminal) but is deliberately uncoupled: no agent stream state, no durable
 * authority claims, and no fork/agent-run semantics.
 *
 * Lifecycle:
 * - One sticky terminal per turnId; after terminal, all further publishes are rejected.
 * - Listener exceptions are isolated so one subscriber cannot break the stream.
 * - Reentrant publish (publish from a listener) is rejected deterministically.
 */

import { Buffer } from 'node:buffer'

import {
  createTeachingEvent,
  isTeachingTurnTerminalPayload,
  type TeachingEventEnvelope,
  type TeachingEventAuthoringInput,
  type TeachingTurnTerminalPayload,
  type TeachingTurnTerminalReasonCode
} from '../shared/teaching-events'

export type TeachingTurnEventListener = (event: TeachingEventEnvelope) => void

export type TeachingTurnEventBusOptions = {
  /** Workspace scope — buses must never mix workspaces for the same turnId. */
  workspaceId: string
  turnId: string
  maxReplayBytes?: number
  now?: () => string
}

export type TeachingTurnEventBusReplay = {
  turnId: string
  available: true
  requestedAfterSequence: number
  fromSequence: number
  nextSequence: number
  hasGap: boolean
  droppedEvents: number
  droppedBytes: number
  events: TeachingEventEnvelope[]
  terminal: TeachingEventEnvelope | null
}

export class TeachingTurnEventBusClosedError extends Error {
  readonly code = 'turn_bus_closed' as const
  constructor(message = 'Teaching turn event bus rejects publish after terminal.') {
    super(message)
    this.name = 'TeachingTurnEventBusClosedError'
  }
}

export class TeachingTurnEventBusReentrancyError extends Error {
  readonly code = 'turn_bus_reentrant' as const
  constructor(message = 'Teaching turn event bus rejects reentrant publish.') {
    super(message)
    this.name = 'TeachingTurnEventBusReentrancyError'
  }
}

const DEFAULT_MAX_REPLAY_BYTES = 64 * 1024

export class TeachingTurnEventBus {
  private readonly workspaceId: string
  private readonly turnId: string
  private readonly maxReplayBytes: number
  private readonly now: () => string
  private readonly listeners = new Set<TeachingTurnEventListener>()
  private events: TeachingEventEnvelope[] = []
  private replayBytes = 0
  private sequence = 0
  private droppedEvents = 0
  private droppedBytes = 0
  private terminalEvent: TeachingEventEnvelope | null = null
  private publishing = false

  constructor(options: TeachingTurnEventBusOptions) {
    if (typeof options.workspaceId !== 'string' || !options.workspaceId.trim()) {
      throw new Error('Teaching turn event bus requires a workspaceId.')
    }
    if (!options.turnId.trim()) throw new Error('Teaching turn event bus requires a turnId.')
    this.workspaceId = options.workspaceId
    this.turnId = options.turnId
    this.maxReplayBytes = Math.max(1024, Math.floor(options.maxReplayBytes ?? DEFAULT_MAX_REPLAY_BYTES))
    this.now = options.now ?? (() => new Date().toISOString())
  }

  getWorkspaceId(): string {
    return this.workspaceId
  }

  getTurnId(): string {
    return this.turnId
  }

  subscribe(listener: TeachingTurnEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Publish a validated teaching event. Sequence is assigned here and is only a
   * turn-stream ordering token — never a durable ledger sequence authority.
   *
   * After a sticky turn_terminal is recorded, every subsequent publish is rejected
   * (including additional terminals). Reentrant publish is rejected deterministically.
   */
  publish(input: Omit<TeachingEventAuthoringInput, 'sequence'> & { turnId?: string }): TeachingEventEnvelope {
    if (this.publishing) {
      throw new TeachingTurnEventBusReentrancyError()
    }
    if (this.terminalEvent) {
      throw new TeachingTurnEventBusClosedError()
    }
    if (input.turnId !== undefined && input.turnId !== this.turnId) {
      throw new Error('Teaching turn event bus rejects cross-turn publish.')
    }
    if (input.workspaceId !== this.workspaceId) {
      throw new Error('Teaching turn event bus rejects cross-workspace publish.')
    }

    this.publishing = true
    try {
      const draft = createTeachingEvent({
        ...input,
        workspaceId: this.workspaceId,
        turnId: this.turnId,
        occurredAt: input.occurredAt || this.now()
      })

      const stored: TeachingEventEnvelope = {
        ...draft,
        sequence: ++this.sequence
      }

      if (isTeachingTurnTerminalPayload(stored.payload)) {
        this.terminalEvent = stored
      }

      this.events.push(stored)
      this.replayBytes += eventByteSize(stored)
      this.trimReplayWindow()

      for (const listener of [...this.listeners]) {
        try {
          listener({ ...stored, payload: clonePayload(stored.payload) })
        } catch {
          // Isolate subscriber failures: one bad listener must not break the bus.
        }
      }

      return { ...stored, payload: clonePayload(stored.payload) }
    } finally {
      this.publishing = false
    }
  }

  publishTerminal(
    input: Omit<TeachingEventAuthoringInput, 'sequence' | 'payload' | 'durability'> & {
      durability?: TeachingEventAuthoringInput['durability']
      outcome: TeachingTurnTerminalPayload['outcome']
      reasonCode?: TeachingTurnTerminalReasonCode
      message?: string
    }
  ): TeachingEventEnvelope {
    return this.publish({
      durability: input.durability ?? 'ephemeral',
      occurredAt: input.occurredAt,
      workspaceId: this.workspaceId,
      sessionId: input.sessionId,
      turnId: this.turnId,
      eventId: input.eventId,
      itemId: input.itemId,
      operationId: input.operationId,
      payload: {
        type: 'turn_terminal',
        outcome: input.outcome,
        ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
        ...(input.message !== undefined ? { message: input.message } : {})
      }
    })
  }

  replayAfter(afterSequence = 0): TeachingTurnEventBusReplay {
    const requestedAfterSequence = Math.max(0, Math.floor(afterSequence))
    const retainedFromSequence = this.events[0]?.sequence ?? this.sequence + 1
    return {
      turnId: this.turnId,
      available: true,
      requestedAfterSequence,
      fromSequence: Math.max(requestedAfterSequence + 1, retainedFromSequence),
      nextSequence: this.sequence + 1,
      hasGap: requestedAfterSequence + 1 < retainedFromSequence,
      droppedEvents: this.droppedEvents,
      droppedBytes: this.droppedBytes,
      events: this.events
        .filter((event) => (event.sequence ?? 0) > requestedAfterSequence)
        .map((event) => ({ ...event, payload: clonePayload(event.payload) })),
      terminal: this.terminalEvent
        ? { ...this.terminalEvent, payload: clonePayload(this.terminalEvent.payload) }
        : null
    }
  }

  recentReplay(): TeachingTurnEventBusReplay {
    return this.replayAfter(0)
  }

  terminal(): TeachingEventEnvelope | null {
    return this.terminalEvent
      ? { ...this.terminalEvent, payload: clonePayload(this.terminalEvent.payload) }
      : null
  }

  isClosed(): boolean {
    return this.terminalEvent !== null
  }

  currentSequence(): number {
    return this.sequence
  }

  private trimReplayWindow(): void {
    while (this.replayBytes > this.maxReplayBytes && this.events.length > 1) {
      // Prefer keeping the sticky terminal when it would otherwise be the sole retained event.
      const dropIndex = this.events.length > 1 && this.events[0] === this.terminalEvent ? 1 : 0
      if (dropIndex >= this.events.length) break
      const [dropped] = this.events.splice(dropIndex, 1)
      if (!dropped) break
      const bytes = eventByteSize(dropped)
      this.replayBytes -= bytes
      this.droppedEvents += 1
      this.droppedBytes += bytes
    }
  }
}

export function createTeachingTurnEventBus(options: TeachingTurnEventBusOptions): TeachingTurnEventBus {
  return new TeachingTurnEventBus(options)
}

function eventByteSize(event: TeachingEventEnvelope): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

function clonePayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload)) as T
}
