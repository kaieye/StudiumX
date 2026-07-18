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
 *   rejectReason=already_terminal|payload_mismatch|capacity_exceeded|operation_in_flight). Sticky
 *   terminal is never rewritten; cancel after completed is NOT cancel success.
 * - Cooperative cancellation: no AbortSignal port; cancel is queued on the
 *   per-(workspace,turn) serialize gate (primary) with optional per-session
 *   secondary lock, and runs after any in-flight command for that scope.
 *
 * Scope keys:
 * - Buses / closed terminals / subscriptions: (workspaceId, turnId)
 * - Idempotency operations: (workspaceId, sessionId, turnId, commandType, operationId)
 * - Event ids: (workspaceId, sessionId, turnId, eventId)
 * - Operation fingerprint includes turnId (full command body).
 * - Serialize primary: (workspaceId, turnId); secondary: (workspaceId, sessionId).
 *
 * Capacity policy (fail-closed, no silent eviction of identities):
 * - Active buses, closed-terminal identities, and idempotency records are retained.
 * - Bounded cleanup may reclaim only closed live buses after their terminal is
 *   already retained in the closed archive (or can be retained without overflow).
 * - Admission reservation: reserve operation + event-id slots (and bus slot when
 *   creating) atomically before any port call, publish, or durable/ephemeral
 *   event side effect. Failed admission => zero side effects. On completion or
 *   handled failure, commit the reserved operation; only pure pre-effect rejects
 *   release the reservation.
 * - When capacity is exhausted, reject before any command side effects.
 * - Post-port identity mismatch (H3/M3): port may already have run (cannot roll
 *   back side effects safely); bus must NOT emit command_accepted or durable
 *   domain events; reservation is committed to the deterministic rejection so
 *   duplicate replay is stable and the port is not re-invoked. Capacity slots
 *   stay occupied by that committed reject record (no silent reservation release
 *   after mutator ports — concurrent capacity remains correct under replay).
 * - operation_in_flight (M2): concurrent same fingerprint while reserved rejects
 *   with rejectReason=operation_in_flight (no wait-for-duplicate). Client should
 *   retry after the in-flight command settles; settled matching fingerprint then
 *   returns acceptance=duplicate with the committed result.
 * - Existing-session commands ledger.load and verify workspace/session identity
 *   before any mutator port (record/commit/reconcile/planner/assembler).
 *   Cross-workspace inputs yield zero mutator calls and zero command_accepted.
 * - Bound turn session (M1): once a scoped turn binds a real session, later
 *   different sessions fail-closed; open without sessionId binds after success.
 * - command_accepted (H3): only after runtime parse/preflight AND port-return
 *   identity verification succeed.
 * - Envelope workspaceId/sessionId/turnId/operationId are fail-closed bound to
 *   command payload fields and port-returned session/workspace identity.
 *
 * Authority:
 * - Process-local only: buses, subscriptions, idempotency, and closed terminals
 *   do not survive process restart.
 * - Restart durable authority remains ledger / recorder / committer filesystem truth.
 */

import { createHash } from 'node:crypto'

import type { LearningSessionLedger } from './learning-session-ledger'
import type { LessonInteractionRecorder } from './lesson-interaction-recorder'
import type {
  LearningOutcomeCommitter,
  LearningOutcomeRecordRef,
  OutcomeCommitResult,
  OutcomeReconciliation,
  OutcomeSettlementMarker
} from './learning-outcome-committer'
import type { NextTeachingStepPlanner } from './next-teaching-step-planner'
import { createTeachingContextAssembler, type TeachingContextAssembler } from './teaching-context-assembler'
import type { ResourceGrounder } from './resource-grounder'
import {
  loadTeachingLoopFactSource,
  type TeachingLoopFactSourcePorts
} from './teaching-loop-fact-source'
import {
  createTeachingTurnEventBus,
  type TeachingTurnEventBus
} from './teaching-turn-event-bus'
import {
  isTeachingTurnTerminalReasonCode,
  mapCommitStatusToTerminal,
  parseTeachingTurnCommand,
  type TeachingEventEnvelope,
  type TeachingTurnCancelCommand,
  type TeachingTurnCommand,
  type TeachingTurnCommandType,
  type TeachingTurnCommitOutcomeCommand,
  type TeachingTurnOpenSessionCommand,
  type TeachingTurnPlanNextStepCommand,
  type TeachingTurnProjectSnapshotCommand,
  type TeachingTurnRecordEvidenceCommand,
  type TeachingTurnRecoverSessionCommand,
  type TeachingTurnResumeSessionCommand,
  type TeachingTurnTerminalOutcome,
  type TeachingTurnTerminalReasonCode
} from '../shared/teaching-events'
import type {
  LearningOutcomeRef,
  LearningSessionSnapshot
} from '../shared/teaching-types/learning-session'
import {
  lessonInteractionLedgerKind,
  normalizeLessonInteraction,
  type LessonInteraction
} from '../shared/teaching-types/lesson-interaction'
import type { TeachingLoopFacts, TeachingLoopSnapshot } from '../shared/teaching-types/teaching-loop'
import type { NextTeachingStepDecision } from '../shared/teaching-types/next-teaching-step'
import type { TeachingContextAssembly } from './teaching-context-assembler'

export type {
  TeachingTurnCancelCommand,
  TeachingTurnCommand,
  TeachingTurnCommandType,
  TeachingTurnCommitOutcomeCommand,
  TeachingTurnOpenSessionCommand,
  TeachingTurnPlanNextStepCommand,
  TeachingTurnProjectSnapshotCommand,
  TeachingTurnRecordEvidenceCommand,
  TeachingTurnRecoverSessionCommand,
  TeachingTurnResumeSessionCommand
} from '../shared/teaching-events'

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
  | 'operation_in_flight'

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
  /** Pure loop facts for project_snapshot (command-scoped session pin). */
  facts?: TeachingLoopFacts
  nextStep?: NextTeachingStepDecision
  context?: TeachingContextAssembly
  commitResult?: OutcomeCommitResult
}

export interface TeachingTurnCoordinator {
  execute(command: unknown): Promise<TeachingTurnExecuteResult>
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
  /** reserved = capacity held before side effects; committed = terminal result remembered */
  status: 'reserved' | 'committed'
  result: TeachingTurnExecuteResult | null
}

