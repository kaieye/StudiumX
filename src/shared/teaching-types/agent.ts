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
    providerCalls?: number
    toolCalls: number
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  archive?: AgentArtifactRef
  startedAt?: string
  completedAt?: string
}

export type AgentCompactionMetadata = {
  /** Stable per-source identifier; prevents replay/retry duplicates. */
  id: string
  createdAt: string
  /** Original persisted conversation turns represented by this summary. */
  replacedTurnIds: string[]
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
  runUsage?: AgentRunUsageAggregate
  /** Durable run marker used to settle a pending parent turn without duplicating it after restart. */
  runId?: string
  /** Digest of the saved parent-turn projection associated with `runId`. */
  parentTurnDigest?: string
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
  conversationId?: string
  workspaceId?: string
  mode?: AgentChatMode
  context?: string
  contextCompaction?: AgentChatContextCompactionRequest
  skillIds?: string[]
  /** Stable source turn IDs aligned one-to-one with `messages`; entries without persisted turns use `undefined`. */
  messageTurnIds?: Array<string | undefined>
  messages: AgentChatMessage[]
  userInput: string
}

export type AgentRunBudgetStopReason =
  | 'duration'
  | 'provider_calls'
  | 'tool_calls'
  | 'total_tokens'

/**
 * Where a run's aggregated token usage came from, so the UI and audit layer can
 * distinguish provider-reported figures from local estimates and from the
 * absence of any figure. `unknown` means no usage was reported at all.
 */
export type AgentRunUsageProvenance = 'provider_reported' | 'local_estimate' | 'unknown'

export type AgentRunBudget = {
  maxDurationMs: number
  maxProviderCalls: number
  maxToolCalls: number
  maxTotalTokens: number
  warningThreshold: number
}

export type AgentRunUsageAggregate = {
  providerCalls: number
  toolCalls: number
  toolErrors: number
  iterations: number
  childRuns: number
  durationMs: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  budgetStopReason?: AgentRunBudgetStopReason
  /** Provenance of the token figures above; absent is treated as `unknown`. */
  usageProvenance?: AgentRunUsageProvenance
}

export type AgentProjectionInvalidation = {
  streamId: string
  reason: 'replay_gap' | 'replay_unavailable'
  requestedAfterSequence: number
  fromSequence: number
  nextSequence: number
}

export type AgentParentTurnRecoveryEvidence = {
  sequence: number
  kind:
    | 'status'
    | 'tool_call'
    | 'tool_result'
    | 'permission_wait'
    | 'permission_resolved'
    | 'elicitation_wait'
    | 'elicitation_resolved'
    | 'terminal'
  title: string
  detail?: string
  toolName?: string
  isError?: boolean
  createdAt: string
}

export type InterruptedAgentRun = {
  runId: string
  streamId: string
  workspaceId?: string
  conversationId?: string
  status: 'interrupted'
  previousStatus: 'running' | 'waiting_for_permission' | 'waiting_for_elicitation' | 'awaiting_conversation_save'
  lastDurableSequence: number
  updatedAt: string
  interruptedAt: string
  reason: string
  operationReviewCount: number
  usage: AgentRunUsageAggregate
  /** Redacted, bounded evidence only; it is never promoted to an original conversation turn. */
  userInputPreview?: string
  userInputSha256?: string
  confirmedAssistantPreview?: string
  confirmedAssistantSha256?: string
  confirmedAssistantTruncated?: boolean
  unrecoverableAssistantDeltaBytes?: number
  evidence?: AgentParentTurnRecoveryEvidence[]
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
  availableScopes?: Array<'once' | 'run' | 'directory'>
  directoryScopePath?: string
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
      usage: AgentRunUsageAggregate
      stopReason?: string
    }
  | { streamId: string; canceled: true; usage?: AgentRunUsageAggregate }
  | { streamId: string; error: true; message: string; usage?: AgentRunUsageAggregate }

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
      usage: AgentRunUsageAggregate
      stopReason?: string
    }
  | { canceled: true; usage?: AgentRunUsageAggregate }
  | { error: true; message: string; usage?: AgentRunUsageAggregate }

export type AgentConversationRecord = AgentConversationSummary & {
  turns: AgentChatTurn[]
}

