import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { redactAgentSecretText } from '../../shared/agent-secret-redaction'
import type { AgentArtifactRef, AgentRunUsageAggregate } from '../../shared/teaching-types'
import { writeContentAddressedFile } from '../path-access'
import type {
  AgentOperationRecord,
  AgentParentTurnStage,
  AgentParentTurnStageEvidence,
  AgentParentTurnTextEvidence,
  AgentRunCheckpoint,
  AgentRunChildRecord
} from './agent-run-types'
import { assertSafeId } from './agent-run-types'

const MAX_RESULT_BYTES = 16 * 1024
const MAX_PARENT_TURN_STAGE_BYTES = 96 * 1024
const MAX_PARENT_TURN_PREVIEW_BYTES = 16 * 1024
const MAX_PARENT_TURN_EVIDENCE = 32
const MAX_RESOURCE_METADATA_ITEMS = 20
const CHILD_TRANSCRIPT_DIRECTORY = '.agent-sessions/child-transcripts'

/** Windows codes that commonly indicate a transient file lock / sharing violation. */
const WINDOWS_TRANSIENT_FS_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
/** Bounded backoff schedule for transient Windows filesystem races (rename + temp open/fsync). */
const WINDOWS_TRANSIENT_FS_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320] as const

type RenameFile = (from: string, to: string) => Promise<void>
type SyncFile = (path: string) => Promise<void>
type Wait = (delayMs: number) => Promise<void>

export type AgentRunPersistenceOptions = Readonly<{
  platform?: NodeJS.Platform
  rename?: RenameFile
  /** Injected open+fsync seam used by tests; production defaults to open(path,'r+') + handle.sync(). */
  syncFile?: SyncFile
  /** Shared bounded retry delays for Windows transient rename and temp-file sync failures. */
  renameRetryDelaysMs?: readonly number[]
  wait?: Wait
}>

function defineInternalDebugProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: false,
    writable: false
  })
}

function defineInternalCause(target: object, cause: unknown): void {
  Object.defineProperty(target, 'cause', {
    value: cause,
    enumerable: false,
    configurable: true,
    writable: true
  })
}

/**
 * Typed publish failure for the atomic rename step.
 *
 * Absolute paths and the raw cause are retained only as non-enumerable debug fields so that
 * message text, Object.keys / for..in enumeration, and JSON serialization stay path-safe.
 */
export class AgentRunAtomicRenameError extends Error {
  readonly name = 'AgentRunAtomicRenameError'
  readonly code = 'agent_run_atomic_rename_failed'
  readonly causeCode: string | undefined
  readonly attempts: number
  readonly retryable: boolean
  /** @internal absolute source path for local debugging only; non-enumerable */
  readonly sourcePath!: string
  /** @internal absolute destination path for local debugging only; non-enumerable */
  readonly destinationPath!: string

  constructor(
    sourcePath: string,
    destinationPath: string,
    attempts: number,
    retryable: boolean,
    cause: unknown
  ) {
    const causeCode = errnoCode(cause)
    super(
      `Atomic agent state rename failed after ${attempts} attempt${attempts === 1 ? '' : 's'}` +
      `${causeCode ? ` (${causeCode})` : ''}.`
    )
    this.causeCode = causeCode
    this.attempts = attempts
    this.retryable = retryable
    defineInternalDebugProperty(this, 'sourcePath', sourcePath)
    defineInternalDebugProperty(this, 'destinationPath', destinationPath)
    defineInternalCause(this, cause)
  }
}

/**
 * Typed publish failure for the temp-file open/fsync step that precedes rename.
 * Same non-enumerable path / cause policy as {@link AgentRunAtomicRenameError}.
 */
export class AgentRunAtomicSyncError extends Error {
  readonly name = 'AgentRunAtomicSyncError'
  readonly code = 'agent_run_atomic_sync_failed'
  readonly causeCode: string | undefined
  readonly attempts: number
  readonly retryable: boolean
  /** @internal absolute temp path for local debugging only; non-enumerable */
  readonly path!: string

  constructor(
    path: string,
    attempts: number,
    retryable: boolean,
    cause: unknown
  ) {
    const causeCode = errnoCode(cause)
    super(
      `Atomic agent state temp-file sync failed after ${attempts} attempt${attempts === 1 ? '' : 's'}` +
      `${causeCode ? ` (${causeCode})` : ''}.`
    )
    this.causeCode = causeCode
    this.attempts = attempts
    this.retryable = retryable
    defineInternalDebugProperty(this, 'path', path)
    defineInternalCause(this, cause)
  }
}