type ClosedTurnArchive = {
  workspaceId: string
  turnId: string
  terminal: TeachingEventEnvelope
  /** Highest sequence known when archived (terminal sequence). */
  sequence: number
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
  /** Primary serialize tails keyed by workspaceId+turnId (stable across session/pending changes). */
  private readonly turnTails = new Map<string, Promise<void>>()
  /** Secondary serialize tails keyed by workspaceId+sessionId (cross-turn session safety). */
  private readonly sessionTails = new Map<string, Promise<void>>()
  /** Process-local idempotency records; not durable across restart. */
  private readonly operations = new Map<string, OperationRecord>()
  private readonly eventIdIndex = new Map<string, OperationRecord>()
  /** Process-local live buses keyed by workspaceId+turnId. */
  private readonly buses = new Map<string, TeachingTurnEventBus>()
  /**
   * Closed-turn archive: sticky terminal visibility after live bus reclaim.
   * Supports scoped replayAfter/subscribe without reopening the bus.
   * Bounded by maxBuses; fail-closed (no silent forget of retained identities).
   */
  private readonly closedTurnArchives = new Map<string, ClosedTurnArchive>()
  private readonly turnSubscriptions = new Map<string, Set<PendingSubscription>>()
  /** M1: once a scoped turn binds a real session, different sessions fail-closed. */
  private readonly turnBoundSessions = new Map<string, string>()

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
      // M5: closed live bus late-subscribe is isomorphic with closed archive —
      // deliver sticky terminal immediately; do not reopen or wait for future events.
      if (existingBus.isClosed()) {
        const terminal = existingBus.terminal()
        if (terminal) {
          return deliverLateClosedTerminal(listener, terminal)
        }
      }
      return existingBus.subscribe(listener)
    }

    // Closed archive: deliver sticky terminal immediately without reopening a live bus.
    const archived = this.closedTurnArchives.get(key)
    if (archived) {
      return deliverLateClosedTerminal(listener, archived.terminal)
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
    const key = scopeKey(scope.workspaceId, scope.turnId)
    const live = this.buses.get(key)
    if (live) {
      return live.replayAfter(afterSequence)
    }
    const archived = this.closedTurnArchives.get(key)
    if (!archived) {
      return null
    }
    return replayFromClosedArchive(archived, afterSequence)
  }

  async execute(commandInput: unknown): Promise<TeachingTurnExecuteResult> {
    // H4: runtime parse unknown first — TS types are not a trust boundary.
    const parsed = parseTeachingTurnCommand(commandInput)
    if (!parsed.ok) {
      const turnId =
        isPlainObject(commandInput) && typeof commandInput.turnId === 'string'
          ? commandInput.turnId
          : 'invalid'
      return {
        turnId,
        sessionId: guessSessionIdForReject(commandInput),
        events: [],
        terminal: null,
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }
    const command = parsed.value

    // Fail-closed identity binding before any queue or side effect.
    const identity = resolveCommandIdentity(command)
    if (!identity.ok) {
      return {
        turnId: command.turnId,
        sessionId: identity.sessionId,
        events: [],
        terminal: null,
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }

    const sessionId = identity.sessionId
    const operationKey = scopedOperationKey(command, sessionId)
    const eventKey = scopedEventKey(command, sessionId)
    const fingerprint = commandFingerprint(command)

    // M2: observe in-flight reservation before join the serialize queue.
    // Concurrent same-fingerprint while reserved => operation_in_flight (not wait-for-duplicate).
    // Different fingerprint on same scoped key => payload_mismatch. No port side effects.
    const peekOperation = this.operations.get(operationKey)
    if (peekOperation?.status === 'reserved') {
      if (peekOperation.fingerprint === fingerprint) {
        return this.rejectResult(command, sessionId, 'operation_in_flight')
      }
      return this.rejectResult(command, sessionId, 'payload_mismatch')
    }
    const peekEvent = this.eventIdIndex.get(eventKey)
    if (peekEvent?.status === 'reserved') {
      if (peekEvent.fingerprint === fingerprint) {
        return this.rejectResult(command, sessionId, 'operation_in_flight')
      }
      return this.rejectResult(command, sessionId, 'payload_mismatch')
    }

    const turnGate = turnSerializeKey(command.workspaceId, command.turnId)
    const sessionGate = sessionSerializeKey(command.workspaceId, sessionId)

    // Primary: workspace+turn (stable across pending/session key changes).
    // Secondary: workspace+session (cross-turn). Lock order prevents deadlock.
    return this.serialize(this.turnTails, turnGate, () =>
      this.serialize(this.sessionTails, sessionGate, async () => {
        const turnKey = scopeKey(command.workspaceId, command.turnId)

        // Re-check under lock: concurrent peer may have committed or reserved.
        const byOperation = this.operations.get(operationKey)
        if (byOperation) {
          // M2: same fingerprint in-flight uses explicit operation_in_flight.
          if (byOperation.status === 'reserved') {
            if (byOperation.fingerprint === fingerprint) {
              return this.rejectResult(command, sessionId, 'operation_in_flight')
            }
            return this.rejectResult(command, sessionId, 'payload_mismatch')
          }
          if (byOperation.fingerprint !== fingerprint) {
            return this.rejectResult(command, sessionId, 'payload_mismatch')
          }
          return this.duplicateResult(command, byOperation)
        }
        const byEvent = this.eventIdIndex.get(eventKey)
        if (byEvent) {
          if (byEvent.status === 'reserved') {
            if (byEvent.fingerprint === fingerprint) {
              return this.rejectResult(command, sessionId, 'operation_in_flight')
            }
            return this.rejectResult(command, sessionId, 'payload_mismatch')
          }
          if (byEvent.fingerprint !== fingerprint) {
            return this.rejectResult(command, sessionId, 'payload_mismatch')
          }
          return this.duplicateResult(command, byEvent)
        }

        const remembered = this.closedTurnArchives.get(turnKey)
        if (remembered) {
          return this.rejectResult(command, sessionId, 'already_terminal', remembered.terminal)
        }

        // M1: once a scoped turn binds a real session, different session fail-closed.
        const boundSession = this.turnBoundSessions.get(turnKey)
        if (boundSession && !isPendingSessionId(sessionId) && boundSession !== sessionId) {
          return this.rejectResult(command, sessionId, 'payload_mismatch')
        }

        // Admission reservation before any port/publish/event side effect.
        if (this.operations.size >= this.maxOperations || this.eventIdIndex.size >= this.maxEventIds) {
          return this.rejectResult(command, sessionId, 'capacity_exceeded')
        }

        let bus = this.buses.get(turnKey) ?? null
        if (!bus) {
          this.reclaimClosedBuses()
          if (this.buses.size >= this.maxBuses) {
            return this.rejectResult(command, sessionId, 'capacity_exceeded')
          }
        }

        const reservation: OperationRecord = {
          operationKey,
          eventKey,
          operationId: command.operationId,
          eventId: command.eventId,
          turnId: command.turnId,
          workspaceId: command.workspaceId,
          sessionId,
          commandType: command.type,
          fingerprint,
          status: 'reserved',
          result: null
        }
        this.operations.set(operationKey, reservation)
        this.eventIdIndex.set(eventKey, reservation)

        const releaseReservation = () => {
          const current = this.operations.get(operationKey)
          if (current?.status === 'reserved') {
            this.operations.delete(operationKey)
            this.eventIdIndex.delete(eventKey)
          }
        }

        try {
          if (!bus) {
            bus = this.createBus(command.workspaceId, command.turnId)
            if (!bus) {
              releaseReservation()
              return this.rejectResult(command, sessionId, 'capacity_exceeded')
            }
          }

          if (bus.getWorkspaceId() !== command.workspaceId || bus.getTurnId() !== command.turnId) {
            releaseReservation()
            return this.rejectResult(command, sessionId, 'payload_mismatch')
          }

          const sticky = bus.terminal()
          if (sticky) {
            this.tryArchiveClosedTurn(turnKey, command.workspaceId, command.turnId, sticky, bus)
            releaseReservation()
            return this.rejectResult(command, sessionId, 'already_terminal', sticky)
          }

          const collected: TeachingEventEnvelope[] = []
          const collect = (event: TeachingEventEnvelope) => {
            collected.push(event)
          }
          const unsubscribe = bus.subscribe(collect)

          try {
            // H3: do NOT emit command_accepted before port + identity verification.
            let result: TeachingTurnExecuteResult
            try {
              switch (command.type) {
                case 'open_session':
                  result = await this.openSession(command, bus, collected, sessionId)
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

            if (result.acceptance === 'accepted') {
              const portIdentity = validatePortResultIdentity(command, sessionId, result)
              if (!portIdentity.ok) {
                // M3: deterministic reject; no accepted semantics; do not re-call port.
                result = {
                  turnId: command.turnId,
                  sessionId,
                  events: collected.filter((e) => e.payload.type !== 'command_accepted'),
                  terminal: bus.terminal(),
                  acceptance: 'rejected',
                  rejectReason: 'payload_mismatch'
                }
              } else if (!isPendingSessionId(result.sessionId)) {
                // M1: bind real session after successful accepted command.
                this.turnBoundSessions.set(turnKey, result.sessionId)
              }
            }

            const terminalNow = bus.terminal()
            if (terminalNow) {
              this.tryArchiveClosedTurn(turnKey, command.workspaceId, command.turnId, terminalNow, bus)
            }

            if (result.acceptance === 'rejected') {
              result = {
                ...result,
                events: collected.filter((e) => e.payload.type !== 'command_accepted'),
                terminal: terminalNow
              }
            } else {
              result = {
                ...result,
                acceptance: result.acceptance ?? 'accepted',
                events: [...collected],
                terminal: terminalNow
              }
            }

            reservation.status = 'committed'
            reservation.result = result
            this.operations.set(operationKey, reservation)
            this.eventIdIndex.set(eventKey, reservation)
            return result
          } finally {
            unsubscribe()
          }
        } catch (error) {
          const busNow = this.buses.get(turnKey)
          const failureResult: TeachingTurnExecuteResult = {
            turnId: command.turnId,
            sessionId,
            events: [],
            terminal: busNow?.terminal() ?? this.closedTurnArchives.get(turnKey)?.terminal ?? null,
            acceptance: 'rejected',
            rejectReason: 'payload_mismatch'
          }
          reservation.status = 'committed'
          reservation.result = failureResult
          this.operations.set(operationKey, reservation)
          this.eventIdIndex.set(eventKey, reservation)
          void error
          return failureResult
        }
      })
    )
  }

  private async openSession(
    command: TeachingTurnOpenSessionCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[],
    admittedSessionId: string
  ): Promise<TeachingTurnExecuteResult> {
    const opened = await this.ports.ledger.open(command.open)
    // Port already called — cannot roll back. Never announce command_accepted on mismatch (H3).
    // Authority: re-load from ledger; do not bind port self-report alone (esp. no client sessionId).
    if (!opened || typeof opened !== 'object') {
      return this.portIdentityReject(command, bus, collected, admittedSessionId)
    }
    if (!isNonEmptyId(opened.id) || opened.workspaceId !== command.workspaceId) {
      return this.portIdentityReject(command, bus, collected, admittedSessionId)
    }
    if (command.open.sessionId && opened.id !== command.open.sessionId) {
      return this.portIdentityReject(command, bus, collected, admittedSessionId)
    }

    const loaded = await this.ports.ledger.load(opened.id)
    if (
      !loaded ||
      loaded.id !== opened.id ||
      loaded.workspaceId !== command.workspaceId ||
      (command.open.sessionId && loaded.id !== command.open.sessionId)
    ) {
      return this.portIdentityReject(command, bus, collected, admittedSessionId)
    }
    // Creation-semantics bind: open courseRef must match authoritative session course.
    if (loaded.courseRef?.courseId !== command.open.courseRef.courseId) {
      return this.portIdentityReject(command, bus, collected, admittedSessionId)
    }

    const sessionId = loaded.id
    this.emitAccepted(bus, command, sessionId)
    this.emit(bus, {
      durability: 'durable',
      occurredAt: this.now(),
      workspaceId: command.workspaceId,
      sessionId,
      turnId: command.turnId,
      eventId: command.eventId,
      operationId: command.operationId,
      payload: {
        type: 'session_opened',
        sessionId,
        courseId: loaded.courseRef.courseId,
        status: loaded.status === 'completed' ? 'completed' : 'active',
        source: loaded.source
      }
    })
    this.emitProgress(bus, command, sessionId, 'session_opened')
    return {
      turnId: command.turnId,
      sessionId,
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
    const preflight = await this.preflightExistingSession(command.workspaceId, command.sessionId)
    if (preflight.kind === 'not_found') {
      this.emitAccepted(bus, command, command.sessionId)
      this.emitTerminal(bus, command, command.sessionId, 'failed', 'session_not_found')
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'accepted'
      }
    }
    if (preflight.kind === 'mismatch') {
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }
    const snapshot = preflight.snapshot
    this.emitAccepted(bus, command, snapshot.id)
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
    // M4: preflight loaded workspace before recorder mutator.
    const preflight = await this.preflightExistingSession(command.workspaceId, command.evidence.sessionId)
    if (preflight.kind === 'mismatch' || preflight.kind === 'not_found') {
      return {
        turnId: command.turnId,
        sessionId: command.evidence.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }

    const receiptRaw = await this.ports.recorder.record(command.evidence)
    const receipt = parseEvidenceReceipt(receiptRaw)
    if (!receipt) {
      return this.portIdentityReject(command, bus, collected, command.evidence.sessionId)
    }
    // Full receipt identity vs request/evidence (H3). Production normalize already ran in parse.
    if (
      receipt.sessionId !== command.evidence.sessionId ||
      receipt.eventId !== command.evidence.eventId ||
      !lessonInteractionsAuthorityEqual(receipt.evidence, command.evidence)
    ) {
      return this.portIdentityReject(command, bus, collected, command.evidence.sessionId)
    }

    const authoritative = await this.ports.ledger.load(command.evidence.sessionId)
    if (
      !authoritative ||
      authoritative.id !== command.evidence.sessionId ||
      authoritative.workspaceId !== command.workspaceId
    ) {
      return this.portIdentityReject(command, bus, collected, command.evidence.sessionId)
    }
    // H-A / Round-8: authoritative ledger event must be complete and exact — never eventId+sequence stub.
    // Missing/sparse/empty/mismatched payload/kind/session/workspace fail closed before any bus emit.
    const ledgerEvent = (authoritative.events ?? []).find((event) => event.eventId === receipt.eventId)
    if (!verifyAuthoritativeLedgerEvidence(ledgerEvent, command, receipt)) {
      return this.portIdentityReject(command, bus, collected, command.evidence.sessionId)
    }

    // M1/H3: all local + authority identity checks complete before any bus emit.
    this.emitAccepted(bus, command, receipt.sessionId)
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
    // H1/H2: request.operationId must match; load before commit mutator.
    if (command.request.operationId !== command.operationId) {
      return {
        turnId: command.turnId,
        sessionId: command.request.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }
    const preflight = await this.preflightExistingSession(command.workspaceId, command.request.sessionId)
    if (preflight.kind === 'mismatch' || preflight.kind === 'not_found') {
      return {
        turnId: command.turnId,
        sessionId: command.request.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }

    const sessionId = command.request.sessionId
    const commitRaw = await this.ports.committer.commit(command.request)
    // H3/B1/H-B: never trust self-report alone — strict parse then authority reload/verify.
    // M1: no accepted/durable emit until local identity + authority checks all pass.
    const commitResult = parseOutcomeCommitResult(commitRaw)
    if (!commitResult) {
      return this.portIdentityReject(command, bus, collected, sessionId)
    }
    const authorityOk = await this.verifyCommitAgainstAuthority(command.workspaceId, sessionId, commitResult)
    if (!authorityOk) {
      return this.portIdentityReject(command, bus, collected, sessionId)
    }

    this.emitAccepted(bus, command, sessionId)

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
      const durability =
        'recordSaved' in commitResult && commitResult.recordSaved === true ? 'durable' : 'ephemeral'
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
    const preflight = await this.preflightExistingSession(command.workspaceId, command.sessionId)
    if (preflight.kind === 'mismatch' || preflight.kind === 'not_found') {
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }
    if (command.facts.latestSession.id !== command.sessionId) {
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }

    if (!this.ports.planner) {
      this.emitAccepted(bus, command, command.sessionId)
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
    this.emitAccepted(bus, command, command.sessionId)
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
    // H4: explicit real sessionId required; never course.id fallback.
    const sessionId = command.factInput.sessionId
    const preflight = await this.preflightExistingSession(command.workspaceId, sessionId)
    if (preflight.kind === 'mismatch' || preflight.kind === 'not_found') {
      return {
        turnId: command.turnId,
        sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }

    const factPorts = this.ports.factSource ?? {
      ledger: this.ports.ledger,
      committer: this.ports.committer
    }
    // factInput.sessionId selects command-scoped projection (not scan-latest).
    const loaded = await loadTeachingLoopFactSource(factPorts, command.factInput)

    // H1: projection/settlement/planner/safeProjection must bind the explicit session.
    // No cosmetic post-hoc id rewrite — reject when authority projection diverges.
    const projectedSessionId = loaded.snapshot.safeProjection.session?.id ?? null
    if (projectedSessionId !== sessionId) {
      return this.portIdentityReject(command, bus, collected, sessionId)
    }
    if (loaded.facts.latestSession?.id !== sessionId) {
      return this.portIdentityReject(command, bus, collected, sessionId)
    }
    if (loaded.source.selectedSessionId !== sessionId) {
      return this.portIdentityReject(command, bus, collected, sessionId)
    }
    if (loaded.source.settlement && loaded.source.settlement.sessionId !== sessionId) {
      return this.portIdentityReject(command, bus, collected, sessionId)
    }

    this.emitAccepted(bus, command, sessionId)
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
        sessionId,
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
    if (loaded.snapshot.nextStep && loaded.snapshot.safeProjection.session) {
      nextStep = {
        schemaVersion: 1,
        action: loaded.snapshot.nextStep.action,
        reason: loaded.snapshot.nextStep.reason,
        safeInputSummary: {
          missionId: loaded.snapshot.safeProjection.missionId,
          courseId: loaded.snapshot.safeProjection.courseId,
          latestSession: {
            id: loaded.snapshot.safeProjection.session.id,
            source: loaded.snapshot.safeProjection.session.source,
            readOnly: loaded.snapshot.safeProjection.session.readOnly
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
      facts: loaded.facts,
      nextStep,
      context
    }
  }

  private async recoverSession(
    command: TeachingTurnRecoverSessionCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[]
  ): Promise<TeachingTurnExecuteResult> {
    // H1/H2: load + verify workspace before reconcile mutator.
    const preflight = await this.preflightExistingSession(command.workspaceId, command.sessionId)
    if (preflight.kind === 'not_found') {
      this.emitAccepted(bus, command, command.sessionId)
      this.emitTerminal(bus, command, command.sessionId, 'failed', 'session_not_found')
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'accepted'
      }
    }
    if (preflight.kind === 'mismatch') {
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }

    const reconciliationRaw = await this.ports.committer.reconcile(command.sessionId)
    // Round-8: never trust raw reconcile self-report for accepted/durable recover.
    const reconciliation = parseOutcomeReconciliation(reconciliationRaw)
    if (!reconciliation || reconciliation.sessionId !== command.sessionId) {
      return this.portIdentityReject(command, bus, collected, command.sessionId)
    }
    if (reconciliation.marker && reconciliation.marker.sessionId !== command.sessionId) {
      return this.portIdentityReject(command, bus, collected, command.sessionId)
    }

    // Reload authoritative ledger (workspace/session identity). Marker/record bind via session.
    const loaded = await this.ports.ledger.load(command.sessionId)
    if (
      !loaded ||
      loaded.id !== command.sessionId ||
      loaded.workspaceId !== command.workspaceId
    ) {
      return this.portIdentityReject(command, bus, collected, command.sessionId)
    }
    // Round-9 HIGH/M1/M3: marker vs outcomeRef full identity; durability never from record alone.
    const recoverAuthority = verifyRecoverAuthority(reconciliation, loaded.outcomeRef)
    if (!recoverAuthority.ok) {
      return this.portIdentityReject(command, bus, collected, command.sessionId)
    }
    const persisted = recoverAuthority.durable

    this.emitAccepted(bus, command, command.sessionId)
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
    // Medium: cancel requires workspace/session identity (not_found and mismatch both fail-closed).
    // Cancel must not invent accepted/canceled for a foreign or unknown session identity.
    const preflight = await this.preflightExistingSession(command.workspaceId, command.sessionId)
    if (preflight.kind === 'mismatch' || preflight.kind === 'not_found') {
      return {
        turnId: command.turnId,
        sessionId: command.sessionId,
        events: [...collected],
        terminal: bus.terminal(),
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch'
      }
    }
    this.emitAccepted(bus, command, command.sessionId)
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

  /**
   * H1/H2/M4: load existing session and verify loaded.id + loaded.workspaceId
   * before any reconcile/commit/record/planner/assembler mutator.
   */
  private async preflightExistingSession(
    workspaceId: string,
    sessionId: string
  ): Promise<
    | { kind: 'ok'; snapshot: LearningSessionSnapshot }
    | { kind: 'not_found' }
    | { kind: 'mismatch' }
  > {
    const loaded = await this.ports.ledger.load(sessionId)
    if (!loaded) return { kind: 'not_found' }
    if (loaded.id !== sessionId || loaded.workspaceId !== workspaceId) {
      return { kind: 'mismatch' }
    }
    return { kind: 'ok', snapshot: loaded }
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

    // Port-failure acceptance semantics (Medium):
    // - Intermediate commands: accepted progress without sticky terminal and without
    //   command_accepted (port never completed successfully). Caller may retry.
    // - Finalization (commit/cancel): accepted with sticky terminal failed/interrupted.
    //   No command_accepted; reservation commits so duplicate fingerprint is stable.
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

  /**
   * H3 helper: port/identity verification failed after a port may have run.
   * Never emits command_accepted or durable domain events. Reservation is
   * committed by the outer execute path (cannot safely roll back side effects).
   */
  private portIdentityReject(
    command: TeachingTurnCommand,
    bus: TeachingTurnEventBus,
    collected: TeachingEventEnvelope[],
    sessionId: string
  ): TeachingTurnExecuteResult {
    return {
      turnId: command.turnId,
      sessionId,
      events: [...collected],
      terminal: bus.terminal(),
      acceptance: 'rejected',
      rejectReason: 'payload_mismatch'
    }
  }

  /**
   * Verify commit self-report against ledger + settlement authority (H3/B1/H-B + Round-10).
   * Never returns true on empty authority for durable-success paths.
   * Round-10:
   * - H1: marker + outcomeRef full identity bind (kind/outcomeId/canonical evidenceEventIds)
   * - H2: reconcile always strict-parsed; never trust raw recon object fields
   * - C: recordSaved:true requires dual formal record proof (marker.record + recon.record)
   */
  private async verifyCommitAgainstAuthority(
    workspaceId: string,
    sessionId: string,
    commitResult: OutcomeCommitResult
  ): Promise<boolean> {
    const loaded = await this.ports.ledger.load(sessionId)
    if (!loaded || loaded.id !== sessionId || loaded.workspaceId !== workspaceId) {
      return false
    }

    if (commitResult.status === 'committed' || commitResult.status === 'already_committed') {
      // Round-10 H2: never trust raw reconcile — fail closed on malformed/foreign/illegal shapes.
      const recon = parseOutcomeReconciliation(await this.ports.committer.reconcile(sessionId))
      if (!recon || recon.sessionId !== sessionId) {
        return false
      }
      if (recon.marker && recon.marker.sessionId !== sessionId) {
        return false
      }

      const marker = recon.marker
      const outcomeRef = loaded.outcomeRef

      // B1: every durable success (including needs_practice + recordSaved:false)
      // fails closed unless ledger/settlement proves matching durable state.
      if (!marker && !outcomeRef) {
        return false
      }

      // Round-10 H1: when both authorities exist, full identity must bind (not kind alone).
      if (marker && outcomeRef && !markerOutcomeRefIdentitiesEqual(marker, outcomeRef)) {
        return false
      }

      // Bind every verifiable commitResult.outcome field to authoritative identity.
      if (marker) {
        if (marker.sessionId !== sessionId) return false
        if (!commitOutcomeMatchesAuthority(commitResult.outcome, marker)) return false
      }
      if (outcomeRef) {
        if (!commitOutcomeMatchesAuthority(commitResult.outcome, outcomeRef)) return false
      }

      // Preserve FileLearningOutcomeCommitter production semantics: mastery kinds
      // always carry a formal record; needs_practice never does. A self-report that
      // contradicts those semantics cannot publish a durable success.
      const formalRecordKind =
        commitResult.outcome.kind === 'established' ||
        commitResult.outcome.kind === 'misconception_corrected'
      if (formalRecordKind !== commitResult.recordSaved) {
        return false
      }

      // Round-10 C: recordSaved:true requires dual formal record proof (recover-symmetric).
      // outcomeRef alone is never saved-record proof; unilateral marker.record or recon.record is not durable.
      if (commitResult.recordSaved === true) {
        if (!marker || marker.sessionId !== sessionId) {
          return false
        }
        const markerRecord = marker.record
        const reconRecord = recon.record
        if (!markerRecord || !reconRecord) {
          return false
        }
        if (!learningRecordRefsEqual(markerRecord, reconRecord)) {
          return false
        }
      } else if (marker?.record || recon.record) {
        return false
      }

      return true
    }

    if (commitResult.status === 'insufficient_evidence') {
      // Round-11 Medium: strict reconciliation is mandatory before publishing even
      // ephemeral insufficient-evidence/sticky failure. Ledger and settlement are
      // both authorities; any established durable outcome contradicts this result.
      if (loaded.outcomeRef) {
        return false
      }
      const recon = parseOutcomeReconciliation(await this.ports.committer.reconcile(sessionId))
      if (!recon || recon.sessionId !== sessionId) {
        return false
      }

      // Production insufficient_evidence is a no-formal-record result. Legacy/mock
      // recordSaved:false or absent is tolerated, but a durable record claim is not.
      const claimsDurable =
        'recordSaved' in commitResult && (commitResult as { recordSaved?: boolean }).recordSaved === true
      if (claimsDurable) {
        return false
      }

      if (recon.state === 'pending') {
        // Legitimate no-authority/no-record review path: ephemeral insufficient result.
        return recon.marker === null && recon.record === null && !recon.catalogRecordPresent
      }
      if (recon.state !== 'settled') {
        return false
      }

      const marker = recon.marker
      return (
        marker !== null &&
        marker.sessionId === sessionId &&
        marker.kind === 'not_evidenced' &&
        marker.record === null &&
        recon.record === null &&
        !recon.catalogRecordPresent
      )
    }

    // conflict / retryable / non_retryable: structural parse is enough; no durable success emit.
    return true
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
      sticky ?? bus?.terminal() ?? this.closedTurnArchives.get(key)?.terminal ?? null
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
    if (existing.status !== 'committed' || !existing.result) {
      // Reserved without result is operation_in_flight (M2), not payload_mismatch.
      return this.rejectResult(command, existing.sessionId, 'operation_in_flight')
    }
    const key = scopeKey(command.workspaceId, command.turnId)
    const bus = this.buses.get(key)
    const archivedTerminal = this.closedTurnArchives.get(key)?.terminal ?? null
    if (!bus || bus.isClosed()) {
      return {
        ...existing.result,
        turnId: command.turnId,
        acceptance: 'duplicate',
        events: existing.result.events,
        terminal: bus?.terminal() ?? existing.result.terminal ?? archivedTerminal
      }
    }

    // Duplicate rejected results: same rejection, no accepted/duplicate accepted semantics.
    if (existing.result.acceptance === 'rejected') {
      return {
        ...existing.result,
        turnId: command.turnId,
        acceptance: 'duplicate',
        events: existing.result.events,
        terminal: bus.terminal() ?? existing.result.terminal
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
   * Create a workspace+turn scoped bus (caller already checked capacity / reclaimed).
   * Returns null when capacity is exhausted (fail-closed, no silent eviction of active buses).
   */
  private createBus(workspaceId: string, turnId: string): TeachingTurnEventBus | null {
    const key = scopeKey(workspaceId, turnId)
    const existing = this.buses.get(key)
    if (existing) return existing

    if (this.buses.size >= this.maxBuses) {
      return null
    }

    const bus = createTeachingTurnEventBus({ workspaceId, turnId, now: this.now })
    this.buses.set(key, bus)
    const pending = this.turnSubscriptions.get(key)
    if (pending) {
      for (const entry of pending) {
        entry.attachedUnsub = bus.subscribe(entry.listener)
      }
    }
    return bus
  }

  /**
   * Archive sticky terminal for closed-turn visibility after live bus reclaim.
   * Fail-closed: never silently forget an existing archive; refuse when full.
   */
  private tryArchiveClosedTurn(
    turnKey: string,
    workspaceId: string,
    turnId: string,
    terminal: TeachingEventEnvelope,
    bus?: TeachingTurnEventBus | null
  ): boolean {
    if (this.closedTurnArchives.has(turnKey)) {
      return true
    }
    if (this.closedTurnArchives.size >= this.maxBuses) {
      return false
    }
    const sequence =
      typeof terminal.sequence === 'number' && terminal.sequence > 0
        ? terminal.sequence
        : bus?.currentSequence() ?? 1
    this.closedTurnArchives.set(turnKey, {
      workspaceId,
      turnId,
      terminal: cloneEnvelope(terminal),
      sequence
    })
    return true
  }

  /**
   * Bounded cleanup: reclaim only closed live buses whose terminal identity is already
   * retained (or can be retained) in closedTurnArchives. Never drops active buses or
   * closed identities. Archived terminals remain replayable via replayAfter/subscribe.
   */
  private reclaimClosedBuses(): void {
    for (const [key, bus] of [...this.buses]) {
      if (!bus.isClosed()) continue
      const terminal = bus.terminal()
      if (!terminal) {
        this.buses.delete(key)
        continue
      }
      if (
        !this.tryArchiveClosedTurn(
          key,
          bus.getWorkspaceId(),
          bus.getTurnId(),
          terminal,
          bus
        )
      ) {
        continue
      }
      this.buses.delete(key)
    }
  }

  private emitAccepted(
    bus: TeachingTurnEventBus,
    command: TeachingTurnCommand,
    sessionId: string
  ): void {
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

  /**
   * Promise-chain serialize gate. Separate Maps for turn vs session keep lock
   * domains independent; callers always acquire turn then session (no deadlock).
   */
  private async serialize<T>(
    tails: Map<string, Promise<void>>,
    gateKey: string,
    work: () => Promise<T>
  ): Promise<T> {
    const previous = tails.get(gateKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    tails.set(gateKey, tail)

    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (tails.get(gateKey) === tail) {
        tails.delete(gateKey)
      }
    }
  }
}

function turnSerializeKey(workspaceId: string, turnId: string): string {
  return `turn\u0000${workspaceId}\u0000${turnId}`
}

function sessionSerializeKey(workspaceId: string, sessionId: string): string {
  return `session\u0000${workspaceId}\u0000${sessionId}`
}

/**
 * Resolve command session identity and fail-closed when envelope ids disagree
 * with nested payload workspace/session fields.
 */
function resolveCommandIdentity(
  command: TeachingTurnCommand
): { ok: true; sessionId: string } | { ok: false; sessionId: string } {
  if (!isNonEmptyId(command.workspaceId) || !isNonEmptyId(command.turnId) || !isNonEmptyId(command.operationId) || !isNonEmptyId(command.eventId)) {
    return { ok: false, sessionId: 'invalid' }
  }

  switch (command.type) {
    case 'open_session': {
      if (command.open.workspaceId !== command.workspaceId) {
        return { ok: false, sessionId: command.open.sessionId ?? `pending:${command.operationId}` }
      }
      if (command.open.sessionId !== undefined && command.open.sessionId !== null && command.open.sessionId !== '') {
        if (!isNonEmptyId(command.open.sessionId)) {
          return { ok: false, sessionId: 'invalid' }
        }
        return { ok: true, sessionId: command.open.sessionId }
      }
      return { ok: true, sessionId: `pending:${command.operationId}` }
    }
    case 'resume_session':
    case 'recover_session':
    case 'cancel_turn':
    case 'plan_next_step': {
      if (!isNonEmptyId(command.sessionId)) {
        return { ok: false, sessionId: 'invalid' }
      }
      return { ok: true, sessionId: command.sessionId }
    }
    case 'record_evidence': {
      if (command.evidence.workspaceId !== command.workspaceId) {
        return { ok: false, sessionId: command.evidence.sessionId || 'invalid' }
      }
      if (!isNonEmptyId(command.evidence.sessionId)) {
        return { ok: false, sessionId: 'invalid' }
      }
      return { ok: true, sessionId: command.evidence.sessionId }
    }
    case 'commit_outcome': {
      if (!isNonEmptyId(command.request.sessionId)) {
        return { ok: false, sessionId: 'invalid' }
      }
      if (command.request.operationId !== command.operationId) {
        return { ok: false, sessionId: command.request.sessionId }
      }
      return { ok: true, sessionId: command.request.sessionId }
    }
    case 'project_snapshot': {
      // Explicit real sessionId only — never course.id fallback (H4).
      if (!isNonEmptyId(command.factInput.sessionId)) {
        return { ok: false, sessionId: 'invalid' }
      }
      return { ok: true, sessionId: command.factInput.sessionId }
    }
  }
}

/**
 * Validate port-returned session/workspace identity against the admitted command scope.
 */
function validatePortResultIdentity(
  command: TeachingTurnCommand,
  admittedSessionId: string,
  result: TeachingTurnExecuteResult
): { ok: true } | { ok: false } {
  if (result.sessionId && result.sessionId !== admittedSessionId) {
    // open_session may promote pending:* to a real ledger session id.
    if (command.type === 'open_session' && admittedSessionId.startsWith('pending:')) {
      if (!isNonEmptyId(result.sessionId)) return { ok: false }
    } else if (result.sessionId !== admittedSessionId) {
      return { ok: false }
    }
  }

  const snapshot = result.snapshot
  if (snapshot && 'workspaceId' in snapshot && snapshot.workspaceId != null) {
    if (snapshot.workspaceId !== command.workspaceId) {
      return { ok: false }
    }
  }
  if (snapshot && 'id' in snapshot && typeof snapshot.id === 'string') {
    if (command.type !== 'open_session' && command.type !== 'project_snapshot') {
      if (snapshot.id !== admittedSessionId && snapshot.id !== result.sessionId) {
        return { ok: false }
      }
    }
  }
  return { ok: true }
}

function deliverLateClosedTerminal(
  listener: (event: TeachingEventEnvelope) => void,
  terminal: TeachingEventEnvelope
): () => void {
  let active = true
  const cloned = cloneEnvelope(terminal)
  queueMicrotask(() => {
    if (!active) return
    try {
      listener(cloned)
    } catch {
      // Isolate subscriber failures.
    }
  })
  return () => {
    active = false
  }
}

const COMMIT_STATUSES = new Set([
  'committed',
  'already_committed',
  'insufficient_evidence',
  'conflict',
  'retryable_failure',
  'non_retryable_failure'
])

const TRUSTED_COMMIT_KINDS = new Set(['established', 'misconception_corrected', 'needs_practice'])
const COMMIT_SUCCESS_KEYS = ['status', 'outcome', 'recordSaved', 'record', 'catalogRecordPresent'] as const
const COMMIT_OUTCOME_IDENTITY_KEYS = ['kind', 'outcomeId', 'evidenceEventIds'] as const
const INSUFFICIENT_EVIDENCE_RESULT_KEYS = ['status', 'reason', 'recordSaved'] as const
const FAILURE_RESULT_KEYS = ['status', 'reason'] as const
const AUTHORITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/**
 * Strict runtime parse of OutcomeCommitResult. Unknown shapes never reach bus emit.
 * Round-11: successful commit identity is mandatory and closed-schema; kind-only or
 * partial self-reports cannot be upgraded by otherwise-consistent authority.
 */
function parseOutcomeCommitResult(value: unknown): OutcomeCommitResult | null {
  if (!isPlainObject(value) || typeof value.status !== 'string' || !COMMIT_STATUSES.has(value.status)) {
    return null
  }
  if (value.status === 'committed' || value.status === 'already_committed') {
    if (!hasNoUnexpectedKeys(value, COMMIT_SUCCESS_KEYS)) return null
    if (
      !isPlainObject(value.outcome) ||
      !hasExactKeys(value.outcome, COMMIT_OUTCOME_IDENTITY_KEYS) ||
      !TRUSTED_COMMIT_KINDS.has(String(value.outcome.kind)) ||
      !isNormalizedAuthorityId(value.outcome.outcomeId)
    ) {
      return null
    }
    const evidenceEventIds = parseAuthorityEvidenceEventIds(value.outcome.evidenceEventIds)
    if (!evidenceEventIds || typeof value.recordSaved !== 'boolean') return null
    if (value.catalogRecordPresent !== undefined && typeof value.catalogRecordPresent !== 'boolean') return null

    let record: LearningOutcomeRecordRef | null = null
    if (value.record !== undefined && value.record !== null) {
      record = parseLearningRecordRef(value.record)
      if (!record) return null
    }

    return {
      status: value.status,
      outcome: {
        kind: value.outcome.kind as 'established' | 'misconception_corrected' | 'needs_practice',
        outcomeId: value.outcome.outcomeId,
        evidenceEventIds
      },
      recordSaved: value.recordSaved,
      record,
      catalogRecordPresent: value.catalogRecordPresent ?? false
    } as OutcomeCommitResult
  }
  if (value.status === 'insufficient_evidence') {
    if (!hasNoUnexpectedKeys(value, INSUFFICIENT_EVIDENCE_RESULT_KEYS)) return null
    if (value.reason !== 'not_evidenced') return null
    if (value.recordSaved !== undefined && typeof value.recordSaved !== 'boolean') return null
    return {
      status: 'insufficient_evidence',
      reason: 'not_evidenced',
      ...(typeof value.recordSaved === 'boolean' ? { recordSaved: value.recordSaved } : {})
    } as OutcomeCommitResult
  }
  if (!hasNoUnexpectedKeys(value, FAILURE_RESULT_KEYS)) return null
  if (value.status === 'conflict') {
    if (value.reason !== 'review_required') return null
    return { status: 'conflict', reason: 'review_required' }
  }
  if (value.status === 'retryable_failure') {
    if (value.reason !== 'reconciliation_required' && value.reason !== 'temporarily_unavailable') {
      return null
    }
    return { status: 'retryable_failure', reason: value.reason }
  }
  if (value.status === 'non_retryable_failure') {
    if (
      value.reason !== 'invalid_session' &&
      value.reason !== 'invalid_request' &&
      value.reason !== 'read_only' &&
      value.reason !== 'not_found'
    ) {
      return null
    }
    return { status: 'non_retryable_failure', reason: value.reason }
  }
  return null
}

type ParsedEvidenceReceipt = {
  eventId: string
  sessionId: string
  sequence: number
  duplicate: boolean
  evidence: LessonInteraction
}

/**
 * Strict receipt parse: top-level ids + production-normalized lesson interaction evidence.
 * Persisted sequence/recordedAt on evidence are stripped before production normalize.
 */
function parseEvidenceReceipt(value: unknown): ParsedEvidenceReceipt | null {
  if (!isPlainObject(value)) return null
  if (!isNonEmptyId(value.eventId) || !isNonEmptyId(value.sessionId)) return null
  if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 1) {
    return null
  }
  if (typeof value.duplicate !== 'boolean') return null
  if (!isPlainObject(value.evidence)) return null
  const evidence = tryNormalizeLessonInteraction(value.evidence)
  if (!evidence) return null
  if (evidence.eventId !== value.eventId || evidence.sessionId !== value.sessionId) {
    return null
  }
  return {
    eventId: value.eventId,
    sessionId: value.sessionId,
    sequence: value.sequence,
    duplicate: value.duplicate,
    evidence
  }
}

/**
 * Round-8/9 exact-event authority: full production LearningSessionEvent envelope
 * (schemaVersion + valid occurredAt/recordedAt + sequence), production-normalized
 * payload.lessonInteraction, top-level kind via lessonInteractionLedgerKind, and
 * full authority match vs command/receipt.
 */
function verifyAuthoritativeLedgerEvidence(
  ledgerEvent: unknown,
  command: TeachingTurnRecordEvidenceCommand,
  receipt: ParsedEvidenceReceipt
): boolean {
  if (!isPlainObject(ledgerEvent)) return false
  // M2: full production envelope schemaVersion + timestamps (ledger-compatible ISO).
  if (ledgerEvent.schemaVersion !== 1) return false
  if (!isProductionIsoTimestamp(ledgerEvent.occurredAt)) return false
  if (!isProductionIsoTimestamp(ledgerEvent.recordedAt)) return false
  if (ledgerEvent.eventId !== receipt.eventId || ledgerEvent.eventId !== command.evidence.eventId) {
    return false
  }
  if (
    typeof ledgerEvent.sequence !== 'number' ||
    !Number.isInteger(ledgerEvent.sequence) ||
    ledgerEvent.sequence !== receipt.sequence
  ) {
    return false
  }
  // sessionId is required exact — sparse stubs without it fail closed.
  if (ledgerEvent.sessionId !== receipt.sessionId || ledgerEvent.sessionId !== command.evidence.sessionId) {
    return false
  }
  if (!isPlainObject(ledgerEvent.payload)) return false
  if (!Object.prototype.hasOwnProperty.call(ledgerEvent.payload, 'lessonInteraction')) {
    return false
  }
  // Empty / non-object / sparse / null lessonInteraction fails production normalize.
  const stored = tryNormalizeLessonInteraction(ledgerEvent.payload.lessonInteraction)
  if (!stored) return false
  // Top-level ledger kind must match production recorder mapping.
  if (ledgerEvent.kind !== lessonInteractionLedgerKind(stored)) {
    return false
  }
  // Stored interaction must match command and receipt on all authority-relevant fields.
  if (!lessonInteractionsAuthorityEqual(stored, command.evidence)) return false
  if (!lessonInteractionsAuthorityEqual(stored, receipt.evidence)) return false
  if (stored.workspaceId !== command.workspaceId) return false
  return true
}

/** Ledger-compatible strict ISO instant (Date.toISOString() round-trip). */
function isProductionIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

function tryNormalizeLessonInteraction(value: unknown): LessonInteraction | null {
  if (value === null || value === undefined) return null
  // Strip persisted-only fields so production exact-key normalize can succeed.
  let candidate: unknown = value
  if (isPlainObject(value) && ('sequence' in value || 'recordedAt' in value)) {
    const { sequence: _sequence, recordedAt: _recordedAt, ...rest } = value
    candidate = rest
  }
  try {
    return normalizeLessonInteraction(candidate)
  } catch {
    return null
  }
}

function lessonInteractionsAuthorityEqual(a: LessonInteraction, b: LessonInteraction): boolean {
  // Both sides are production-normalized; structural equality covers identity + kind-specific fields.
  return stableJsonEqual(a, b)
}

function stableJsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const RECONCILIATION_STATES = new Set([
  'not_found',
  'pending',
  'settled',
  'repaired',
  'review_required',
  'read_only'
])

const RECONCILIATION_DIAGNOSTICS = new Set([
  'legacy_generated',
  'invalid_settlement_marker',
  'conflicting_outcome',
  'missing_record'
])

const SETTLEMENT_OUTCOME_KINDS = new Set([
  'established',
  'misconception_corrected',
  'needs_practice',
  'not_evidenced'
])

const RECONCILIATION_KEYS = [
  'sessionId',
  'state',
  'marker',
  'record',
  'catalogRecordPresent',
  'diagnostics'
] as const

const SETTLEMENT_MARKER_KEYS = [
  'schemaVersion',
  'sessionId',
  'outcomeId',
  'operationId',
  'kind',
  'evidenceEventIds',
  'evaluatorVersion',
  'record'
] as const

const LEARNING_RECORD_REF_KEYS = ['recordId', 'relativePath', 'contentSha256'] as const

/**
 * Round-9 recover authority:
 * - HIGH: any marker/outcomeRef kind (or full-identity) contradiction rejects before bus emit.
 * - M1: when both exist, bind outcomeId + kind + canonical evidenceEventIds (not kind alone).
 * - M3: durable only with authoritative marker; never from recon.record alone.
 *   Record-claiming kinds need matching marker.record + recon.record proof.
 *   Marker-only durable only for production no-formal-record kinds (needs_practice/not_evidenced).
 */
function verifyRecoverAuthority(
  reconciliation: OutcomeReconciliation,
  outcomeRef: LearningOutcomeRef | null
): { ok: true; durable: boolean } | { ok: false } {
  const marker = reconciliation.marker
  const record = reconciliation.record

  // Full outcome identity bind when both authorities exist (HIGH + M1).
  if (marker && outcomeRef && !markerOutcomeRefIdentitiesEqual(marker, outcomeRef)) {
    return { ok: false }
  }

  // M3: never durable from reconciliation.record alone.
  if (!marker) {
    return { ok: true, durable: false }
  }

  // Marker claims a formal record: require matching recon.record proof for durability.
  if (marker.record) {
    if (!record || !learningRecordRefsEqual(marker.record, record)) {
      // Missing/mismatched record proof — ephemeral review path only (not durable).
      return { ok: true, durable: false }
    }
    return { ok: true, durable: true }
  }

  // Marker-only: production settlement supports no formal record for needs_practice/not_evidenced.
  if (marker.kind === 'needs_practice' || marker.kind === 'not_evidenced') {
    return { ok: true, durable: true }
  }

  // established / misconception_corrected without record proof are not durable.
  return { ok: true, durable: false }
}

function markerOutcomeRefIdentitiesEqual(
  marker: OutcomeSettlementMarker,
  outcomeRef: LearningOutcomeRef
): boolean {
  if (marker.kind !== outcomeRef.kind) return false
  if (marker.outcomeId !== outcomeRef.outcomeId) return false
  if (!canonicalEvidenceEventIdsEqual(marker.evidenceEventIds, outcomeRef.evidenceEventIds)) {
    return false
  }
  return true
}

function canonicalEvidenceEventIdsEqual(left: string[], right: string[]): boolean {
  const a = parseAuthorityEvidenceEventIds(left)
  const b = parseAuthorityEvidenceEventIds(right)
  if (!a || !b || a.length !== b.length) return false
  return stableJsonEqual(
    [...a].sort((x, y) => x.localeCompare(y)),
    [...b].sort((x, y) => x.localeCompare(y))
  )
}

/** Round-11: successful commit self-report must fully and exactly bind authority. */
function commitOutcomeMatchesAuthority(
  commitOutcome: { kind: string; outcomeId: string; evidenceEventIds: string[] },
  authority: { kind: string; outcomeId: string; evidenceEventIds: string[] }
): boolean {
  return (
    authority.kind === commitOutcome.kind &&
    authority.outcomeId === commitOutcome.outcomeId &&
    canonicalEvidenceEventIdsEqual(commitOutcome.evidenceEventIds, authority.evidenceEventIds)
  )
}

/**
 * Strict runtime parse of OutcomeReconciliation. Malformed spoof never reaches bus emit.
 * Closed-schema: unknown/extra keys and wrong-type fields fail closed.
 */
function parseOutcomeReconciliation(value: unknown): OutcomeReconciliation | null {
  if (!isPlainObject(value)) return null
  if (!hasExactKeys(value, RECONCILIATION_KEYS)) return null
  if (!isNonEmptyId(value.sessionId)) return null
  if (typeof value.state !== 'string' || !RECONCILIATION_STATES.has(value.state)) return null
  if (typeof value.catalogRecordPresent !== 'boolean') return null
  if (
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every(
      (diagnostic) => typeof diagnostic === 'string' && RECONCILIATION_DIAGNOSTICS.has(diagnostic)
    )
  ) {
    return null
  }

  let marker: OutcomeSettlementMarker | null = null
  if (value.marker !== null) {
    marker = parseSettlementMarker(value.marker)
    if (!marker) return null
  }
  let record: LearningOutcomeRecordRef | null = null
  if (value.record !== null) {
    record = parseLearningRecordRef(value.record)
    if (!record) return null
  }
  // Marker.record and top-level record must agree when both present.
  if (marker?.record && record && !learningRecordRefsEqual(marker.record, record)) {
    return null
  }
  // Marker present with null record but top-level record claimed is contradictory spoof.
  if (marker && !marker.record && record) {
    return null
  }
  if (marker && marker.sessionId !== value.sessionId) {
    return null
  }
  if (value.catalogRecordPresent && !record) {
    return null
  }

  // Round-11: state and authority shape are one closed contract. In particular,
  // pending/not-found/read-only cannot carry settlement authority, while settled
  // and repaired cannot omit their required marker proof.
  if (
    (value.state === 'not_found' || value.state === 'pending' || value.state === 'read_only') &&
    (marker !== null || record !== null || value.catalogRecordPresent)
  ) {
    return null
  }
  if (value.state === 'settled') {
    if (!marker) return null
    if (marker.record ? !record : record !== null) return null
  }
  if (value.state === 'repaired') {
    // Recover keeps the historical record-only repair path ephemeral; durable
    // repaired authority still requires the marker/record pair.
    if (marker && (!marker.record || !record)) return null
  }

  return {
    sessionId: value.sessionId,
    state: value.state as OutcomeReconciliation['state'],
    marker,
    record,
    catalogRecordPresent: value.catalogRecordPresent,
    diagnostics: value.diagnostics as OutcomeReconciliation['diagnostics']
  }
}

function parseSettlementMarker(value: unknown): OutcomeSettlementMarker | null {
  if (!isPlainObject(value)) return null
  if (!hasExactKeys(value, SETTLEMENT_MARKER_KEYS)) return null
  if (value.schemaVersion !== 1) return null
  if (!isNonEmptyId(value.sessionId) || !isNormalizedAuthorityId(value.outcomeId) || !isNonEmptyId(value.operationId)) {
    return null
  }
  if (typeof value.kind !== 'string' || !SETTLEMENT_OUTCOME_KINDS.has(value.kind)) return null
  const evidenceEventIds = parseAuthorityEvidenceEventIds(value.evidenceEventIds)
  if (!evidenceEventIds) return null
  if (typeof value.evaluatorVersion !== 'number' || !Number.isInteger(value.evaluatorVersion)) {
    return null
  }
  let record: LearningOutcomeRecordRef | null = null
  if (value.record !== null && value.record !== undefined) {
    record = parseLearningRecordRef(value.record)
    if (!record) return null
  }
  return {
    schemaVersion: 1,
    sessionId: value.sessionId,
    outcomeId: value.outcomeId,
    operationId: value.operationId,
    kind: value.kind as OutcomeSettlementMarker['kind'],
    evidenceEventIds,
    evaluatorVersion: value.evaluatorVersion,
    record
  }
}

function parseLearningRecordRef(value: unknown): LearningOutcomeRecordRef | null {
  if (!isPlainObject(value)) return null
  if (!hasExactKeys(value, LEARNING_RECORD_REF_KEYS)) return null
  if (!isNonEmptyId(value.recordId)) return null
  if (typeof value.relativePath !== 'string' || value.relativePath.trim().length === 0) return null
  if (typeof value.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.contentSha256)) {
    return null
  }
  return {
    recordId: value.recordId,
    relativePath: value.relativePath,
    contentSha256: value.contentSha256
  }
}

function learningRecordRefsEqual(a: LearningOutcomeRecordRef, b: LearningOutcomeRecordRef): boolean {
  return (
    a.recordId === b.recordId &&
    a.relativePath === b.relativePath &&
    a.contentSha256 === b.contentSha256
  )
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
}

function isNormalizedAuthorityId(value: unknown): value is string {
  return typeof value === 'string' && AUTHORITY_ID_PATTERN.test(value)
}

function parseAuthorityEvidenceEventIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((id) => isNormalizedAuthorityId(id))) return null
  const ids = value as string[]
  if (new Set(ids).size !== ids.length) return null
  return [...ids]
}

function isPendingSessionId(sessionId: string): boolean {
  return sessionId.startsWith('pending:')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Closed-schema helper: reject unknown/extra keys (wrong-type handled by field checks). */
function hasNoUnexpectedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const allowedSet = new Set<string>(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && hasNoUnexpectedKeys(value, expected)
}

function guessSessionIdForReject(commandInput: unknown): string {
  if (!isPlainObject(commandInput)) return 'invalid'
  if (typeof commandInput.sessionId === 'string' && commandInput.sessionId) return commandInput.sessionId
  if (isPlainObject(commandInput.evidence) && typeof commandInput.evidence.sessionId === 'string') {
    return commandInput.evidence.sessionId
  }
  if (isPlainObject(commandInput.request) && typeof commandInput.request.sessionId === 'string') {
    return commandInput.request.sessionId
  }
  if (isPlainObject(commandInput.factInput) && typeof commandInput.factInput.sessionId === 'string') {
    return commandInput.factInput.sessionId
  }
  if (isPlainObject(commandInput.open) && typeof commandInput.open.sessionId === 'string') {
    return commandInput.open.sessionId
  }
  if (typeof commandInput.operationId === 'string' && commandInput.operationId) {
    return `pending:${commandInput.operationId}`
  }
  return 'invalid'
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

function cloneEnvelope(event: TeachingEventEnvelope): TeachingEventEnvelope {
  return {
    ...event,
    payload: JSON.parse(JSON.stringify(event.payload)) as TeachingEventEnvelope['payload']
  }
}

function replayFromClosedArchive(
  archive: ClosedTurnArchive,
  afterSequence = 0
): ReturnType<TeachingTurnEventBus['replayAfter']> {
  const requestedAfterSequence = Math.max(0, Math.floor(afterSequence))
  const terminal = cloneEnvelope(archive.terminal)
  const terminalSeq =
    typeof terminal.sequence === 'number' && terminal.sequence > 0
      ? terminal.sequence
      : archive.sequence
  // M5: isomorphic with TeachingTurnEventBus.replayAfter —
  // hasGap <=> requestedAfterSequence + 1 < retainedFromSequence.
  // Archive retains only sticky terminal => retainedFromSequence = terminalSeq.
  const retainedFromSequence = terminalSeq
  const events =
    terminalSeq > requestedAfterSequence
      ? [{ ...terminal, sequence: terminalSeq }]
      : []
  return {
    turnId: archive.turnId,
    available: true,
    requestedAfterSequence,
    fromSequence: Math.max(requestedAfterSequence + 1, retainedFromSequence),
    nextSequence: terminalSeq + 1,
    hasGap: requestedAfterSequence + 1 < retainedFromSequence,
    droppedEvents: Math.max(0, terminalSeq - 1),
    droppedBytes: 0,
    events,
    terminal
  }
}
