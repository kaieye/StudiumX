import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, readdir, realpath, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  evaluateLearningSessionOutcome,
  type EvaluateLearningSessionOutcomeInput,
  type LearningOutcomeEvaluation
} from './learning-outcome-evaluator'
import {
  createLearningSessionLedger,
  encodeCommittedLearningSessionOutcome,
  LearningSessionLedgerError,
  type LearningSessionLedger,
  type LearningSessionLedgerFaultPoint
} from './learning-session-ledger'
import { replaceDurably, type DurableFileOperations } from './persistence/durable-file'
import { isPathInsideRoot } from './path-access'
import { readLearningAssetCatalog } from './teaching-workspace/learning-assets-catalog'
import { requireLearningSessionId } from '../shared/teaching-placement'
import type { LearningOutcomeKind, LearningOutcomeRef, LearningSessionSnapshot } from '../shared/teaching-types/learning-session'
import type {
  LearnerSafeLearningOutcome,
  LearningOutcomeCommitRequest,
  LearningOutcomeCommitResult as LearnerSafeLearningOutcomeCommitResult,
  LearningOutcomeCommitSuccess as LearnerSafeLearningOutcomeCommitSuccess
} from '../shared/teaching-types/learning-outcome'

const OUTCOME_SETTLEMENT_FILE = 'outcome-settlement.json'
const LEARNING_RECORDS_DIRECTORY = 'learning-records'
const STAGE_DIRECTORY = '.learning-outcome-committer-stage'
const RECORD_METADATA_PREFIX = '<!-- studiumx-learning-outcome '
const RECORD_METADATA_SUFFIX = ' -->'
const OPERATION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/

export const LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION = 1 as const

export type OutcomeEvaluationInput = {
  sessionId: string
}

export type OutcomeCommitInput = LearningOutcomeCommitRequest

export type LearningOutcomeRecordRef = {
  recordId: string
  relativePath: string
  contentSha256: string
}

export type OutcomeSettlementMarker = {
  schemaVersion: typeof LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION
  sessionId: string
  outcomeId: string
  operationId: string
  kind: LearningOutcomeKind
  evidenceEventIds: string[]
  evaluatorVersion: number
  record: LearningOutcomeRecordRef | null
}

type MainLearningOutcomeCommitSuccessDetails = {
  outcome: LearnerSafeLearningOutcome & Pick<OutcomeSettlementMarker, 'outcomeId' | 'evidenceEventIds'>
  // This durable ref is intentionally main-process-only; the shared IPC contract
  // projects only recordSaved and never exposes paths or content digests.
  record: LearningOutcomeRecordRef | null
  catalogRecordPresent: boolean
}

type MainLearningOutcomeCommitSuccess =
  | (Extract<LearnerSafeLearningOutcomeCommitSuccess, { status: 'committed' }> & MainLearningOutcomeCommitSuccessDetails)
  | (Extract<LearnerSafeLearningOutcomeCommitSuccess, { status: 'already_committed' }> & MainLearningOutcomeCommitSuccessDetails)

export type OutcomeCommitResult =
  | MainLearningOutcomeCommitSuccess
  | Exclude<LearnerSafeLearningOutcomeCommitResult, LearnerSafeLearningOutcomeCommitSuccess>

export type OutcomeReconciliation = {
  sessionId: string
  state: 'not_found' | 'pending' | 'settled' | 'repaired' | 'review_required' | 'read_only'
  marker: OutcomeSettlementMarker | null
  record: LearningOutcomeRecordRef | null
  catalogRecordPresent: boolean
  diagnostics: Array<'legacy_generated' | 'invalid_settlement_marker' | 'conflicting_outcome' | 'missing_record'>
}

export type LearningOutcomeCommitterFaultPoint =
  | 'after_stage_flush'
  | 'after_record_publish'
  | 'after_outcome_publish'
  | 'after_settlement_marker'
  | 'before_catalog_reconcile'

export type LearningOutcomeCommitterOptions = {
  workspaceRoot: string
  ledger?: LearningSessionLedger
  now?: () => string
  createId?: () => string
  evaluate?: (input: EvaluateLearningSessionOutcomeInput) => Promise<LearningOutcomeEvaluation>
  testingFaults?: {
    inject(point: LearningOutcomeCommitterFaultPoint, context: { sessionId: string; operationId: string }): Promise<void> | void
  }
  /** Narrow main-internal seam for committer durability-operation faults. */
  durableFileOperations?: DurableFileOperations
  /** Receives only the shared primitive's generic directory-fsync warning. */
  durableWarn?: (message: string) => void
}

type LearningOutcomeCommitterWriterScope = {
  load(sessionId: string): Promise<LearningSessionSnapshot | null>
  loadForOutcomeReconciliation(sessionId: string): Promise<LearningSessionSnapshot | null>
  complete(sessionId: string, outcomeRef: LearningOutcomeRef): Promise<LearningSessionSnapshot>
  injectFault(point: LearningSessionLedgerFaultPoint, path?: string): Promise<void>
}

