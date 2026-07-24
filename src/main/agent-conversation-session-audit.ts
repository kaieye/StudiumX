import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  agentConversationChildTranscriptDirectoryRelativePathForMarkdown,
  agentConversationSessionArtifactDirectoryRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../shared/agent-conversation-catalog'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'
import { sanitizePersistedAgentConversationRecord } from '../shared/agent-persisted-history'
import { normalizeTraceId } from '../shared/trace-context'
import { agentRunChildTranscriptRelativePath } from './ai/agent-run-persistence'
import {
  isPathInsideRoot,
  readContainedRegularFile,
  writeContentAddressedFile
} from './path-access'
import type {
  AgentArtifactRef,
  AgentChatTurn,
  AgentChatToolCallView,
  AgentConversationRecord,
  AgentTurnMetadata,
  AgentChildRunMetadata,
  AgentSourceMetadata,
  AgentCompactionMetadata,
  AgentContextHygieneMetadata,
  AgentToolResultDiagnostic,
  AgentRunUsageAggregate
} from '../shared/teaching-types'

export const AGENT_CONVERSATION_SESSION_AUDIT_VERSION = 1
const TOOL_RESULT_ARCHIVE_MIN_BYTES = 2048
const TOOL_RESULT_ARCHIVE_MIN_LINES = 40
const TOOL_RESULT_PREVIEW_LENGTH = 500
const MAX_TOOL_RESULT_DIAGNOSTICS = 20

export type AgentStagedChildTranscriptAllowance = {
  childRunId: string
  archive: AgentArtifactRef
}

type AgentChildRunWithArchive = AgentChildRunMetadata & {
  archive?: AgentArtifactRef
  /** Transient runtime-only content; stripped after durable archival. */
  transcript?: string
  /** Accepted during migration from early runtime producers. */
  transcriptText?: string
}

export type AgentConversationSessionAuditHeader = {
  type: 'session'
  version: 1
  id: string
  workspaceId?: string
  title: string
  createdAt: string
  conversationRelativePath: string
  traceId?: string
}

export type AgentConversationSessionAuditEntryBase = {
  type: string
  id: string
  parentId: string | null
  timestamp: string
  turnId?: string
  traceId?: string
}

export type AgentConversationSessionTurnEntry = AgentConversationSessionAuditEntryBase & {
  type: 'turn'
  turnId: string
  role: AgentChatTurn['role']
  contentPreview: string
  contentBytes: number
  toolCallCount: number
  processEventCount: number
  metadataVersion?: number
}

export type AgentConversationSessionToolCallEntry = AgentConversationSessionAuditEntryBase & {
  type: 'tool_call'
  turnId: string
  toolCallId: string
  toolName: string
  argumentsPreview: string
  resultBytes?: number
  resultLines?: number
  isError?: boolean
}

export type AgentConversationSessionSourceEntry = AgentConversationSessionAuditEntryBase & {
  type: 'source'
  turnId: string
  source: AgentSourceMetadata
}

export type AgentConversationSessionChildRunEntry = AgentConversationSessionAuditEntryBase & {
  type: 'child_run'
  turnId: string
  childRun: AgentChildRunMetadata
}

export type AgentConversationSessionCompactionEntry = AgentConversationSessionAuditEntryBase & {
  type: 'compaction'
  turnId: string
  compaction: AgentCompactionMetadata
}

export type AgentConversationSessionContextHygieneEntry = AgentConversationSessionAuditEntryBase & {
  type: 'context_hygiene'
  turnId: string
  contextHygiene: AgentContextHygieneMetadata
}

export type AgentConversationSessionContextEstimateEntry = AgentConversationSessionAuditEntryBase & {
  type: 'context_estimate'
  turnId: string
  contextEstimate: NonNullable<AgentTurnMetadata['contextEstimate']>
}

export type AgentConversationSessionToolResultDiagnosticEntry = AgentConversationSessionAuditEntryBase & {
  type: 'tool_result_diagnostic'
  turnId: string
  diagnostic: AgentToolResultDiagnostic
}

export type AgentConversationSessionRunUsageEntry = AgentConversationSessionAuditEntryBase & {
  type: 'run_usage'
  turnId: string
  usage: AgentRunUsageAggregate
}

export type AgentConversationSessionAuditEntry =
  | AgentConversationSessionTurnEntry
  | AgentConversationSessionToolCallEntry
  | AgentConversationSessionSourceEntry
  | AgentConversationSessionChildRunEntry
  | AgentConversationSessionCompactionEntry
  | AgentConversationSessionContextHygieneEntry
  | AgentConversationSessionContextEstimateEntry
  | AgentConversationSessionToolResultDiagnosticEntry
  | AgentConversationSessionRunUsageEntry

export type AgentConversationSessionAuditLine =
  | AgentConversationSessionAuditHeader
  | AgentConversationSessionAuditEntry