export function agentRunChildTranscriptRelativePath(
  runId: string,
  childRunId: string,
  sha256: string
): string {
  assertSafeId(runId, 'runId')
  assertSafeId(childRunId, 'childRunId')
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid child transcript digest.')
  const childKey = createHash('sha256').update(childRunId).digest('hex').slice(0, 16)
  return `${CHILD_TRANSCRIPT_DIRECTORY}/${runId}/${childKey}-${sha256}.txt`
}

/** Internal shared persistence implementation. Lifecycle and operation modules share its queue,
 * path containment rules, atomic writes, and schema validation without exposing those concerns
 * through either public seam. */
export class AgentRunPersistence {
  private queue = Promise.resolve()

  constructor(
    readonly storageRoot: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly options: AgentRunPersistenceOptions = {}
  ) {}

  timestamp(): string {
    return this.now()
  }

  serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  async flush(): Promise<void> {
    await this.queue
  }

  async readCheckpoint(runId: string): Promise<AgentRunCheckpoint> {
    assertSafeId(runId, 'runId')
    return this.readValidated(await this.safeFilePath('runs', `${runId}.json`, false), validateCheckpoint)
  }

  async writeCheckpoint(checkpoint: AgentRunCheckpoint, replace: boolean): Promise<void> {
    const path = await this.safeFilePath('runs', `${checkpoint.runId}.json`, true)
    await atomicPrivateJson(path, validateCheckpoint(checkpoint), replace, undefined, this.options)
  }

  async listCheckpointFiles(): Promise<string[]> {
    const directory = await this.safeDirectory('runs', true)
    return (await readdir(directory).catch(() => [])).filter((name) => name.endsWith('.json')).sort()
  }

  async readCheckpointFile(name: string): Promise<AgentRunCheckpoint> {
    return this.readValidated(await this.safeFilePath('runs', name, false), validateCheckpoint)
  }

  async readParentTurnStage(runId: string): Promise<AgentParentTurnStage> {
    assertSafeId(runId, 'runId')
    return this.readValidated(
      await this.safeFilePath('parent-turns', `${runId}.json`, false),
      validateParentTurnStage,
      MAX_PARENT_TURN_STAGE_BYTES
    )
  }

  async writeParentTurnStage(stage: AgentParentTurnStage, replace: boolean): Promise<void> {
    const path = await this.safeFilePath('parent-turns', `${stage.runId}.json`, true)
    await atomicPrivateJson(path, validateParentTurnStage(stage), replace, MAX_PARENT_TURN_STAGE_BYTES, this.options)
  }

  async listParentTurnStageFiles(): Promise<string[]> {
    const directory = await this.safeDirectory('parent-turns', true)
    return (await readdir(directory).catch(() => [])).filter((name) => name.endsWith('.json')).sort()
  }

  async readParentTurnStageFile(name: string): Promise<AgentParentTurnStage> {
    return this.readValidated(
      await this.safeFilePath('parent-turns', name, false),
      validateParentTurnStage,
      MAX_PARENT_TURN_STAGE_BYTES
    )
  }

  async readChildRun(runId: string, childRunId: string): Promise<AgentRunChildRecord> {
    assertSafeId(runId, 'runId')
    assertSafeId(childRunId, 'childRunId')
    return this.readValidated(
      await this.safeFilePath(join('child-runs', runId), `${childRunId}.json`, false),
      validateChildRun
    )
  }

  async writeChildRun(record: AgentRunChildRecord, replace: boolean): Promise<void> {
    const path = await this.safeFilePath(join('child-runs', record.runId), `${record.childRunId}.json`, true)
    await atomicPrivateJson(path, validateChildRun(record), replace, undefined, this.options)
  }

  async listChildRunFiles(runId: string): Promise<string[]> {
    assertSafeId(runId, 'runId')
    const directory = await this.safeDirectory(join('child-runs', runId), true)
    return (await readdir(directory).catch(() => [])).filter((name) => name.endsWith('.json')).sort()
  }

