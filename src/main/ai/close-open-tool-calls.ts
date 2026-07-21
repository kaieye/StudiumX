/**
 * Cancel / early-stop middleware: close unpaired tool_calls in a chat transcript
 * with synthetic tool results so provider history stays pair-closed (B-12).
 *
 * Does not invent assistant tool_calls; only fills missing tool results for ids
 * already present on assistant messages.
 */

import type { ChatMessage, ToolCall } from './provider-adapter'
import { TOOL_CANCELED_MESSAGE } from './tools/tool-arguments'

export type CloseOpenToolCallsResult = {
  messages: ChatMessage[]
  closed: Array<{ toolCallId: string; name: string }>
}

function canceledToolContent(): string {
  return JSON.stringify({
    error: 'tool_canceled',
    message: TOOL_CANCELED_MESSAGE
  })
}

/**
 * For every assistant tool_call id without a matching tool message, append a
 * synthetic tool result using TOOL_CANCELED_MESSAGE (stable closed copy).
 */
export function closeOpenToolCalls(
  messages: readonly ChatMessage[],
  options?: { content?: string }
): CloseOpenToolCallsResult {
  const content = options?.content ?? canceledToolContent()
  const paired = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool' && message.tool_call_id) {
      paired.add(message.tool_call_id)
    }
  }

  const closed: Array<{ toolCallId: string; name: string }> = []
  const additions: ChatMessage[] = []

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue
    for (const call of message.tool_calls) {
      if (!call.id || paired.has(call.id)) continue
      paired.add(call.id)
      closed.push({ toolCallId: call.id, name: call.function.name })
      additions.push({
        role: 'tool',
        tool_call_id: call.id,
        content
      })
    }
  }

  if (additions.length === 0) {
    return { messages: [...messages], closed: [] }
  }
  return { messages: [...messages, ...additions], closed }
}

/**
 * Collect open (unpaired) tool calls from the transcript without mutating it.
 */
export function listOpenToolCalls(messages: readonly ChatMessage[]): ToolCall[] {
  const paired = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool' && message.tool_call_id) {
      paired.add(message.tool_call_id)
    }
  }
  const open: ToolCall[] = []
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue
    for (const call of message.tool_calls) {
      if (call.id && !paired.has(call.id)) open.push(call)
    }
  }
  return open
}
