import type { AgentRunBudget, InterruptedAgentRun } from '../../shared/teaching-types'
import { AgentOperationJournal } from './agent-operation-journal'
import { AgentRunLifecycle } from './agent-run-lifecycle'
import { AgentRunPersistence } from './agent-run-persistence'
import type { AgentOperationRecord, AgentRunCheckpoint } from './agent-run-types'

export {
  DEFAULT_AGENT_RUN_BUDGET,
  agentOperationId,
  emptyAgentRunUsage,
  normalizeAgentRunBudget
} from './agent-run-types'
export type {
  AgentOperationRecord,
  AgentOperationState,
  AgentRunCheckpoint,
  AgentRunCheckpointStatus
} from './agent-run-types'

/**
 * Compatibility facade for the run lifecycle. The operation journal is intentionally exposed as
 * a separate deep module so tool execution depends only on idempotency behaviour, not lifecycle.
 */
export class AgentRunStore {
  readonly operations: AgentOperationJournal
  private readonly persistence: AgentRunPersistence
  private readonly lifecycle: AgentRunLifecycle

  constructor(readonly storageRoot: string, now: () => string = () => new Date().toISOString()) {
    this.persistence = new AgentRunPersistence(storageRoot, now)
    this.operations = new AgentOperationJournal(this.persistence)
    this.lifecycle = new AgentRunLifecycle(this.persistence, this.operations)
  }

  create(input: {
    runId: string
    streamId: string
    workspaceId?: string
    conversationId?: string
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

  reconcileInterrupted(): Promise<InterruptedAgentRun[]> {
    return this.lifecycle.reconcileInterrupted()
  }

  listInterrupted(): Promise<InterruptedAgentRun[]> {
    return this.lifecycle.listInterrupted()
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