export async function archiveAgentConversationArtifacts(input: {
  rootPath: string
  record: AgentConversationRecord
  now?: string
  allowedStagedChildTranscripts?: readonly AgentStagedChildTranscriptAllowance[]
}): Promise<AgentConversationRecord> {
  const record = sanitizePersistedAgentConversationRecord(input.record)
  let changed = record !== input.record
  const now = input.now ?? new Date().toISOString()
  const turns: AgentChatTurn[] = []
  for (const turn of record.turns) {
    let nextTurn = redactAgentTurnPersistenceText(turn)
    if (nextTurn !== turn) changed = true
    const toolCalls: AgentChatToolCallView[] = []
    let toolCallsChanged = false
    for (const tool of nextTurn.toolCalls ?? []) {
      if (!shouldArchiveToolResult(tool.result)) {
        toolCalls.push(tool)
        continue
      }
      const result = tool.result ?? ''
      const artifact = await writeToolResultArtifact({
        rootPath: input.rootPath,
        conversationRelativePath: record.relativePath,
        turnId: turn.id,
        toolCallId: tool.id,
        toolName: tool.name,
        result,
        now
      })
      toolCalls.push({
        ...tool,
        result: archivedToolResultPlaceholder(artifact)
      })
      nextTurn = withToolResultArchiveMetadata(nextTurn, tool, artifact)
      toolCallsChanged = true
      changed = true
    }
    if (toolCallsChanged) {
      nextTurn = { ...nextTurn, toolCalls }
    }

    const childTranscriptResult = await archiveChildRunTranscripts({
      rootPath: input.rootPath,
      conversationRelativePath: record.relativePath,
      turn: nextTurn,
      now,
      allowedStagedChildTranscripts: input.allowedStagedChildTranscripts
    })
    if (childTranscriptResult.changed) {
      nextTurn = childTranscriptResult.turn
      changed = true
    }
    turns.push(nextTurn)
  }
  // Promotion replaces inline values with durable placeholders/references. Rebind
  // parent-turn proofs only after those substitutions so the proof covers the
  // exact canonical record that will be serialized, without self-recursion.
  return sanitizePersistedAgentConversationRecord(changed ? { ...record, turns } : record)
}

async function archiveChildRunTranscripts(input: {
  rootPath: string
  conversationRelativePath: string
  turn: AgentChatTurn
  now: string
  allowedStagedChildTranscripts?: readonly AgentStagedChildTranscriptAllowance[]
}): Promise<{ turn: AgentChatTurn; changed: boolean }> {
  const childRuns = input.turn.metadata?.childRuns
  if (!childRuns?.length) return { turn: input.turn, changed: false }

  let changed = false
  const persistedChildRuns: AgentChildRunWithArchive[] = []
  for (const childRun of childRuns) {
    const child = childRun as AgentChildRunWithArchive
    const transientTranscript = childTranscriptText(child)
    const existingArchive = childTranscriptArchive(child)
    const stagedTranscript = existingArchive
      ? await readStagedChildTranscript(
          input.rootPath,
          child.childRunId,
          existingArchive,
          input.allowedStagedChildTranscripts
        )
      : null
    const transcript = transientTranscript ?? stagedTranscript
    if (transcript === null) {
      persistedChildRuns.push(child)
      continue
    }

    const materializedArtifact = await writeChildTranscriptArtifact({
      rootPath: input.rootPath,
      conversationRelativePath: input.conversationRelativePath,
      childRunId: child.childRunId,
      transcript,
      now: input.now
    })
    const artifact = existingArchive && existingArchive.sha256 === materializedArtifact.sha256 &&
      existingArchive.bytes === materializedArtifact.bytes &&
      existingArchive.lines === materializedArtifact.lines &&
      existingArchive.relativePath === materializedArtifact.relativePath
      ? existingArchive
      : materializedArtifact
    persistedChildRuns.push(withChildTranscriptArchive(child, artifact))
    changed = true
  }

  if (!changed) return { turn: input.turn, changed: false }
  return {
    changed: true,
    turn: {
      ...input.turn,
      metadata: {
        ...input.turn.metadata,
        version: 1,
        childRuns: persistedChildRuns
      }
    }
  }
}

export async function hydrateAgentConversationArtifacts(input: {
  rootPath: string
  record: AgentConversationRecord
}): Promise<AgentConversationRecord> {
  let changed = false
  const turns = await Promise.all(input.record.turns.map(async (turn) => {
    if (!turn.toolCalls?.length || !turn.metadata?.toolResults?.length) return turn
    const artifactByTool = new Map<string, AgentArtifactRef>()
    for (const diagnostic of turn.metadata.toolResults) {
      if (diagnostic.archive?.kind === 'tool_result') {
        artifactByTool.set(`${diagnostic.toolCallId}:${diagnostic.toolName}`, diagnostic.archive)
      }
    }
    if (artifactByTool.size === 0) return turn
    const toolCalls = await Promise.all(turn.toolCalls.map(async (tool) => {
      const artifact = artifactByTool.get(`${tool.id}:${tool.name}`)
      if (!artifact) return tool
      const content = await readArtifactContent(input.rootPath, artifact, {
        conversationRelativePath: input.record.relativePath,
        expectedKind: 'tool_result'
      })
      if (content === null) return tool
      changed = true
      return { ...tool, result: content }
    }))
    return { ...turn, toolCalls }
  }))
  return changed ? { ...input.record, turns } : input.record
}

/**
 * Reads a child transcript only after checking that its stored artifact belongs
 * to the requested conversation's child-transcript directory and still matches
 * the recorded digest. This is deliberately not a general artifact-path API.
 */
export async function readAgentConversationChildTranscriptArtifact(input: {
  rootPath: string
  conversationRelativePath: string
  artifact: AgentArtifactRef
}): Promise<string> {
  const content = await readArtifactContent(input.rootPath, input.artifact, {
    conversationRelativePath: input.conversationRelativePath,
    expectedKind: 'child_transcript'
  })
  if (content === null) throw new Error('Child transcript artifact is unavailable or failed integrity validation.')
  return content
}

type AgentConversationSessionAuditStat = {
  size: number
  isFile: () => boolean
}

type AgentConversationSessionAuditFileHandle = {
  read: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ) => Promise<{ bytesRead: number }>
  write: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ) => Promise<{ bytesWritten: number }>
  stat: () => Promise<AgentConversationSessionAuditStat>
  sync: () => Promise<void>
  close: () => Promise<void>
}

/** Narrow main-internal seam for the session-audit durable append boundary. */
export type AgentConversationSessionAuditOperations = {
  mkdir: typeof mkdir
  lstat: typeof lstat
  open: (path: string, flags: string | number, mode?: number) => Promise<AgentConversationSessionAuditFileHandle>
}

type ParsedAuditRecord = {
  record: Record<string, unknown>
  nonTraceJson: string
  traceState: string
}

type ObservedAuditIdentity = {
  nonTraceJson: string
  traceState: string
}