  async listChildRunParentIds(): Promise<string[]> {
    const directory = await this.safeDirectory('child-runs', true)
    return (await readdir(directory, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9._:-]{1,160}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
  }

  async readOperation(runId: string, operationId: string): Promise<AgentOperationRecord> {
    assertSafeId(runId, 'runId')
    assertSafeId(operationId, 'operationId')
    return this.readValidated(await this.safeFilePath(join('operations', runId), `${operationId}.json`, false), validateOperation)
  }

  async writeOperation(record: AgentOperationRecord, replace: boolean): Promise<void> {
    const path = await this.safeFilePath(join('operations', record.runId), `${record.operationId}.json`, true)
    await atomicPrivateJson(path, validateOperation(record), replace, undefined, this.options)
  }

  async listOperationFiles(runId: string): Promise<string[]> {
    assertSafeId(runId, 'runId')
    const directory = await this.safeDirectory(join('operations', runId), true)
    return (await readdir(directory).catch(() => [])).filter((name) => name.endsWith('.json')).sort()
  }

  async stageChildTranscript(runId: string, childRunId: string, content: string): Promise<AgentArtifactRef> {
    assertSafeId(runId, 'runId')
    assertSafeId(childRunId, 'childRunId')
    const redactedContent = redactAgentSecretText(content)
    const sha256 = createHash('sha256').update(redactedContent).digest('hex')
    const relativePath = agentRunChildTranscriptRelativePath(runId, childRunId, sha256)
    await writeContentAddressedFile({
      rootPath: this.storageRoot,
      targetPath: join(this.storageRoot, relativePath),
      content: redactedContent,
      sha256
    })
    return {
      kind: 'child_transcript',
      relativePath,
      sha256,
      bytes: Buffer.byteLength(redactedContent, 'utf8'),
      lines: redactedContent ? redactedContent.split(/\r\n|\r|\n/).length : 0,
      archivedAt: this.now()
    }
  }

  async artifactExists(pointer: string): Promise<boolean> {
    return containedArtifactExists(this.storageRoot, pointer)
  }

  private async readValidated<T>(path: string, validate: (value: unknown) => T, maxBytes?: number): Promise<T> {
    try {
      if (maxBytes !== undefined) {
        const info = await stat(path)
        if (!info.isFile() || info.size > maxBytes) throw new Error('Agent state record exceeds its storage limit.')
      }
      return validate(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if (isNotFound(error)) throw error
      // Always surface the canonical corrupt/unsupported diagnostic. Quarantine is best-effort:
      // bounded Windows rename retries may still fail, but that must not replace the original
      // parse/validation failure semantics. Any quarantine failure is retained only as a
      // non-enumerable internal cause (typed rename error already redacts absolute paths).
      let quarantineFailure: unknown
      try {
        await quarantine(path, this.now(), this.options)
      } catch (failed) {
        quarantineFailure = failed
      }
      const diagnostic = new Error(`Agent state record is corrupt or unsupported: ${cleanDiagnostic(error)}`)
      if (quarantineFailure !== undefined) defineInternalCause(diagnostic, quarantineFailure)
      throw diagnostic
    }
  }

  private async safeDirectory(relativeDirectory: string, create: boolean): Promise<string> {
    safePointer(relativeDirectory)
    const root = resolve(this.storageRoot)
    if (create) await mkdir(root, { recursive: true })
    const rootReal = await realpath(root)
    const sessions = join(root, '.agent-sessions')
    const sessionsInfo = await lstat(sessions).catch(() => null)
    if (sessionsInfo?.isSymbolicLink()) {
      const sessionsReal = await realpath(sessions)
      if (!inside(rootReal, sessionsReal)) throw new Error('Agent session directory escapes storage root through a symlink.')
    }
    if (create) await mkdir(join(sessions, relativeDirectory), { recursive: true })
    const directory = join(sessions, relativeDirectory)
    const existingParent = await nearestExisting(directory)
    const parentReal = await realpath(existingParent)
    if (!inside(rootReal, parentReal)) throw new Error('Agent state path escapes storage root.')
    return directory
  }

  private async safeFilePath(relativeDirectory: string, name: string, create: boolean): Promise<string> {
    if (!/^[A-Za-z0-9._:-]+\.json$/.test(name)) throw new Error('Unsafe agent state file name.')
    const directory = await this.safeDirectory(relativeDirectory, create)
    const path = join(directory, name)
    if (!inside(resolve(this.storageRoot), resolve(path))) throw new Error('Agent state path escapes storage root.')
    const existing = await lstat(path).catch((error) => {
      if (isNotFound(error)) return null
      throw error
    })
    if (existing?.isSymbolicLink()) throw new Error('Agent state file must not be a symbolic link.')
    return path
  }
}

function validateParentTurnStage(value: unknown): AgentParentTurnStage {
  const record = strictRecord(value, [
    'schemaVersion', 'runId', 'streamId', 'workspaceId', 'conversationId', 'targetConversationId',
    'status', 'previousStatus', 'boundary', 'userInput', 'confirmedAssistant', 'lastDurableSequence',
    'unrecoverableAssistantDeltaBytes', 'unrecoverableAssistantDeltaCount', 'evidence', 'expectedParentTurnProof',
    'createdAt', 'updatedAt', 'interruptedAt', 'settledAt', 'failureReason', 'recoveryReason'
  ])
  if (record.schemaVersion !== 1) throw new Error('Unsupported parent turn staging schema version.')
  const evidence = Array.isArray(record.evidence) ? record.evidence.map(validateParentTurnEvidence) : null
  if (!evidence || evidence.length > MAX_PARENT_TURN_EVIDENCE) throw new Error('Invalid parent turn staging evidence.')
  const stage: AgentParentTurnStage = {
    schemaVersion: 1,
    runId: safeIdValue(record.runId, 'runId'),
    streamId: safeIdValue(record.streamId, 'streamId'),
    ...(optionalSafeId(record.workspaceId, 'workspaceId') ? { workspaceId: optionalSafeId(record.workspaceId, 'workspaceId') } : {}),
    ...(optionalSafeId(record.conversationId, 'conversationId') ? { conversationId: optionalSafeId(record.conversationId, 'conversationId') } : {}),
    ...(optionalSafeId(record.targetConversationId, 'targetConversationId') ? { targetConversationId: optionalSafeId(record.targetConversationId, 'targetConversationId') } : {}),
    status: stringEnum(record.status, ['running', 'waiting_for_permission', 'waiting_for_elicitation', 'awaiting_conversation_save', 'interrupted', 'settled', 'failed', 'canceled'] as const),
    ...(record.previousStatus !== undefined ? {
      previousStatus: stringEnum(record.previousStatus, ['running', 'waiting_for_permission', 'waiting_for_elicitation', 'awaiting_conversation_save'] as const)
    } : {}),
    boundary: stringEnum(record.boundary, ['input_received', 'provider_stream', 'tool_boundary', 'permission_boundary', 'elicitation_boundary', 'final_confirmed', 'conversation_save'] as const),
    userInput: validateParentTurnTextEvidence(record.userInput),
    ...(record.confirmedAssistant !== undefined ? { confirmedAssistant: validateParentTurnTextEvidence(record.confirmedAssistant) } : {}),
    lastDurableSequence: nonNegativeInteger(record.lastDurableSequence),
    unrecoverableAssistantDeltaBytes: nonNegativeInteger(record.unrecoverableAssistantDeltaBytes),
    unrecoverableAssistantDeltaCount: nonNegativeInteger(record.unrecoverableAssistantDeltaCount),
    evidence,
    ...(record.expectedParentTurnProof !== undefined ? { expectedParentTurnProof: hashValue(record.expectedParentTurnProof) } : {}),
    createdAt: isoString(record.createdAt),
    updatedAt: isoString(record.updatedAt),
    ...(record.interruptedAt !== undefined ? { interruptedAt: isoString(record.interruptedAt) } : {}),
    ...(record.settledAt !== undefined ? { settledAt: isoString(record.settledAt) } : {}),
    ...(record.failureReason !== undefined ? { failureReason: redactedShortText(record.failureReason) } : {}),
    ...(record.recoveryReason !== undefined ? { recoveryReason: redactedShortText(record.recoveryReason) } : {})
  }
  if (Boolean(stage.targetConversationId) !== Boolean(stage.expectedParentTurnProof)) {
    throw new Error('Parent turn staging commit target and proof must be persisted together.')
  }
  if (stage.status === 'awaiting_conversation_save' && !stage.confirmedAssistant) {
    throw new Error('Awaiting parent turn staging requires a confirmed assistant answer.')
  }
  if (stage.status === 'settled' && (!stage.confirmedAssistant || !stage.targetConversationId || !stage.expectedParentTurnProof || !stage.settledAt)) {
    throw new Error('Settled parent turn staging is incomplete.')
  }
  if (stage.status === 'interrupted' && (!stage.previousStatus || !stage.interruptedAt)) {
    throw new Error('Interrupted parent turn staging is incomplete.')
  }
  if (stage.evidence.some((item) => item.sequence > stage.lastDurableSequence)) {
    throw new Error('Parent turn staging evidence exceeds its durable sequence.')
  }
  return stage
}

function validateParentTurnTextEvidence(value: unknown): AgentParentTurnTextEvidence {
  const record = strictRecord(value, ['sha256', 'preview', 'originalBytes', 'truncated'])
  if (typeof record.truncated !== 'boolean') throw new Error('Invalid parent turn truncation marker.')
  return {
    sha256: hashValue(record.sha256),
    preview: redactedLimitedString(record.preview, MAX_PARENT_TURN_PREVIEW_BYTES),
    originalBytes: integerInRange(record.originalBytes, 0, 64 * 1024 * 1024),
    truncated: record.truncated
  }
}

function validateParentTurnEvidence(value: unknown): AgentParentTurnStageEvidence {
  const record = strictRecord(value, ['sequence', 'kind', 'title', 'detail', 'toolName', 'isError', 'createdAt'])
  return {
    sequence: nonNegativeInteger(record.sequence),
    kind: stringEnum(record.kind, ['status', 'tool_call', 'tool_result', 'permission_wait', 'permission_resolved', 'elicitation_wait', 'elicitation_resolved', 'terminal'] as const),
    title: redactedLimitedString(record.title, 512),
    ...(record.detail !== undefined ? { detail: redactedLimitedString(record.detail, 2048) } : {}),
    ...(record.toolName !== undefined ? { toolName: safeIdValue(record.toolName, 'toolName') } : {}),
    ...(typeof record.isError === 'boolean' ? { isError: record.isError } : {}),
    createdAt: isoString(record.createdAt)
  }
}

function validateCheckpoint(value: unknown): AgentRunCheckpoint {
  const record = strictRecord(value, [
    'version', 'runId', 'streamId', 'workspaceId', 'conversationId', 'status', 'previousStatus',
    'lastDurableSequence', 'createdAt', 'updatedAt', 'completedAt', 'interruptedAt', 'transcriptPointer',
    'parentTurnStagingPointer', 'operationJournalPointer', 'pendingPermissionId', 'pendingElicitationId', 'budget', 'usage', 'stopReason',
    'interruptionReason'
  ])
  if (record.version !== 1) throw new Error('Unsupported checkpoint version.')
  const status = stringEnum(record.status, ['running', 'waiting_for_permission', 'waiting_for_elicitation', 'awaiting_conversation_save', 'completed', 'failed', 'canceled', 'interrupted'] as const)
  return {
    version: 1,
    runId: safeIdValue(record.runId, 'runId'),
    streamId: safeIdValue(record.streamId, 'streamId'),
    ...(optionalSafeId(record.workspaceId, 'workspaceId') ? { workspaceId: optionalSafeId(record.workspaceId, 'workspaceId') } : {}),
    ...(optionalSafeId(record.conversationId, 'conversationId') ? { conversationId: optionalSafeId(record.conversationId, 'conversationId') } : {}),
    status,
    ...(record.previousStatus !== undefined ? { previousStatus: stringEnum(record.previousStatus, ['running', 'waiting_for_permission', 'waiting_for_elicitation', 'awaiting_conversation_save'] as const) } : {}),
    lastDurableSequence: nonNegativeInteger(record.lastDurableSequence),
    createdAt: isoString(record.createdAt),
    updatedAt: isoString(record.updatedAt),
    ...(record.completedAt !== undefined ? { completedAt: isoString(record.completedAt) } : {}),
    ...(record.interruptedAt !== undefined ? { interruptedAt: isoString(record.interruptedAt) } : {}),
    ...(record.transcriptPointer !== undefined ? { transcriptPointer: safePointerValue(record.transcriptPointer) } : {}),
    ...(record.parentTurnStagingPointer !== undefined ? { parentTurnStagingPointer: safePointerValue(record.parentTurnStagingPointer) } : {}),
    operationJournalPointer: safePointerValue(record.operationJournalPointer),
    ...(record.pendingPermissionId !== undefined ? { pendingPermissionId: safeIdValue(record.pendingPermissionId, 'pendingPermissionId') } : {}),
    ...(record.pendingElicitationId !== undefined ? { pendingElicitationId: safeIdValue(record.pendingElicitationId, 'pendingElicitationId') } : {}),
    usage: validateUsage(record.usage),
    ...(record.stopReason !== undefined ? { stopReason: redactedShortText(record.stopReason) } : {}),
    ...(record.interruptionReason !== undefined ? { interruptionReason: redactedShortText(record.interruptionReason) } : {})
  }
}

function validateChildRun(value: unknown): AgentRunChildRecord {
  const record = strictRecord(value, [
    'version', 'runId', 'childRunId', 'parentStreamId', 'label', 'profile', 'status', 'createdAt', 'startedAt',
    'completedAt', 'updatedAt', 'summary', 'error', 'usage', 'recoveryReason', 'recoveredAt'
  ])
  if (record.version !== 1) throw new Error('Unsupported child run version.')
  return {
    version: 1,
    runId: safeIdValue(record.runId, 'runId'),
    childRunId: safeIdValue(record.childRunId, 'childRunId'),
    ...(optionalSafeId(record.parentStreamId, 'parentStreamId') ? { parentStreamId: optionalSafeId(record.parentStreamId, 'parentStreamId') } : {}),
    label: redactedShortText(record.label),
    profile: stringEnum(record.profile, ['read_only', 'research', 'workspace_audit'] as const),
    status: stringEnum(record.status, ['queued', 'running', 'completed', 'failed', 'canceled', 'recoverable'] as const),
    createdAt: isoString(record.createdAt),
    ...(record.startedAt !== undefined ? { startedAt: isoString(record.startedAt) } : {}),
    ...(record.completedAt !== undefined ? { completedAt: isoString(record.completedAt) } : {}),
    updatedAt: isoString(record.updatedAt),
    ...(record.summary !== undefined ? { summary: redactedShortText(record.summary) } : {}),
    ...(record.error !== undefined ? { error: redactedShortText(record.error) } : {}),
    ...(record.usage !== undefined ? { usage: validateChildUsage(record.usage) } : {}),
    ...(record.recoveryReason !== undefined ? { recoveryReason: redactedShortText(record.recoveryReason) } : {}),
    ...(record.recoveredAt !== undefined ? { recoveredAt: isoString(record.recoveredAt) } : {})
  }
}

function validateOperation(value: unknown): AgentOperationRecord {
  const record = strictRecord(value, [
    'version', 'operationId', 'runId', 'toolCallId', 'toolName', 'normalizedTarget', 'state', 'resultHash',
    'result', 'artifactPointer', 'artifactExists', 'disposition', 'createdAt', 'updatedAt', 'completedAt', 'error'
  ])
  if (record.version !== 1) throw new Error('Unsupported operation version.')
  return {
    version: 1,
    operationId: safeIdValue(record.operationId, 'operationId'),
    runId: safeIdValue(record.runId, 'runId'),
    toolCallId: shortText(record.toolCallId),
    toolName: safeIdValue(record.toolName, 'toolName'),
    ...(record.normalizedTarget !== undefined ? { normalizedTarget: safePointerValue(record.normalizedTarget) } : {}),
    state: stringEnum(record.state, ['started', 'completed', 'failed', 'interrupted', 'needs_review'] as const),
    ...(record.resultHash !== undefined ? { resultHash: hashValue(record.resultHash) } : {}),
    ...(record.result !== undefined ? { result: redactedLimitedString(record.result, MAX_RESULT_BYTES) } : {}),
    ...(record.artifactPointer !== undefined ? { artifactPointer: safePointerValue(record.artifactPointer) } : {}),
    ...(typeof record.artifactExists === 'boolean' ? { artifactExists: record.artifactExists } : {}),
    disposition: stringEnum(record.disposition, ['first_execution', 'idempotent_reuse', 'manual_review'] as const),
    createdAt: isoString(record.createdAt),
    updatedAt: isoString(record.updatedAt),
    ...(record.completedAt !== undefined ? { completedAt: isoString(record.completedAt) } : {}),
    ...(record.error !== undefined ? { error: redactedShortText(record.error) } : {})
  }
}

function validateChildUsage(value: unknown): NonNullable<AgentRunChildRecord['usage']> {
  const record = strictRecord(value, ['providerCalls', 'promptTokens', 'completionTokens', 'totalTokens', 'toolCalls'])
  return {
    ...(record.providerCalls !== undefined ? { providerCalls: nonNegativeInteger(record.providerCalls) } : {}),
    ...(record.promptTokens !== undefined ? { promptTokens: nonNegativeInteger(record.promptTokens) } : {}),
    ...(record.completionTokens !== undefined ? { completionTokens: nonNegativeInteger(record.completionTokens) } : {}),
    ...(record.totalTokens !== undefined ? { totalTokens: nonNegativeInteger(record.totalTokens) } : {}),
    toolCalls: nonNegativeInteger(record.toolCalls)
  }
}

function validateUsage(value: unknown): AgentRunUsageAggregate {
  const record = strictRecord(value, [
    'providerCalls', 'toolCalls', 'toolErrors', 'iterations', 'childRuns', 'durationMs',
    'promptTokens', 'completionTokens', 'totalTokens', 'usageProvenance', 'operationAccounting',
    'resourceGovernance'
  ])
  return {
    providerCalls: nonNegativeInteger(record.providerCalls),
    toolCalls: nonNegativeInteger(record.toolCalls),
    toolErrors: nonNegativeInteger(record.toolErrors),
    iterations: nonNegativeInteger(record.iterations),
    childRuns: nonNegativeInteger(record.childRuns),
    durationMs: nonNegativeInteger(record.durationMs),
    ...(record.promptTokens !== undefined ? { promptTokens: nonNegativeInteger(record.promptTokens) } : {}),
    ...(record.completionTokens !== undefined ? { completionTokens: nonNegativeInteger(record.completionTokens) } : {}),
    ...(record.totalTokens !== undefined ? { totalTokens: nonNegativeInteger(record.totalTokens) } : {}),
    ...(record.usageProvenance !== undefined ? { usageProvenance: stringEnum(record.usageProvenance, ['provider_reported', 'local_estimate', 'unknown'] as const) } : {}),
    ...(record.operationAccounting !== undefined ? { operationAccounting: validateOperationAccounting(record.operationAccounting) } : {}),
    ...(record.resourceGovernance !== undefined ? { resourceGovernance: validateResourceGovernance(record.resourceGovernance) } : {})
  }
}

function validateOperationAccounting(value: unknown): NonNullable<AgentRunUsageAggregate['operationAccounting']> {
  const record = strictRecord(value, [
    'logicalRequests', 'providerTransportAttempts', 'transportRetries', 'overflowRecoveries',
    'compactionOperations', 'compactionSummaryAttempts', 'toolOperationAttempts'
  ])
  return {
    logicalRequests: safeNonNegativeInteger(record.logicalRequests),
    providerTransportAttempts: safeNonNegativeInteger(record.providerTransportAttempts),
    transportRetries: safeNonNegativeInteger(record.transportRetries),
    overflowRecoveries: safeNonNegativeInteger(record.overflowRecoveries),
    compactionOperations: safeNonNegativeInteger(record.compactionOperations),
    compactionSummaryAttempts: safeNonNegativeInteger(record.compactionSummaryAttempts),
    toolOperationAttempts: safeNonNegativeInteger(record.toolOperationAttempts)
  }
}

function validateResourceGovernance(value: unknown): NonNullable<AgentRunUsageAggregate['resourceGovernance']> {
  const record = strictRecord(value, ['configured', 'terminal'])
  if (!Array.isArray(record.configured) || record.configured.length > MAX_RESOURCE_METADATA_ITEMS) {
    throw new Error('Invalid resource governance configuration.')
  }
  return {
    configured: record.configured.map(validateResourceLimit),
    ...(record.terminal !== undefined ? { terminal: validateResourceBoundary(record.terminal) } : {})
  }
}

function validateResourceLimit(value: unknown): NonNullable<AgentRunUsageAggregate['resourceGovernance']>['configured'][number] {
  const record = strictRecord(value, ['layer', 'meter', 'limit', 'scope', 'auditId'])
  return {
    layer: stringEnum(record.layer, ['user_budget', 'deployment_policy', 'emergency_fuse'] as const),
    meter: stringEnum(record.meter, ['logical_requests', 'provider_transport_attempts', 'tool_operation_attempts', 'duration_ms', 'total_tokens'] as const),
    limit: positiveSafeInteger(record.limit),
    scope: stringEnum(record.scope, ['task', 'run', 'workspace', 'tenant', 'deployment'] as const),
    ...(record.auditId !== undefined ? { auditId: safeIdValue(record.auditId, 'auditId') } : {})
  }
}

function validateResourceBoundary(value: unknown): NonNullable<AgentRunUsageAggregate['resourceGovernance']>['terminal'] {
  const record = strictRecord(value, ['layer', 'meter', 'used', 'limit', 'scope', 'auditId', 'action'])
  return {
    layer: stringEnum(record.layer, ['user_budget', 'deployment_policy', 'emergency_fuse'] as const),
    meter: stringEnum(record.meter, ['logical_requests', 'provider_transport_attempts', 'tool_operation_attempts', 'duration_ms', 'total_tokens'] as const),
    used: safeNonNegativeInteger(record.used),
    limit: positiveSafeInteger(record.limit),
    scope: stringEnum(record.scope, ['task', 'run', 'workspace', 'tenant', 'deployment'] as const),
    ...(record.auditId !== undefined ? { auditId: safeIdValue(record.auditId, 'auditId') } : {}),
    action: stringEnum(record.action, ['resource_limit', 'suspended'] as const)
  }
}

async function atomicPrivateJson(
  path: string,
  value: unknown,
  replace: boolean,
  maxBytes?: number,
  options: AgentRunPersistenceOptions = {}
): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  if (maxBytes !== undefined && Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new Error('Agent state record exceeds its storage limit.')
  }
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  // Create-only protection is a pre-existence check plus the single-process serialize() queue
  // invariant used by AgentRunPersistence callers. Rename itself is not create-only: a
  // cross-process TOCTOU race remains a known limitation.
  if (!replace && await pathExists(path)) throw new Error('Agent state record already exists.')
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await chmod(temporary, 0o600)
    // Publish only fully flushed content. Same-directory rename is the atomic publish step;
    // temp open+fsync uses the same bounded Windows transient retry policy as rename.
    // Temporary files are always unlinked in finally, including after sync/rename exhaustion.
    await syncFileWithRetry(temporary, options)
    await renameAtomicallyWithRetry(temporary, path, options)
    await chmod(path, 0o600)
    await syncDirectory(directory, options.platform ?? process.platform)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function withWindowsTransientRetry(
  operation: () => Promise<void>,
  options: AgentRunPersistenceOptions,
  onFailure: (attempts: number, retryable: boolean, error: unknown) => never
): Promise<void> {
  const platform = options.platform ?? process.platform
  const retryDelaysMs = options.renameRetryDelaysMs ?? WINDOWS_TRANSIENT_FS_RETRY_DELAYS_MS
  const wait = options.wait ?? sleep
  let attempts = 0
  while (true) {
    attempts += 1
    try {
      await operation()
      return
    } catch (error) {
      const retryable = platform === 'win32' && WINDOWS_TRANSIENT_FS_RETRY_CODES.has(errnoCode(error) ?? '')
      const retryDelay = retryDelaysMs[attempts - 1]
      if (!retryable || retryDelay === undefined) {
        onFailure(attempts, retryable, error)
      }
      await wait(retryDelay)
    }
  }
}

async function renameAtomicallyWithRetry(
  sourcePath: string,
  destinationPath: string,
  options: AgentRunPersistenceOptions
): Promise<void> {
  const renameFile = options.rename ?? rename
  await withWindowsTransientRetry(
    () => renameFile(sourcePath, destinationPath),
    options,
    (attempts, retryable, error) => {
      throw new AgentRunAtomicRenameError(sourcePath, destinationPath, attempts, retryable, error)
    }
  )
}

async function syncFileWithRetry(
  path: string,
  options: AgentRunPersistenceOptions
): Promise<void> {
  const sync = options.syncFile ?? defaultSyncFile
  await withWindowsTransientRetry(
    () => sync(path),
    options,
    (attempts, retryable, error) => {
      throw new AgentRunAtomicSyncError(path, attempts, retryable, error)
    }
  )
}

async function defaultSyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directory: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') return
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs))
}

