import type { AgentChatProcessEvent, AgentChatTurn } from '../../shared/teaching-types'

type AgentProcessToolCall = NonNullable<AgentChatTurn['toolCalls']>[number]

export type AgentProcessTimelineItem =
  | {
      kind: 'event'
      event: AgentChatProcessEvent
      toolCall?: AgentProcessToolCall
    }
  | {
      kind: 'tool_call'
      toolCall: AgentProcessToolCall
    }

export function buildAgentProcessTimeline(turn: AgentChatTurn): AgentProcessTimelineItem[] {
  const events = turn.processEvents ?? []
  const toolCalls = turn.toolCalls ?? []
  const toolCallsById = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall]))
  const eventToolIds = new Set(events.map((event) => event.toolCallId).filter((id): id is string => Boolean(id)))
  const timeline: AgentProcessTimelineItem[] = events.map((event) => ({
    kind: 'event',
    event,
    toolCall: event.toolCallId ? toolCallsById.get(event.toolCallId) : undefined
  }))

  for (const toolCall of toolCalls) {
    if (!eventToolIds.has(toolCall.id)) {
      timeline.push({ kind: 'tool_call', toolCall })
    }
  }

  return timeline
}
