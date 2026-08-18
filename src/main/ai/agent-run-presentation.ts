import { agentConversationToolDisplayName } from '../../shared/agent-conversation-tool-label'
import {
  appendAgentPresentationProcess,
  appendAgentPresentationText,
  sanitizeAgentPresentationText,
  sanitizeAgentPresentationTimeline,
} from '../../shared/agent-conversation-turns'
import type {
  AgentChatPresentationTimelineEntry,
  AgentChatProcessEvent,
  AgentChatTurn,
  AgentLoopStatus
} from '../../shared/teaching-types'
import type { AgentLoopEvent } from './agent-loop'

/**
 * Renderer-safe ordering projection for one completed agent run.
 *
 * This is intentionally a presentation transcript only: it does not become
 * teaching evidence, settlement data, a provider transcript, or an executable
 * tool replay record. In particular, tool arguments/results and loop-internal
 * payloads never enter this projection.
 */
export type AgentRunPresentation = {
  processEvents?: AgentChatProcessEvent[]
  presentationTimeline?: AgentChatPresentationTimelineEntry[]
}

export type AgentRunPresentationOptions = {
  /** Used only to make generated process ids unambiguous inside a turn. */
  streamId?: string
  now?: () => string
}

/**
 * Build the durable, learner-safe ordered flow from the event stream. Adjacent
 * reasoning/token deltas stay in one row/block; a text/tool/reasoning boundary
 * creates a new stable entry, matching the reference conversation behaviour.
 */
export function buildAgentRunPresentation(
  events: readonly AgentLoopEvent[],
  options: AgentRunPresentationOptions = {}
): AgentRunPresentation {
  let processEvents: AgentChatProcessEvent[] = []
  let timeline: AgentChatPresentationTimelineEntry[] | undefined
  const now = options.now ?? (() => new Date().toISOString())
  const idPrefix = safeIdentifierPart(options.streamId) || 'run'
  let processOrdinal = 0
  const toolProcessIds = new Map<string, string>()

  const createProcessId = (kind: string): string => {
    processOrdinal += 1
    return `presentation:${idPrefix}:${kind}:${processOrdinal}`
  }
  const addProcess = (event: AgentChatProcessEvent): void => {
    processEvents = [...processEvents, event]
  }
  const updateProcess = (id: string, update: (event: AgentChatProcessEvent) => AgentChatProcessEvent): void => {
    processEvents = processEvents.map((event) => event.id === id ? update(event) : event)
  }
  const processById = (id: string): AgentChatProcessEvent | undefined => processEvents.find((event) => event.id === id)
  const appendProcess = (processEventId: string, createdAt: string): void => {
    timeline = appendAgentPresentationProcess(
      timeline,
      processEventId,
      createdAt,
      `presentation-ref:${processEventId}`
    )
  }

  for (const event of events) {
    const createdAt = now()
    if (event.type === 'reasoning') {
      const detail = safeVisibleText(event.delta)
      if (!detail) continue
      const previous = timeline?.[timeline.length - 1]
      const previousProcess = previous?.kind === 'process'
        ? processById(previous.processEventId)
        : undefined
      if (previousProcess?.kind === 'reasoning') {
        const combined = safeVisibleText(`${previousProcess.detail ?? ''}${detail}`)
        // Deltas can split a provider diagnostic marker. Preserve the prior
        // already-safe summary rather than joining it into an unsafe Think row.
        if (!combined) continue
        updateProcess(previousProcess.id, (current) => ({
          ...current,
          detail: combined,
          status: 'thinking'
        }))
        continue
      }
      const id = createProcessId('reasoning')
      addProcess({
        id,
        kind: 'reasoning',
        title: 'Think',
        detail,
        status: 'thinking',
        createdAt
      })
      appendProcess(id, createdAt)
      continue
    }

    if (event.type === 'token') {
      const content = safeVisibleText(event.delta)
      if (!content) continue
      timeline = appendAgentPresentationText(
        timeline,
        content,
        createdAt,
        createProcessId('text')
      )
      continue
    }

    if (event.type === 'tool_call') {
      const toolCallId = normalizedToolCallId(event.toolCall.id, processOrdinal)
      const toolName = safeToolName(event.toolCall.function.name)
      const existingId = toolProcessIds.get(toolCallId)
      if (existingId) {
        updateProcess(existingId, (current) => ({
          ...current,
          title: agentConversationToolDisplayName(toolName),
          toolName,
          status: 'tool_running'
        }))
        continue
      }
      const id = createProcessId('tool')
      toolProcessIds.set(toolCallId, id)
      addProcess({
        id,
        kind: 'tool_call',
        title: agentConversationToolDisplayName(toolName),
        status: 'tool_running',
        toolCallId,
        toolName,
        createdAt
      })
      appendProcess(id, createdAt)
      continue
    }

    if (event.type === 'tool_result') {
      const toolCallId = normalizedToolCallId(event.toolCallId, processOrdinal)
      const toolName = safeToolName(event.name)
      const existingId = toolProcessIds.get(toolCallId)
      if (existingId) {
        updateProcess(existingId, (current) => ({
          ...current,
          title: agentConversationToolDisplayName(current.toolName ?? toolName),
          toolName: current.toolName ?? toolName,
          status: 'tool_done',
          isError: event.isError
        }))
        continue
      }

      // A malformed/incomplete event stream may omit the call event. Preserve a
      // single safe tool row rather than storing an unpaired result payload.
      const id = createProcessId('tool')
      toolProcessIds.set(toolCallId, id)
      addProcess({
        id,
        kind: 'tool_call',
        title: agentConversationToolDisplayName(toolName),
        status: 'tool_done',
        toolCallId,
        toolName,
        isError: event.isError,
        createdAt
      })
      appendProcess(id, createdAt)
      continue
    }

    if (event.type === 'status' && shouldProjectTerminalStatus(event.status)) {
      const id = createProcessId('status')
      addProcess({
        id,
        kind: 'status',
        title: terminalStatusTitle(event.status),
        status: event.status,
        isError: event.status === 'error',
        createdAt
      })
      appendProcess(id, createdAt)
    }
  }

  const normalizedTimeline = sanitizeAgentPresentationTimeline(timeline)
  return {
    ...(processEvents.length > 0 ? { processEvents } : {}),
    ...(normalizedTimeline?.length ? { presentationTimeline: normalizedTimeline } : {})
  }
}