type WriterLockedLearningSessionLedger = LearningSessionLedger & {
  withWriterLock<T>(
    sessionId: string,
    execute: (scope: LearningOutcomeCommitterWriterScope) => Promise<T>
  ): Promise<T>
}

/**
 * The only writer for evaluator-derived Learning outcomes and Learning records.
 * Evaluation is deliberately read-only; commit reloads canonical Session facts and
 * uses deterministic record/outcome locations so retries and read-repair stay safe.
 */
export interface LearningOutcomeCommitter {
  evaluate(input: OutcomeEvaluationInput): Promise<LearningOutcomeEvaluation>
  commit(input: OutcomeCommitInput): Promise<OutcomeCommitResult>
  reconcile(sessionId: string): Promise<OutcomeReconciliation>
}

export function createLearningOutcomeCommitter(options: LearningOutcomeCommitterOptions): LearningOutcomeCommitter {
  return new FileLearningOutcomeCommitter(options)
}

class FileLearningOutcomeCommitter implements LearningOutcomeCommitter {
  private readonly ledger: LearningSessionLedger
  private readonly evaluateDecision: (input: EvaluateLearningSessionOutcomeInput) => Promise<LearningOutcomeEvaluation>
  private readonly createId: () => string

  constructor(private readonly options: LearningOutcomeCommitterOptions) {
    if (!options.workspaceRoot.trim()) throw new Error('Teaching workspace root is required.')
    this.ledger = options.ledger ?? createLearningSessionLedger({ workspaceRoot: options.workspaceRoot, now: options.now })
    this.evaluateDecision = options.evaluate ?? evaluateLearningSessionOutcome
    this.createId = options.createId ?? (() => `outcome-${randomUUID()}`)
  }

  async evaluate(input: OutcomeEvaluationInput): Promise<LearningOutcomeEvaluation> {
    const session = await this.loadCanonicalSession(input.sessionId)
    return this.evaluateDecision({ workspaceRoot: this.options.workspaceRoot, session })
  }

  async commit(input: OutcomeCommitInput): Promise<OutcomeCommitResult> {
    let sessionId: string
    try {
      sessionId = requireLearningSessionId(input.sessionId)
    } catch {
      return nonRetryableFailure('invalid_session')
    }

    let operationId: string
    try {
      operationId = requireOperationId(input.operationId)
    } catch {
      return nonRetryableFailure('invalid_request')
    }

    const writerLockedLedger = asWriterLockedLedger(this.ledger)
    if (!writerLockedLedger) return retryableFailure('temporarily_unavailable')

    let writeAttempted = false
    try {
      return await writerLockedLedger.withWriterLock(sessionId, async (scope) => {
        // Reconcile recovery authority before loading a normal completed Session:
        // the latter intentionally rejects a missing outcome projection.
        const existing = await this.reconcileLocked(scope, sessionId)
        if (existing.state === 'review_required') return conflictResult()
        if (existing.state === 'read_only') return nonRetryableFailure('read_only')
        if (existing.state === 'not_found') return nonRetryableFailure('not_found')
        if (existing.marker?.operationId === operationId && existing.state === 'settled') {
          if (existing.marker.kind === 'not_evidenced') return insufficientEvidenceResult()
          return committedResult('already_committed', existing.marker, existing.catalogRecordPresent)
        }

        const session = await this.loadCanonicalSession(sessionId, scope)
        if (session.status === 'completed') {
          if (existing.marker && existing.state === 'settled') {
            return committedResult('already_committed', existing.marker, existing.catalogRecordPresent)
          }
          return retryableFailure('reconciliation_required')
        }

        const evaluation = await this.evaluateDecision({ workspaceRoot: this.options.workspaceRoot, session })
        assertEvaluationMatchesSession(evaluation, session)
        const settlement = settlementFromEvaluation(session, operationId, evaluation, this.createId())

        if (!writesLearningRecord(settlement.marker.kind)) {
          writeAttempted = true
          await this.durableReplace(join(this.sessionDirectory(sessionId), OUTCOME_SETTLEMENT_FILE), serialize(settlement.marker))
          await this.inject('after_settlement_marker', sessionId, operationId)
          await this.inject('before_catalog_reconcile', sessionId, operationId)
          if (settlement.marker.kind === 'not_evidenced') return insufficientEvidenceResult()
          return committedResult('committed', settlement.marker, await this.catalogHas(settlement.marker.record))
        }

        const record = settlement.record!
        const recordContent = renderLearningRecord(settlement.marker, session, evaluation)
        const recordsDirectory = join(this.options.workspaceRoot, LEARNING_RECORDS_DIRECTORY)
        const stagePath = join(recordsDirectory, STAGE_DIRECTORY, `${record.recordId}.${operationId}.md`)
        const recordPath = join(this.options.workspaceRoot, ...record.relativePath.split('/'))

        writeAttempted = true
        // Ordered publication: stage -> immutable record -> outcome -> manifest -> marker -> catalog.
        await durableStage(stagePath, recordContent, this.options.durableFileOperations)
        await this.inject('after_stage_flush', sessionId, operationId)
        await publishImmutable(
          stagePath,
          recordPath,
          recordContent,
          this.options.durableFileOperations,
          () => scope.injectFault('after_stage_sync', record.relativePath)
        )
        await this.inject('after_record_publish', sessionId, operationId)

        const encoded = encodeCommittedLearningSessionOutcome({
          sessionId,
          outcomeId: settlement.marker.outcomeId,
          kind: settlement.marker.kind,
          evidenceEventIds: settlement.marker.evidenceEventIds
        })
        await this.durableReplace(join(this.sessionDirectory(sessionId), 'outcome.json'), encoded.content)
        await this.inject('after_outcome_publish', sessionId, operationId)
        await scope.complete(sessionId, encoded.ref)
        await this.durableReplace(join(this.sessionDirectory(sessionId), OUTCOME_SETTLEMENT_FILE), serialize(settlement.marker))
        await this.inject('after_settlement_marker', sessionId, operationId)
        await this.inject('before_catalog_reconcile', sessionId, operationId)

        return committedResult('committed', settlement.marker, await this.catalogHas(record))
      })
    } catch (error) {
      return resultFromCommitError(error, writeAttempted)
    }
  }

