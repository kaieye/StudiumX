import type { AgentRealtimeEvent, AgentRunTerminalNotice, InterruptedAgentRun } from '../../shared/teaching-types'
import { AgentOperationJournal } from './agent-operation-journal'
import { AgentParentTurnStaging } from './agent-parent-turn-staging'
import { AgentRunPersistence } from './agent-run-persistence'
import { assertSafeId, emptyAgentRunUsage } from './agent-run-types'
import type {
  AgentParentTurnStage,
  AgentParentTurnStageStatus,
  AgentRunCheckpoint,
  AgentRunCheckpointStatus,
  AgentRunChildRecord
} from './agent-run-types'

const ACTIVE_STATUSES = new Set<AgentRunCheckpointStatus>([
  'running',
  'waiting_for_permission',
  'waiting_for_elicitation',
  'awaiting_conversation_save'
])

/**
 * The run-orchestration seam. Callers get lifecycle and recovery behaviour without learning
 * anything about operation records, JSON persistence, path safety, or atomic writes.
 */
export class AgentRunLifecycle {
  constructor(
    private readonly persistence: AgentRunPersistence,
    private readonly operations: AgentOperationJournal,
    private readonly parentTurns: AgentParentTurnStaging
  ) {}

  async create(input: {
    runId: string
    streamId: string
    workspaceId?: string
    conversationId?: string
    parentTurn?: { userInput: string }
  }): Promise<AgentRunCheckpoint> {
    assertSafeId(input.runId, 'runId')
    assertSafeId(input.streamId, 'streamId')
    if (input.workspaceId) assertSafeId(input.workspaceId, 'workspaceId')
    if (input.conversationId) assertSafeId(input.conversationId, 'conversationId')
    return this.persistence.serialize(async () => {
      const parentTurnStage = input.parentTurn
        ? await this.parentTurns.createPersisted({
            runId: input.runId,
            streamId: input.streamId,
            ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
            ...(input.conversationId ? { conversationId: input.conversationId } : {}),
            userInput: input.parentTurn.userInput
          })
        : null
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
        ...(parentTurnStage ? { parentTurnStagingPointer: `.agent-sessions/parent-turns/${input.runId}.json` } : {}),
        operationJournalPointer: `.agent-sessions/operations/${input.runId}`,
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
      await this.parentTurns.syncCheckpointPersisted(next)
      return next
    })
  }

  async readCheckpoint(runId: string): Promise<AgentRunCheckpoint> {
    return this.persistence.readCheckpoint(runId)
  }

  recordParentTurnEvent(runId: string, event: AgentRealtimeEvent): Promise<AgentParentTurnStage | null> {
    return this.persistence.serialize(async () => {
      const stage = await this.readParentTurnStageOptional(runId)
      if (!stage || isTerminalParentTurnStage(stage.status)) return stage

      const nextStage = await this.parentTurns.recordEventPersisted(stage, event)

      // A crash after the staging write but before the checkpoint write is repaired by replaying
      // the same event: the staging reducer remains idempotent while the checkpoint catches up.
      const checkpoint = await this.persistence.readCheckpoint(runId).catch((error) => {
        if (isNotFound(error)) return null
        throw error
      })
      const nextDurableSequence = Math.max(
        checkpoint?.lastDurableSequence ?? 0,
        nextStage.lastDurableSequence,
        event.sequence
      )
      if (checkpoint && nextDurableSequence > checkpoint.lastDurableSequence) {
        const nextCheckpoint: AgentRunCheckpoint = {
          ...checkpoint,
          lastDurableSequence: nextDurableSequence,
          updatedAt: this.persistence.timestamp()
        }
        await this.persistence.writeCheckpoint(nextCheckpoint, true)
      }
      return nextStage
    })
  }

  confirmParentTurnFinal(runId: string, finalText: string): Promise<AgentParentTurnStage | null> {
    return this.parentTurns.confirmFinal(runId, finalText)
  }

  prepareParentTurnSave(
    runId: string,
    targetConversationId: string,
    expectedParentTurnProof: string
  ): Promise<AgentParentTurnStage | null> {
    return this.parentTurns.prepareSave(runId, targetConversationId, expectedParentTurnProof)
  }