export type SaveAgentConversationPayload = {
  workspaceId: string
  /** Main-process stream/run capability used only to promote staged child transcript artifacts. */
  runId?: string
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

export type AgentConversationStorageScope = 'workspace' | 'temporary' | 'all'

/** A durable conversation-history checkpoint. This is intentionally distinct from AgentRunCheckpoint. */
export type AgentConversationCheckpoint = {
  schemaVersion: 1
  checkpointId: string
  conversationId: string
  conversationRelativePath: string
  label?: string
  reason?: string
  createdAt: string
  headTurnId?: string
  turnCount: number
  sourceDigest: string
  artifacts: AgentArtifactRef[]
  integritySha256: string
}

export type CreateAgentConversationCheckpointPayload = {
  workspaceId: string
  conversationId: string
  label?: string
  reason?: string
}

export type ResolveAgentConversationCheckpointPayload = {
  workspaceId: string
  conversationId: string
  checkpointId: string
}

export type ResolveAgentConversationCheckpointResult = {
  checkpoint: AgentConversationCheckpoint
  turns: AgentChatTurn[]
  toolsReplayed: false
  artifactsHydrated: false
}

export type AgentArchivedHistoryItemType =
  | 'conversation_turn'
  | 'session_sidecar'
  | 'tool_result'
  | 'child_transcript'
  | 'checkpoint'

export type AgentArchivedHistoryIntegrity =
  | 'verified'
  | 'missing'
  | 'hash_mismatch'
  | 'not_applicable'

export type AgentArchivedHistoryItem = {
  reference: string
  type: AgentArchivedHistoryItemType
  conversationId: string
  conversationRelativePath: string
  timestamp: string
  summary: string
  sourceRelativePath: string
  turnId?: string
  artifact?: AgentArtifactRef
  checkpointIds?: string[]
  bytes: number
  integrity: AgentArchivedHistoryIntegrity
}

export type AgentArchivedHistoryIssue = {
  code: string
  message: string
  reference?: string
}

export type QueryAgentArchivedHistoryPayload = {
  workspaceId: string
  scope?: AgentConversationStorageScope
  conversationId?: string
  from?: string
  to?: string
  types?: AgentArchivedHistoryItemType[]
  checkpointId?: string
  limit?: number
  maxBytes?: number
  maxExcerptBytes?: number
}

export type QueryAgentArchivedHistoryResult = {
  items: AgentArchivedHistoryItem[]
  truncated: boolean
  usage: {
    items: number
    bytes: number
    limit: number
    maxBytes: number
    maxExcerptBytes: number
  }
  issues: AgentArchivedHistoryIssue[]
  providerInjection: 'none'
  memoryWrite: 'none'
}

export type RebuildAgentHistoryIndexPayload = {
  workspaceId: string
  scope?: AgentConversationStorageScope
}

export type RebuildAgentHistoryIndexResult = {
  scopes: Array<{
    scope: Exclude<AgentConversationStorageScope, 'all'>
    entries: number
    issues: AgentArchivedHistoryIssue[]
    indexRelativePath: string
  }>
}

export type CleanupAgentArtifactsPayload = {
  workspaceId: string
  scope?: AgentConversationStorageScope
  dryRun?: boolean
  retentionDays?: number
  graceHours?: number
  maxTotalBytes?: number
}

export type AgentArtifactCleanupAction = {
  relativePath: string
  kind: 'tool_result' | 'child_transcript' | 'parent_turn_staging' | 'unknown'
  bytes: number
  sha256?: string
  reason: 'expired_orphan' | 'over_budget' | 'duplicate' | 'protected_reference' | 'protected_active_scope'
  action: 'delete' | 'retain' | 'report_duplicate'
}

export type AgentArtifactCleanupIssue = {
  code: string
  message: string
  relativePath?: string
}

export type CleanupAgentArtifactsResult = {
  dryRun: boolean
  scanned: number
  scannedBytes: number
  deleted: number
  deletedBytes: number
  retained: number
  duplicateGroups: number
  actions: AgentArtifactCleanupAction[]
  issues: AgentArtifactCleanupIssue[]
  auditRelativePaths: string[]
}