  async reconcile(sessionId: string): Promise<OutcomeReconciliation> {
    const safeSessionId = requireLearningSessionId(sessionId)
    const writerLockedLedger = asWriterLockedLedger(this.ledger)
    // A load-only injected ledger cannot prove a settlement was serialized.
    // Return the existing conservative review state rather than inspecting or
    // repairing durable projections without the ledger's filesystem lock.
    if (!writerLockedLedger) return emptyReconciliation(safeSessionId, 'review_required')
    return writerLockedLedger.withWriterLock(safeSessionId, (scope) => this.reconcileLocked(scope, safeSessionId))
  }

  private async reconcileLocked(
    scope: LearningOutcomeCommitterWriterScope,
    sessionId: string
  ): Promise<OutcomeReconciliation> {
    // Inspect record/marker/outcome before the Session projection. A missing
    // outcome can make a completed normal load fail, but a valid immutable
    // record may safely repair exactly that missing projection.
    const diagnostics: OutcomeReconciliation['diagnostics'] = await legacyDiagnostics(this.options.workspaceRoot)
    const markerRead = await readMarker(join(this.sessionDirectory(sessionId), OUTCOME_SETTLEMENT_FILE))
    const recordRead = await readCanonicalRecord(this.options.workspaceRoot, sessionId)
    const outcomeRead = await readRegularFile(join(this.sessionDirectory(sessionId), 'outcome.json'))
    if (markerRead.state === 'invalid') diagnostics.push('invalid_settlement_marker')

    let snapshot: LearningSessionSnapshot | null
    try {
      snapshot = await scope.loadForOutcomeReconciliation(sessionId)
    } catch (error) {
      if (error instanceof LearningSessionLedgerError) {
        if (recordRead.state !== 'valid') diagnostics.push('missing_record')
        return this.review(sessionId, markerRead.marker, recordRead.record?.marker.record ?? null, diagnostics)
      }
      throw error
    }
    if (!snapshot) return emptyReconciliation(sessionId, 'not_found')
    if (snapshot.readOnly) return { ...emptyReconciliation(sessionId, 'read_only'), diagnostics }

    if (markerRead.state === 'invalid' || recordRead.state === 'invalid' || outcomeRead.state === 'invalid') {
      if (recordRead.state !== 'valid') diagnostics.push('missing_record')
      return this.review(sessionId, markerRead.marker, recordRead.record?.marker.record ?? null, diagnostics)
    }

    const marker = markerRead.marker
    const parsedRecord = recordRead.record
    if (parsedRecord) {
      const authoritativeMarker = parsedRecord.marker
      if (marker && !sameMarkerIdentity(marker, authoritativeMarker)) {
        diagnostics.push('conflicting_outcome')
        return this.review(sessionId, marker, authoritativeMarker.record, diagnostics)
      }

      const encoded = encodeCommittedLearningSessionOutcome({
        sessionId,
        outcomeId: authoritativeMarker.outcomeId,
        kind: authoritativeMarker.kind,
        evidenceEventIds: authoritativeMarker.evidenceEventIds
      })
      if (outcomeRead.content !== null && outcomeRead.content !== encoded.content) {
        diagnostics.push('conflicting_outcome')
        return this.review(sessionId, marker ?? authoritativeMarker, authoritativeMarker.record, diagnostics)
      }
      if (snapshot.status === 'completed' && !sameOutcomeRef(snapshot.outcomeRef, encoded.ref)) {
        diagnostics.push('conflicting_outcome')
        return this.review(sessionId, marker ?? authoritativeMarker, authoritativeMarker.record, diagnostics)
      }

      const needsOutcome = outcomeRead.state === 'missing'
      const needsManifest = snapshot.status === 'active'
      const needsMarker = marker === null
      if (!needsOutcome && !needsManifest && !needsMarker) {
        return {
          sessionId,
          state: 'settled',
          marker: authoritativeMarker,
          record: authoritativeMarker.record,
          catalogRecordPresent: await this.catalogHas(authoritativeMarker.record),
          diagnostics
        }
      }

      // A valid immutable record is recovery authority only after every
      // existing projection has matched it. Repair in the original order.
      if (needsOutcome) await this.durableReplace(join(this.sessionDirectory(sessionId), 'outcome.json'), encoded.content)
      if (needsManifest) await scope.complete(sessionId, encoded.ref)
      if (needsMarker) await this.durableReplace(join(this.sessionDirectory(sessionId), OUTCOME_SETTLEMENT_FILE), serialize(authoritativeMarker))
      return {
        sessionId,
        state: 'repaired',
        marker: authoritativeMarker,
        record: authoritativeMarker.record,
        catalogRecordPresent: await this.catalogHas(authoritativeMarker.record),
        diagnostics
      }
    }

    // Without an immutable record, a valid recordless marker is the only
    // authority. Never infer or synthesize an outcome/manifest from it.
    if (marker) {
      if (marker.record !== null || writesLearningRecord(marker.kind) || snapshot.status === 'completed' || outcomeRead.state !== 'missing') {
        diagnostics.push(marker.record !== null ? 'missing_record' : 'conflicting_outcome')
        return this.review(sessionId, marker, null, diagnostics)
      }
      return {
        sessionId,
        state: 'settled',
        marker,
        record: null,
        catalogRecordPresent: false,
        diagnostics
      }
    }

    if (snapshot.status === 'completed' || outcomeRead.state !== 'missing') {
      diagnostics.push('missing_record')
      return this.review(sessionId, null, null, diagnostics)
    }
    return { sessionId, state: 'pending', marker: null, record: null, catalogRecordPresent: false, diagnostics }
  }

