import type { AgentRunBudget, InterruptedAgentRun } from '../../shared/teaching-types'
import { AgentOperationJournal } from './agent-operation-journal'
import { AgentRunPersistence } from './agent-run-persistence'
import { assertSafeId, emptyAgentRunUsage, normalizeAgentRunBudget } from './agent-run-types'
import type { AgentRunCheckpoint, AgentRunCheckpointStatus, AgentRunChildRecord } from './agent-run-types'

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

  async persistChildRun(input: Omit<AgentRunChildRecord, 'version' | 'createdAt' | 'updatedAt' | 'recoveryReason' | 'recoveredAt'> & {
    createdAt?: string
  }): Promise<AgentRunChildRecord> {
    assertSafeId(input.runId, 'runId')
    assertSafeId(input.childRunId, 'childRunId')
    return this.persistence.serialize(async () => {
      const existing = await this.persistence.readChildRun(input.runId, input.childRunId).catch((error) => {
        if (isNotFound(error)) return null
        throw error
      })
      if (!existing && input.status !== 'queued') {
        throw new Error('A durable child run must be queued before it can start.')
      }
      if (existing && !isLegalChildTransition(existing.status, input.status)) {
        throw new Error(`Illegal durable child run transition: ${existing.status} -> ${input.status}`)
      }
      const { createdAt, startedAt, ...next } = input
      const durableStartedAt = existing?.startedAt ?? (next.status === 'running' ? startedAt : undefined)
      const now = this.persistence.timestamp()
      const record: AgentRunChildRecord = {
        version: 1,
        ...next,
        createdAt: existing?.createdAt ?? createdAt ?? now,
        ...(durableStartedAt ? { startedAt: durableStartedAt } : {}),
        updatedAt: now
      }
      await this.persistence.writeChildRun(record, Boolean(existing))
      return record
    })
  }

  async listChildRuns(runId: string): Promise<AgentRunChildRecord[]> {
    assertSafeId(runId, 'runId')
    const records: AgentRunChildRecord[] = []
    for (const name of await this.persistence.listChildRunFiles(runId)) {
      try {
        records.push(await this.persistence.readChildRun(runId, name.slice(0, -5)))
      } catch {
        // Invalid records are quarantined by the private persistence implementation.
      }
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.childRunId.localeCompare(b.childRunId))
  }

  async reconcileOrphanedChildRuns(): Promise<AgentRunChildRecord[]> {
    return this.persistence.serialize(() => this.reconcileOrphanedChildRunsPersisted())
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
      await this.reconcileOrphanedChildRunsPersisted()
      return interrupted
    })
  }

  private async reconcileOrphanedChildRunsPersisted(): Promise<AgentRunChildRecord[]> {
    const reconciled: AgentRunChildRecord[] = []
    for (const runId of await this.persistence.listChildRunParentIds()) {
      const parent = await this.persistence.readCheckpoint(runId).catch(() => null)
      for (const name of await this.persistence.listChildRunFiles(runId)) {
        let child: AgentRunChildRecord
        try {
          child = await this.persistence.readChildRun(runId, name.slice(0, -5))
        } catch {
          continue
        }
        const next = reconcileChildRun(child, parent, this.persistence.timestamp())
        if (!next) continue
        await this.persistence.writeChildRun(next, true)
        reconciled.push(next)
      }
    }
    return reconciled.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.childRunId.localeCompare(b.childRunId))
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

function reconcileChildRun(
  child: AgentRunChildRecord,
  parent: AgentRunCheckpoint | null,
  at: string
): AgentRunChildRecord | null {
  if (child.status !== 'queued' && child.status !== 'running') return null

  const parentTerminal = parent?.status === 'completed' || parent?.status === 'failed' || parent?.status === 'canceled'
  const parentInterrupted = parent?.status === 'interrupted'
  if (child.status === 'queued' && (!parent || parentInterrupted)) {
    return {
      ...child,
      status: 'recoverable',
      updatedAt: at,
      recoveredAt: at,
      recoveryReason: parent
        ? '应用重启时子任务仍在队列中，尚未执行，可由用户明确重新运行。'
        : '父运行记录不可用；子任务尚未执行，可由用户明确重新运行。'
    }
  }

  // The public reconciliation seam may be called while the app is still alive. An active parent
  // still owns its queued/running children, so only startup's parent interruption pass may settle
  // them. This also keeps repeated or early calls from canceling live work.
  if (parent && !parentInterrupted && !parentTerminal) return null

  return {
    ...child,
    status: 'canceled',
    completedAt: at,
    updatedAt: at,
    recoveredAt: at,
    summary: child.summary ?? '应用重启时子任务未完成，已取消。',
    recoveryReason: parentTerminal
      ? '父运行已经结束；未完成子任务已取消。'
      : parent
        ? '应用重启时子任务正在执行，无法安全继续，已取消。'
        : '父运行记录不可用；未完成子任务已取消。'
  }
}

function isLegalChildTransition(
  from: AgentRunChildRecord['status'],
  to: AgentRunChildRecord['status']
): boolean {
  if (from === to) return true
  if (from === 'queued') return to === 'running' || to === 'canceled'
  if (from === 'running') return to === 'completed' || to === 'failed' || to === 'canceled'
  return false
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}
