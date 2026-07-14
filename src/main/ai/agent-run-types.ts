import { createHash } from 'node:crypto'

import type { AgentRunBudget, AgentRunUsageAggregate } from '../../shared/teaching-types'

export type AgentRunCheckpointStatus =
  | 'running'
  | 'waiting_for_permission'
  | 'waiting_for_elicitation'
  | 'awaiting_conversation_save'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'interrupted'

export type AgentRunCheckpoint = {
  version: 1
  runId: string
  streamId: string
  workspaceId?: string
  conversationId?: string
  status: AgentRunCheckpointStatus
  previousStatus?: 'running' | 'waiting_for_permission' | 'waiting_for_elicitation' | 'awaiting_conversation_save'
  lastDurableSequence: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  interruptedAt?: string
  transcriptPointer?: string
  parentTurnStagingPointer?: string
  operationJournalPointer: string
  pendingPermissionId?: string
  pendingElicitationId?: string
  budget: AgentRunBudget
  usage: AgentRunUsageAggregate
  stopReason?: string
  interruptionReason?: string
}

export type AgentParentTurnStageStatus =
  | 'running'
  | 'waiting_for_permission'
  | 'waiting_for_elicitation'
  | 'awaiting_conversation_save'
  | 'interrupted'
  | 'settled'
  | 'failed'
  | 'canceled'

export type AgentParentTurnStageBoundary =
  | 'input_received'
  | 'provider_stream'
  | 'tool_boundary'
  | 'permission_boundary'
  | 'elicitation_boundary'
  | 'final_confirmed'
  | 'conversation_save'

export type AgentParentTurnTextEvidence = {
  sha256: string
  preview: string
  originalBytes: number
  truncated: boolean
}

export type AgentParentTurnStageEvidence = {
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

/**
 * Minimal durable evidence for a parent turn before its final conversation snapshot is saved.
 * Provider deltas are counted but never promoted to a final assistant turn; only an explicitly
 * confirmed final answer may be retained as bounded, redacted recovery evidence.
 */
export type AgentParentTurnStage = {
  schemaVersion: 1
  runId: string
  streamId: string
  workspaceId?: string
  conversationId?: string
  targetConversationId?: string
  status: AgentParentTurnStageStatus
  previousStatus?: Exclude<AgentParentTurnStageStatus, 'interrupted' | 'settled' | 'failed' | 'canceled'>
  boundary: AgentParentTurnStageBoundary
  userInput: AgentParentTurnTextEvidence
  confirmedAssistant?: AgentParentTurnTextEvidence
  lastDurableSequence: number
  unrecoverableAssistantDeltaBytes: number
  unrecoverableAssistantDeltaCount: number
  evidence: AgentParentTurnStageEvidence[]
  expectedTurnDigest?: string
  createdAt: string
  updatedAt: string
  interruptedAt?: string
  settledAt?: string
  failureReason?: string
  recoveryReason?: string
}

export type AgentRunChildStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'recoverable'

/**
 * Durable, deliberately prompt-free child-run lifecycle record. Final child output remains
 * attached to the parent turn audit; this journal exists so startup can explain and settle
 * work that was still in memory when the process exited.
 */
export type AgentRunChildRecord = {
  version: 1
  runId: string
  childRunId: string
  parentStreamId?: string
  label: string
  profile: 'read_only' | 'research' | 'workspace_audit'
  status: AgentRunChildStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
  summary?: string
  error?: string
  usage?: {
    providerCalls?: number
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    toolCalls: number
  }
  recoveryReason?: string
  recoveredAt?: string
}

export type AgentOperationState =
  | 'started'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'needs_review'

export type AgentOperationRecord = {
  version: 1
  operationId: string
  runId: string
  toolCallId: string
  toolName: string
  normalizedTarget?: string
  state: AgentOperationState
  resultHash?: string
  result?: string
  artifactPointer?: string
  artifactExists?: boolean
  disposition: 'first_execution' | 'idempotent_reuse' | 'manual_review'
  createdAt: string
  updatedAt: string
  completedAt?: string
  error?: string
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/

export const DEFAULT_AGENT_RUN_BUDGET: AgentRunBudget = {
  maxDurationMs: 120_000,
  maxProviderCalls: 16,
  maxToolCalls: 32,
  maxTotalTokens: 200_000,
  warningThreshold: 0.8
}

export function normalizeAgentRunBudget(input: Partial<AgentRunBudget> | null | undefined): AgentRunBudget {
  return {
    maxDurationMs: boundedInteger(input?.maxDurationMs, 5_000, 30 * 60_000, DEFAULT_AGENT_RUN_BUDGET.maxDurationMs),
    maxProviderCalls: boundedInteger(input?.maxProviderCalls, 1, 100, DEFAULT_AGENT_RUN_BUDGET.maxProviderCalls),
    maxToolCalls: boundedInteger(input?.maxToolCalls, 1, 500, DEFAULT_AGENT_RUN_BUDGET.maxToolCalls),
    maxTotalTokens: boundedInteger(input?.maxTotalTokens, 1_000, 2_000_000, DEFAULT_AGENT_RUN_BUDGET.maxTotalTokens),
    warningThreshold: boundedNumber(input?.warningThreshold, 0.5, 0.95, DEFAULT_AGENT_RUN_BUDGET.warningThreshold)
  }
}

export function emptyAgentRunUsage(): AgentRunUsageAggregate {
  return {
    providerCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    iterations: 0,
    childRuns: 0,
    durationMs: 0
  }
}

export function agentOperationId(runId: string, toolCallId: string): string {
  assertSafeId(runId, 'runId')
  if (!toolCallId.trim()) throw new Error('toolCallId is required.')
  return createHash('sha256').update(`${runId}\0${toolCallId}`).digest('hex')
}

export function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Invalid ${label}.`)
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}