  private async review(
    sessionId: string,
    marker: OutcomeSettlementMarker | null,
    record: LearningOutcomeRecordRef | null,
    diagnostics: OutcomeReconciliation['diagnostics']
  ): Promise<OutcomeReconciliation> {
    return {
      sessionId,
      state: 'review_required',
      marker,
      record,
      catalogRecordPresent: await this.catalogHas(record),
      diagnostics
    }
  }

  private async loadCanonicalSession(
    sessionId: string,
    scope?: LearningOutcomeCommitterWriterScope
  ): Promise<Extract<LearningSessionSnapshot, { source: 'canonical' }>> {
    const safeSessionId = requireLearningSessionId(sessionId)
    const session = scope ? await scope.load(safeSessionId) : await this.ledger.load(safeSessionId)
    if (!session) throw new OutcomeCommitterError('not_found')
    if (session.readOnly || session.source !== 'canonical') throw new OutcomeCommitterError('read_only')
    return session
  }

  private sessionDirectory(sessionId: string): string {
    return join(this.options.workspaceRoot, 'learning-sessions', requireLearningSessionId(sessionId))
  }

  private async durableReplace(path: string, content: string): Promise<void> {
    await replaceDurably({
      path,
      content,
      operations: this.options.durableFileOperations,
      warn: this.options.durableWarn
    })
  }

  private async catalogHas(record: LearningOutcomeRecordRef | null): Promise<boolean> {
    if (!record) return false
    const catalog = await readLearningAssetCatalog(this.options.workspaceRoot, 'Teaching workspace')
    return catalog.records.some((candidate) => candidate.relativePath === record.relativePath)
  }

  private async inject(point: LearningOutcomeCommitterFaultPoint, sessionId: string, operationId: string): Promise<void> {
    await this.options.testingFaults?.inject(point, { sessionId, operationId })
  }
}

type Settlement = { marker: OutcomeSettlementMarker; record: LearningOutcomeRecordRef | null }

type ParsedRecord = { marker: OutcomeSettlementMarker }

type RegularFileRead =
  | { state: 'missing'; content: null }
  | { state: 'invalid'; content: null }
  | { state: 'valid'; content: string }

type MarkerRead = { state: 'missing' | 'invalid' | 'valid'; marker: OutcomeSettlementMarker | null }
type CanonicalRecordRead = { state: 'missing' | 'invalid' | 'valid'; record: ParsedRecord | null }

