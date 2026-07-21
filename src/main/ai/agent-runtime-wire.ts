/** Stream-safe wire representation for agent runtime lifecycle events. */
export type AgentRuntimeEventKind =
  | 'turn_started'
  | 'tool_call'
  | 'tool_result'
  | 'approval'
  | 'usage'
  | 'compaction_started'
  | 'compaction_completed'
  | 'compaction_failed'
  | 'turn_done'
  | 'status'

export type AgentRuntimeEvent = {
  sequence: number
  streamId: string
  kind: AgentRuntimeEventKind
  createdAt: string
  payload?: Record<string, unknown>
}

export type AgentRuntimeEventInput = Omit<AgentRuntimeEvent, 'sequence' | 'createdAt'> & {
  sequence?: number
  createdAt?: string
}

/** Serialize without exposing mutable references; suitable for IPC/JSON transport. */
export function agentRuntimeEventToWire(event: AgentRuntimeEventInput): AgentRuntimeEvent {
  if (!event.streamId.trim()) throw new Error('Agent runtime event requires streamId.')
  if (!event.kind) throw new Error('Agent runtime event requires kind.')
  const sequence = event.sequence ?? 0
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error('Agent runtime event sequence must be a non-negative integer.')
  const createdAt = event.createdAt ?? new Date().toISOString()
  return JSON.parse(JSON.stringify({ ...event, sequence, createdAt })) as AgentRuntimeEvent
}

export const serializeAgentRuntimeEvent = agentRuntimeEventToWire
export const agentRuntimeEventToWireSerializer = agentRuntimeEventToWire
export const toWire = agentRuntimeEventToWire

export function agentRuntimeEventFromWire(value: unknown): AgentRuntimeEvent {
  if (!value || typeof value !== 'object') throw new Error('Invalid agent runtime event wire value.')
  const event = value as Record<string, unknown>
  if (typeof event.streamId !== 'string' || typeof event.kind !== 'string' || typeof event.createdAt !== 'string' || typeof event.sequence !== 'number') {
    throw new Error('Invalid agent runtime event wire shape.')
  }
  return agentRuntimeEventToWire(event as AgentRuntimeEvent)
}
