/**
 * Main-process TeachingTurnCoordinator.
 *
 * Deep orchestration behind ports only: composes existing ledger / recorder /
 * committer / planner / assembler / grounder / resolver. No IPC or UI wiring.
 * Durable receipts are emitted before ephemeral projections. Terminal mapping
 * is learner-safe and sticky per turn. Renderer never authors mastery/save.
 */

import { createHash } from 'node:crypto'

import type { LearningSessionLedger } from './learning-session-ledger'
import type { LessonInteractionRecorder } from './lesson-interaction-recorder'
import type { LearningOutcomeCommitter, OutcomeCommitResult } from './learning-outcome-committer'
import type { NextTeachingStepPlanner } from './next-teaching-step-planner'
import { createTeachingContextAssembler, type TeachingContextAssembler } from './teaching-context-assembler'
import type { ResourceGrounder } from './resource-grounder'
import {
  loadTeachingLoopFactSource,
  type TeachingLoopFactSourceLoaderInput,
  type TeachingLoopFactSourcePorts
} from './teaching-loop-fact-source'
import { createTeachingTurnEventBus, type TeachingTurnEventBus } from './teaching-turn-event-bus'
import {
  mapCommitStatusToTerminal,
  type TeachingEventEnvelope,
  type TeachingTurnTerminalOutcome
} from '../shared/teaching-events'
import type { OpenLearningSessionInput } from '../shared/teaching-types/learning-session'
import type { LessonInteraction } from '../shared/teaching-types/lesson-interaction'
import type { LearningOutcomeCommitRequest } from '../shared/teaching-types/learning-outcome'
import type { TeachingLoopSnapshot } from '../shared/teaching-types/teaching-loop'
import type { NextTeachingStepDecision, NextTeachingStepFacts } from '../shared/teaching-types/next-teaching-step'
import type { TeachingContextAssembly } from './teaching-context-assembler'

export type TeachingTurnCommandType =
  | 'open_session'
  | 'resume_session'
  | 'record_evidence'
  | 'commit_outcome'
  | 'plan_next_step'
  | 'project_snapshot'
  | 'recover_session'
  | 'cancel_turn'

export type TeachingTurnOpenSessionCommand = {
  type: 'open_session'
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
  open: OpenLearningSessionInput
}

export type TeachingTurnResumeSessionCommand = {
  type: 'resume_session'
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
  sessionId: string
}

export type TeachingTurnRecordEvidenceCommand = {
  type: 'record_evidence'
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
  evidence: LessonInteraction
}

export type TeachingTurnCommitOutcomeCommand = {
  type: 'commit_outcome'
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
  request: LearningOutcomeCommitRequest
}

export type TeachingTurnPlanNextStepCommand = {
  type: 'plan_next_step'
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
  sessionId: string
  facts: NextTeachingStepFacts
}

export type TeachingTurnProjectSnapshotCommand = {
  type: 'project_snapshot'
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
  factInput: TeachingLoopFactSourceLoaderInput
}

export type TeachingTurnRecoverSessionCommand = {
  type: 'recover_session'
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
  sessionId: string
}

export type TeachingTurnCancelCommand = {
  type: 'cancel_turn'
  turnId: string
  eventId: string
  operationId: string
  workspaceId: string
  sessionId: string
  reasonCode?: string
}

export type TeachingTurnCommand =
  | TeachingTurnOpenSessionCommand
  | TeachingTurnResumeSessionCommand
  | TeachingTurnRecordEvidenceCommand
  | TeachingTurnCommitOutcomeCommand
  | TeachingTurnPlanNextStepCommand
  | TeachingTurnProjectSnapshotCommand
  | TeachingTurnRecoverSessionCommand
  | TeachingTurnCancelCommand

export type TeachingTurnCoordinatorPorts = {
  ledger: Pick<LearningSessionLedger, 'open' | 'load' | 'scan'>
  recorder: Pick<LessonInteractionRecorder, 'record'>
  committer: Pick<LearningOutcomeCommitter, 'commit' | 'reconcile'>
  planner?: Pick<NextTeachingStepPlanner, 'plan'>
  assembler?: Pick<TeachingContextAssembler, 'assemble'>
  grounder?: ResourceGrounder
  factSource?: TeachingLoopFactSourcePorts
  now?: () => string
}

export type TeachingTurnExecuteResult = {
  turnId: string
  sessionId: string
  events: TeachingEventEnvelope[]
  terminal: TeachingEventEnvelope | null
  snapshot?: TeachingLoopSnapshot
  nextStep?: NextTeachingStepDecision
  context?: TeachingContextAssembly
  commitResult?: OutcomeCommitResult
}