const DEFAULT_AGENT_CONVERSATION_SESSION_AUDIT_OPERATIONS: AgentConversationSessionAuditOperations = {
  mkdir,
  lstat,
  open
}
const agentConversationSessionAuditQueues = new Map<string, Promise<void>>()
// Numeric flags preserve `a+` semantics while adding O_NOFOLLOW, so the
// descriptor creation itself rejects a symlink that appears after lstat.
const AGENT_CONVERSATION_SESSION_AUDIT_OPEN_FLAGS =
  fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW
const DIRECTORY_FSYNC_DOWNGRADE_CODES = new Set(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])
const DIRECTORY_FSYNC_DOWNGRADE_WARNING =
  '[StudiumX] Directory fsync is unsupported; durable audit append completed without directory fsync.'

/**
 * Appends missing canonical session-audit rows without ever rewriting prior
 * bytes. The per-target queue is deliberately process-local: it closes races
 * between concurrent saves in this process without claiming cross-process
 * locking semantics.
 */
export function appendAgentConversationSessionAuditLog(input: {
  rootPath: string
  record: AgentConversationRecord
  operations?: AgentConversationSessionAuditOperations
  warn?: (message: string) => void
}): Promise<string> {
  const record = sanitizePersistedAgentConversationRecord(input.record)
  // Audit trace metadata is correlation-only. Normalize once at this durable
  // append boundary so every newly written line for this save shares the same
  // safe value, while invalid input is omitted rather than persisted.
  const traceId = normalizeTraceId(record.traceId)
  const relativePath = agentConversationSessionAuditRelativePathForMarkdown(record.relativePath)
  const absolutePath = resolve(input.rootPath, relativePath)
  const operations = input.operations ?? DEFAULT_AGENT_CONVERSATION_SESSION_AUDIT_OPERATIONS

  return enqueueAgentConversationSessionAudit(absolutePath, async () => {
    await appendAgentConversationSessionAuditLogUnserialized({
      absolutePath,
      record,
      traceId,
      operations,
      useNativeFilesystem: !input.operations,
      warn: input.warn
    })
  }).then(() => relativePath)
}

async function appendAgentConversationSessionAuditLogUnserialized(input: {
  absolutePath: string
  record: AgentConversationRecord
  traceId: string | undefined
  operations: AgentConversationSessionAuditOperations
  /** True only for the unwrapped Node filesystem implementation. */
  useNativeFilesystem: boolean
  warn?: (message: string) => void
}): Promise<void> {
  const auditDirectory = dirname(input.absolutePath)
  const conversationParentDirectory = dirname(auditDirectory)
  await input.operations.mkdir(auditDirectory, { recursive: true })

  const targetInfo = await input.operations.lstat(input.absolutePath).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  })
  if (targetInfo && !targetInfo.isFile()) {
    throw new Error('Conversation session audit target is not a regular file.')
  }

  // These flags are `a+` plus O_NOFOLLOW: append/read/create semantics remain
  // intact, while descriptor creation itself rejects a TOCTOU symlink. The
  // create mode remains the normal 0666 subject to umask; existing modes stay
  // untouched.
  const file = await input.operations.open(
    input.absolutePath,
    AGENT_CONVERSATION_SESSION_AUDIT_OPEN_FLAGS,
    0o666
  )
  let raw: Buffer
  let nextLines: AgentConversationSessionAuditLine[]
  try {
    const openedInfo = await file.stat()
    if (!openedInfo.isFile()) throw new Error('Conversation session audit target is not a regular file.')
    raw = await readExactAuditBytes(file, openedInfo.size)
    nextLines = missingAgentConversationSessionAuditLines(input.record, input.traceId, raw)
    if (nextLines.length > 0) {
      await writeAllAuditBytes(file, framedAuditAppend(raw, nextLines))
    }
    // Retried no-op appends still confirm file durability before directory
    // durability, so a prior post-write directory failure can heal on retry.
    await file.sync()
  } finally {
    // A close failure is never downgraded: success cannot be reported while
    // descriptor release itself is uncertain.
    await file.close()
  }

  await syncAgentConversationSessionAuditDirectory(auditDirectory, input.operations, input.useNativeFilesystem, input.warn)
  await syncAgentConversationSessionAuditDirectory(conversationParentDirectory, input.operations, input.useNativeFilesystem, input.warn)
}

function enqueueAgentConversationSessionAudit(path: string, task: () => Promise<void>): Promise<void> {
  const previous = agentConversationSessionAuditQueues.get(path) ?? Promise.resolve()
  const queued = previous.catch(() => undefined).then(task)
  agentConversationSessionAuditQueues.set(path, queued)
  return queued.finally(() => {
    if (agentConversationSessionAuditQueues.get(path) === queued) {
      agentConversationSessionAuditQueues.delete(path)
    }
  })
}

async function readExactAuditBytes(
  file: AgentConversationSessionAuditFileHandle,
  size: number
): Promise<Buffer> {
  const bytes = Buffer.alloc(size)
  let offset = 0
  while (offset < bytes.length) {
    const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
    if (!Number.isInteger(bytesRead) || bytesRead <= 0) {
      throw new Error('Conversation session audit could not be read exactly.')
    }
    offset += bytesRead
  }
  return bytes
}

async function writeAllAuditBytes(
  file: AgentConversationSessionAuditFileHandle,
  bytes: Buffer
): Promise<void> {
  let offset = 0
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, null)
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error('Conversation session audit could not be written completely.')
    }
    offset += bytesWritten
  }
}

function framedAuditAppend(raw: Buffer, lines: readonly AgentConversationSessionAuditLine[]): Buffer {
  const canonicalRows = lines.map((line) => JSON.stringify(line)).join('\n')
  const prefix = raw.length > 0 && raw[raw.length - 1] !== 0x0a ? '\n' : ''
  return Buffer.from(`${prefix}${canonicalRows}\n`, 'utf8')
}