function settlementFromEvaluation(
  session: Extract<LearningSessionSnapshot, { source: 'canonical' }>,
  operationId: string,
  evaluation: LearningOutcomeEvaluation,
  outcomeId: string
): Settlement {
  const kind: LearningOutcomeKind = evaluation.kind
  const evidenceEventIds = unique(evaluation.evidenceEventIds)
  if (writesLearningRecord(kind) && (!evaluation.mastery || evaluation.artifact.status !== 'verified' || evidenceEventIds.length === 0)) {
    throw new OutcomeCommitterError('invalid_request')
  }
  const record = writesLearningRecord(kind)
    ? {
        recordId: `learning-outcome-${session.id}-${outcomeId}`,
        relativePath: `${LEARNING_RECORDS_DIRECTORY}/outcome-${session.id}.md`,
        contentSha256: ''
      }
    : null
  const marker: OutcomeSettlementMarker = {
    schemaVersion: LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION,
    sessionId: session.id,
    outcomeId,
    operationId,
    kind,
    evidenceEventIds,
    evaluatorVersion: evaluation.schemaVersion,
    record
  }
  if (record) {
    const content = renderLearningRecord(marker, session, evaluation)
    marker.record = { ...record, contentSha256: sha256(content) }
  }
  return { marker, record: marker.record }
}

function renderLearningRecord(
  marker: OutcomeSettlementMarker,
  session: Extract<LearningSessionSnapshot, { source: 'canonical' }>,
  evaluation: LearningOutcomeEvaluation
): string {
  const metadata = {
    schemaVersion: marker.schemaVersion,
    recordId: marker.record!.recordId,
    sessionId: marker.sessionId,
    outcomeId: marker.outcomeId,
    outcomeKind: marker.kind,
    operationId: marker.operationId,
    evidenceEventIds: marker.evidenceEventIds,
    evaluatorVersion: marker.evaluatorVersion,
    lessonId: session.lessonRef?.lessonId ?? null,
    assessment: evaluation.artifact.status === 'verified'
      ? { relativePath: evaluation.artifact.relativePath, contentSha256: evaluation.artifact.sha256 }
      : null
  }
  return `${RECORD_METADATA_PREFIX}${JSON.stringify(metadata)}${RECORD_METADATA_SUFFIX}\n# Learning outcome: ${marker.kind}\n\nVerified learning outcome for Session \`${marker.sessionId}\`.\n`
}


function assertEvaluationMatchesSession(evaluation: LearningOutcomeEvaluation, session: LearningSessionSnapshot): void {
  if (evaluation.schemaVersion !== 1 || evaluation.sessionId !== session.id) {
    throw new OutcomeCommitterError('invalid_request')
  }
  if (!['established', 'misconception_corrected', 'needs_practice', 'not_evidenced'].includes(evaluation.kind)) {
    throw new OutcomeCommitterError('invalid_request')
  }
}

function writesLearningRecord(kind: LearningOutcomeKind): boolean {
  return kind === 'established' || kind === 'misconception_corrected'
}

function committedResult(
  status: MainLearningOutcomeCommitSuccess['status'],
  marker: OutcomeSettlementMarker,
  catalogRecordPresent: boolean
): MainLearningOutcomeCommitSuccess {
  return {
    status,
    outcome: { outcomeId: marker.outcomeId, kind: marker.kind as LearnerSafeLearningOutcome['kind'], evidenceEventIds: marker.evidenceEventIds },
    recordSaved: marker.record !== null,
    record: marker.record,
    catalogRecordPresent
  }
}

function insufficientEvidenceResult(): Extract<LearnerSafeLearningOutcomeCommitResult, { status: 'insufficient_evidence' }> {
  return { status: 'insufficient_evidence', reason: 'not_evidenced' }
}

function conflictResult(): Extract<LearnerSafeLearningOutcomeCommitResult, { status: 'conflict' }> {
  return { status: 'conflict', reason: 'review_required' }
}

function retryableFailure(
  reason: Extract<LearnerSafeLearningOutcomeCommitResult, { status: 'retryable_failure' }>['reason']
): Extract<LearnerSafeLearningOutcomeCommitResult, { status: 'retryable_failure' }> {
  return { status: 'retryable_failure', reason }
}

function nonRetryableFailure(
  reason: Extract<LearnerSafeLearningOutcomeCommitResult, { status: 'non_retryable_failure' }>['reason']
): Extract<LearnerSafeLearningOutcomeCommitResult, { status: 'non_retryable_failure' }> {
  return { status: 'non_retryable_failure', reason }
}

function resultFromCommitError(error: unknown, writeAttempted: boolean): OutcomeCommitResult {
  if (error instanceof OutcomeCommitterError) return nonRetryableFailure(error.code)
  if (error instanceof LearningSessionLedgerError) {
    if (error.code === 'not_found') return nonRetryableFailure('not_found')
    if (error.code === 'read_only') return nonRetryableFailure('read_only')
    if (error.code === 'invalid_input') return nonRetryableFailure('invalid_request')
    if (error.code === 'invalid_transition' || error.code === 'identity_conflict' || error.code === 'corrupt_session') return conflictResult()
  }
  return retryableFailure(writeAttempted ? 'reconciliation_required' : 'temporarily_unavailable')
}

