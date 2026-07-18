/**
 * Main-process TeachingTurnCoordinator.
 *
 * Deep orchestration behind ports only: composes existing ledger / recorder /
 * committer / planner / assembler / grounder / resolver. No IPC or UI wiring.
 * Durable receipts are emitted before ephemeral projections. Terminal mapping
 * is learner-safe and sticky per turn. Renderer never authors mastery/save.
 *
 * Lifecycle model (one turnId spans multiple commands):
 * - Intermediate open/resume/record/plan/project/recover emit progress only
 *   (no sticky terminal on healthy paths).
 * - Only finalization emits one terminal: commit outcome, cancel, or
 *   unrecoverable finalization failure (commit/cancel port throws).
 * - retryable_failure is not sticky; the same turn may retry with a new command.
 * - Recoverable intermediate port failures emit progress and leave the turn open.
 * - After terminal, later commands are rejected (acceptance=rejected,
 *   rejectReason=already_terminal|payload_mismatch|capacity_exceeded). Sticky
 *   terminal is never rewritten; cancel after completed is NOT cancel success.
 * - Cooperative cancellation: no AbortSignal port; cancel is queued on the
 *   per-(workspace,session) serialize gate and runs after any in-flight command.
 *
 * Scope keys:
 * - Buses / closed terminals / subscriptions: (workspaceId, turnId)
 * - Idempotency operations: (workspaceId, sessionId, turnId, commandType, operationId)
 * - Event ids: (workspaceId, sessionId, turnId, eventId)
 * - Operation fingerprint includes turnId (full command body).
 *
 * Capacity policy (fail-closed, no silent eviction of identities):
 * - Active buses, closed-terminal identities, and idempotency records are retained.
 * - Bounded cleanup may reclaim only closed live buses after their terminal is
 *   already retained in the closed map (or can be retained without overflow).
 * - When capacity is exhausted, reject before any command side effects.
 *
 * Authority:
 * - Process-local only: buses, subscriptions, idempotency, and closed terminals
 *   do not survive process restart.
 * - Restart durable authority remains ledger / recorder / committer filesystem truth.
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
import {
  createTeachingTurnEventBus,
  type TeachingTurnEventBus
} from './teaching-turn-event-bus'
import {
  isTeachingTurnTerminalReasonCode,
  mapCommitStatusToTerminal,
  type TeachingEventEnvelope,
  type TeachingTurnTerminalOutcome,
  type TeachingTurnTerminalReasonCode
} from '../shared/teaching-events'
import type { OpenLearningSessionInput } from '../shared/teaching-types/learning-session'
import type { LessonInteraction } from '../shared/teaching-types/lesson-interaction'
import type { LearningOutcomeCommitRequest } from '../shared/teaching-types/learning-outcome'
import type { TeachingLoopSnapshot } from '../shared/teaching-types/teaching-loop'
import type { NextTeachingStepDecision, NextTeachingStepFacts } from '../shared/teaching-types/next-teaching-step'
import type { TeachingContextAssembly } from './teaching-context-assembler'
import type { TrustedTeachingResourceDescriptor } from '../shared/teaching-types/grounding'

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
  /** Ready trusted resources passed through ResourceGrounder -> Assembler. */
  readyResources?: readonly TrustedTeachingResourceDescriptor[]
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
  reasonCode?: TeachingTurnTerminalReasonCode
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
  /** Optional bounds for in-memory caches (tests / constrained runtimes). */
  maxOperations?: number
  maxEventIds?: number
  maxBuses?: number
}

export type TeachingTurnAcceptance = 'accepted' | 'duplicate' | 'rejected'

export type TeachingTurnRejectReason =
  | 'already_terminal'
  | 'payload_mismatch'
  | 'capacity_exceeded'

export type TeachingTurnScope = {
  workspaceId: string
  turnId: string
}

export type TeachingTurnExecuteResult = {
  turnId: string
  sessionId: string
  events: TeachingEventEnvelope[]
  terminal: TeachingEventEnvelope | null
  acceptance: TeachingTurnAcceptance
  rejectReason?: TeachingTurnRejectReason
  snapshot?: TeachingLoopSnapshot
  nextStep?: NextTeachingStepDecision
  context?: TeachingContextAssembly
  commitResult?: OutcomeCommitResult
}