function missingAgentConversationSessionAuditLines(
  record: AgentConversationRecord,
  traceId: string | undefined,
  raw: Buffer
): AgentConversationSessionAuditLine[] {
  const header = agentConversationSessionAuditHeader(record, traceId)
  const entries = buildAgentConversationSessionAuditEntriesWithTrace(record, traceId)
  const expectedEntries = new Map(entries.map((entry) => [entry.id, entry]))
  const observed = new Map<string, ObservedAuditIdentity>()
  let hasHeader = false

  for (const parsed of parseAuditRecords(raw)) {
    if (typeof parsed.record.type !== 'string' || typeof parsed.record.id !== 'string') continue
    if (parsed.record.type === 'session') {
      if (parsed.record.id === header.id) {
        // Conversation titles can legitimately change after the initial
        // append. The audit header retains its first title, while its stable
        // identity remains bound to the conversation placement and creation.
        observeCanonicalAuditIdentity(
          observed,
          `session:${header.id}`,
          withStableSessionHeaderIdentity(parsed),
          canonicalSessionHeaderIdentityJsons(header)
        )
        hasHeader = true
        continue
      }
      // Entry identity is its id, so a session-shaped record reusing an
      // expected entry id is a type conflict rather than a missing row.
      if (expectedEntries.has(parsed.record.id)) {
        throw new Error('Conversation session audit conflicts with its canonical record.')
      }
      continue
    }
    const expected = expectedEntries.get(parsed.record.id)
    if (!expected) continue
    observeCanonicalAuditIdentity(
      observed,
      `entry:${expected.id}`,
      parsed,
      canonicalNonTraceAuditJsons(expected, false)
    )
  }

  const missing: AgentConversationSessionAuditLine[] = []
  if (!hasHeader) missing.push(header)
  for (const entry of entries) {
    if (!observed.has(`entry:${entry.id}`)) missing.push(entry)
  }
  return missing
}