export interface TeachingTurnCoordinator {
  execute(command: TeachingTurnCommand): Promise<TeachingTurnExecuteResult>
  /** Subscribe to live turn events (ephemeral stream only). */
  subscribe(turnId: string, listener: (event: TeachingEventEnvelope) => void): () => void
  replayAfter(turnId: string, afterSequence?: number): ReturnType<TeachingTurnEventBus['replayAfter']> | null
}

type OperationRecord = {
  operationId: string
  eventId: string
  turnId: string
  sessionId: string
  result: TeachingTurnExecuteResult
}

export function createTeachingTurnCoordinator(ports: TeachingTurnCoordinatorPorts): TeachingTurnCoordinator {
  return new DefaultTeachingTurnCoordinator(ports)
}

class DefaultTeachingTurnCoordinator implements TeachingTurnCoordinator {
  private readonly now: () => string
  private readonly sessionTails = new Map<string, Promise<void>>()
  private readonly operations = new Map<string, OperationRecord>()
  private readonly eventIdIndex = new Map<string, OperationRecord>()
  private readonly buses = new Map<string, TeachingTurnEventBus>()
  private readonly turnSubscriptions = new Map<string, Set<(event: TeachingEventEnvelope) => void>>()

  constructor(private readonly ports: TeachingTurnCoordinatorPorts) {
    this.now = ports.now ?? (() => new Date().toISOString())
  }

  subscribe(turnId: string, listener: (event: TeachingEventEnvelope) => void): () => void {
    const set = this.turnSubscriptions.get(turnId) ?? new Set()
    set.add(listener)
    this.turnSubscriptions.set(turnId, set)
    const bus = this.buses.get(turnId)
    const unsubscribeBus = bus?.subscribe(listener)
    return () => {
      set.delete(listener)
      unsubscribeBus?.()
      if (set.size === 0) this.turnSubscriptions.delete(turnId)
    }
  }

  replayAfter(turnId: string, afterSequence = 0) {
    return this.buses.get(turnId)?.replayAfter(afterSequence) ?? null
  }

  async execute(command: TeachingTurnCommand): Promise<TeachingTurnExecuteResult> {
    const sessionId = sessionIdOf(command)
    return this.serialize(sessionId, async () => {
      const byOperation = this.operations.get(command.operationId)
      if (byOperation) {
        return this.duplicateResult(command, byOperation)
      }
      const byEvent = this.eventIdIndex.get(command.eventId)
      if (byEvent) {
        return this.duplicateResult(command, byEvent)
      }

      const bus = this.ensureBus(command.turnId)
      const collected: TeachingEventEnvelope[] = []
      const collect = (event: TeachingEventEnvelope) => {
        collected.push(event)
      }
      const unsubscribe = bus.subscribe(collect)

      try {
        this.emit(bus, {
          durability: 'ephemeral',
          occurredAt: this.now(),
          workspaceId: command.workspaceId,
          sessionId,
          turnId: command.turnId,
          eventId: `${command.eventId}:accepted`,
          operationId: command.operationId,
          payload: {
            type: 'command_accepted',
            commandType: command.type
          }
        })

        let result: TeachingTurnExecuteResult
        switch (command.type) {
          case 'open_session':
            result = await this.openSession(command, bus, collected)
            break
          case 'resume_session':
            result = await this.resumeSession(command, bus, collected)
            break
          case 'record_evidence':
            result = await this.recordEvidence(command, bus, collected)
            break
          case 'commit_outcome':
            result = await this.commitOutcome(command, bus, collected)
            break
          case 'plan_next_step':
            result = await this.planNextStep(command, bus, collected)
            break
          case 'project_snapshot':
            result = await this.projectSnapshot(command, bus, collected)
            break
          case 'recover_session':
            result = await this.recoverSession(command, bus, collected)
            break
          case 'cancel_turn':
            result = await this.cancelTurn(command, bus, collected)
            break
        }

        const record: OperationRecord = {
          operationId: command.operationId,
          eventId: command.eventId,
          turnId: command.turnId,
          sessionId,
          result
        }
        this.operations.set(command.operationId, record)
        this.eventIdIndex.set(command.eventId, record)
        return result
      } finally {
        unsubscribe()
      }
    })
  }