async function quarantine(
  path: string,
  now: string,
  options: AgentRunPersistenceOptions
): Promise<void> {
  const suffix = now.replace(/[^0-9]/g, '').slice(0, 17) || String(Date.now())
  await renameAtomicallyWithRetry(path, `${path}.corrupt-${suffix}`, options)
}

async function containedArtifactExists(storageRoot: string, pointer: string): Promise<boolean> {
  const root = resolve(storageRoot)
  const rootReal = await realpath(root)
  const target = resolve(root, safePointer(pointer))
  if (!inside(root, target)) throw new Error('Artifact pointer escapes storage root.')
  const existing = await nearestExisting(target)
  const existingReal = await realpath(existing)
  if (!inside(rootReal, existingReal)) throw new Error('Artifact pointer escapes storage root through a symlink.')
  return stat(target).then(() => true).catch((error) => {
    if (isNotFound(error)) return false
    throw error
  })
}

async function nearestExisting(path: string): Promise<string> {
  let current = resolve(path)
  while (true) {
    if (await lstat(current).then(() => true).catch(() => false)) return current
    const parent = dirname(current)
    if (parent === current) throw new Error('No existing parent for agent state path.')
    current = parent
  }
}

function strictRecord(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
  const record = value as Record<string, unknown>
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(record)) if (!allowedSet.has(key)) throw new Error(`Unknown field: ${key}`)
  return record
}