function parseAuditRecords(raw: Buffer): ParsedAuditRecord[] {
  const records: ParsedAuditRecord[] = []
  let start = 0
  for (let index = 0; index <= raw.length; index += 1) {
    if (index !== raw.length && raw[index] !== 0x0a) continue
    const line = raw.subarray(start, index)
    const text = line.toString('utf8')
    start = index + 1
    // Do not allow a replacement-character decode of a partial/corrupt UTF-8
    // tail to claim an identity. Such bytes remain an untouched prefix only.
    if (!Buffer.from(text, 'utf8').equals(line) || !text.trim()) continue
    const value = safeParseJson(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    records.push({
      record,
      nonTraceJson: JSON.stringify(withoutAuditTrace(record)),
      traceState: auditTraceState(record)
    })
  }
  return records
}

function observeCanonicalAuditIdentity(
  observed: Map<string, ObservedAuditIdentity>,
  identity: string,
  parsed: ParsedAuditRecord,
  acceptedNonTraceJsons: readonly string[]
): void {
  if (!acceptedNonTraceJsons.includes(parsed.nonTraceJson)) {
    throw new Error('Conversation session audit conflicts with its canonical record.')
  }
  const previous = observed.get(identity)
  if (previous && (
    previous.nonTraceJson !== parsed.nonTraceJson ||
    previous.traceState !== parsed.traceState
  )) {
    throw new Error('Conversation session audit contains divergent duplicate records.')
  }
  observed.set(identity, { nonTraceJson: parsed.nonTraceJson, traceState: parsed.traceState })
}

function withStableSessionHeaderIdentity(parsed: ParsedAuditRecord): ParsedAuditRecord {
  return { ...parsed, nonTraceJson: stableSessionHeaderIdentityJson(parsed.record) }
}

function canonicalSessionHeaderIdentityJsons(header: AgentConversationSessionAuditHeader): string[] {
  const canonical = stableSessionHeaderIdentityJson(header as unknown as Record<string, unknown>)
  const jsons = [canonical]
  // The first session-audit writer predated workspace identity in the header.
  if (Object.prototype.hasOwnProperty.call(header, 'workspaceId')) {
    const { workspaceId: _workspaceId, ...legacy } = withoutAuditTrace(header as unknown as Record<string, unknown>)
    delete legacy.title
    jsons.push(JSON.stringify(legacy))
  }
  return jsons
}

function stableSessionHeaderIdentityJson(record: Record<string, unknown>): string {
  const stable = withoutAuditTrace(record)
  delete stable.title
  return JSON.stringify(stable)
}

function canonicalNonTraceAuditJsons(
  line: AgentConversationSessionAuditLine,
  allowLegacySessionHeader: boolean
): string[] {
  const canonical = withoutAuditTrace(line as unknown as Record<string, unknown>)
  const jsons = [JSON.stringify(canonical)]
  // The first session-audit writer predated workspace identity in the header.
  // Retain that one legacy canonical shape without permitting arbitrary missing
  // or extra fields in any current record.
  if (allowLegacySessionHeader && Object.prototype.hasOwnProperty.call(canonical, 'workspaceId')) {
    const { workspaceId: _workspaceId, ...legacy } = canonical
    jsons.push(JSON.stringify(legacy))
  }
  // Older audit rows were emitted before a branch/session write consistently
  // carried metadataVersion on pre-existing turns. That version is derived
  // metadata, not the turn's durable identity, so accept the legacy omission
  // while continuing to reject every other shape change.
  if (canonical.type === 'turn' && Object.prototype.hasOwnProperty.call(canonical, 'metadataVersion')) {
    const { metadataVersion: _metadataVersion, ...legacy } = canonical
    jsons.push(JSON.stringify(legacy))
  }
  return jsons
}

function withoutAuditTrace(record: Record<string, unknown>): Record<string, unknown> {
  const { traceId: _traceId, ...withoutTrace } = record
  return withoutTrace
}

function auditTraceState(record: Record<string, unknown>): string {
  if (!Object.prototype.hasOwnProperty.call(record, 'traceId')) return 'absent'
  return `present:${JSON.stringify(record.traceId)}`
}

async function syncAgentConversationSessionAuditDirectory(
  directoryPath: string,
  operations: AgentConversationSessionAuditOperations,
  useNativeFilesystem: boolean,
  warn: ((message: string) => void) | undefined
): Promise<void> {
  // Node on Windows cannot fsync a directory handle (it reports EPERM). This
  // is a platform capability gap, not a permission failure in the audit file.
  // Keep injected operation seams strict so their synthetic EPERM/EIO errors
  // continue to exercise the fail-closed contract.
  if (useNativeFilesystem && process.platform === 'win32') {
    (warn ?? console.warn)(DIRECTORY_FSYNC_DOWNGRADE_WARNING)
    return
  }

  let directory: AgentConversationSessionAuditFileHandle | undefined
  let downgraded = false
  try {
    directory = await operations.open(directoryPath, 'r')
    try {
      await directory.sync()
    } catch (error) {
      if (!isDirectoryFsyncDowngrade(error)) throw error
      downgraded = true
    }
  } catch (error) {
    if (!directory && isDirectoryFsyncDowngrade(error)) {
      downgraded = true
    } else {
      throw error
    }
  } finally {
    if (directory) await directory.close()
  }
  if (downgraded) (warn ?? console.warn)(DIRECTORY_FSYNC_DOWNGRADE_WARNING)
}

function isDirectoryFsyncDowngrade(error: unknown): boolean {
  return DIRECTORY_FSYNC_DOWNGRADE_CODES.has(errorCode(error) ?? '')
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

export function buildAgentConversationSessionAuditEntries(
  record: AgentConversationRecord
): AgentConversationSessionAuditEntry[] {
  return buildAgentConversationSessionAuditEntriesWithTrace(record, normalizeTraceId(record.traceId))
}

function buildAgentConversationSessionAuditEntriesWithTrace(
  record: AgentConversationRecord,
  traceId: string | undefined
): AgentConversationSessionAuditEntry[] {
  record = sanitizePersistedAgentConversationRecord(record)
  // This public builder is also used independently of the archive write path.
  // Apply the same derived-text redaction before forming JSONL previews.
  record = redactAgentConversationPersistenceText(record)
  const entries: AgentConversationSessionAuditEntry[] = []
  let previousTurnEntryId: string | null = null
  for (const turn of record.turns) {
    const turnEntryId = auditEntryId('turn', turn.id)
    entries.push({
      type: 'turn',
      traceId,
      id: turnEntryId,
      parentId: previousTurnEntryId,
      timestamp: timestampValue(turn.createdAt, record.updatedAt),
      turnId: turn.id,
      role: turn.role,
      contentPreview: compactText(turn.content, 320),
      contentBytes: byteLength(turn.content),
      toolCallCount: turn.toolCalls?.length ?? 0,
      processEventCount: turn.processEvents?.length ?? 0,
      metadataVersion: turn.metadata?.version
    })
    for (const tool of turn.toolCalls ?? []) {
      const result = tool.result
      entries.push(pruneUndefined({
        type: 'tool_call' as const,
        traceId,
        id: auditEntryId('tool', turn.id, tool.id),
        parentId: turnEntryId,
        timestamp: timestampValue(turn.createdAt, record.updatedAt),
        turnId: turn.id,
        toolCallId: tool.id,
        toolName: tool.name || 'tool',
        argumentsPreview: compactText(tool.arguments, 320),
        resultBytes: result === undefined ? undefined : byteLength(result),
        resultLines: result === undefined ? undefined : lineCount(result),
        isError: tool.isError === true ? true : undefined
      }))
    }
    appendMetadataEntries(entries, turnEntryId, turn, record.updatedAt, traceId)
    previousTurnEntryId = turnEntryId
  }
  return entries
}

export function parseAgentConversationSessionAuditLines(text: string): AgentConversationSessionAuditLine[] {
  const lines: AgentConversationSessionAuditLine[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parsed = safeParseJson(line)
    if (!parsed || typeof parsed !== 'object') continue
    const record = parsed as Record<string, unknown>
    if (record.type === 'session' && typeof record.id === 'string') {
      lines.push(record as AgentConversationSessionAuditHeader)
      continue
    }
    if (typeof record.type === 'string' && typeof record.id === 'string') {
      lines.push(record as AgentConversationSessionAuditEntry)
    }
  }
  return lines
}

function appendMetadataEntries(
  entries: AgentConversationSessionAuditEntry[],
  turnEntryId: string,
  turn: AgentChatTurn,
  fallbackTimestamp: string,
  traceId: string | undefined
): void {
  const timestamp = timestampValue(turn.createdAt, fallbackTimestamp)
  const metadata = turn.metadata
  if (!metadata) return
  for (const source of metadata.sources ?? []) {
    const redactedSource = redactSourceMetadata(source)
    entries.push({
      type: 'source',
      traceId,
      id: auditEntryId('source', turn.id, redactedSource.sourceId || hashText(redactedSource.url)),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      source: redactedSource
    })
  }
  for (const childRun of metadata.childRuns ?? []) {
    const redactedChildRun = childRunForAudit(childRun as AgentChildRunWithArchive)
    entries.push({
      type: 'child_run',
      traceId,
      id: auditEntryId('child', turn.id, redactedChildRun.childRunId),
      parentId: turnEntryId,
      timestamp: timestampValue(redactedChildRun.completedAt ?? redactedChildRun.startedAt, timestamp),
      turnId: turn.id,
      childRun: redactedChildRun
    })
  }
  metadata.compactions?.forEach((compaction) => {
    entries.push({
      type: 'compaction',
      traceId,
      id: auditEntryId('compaction', turn.id, compaction.id || compaction.sourceDigest),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      compaction: redactCompactionMetadata(compaction)
    })
  })
  metadata.contextHygiene?.forEach((contextHygiene, index) => {
    entries.push({
      type: 'context_hygiene',
      traceId,
      id: auditEntryId('hygiene', turn.id, String(index), hashText(JSON.stringify(contextHygiene))),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      contextHygiene
    })
  })
  if (metadata.contextEstimate) {
    entries.push({
      type: 'context_estimate',
      traceId,
      id: auditEntryId('context-estimate', turn.id, hashText(JSON.stringify(metadata.contextEstimate))),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      contextEstimate: metadata.contextEstimate
    })
  }
  if (metadata.runUsage) {
    entries.push({
      type: 'run_usage',
      traceId,
      id: auditEntryId('run-usage', turn.id, hashText(JSON.stringify(metadata.runUsage))),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      usage: metadata.runUsage
    })
  }
  for (const diagnostic of metadata.toolResults ?? []) {
    entries.push({
      type: 'tool_result_diagnostic',
      traceId,
      id: auditEntryId('tool-result', turn.id, diagnostic.toolCallId, diagnostic.toolName),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      diagnostic: redactToolResultDiagnostic(diagnostic)
    })
  }
}

function agentConversationSessionAuditHeader(
  record: AgentConversationRecord,
  traceId: string | undefined
): AgentConversationSessionAuditHeader {
  record = sanitizePersistedAgentConversationRecord(record)
  return pruneUndefined({
    type: 'session' as const,
    version: AGENT_CONVERSATION_SESSION_AUDIT_VERSION,
    id: record.id,
    workspaceId: record.workspaceId,
    title: redactAgentSecretText(record.title),
    createdAt: record.createdAt,
    conversationRelativePath: record.relativePath,
    traceId
  })
}

async function writeToolResultArtifact(input: {
  rootPath: string
  conversationRelativePath: string
  turnId: string
  toolCallId: string
  toolName: string
  result: string
  now: string
}): Promise<AgentArtifactRef> {
  const result = redactAgentSecretText(input.result)
  const sha256 = createHash('sha256').update(result).digest('hex')
  const baseDir = agentConversationSessionArtifactDirectoryRelativePathForMarkdown(input.conversationRelativePath)
  const fileName = `${safePathPart(input.turnId)}-${safePathPart(input.toolCallId)}-${sha256.slice(0, 16)}.txt`
  const relativePath = join(baseDir, 'tool-results', fileName).replace(/\\/g, '/')
  const absolutePath = join(input.rootPath, relativePath)
  if (!isPathInsideRoot(input.rootPath, absolutePath)) {
    throw new Error('Tool result artifact path is outside the workspace.')
  }
  await writeArtifactIfNeeded(input.rootPath, absolutePath, result, sha256)
  return {
    kind: 'tool_result',
    relativePath,
    sha256,
    bytes: byteLength(result),
    lines: lineCount(result),
    preview: compactText(result, TOOL_RESULT_PREVIEW_LENGTH),
    archivedAt: input.now
  }
}

async function writeChildTranscriptArtifact(input: {
  rootPath: string
  conversationRelativePath: string
  childRunId: string
  transcript: string
  now: string
}): Promise<AgentArtifactRef> {
  const transcript = redactAgentSecretText(input.transcript)
  const sha256 = createHash('sha256').update(transcript).digest('hex')
  const childKey = createHash('sha256').update(input.childRunId).digest('hex').slice(0, 16)
  const directoryRelativePath = agentConversationChildTranscriptDirectoryRelativePathForMarkdown(input.conversationRelativePath)
  const relativePath = join(directoryRelativePath, `${childKey}-${sha256.slice(0, 16)}.txt`).replace(/\\/g, '/')
  const absolutePath = join(input.rootPath, relativePath)
  if (!isPathInsideRoot(input.rootPath, absolutePath)) {
    throw new Error('Child transcript artifact path is outside the workspace.')
  }
  await writeArtifactIfNeeded(input.rootPath, absolutePath, transcript, sha256)
  return {
    kind: 'child_transcript',
    relativePath,
    sha256,
    bytes: byteLength(transcript),
    lines: lineCount(transcript),
    archivedAt: input.now
  }
}

async function writeArtifactIfNeeded(
  rootPath: string,
  absolutePath: string,
  content: string,
  sha256: string
): Promise<void> {
  await writeContentAddressedFile({ rootPath, targetPath: absolutePath, content, sha256 })
}

async function readArtifactContent(
  rootPath: string,
  artifact: AgentArtifactRef,
  options: { conversationRelativePath?: string; expectedKind?: AgentArtifactRef['kind'] } = {}
): Promise<string | null> {
  if (options.expectedKind && artifact.kind !== options.expectedKind) return null
  if (artifact.kind !== 'tool_result' && artifact.kind !== 'child_transcript') return null
  const normalizedRelativePath = artifact.relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedRelativePath || normalizedRelativePath !== artifact.relativePath.replace(/\\/g, '/') ||
    normalizedRelativePath.split('/').some((part) => part === '.' || part === '..')) return null
  if (options.conversationRelativePath) {
    const artifactDirectory = agentConversationSessionArtifactDirectoryRelativePathForMarkdown(options.conversationRelativePath)
    const directory = artifact.kind === 'child_transcript'
      ? agentConversationChildTranscriptDirectoryRelativePathForMarkdown(options.conversationRelativePath)
      : join(artifactDirectory, 'tool-results').replace(/\\/g, '/')
    if (!normalizedRelativePath.startsWith(`${directory}/`)) return null
  }
  const absolutePath = join(rootPath, normalizedRelativePath)
  if (!isPathInsideRoot(rootPath, absolutePath)) return null
  const bytes = await readContainedRegularFile(rootPath, absolutePath).catch(() => null)
  if (bytes === null || bytes.byteLength !== artifact.bytes) return null
  const content = bytes.toString('utf8')
  if (artifact.lines !== undefined && lineCount(content) !== artifact.lines) return null
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return sha256 === artifact.sha256 ? content : null
}

function shouldArchiveToolResult(result: string | undefined): boolean {
  if (!result || isArchivedToolResultPlaceholder(result)) return false
  return byteLength(result) >= TOOL_RESULT_ARCHIVE_MIN_BYTES ||
    lineCount(result) >= TOOL_RESULT_ARCHIVE_MIN_LINES
}

function archivedToolResultPlaceholder(artifact: AgentArtifactRef): string {
  return [
    '[tool result archived]',
    `path: ${artifact.relativePath}`,
    `sha256: ${artifact.sha256}`,
    `bytes: ${artifact.bytes}`,
    artifact.lines !== undefined ? `lines: ${artifact.lines}` : '',
    '',
    artifact.preview ? `preview: ${redactAgentSecretText(artifact.preview)}` : ''
  ].filter(Boolean).join('\n')
}

function isArchivedToolResultPlaceholder(value: string): boolean {
  return value.startsWith('[tool result archived]\n')
}

async function readStagedChildTranscript(
  rootPath: string,
  childRunId: string,
  artifact: AgentArtifactRef,
  allowances: readonly AgentStagedChildTranscriptAllowance[] | undefined
): Promise<string | null> {
  const prefix = '.agent-sessions/child-transcripts/'
  const normalizedRelativePath = artifact.relativePath.replace(/\\/g, '/')
  if (!normalizedRelativePath.startsWith(prefix)) return null
  const allowed = allowances?.some((allowance) =>
    allowance.childRunId === childRunId && artifactRefsEqual(allowance.archive, artifact)
  )
  if (!allowed) throw new Error('Staged child transcript artifact is not authorized for this conversation save.')
  const parts = normalizedRelativePath.split('/')
  if (parts.length !== 4 || parts[0] !== '.agent-sessions' || parts[1] !== 'child-transcripts') {
    throw new Error('Invalid staged child transcript artifact path.')
  }
  let expectedRelativePath: string
  try {
    expectedRelativePath = agentRunChildTranscriptRelativePath(parts[2], childRunId, artifact.sha256)
  } catch {
    throw new Error('Invalid staged child transcript artifact path.')
  }
  if (artifact.kind !== 'child_transcript' || normalizedRelativePath !== expectedRelativePath ||
    artifact.relativePath !== normalizedRelativePath) {
    throw new Error('Invalid staged child transcript artifact path.')
  }
  const content = await readArtifactContent(rootPath, artifact)
  if (content === null) throw new Error('Staged child transcript artifact failed integrity validation.')
  return content
}

function redactAgentConversationPersistenceText(record: AgentConversationRecord): AgentConversationRecord {
  const turns = record.turns.map(redactAgentTurnPersistenceText)
  return turns.some((turn, index) => turn !== record.turns[index]) ? { ...record, turns } : record
}

function redactAgentTurnPersistenceText(turn: AgentChatTurn): AgentChatTurn {
  const content = redactAgentSecretText(turn.content)
  const toolCalls = turn.toolCalls?.map(redactToolCall)
  const processEvents = turn.processEvents?.map((event) => {
    const title = redactAgentSecretText(event.title)
    const detail = event.detail === undefined ? undefined : redactAgentSecretText(event.detail)
    return title === event.title && detail === event.detail ? event : {
      ...event,
      title,
      ...(detail === undefined ? {} : { detail })
    }
  })
  const metadata = redactTurnMetadata(turn.metadata)
  const toolCallsChanged = Boolean(toolCalls?.some((tool, index) => tool !== turn.toolCalls?.[index]))
  const processEventsChanged = Boolean(processEvents?.some((event, index) => event !== turn.processEvents?.[index]))
  if (content === turn.content && !toolCallsChanged && !processEventsChanged && metadata === turn.metadata) return turn
  return {
    ...turn,
    content,
    ...(toolCalls === undefined ? {} : { toolCalls }),
    ...(processEvents === undefined ? {} : { processEvents }),
    ...(metadata === undefined ? {} : { metadata })
  }
}

function redactToolCall(tool: AgentChatToolCallView): AgentChatToolCallView {
  const argumentsText = redactAgentSecretText(tool.arguments)
  const result = tool.result === undefined ? undefined : redactAgentSecretText(tool.result)
  if (argumentsText === tool.arguments && result === tool.result) return tool
  return {
    ...tool,
    arguments: argumentsText,
    ...(result === undefined ? {} : { result })
  }
}

function redactTurnMetadata(metadata: AgentTurnMetadata | undefined): AgentTurnMetadata | undefined {
  if (!metadata) return metadata
  const sources = metadata.sources?.map(redactSourceMetadata)
  const childRuns = metadata.childRuns?.map((child) => redactChildRunMetadata(child as AgentChildRunWithArchive))
  const compactions = metadata.compactions?.map(redactCompactionMetadata)
  const toolResults = metadata.toolResults?.map(redactToolResultDiagnostic)
  const fileTouches = redactFileTouchMetadata(metadata.fileTouches)
  const changed = Boolean(
    sources?.some((source, index) => source !== metadata.sources?.[index]) ||
    childRuns?.some((child, index) => child !== metadata.childRuns?.[index]) ||
    compactions?.some((compaction, index) => compaction !== metadata.compactions?.[index]) ||
    toolResults?.some((diagnostic, index) => diagnostic !== metadata.toolResults?.[index]) ||
    fileTouches !== metadata.fileTouches
  )
  if (!changed) return metadata
  return {
    ...metadata,
    ...(sources === undefined ? {} : { sources }),
    ...(childRuns === undefined ? {} : { childRuns }),
    ...(compactions === undefined ? {} : { compactions }),
    ...(toolResults === undefined ? {} : { toolResults }),
    ...(fileTouches === undefined ? {} : { fileTouches })
  }
}

function redactFileTouchMetadata(
  fileTouches: AgentTurnMetadata['fileTouches']
): AgentTurnMetadata['fileTouches'] {
  if (!fileTouches) return fileTouches
  const files = fileTouches.files.map((file) => {
    const path = redactAgentSecretText(file.path)
    return path === file.path ? file : { ...file, path }
  })
  const changed = files.some((file, index) => file !== fileTouches.files[index])
  return changed ? { role: 'reference_projection', files } : fileTouches
}

function redactSourceMetadata(source: AgentSourceMetadata): AgentSourceMetadata {
  const url = redactAgentSecretText(source.url)
  const title = source.title === undefined ? undefined : redactAgentSecretText(source.title)
  const snippet = source.snippet === undefined ? undefined : redactAgentSecretText(source.snippet)
  if (url === source.url && title === source.title && snippet === source.snippet) return source
  return {
    ...source,
    url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet })
  }
}