class OutcomeCommitterError extends Error {
  constructor(readonly code: 'not_found' | 'read_only' | 'invalid_request') {
    super(code)
    this.name = 'OutcomeCommitterError'
  }
}

function asWriterLockedLedger(ledger: LearningSessionLedger): WriterLockedLearningSessionLedger | null {
  return typeof (ledger as Partial<WriterLockedLearningSessionLedger>).withWriterLock === 'function'
    ? ledger as WriterLockedLearningSessionLedger
    : null
}

function emptyReconciliation(sessionId: string, state: OutcomeReconciliation['state']): OutcomeReconciliation {
  return { sessionId, state, marker: null, record: null, catalogRecordPresent: false, diagnostics: [] }
}

function requireOperationId(value: string): string {
  const normalized = String(value ?? '').trim()
  if (!OPERATION_ID_PATTERN.test(normalized)) throw new Error('Outcome operation identity must be a stable ID.')
  return normalized.toLocaleLowerCase('en-US')
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function sameMarkerIdentity(left: OutcomeSettlementMarker, right: OutcomeSettlementMarker): boolean {
  return left.sessionId === right.sessionId &&
    left.outcomeId === right.outcomeId &&
    left.operationId === right.operationId &&
    left.kind === right.kind &&
    left.evaluatorVersion === right.evaluatorVersion &&
    JSON.stringify(left.evidenceEventIds) === JSON.stringify(right.evidenceEventIds) &&
    sameRecordRef(left.record, right.record)
}

function sameRecordRef(left: LearningOutcomeRecordRef | null, right: LearningOutcomeRecordRef | null): boolean {
  return left?.recordId === right?.recordId &&
    left?.relativePath === right?.relativePath &&
    left?.contentSha256 === right?.contentSha256
}

function sameOutcomeRef(left: LearningOutcomeRef | null, right: LearningOutcomeRef): boolean {
  return left !== null &&
    left.outcomeId === right.outcomeId &&
    left.kind === right.kind &&
    left.relativePath === right.relativePath &&
    left.contentSha256 === right.contentSha256 &&
    JSON.stringify(left.evidenceEventIds) === JSON.stringify(right.evidenceEventIds)
}

async function durableStage(
  path: string,
  content: string,
  operations?: DurableFileOperations
): Promise<void> {
  await (operations?.mkdir ?? mkdir)(dirname(path), { recursive: true })
  // A stage is never overwritten: an unexpected pre-existing stage remains
  // evidence for recovery/review rather than being silently replaced.
  const handle = await (operations?.open ?? open)(path, 'wx', 0o600)
  let writeFailure: unknown
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } catch (error) {
    writeFailure = error
    throw error
  } finally {
    try {
      await handle.close()
    } catch (closeError) {
      if (!writeFailure) throw closeError
    }
  }
}

async function publishImmutable(
  stagePath: string,
  recordPath: string,
  expectedContent: string,
  operations?: DurableFileOperations,
  onMatchingExistingBeforeParentSync?: () => Promise<void>
): Promise<void> {
  await (operations?.mkdir ?? mkdir)(dirname(recordPath), { recursive: true })
  try {
    // link() is no-replace publication. Its successful return is deliberately
    // outside the EEXIST path so a following directory-sync/close failure can
    // never be mistaken for an idempotent concurrent publication.
    await link(stagePath, recordPath)
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error
    const existing = await readRegularFile(recordPath)
    if (existing.state !== 'valid' || existing.content !== expectedContent) throw error
    // The existing matching link may be from an interrupted publish, so its
    // parent still has to be durably synced before any projection follows.
    // Reuse the ledger's private fault hook here so the exact EEXIST recovery
    // path can be fail-closed tested without adding another public test API.
    await onMatchingExistingBeforeParentSync?.()
    await syncDirectoryRequired(dirname(recordPath), operations)
    // Cleanup is part of the completed idempotent path; its failure is fatal.
    await unlink(stagePath)
    return
  }
  // Immutable record durability has no capability downgrade. A parent open,
  // sync, or close failure means later projections must not be written.
  await syncDirectoryRequired(dirname(recordPath), operations)
  await unlink(stagePath)
}

async function syncDirectoryRequired(directory: string, operations?: DurableFileOperations): Promise<void> {
  // Node cannot fsync a directory handle on Windows (EPERM). This uses the
  // unwrapped production filesystem only; injected seams remain strict so
  // permission and I/O fault tests cannot be downgraded accidentally.
  if (!operations && process.platform === 'win32') return

  const handle = await (operations?.open ?? open)(directory, 'r')
  let syncFailure: unknown
  try {
    await handle.sync()
  } catch (error) {
    syncFailure = error
    throw error
  } finally {
    try {
      await handle.close()
    } catch (closeError) {
      if (!syncFailure) throw closeError
    }
  }
}

