import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import {
  evaluateLearningSessionOutcome,
  type EvaluateLearningSessionOutcomeInput,
  type LearningOutcomeEvaluation
} from './learning-outcome-evaluator'
import {
  createLearningSessionLedger,
  encodeCommittedLearningSessionOutcome,
  LearningSessionLedgerError,
  type LearningSessionLedger
} from './learning-session-ledger'
import { readLearningAssetCatalog } from './teaching-workspace/learning-assets-catalog'
import { requireLearningSessionId } from '../shared/teaching-placement'
import type { LearningOutcomeKind, LearningSessionSnapshot } from '../shared/teaching-types/learning-session'
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

    let writeAttempted = false
    try {
      const session = await this.loadCanonicalSession(sessionId)
      const existing = await this.reconcile(sessionId)
      if (existing.state === 'review_required') return conflictResult()
      if (existing.state === 'read_only') return nonRetryableFailure('read_only')
      if (existing.state === 'not_found') return nonRetryableFailure('not_found')
      if (existing.marker?.operationId === operationId && existing.state === 'settled') {
        if (existing.marker.kind === 'not_evidenced') return insufficientEvidenceResult()
        return committedResult('already_committed', existing.marker, existing.catalogRecordPresent)
      }
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
        await durableAtomicReplace(
          join(this.sessionDirectory(sessionId), OUTCOME_SETTLEMENT_FILE),
          serialize(settlement.marker)
        )
        await this.inject('after_settlement_marker', sessionId, operationId)
        await this.inject('before_catalog_reconcile', sessionId, operationId)
        if (settlement.marker.kind === 'not_evidenced') return insufficientEvidenceResult()
        const catalogRecordPresent = await this.catalogHas(settlement.marker.record)
        return committedResult('committed', settlement.marker, catalogRecordPresent)
      }

      const record = settlement.record!
      const recordContent = renderLearningRecord(settlement.marker, session, evaluation)
      const recordsDirectory = join(this.options.workspaceRoot, LEARNING_RECORDS_DIRECTORY)
      const stagePath = join(recordsDirectory, STAGE_DIRECTORY, `${record.recordId}.${operationId}.md`)
      const recordPath = join(this.options.workspaceRoot, ...record.relativePath.split('/'))

      writeAttempted = true
      await durableStage(stagePath, recordContent)
      await this.inject('after_stage_flush', sessionId, operationId)
      await publishImmutable(stagePath, recordPath, recordContent)
      await this.inject('after_record_publish', sessionId, operationId)

      const encoded = encodeCommittedLearningSessionOutcome({
        sessionId,
        outcomeId: settlement.marker.outcomeId,
        kind: settlement.marker.kind,
        evidenceEventIds: settlement.marker.evidenceEventIds
      })
      await durableAtomicReplace(join(this.sessionDirectory(sessionId), 'outcome.json'), encoded.content)
      await this.inject('after_outcome_publish', sessionId, operationId)
      await this.ledger.complete(sessionId, encoded.ref)
      await durableAtomicReplace(join(this.sessionDirectory(sessionId), OUTCOME_SETTLEMENT_FILE), serialize(settlement.marker))
      await this.inject('after_settlement_marker', sessionId, operationId)
      await this.inject('before_catalog_reconcile', sessionId, operationId)

      return committedResult('committed', settlement.marker, await this.catalogHas(record))
    } catch (error) {
      return resultFromCommitError(error, writeAttempted)
    }
  }

  async reconcile(sessionId: string): Promise<OutcomeReconciliation> {
    const safeSessionId = requireLearningSessionId(sessionId)
    const snapshot = await this.ledger.load(safeSessionId)
    if (!snapshot) return emptyReconciliation(safeSessionId, 'not_found')
    if (snapshot.readOnly) return { ...emptyReconciliation(safeSessionId, 'read_only'), diagnostics: await legacyDiagnostics(this.options.workspaceRoot) }

    await cleanupStages(join(this.options.workspaceRoot, LEARNING_RECORDS_DIRECTORY, STAGE_DIRECTORY))
    const diagnostics: OutcomeReconciliation['diagnostics'] = await legacyDiagnostics(this.options.workspaceRoot)
    const markerResult = await readMarker(join(this.sessionDirectory(safeSessionId), OUTCOME_SETTLEMENT_FILE))
    if (markerResult.invalid) diagnostics.push('invalid_settlement_marker')
    const marker = markerResult.marker
    // The immutable canonical record is the recovery authority. A marker only
    // supplies a no-record outcome or confirms the canonical record projection.
    const record = await readCanonicalRecord(this.options.workspaceRoot, safeSessionId)

    if (record) {
      const repairedMarker = markerFromRecord(record) ?? marker
      if (!repairedMarker) {
        diagnostics.push('missing_record')
        return { sessionId: safeSessionId, state: 'review_required', marker, record: null, catalogRecordPresent: false, diagnostics }
      }
      if (marker && !sameMarkerIdentity(marker, repairedMarker)) {
        diagnostics.push('conflicting_outcome')
        return {
          sessionId: safeSessionId,
          state: 'review_required',
          marker,
          record: repairedMarker.record,
          catalogRecordPresent: await this.catalogHas(repairedMarker.record),
          diagnostics
        }
      }
      const encoded = encodeCommittedLearningSessionOutcome({
        sessionId: safeSessionId,
        outcomeId: repairedMarker.outcomeId,
        kind: repairedMarker.kind,
        evidenceEventIds: repairedMarker.evidenceEventIds
      })
      const outcomePath = join(this.sessionDirectory(safeSessionId), 'outcome.json')
      const existingOutcome = await readRegularFile(outcomePath)
      if (existingOutcome !== null && existingOutcome !== encoded.content) {
        diagnostics.push('conflicting_outcome')
        return {
          sessionId: safeSessionId,
          state: 'review_required',
          marker: repairedMarker,
          record: repairedMarker.record,
          catalogRecordPresent: await this.catalogHas(repairedMarker.record),
          diagnostics
        }
      }
      if (existingOutcome === null) await durableAtomicReplace(outcomePath, encoded.content)
      const reloaded = await this.ledger.load(safeSessionId)
      if (reloaded?.status === 'active') await this.ledger.complete(safeSessionId, encoded.ref)
      if (!marker || !sameMarkerIdentity(marker, repairedMarker)) {
        await durableAtomicReplace(join(this.sessionDirectory(safeSessionId), OUTCOME_SETTLEMENT_FILE), serialize(repairedMarker))
      }
      return {
        sessionId: safeSessionId,
        state: marker ? 'settled' : 'repaired',
        marker: repairedMarker,
        record: repairedMarker.record,
        catalogRecordPresent: await this.catalogHas(repairedMarker.record),
        diagnostics
      }
    }

    if (marker?.record || (snapshot.status === 'completed' && snapshot.outcomeRef !== null)) diagnostics.push('missing_record')
    return {
      sessionId: safeSessionId,
      state: marker ? (marker.record ? 'review_required' : 'settled') : snapshot.status === 'completed' ? 'review_required' : 'pending',
      marker,
      record: null,
      catalogRecordPresent: false,
      diagnostics
    }
  }

  private async loadCanonicalSession(sessionId: string): Promise<Extract<LearningSessionSnapshot, { source: 'canonical' }>> {
    const safeSessionId = requireLearningSessionId(sessionId)
    const session = await this.ledger.load(safeSessionId)
    if (!session) throw new OutcomeCommitterError('not_found')
    if (session.readOnly || session.source !== 'canonical') throw new OutcomeCommitterError('read_only')
    return session
  }

  private sessionDirectory(sessionId: string): string {
    return join(this.options.workspaceRoot, 'learning-sessions', requireLearningSessionId(sessionId))
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

function markerFromRecord(record: ParsedRecord): OutcomeSettlementMarker | null {
  return record.marker
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
    JSON.stringify(left.evidenceEventIds) === JSON.stringify(right.evidenceEventIds) &&
    left.record?.contentSha256 === right.record?.contentSha256
}

async function durableStage(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await durableWrite(path, content)
}

async function publishImmutable(stagePath: string, recordPath: string, expectedContent: string): Promise<void> {
  await mkdir(join(recordPath, '..'), { recursive: true })
  try {
    // Linking a fully synced stage file publishes exactly one immutable record.
    // Unlike rename, it cannot replace a concurrent publisher's canonical file.
    await link(stagePath, recordPath)
    await syncDirectory(join(recordPath, '..'))
    await unlink(stagePath)
  } catch (error) {
    const existing = await readFile(recordPath, 'utf8').catch(() => null)
    if (existing === expectedContent) {
      await rm(stagePath, { force: true })
      return
    }
    throw error
  }
}

async function durableAtomicReplace(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await durableWrite(temporary, content)
    await rename(temporary, path)
    await syncDirectory(join(path, '..'))
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function durableWrite(path: string, content: string): Promise<void> {
  const handle = await open(path, 'w', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r').catch(() => null)
  if (!handle) return
  try {
    await handle.sync()
  } catch {
    // Windows does not consistently permit directory handles to be synced.
  } finally {
    await handle.close()
  }
}

async function cleanupStages(directory: string): Promise<void> {
  const entries = await readdir(directory).catch(() => [])
  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry)
    const info = await stat(path).catch(() => null)
    if (info?.isFile()) await rm(path, { force: true })
  }))
}