function redactChildRunMetadata(child: AgentChildRunWithArchive): AgentChildRunWithArchive {
  const label = redactAgentSecretText(child.label)
  const summary = child.summary === undefined ? undefined : redactAgentSecretText(child.summary)
  const error = child.error === undefined ? undefined : redactAgentSecretText(child.error)
  const transcript = child.transcript === undefined ? undefined : redactAgentSecretText(child.transcript)
  const transcriptText = child.transcriptText === undefined ? undefined : redactAgentSecretText(child.transcriptText)
  const archive = child.archive === undefined ? undefined : redactArtifactRefPreview(child.archive)
  const citations = child.citations?.map((citation) => {
    const url = redactAgentSecretText(citation.url)
    const title = citation.title === undefined ? undefined : redactAgentSecretText(citation.title)
    return url === citation.url && title === citation.title ? citation : {
      ...citation,
      url,
      ...(title === undefined ? {} : { title })
    }
  })
  const citationsChanged = Boolean(citations?.some((citation, index) => citation !== child.citations?.[index]))
  if (label === child.label && summary === child.summary && error === child.error &&
    transcript === child.transcript && transcriptText === child.transcriptText && archive === child.archive &&
    !citationsChanged) return child
  return {
    ...child,
    label,
    ...(summary === undefined ? {} : { summary }),
    ...(error === undefined ? {} : { error }),
    ...(transcript === undefined ? {} : { transcript }),
    ...(transcriptText === undefined ? {} : { transcriptText }),
    ...(archive === undefined ? {} : { archive }),
    ...(citations === undefined ? {} : { citations })
  }
}