  private async openSession(
    command: TeachingTurnOpenSessionCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    const snapshot = await this.ports.ledger.open(command.open)
    // Durable receipt first.
    this.emit(bus, {
      durability: 'durable',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId: snapshot.id,
      turnId: command.turnId,
      eventId: command.eventId,
      operationId: command.operationId,
      payload: {
        type: 'session_opened',
        sessionId: snapshot.id,
        courseId: snapshot.courseRef.courseId,
        status: snapshot.status === 'completed' ? 'completed' : 'active',
        source: snapshot.source
      }
    })

    this.emitProgress(bus, command, snapshot.id, 'session_opened')
    this.emitTerminal(bus, command, snapshot.id, 'completed', 'session_opened')

    return {
      turnId: command.turnId,
      sessionId: snapshot.id,
      events: [...collected],
      terminal: bus.terminal()
    }
  }

  private async resumeSession(
    command: TeachingTurnResumeSessionCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    const snapshot = await this.ports.ledger.load(command.sessionId)
    if (!snapshot) {
      this.emitTerminal(bus, command, command.sessionId, 'failed', 'session_not_found')
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal()
      }
    }

    this.emit(bus, {
      durability: 'durable',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId: snapshot.id,
      turnId: command.turnId,
      eventId: command.eventId,
      operationId: command.operationId,
      payload: {
        type: 'session_resumed',
        sessionId: snapshot.id,
        status: snapshot.status,
        eventCount: snapshot.eventCount
      }
    })

    this.emitProgress(bus, command, snapshot.id, 'session_resumed')
    this.emitTerminal(bus, command, snapshot.id, 'completed', 'session_resumed')