  settleParentTurn(
    runId: string,
    targetConversationId: string,
    expectedParentTurnProof: string
  ): Promise<AgentParentTurnStage | null> {
    return this.persistence.serialize(async () => {
      const stage = await this.readParentTurnStageOptional(runId)
      if (!stage) throw new Error('Parent turn staging is unavailable.')
      const settled = await this.settleParentTurnPersisted(stage, targetConversationId, expectedParentTurnProof)
      await this.completeCheckpointPersisted(runId)
      return settled
    })
  }

  markParentTurnTerminal(
    runId: string,
    status: 'failed' | 'canceled',
    reason?: string
  ): Promise<AgentParentTurnStage | null> {
    return this.parentTurns.markTerminal(runId, status, reason)
  }

  readParentTurnStage(runId: string): Promise<AgentParentTurnStage> {
    return this.parentTurns.read(runId)
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

  async reconcileInterrupted(
    isConversationSaved?: (stage: AgentParentTurnStage) => boolean | Promise<boolean>
  ): Promise<InterruptedAgentRun[]> {
    return this.persistence.serialize(async () => {
      const interrupted: InterruptedAgentRun[] = []
      const checkpoints = new Map<string, AgentRunCheckpoint>()
      for (const name of await this.persistence.listCheckpointFiles()) {
        try {
          const checkpoint = await this.persistence.readCheckpointFile(name)
          checkpoints.set(checkpoint.runId, checkpoint)
        } catch {
          // Invalid checkpoint records are quarantined and do not block staging recovery.
        }
      }

      const stagedRunIds = new Set<string>()
      for (const stage of await this.parentTurns.list()) {
        stagedRunIds.add(stage.runId)
        const checkpoint = checkpoints.get(stage.runId) ?? null

        if (stage.status === 'settled') {
          if (checkpoint && checkpoint.status !== 'completed') {
            checkpoints.set(stage.runId, await this.completeCheckpointPersisted(stage.runId) ?? checkpoint)
          }
          continue
        }

        if (stage.status === 'failed' || stage.status === 'canceled') {
          if (checkpoint && isActiveCheckpointStatus(checkpoint.status)) {
            checkpoints.set(stage.runId, await this.terminalCheckpointPersisted(checkpoint, stage.status))
          }
          continue
        }

        if (checkpoint?.status === 'failed' || checkpoint?.status === 'canceled') {
          await this.parentTurns.syncCheckpointPersisted(checkpoint)
          continue
        }

        if (stage.status === 'awaiting_conversation_save') {
          const saved = stage.targetConversationId && stage.expectedParentTurnProof && isConversationSaved
            ? await Promise.resolve(isConversationSaved(stage)).catch(() => false)
            : false
          if (saved) {
            await this.settleParentTurnPersisted(
              stage,
              stage.targetConversationId!,
              stage.expectedParentTurnProof!
            )
            if (checkpoint) {
              checkpoints.set(stage.runId, await this.completeCheckpointPersisted(stage.runId) ?? checkpoint)
            }
            // Keep the settled record durable. It prevents a later cleanup failure or restart from
            // appending the already-saved parent turn a second time.
            continue
          }
        }

        if (isActiveParentTurnStage(stage.status)) {
          const reason = interruptionReason(stage.status)
          // Operation reconciliation comes first. If recovery crashes afterward, retrying it is
          // idempotent; doing it last could leave both lifecycle records interrupted while a
          // started side effect remains permanently hidden from manual review.
          const reviewCount = await this.operations.reconcileInterruptedOperations(stage.runId)
          const interruptedStage = await this.parentTurns.interruptPersisted(stage, reason)
          if (checkpoint && isActiveCheckpointStatus(checkpoint.status)) {
            const interruptedCheckpoint = await this.interruptCheckpointPersisted(
              checkpoint,
              interruptedStage.previousStatus ?? checkpoint.status,
              reason,
              interruptedStage.lastDurableSequence
            )
            checkpoints.set(stage.runId, interruptedCheckpoint)
            interrupted.push(toInterruptedRun(interruptedCheckpoint, reviewCount, interruptedStage))
          } else if (!checkpoint || checkpoint.status === 'completed') {
            interrupted.push(toInterruptedStage(interruptedStage, reviewCount))
          }
          continue
        }

        // Reconcile operations even when both lifecycle records were already interrupted. This
        // closes the crash window between persisting interruption state and marking started side
        // effects as needs_review.
        if (stage.status === 'interrupted') {
          const reviewCount = await this.operations.reconcileInterruptedOperations(stage.runId)
          if (checkpoint && isActiveCheckpointStatus(checkpoint.status)) {
            const reason = stage.recoveryReason ?? interruptionReason(stage.previousStatus ?? checkpoint.status)
            const interruptedCheckpoint = await this.interruptCheckpointPersisted(
              checkpoint,
              stage.previousStatus ?? checkpoint.status,
              reason,
              stage.lastDurableSequence
            )
            checkpoints.set(stage.runId, interruptedCheckpoint)
            interrupted.push(toInterruptedRun(interruptedCheckpoint, reviewCount, stage))
          }
        }
      }

      // Checkpoints written before Phase 7 have no parent-turn staging record. Preserve their
      // original recovery behaviour, including active awaiting-conversation-save checkpoints.
      for (const checkpoint of checkpoints.values()) {
        if (stagedRunIds.has(checkpoint.runId) || !isActiveCheckpointStatus(checkpoint.status)) continue
        const reason = interruptionReason(checkpoint.status)
        const reviewCount = await this.operations.reconcileInterruptedOperations(checkpoint.runId)
        const interruptedCheckpoint = await this.interruptCheckpointPersisted(
          checkpoint,
          checkpoint.status,
          reason,
          checkpoint.lastDurableSequence
        )
        interrupted.push(toInterruptedRun(interruptedCheckpoint, reviewCount))
      }

      await this.reconcileOrphanedChildRunsPersisted()
      return interrupted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    })
  }

  private async readParentTurnStageOptional(runId: string): Promise<AgentParentTurnStage | null> {
    return this.parentTurns.read(runId).catch((error) => {
      if (isNotFound(error)) return null
      throw error
    })
  }

  private async completeCheckpointPersisted(runId: string): Promise<AgentRunCheckpoint | null> {
    const checkpoint = await this.persistence.readCheckpoint(runId).catch((error) => {
      if (isNotFound(error)) return null
      throw error
    })
    if (!checkpoint || checkpoint.status === 'completed') return checkpoint
    const at = this.persistence.timestamp()
    const completed: AgentRunCheckpoint = {
      ...checkpoint,
      status: 'completed',
      previousStatus: undefined,
      pendingPermissionId: undefined,
      pendingElicitationId: undefined,
      interruptedAt: undefined,
      interruptionReason: undefined,
      completedAt: checkpoint.completedAt ?? at,
      updatedAt: at
    }
    await this.persistence.writeCheckpoint(completed, true)
    return completed
  }

  private async terminalCheckpointPersisted(
    checkpoint: AgentRunCheckpoint,
    status: 'failed' | 'canceled'
  ): Promise<AgentRunCheckpoint> {
    const at = this.persistence.timestamp()
    const terminal: AgentRunCheckpoint = {
      ...checkpoint,
      status,
      previousStatus: undefined,
      pendingPermissionId: undefined,
      pendingElicitationId: undefined,
      interruptedAt: undefined,
      interruptionReason: undefined,
      completedAt: checkpoint.completedAt ?? at,
      updatedAt: at
    }
    await this.persistence.writeCheckpoint(terminal, true)
    return terminal
  }

  private async interruptCheckpointPersisted(
    checkpoint: AgentRunCheckpoint,
    previousStatus: InterruptedAgentRun['previousStatus'],
    reason: string,
    lastDurableSequence: number
  ): Promise<AgentRunCheckpoint> {
    const at = this.persistence.timestamp()
    const interrupted: AgentRunCheckpoint = {
      ...checkpoint,
      status: 'interrupted',
      previousStatus,
      lastDurableSequence: Math.max(checkpoint.lastDurableSequence, lastDurableSequence),
      pendingPermissionId: undefined,
      pendingElicitationId: undefined,
      interruptedAt: checkpoint.interruptedAt ?? at,
      updatedAt: at,
      interruptionReason: reason
    }
    await this.persistence.writeCheckpoint(interrupted, true)
    return interrupted
  }

  private async settleParentTurnPersisted(
    stage: AgentParentTurnStage,
    targetConversationId: string,
    expectedParentTurnProof: string
  ): Promise<AgentParentTurnStage> {
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
    const at = this.persistence.timestamp()
    const settled: AgentParentTurnStage = {
      ...stage,
      status: 'settled',
      boundary: 'conversation_save',
      targetConversationId,
      expectedParentTurnProof,
      settledAt: stage.settledAt ?? at,
      updatedAt: at,
      recoveryReason: undefined
    }
    await this.persistence.writeParentTurnStage(settled, true)
    return settled
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

  /**
   * Read-only restart projection for terminal resource/retry boundaries. This
   * deliberately does not create a continuation intent or replay work.
   */
  async listTerminalNotices(): Promise<AgentRunTerminalNotice[]> {
    const out: AgentRunTerminalNotice[] = []
    const stages = await this.parentTurns.list()
    const stagesByRunId = new Map(stages.map((stage) => [stage.runId, stage]))
    for (const name of await this.persistence.listCheckpointFiles()) {
      try {
        const checkpoint = await this.persistence.readCheckpointFile(name)
        const stopReason = terminalNoticeStopReason(checkpoint)
        if (!stopReason || checkpoint.status !== 'failed' || !checkpoint.completedAt) continue
        out.push(toTerminalNotice(
          checkpoint,
          stopReason,
          await this.operations.countReviewOperations(checkpoint.runId),
          stagesByRunId.get(checkpoint.runId)
        ))
      } catch {
        // Invalid records have already been quarantined and never reach the renderer.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listInterrupted(): Promise<InterruptedAgentRun[]> {
    const out: InterruptedAgentRun[] = []
    const stages = await this.parentTurns.list()
    const stagesByRunId = new Map(stages.map((stage) => [stage.runId, stage]))
    const checkpointRunIds = new Set<string>()
    for (const name of await this.persistence.listCheckpointFiles()) {
      try {
        const checkpoint = await this.persistence.readCheckpointFile(name)
        if (checkpoint.status !== 'interrupted' || !checkpoint.previousStatus || !checkpoint.interruptedAt) continue
        checkpointRunIds.add(checkpoint.runId)
        out.push(toInterruptedRun(
          checkpoint,
          await this.operations.countReviewOperations(checkpoint.runId),
          stagesByRunId.get(checkpoint.runId)
        ))
      } catch {
        // Invalid records have already been quarantined and never reach the renderer.
      }
    }
    for (const stage of stages) {
      if (checkpointRunIds.has(stage.runId) || stage.status !== 'interrupted') continue
      try {
        out.push(toInterruptedStage(stage, await this.operations.countReviewOperations(stage.runId)))
      } catch {
        // Incomplete interrupted staging records remain quarantined from renderer-facing state.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

}

function terminalNoticeStopReason(
  checkpoint: AgentRunCheckpoint
): AgentRunTerminalNotice['stopReason'] | undefined {
  if (checkpoint.stopReason === 'resource_limit'
    || checkpoint.stopReason === 'suspended'
    || checkpoint.stopReason === 'retry_exhausted'
    || checkpoint.stopReason === 'no_progress'
    || checkpoint.stopReason === 'context_unrecoverable') {
    return checkpoint.stopReason
  }
  return undefined
}

function toTerminalNotice(
  checkpoint: AgentRunCheckpoint,
  stopReason: AgentRunTerminalNotice['stopReason'],
  operationReviewCount: number,
  stage?: AgentParentTurnStage
): AgentRunTerminalNotice {
  if (checkpoint.status !== 'failed' || !checkpoint.completedAt) {
    throw new Error('Terminal checkpoint is incomplete.')
  }
  return {
    runId: checkpoint.runId,
    streamId: checkpoint.streamId,
    ...(checkpoint.workspaceId ? { workspaceId: checkpoint.workspaceId } : {}),
    ...(checkpoint.conversationId ? { conversationId: checkpoint.conversationId } : {}),
    status: 'failed',
    stopReason,
    updatedAt: checkpoint.updatedAt,
    completedAt: checkpoint.completedAt,
    operationReviewCount,
    usage: checkpoint.usage,
    ...(stage ? parentTurnRecoveryEvidence(stage) : {})
  }
}

function toInterruptedRun(
  checkpoint: AgentRunCheckpoint,
  operationReviewCount: number,
  stage?: AgentParentTurnStage
): InterruptedAgentRun {
  if (!checkpoint.previousStatus || !checkpoint.interruptedAt) throw new Error('Interrupted checkpoint is incomplete.')
  return {
    runId: checkpoint.runId,
    streamId: checkpoint.streamId,
    ...(checkpoint.workspaceId ? { workspaceId: checkpoint.workspaceId } : {}),
    ...(checkpoint.conversationId ? { conversationId: checkpoint.conversationId } : {}),
    status: 'interrupted',
    previousStatus: checkpoint.previousStatus,
    lastDurableSequence: Math.max(checkpoint.lastDurableSequence, stage?.lastDurableSequence ?? 0),
    updatedAt: checkpoint.updatedAt,
    interruptedAt: checkpoint.interruptedAt,
    reason: checkpoint.interruptionReason ?? stage?.recoveryReason ?? '上次运行被中断。',
    operationReviewCount,
    usage: checkpoint.usage,
    ...(stage ? parentTurnRecoveryEvidence(stage) : {})
  }
}

function toInterruptedStage(stage: AgentParentTurnStage, operationReviewCount: number): InterruptedAgentRun {
  if (stage.status !== 'interrupted' || !stage.previousStatus || !stage.interruptedAt) {
    throw new Error('Interrupted parent turn staging record is incomplete.')
  }
  return {
    runId: stage.runId,
    streamId: stage.streamId,
    ...(stage.workspaceId ? { workspaceId: stage.workspaceId } : {}),
    ...(stage.conversationId ? { conversationId: stage.conversationId } : {}),
    status: 'interrupted',
    previousStatus: stage.previousStatus,
    lastDurableSequence: stage.lastDurableSequence,
    updatedAt: stage.updatedAt,
    interruptedAt: stage.interruptedAt,
    reason: stage.recoveryReason ?? '上次运行被中断。',
    operationReviewCount,
    usage: emptyAgentRunUsage(),
    ...parentTurnRecoveryEvidence(stage)
  }
}

function parentTurnRecoveryEvidence(stage: AgentParentTurnStage) {
  return {
    userInputPreview: stage.userInput.preview,
    userInputSha256: stage.userInput.sha256,
    ...(stage.confirmedAssistant ? {
      confirmedAssistantPreview: stage.confirmedAssistant.preview,
      confirmedAssistantSha256: stage.confirmedAssistant.sha256,
      confirmedAssistantTruncated: stage.confirmedAssistant.truncated
    } : {}),
    unrecoverableAssistantDeltaBytes: stage.unrecoverableAssistantDeltaBytes,
    evidence: stage.evidence.map((item) => ({ ...item }))
  }
}

function isTerminalParentTurnStage(status: AgentParentTurnStageStatus): boolean {
  return status === 'settled' || status === 'failed' || status === 'canceled' || status === 'interrupted'
}

function isActiveCheckpointStatus(
  status: AgentRunCheckpointStatus
): status is InterruptedAgentRun['previousStatus'] {
  return ACTIVE_STATUSES.has(status)
}

function isActiveParentTurnStage(
  status: AgentParentTurnStageStatus
): status is Extract<AgentParentTurnStageStatus, InterruptedAgentRun['previousStatus']> {
  return status === 'running'
    || status === 'waiting_for_permission'
    || status === 'waiting_for_elicitation'
    || status === 'awaiting_conversation_save'
}

function interruptionReason(status: InterruptedAgentRun['previousStatus']): string {
  return status === 'awaiting_conversation_save'
    ? '最终回复已确认，但应用在会话保存完成前退出；恢复证据不会自动重复追加到会话。'
    : '应用在运行完成前退出；旧审批和追问已失效，需要用户明确继续或重新发送。'
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