/**
 * Attaches the run projection to the final assistant turn without changing the
 * agent-loop, teaching ledger, settlement path, or tool replay semantics.
 */
export function attachAgentConversationRuntimeTimeline(
  turns: AgentChatTurn[],
  events: readonly AgentLoopEvent[],
  options: AgentRunPresentationOptions = {}
): AgentChatTurn[] {
  if (!events.length) return turns
  const assistantIndex = findLastAssistantTurnIndex(turns)
  if (assistantIndex < 0) return turns

  const target = turns[assistantIndex]
  if (!target) return turns
  const projected = buildAgentRunPresentation(events, options)
  if (!projected.processEvents?.length && !projected.presentationTimeline?.length) return turns

  const processEvents = mergeProcessEvents(target.processEvents, projected.processEvents)
  const timeline = sanitizeAgentPresentationTimeline([
    ...(target.presentationTimeline ?? []),
    ...appendProjectedTimelineAfter(target.presentationTimeline, projected.presentationTimeline)
  ])
  const next = turns.slice()
  next[assistantIndex] = {
    ...target,
    ...(processEvents.length ? { processEvents } : {}),
    ...(timeline?.length ? { presentationTimeline: timeline } : {})
  }
  return next
}

function appendProjectedTimelineAfter(
  existing: readonly AgentChatPresentationTimelineEntry[] | undefined,
  projected: readonly AgentChatPresentationTimelineEntry[] | undefined
): AgentChatPresentationTimelineEntry[] {
  if (!projected?.length) return []
  const nextSequence = existing?.reduce((max, entry) =>
    Number.isSafeInteger(entry.sequence) && entry.sequence >= max ? entry.sequence + 1 : max,
  0) ?? 0
  return projected.map((entry, index) => ({ ...entry, sequence: nextSequence + index }))
}

function findLastAssistantTurnIndex(turns: readonly AgentChatTurn[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.role === 'assistant') return index
  }
  return -1
}

function mergeProcessEvents(
  existing: readonly AgentChatProcessEvent[] | undefined,
  projected: readonly AgentChatProcessEvent[] | undefined
): AgentChatProcessEvent[] {
  const merged: AgentChatProcessEvent[] = []
  const indexById = new Map<string, number>()
  for (const event of [...(existing ?? []), ...(projected ?? [])]) {
    const index = indexById.get(event.id)
    if (index === undefined) {
      indexById.set(event.id, merged.length)
      merged.push(event)
      continue
    }
    const prior = merged[index]
    merged[index] = {
      ...prior,
      ...event,
      title: event.title || prior.title,
      detail: event.detail ?? prior.detail,
      toolCallId: event.toolCallId ?? prior.toolCallId,
      toolName: event.toolName ?? prior.toolName,
      createdAt: prior.createdAt || event.createdAt
    }
  }
  return merged
}

function safeVisibleText(value: string | null | undefined): string {
  return sanitizeAgentPresentationText(value)
}

function safeIdentifierPart(value: string | undefined): string {
  const candidate = value?.trim() ?? ''
  return /^[A-Za-z0-9_.-]+$/.test(candidate) ? candidate.slice(0, 120) : ''
}

function normalizedToolCallId(value: string | undefined, ordinal: number): string {
  const candidate = value?.trim() ?? ''
  // Tool call ids are opaque linkage values only and are never rendered. Keep a
  // compact safe fallback when a malformed provider event gives us no id.
  return candidate && candidate.length <= 512 ? candidate : `tool-${ordinal + 1}`
}

function safeToolName(value: string | undefined): string {
  const candidate = value?.trim() ?? ''
  return /^[A-Za-z0-9_.-]+$/.test(candidate) ? candidate : 'tool'
}

function shouldProjectTerminalStatus(status: AgentLoopStatus): boolean {
  return status === 'canceled' ||
    status === 'error' ||
    status === 'resource_limit' ||
    status === 'suspended' ||
    status === 'no_progress' ||
    status === 'context_unrecoverable' ||
    status === 'retry_exhausted'
}

function terminalStatusTitle(status: AgentLoopStatus): string {
  switch (status) {
    case 'canceled': return '已取消'
    case 'resource_limit': return '已达到资源边界'
    case 'suspended': return '运行已暂停'
    case 'no_progress': return '未检测到安全进展'
    case 'context_unrecoverable': return '上下文无法继续'
    case 'retry_exhausted': return '重试已结束'
    case 'error': return '运行出现问题'
    default: return '运行状态'
  }
}
