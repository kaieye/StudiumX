import type { AgentArtifactRef, AgentRealtimeEvent, AgentRunBudget, InterruptedAgentRun } from '../../shared/teaching-types'
import { AgentOperationJournal } from './agent-operation-journal'
import { AgentParentTurnStaging } from './agent-parent-turn-staging'
import { ChildRunStore, type ChildRunRecord } from './child-run-supervisor'
import { AgentRunLifecycle } from './agent-run-lifecycle'
import { AgentRunPersistence } from './agent-run-persistence'
import type { AgentOperationRecord, AgentParentTurnStage, AgentRunCheckpoint, AgentRunChildRecord } from './agent-run-types'

export {
  DEFAULT_AGENT_RUN_BUDGET,
  agentOperationId,
  emptyAgentRunUsage,
  normalizeAgentRunBudget
} from './agent-run-types'
export type {
  AgentOperationRecord,
  AgentOperationState,
  AgentParentTurnStage,
  AgentParentTurnStageBoundary,
  AgentParentTurnStageEvidence,
  AgentParentTurnStageStatus,
  AgentParentTurnTextEvidence,
  AgentRunCheckpoint,
  AgentRunCheckpointStatus,
  AgentRunChildRecord,
  AgentRunChildStatus
} from './agent-run-types'

// Explicit run-state surface (separate from teaching SessionLedger). ID correlation only.
export {
  AgentRunStateMachine,
  createAgentRunStateMachine,
  transition as transitionAgentRunState,
  cancelAgentRun,
  recoverAgentRun,
  resumeAfterRecovery,
  projectCheckpointStatusToRunState,
  projectRunStateToCheckpointStatuses,
  LEGAL_AGENT_RUN_EDGES,
  AGENT_RUN_STATES
} from '../agent-run-state-machine'
export type {
  AgentRunState,
  AgentRunTrigger,
  AgentRunCommand,
  AgentRunEvent,
  TransitionResult,
  TransitionKind,
  AgentRunSessionCorrelation
} from '../agent-run-state-machine'

/**
 * Compatibility facade for the run lifecycle. The operation journal is intentionally exposed as
 * a separate deep module so tool execution depends only on idempotency behaviour, not lifecycle.
 */
export class AgentRunStore {
  readonly operations: AgentOperationJournal
  private readonly persistence: AgentRunPersistence
  private readonly parentTurns: AgentParentTurnStaging
  private readonly lifecycle: AgentRunLifecycle

  constructor(readonly storageRoot: string, now: () => string = () => new Date().toISOString()) {
    this.persistence = new AgentRunPersistence(storageRoot, now)
    this.operations = new AgentOperationJournal(this.persistence)
    this.parentTurns = new AgentParentTurnStaging(this.persistence)
    this.lifecycle = new AgentRunLifecycle(this.persistence, this.operations, this.parentTurns)
  }

  create(input: {
    runId: string
    streamId: string
    workspaceId?: string
    conversationId?: string
    parentTurn?: { userInput: string }
    budget: AgentRunBudget
  }): Promise<AgentRunCheckpoint> {
    return this.lifecycle.create(input)
  }

  update(runId: string, patch: Partial<Omit<AgentRunCheckpoint, 'version' | 'runId' | 'createdAt'>>): Promise<AgentRunCheckpoint> {
    return this.lifecycle.update(runId, patch)
  }

  readCheckpoint(runId: string): Promise<AgentRunCheckpoint> {
    return this.lifecycle.readCheckpoint(runId)
  }

  recordParentTurnEvent(runId: string, event: AgentRealtimeEvent): Promise<AgentParentTurnStage | null> {
    return this.lifecycle.recordParentTurnEvent(runId, event)
  }

  confirmParentTurnFinal(runId: string, finalText: string): Promise<AgentParentTurnStage | null> {
    return this.lifecycle.confirmParentTurnFinal(runId, finalText)
  }

  prepareParentTurnSave(
    runId: string,
    targetConversationId: string,
    expectedParentTurnProof: string
  ): Promise<AgentParentTurnStage | null> {
    return this.lifecycle.prepareParentTurnSave(runId, targetConversationId, expectedParentTurnProof)
  }

  settleParentTurn(
    runId: string,
    targetConversationId: string,
    expectedParentTurnProof: string
  ): Promise<AgentParentTurnStage | null> {
    return this.lifecycle.settleParentTurn(runId, targetConversationId, expectedParentTurnProof)
  }

  markParentTurnTerminal(
    runId: string,
    status: 'failed' | 'canceled',
    reason?: string
  ): Promise<AgentParentTurnStage | null> {
    return this.lifecycle.markParentTurnTerminal(runId, status, reason)
  }

  readParentTurnStage(runId: string): Promise<AgentParentTurnStage> {
    return this.lifecycle.readParentTurnStage(runId)
  }

  reconcileInterrupted(
    isConversationSaved?: (stage: AgentParentTurnStage) => boolean | Promise<boolean>
  ): Promise<InterruptedAgentRun[]> {
    return this.lifecycle.reconcileInterrupted(isConversationSaved)
  }

  listInterrupted(): Promise<InterruptedAgentRun[]> {
    return this.lifecycle.listInterrupted()
  }

  /**
   * Creates a child-run store backed by this run's durable journal. The persisted record excludes
   * the child prompt and deltas; it is only the lifecycle evidence needed for safe restart.
   */
  createChildRunStore(runId: string): ChildRunStore {
    return new ChildRunStore({
      save: (record) => this.persistChildRun(runId, record).then(() => undefined)
    })
  }

  listChildRuns(runId: string): Promise<AgentRunChildRecord[]> {
    return this.lifecycle.listChildRuns(runId)
  }

  reconcileOrphanedChildRuns(): Promise<AgentRunChildRecord[]> {
    return this.lifecycle.reconcileOrphanedChildRuns()
  }

  stageChildTranscript(runId: string, childRunId: string, transcript: string): Promise<AgentArtifactRef> {
    return this.persistence.stageChildTranscript(runId, childRunId, transcript)
  }

  private persistChildRun(runId: string, record: ChildRunRecord): Promise<AgentRunChildRecord> {
    return this.lifecycle.persistChildRun({
      runId,
      childRunId: record.id,
      ...(record.parentStreamId ? { parentStreamId: record.parentStreamId } : {}),
      label: record.label,
      profile: durableChildProfile(record.profile),
      status: record.status,
      ...(record.status === 'queued' ? {} : { startedAt: record.startedAt }),
      ...(record.completedAt ? { completedAt: record.completedAt } : {}),
      ...(record.summary ? { summary: record.summary } : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.usage ? { usage: record.usage } : {}),
      createdAt: record.startedAt
    })
  }

  /** @deprecated New tool callers should depend on the narrower `operations` seam. */
  startOperation(input: Parameters<AgentOperationJournal['startOperation']>[0]) {
    return this.operations.startOperation(input)
  }

  /** @deprecated New tool callers should depend on the narrower `operations` seam. */
  completeOperation(record: AgentOperationRecord, result: string) {
    return this.operations.completeOperation(record, result)
  }

  /** @deprecated New tool callers should depend on the narrower `operations` seam. */
  failOperation(record: AgentOperationRecord, error: unknown, interrupted = false) {
    return this.operations.failOperation(record, error, interrupted)
  }

  async flush(): Promise<void> {
    await this.persistence.flush()
  }
}

function durableChildProfile(profile: string): AgentRunChildRecord['profile'] {
  if (profile === 'read_only' || profile === 'research' || profile === 'workspace_audit') return profile
  throw new Error(`Invalid child run profile: ${profile}`)
}