function childRunForAudit(child: AgentChildRunWithArchive): AgentChildRunMetadata {
  const redacted = redactChildRunMetadata(child)
  const { transcript: _transcript, transcriptText: _transcriptText, ...persisted } = redacted
  return persisted
}

function redactCompactionMetadata(compaction: AgentCompactionMetadata): AgentCompactionMetadata {
  const reason = redactAgentSecretText(compaction.reason)
  const error = compaction.error === undefined ? undefined : redactAgentSecretText(compaction.error)
  if (reason === compaction.reason && error === compaction.error) return compaction
  return {
    ...compaction,
    reason,
    ...(error === undefined ? {} : { error })
  }
}

function redactToolResultDiagnostic(diagnostic: AgentToolResultDiagnostic): AgentToolResultDiagnostic {
  if (!diagnostic.archive) return diagnostic
  const archive = redactArtifactRefPreview(diagnostic.archive)
  return archive === diagnostic.archive ? diagnostic : { ...diagnostic, archive }
}

function redactArtifactRefPreview(artifact: AgentArtifactRef): AgentArtifactRef {
  if (artifact.preview === undefined) return artifact
  const preview = redactAgentSecretText(artifact.preview)
  return preview === artifact.preview ? artifact : { ...artifact, preview }
}

function artifactRefsEqual(left: AgentArtifactRef, right: AgentArtifactRef): boolean {
  return left.kind === right.kind &&
    left.relativePath === right.relativePath &&
    left.sha256 === right.sha256 &&
    left.bytes === right.bytes &&
    left.lines === right.lines
}

