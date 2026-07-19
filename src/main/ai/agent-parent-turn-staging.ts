import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import type { AgentRealtimeEvent } from '../../shared/teaching-types'
import { redactAgentSecretText } from '../../shared/agent-secret-redaction'
import { AgentRunPersistence } from './agent-run-persistence'
import type {
  AgentParentTurnStage,
  AgentParentTurnStageEvidence,
  AgentParentTurnStageStatus,
  AgentParentTurnTextEvidence,
  AgentRunCheckpoint
} from './agent-run-types'

const MAX_PREVIEW_BYTES = 16 * 1024
const MAX_EVIDENCE = 32
const MAX_EVIDENCE_TEXT = 1000

export class AgentParentTurnStaging {
  constructor(private readonly persistence: AgentRunPersistence) {}

  async createPersisted(input: {
    runId: string
    streamId: string
    workspaceId?: string
    conversationId?: string
    userInput: string
  }): Promise<AgentParentTurnStage> {
    const now = this.persistence.timestamp()
    const stage: AgentParentTurnStage = {
      schemaVersion: 1,
      runId: input.runId,
      streamId: input.streamId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      status: 'running',
      boundary: 'input_received',
      userInput: textEvidence(input.userInput),
      lastDurableSequence: 0,
      unrecoverableAssistantDeltaBytes: 0,
      unrecoverableAssistantDeltaCount: 0,
      evidence: [],
      createdAt: now,
      updatedAt: now
    }
    await this.persistence.writeParentTurnStage(stage, false)
    return stage
  }

  recordEvent(runId: string, event: AgentRealtimeEvent): Promise<AgentParentTurnStage | null> {
    return this.persistence.serialize(async () => {
      const stage = await this.readOptional(runId)
      if (!stage) return null
      return this.recordEventPersisted(stage, event)
    })
  }

  async recordEventPersisted(
    stage: AgentParentTurnStage,
    event: AgentRealtimeEvent
  ): Promise<AgentParentTurnStage> {
    if (terminalStage(stage.status) || event.sequence <= stage.lastDurableSequence) return stage
    const next = reduceEvent(stage, event, this.persistence.timestamp())
    await this.persistence.writeParentTurnStage(next, true)
    return next
  }

  confirmFinal(runId: string, finalText: string): Promise<AgentParentTurnStage | null> {
    return this.persistence.serialize(async () => {
      const stage = await this.readOptional(runId)
      if (!stage || terminalStage(stage.status)) return stage
      const next: AgentParentTurnStage = {
        ...stage,
        status: 'awaiting_conversation_save',
        boundary: 'final_confirmed',
        confirmedAssistant: textEvidence(finalText),
        updatedAt: this.persistence.timestamp()
      }
      await this.persistence.writeParentTurnStage(next, true)
      return next
    })
  }

  prepareSave(runId: string, targetConversationId: string, expectedParentTurnProof: string): Promise<AgentParentTurnStage | null> {
    return this.persistence.serialize(async () => {
      const stage = await this.readOptional(runId)
      if (!stage) throw new Error('Parent turn staging is unavailable.')
      if (stage.status === 'settled') {
        if (stage.targetConversationId !== targetConversationId || stage.expectedParentTurnProof !== expectedParentTurnProof) {
          throw new Error('Parent turn staging is already settled with a different conversation commit.')
        }
        return stage
      }
      if (stage.status !== 'awaiting_conversation_save' || !stage.confirmedAssistant) {
        throw new Error('Parent turn staging has no explicitly confirmed final answer to save.')
      }
      if (stage.targetConversationId && stage.targetConversationId !== targetConversationId) {
        throw new Error('Parent turn staging target conversation changed.')
      }
      if (stage.expectedParentTurnProof && stage.expectedParentTurnProof !== expectedParentTurnProof) {
        throw new Error('Parent turn staging digest changed.')
      }
      const next: AgentParentTurnStage = {
        ...stage,
        status: 'awaiting_conversation_save',
        boundary: 'conversation_save',
        targetConversationId,
        expectedParentTurnProof,
        updatedAt: this.persistence.timestamp()
      }
      await this.persistence.writeParentTurnStage(next, true)
      return next
    })
  }

