import type { TeachingMemoryCaptureResult } from './memory'
import type { LessonSummary, TeachingAppState } from './workspace'

export type AgentChatMode = 'temporary' | 'teaching'

export type AgentConversationSummary = {
  id: string
  workspaceId?: string
  title: string
  createdAt: string
  updatedAt: string
  relativePath: string
  absolutePath: string
  messageCount: number
  pinned?: boolean
}

export type AgentChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type AgentChatToolCall = {
  id: string
  name: string
  arguments: string
}

export type AgentChatMessage = {
  role: AgentChatRole
  content: string | null
  toolCalls?: AgentChatToolCall[]
  toolCallId?: string
}

export type AgentChatToolCallView = {
  id: string
  name: string
  arguments: string
  result?: string
  isError?: boolean
}

export type AgentChatProcessEvent = {
  id: string
  kind: 'status' | 'tool_call' | 'tool_result'
  title: string
  detail?: string
  status?: AgentLoopStatus
  toolCallId?: string
  toolName?: string
  isError?: boolean
  createdAt: string
}

export type AgentChatTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: AgentChatToolCallView[]
  processEvents?: AgentChatProcessEvent[]
  createdAt: string
}

export type AgentLoopStatus =
  | 'thinking'
  | 'tool_running'
  | 'tool_done'
  | 'answering'
  | 'done'
  | 'canceled'
  | 'error'

export type AgentChatStreamPayload = {
  streamId?: string
  workspaceId?: string
  mode?: AgentChatMode
  messages: AgentChatMessage[]
  userInput: string
}

export type AgentChatStreamChunk = {
  streamId: string
  delta: string
}

export type AgentChatStreamStatus = {
  streamId: string
  status: AgentLoopStatus
  message?: string
}

export type AgentChatStreamToolEvent = {
  streamId: string
  toolCall: { id: string; name: string; arguments: string }
  result?: string
  isError?: boolean
}

export type AgentChatStreamDone =
  | {
      streamId: string
      turns: AgentChatTurn[]
      finalText: string
      iterations: number
      toolsSupported: boolean
      degradedReason?: string
      generatedLessons?: LessonSummary[]
      memoryCapture?: TeachingMemoryCaptureResult
    }
  | { streamId: string; canceled: true }
  | { streamId: string; error: true; message: string }

/** The non-streamId portion of {@link AgentChatStreamDone}, as a clean
 *  discriminated union (avoids Omit-over-union narrowing quirks). */
export type AgentChatStreamResult =
  | {
      turns: AgentChatTurn[]
      finalText: string
      iterations: number
      toolsSupported: boolean
      degradedReason?: string
      generatedLessons?: LessonSummary[]
      memoryCapture?: TeachingMemoryCaptureResult
    }
  | { canceled: true }
  | { error: true; message: string }

export type AgentConversationRecord = AgentConversationSummary & {
  turns: AgentChatTurn[]
}

export type SaveAgentConversationPayload = {
  workspaceId: string
  mode?: AgentChatMode
  conversationId?: string | null
  selectedLessonPath?: string | null
  selectedCourseRelativePath?: string | null
  courseName?: string
  turns: AgentChatTurn[]
}

export type SaveAgentConversationResult = {
  state: TeachingAppState
  conversation: AgentConversationSummary
}

export type ReadAgentConversationPayload = {
  workspaceId: string
  conversationId: string
}
