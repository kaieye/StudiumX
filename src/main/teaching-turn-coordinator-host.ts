/**
 * Production host for TeachingTurnCoordinator.
 *
 * Thin multi-workspace adapter only: resolves registered workspace roots,
 * binds ledger/recorder/committer/planner ports per workspace, and delegates
 * orchestration to TeachingTurnCoordinator. No domain rules, no renderer
 * orchestration of writers/tools/providers.
 */

import { createHash } from 'node:crypto'

import { createLearningSessionLedger, type LearningSessionLedger } from './learning-session-ledger'
import { createLessonInteractionRecorder, type LessonInteractionRecorder } from './lesson-interaction-recorder'
import {
  createLearningOutcomeCommitter,
  type LearningOutcomeCommitter,
  type OutcomeCommitResult
} from './learning-outcome-committer'
import { createNextTeachingStepPlanner, type NextTeachingStepPlanner } from './next-teaching-step-planner'
import {
  createTeachingTurnCoordinator,
  type TeachingTurnCoordinator,
  type TeachingTurnExecuteResult
} from './teaching-turn-coordinator'
import type { TeachingEventEnvelope } from '../shared/teaching-events'
import type { LearningOutcomeCommitResult } from '../shared/teaching-types/learning-outcome'
import type { CommitLearningOutcomeRequest } from '../shared/teaching-types/system-api'

export type TeachingTurnWorkspaceRef = {
  id: string
  rootPath: string
}

export type TeachingTurnCoordinatorHostOptions = {
  /** Resolve a registered teaching workspace. Fail closed when unknown. */
  resolveWorkspace: (workspaceId: string) => Promise<TeachingTurnWorkspaceRef | null>
  createLedger?: (workspaceRoot: string) => Pick<LearningSessionLedger, 'open' | 'load' | 'scan'>
  createRecorder?: (
    ledger: Pick<LearningSessionLedger, 'open' | 'load' | 'scan'>
  ) => Pick<LessonInteractionRecorder, 'record'>
  createCommitter?: (
    workspaceRoot: string,
    ledger: Pick<LearningSessionLedger, 'open' | 'load' | 'scan'>
  ) => Pick<LearningOutcomeCommitter, 'commit' | 'reconcile'>
  createPlanner?: () => Pick<NextTeachingStepPlanner, 'plan'>
  now?: () => string
  /** Optional bound for process-local coordinator caches (tests). */
  maxOperations?: number
  maxEventIds?: number
  maxBuses?: number
}

/**
 * Learner-safe IPC projection of a coordinator execute result.
 * Omits bulky assembly/fact payloads; keeps protocol events + commit projection.
 */
export type TeachingTurnIpcExecuteResult = {
  turnId: string
  sessionId: string
  acceptance: TeachingTurnExecuteResult['acceptance']
  rejectReason?: TeachingTurnExecuteResult['rejectReason']
  terminal: TeachingEventEnvelope | null
  events: TeachingEventEnvelope[]
  commitResult?: LearningOutcomeCommitResult
}

export interface TeachingTurnCoordinatorHost {
  /** Execute a parsed-or-raw teaching turn command via the workspace-scoped coordinator. */
  execute(command: unknown): Promise<TeachingTurnIpcExecuteResult>
  /**
   * Production sole-writer commit path projected through commit_outcome.
   * Synthesizes a stable turn envelope from the versioned IPC request.
   */
  commitLearningOutcome(request: CommitLearningOutcomeRequest): Promise<LearningOutcomeCommitResult>
}

type WorkspaceCoordinatorEntry = {
  workspaceId: string
  rootPath: string
  coordinator: TeachingTurnCoordinator
}

export function createTeachingTurnCoordinatorHost(
  options: TeachingTurnCoordinatorHostOptions
): TeachingTurnCoordinatorHost {
  return new DefaultTeachingTurnCoordinatorHost(options)
}

class DefaultTeachingTurnCoordinatorHost implements TeachingTurnCoordinatorHost {
  private readonly coordinators = new Map<string, WorkspaceCoordinatorEntry>()
  private readonly createLedger: NonNullable<TeachingTurnCoordinatorHostOptions['createLedger']>
  private readonly createRecorder: NonNullable<TeachingTurnCoordinatorHostOptions['createRecorder']>
  private readonly createCommitter: NonNullable<TeachingTurnCoordinatorHostOptions['createCommitter']>
  private readonly createPlanner: NonNullable<TeachingTurnCoordinatorHostOptions['createPlanner']>
  private readonly now?: () => string