  settle(runId: string, targetConversationId: string, expectedParentTurnProof: string): Promise<AgentParentTurnStage | null> {
    return this.persistence.serialize(async () => {
      const stage = await this.readOptional(runId)
      if (!stage) throw new Error('Parent turn staging is unavailable.')
      if (stage.targetConversationId !== targetConversationId) {
        throw new Error('Parent turn staging settlement target does not match.')
      }
      if (stage.expectedParentTurnProof !== expectedParentTurnProof) {
        throw new Error('Parent turn staging settlement digest does not match.')
      }
      if (stage.status === 'settled') return stage
      if (stage.status !== 'awaiting_conversation_save' || !stage.confirmedAssistant) {
        throw new Error('Parent turn staging cannot settle before its confirmed save is prepared.')
      }
      const now = this.persistence.timestamp()
      const next: AgentParentTurnStage = {
        ...stage,
        status: 'settled',
        boundary: 'conversation_save',
        targetConversationId,
        expectedParentTurnProof,
        settledAt: stage.settledAt ?? now,
        updatedAt: now,
        recoveryReason: undefined
      }
      await this.persistence.writeParentTurnStage(next, true)
      return next
    })
  }

  markTerminal(runId: string, status: 'failed' | 'canceled', reason?: string): Promise<AgentParentTurnStage | null> {
    return this.persistence.serialize(async () => {
      const stage = await this.readOptional(runId)
      if (!stage || stage.status === 'settled') return stage
      const next: AgentParentTurnStage = {
        ...stage,
        status,
        failureReason: reason ? boundedRedacted(reason, MAX_EVIDENCE_TEXT) : stage.failureReason,
        updatedAt: this.persistence.timestamp()
      }
      await this.persistence.writeParentTurnStage(next, true)
      return next
    })
  }

  async syncCheckpointPersisted(checkpoint: AgentRunCheckpoint): Promise<AgentParentTurnStage | null> {
    const stage = await this.readOptional(checkpoint.runId)
    if (!stage || stage.status === 'settled') return stage
    const status = checkpointStatusToStageStatus(checkpoint.status)
    if (!status) return stage
    const next: AgentParentTurnStage = {
      ...stage,
      status,
      boundary: status === 'waiting_for_permission'
        ? 'permission_boundary'
        : status === 'waiting_for_elicitation'
          ? 'elicitation_boundary'
          : stage.boundary,
      lastDurableSequence: Math.max(stage.lastDurableSequence, checkpoint.lastDurableSequence),
      failureReason: checkpoint.interruptionReason
        ? boundedRedacted(checkpoint.interruptionReason, MAX_EVIDENCE_TEXT)
        : stage.failureReason,
      updatedAt: checkpoint.updatedAt
    }
    await this.persistence.writeParentTurnStage(next, true)
    return next
  }

  async interruptPersisted(stage: AgentParentTurnStage, reason: string): Promise<AgentParentTurnStage> {
    if (terminalStage(stage.status)) return stage
    const now = this.persistence.timestamp()
    const previousStatus = stage.status === 'running' ||
      stage.status === 'waiting_for_permission' ||
      stage.status === 'waiting_for_elicitation' ||
      stage.status === 'awaiting_conversation_save'
      ? stage.status
      : 'running'
    const next: AgentParentTurnStage = {
      ...stage,
      status: 'interrupted',
      previousStatus,
      interruptedAt: stage.interruptedAt ?? now,
      updatedAt: now,
      recoveryReason: boundedRedacted(reason, MAX_EVIDENCE_TEXT)
    }
    await this.persistence.writeParentTurnStage(next, true)
    return next
  }

  read(runId: string): Promise<AgentParentTurnStage> {
    return this.persistence.readParentTurnStage(runId)
  }

  async list(): Promise<AgentParentTurnStage[]> {
    const records: AgentParentTurnStage[] = []
    for (const name of await this.persistence.listParentTurnStageFiles()) {
      try {
        records.push(await this.persistence.readParentTurnStageFile(name))
      } catch {
        // Invalid and oversized staging records are quarantined by persistence.
      }
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runId.localeCompare(b.runId))
  }

  private async readOptional(runId: string): Promise<AgentParentTurnStage | null> {
    return this.persistence.readParentTurnStage(runId).catch((error) => {
      if (isNotFound(error)) return null
      throw error
    })
  }
}