export interface TeachingTurnCoordinator {
  execute(command: TeachingTurnCommand): Promise<TeachingTurnExecuteResult>
  /** Subscribe to live turn events (ephemeral stream only). Scoped by workspace+turn. */
  subscribe(scope: TeachingTurnScope, listener: (event: TeachingEventEnvelope) => void): () => void
  replayAfter(
    scope: TeachingTurnScope,
    afterSequence?: number
  ): ReturnType<TeachingTurnEventBus['replayAfter']> | null
}

type OperationRecord = {
  operationKey: string
  eventKey: string
  operationId: string
  eventId: string
  turnId: string
  workspaceId: string
  sessionId: string
  commandType: TeachingTurnCommandType
  fingerprint: string
  result: TeachingTurnExecuteResult
}

const FINALIZATION_COMMANDS = new Set<TeachingTurnCommandType>(['commit_outcome', 'cancel_turn'])

type PendingSubscription = {
  listener: (event: TeachingEventEnvelope) => void
  attachedUnsub: (() => void) | null
}

const DEFAULT_MAX_OPERATIONS = 256
const DEFAULT_MAX_EVENT_IDS = 256
const DEFAULT_MAX_BUSES = 64

export function createTeachingTurnCoordinator(ports: TeachingTurnCoordinatorPorts): TeachingTurnCoordinator {
  return new DefaultTeachingTurnCoordinator(ports)
}

class DefaultTeachingTurnCoordinator implements TeachingTurnCoordinator {
  private readonly now: () => string
  private readonly maxOperations: number
  private readonly maxEventIds: number
  private readonly maxBuses: number
  /** Process-local serialize tails keyed by workspaceId+sessionId. */
  private readonly sessionTails = new Map<string, Promise<void>>()
  /** Process-local idempotency records; not durable across restart. */
  private readonly operations = new Map<string, OperationRecord>()
  private readonly eventIdIndex = new Map<string, OperationRecord>()
  /** Process-local live buses keyed by workspaceId+turnId. */
  private readonly buses = new Map<string, TeachingTurnEventBus>()
  /** Sticky terminals retained after closed buses are reclaimed from the live map. */
  private readonly closedTurnTerminals = new Map<string, TeachingEventEnvelope>()
  private readonly turnSubscriptions = new Map<string, Set<PendingSubscription>>()

  constructor(private readonly ports: TeachingTurnCoordinatorPorts) {
    this.now = ports.now ?? (() => new Date().toISOString())
    this.maxOperations = Math.max(8, Math.floor(ports.maxOperations ?? DEFAULT_MAX_OPERATIONS))
    this.maxEventIds = Math.max(8, Math.floor(ports.maxEventIds ?? DEFAULT_MAX_EVENT_IDS))
    this.maxBuses = Math.max(4, Math.floor(ports.maxBuses ?? DEFAULT_MAX_BUSES))
  }

  subscribe(scope: TeachingTurnScope, listener: (event: TeachingEventEnvelope) => void): () => void {
    const key = scopeKey(scope.workspaceId, scope.turnId)
    const existingBus = this.buses.get(key)
    if (existingBus) {
      return existingBus.subscribe(listener)
    }

    const pending: PendingSubscription = { listener, attachedUnsub: null }
    let set = this.turnSubscriptions.get(key)
    if (!set) {
      set = new Set()
      this.turnSubscriptions.set(key, set)
    }
    set.add(pending)

    return () => {
      set!.delete(pending)
      pending.attachedUnsub?.()
      pending.attachedUnsub = null
      if (set!.size === 0) this.turnSubscriptions.delete(key)
    }
  }

  replayAfter(scope: TeachingTurnScope, afterSequence = 0) {
    return this.buses.get(scopeKey(scope.workspaceId, scope.turnId))?.replayAfter(afterSequence) ?? null
  }