function childTranscriptText(child: AgentChildRunWithArchive): string | null {
  if (typeof child.transcript === 'string') return child.transcript
  if (typeof child.transcriptText === 'string') return child.transcriptText
  return null
}

function childTranscriptArchive(child: AgentChildRunWithArchive): AgentArtifactRef | null {
  return child.archive?.kind === 'child_transcript' ? child.archive : null
}

function withChildTranscriptArchive(
  child: AgentChildRunWithArchive,
  archive: AgentArtifactRef
): AgentChildRunWithArchive {
  const { transcript: _transcript, transcriptText: _transcriptText, ...persisted } = child
  return { ...persisted, archive }
}

function withToolResultArchiveMetadata(
  turn: AgentChatTurn,
  tool: AgentChatToolCallView,
  artifact: AgentArtifactRef
): AgentChatTurn {
  const diagnostic: AgentToolResultDiagnostic = {
    toolCallId: tool.id,
    toolName: tool.name || 'tool',
    bytes: artifact.bytes,
    lines: artifact.lines ?? 0,
    approxTokens: Math.ceil((tool.result ?? '').length / 4),
    isError: tool.isError === true ? true : undefined,
    archive: artifact
  }
  const existing = turn.metadata?.toolResults ?? []
  const key = `${diagnostic.toolCallId}:${diagnostic.toolName}`
  const merged = [
    ...existing.filter((item) => `${item.toolCallId}:${item.toolName}` !== key),
    diagnostic
  ].slice(-MAX_TOOL_RESULT_DIAGNOSTICS)
  return {
    ...turn,
    metadata: {
      ...turn.metadata,
      version: 1,
      toolResults: merged
    }
  }
}

function auditEntryId(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'entry')
    .join(':')
}

function safePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item'
}

function timestampValue(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function compactText(value: string, maxLength: number): string {
  const compact = redactAgentSecretText(value).replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function lineCount(value: string): number {
  return value ? value.split(/\r\n|\r|\n/).length : 0
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item
  }
  return out as T
}