function reduceEvent(stage: AgentParentTurnStage, event: AgentRealtimeEvent, updatedAt: string): AgentParentTurnStage {
  if (event.kind === 'chunk') {
    return {
      ...stage,
      boundary: 'provider_stream',
      lastDurableSequence: event.sequence,
      unrecoverableAssistantDeltaBytes: stage.unrecoverableAssistantDeltaBytes + Buffer.byteLength(event.payload.delta, 'utf8'),
      unrecoverableAssistantDeltaCount: stage.unrecoverableAssistantDeltaCount + 1,
      updatedAt
    }
  }

  const evidence = eventEvidence(event)
  return {
    ...stage,
    boundary: evidence.kind === 'permission_wait' || evidence.kind === 'permission_resolved'
      ? 'permission_boundary'
      : evidence.kind === 'elicitation_wait' || evidence.kind === 'elicitation_resolved'
        ? 'elicitation_boundary'
        : evidence.kind === 'tool_call' || evidence.kind === 'tool_result'
          ? 'tool_boundary'
          : stage.boundary,
    lastDurableSequence: event.sequence,
    evidence: [...stage.evidence, evidence].slice(-MAX_EVIDENCE),
    updatedAt
  }
}

function eventEvidence(event: Exclude<AgentRealtimeEvent, { kind: 'chunk' }>): AgentParentTurnStageEvidence {
  if (event.kind === 'status') {
    return {
      sequence: event.sequence,
      kind: 'status',
      title: boundedRedacted(event.payload.status, 200),
      ...(event.payload.message ? { detail: boundedRedacted(event.payload.message, MAX_EVIDENCE_TEXT) } : {}),
      isError: event.payload.status === 'error',
      createdAt: event.createdAt
    }
  }
  if (event.kind === 'terminal') {
    return {
      sequence: event.sequence,
      kind: 'terminal',
      title: event.outcome,
      ...(event.message ? { detail: boundedRedacted(event.message, MAX_EVIDENCE_TEXT) } : {}),
      isError: event.outcome === 'error',
      createdAt: event.createdAt
    }
  }

  const toolName = safeToolName(event.payload.toolCall.name)
  const hasResult = event.payload.result !== undefined
  const isPermission = Boolean(event.payload.permissionRequest) || toolName === 'tool_permission'
  const isElicitation = toolName === 'ask'
  const kind: AgentParentTurnStageEvidence['kind'] = isPermission
    ? hasResult ? 'permission_resolved' : 'permission_wait'
    : isElicitation
      ? hasResult ? 'elicitation_resolved' : 'elicitation_wait'
      : hasResult ? 'tool_result' : 'tool_call'
  return {
    sequence: event.sequence,
    kind,
    title: hasResult ? `${toolName} 已返回` : `${toolName} 已调用`,
    toolName,
    isError: event.payload.isError === true,
    createdAt: event.createdAt
  }
}

function textEvidence(value: string): AgentParentTurnTextEvidence {
  const originalBytes = Buffer.byteLength(value, 'utf8')
  const redacted = redactStagingText(value)
  const preview = truncateUtf8(redacted, MAX_PREVIEW_BYTES)
  return {
    // Hash only the redacted projection. A raw-content digest is an offline
    // candidate-secret equality oracle and must never enter the stage file.
    sha256: parentTurnStageSafeTextDigest(value),
    preview,
    originalBytes,
    truncated: Buffer.byteLength(redacted, 'utf8') > MAX_PREVIEW_BYTES
  }
}

/** Hashes only the same redacted text persisted in stage evidence. */
export function parentTurnStageSafeTextDigest(value: string): string {
  return createHash('sha256').update(redactStagingText(value), 'utf8').digest('hex')
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) low = mid
    else high = mid - 1
  }
  return value.slice(0, low)
}

function boundedRedacted(value: string, maxLength: number): string {
  return redactStagingText(value).slice(0, maxLength)
}

function redactStagingText(value: string): string {
  return redactAgentSecretText(value)
}

function checkpointStatusToStageStatus(status: AgentRunCheckpoint['status']): AgentParentTurnStageStatus | null {
  if (status === 'running' || status === 'waiting_for_permission' || status === 'waiting_for_elicitation' || status === 'awaiting_conversation_save') return status
  if (status === 'failed' || status === 'canceled') return status
  if (status === 'interrupted') return 'interrupted'
  return null
}

function terminalStage(status: AgentParentTurnStageStatus): boolean {
  return status === 'settled' || status === 'failed' || status === 'canceled' || status === 'interrupted'
}

function safeToolName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 160)
  return normalized || 'tool'
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}