async function readRegularFile(path: string): Promise<RegularFileRead> {
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return { state: 'missing', content: null }
    return { state: 'invalid', content: null }
  }
  if (info.isSymbolicLink() || !info.isFile()) return { state: 'invalid', content: null }
  try {
    return { state: 'valid', content: await readFile(path, 'utf8') }
  } catch {
    // A target observed as a regular file but changed before read is uncertain,
    // not safely absent.
    return { state: 'invalid', content: null }
  }
}

async function readMarker(path: string): Promise<MarkerRead> {
  const file = await readRegularFile(path)
  if (file.state === 'missing') return { state: 'missing', marker: null }
  if (file.state === 'invalid') return { state: 'invalid', marker: null }
  try {
    return { state: 'valid', marker: normalizeMarker(JSON.parse(file.content)) }
  } catch {
    return { state: 'invalid', marker: null }
  }
}

/**
 * A canonical record cannot be recovery authority unless its direct parent is
 * a real directory below the resolved workspace root. In particular, do not
 * follow a `learning-records` link merely because its final record entry is a
 * regular file.
 */
async function readCanonicalRecordsDirectory(
  workspaceRoot: string,
  recordsDirectory: string
): Promise<'missing' | 'invalid' | 'valid'> {
  let info
  try {
    info = await lstat(recordsDirectory)
  } catch (error) {
    return isErrno(error, 'ENOENT') ? 'missing' : 'invalid'
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return 'invalid'

  try {
    const [realRoot, realDirectory] = await Promise.all([realpath(workspaceRoot), realpath(recordsDirectory)])
    if (!isPathInsideRoot(realRoot, realDirectory)) return 'invalid'
    // Recheck after resolving: an attacker must not be able to replace the
    // directory with a link between its first inspection and record access.
    const current = await lstat(recordsDirectory)
    return current.isSymbolicLink() || !current.isDirectory() ? 'invalid' : 'valid'
  } catch {
    return 'invalid'
  }
}

/** Read a final regular file from its already-verified canonical real path. */
async function readContainedRegularFile(workspaceRoot: string, path: string): Promise<RegularFileRead> {
  // Revalidate the direct parent immediately before record access. This closes
  // a parent swap after readCanonicalRecord's initial directory inspection.
  if (await readCanonicalRecordsDirectory(workspaceRoot, dirname(path)) !== 'valid') {
    return { state: 'invalid', content: null }
  }

  let info
  try {
    info = await lstat(path)
  } catch (error) {
    return isErrno(error, 'ENOENT') ? { state: 'missing', content: null } : { state: 'invalid', content: null }
  }
  if (info.isSymbolicLink() || !info.isFile()) return { state: 'invalid', content: null }

  try {
    const [realRoot, realPath] = await Promise.all([realpath(workspaceRoot), realpath(path)])
    if (!isPathInsideRoot(realRoot, realPath)) return { state: 'invalid', content: null }
    if (await readCanonicalRecordsDirectory(workspaceRoot, dirname(path)) !== 'valid') {
      return { state: 'invalid', content: null }
    }
    const realInfo = await lstat(realPath)
    if (realInfo.isSymbolicLink() || !realInfo.isFile()) return { state: 'invalid', content: null }
    return { state: 'valid', content: await readFile(realPath, 'utf8') }
  } catch {
    return { state: 'invalid', content: null }
  }
}

async function readCanonicalRecord(workspaceRoot: string, sessionId: string): Promise<CanonicalRecordRead> {
  const recordsDirectory = join(workspaceRoot, LEARNING_RECORDS_DIRECTORY)
  const directory = await readCanonicalRecordsDirectory(workspaceRoot, recordsDirectory)
  if (directory === 'missing') return { state: 'missing', record: null }
  if (directory === 'invalid') return { state: 'invalid', record: null }

  const file = await readContainedRegularFile(workspaceRoot, join(recordsDirectory, `outcome-${sessionId}.md`))
  if (file.state === 'missing') return { state: 'missing', record: null }
  if (file.state === 'invalid') return { state: 'invalid', record: null }
  const content = file.content
  const start = content.indexOf(RECORD_METADATA_PREFIX)
  const end = start < 0 ? -1 : content.indexOf(RECORD_METADATA_SUFFIX, start)
  if (start !== 0 || end < 0) return { state: 'invalid', record: null }
  try {
    const value = JSON.parse(content.slice(RECORD_METADATA_PREFIX.length, end)) as Record<string, unknown>
    const outcomeId = text(value.outcomeId)
    const operationId = text(value.operationId)
    const kind = outcomeKind(value.outcomeKind)
    const evidenceEventIds = stringArray(value.evidenceEventIds)
    const recordId = text(value.recordId)
    const recordedSessionId = text(value.sessionId)
    const evaluatorVersion = number(value.evaluatorVersion)
    if (
      value.schemaVersion !== LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION ||
      !outcomeId ||
      !operationId ||
      !kind ||
      !writesLearningRecord(kind) ||
      evidenceEventIds.length === 0 ||
      !recordId ||
      recordId !== `learning-outcome-${sessionId}-${outcomeId}` ||
      recordedSessionId !== sessionId ||
      evaluatorVersion === null ||
      !isVerifiedAssessment(value.assessment) ||
      !content.startsWith(`${RECORD_METADATA_PREFIX}${JSON.stringify(value)}${RECORD_METADATA_SUFFIX}\n# Learning outcome: ${kind}\n`)
    ) return { state: 'invalid', record: null }
    if (requireOperationId(operationId) !== operationId) return { state: 'invalid', record: null }
    const relativePath = `${LEARNING_RECORDS_DIRECTORY}/outcome-${sessionId}.md`
    const record: LearningOutcomeRecordRef = { recordId, relativePath, contentSha256: sha256(content) }
    return {
      state: 'valid',
      record: {
        marker: {
          schemaVersion: LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION,
          sessionId,
          outcomeId,
          operationId,
          kind,
          evidenceEventIds,
          evaluatorVersion,
          record
        }
      }
    }
  } catch {
    return { state: 'invalid', record: null }
  }
}

function isVerifiedAssessment(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const assessment = value as Record<string, unknown>
  const relativePath = text(assessment.relativePath)
  const contentSha256 = text(assessment.contentSha256)
  return relativePath !== null && /^[a-f0-9]{64}$/.test(contentSha256 ?? '')
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function normalizeMarker(value: unknown): OutcomeSettlementMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid outcome settlement marker.')
  const record = value as Record<string, unknown>
  const outcomeId = text(record.outcomeId)
  const operationId = text(record.operationId)
  const kind = outcomeKind(record.kind)
  const sessionId = text(record.sessionId)
  const evaluatorVersion = number(record.evaluatorVersion)
  if (record.schemaVersion !== LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION || !outcomeId || !operationId || !kind || !sessionId || evaluatorVersion === null) {
    throw new Error('Invalid outcome settlement marker.')
  }
  const safeSessionId = requireLearningSessionId(sessionId)
  const normalizedOperationId = requireOperationId(operationId)
  if (normalizedOperationId !== operationId) throw new Error('Outcome settlement marker operation ID is not canonical.')
  const evidenceEventIds = stringArray(record.evidenceEventIds)
  const parsedRecord = record.record === null ? null : normalizeRecordRef(record.record)
  if (writesLearningRecord(kind) !== (parsedRecord !== null)) {
    throw new Error('Outcome settlement marker record presence does not match its outcome kind.')
  }
  if (writesLearningRecord(kind) && evidenceEventIds.length === 0) {
    throw new Error('Recorded Learning outcome requires evidence identities.')
  }
  if (parsedRecord && (
    parsedRecord.relativePath !== `${LEARNING_RECORDS_DIRECTORY}/outcome-${safeSessionId}.md` ||
    parsedRecord.recordId !== `learning-outcome-${safeSessionId}-${outcomeId}`
  )) {
    throw new Error('Outcome settlement marker does not match its canonical Learning record identity.')
  }
  return {
    schemaVersion: LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION,
    sessionId: safeSessionId,
    outcomeId,
    operationId,
    kind,
    evidenceEventIds,
    evaluatorVersion,
    record: parsedRecord
  }
}

function normalizeRecordRef(value: unknown): LearningOutcomeRecordRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid learning record reference.')
  const record = value as Record<string, unknown>
  const recordId = text(record.recordId)
  const relativePath = text(record.relativePath)
  const contentSha256 = text(record.contentSha256)
  if (!recordId || !relativePath || !/^[a-f0-9]{64}$/.test(contentSha256 ?? '')) throw new Error('Invalid learning record reference.')
  return { recordId, relativePath, contentSha256: contentSha256! }
}

async function legacyDiagnostics(workspaceRoot: string): Promise<Array<'legacy_generated'>> {
  const directory = join(workspaceRoot, LEARNING_RECORDS_DIRECTORY)
  if (await readCanonicalRecordsDirectory(workspaceRoot, directory) !== 'valid') return []
  const entries = await readdir(directory).catch(() => [])
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry.startsWith('outcome-')) continue
    const content = (await readRegularFile(join(directory, entry))).content ?? ''
    if (/legacy_generated/i.test(content)) return ['legacy_generated']
  }
  return []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('Invalid evidence identity list.')
  return unique(value)
}

function outcomeKind(value: unknown): LearningOutcomeKind | null {
  return value === 'established' || value === 'misconception_corrected' || value === 'needs_practice' || value === 'not_evidenced'
    ? value
    : null
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