  async execute(command: TeachingTurnCommand): Promise<TeachingTurnExecuteResult> {
    const sessionId = sessionIdOf(command)
    const serializeId = `${command.workspaceId}\u0000${sessionId}`
    return this.serialize(serializeId, async () => {
      const operationKey = scopedOperationKey(command, sessionId)
      const eventKey = scopedEventKey(command, sessionId)
      const fingerprint = commandFingerprint(command)
      const turnKey = scopeKey(command.workspaceId, command.turnId)

      const byOperation = this.operations.get(operationKey)
      if (byOperation) {
        if (byOperation.fingerprint !== fingerprint) {
          return this.rejectResult(command, sessionId, 'payload_mismatch')
        }
        return this.duplicateResult(command, byOperation)
      }
      const byEvent = this.eventIdIndex.get(eventKey)
      if (byEvent) {
        if (byEvent.fingerprint !== fingerprint) {
          return this.rejectResult(command, sessionId, 'payload_mismatch')
        }
        return this.duplicateResult(command, byEvent)
      }

      // Fail-closed capacity checks before any side effects.
      if (this.operations.size >= this.maxOperations || this.eventIdIndex.size >= this.maxEventIds) {
        return this.rejectResult(command, sessionId, 'capacity_exceeded')
      }

      const rememberedTerminal = this.closedTurnTerminals.get(turnKey)
      if (rememberedTerminal) {
        return this.rejectResult(command, sessionId, 'already_terminal', rememberedTerminal)
      }

      const busOrNull = this.ensureBus(command.workspaceId, command.turnId)
      if (!busOrNull) {
        return this.rejectResult(command, sessionId, 'capacity_exceeded')
      }
      const bus = busOrNull

      if (bus.getWorkspaceId() !== command.workspaceId || bus.getTurnId() !== command.turnId) {
        return this.rejectResult(command, sessionId, 'payload_mismatch')
      }

      const sticky = bus.terminal()
      if (sticky) {
        this.tryRememberClosedTurn(turnKey, sticky)
        return this.rejectResult(command, sessionId, 'already_terminal', sticky)
      }

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
        try {
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
        } catch (error) {
          result = this.handlePortFailure(command, bus, sessionId, collected, error)
        }

        const terminalNow = bus.terminal()
        if (terminalNow) {
          this.tryRememberClosedTurn(turnKey, terminalNow)
        }

        result = {
          ...result,
          acceptance: result.acceptance ?? 'accepted',
          events: [...collected],
          terminal: terminalNow
        }

        if (
          (this.operations.size >= this.maxOperations || this.eventIdIndex.size >= this.maxEventIds) &&
          !this.operations.has(operationKey) &&
          !this.eventIdIndex.has(eventKey)
        ) {
          return {
            turnId: command.turnId,
            sessionId,
            events: [...collected],
            terminal: terminalNow,
            acceptance: 'rejected',
            rejectReason: 'capacity_exceeded'
          }
        }

        const record: OperationRecord = {
          operationKey,
          eventKey,
          operationId: command.operationId,
          eventId: command.eventId,
          turnId: command.turnId,
          workspaceId: command.workspaceId,
          sessionId,
          commandType: command.type,
          fingerprint,
          result
        }
        this.rememberOperation(record)
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
    return {
      turnId: command.turnId,
      sessionId: snapshot.id,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted'
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
        terminal: bus.terminal(),
        acceptance: 'accepted'
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
    return {
      turnId: command.turnId,
      sessionId: snapshot.id,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted'
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
      operationId: command.operationId,
      itemId: command.evidence.itemId,
      payload: {
        type: 'evidence_recorded',
        sessionId: receipt.sessionId,
        evidenceEventId: receipt.eventId,
        sequence: receipt.sequence,
        duplicate: receipt.duplicate,
        kind: command.evidence.kind
      }
    })
    this.emitProgress(
      bus,
      command,
      receipt.sessionId,
      receipt.duplicate ? 'evidence_duplicate' : 'evidence_recorded'
    )
    return {
      turnId: command.turnId,
      sessionId: receipt.sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted'
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
      // Ephemeral unless a durable record was actually persisted.
      const durability = 'recordSaved' in commitResult && commitResult.recordSaved ? 'durable' : 'ephemeral'
      this.emit(bus, {
        durability,
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
    // retryable_failure is not sticky — same turn may retry commit.
    if (terminal !== null) {
      const reasonCode = isTeachingTurnTerminalReasonCode(commitResult.status)
        ? commitResult.status
        : 'non_retryable_failure'
      this.emitTerminal(bus, command, sessionId, terminal, reasonCode)
    }

    return {
      turnId: command.turnId,
      sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted',
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
        terminal: bus.terminal(),
        acceptance: 'accepted'
      }
    }
    const nextStep = this.ports.planner.plan(command.facts)
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
    this.emitProgress(bus, command, command.sessionId, 'next_step_planned')
    return {
      turnId: command.turnId,
      sessionId: command.sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted',
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
    // Pass real ready resources/provenance — never an empty hardcoded stub when provided.
    const readyResources = command.readyResources ?? []
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
          resources: [...readyResources]
        },
        'lesson'
      )
    }

    this.emitProgress(bus, command, sessionId, 'snapshot_projected')
    return {
      turnId: command.turnId,
      sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted',
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
        terminal: bus.terminal(),
        acceptance: 'accepted'
      }
    }

    const reconciliation = await this.ports.committer.reconcile(command.sessionId)
    // recover_reconciled is ephemeral unless a durable marker/record is present.
    const persisted = Boolean(reconciliation.marker || reconciliation.record)
    this.emit(bus, {
      durability: persisted ? 'durable' : 'ephemeral',
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
    this.emitProgress(bus, command, command.sessionId, 'recover_reconciled', reconciliation.state)
    return {
      turnId: command.turnId,
      sessionId: command.sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted'
    }
  }

  private async cancelTurn(
    command: TeachingTurnCancelCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    // Cooperative: cancel runs after any prior same-session command (serialize gate).
    this.emitProgress(bus, command, command.sessionId, 'cancel_requested', command.reasonCode)
    this.emitTerminal(bus, command, command.sessionId, 'canceled', command.reasonCode ?? 'user_cancel')
    return {
      turnId: command.turnId,
      sessionId: command.sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted'
    }
  }

  private handlePortFailure(
    command: TeachingTurnCommand,
    bus: TeachingTurnEventBus,
    sessionId: string,
    collected: TeachingEventEnvelope[],
    error: unknown
  ): TeachingTurnExecuteResult {
    const interrupt = isInterruptLike(error)
    const reasonCode: TeachingTurnTerminalReasonCode = interrupt ? 'port_interrupted' : 'port_failed'
    const stage = interrupt ? 'port_interrupted' : 'port_failed'

    // Intermediate recoverable failures must not sticky-close the multi-command turn.
    if (!FINALIZATION_COMMANDS.has(command.type) && !bus.terminal()) {
      this.emitProgress(bus, command, sessionId, stage, reasonCode)
      return {
        turnId: command.turnId,
        sessionId,
        events: [...collected],
        terminal: null,
        acceptance: 'accepted'
      }
    }

    if (!bus.terminal()) {
      this.emitTerminal(
        bus,
        command,
        sessionId,
        interrupt ? 'interrupted' : 'failed',
        reasonCode
      )
    }
    return {
      turnId: command.turnId,
      sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'accepted'
    }
  }

  private rejectResult(
    command: TeachingTurnCommand,
    sessionId: string,
    reason: TeachingTurnRejectReason,
    sticky: TeachingEventEnvelope | null = null
  ): TeachingTurnExecuteResult {
    const key = scopeKey(command.workspaceId, command.turnId)
    const bus = this.buses.get(key)
    const terminal =
      sticky ?? bus?.terminal() ?? this.closedTurnTerminals.get(key) ?? null
    return {
      turnId: command.turnId,
      sessionId,
      events: [],
      terminal,
      acceptance: 'rejected',
      rejectReason: reason
    }
  }

  private duplicateResult(command: TeachingTurnCommand, existing: OperationRecord): TeachingTurnExecuteResult {
    const key = scopeKey(command.workspaceId, command.turnId)
    const bus = this.buses.get(key)
    if (!bus || bus.isClosed()) {
      return {
        ...existing.result,
        turnId: command.turnId,
        acceptance: 'duplicate',
        events: existing.result.events,
        terminal: bus?.terminal() ?? existing.result.terminal ?? this.closedTurnTerminals.get(key) ?? null
      }
    }

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

    return {
      ...existing.result,
      turnId: command.turnId,
      acceptance: 'duplicate',
      events: [...existing.result.events, duplicateEvent],
      terminal: bus.terminal() ?? existing.result.terminal
    }
  }

  /**
   * Ensure a workspace+turn scoped bus exists.
   * Returns null when capacity is exhausted (fail-closed, no silent eviction of active buses).
   */
  private ensureBus(workspaceId: string, turnId: string): TeachingTurnEventBus | null {
    const key = scopeKey(workspaceId, turnId)
    let bus = this.buses.get(key)
    if (bus) return bus

    this.reclaimClosedBuses()
    if (this.buses.size >= this.maxBuses) {
      return null
    }

    bus = createTeachingTurnEventBus({ workspaceId, turnId, now: this.now })
    this.buses.set(key, bus)
    const pending = this.turnSubscriptions.get(key)
    if (pending) {
      for (const entry of pending) {
        entry.attachedUnsub = bus.subscribe(entry.listener)
      }
    }
    return bus
  }

  /** Insert-only identity retention — never silently evicts other operation records. */
  private rememberOperation(record: OperationRecord): void {
    this.operations.set(record.operationKey, record)
    this.eventIdIndex.set(record.eventKey, record)
  }

  /** Retain closed terminal identity without silent eviction. Returns false if full. */
  private tryRememberClosedTurn(turnKey: string, terminal: TeachingEventEnvelope): boolean {
    if (this.closedTurnTerminals.has(turnKey)) {
      return true
    }
    if (this.closedTurnTerminals.size >= this.maxBuses) {
      return false
    }
    this.closedTurnTerminals.set(turnKey, terminal)
    return true
  }

  /**
   * Bounded cleanup: reclaim only closed live buses whose terminal identity is already
   * retained (or can be retained) in closedTurnTerminals. Never drops active buses or
   * closed identities.
   */
  private reclaimClosedBuses(): void {
    for (const [key, bus] of [...this.buses]) {
      if (!bus.isClosed()) continue
      const terminal = bus.terminal()
      if (!terminal) {
        this.buses.delete(key)
        continue
      }
      if (!this.tryRememberClosedTurn(key, terminal)) {
        continue
      }
      this.buses.delete(key)
    }
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
    reasonCode?: TeachingTurnTerminalReasonCode
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

  private async serialize<T>(gateKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionTails.get(gateKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.sessionTails.set(gateKey, tail)

    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (this.sessionTails.get(gateKey) === tail) {
        this.sessionTails.delete(gateKey)
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

function scopeKey(workspaceId: string, turnId: string): string {
  return `${workspaceId}\u0000${turnId}`
}

/** Scoped idempotency: (workspaceId, sessionId, turnId, commandType, operationId). */
function scopedOperationKey(command: TeachingTurnCommand, sessionId: string): string {
  return `${command.workspaceId}\u0000${sessionId}\u0000${command.turnId}\u0000${command.type}\u0000${command.operationId}`
}

/** Scoped event identity: (workspaceId, sessionId, turnId, eventId). */
function scopedEventKey(command: TeachingTurnCommand, sessionId: string): string {
  return `${command.workspaceId}\u0000${sessionId}\u0000${command.turnId}\u0000${command.eventId}`
}

/** Fingerprint includes turnId (full command body). */
function commandFingerprint(command: TeachingTurnCommand): string {
  return createHash('sha256').update(stableStringify(command)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function stableShort(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function isInterruptLike(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : ''
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  return (
    /abort|interrupt|cancel/i.test(name) ||
    /abort|interrupt|cancel/i.test(message) ||
    /abort|interrupt|cancel/i.test(code)
  )
}

