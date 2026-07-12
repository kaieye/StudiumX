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

export type AgentSourceMetadata = {
  sourceId: string
  url: string
  title?: string
  snippet?: string
  provider?: string
  retrievedAt?: string
  publishedAt?: string
  toolCallId?: string
  toolName?: string
}

export type AgentChildRunMetadata = {
  childRunId: string
  label: string
  profile: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
  summary?: string
  error?: string
  filesRead?: string[]
  citations?: Array<{ sourceId: string; url: string; title?: string }>
  usage?: {
    toolCalls: number
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  startedAt?: string
  completedAt?: string
}

export type AgentCompactionMetadata = {
  sourceDigest: string
  reason: string
  mode: string
  beforeTokens?: number
  afterTokens?: number
  replacedTokens?: number
  summaryTokens?: number
  replacedMessages?: number
  tailMessages?: number
  cached?: boolean
  failed?: boolean
  error?: string
}

export type AgentContextHygieneMetadata = {
  changed: boolean
  savedTokens: number
  compactedToolResults: number
  digestedToolResults: number
  compactedToolCallArgs: number
}

export type AgentContextEstimateMetadata = {
  messageTokens: number
  overheadTokens: number
  totalTokens: number
  source: string
}

export type AgentArtifactRef = {
  kind: 'tool_result' | 'child_transcript'
  relativePath: string
  sha256: string
  bytes: number
  lines?: number
  preview?: string
  archivedAt?: string
}

export type AgentToolResultDiagnostic = {
  toolCallId: string
  toolName: string
  bytes: number
  lines: number
  approxTokens?: number
  isError?: boolean
  archive?: AgentArtifactRef
}

export type AgentTurnMetadata = {
  version: 1
  sources?: AgentSourceMetadata[]
  childRuns?: AgentChildRunMetadata[]
  compactions?: AgentCompactionMetadata[]
  contextHygiene?: AgentContextHygieneMetadata[]
  contextEstimate?: AgentContextEstimateMetadata
  toolResults?: AgentToolResultDiagnostic[]
}

export type AgentChatProcessEvent = {
  id: string
  kind:
    | 'status'
    | 'tool_call'
    | 'tool_result'
    | 'permission_request'
    | 'permission_resolved'
    | 'elicitation_request'
    | 'elicitation_resolved'
    | 'child_run_queued'
    | 'child_run_started'
    | 'child_run_delta'
    | 'child_run_completed'
    | 'child_run_failed'
    | 'child_run_canceled'
    | 'compaction'
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
  metadata?: AgentTurnMetadata
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
  context?: string
  contextCompaction?: AgentChatContextCompactionRequest
  skillIds?: string[]
  messages: AgentChatMessage[]
  userInput: string
}

export type AgentChatContextCompactionRequest = {
  force?: boolean
  enabled?: boolean
  contextWindowTokens?: number
  softThresholdTokens?: number
  hardThresholdTokens?: number
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

export type AgentToolPermissionRequest = {
  id: string
  kind: 'workspace_write' | 'workspace_read' | 'external_network'
  toolName: string
  operation: string
  targetPath?: string
  reason?: string
  creates?: boolean
}

export type AgentChatStreamToolEvent = {
  streamId: string
  toolCall: { id: string; name: string; arguments: string }
  result?: string
  isError?: boolean
  permissionRequest?: AgentToolPermissionRequest
}

export type AgentRealtimeEvent =
  | {
      sequence: number
      streamId: string
      kind: 'chunk'
      createdAt: string
      payload: AgentChatStreamChunk
    }
  | {
      sequence: number
      streamId: string
      kind: 'status'
      createdAt: string
      payload: AgentChatStreamStatus
    }
  | {
      sequence: number
      streamId: string
      kind: 'tool'
      createdAt: string
      payload: AgentChatStreamToolEvent
    }
  | {
      sequence: number
      streamId: string
      kind: 'terminal'
      createdAt: string
      outcome: Extract<AgentLoopStatus, 'done' | 'canceled' | 'error'>
      message?: string
    }

export type AgentEventBusReplay = {
  streamId: string
  available: boolean
  requestedAfterSequence: number
  fromSequence: number
  nextSequence: number
  hasGap: boolean
  droppedEvents: number
  droppedBytes: number
  events: AgentRealtimeEvent[]
}

export type ReplayAgentChatEventsPayload = {
  streamId: string
  afterSequence?: number
}

export type AskOption = {
  label: string
  description?: string
}

export type AskQuestion = {
  id: string
  header?: string
  prompt: string
  multiSelect?: boolean
  options: AskOption[]
}

export type AskAnswer = {
  questionId: string
  selected: string[]
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
