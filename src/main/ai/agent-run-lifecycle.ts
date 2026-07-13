import type { AgentRunBudget, InterruptedAgentRun } from '../../shared/teaching-types'
import { AgentOperationJournal } from './agent-operation-journal'
import { AgentRunPersistence } from './agent-run-persistence'
import { assertSafeId, emptyAgentRunUsage, normalizeAgentRunBudget } from './agent-run-types'
import type { AgentRunCheckpoint, AgentRunCheckpointStatus } from './agent-run-types'

const ACTIVE_STATUSES = new Set<AgentRunCheckpointStatus>([
  'running',
  'waiting_for_permission',
  'waiting_for_elicitation'
])

/**
 * The run-orchestration seam. Callers get lifecycle and recovery behaviour without learning
 * anything about operation records, JSON persistence, path safety, or atomic writes.
 */
export class AgentRunLifecycle {
  constructor(
    private readonly persistence: AgentRunPersistence,
    private readonly operations: AgentOperationJournal
  ) {}

  async create(input: {
    runId: string
    streamId: string
    workspaceId?: string
    conversationId?: string
    budget: AgentRunBudget
  }): Promise<AgentRunCheckpoint> {
    assertSafeId(input.runId, 'runId')
    assertSafeId(input.streamId, 'streamId')
    if (input.workspaceId) assertSafeId(input.workspaceId, 'workspaceId')
    if (input.conversationId) assertSafeId(input.conversationId, 'conversationId')
    return this.persistence.serialize(async () => {
      const now = this.persistence.timestamp()
      const checkpoint: AgentRunCheckpoint = {
        version: 1,
        runId: input.runId,
        streamId: input.streamId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        status: 'running',
        lastDurableSequence: 0,
        createdAt: now,
        updatedAt: now,
        operationJournalPointer: `.agent-sessions/operations/${input.runId}`,
        budget: normalizeAgentRunBudget(input.budget),
        usage: emptyAgentRunUsage()
      }
      await this.persistence.writeCheckpoint(checkpoint, false)
      return checkpoint
    })
  }

  async update(runId: string, patch: Partial<Omit<AgentRunCheckpoint, 'version' | 'runId' | 'createdAt'>>): Promise<AgentRunCheckpoint> {
    return this.persistence.serialize(async () => {
      const current = await this.persistence.readCheckpoint(runId)
      const next: AgentRunCheckpoint = {
        ...current,
        ...patch,
        version: 1,
        runId: current.runId,
        createdAt: current.createdAt,
        updatedAt: this.persistence.timestamp()
      }
      await this.persistence.writeCheckpoint(next, true)
      return next
    })
  }

  async readCheckpoint(runId: string): Promise<AgentRunCheckpoint> {
    return this.persistence.readCheckpoint(runId)
  }

  async reconcileInterrupted(): Promise<InterruptedAgentRun[]> {
    return this.persistence.serialize(async () => {
      const interrupted: InterruptedAgentRun[] = []
      for (const name of await this.persistence.listCheckpointFiles()) {
        let checkpoint: AgentRunCheckpoint
        try {
          checkpoint = await this.persistence.readCheckpointFile(name)
        } catch {
          continue
        }
        if (!ACTIVE_STATUSES.has(checkpoint.status)) continue
        const previousStatus = checkpoint.status as InterruptedAgentRun['previousStatus']
        const at = this.persistence.timestamp()
        const reviewCount = await this.operations.reconcileInterruptedOperations(checkpoint.runId)
        checkpoint = {
          ...checkpoint,
          status: 'interrupted',
          previousStatus,
          pendingPermissionId: undefined,
          pendingElicitationId: undefined,
          interruptedAt: at,
          updatedAt: at,
          interruptionReason: '应用在运行完成前退出；旧审批和追问已失效，需要用户明确继续或重新发送。'
        }
        await this.persistence.writeCheckpoint(checkpoint, true)
        interrupted.push(toInterruptedRun(checkpoint, reviewCount))
      }
      return interrupted
    })
  }

  async listInterrupted(): Promise<InterruptedAgentRun[]> {
    const out: InterruptedAgentRun[] = []
    for (const name of await this.persistence.listCheckpointFiles()) {
      try {
        const checkpoint = await this.persistence.readCheckpointFile(name)
        if (checkpoint.status !== 'interrupted' || !checkpoint.previousStatus || !checkpoint.interruptedAt) continue
        out.push(toInterruptedRun(checkpoint, await this.operations.countReviewOperations(checkpoint.runId)))
      } catch {
        // Invalid records have already been quarantined and never reach the renderer.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}

function toInterruptedRun(checkpoint: AgentRunCheckpoint, operationReviewCount: number): InterruptedAgentRun {
  if (!checkpoint.previousStatus || !checkpoint.interruptedAt) throw new Error('Interrupted checkpoint is incomplete.')
  return {
    runId: checkpoint.runId,
    streamId: checkpoint.streamId,
    ...(checkpoint.workspaceId ? { workspaceId: checkpoint.workspaceId } : {}),
    ...(checkpoint.conversationId ? { conversationId: checkpoint.conversationId } : {}),
    status: 'interrupted',
    previousStatus: checkpoint.previousStatus,
    lastDurableSequence: checkpoint.lastDurableSequence,
    updatedAt: checkpoint.updatedAt,
    interruptedAt: checkpoint.interruptedAt,
    reason: checkpoint.interruptionReason ?? '上次运行被中断。',
    operationReviewCount,
    usage: checkpoint.usage
  }
}