    return {
      turnId: command.turnId,
      sessionId: snapshot.id,
      events: [...collected],
      terminal: bus.terminal()
    }
  }

  private async recordEvidence(
    command: TeachingTurnRecordEvidenceCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    const receipt = await this.ports.recorder.record(command.evidence)

    this.emit(bus, {
      durability: 'durable',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId: receipt.sessionId,
      turnId: command.turnId,
      eventId: command.eventId,
      itemId: command.evidence.itemId,
      operationId: command.operationId,
      payload: {
        type: 'evidence_recorded',
        sessionId: receipt.sessionId,
        evidenceEventId: receipt.eventId,
        sequence: receipt.sequence,
        duplicate: receipt.duplicate,
        kind: command.evidence.kind
      }
    })

    this.emitProgress(bus, command, receipt.sessionId, 'evidence_recorded')
    this.emitTerminal(bus, command, receipt.sessionId, 'completed', receipt.duplicate ? 'evidence_duplicate' : 'evidence_recorded')

    return {
      turnId: command.turnId,
      sessionId: receipt.sessionId,
      events: [...collected],
      terminal: bus.terminal()
    }
  }

  private async commitOutcome(
    command: TeachingTurnCommitOutcomeCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    const commitResult = await this.ports.committer.commit(command.request)
    const sessionId = command.request.sessionId

    if (commitResult.status === 'committed' || commitResult.status === 'already_committed') {
      this.emit(bus, {
        durability: 'durable',
        occurredAt: this.now(),
        workspaceId: command.workspaceId,
        sessionId,
        turnId: command.turnId,
        eventId: command.eventId,
        operationId: command.operationId,
        payload: {
          type: commitResult.status === 'committed' ? 'outcome_committed' : 'outcome_already_committed',
          sessionId,
          outcomeKind: commitResult.outcome.kind,
          recordSaved: commitResult.recordSaved
        }
      })
    } else if (commitResult.status === 'insufficient_evidence') {
      this.emit(bus, {
        durability: 'durable',
        occurredAt: this.now(),
        workspaceId: command.workspaceId,
        sessionId,
        turnId: command.turnId,
        eventId: command.eventId,
        operationId: command.operationId,
        payload: {
          type: 'outcome_insufficient_evidence',
          sessionId,
          reason: 'not_evidenced'
        }
      })
    }

    const terminal = mapCommitStatusToTerminal(commitResult.status)
    this.emitProgress(bus, command, sessionId, 'outcome_settled', commitResult.status)
    this.emitTerminal(bus, command, sessionId, terminal, commitResult.status)

    return {
      turnId: command.turnId,
      sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      commitResult
    }
  }

  private async planNextStep(
    command: TeachingTurnPlanNextStepCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    if (!this.ports.planner) {
      this.emitTerminal(bus, command, command.sessionId, 'failed', 'planner_unavailable')
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal()
      }
    }

    const nextStep = this.ports.planner.plan(command.facts)

    // Decision is derived, not durable authority.
    this.emit(bus, {
      durability: 'ephemeral',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId: command.sessionId,
      turnId: command.turnId,
      eventId: command.eventId,
      operationId: command.operationId,
      payload: {
        type: 'next_step',
        action: nextStep.action,
        reason: nextStep.reason
      }
    })

    this.emitTerminal(bus, command, command.sessionId, 'completed', 'next_step_planned')

    return {
      turnId: command.turnId,
      sessionId: command.sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      nextStep
    }
  }

  private async projectSnapshot(
    command: TeachingTurnProjectSnapshotCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    const factPorts = this.ports.factSource ?? {
      ledger: this.ports.ledger,
      committer: this.ports.committer
    }
    const loaded = await loadTeachingLoopFactSource(factPorts, command.factInput)
    const sessionId =
      loaded.snapshot.safeProjection.session?.id ??
      command.factInput.sessionId ??
      command.factInput.course.id

    // Durable facts already exist on disk; the projected snapshot is ephemeral.
    this.emit(bus, {
      durability: 'ephemeral',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId,
      turnId: command.turnId,
      eventId: command.eventId,
      operationId: command.operationId,
      payload: {
        type: 'loop_snapshot',
        identity: loaded.snapshot.identity,
        displayState: loaded.snapshot.displayState,
        sessionId: loaded.snapshot.safeProjection.session?.id ?? null,
        outcomeStatus: loaded.snapshot.safeProjection.outcome.status,
        integrityCodes: loaded.snapshot.safeProjection.integrityCodes
      }
    })

    if (loaded.snapshot.nextStep) {
      this.emit(bus, {
        durability: 'ephemeral',
        occurredAt: this.now(),
        workspaceId: command.workspaceId,
        sessionId,
        turnId: command.turnId,
        eventId: `${command.eventId}:next-step`,
        operationId: command.operationId,
        payload: {
          type: 'next_step',
          action: loaded.snapshot.nextStep.action,
          reason: loaded.snapshot.nextStep.reason
        }
      })
    }

    let nextStep: NextTeachingStepDecision | undefined
    if (loaded.snapshot.nextStep) {
      nextStep = {
        schemaVersion: 1,
        action: loaded.snapshot.nextStep.action,
        reason: loaded.snapshot.nextStep.reason,
        safeInputSummary: {
          missionId: loaded.snapshot.safeProjection.missionId,
          courseId: loaded.snapshot.safeProjection.courseId,
          latestSession: loaded.snapshot.safeProjection.session
            ? {
                id: loaded.snapshot.safeProjection.session.id,
                source: loaded.snapshot.safeProjection.session.source,
                readOnly: loaded.snapshot.safeProjection.session.readOnly
              }
            : {
                id: sessionId,
                source: 'canonical',
                readOnly: false
              },
          durableOutcome: {
            status: loaded.snapshot.safeProjection.outcome.status,
            id: loaded.snapshot.safeProjection.outcome.id,
            kind: loaded.snapshot.safeProjection.outcome.kind
          },
          evidence: loaded.snapshot.safeProjection.evidence,
          resources: loaded.snapshot.safeProjection.resources,
          provenance: loaded.snapshot.safeProjection.provenance
        }
      }
    }

    let context: TeachingContextAssembly | undefined
    const assembler =
      this.ports.assembler ??
      (this.ports.grounder ? createTeachingContextAssembler(this.ports.grounder) : undefined)
    if (assembler && nextStep && loaded.snapshot.safeProjection.session) {
      const outcome = loaded.snapshot.safeProjection.outcome
      context = await assembler.assemble(
        {
          mission: {
            id: loaded.snapshot.safeProjection.missionId,
            goalStatus: command.factInput.mission.nextGoal
          },
          course: { id: loaded.snapshot.safeProjection.courseId },
          currentSession: {
            id: loaded.snapshot.safeProjection.session.id,
            source: loaded.snapshot.safeProjection.session.source,
            readOnly: loaded.snapshot.safeProjection.session.readOnly
          },
          outcome:
            outcome.status === 'trusted' && outcome.id && outcome.kind
              ? { status: 'trusted', id: outcome.id, kind: outcome.kind }
              : { status: outcome.status === 'trusted' ? 'absent' : outcome.status },
          nextStep,
          resources: []
        },
        'lesson'
      )
    }

    this.emitTerminal(bus, command, sessionId, 'completed', 'snapshot_projected')

    return {
      turnId: command.turnId,
      sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      snapshot: loaded.snapshot,
      nextStep,
      context
    }
  }

  private async recoverSession(
    command: TeachingTurnRecoverSessionCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    const loaded = await this.ports.ledger.load(command.sessionId)
    if (!loaded) {
      this.emitTerminal(bus, command, command.sessionId, 'failed', 'session_not_found')
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal()
      }
    }
    const reconciliation = await this.ports.committer.reconcile(command.sessionId)

    this.emit(bus, {
      durability: 'durable',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId: command.sessionId,
      turnId: command.turnId,
      eventId: command.eventId,
      operationId: command.operationId,
      payload: {
        type: 'recover_reconciled',
        sessionId: command.sessionId,
        state: reconciliation.state
      }
    })

    const terminal: TeachingTurnTerminalOutcome =
      reconciliation.state === 'review_required' ? 'conflict' : 'completed'
    this.emitTerminal(bus, command, command.sessionId, terminal, reconciliation.state)

    return {
      turnId: command.turnId,
      sessionId: command.sessionId,
      events: [...collected],
      terminal: bus.terminal()
    }
  }

  private async cancelTurn(
    command: TeachingTurnCancelCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    this.emitProgress(bus, command, command.sessionId, 'cancel_requested', command.reasonCode)
    this.emitTerminal(bus, command, command.sessionId, 'canceled', command.reasonCode ?? 'canceled')
    return {
      turnId: command.turnId,
      sessionId: command.sessionId,
      events: [...collected],
      terminal: bus.terminal()
    }
  }

  private duplicateResult(command: TeachingTurnCommand, existing: OperationRecord): TeachingTurnExecuteResult {
    const bus = this.ensureBus(command.turnId)
    const duplicateEvent = this.emit(bus, {
      durability: 'ephemeral',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId: existing.sessionId,
      turnId: command.turnId,
      eventId: `${command.eventId}:duplicate`,
      operationId: command.operationId,
      payload: {
        type: 'command_duplicate',
        commandType: command.type,
        originalEventId: existing.eventId
      }
    })
    // Sticky terminal already present on the original turn bus if same turn; for
    // cross-turn duplicates, re-emit a terminal mapping to completed (idempotent ack).
    if (!bus.terminal()) {
      this.emitTerminal(bus, command, existing.sessionId, 'completed', 'command_duplicate')
    }
    return {
      ...existing.result,
      turnId: command.turnId,
      events: [...existing.result.events, duplicateEvent],
      terminal: bus.terminal() ?? existing.result.terminal
    }
  }

  private ensureBus(turnId: string): TeachingTurnEventBus {
    let bus = this.buses.get(turnId)
    if (!bus) {
      bus = createTeachingTurnEventBus({ turnId, now: this.now })
      this.buses.set(turnId, bus)
      const pending = this.turnSubscriptions.get(turnId)
      if (pending) {
        for (const listener of pending) bus.subscribe(listener)
      }
    }
    return bus
  }

  private emit(
    bus: TeachingTurnEventBus,
    input: Parameters<TeachingTurnEventBus['publish']>[0]
  ): TeachingEventEnvelope {
    return bus.publish(input)
  }

  private emitProgress(
    bus: TeachingTurnEventBus,
    command: TeachingTurnCommand,
    sessionId: string,
    stage: string,
    message?: string
  ): void {
    this.emit(bus, {
      durability: 'ephemeral',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId,
      turnId: command.turnId,
      eventId: `${command.eventId}:progress:${stage}:${stableShort(stage + (message ?? ''))}`,
      operationId: command.operationId,
      payload: {
        type: 'turn_progress',
        stage,
        ...(message !== undefined ? { message } : {})
      }
    })
  }

  private emitTerminal(
    bus: TeachingTurnEventBus,
    command: TeachingTurnCommand,
    sessionId: string,
    outcome: TeachingTurnTerminalOutcome,
    reasonCode?: string
  ): void {
    bus.publishTerminal({
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId,
      turnId: command.turnId,
      eventId: `${command.eventId}:terminal`,
      operationId: command.operationId,
      outcome,
      reasonCode
    })
  }

  private async serialize<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionTails.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.sessionTails.set(sessionId, tail)

    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (this.sessionTails.get(sessionId) === tail) {
        this.sessionTails.delete(sessionId)
      }
    }
  }
}

function sessionIdOf(command: TeachingTurnCommand): string {
  switch (command.type) {
    case 'open_session':
      return command.open.sessionId ?? `pending:${command.operationId}`
    case 'resume_session':
    case 'recover_session':
    case 'cancel_turn':
    case 'plan_next_step':
      return command.sessionId
    case 'record_evidence':
      return command.evidence.sessionId
    case 'commit_outcome':
      return command.request.sessionId
    case 'project_snapshot':
      return command.factInput.sessionId ?? command.factInput.course.id
  }
}

function stableShort(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}