async function readRegularFile(path: string): Promise<string | null> {
  const info = await lstat(path).catch(() => null)
  if (!info || info.isSymbolicLink() || !info.isFile()) return null
  return readFile(path, 'utf8').catch(() => null)
}
async function readMarker(path: string): Promise<{ marker: OutcomeSettlementMarker | null; invalid: boolean }> {
  const content = await readRegularFile(path)
  if (content === null) return { marker: null, invalid: false }
  try {
    return { marker: normalizeMarker(JSON.parse(content)), invalid: false }
  } catch {
    return { marker: null, invalid: true }
  }
}

async function readCanonicalRecord(workspaceRoot: string, sessionId: string): Promise<ParsedRecord | null> {
  const content = await readRegularFile(join(workspaceRoot, LEARNING_RECORDS_DIRECTORY, `outcome-${sessionId}.md`))
  if (content === null) return null
  const start = content.indexOf(RECORD_METADATA_PREFIX)
  const end = start < 0 ? -1 : content.indexOf(RECORD_METADATA_SUFFIX, start)
  if (start !== 0 || end < 0) return null
  try {
    const value = JSON.parse(content.slice(RECORD_METADATA_PREFIX.length, end)) as Record<string, unknown>
    const outcomeId = text(value.outcomeId)
    const operationId = text(value.operationId)
    const kind = outcomeKind(value.outcomeKind)
    const evidenceEventIds = stringArray(value.evidenceEventIds)
    const recordId = text(value.recordId)
    const recordedSessionId = text(value.sessionId)
    const evaluatorVersion = number(value.evaluatorVersion)
    if (!outcomeId || !operationId || !kind || !recordId || recordedSessionId !== sessionId || evaluatorVersion === null) return null
    const relativePath = `${LEARNING_RECORDS_DIRECTORY}/outcome-${sessionId}.md`
    const record: LearningOutcomeRecordRef = { recordId, relativePath, contentSha256: sha256(content) }
    return {
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
  } catch {
    return null
  }
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
  const parsedRecord = record.record === null ? null : normalizeRecordRef(record.record)
  if (parsedRecord && parsedRecord.relativePath !== `${LEARNING_RECORDS_DIRECTORY}/outcome-${safeSessionId}.md`) {
    throw new Error('Outcome settlement marker points outside its canonical Learning record path.')
  }
  return {
    schemaVersion: LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION,
    sessionId: safeSessionId,
    outcomeId,
    operationId,
    kind,
    evidenceEventIds: stringArray(record.evidenceEventIds),
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
  const entries = await readdir(directory).catch(() => [])
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry.startsWith('outcome-')) continue
    const content = await readRegularFile(join(directory, entry)) ?? ''
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