  constructor(private readonly options: TeachingTurnCoordinatorHostOptions) {
    this.createLedger =
      options.createLedger ?? ((workspaceRoot) => createLearningSessionLedger({ workspaceRoot, now: options.now }))
    this.createRecorder =
      options.createRecorder ??
      ((ledger) => createLessonInteractionRecorder({ ledger: ledger as LearningSessionLedger }))
    this.createCommitter =
      options.createCommitter ??
      ((workspaceRoot, ledger) =>
        createLearningOutcomeCommitter({
          workspaceRoot,
          ledger: ledger as LearningSessionLedger,
          now: options.now
        }))
    this.createPlanner = options.createPlanner ?? (() => createNextTeachingStepPlanner())
    this.now = options.now
  }

  async execute(command: unknown): Promise<TeachingTurnIpcExecuteResult> {
    const workspaceId = readWorkspaceId(command)
    if (!workspaceId) {
      return rejectedParseResult(command)
    }

    const entry = await this.coordinatorFor(workspaceId)
    if (!entry) {
      return {
        turnId: readStringField(command, 'turnId') ?? 'unknown',
        sessionId: readSessionId(command) ?? 'pending',
        acceptance: 'rejected',
        rejectReason: 'payload_mismatch',
        terminal: null,
        events: []
      }
    }

    const result = await entry.coordinator.execute(command)
    return projectIpcExecuteResult(result)
  }

  async commitLearningOutcome(request: CommitLearningOutcomeRequest): Promise<LearningOutcomeCommitResult> {
    const entry = await this.coordinatorFor(request.workspaceId)
    if (!entry) {
      return { status: 'non_retryable_failure', reason: 'not_found' }
    }

    const ids = synthesizeCommitTurnIds(request.operationId)
    const result = await entry.coordinator.execute({
      type: 'commit_outcome',
      turnId: ids.turnId,
      eventId: ids.eventId,
      operationId: request.operationId,
      workspaceId: request.workspaceId,
      request: {
        sessionId: request.sessionId,
        operationId: request.operationId
      }
    })

    return mapExecuteToCommitResult(result)
  }

  private async coordinatorFor(workspaceId: string): Promise<WorkspaceCoordinatorEntry | null> {
    const existing = this.coordinators.get(workspaceId)
    if (existing) {
      // Fail closed if the registered root moved for this workspace id.
      const resolved = await this.options.resolveWorkspace(workspaceId)
      if (!resolved || resolved.rootPath !== existing.rootPath || resolved.id !== workspaceId) {
        this.coordinators.delete(workspaceId)
        if (!resolved || resolved.id !== workspaceId) return null
        return this.createEntry(resolved)
      }
      return existing
    }

    const resolved = await this.options.resolveWorkspace(workspaceId)
    if (!resolved || resolved.id !== workspaceId) return null
    return this.createEntry(resolved)
  }

  private createEntry(workspace: TeachingTurnWorkspaceRef): WorkspaceCoordinatorEntry {
    const ledger = this.createLedger(workspace.rootPath)
    const recorder = this.createRecorder(ledger)
    const committer = this.createCommitter(workspace.rootPath, ledger)
    const planner = this.createPlanner()
    const coordinator = createTeachingTurnCoordinator({
      ledger,
      recorder,
      committer,
      planner,
      factSource: { ledger, workspaceRoot: workspace.rootPath, committer },
      now: this.now,
      maxOperations: this.options.maxOperations,
      maxEventIds: this.options.maxEventIds,
      maxBuses: this.options.maxBuses
    })
    const entry: WorkspaceCoordinatorEntry = {
      workspaceId: workspace.id,
      rootPath: workspace.rootPath,
      coordinator
    }
    this.coordinators.set(workspace.id, entry)
    return entry
  }
}

function readWorkspaceId(command: unknown): string | null {
  return readStringField(command, 'workspaceId')
}

