import type { TeachingMemoryCaptureResult } from './memory'
import type { LessonSummary, TeachingAppState } from './workspace'

export type AgentChatMode = 'temporary' | 'teaching'
export type AgentConversationLookupScope = 'workspace' | 'temporary'

export type AgentConversationBranchStatus = 'active' | 'archived' | 'deleted'

export type AgentConversationForkPoint = {
  sourceConversationId: string
  sourceBranchId: string
  sourceTurnId?: string
  sourceTurnCount: number
  sourceDigest: string
}

export type AgentConversationReplaySource = {
  replayId: string
  sourceConversationId: string
  sourceBranchId: string
  sourceTurnCount: number
  sourceDigest: string
  createdAt: string
  toolsReplayed: false
  archivedRetrievalPromoted: false
  providerHistoryInjected: false
  memoryWritten: false
}

export type AgentConversationBranchMetadata = {
  schemaVersion: 1
  sessionId: string
  branchId: string
  revision: number
  status: AgentConversationBranchStatus
  parentBranchId?: string
  forkPoint?: AgentConversationForkPoint
  replaySource?: AgentConversationReplaySource
}

export type AgentConversationBranchHead = {
  turnId?: string
  turnCount: number
  updatedAt: string
}

export type AgentConversationSessionTreeNode = {
  sessionId: string
  branchId: string
  conversationId: string
  title: string
  status: AgentConversationBranchStatus
  revision: number
  parentBranchId?: string
  forkPoint?: AgentConversationForkPoint
  replaySource?: AgentConversationReplaySource
  head: AgentConversationBranchHead
  relativePath: string
  isOpen: boolean
}

export type AgentConversationSessionTree = {
  schemaVersion: 1
  sessionId: string
  openBranchId: string
  branches: AgentConversationSessionTreeNode[]
}

/** Compatibility aliases for callers that use the shorter tree vocabulary. */
export type AgentConversationTreeHead = AgentConversationBranchHead
export type AgentConversationTreeNode = AgentConversationSessionTreeNode
export type AgentConversationTree = AgentConversationSessionTree

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
  branch?: AgentConversationBranchMetadata
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

export type AgentPersistedParentTurnProof = {
  schemaVersion: 1
  algorithm: 'sha256'
  digest: string
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
  /**
   * Legacy raw parent digest. New durable records must omit this because it is
   * an offline candidate-secret oracle. It is retained only to read and reject
   * old records safely.
   */
  parentTurnDigest?: string
  /** Non-secret canonical proof of the sanitized parent-turn sequence. */
  parentTurnProof?: AgentPersistedParentTurnProof
  provenance?: {
    kind: 'original' | 'replayed' | 'recovery_notice'
    sourceConversationId?: string
    sourceBranchId?: string
    sourceTurnId?: string
    replayId?: string
  }
}

export type AgentChatProcessEvent = {
  id: string
  kind:
    | 'status'
    | 'reasoning'
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
  expectedBranchRevision?: number
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
    | 'reasoning'
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
  /** Answer is the default for backward-compatible replay payloads. */
  channel?: 'answer' | 'reasoning'
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
  /** Main-process-generated opaque correlation id; never supplied by renderer payloads. */
  traceId?: string
  turns: AgentChatTurn[]
}

/** A rebuildable, privacy-conservative overview derived from canonical conversation files. */
export type AgentConversationSummaryProjection = {
  projectionVersion: 1
  conversationId: string
  /** Metadata only; never authorizes deletion or modification of canonical files. */
  timeCompacting: true
  source: {
    jsonRelativePath: string
    markdownRelativePath: string
    jsonSha256: string
    markdownSha256: string
  }
  summary: {
    template: 'conversation-summary-v1'
    title: string
    turnCounts: {
      total: number
      user: number
      assistant: number
    }
  }
}

export type ProjectAgentConversationSummariesPayload = {
  workspaceId: string
  conversationIds: string[]
}