function safePointer(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!normalized || isAbsolute(normalized) || normalized.split('/').some((part) => part === '..' || part === '')) throw new Error('Unsafe persisted pointer.')
  return normalized
}

function safePointerValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Persisted pointer must be a string.')
  return safePointer(value)
}

function safeIdValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`)
  assertSafeId(value, label)
  return value
}

function optionalSafeId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : safeIdValue(value, label)
}

function stringEnum<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value === 'string' && values.includes(value)) return value as T[number]
  throw new Error('Invalid enum value.')
}

function isoString(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp.')
  return value
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error('Expected a non-negative integer.')
  return value
}

function safeNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Expected a non-negative safe integer.')
  return value
}

function positiveSafeInteger(value: unknown): number {
  const normalized = safeNonNegativeInteger(value)
  if (normalized <= 0) throw new Error('Expected a positive safe integer.')
  return normalized
}

function integerInRange(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Expected an integer between ${min} and ${max}.`)
  return value
}


function shortText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid short text.')
  return value
}

function limitedString(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error('String exceeds storage limit.')
  return value
}

function redactedShortText(value: unknown): string {
  return redactAgentSecretText(shortText(value))
}

function redactedLimitedString(value: unknown, maxBytes: number): string {
  return redactAgentSecretText(limitedString(value, maxBytes))
}

function hashValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid hash.')
  return value
}

function cleanDiagnostic(value: unknown): string {
  return redactAgentSecretText(value instanceof Error ? value.message : String(value)).slice(0, 1000)
}

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}