function readSessionId(command: unknown): string | null {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return null
  const record = command as Record<string, unknown>
  const direct = readStringField(command, 'sessionId')
  if (direct) return direct
  if (record.request && typeof record.request === 'object' && !Array.isArray(record.request)) {
    const nested = (record.request as Record<string, unknown>).sessionId
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  if (record.evidence && typeof record.evidence === 'object' && !Array.isArray(record.evidence)) {
    const nested = (record.evidence as Record<string, unknown>).sessionId
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  if (record.open && typeof record.open === 'object' && !Array.isArray(record.open)) {
    const nested = (record.open as Record<string, unknown>).sessionId
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  if (record.factInput && typeof record.factInput === 'object' && !Array.isArray(record.factInput)) {
    const nested = (record.factInput as Record<string, unknown>).sessionId
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  return null
}

function readStringField(command: unknown, key: string): string | null {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return null
  const value = (command as Record<string, unknown>)[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function rejectedParseResult(command: unknown): TeachingTurnIpcExecuteResult {
  return {
    turnId: readStringField(command, 'turnId') ?? 'unknown',
    sessionId: readSessionId(command) ?? 'pending',
    acceptance: 'rejected',
    rejectReason: 'payload_mismatch',
    terminal: null,
    events: []
  }
}

function projectIpcExecuteResult(result: TeachingTurnExecuteResult): TeachingTurnIpcExecuteResult {
  const projected: TeachingTurnIpcExecuteResult = {
    turnId: result.turnId,
    sessionId: result.sessionId,
    acceptance: result.acceptance,
    terminal: result.terminal,
    events: result.events
  }
  if (result.rejectReason) projected.rejectReason = result.rejectReason
  if (result.commitResult) {
    const commitResult = projectCommitResult(result.commitResult)
    if (commitResult) projected.commitResult = commitResult
  }
  return projected
}

function mapExecuteToCommitResult(result: TeachingTurnExecuteResult): LearningOutcomeCommitResult {
  if (result.commitResult) {
    const projected = projectCommitResult(result.commitResult)
    if (projected) return projected
    return { status: 'retryable_failure', reason: 'temporarily_unavailable' }
  }

  if (result.acceptance === 'rejected') {
    if (result.rejectReason === 'capacity_exceeded' || result.rejectReason === 'operation_in_flight') {
      return { status: 'retryable_failure', reason: 'temporarily_unavailable' }
    }
    // already_terminal / payload_mismatch / unknown: do not invent mastery.
    if (result.rejectReason === 'already_terminal') {
      return { status: 'retryable_failure', reason: 'temporarily_unavailable' }
    }
    return { status: 'non_retryable_failure', reason: 'not_found' }
  }

  // Accepted finalization without a structured commitResult (e.g. port failure terminal).
  return { status: 'retryable_failure', reason: 'temporarily_unavailable' }
}

function projectCommitResult(result: OutcomeCommitResult | LearningOutcomeCommitResult): LearningOutcomeCommitResult | null {
  if (!result || typeof result !== 'object') return null
  const status = (result as { status?: unknown }).status
  if (status === 'committed' || status === 'already_committed') {
    const outcome = (result as { outcome?: { kind?: unknown } }).outcome
    const kind = outcome?.kind
    const recordSaved = (result as { recordSaved?: unknown }).recordSaved
    if (
      (kind === 'established' || kind === 'misconception_corrected' || kind === 'needs_practice') &&
      typeof recordSaved === 'boolean'
    ) {
      return { status, outcome: { kind }, recordSaved }
    }
    return null
  }
  if (status === 'insufficient_evidence') {
    return { status: 'insufficient_evidence', reason: 'not_evidenced' }
  }
  if (status === 'conflict') {
    return { status: 'conflict', reason: 'review_required' }
  }
  if (status === 'retryable_failure') {
    const reason = (result as { reason?: unknown }).reason
    if (reason === 'reconciliation_required' || reason === 'temporarily_unavailable') {
      return { status: 'retryable_failure', reason }
    }
    return { status: 'retryable_failure', reason: 'temporarily_unavailable' }
  }
  if (status === 'non_retryable_failure') {
    const reason = (result as { reason?: unknown }).reason
    if (
      reason === 'invalid_session' ||
      reason === 'invalid_request' ||
      reason === 'read_only' ||
      reason === 'not_found'
    ) {
      return { status: 'non_retryable_failure', reason }
    }
    return { status: 'non_retryable_failure', reason: 'invalid_request' }
  }
  return null
}

/**
 * Stable, length-safe turn/event ids for the IPC commit adapter.
 * ID pattern allows 128 chars; operationId alone may already be 128.
 */
export function synthesizeCommitTurnIds(operationId: string): { turnId: string; eventId: string } {
  const directTurn = `ipc-c-${operationId}`
  const directEvent = `ipc-e-${operationId}`
  if (directTurn.length <= 128 && directEvent.length <= 128) {
    return { turnId: directTurn, eventId: directEvent }
  }
  const digest = createHash('sha256').update(operationId).digest('hex').slice(0, 40)
  return { turnId: `ipc-c-${digest}`, eventId: `ipc-e-${digest}` }
}