export type AgentConversationSummaryProjectionOutcome = {
  conversationId: string
  status: 'generated' | 'ineligible' | 'not_found' | 'rejected'
  reason?: 'not_archived' | 'deleted' | 'temporary' | 'invalid_source' | 'source_drift' | 'write_failed' | 'unsupported_platform' | 'native_unavailable'
}

export type ProjectAgentConversationSummariesResult = {
  outcomes: AgentConversationSummaryProjectionOutcome[]
}

export type SaveAgentConversationPayload = {
  workspaceId: string
  /** Main-process stream/run capability used only to promote staged child transcript artifacts. */
  runId?: string
  mode?: AgentChatMode
  conversationId?: string | null
  expectedBranchRevision?: number
  selectedLessonPath?: string | null
  selectedCourseRelativePath?: string | null
  courseName?: string
  turns: AgentChatTurn[]
}

export type SaveAgentConversationResult = {
  state: TeachingAppState
  conversation: AgentConversationSummary
}

export type RenameAgentConversationPayload = {
  workspaceId: string
  conversationId: string
  title: string
  scope?: AgentConversationLookupScope
  expectedRevision?: number
}

export type RenameAgentConversationResult = {
  state: TeachingAppState
  conversation: AgentConversationSummary
}

export type ReadAgentConversationPayload = {
  workspaceId: string
  conversationId: string
  scope?: AgentConversationLookupScope
}

export type ReadAgentConversationSessionTreePayload = {
  workspaceId: string
  conversationId: string
  scope?: AgentConversationLookupScope
}

export type OpenAgentConversationBranchPayload = {
  workspaceId: string
  conversationId: string
  scope?: AgentConversationLookupScope
}

export type OpenAgentConversationBranchResult = {
  conversation: AgentConversationRecord
  tree: AgentConversationSessionTree
}

export type ForkAgentConversationBranchPayload = {
  workspaceId: string
  conversationId: string
  scope?: AgentConversationLookupScope
  sourceTurnId?: string
  title?: string
  expectedRevision: number
}

export type ForkAgentConversationBranchResult = {
  state: TeachingAppState
  conversation: AgentConversationRecord
  tree: AgentConversationSessionTree
}

export type ReplayAgentConversationBranchPayload = {
  workspaceId: string
  conversationId: string
  scope?: AgentConversationLookupScope
  sourceTurnId?: string
}

export type ReplayAgentConversationBranchResult = {
  turns: AgentChatTurn[]
  replaySource: AgentConversationReplaySource
}

export type UpdateAgentConversationBranchStatusPayload = {
  workspaceId: string
  conversationId: string
  scope?: AgentConversationLookupScope
  status: AgentConversationBranchStatus
  expectedRevision: number
}

export type UpdateAgentConversationBranchStatusResult = {
  state: TeachingAppState
  conversation: AgentConversationRecord
  tree: AgentConversationSessionTree
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

/**
 * Human-facing rewind of tool workspace writes for one agent run.
 * Distinct from conversation prefix checkpoints (those restore turns, not file pre-images).
 */
export type RestoreAgentWriteRewindPayload = {
  workspaceId: string
  /** Agent run / stream id that journaled write_workspace_file pre-images. */
  runId: string
}

export type RestoreAgentWriteRewindResult = {
  /** Copy-safe label: tool-write rewind, not conversation checkpoint. */
  kind: 'tool_write_rewind'
  runId: string
  restored: string[]
  deleted: string[]
  skipped: Array<{ path: string; reason: string }>
}

export type ListAgentWriteRewindJournalPayload = {
  workspaceId: string
  runId: string
}

export type ListAgentWriteRewindJournalResult = {
  kind: 'tool_write_rewind_journal'
  runId: string
  entries: Array<{
    relativePath: string
    capturedAt: string
    existed: boolean
    bytes: number
  }>
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
