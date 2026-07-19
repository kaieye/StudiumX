import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
  agentConversationHistoryIndexRelativePath,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown,
  describeAgentConversationPath,
  normalizeAgentConversationRelativePath
} from '../shared/agent-conversation-catalog'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'
import { sanitizePersistedAgentConversationRecord } from '../shared/agent-persisted-history'
import type {
  AgentArchivedHistoryIntegrity,
  AgentArchivedHistoryIssue,
  AgentArchivedHistoryItem,
  AgentArchivedHistoryItemType,
  AgentArtifactRef,
  AgentConversationCheckpoint,
  AgentConversationRecord
} from '../shared/teaching-types'
import {
  collectAgentConversationArtifactRefs,
  scanAgentConversationCheckpoints,
  agentConversationCheckpointRelativePath
} from './agent-conversation-checkpoints'
import {
  isPathInsideRoot,
  isRealPathInsideRoot,
  readContainedRegularFile,
  writeContentAddressedFile
} from './path-access'

export const AGENT_CONVERSATION_HISTORY_INDEX_SCHEMA_VERSION = 1
export const AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH = agentConversationHistoryIndexRelativePath()
export const AGENT_CONVERSATION_HISTORY_INDEX_MAX_BYTES = 16 * 1024 * 1024
export const AGENT_CONVERSATION_HISTORY_INDEX_MAX_ITEMS = 50_000
export const AGENT_CONVERSATION_SESSION_AUDIT_MAX_BYTES = 8 * 1024 * 1024

const SESSION_AUDIT_LINE_MAX_BYTES = 256 * 1024
const INDEX_SUMMARY_MAX_BYTES = 1200
const DEFAULT_QUERY_LIMIT = 100
const MAX_QUERY_LIMIT = 500
const DEFAULT_QUERY_MAX_BYTES = 256 * 1024
const MAX_QUERY_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_QUERY_MAX_EXCERPT_BYTES = 1200
const MAX_QUERY_MAX_EXCERPT_BYTES = 8192
const MAX_QUERY_ISSUES = 100
const HISTORY_ITEM_TYPES = new Set<AgentArchivedHistoryItemType>([
  'conversation_turn',
  'session_sidecar',
  'tool_result',
  'child_transcript',
  'checkpoint'
])
const HISTORY_INTEGRITY_VALUES = new Set<AgentArchivedHistoryIntegrity>([
  'verified',
  'missing',
  'hash_mismatch',
  'not_applicable'
])

export type AgentConversationHistoryIndex = {
  schemaVersion: 1
  rebuiltAt: string
  items: AgentArchivedHistoryItem[]
  issues: AgentArchivedHistoryIssue[]
  integritySha256: string
}

export type RebuildAgentConversationHistoryIndexResult = {
  index: AgentConversationHistoryIndex
  issues: AgentArchivedHistoryIssue[]
  indexRelativePath: string
}

export type QueryAgentArchivedHistoryInput = {
  rootPath: string
  conversationId?: string
  from?: string
  to?: string
  types?: AgentArchivedHistoryItemType[]
  checkpointId?: string
  limit?: number
  maxBytes?: number
  maxExcerptBytes?: number
}

export type QueryAgentArchivedHistoryResult = {
  items: AgentArchivedHistoryItem[]
  truncated: boolean
  usage: {
    items: number
    bytes: number
    limit: number
    maxBytes: number
    maxExcerptBytes: number
  }
  issues: AgentArchivedHistoryIssue[]
  providerInjection: 'none'
  memoryWrite: 'none'
}

/**
 * Rebuilds a derived, redacted index from caller-supplied raw persisted records,
 * durable audit sidecars, artifact references, and conversation checkpoints.
 * The input records and their original turns are never modified.
 */
export async function rebuildAgentConversationHistoryIndex(input: {
  rootPath: string
  records: readonly AgentConversationRecord[]
  rebuiltAt?: string
}): Promise<RebuildAgentConversationHistoryIndexResult> {
  const issues: AgentArchivedHistoryIssue[] = []
  const items: AgentArchivedHistoryItem[] = []
  const records = [...input.records].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath) || left.id.localeCompare(right.id)
  )

  for (const record of records) {
    try {
      // Rebuilds can read legacy raw archives, but the newly written index must
      // consume only a privacy-safe projection and never rewrite the source.
      items.push(...await buildConversationHistoryItems(
        input.rootPath,
        sanitizePersistedAgentConversationRecord(record),
        issues
      ))
    } catch (error) {
      issues.push(issue(
        'conversation_index_failed',
        error,
        historyReference('conversation_turn', record.id, record.relativePath)
      ))
    }
    if (items.length > AGENT_CONVERSATION_HISTORY_INDEX_MAX_ITEMS) {
      throw new Error('Archived history index exceeds its maximum item count.')
    }
  }

  items.sort(compareHistoryItems)
  const unsigned = {
    schemaVersion: 1 as const,
    rebuiltAt: requireIsoTimestamp(input.rebuiltAt ?? new Date().toISOString(), 'rebuiltAt'),
    items,
    issues
  }
  const index: AgentConversationHistoryIndex = {
    ...unsigned,
    integritySha256: sha256(canonicalJson(unsigned))
  }
  const content = `${canonicalJson(index)}\n`
  if (Buffer.byteLength(content, 'utf8') > AGENT_CONVERSATION_HISTORY_INDEX_MAX_BYTES) {
    throw new Error('Archived history index exceeds its maximum persisted size.')
  }
  await writeHistoryIndex(input.rootPath, content)
  return {
    index,
    issues: [...issues],
    indexRelativePath: AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH
  }
}

export async function readAgentConversationHistoryIndex(input: {
  rootPath: string
}): Promise<AgentConversationHistoryIndex> {
  const targetPath = join(input.rootPath, AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH)
  let content: Buffer
  try {
    content = await readContainedRegularFile(input.rootPath, targetPath)
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      throw historyIndexRebuildError('Archived history index is missing.')
    }
    throw historyIndexRebuildError(safeErrorMessage(error))
  }
  if (content.byteLength > AGENT_CONVERSATION_HISTORY_INDEX_MAX_BYTES) {
    throw historyIndexRebuildError('Archived history index exceeds its maximum size.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content.toString('utf8'))
  } catch {
    throw historyIndexRebuildError('Archived history index is malformed JSON.')
  }
  try {
    return parseHistoryIndex(parsed)
  } catch (error) {
    throw historyIndexRebuildError(safeErrorMessage(error))
  }
}

/**
 * Explicit, bounded retrieval only. Results are returned as a separate archive
 * view and are never injected into provider history or learner memory.
 */
export async function queryAgentArchivedHistory(
  input: QueryAgentArchivedHistoryInput
): Promise<QueryAgentArchivedHistoryResult> {
  const index = await readAgentConversationHistoryIndex({ rootPath: input.rootPath })
  const limit = boundedInteger(input.limit, DEFAULT_QUERY_LIMIT, 1, MAX_QUERY_LIMIT, 'limit')
  const maxBytes = boundedInteger(
    input.maxBytes,
    DEFAULT_QUERY_MAX_BYTES,
    1,
    MAX_QUERY_MAX_BYTES,
    'maxBytes'
  )
  const maxExcerptBytes = boundedInteger(
    input.maxExcerptBytes,
    DEFAULT_QUERY_MAX_EXCERPT_BYTES,
    1,
    MAX_QUERY_MAX_EXCERPT_BYTES,
    'maxExcerptBytes'
  )
  const from = input.from ? parseTimestamp(input.from, 'from') : null
  const to = input.to ? parseTimestamp(input.to, 'to') : null
  if (from !== null && to !== null && from > to) throw new Error('Archived history from timestamp is after to timestamp.')
  const types = input.types ? new Set(input.types.map(requireHistoryItemType)) : null
  const matching = index.items.filter((item) => {
    if (input.conversationId && item.conversationId !== input.conversationId) return false
    const timestamp = Date.parse(item.timestamp)
    if (from !== null && timestamp < from) return false
    if (to !== null && timestamp > to) return false
    if (types && !types.has(item.type)) return false
    if (input.checkpointId && item.reference !== checkpointHistoryReference(item.conversationRelativePath, input.checkpointId) &&
      !item.checkpointIds?.includes(input.checkpointId)) return false
    return true
  })

  const resultItems: AgentArchivedHistoryItem[] = []
  const queryIssues = index.issues.map(cloneIssue)
  let usedBytes = 0
  let truncated = false
  for (const indexedItem of matching) {
    if (resultItems.length >= limit) {
      truncated = true
      break
    }
    const item = cloneHistoryItem(indexedItem)
    item.summary = truncateUtf8(redactAgentSecretText(item.summary), maxExcerptBytes)
    if (item.artifact) {
      const currentIntegrity = await verifyArtifactIntegrity(input.rootPath, item.artifact)
      item.integrity = currentIntegrity
      if (currentIntegrity !== 'verified') {
        queryIssues.push({
          code: currentIntegrity === 'missing' ? 'artifact_missing' : 'artifact_hash_mismatch',
          message: currentIntegrity === 'missing'
            ? 'An archived artifact is missing.'
            : 'An archived artifact failed integrity validation.',
          reference: item.reference
        })
      }
    }
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8')
    if (usedBytes + itemBytes > maxBytes) {
      truncated = true
      break
    }
    resultItems.push(item)
    usedBytes += itemBytes
  }
  if (resultItems.length < matching.length) truncated = true

  const dedupedIssues = dedupeIssues(queryIssues)
  if (dedupedIssues.length > MAX_QUERY_ISSUES) truncated = true

  return {
    items: resultItems,
    truncated,
    usage: {
      items: resultItems.length,
      bytes: usedBytes,
      limit,
      maxBytes,
      maxExcerptBytes
    },
    issues: dedupedIssues.slice(0, MAX_QUERY_ISSUES),
    providerInjection: 'none',
    memoryWrite: 'none'
  }
}

async function buildConversationHistoryItems(
  rootPath: string,
  record: AgentConversationRecord,
  issues: AgentArchivedHistoryIssue[]
): Promise<AgentArchivedHistoryItem[]> {
  const conversationRelativePath = requireConversationRelativePath(record)
  const sourceJsonRelativePath = agentConversationJsonRelativePathForMarkdown(conversationRelativePath)
  const checkpointScan = await scanAgentConversationCheckpoints({ rootPath, conversationRelativePath })
  for (const checkpointIssue of checkpointScan.issues) {
    issues.push({
      code: checkpointIssue.code,
      message: redactAgentSecretText(checkpointIssue.message),
      ...(checkpointIssue.relativePath ? { reference: checkpointIssue.relativePath } : {})
    })
  }
  const checkpoints = checkpointScan.checkpoints
  const items: AgentArchivedHistoryItem[] = []

  for (const [turnIndex, turn] of record.turns.entries()) {
    const turnCheckpointIds = checkpoints
      .filter((checkpoint) => turnIndex < checkpoint.turnCount)
      .map((checkpoint) => checkpoint.checkpointId)
    items.push({
      reference: historyReference('conversation_turn', conversationRelativePath, turn.id),
      type: 'conversation_turn',
      conversationId: record.id,
      conversationRelativePath,
      timestamp: requireIsoTimestamp(turn.createdAt, 'turn timestamp'),
      summary: boundedSummary(`${turn.role}: ${turn.content}`),
      sourceRelativePath: sourceJsonRelativePath,
      turnId: turn.id,
      ...(turnCheckpointIds.length > 0 ? { checkpointIds: turnCheckpointIds } : {}),
      bytes: Buffer.byteLength(turn.content, 'utf8'),
      integrity: 'not_applicable'
    })

    let turnArtifacts: AgentArtifactRef[] = []
    try {
      turnArtifacts = collectAgentConversationArtifactRefs([turn])
    } catch (error) {
      issues.push(issue(
        'artifact_reference_invalid',
        error,
        historyReference('conversation_turn', conversationRelativePath, turn.id)
      ))
    }
    for (const artifact of turnArtifacts) {
      const artifactCheckpointIds = checkpoints
        .filter((checkpoint) => checkpoint.artifacts.some((candidate) => artifactRefsEqual(candidate, artifact)))
        .map((checkpoint) => checkpoint.checkpointId)
      const integrity = await verifyArtifactIntegrity(rootPath, artifact)
      if (integrity !== 'verified') {
        issues.push({
          code: integrity === 'missing' ? 'artifact_missing' : 'artifact_hash_mismatch',
          message: integrity === 'missing'
            ? 'An archived artifact is missing.'
            : 'An archived artifact failed integrity validation.',
          reference: artifact.relativePath
        })
      }
      items.push({
        reference: historyReference(artifact.kind, conversationRelativePath, turn.id, artifact.relativePath, artifact.sha256),
        type: artifact.kind,
        conversationId: record.id,
        conversationRelativePath,
        timestamp: artifact.archivedAt
          ? requireIsoTimestamp(artifact.archivedAt, 'artifact timestamp')
          : requireIsoTimestamp(turn.createdAt, 'turn timestamp'),
        summary: boundedSummary(artifact.preview || `${artifact.kind} artifact`),
        sourceRelativePath: artifact.relativePath,
        turnId: turn.id,
        artifact: { ...artifact, ...(artifact.preview ? { preview: boundedSummary(artifact.preview) } : {}) },
        ...(artifactCheckpointIds.length > 0 ? { checkpointIds: artifactCheckpointIds } : {}),
        bytes: artifact.bytes,
        integrity
      })
    }
  }

  for (const checkpoint of checkpoints) {
    items.push(checkpointHistoryItem(record, conversationRelativePath, checkpoint))
  }
  items.push(...await readSessionAuditHistoryItems(rootPath, record, conversationRelativePath, checkpoints, issues))
  return items
}

async function readSessionAuditHistoryItems(
  rootPath: string,
  record: AgentConversationRecord,
  conversationRelativePath: string,
  checkpoints: readonly AgentConversationCheckpoint[],
  issues: AgentArchivedHistoryIssue[]
): Promise<AgentArchivedHistoryItem[]> {
  const relativePath = agentConversationSessionAuditRelativePathForMarkdown(conversationRelativePath)
  let content: Buffer
  try {
    content = await readContainedRegularFile(rootPath, join(rootPath, relativePath))
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) return []
    issues.push(issue('session_audit_read_failed', error, relativePath))
    return []
  }
  if (content.byteLength > AGENT_CONVERSATION_SESSION_AUDIT_MAX_BYTES) {
    issues.push({
      code: 'session_audit_too_large',
      message: 'Conversation session audit exceeds the maximum indexed size.',
      reference: relativePath
    })
    return []
  }

  const items: AgentArchivedHistoryItem[] = []
  const lines = content.toString('utf8').split(/\r\n|\r|\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (!line.trim()) continue
    const lineBytes = Buffer.byteLength(line, 'utf8')
    if (lineBytes > SESSION_AUDIT_LINE_MAX_BYTES) {
      issues.push({
        code: 'session_audit_line_too_large',
        message: 'Conversation session audit line exceeds the maximum indexed size.',
        reference: `${relativePath}#L${index + 1}`
      })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      issues.push({
        code: 'session_audit_invalid_json',
        message: 'Conversation session audit contains malformed JSON.',
        reference: `${relativePath}#L${index + 1}`
      })
      continue
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string' || !parsed.type.trim()) {
      issues.push({
        code: 'session_audit_invalid_entry',
        message: 'Conversation session audit contains an invalid entry.',
        reference: `${relativePath}#L${index + 1}`
      })
      continue
    }
    const turnId = typeof parsed.turnId === 'string' && parsed.turnId ? parsed.turnId : undefined
    const timestamp = auditTimestamp(parsed, record)
    const checkpointIds = turnId
      ? checkpoints.filter((checkpoint) => checkpointContainsTurn(record, checkpoint, turnId))
        .map((checkpoint) => checkpoint.checkpointId)
      : []
    const auditId = typeof parsed.id === 'string' && parsed.id ? parsed.id : `line-${index + 1}`
    items.push({
      reference: historyReference('session_sidecar', conversationRelativePath, auditId, String(index + 1)),
      type: 'session_sidecar',
      conversationId: record.id,
      conversationRelativePath,
      timestamp,
      summary: boundedSummary(summarizeAuditEntry(parsed)),
      sourceRelativePath: relativePath,
      ...(turnId ? { turnId } : {}),
      ...(checkpointIds.length > 0 ? { checkpointIds } : {}),
      bytes: lineBytes,
      integrity: 'not_applicable'
    })
  }
  return items
}

function checkpointHistoryItem(
  record: AgentConversationRecord,
  conversationRelativePath: string,
  checkpoint: AgentConversationCheckpoint
): AgentArchivedHistoryItem {
  return {
    reference: checkpointHistoryReference(conversationRelativePath, checkpoint.checkpointId),
    type: 'checkpoint',
    conversationId: record.id,
    conversationRelativePath,
    timestamp: checkpoint.createdAt,
    summary: boundedSummary(checkpoint.label || checkpoint.reason || `Checkpoint at ${checkpoint.turnCount} turns`),
    sourceRelativePath: agentConversationCheckpointRelativePath(
      conversationRelativePath,
      checkpoint.checkpointId
    ),
    ...(checkpoint.headTurnId ? { turnId: checkpoint.headTurnId } : {}),
    checkpointIds: [checkpoint.checkpointId],
    bytes: Buffer.byteLength(canonicalJson(checkpoint), 'utf8'),
    integrity: 'verified'
  }
}

function parseHistoryIndex(value: unknown): AgentConversationHistoryIndex {
  if (!isRecord(value)) throw new Error('Archived history index must be an object.')
  if (value.schemaVersion !== AGENT_CONVERSATION_HISTORY_INDEX_SCHEMA_VERSION) {
    throw new Error('Unsupported archived history index schema version.')
  }
  const rebuiltAt = requireIsoTimestamp(requireString(value.rebuiltAt, 'rebuiltAt'), 'rebuiltAt')
  if (!Array.isArray(value.items) || value.items.length > AGENT_CONVERSATION_HISTORY_INDEX_MAX_ITEMS) {
    throw new Error('Archived history index items are invalid.')
  }
  if (!Array.isArray(value.issues)) throw new Error('Archived history index issues are invalid.')
  const integritySha256 = requireSha256(value.integritySha256, 'integritySha256')
  const unsigned = {
    schemaVersion: 1 as const,
    rebuiltAt: value.rebuiltAt,
    items: value.items,
    issues: value.issues
  }
  if (sha256(canonicalJson(unsigned)) !== integritySha256) {
    throw new Error('Archived history index failed integrity validation.')
  }

  const items = value.items.map(parseHistoryItem)
  const issues = value.issues.map(parseHistoryIssue)
  return {
    schemaVersion: AGENT_CONVERSATION_HISTORY_INDEX_SCHEMA_VERSION,
    rebuiltAt,
    items,
    issues,
    integritySha256
  }
}

function parseHistoryItem(value: unknown): AgentArchivedHistoryItem {
  if (!isRecord(value)) throw new Error('Archived history index contains an invalid item.')
  const type = requireHistoryItemType(value.type)
  const integrity = requireHistoryIntegrity(value.integrity)
  const conversationId = requireString(value.conversationId, 'conversationId')
  const conversationRelativePath = requireConversationRelativePathValue(
    requireString(value.conversationRelativePath, 'conversationRelativePath'),
    conversationId
  )
  const artifact = value.artifact === undefined ? undefined : parseArtifactRef(value.artifact)
  if ((type === 'tool_result' || type === 'child_transcript') && !artifact) {
    throw new Error('Archived artifact history item is missing its artifact reference.')
  }
  if (artifact && artifact.kind !== type) throw new Error('Archived artifact history item kind does not match its type.')
  const checkpointIds = value.checkpointIds === undefined
    ? undefined
    : requireStringArray(value.checkpointIds, 'checkpointIds')
  return {
    reference: requireString(value.reference, 'reference'),
    type,
    conversationId,
    conversationRelativePath,
    timestamp: requireIsoTimestamp(requireString(value.timestamp, 'timestamp'), 'timestamp'),
    summary: requireStringAllowEmpty(value.summary, 'summary'),
    sourceRelativePath: requireNormalizedRelativePath(
      requireString(value.sourceRelativePath, 'sourceRelativePath'),
      'sourceRelativePath'
    ),
    ...(value.turnId !== undefined ? { turnId: requireString(value.turnId, 'turnId') } : {}),
    ...(artifact ? { artifact } : {}),
    ...(checkpointIds ? { checkpointIds } : {}),
    bytes: requireNonNegativeSafeInteger(value.bytes, 'bytes'),
    integrity
  }
}

function parseHistoryIssue(value: unknown): AgentArchivedHistoryIssue {
  if (!isRecord(value)) throw new Error('Archived history index contains an invalid issue.')
  return {
    code: requireString(value.code, 'issue code'),
    message: redactAgentSecretText(requireString(value.message, 'issue message')).slice(0, 1000),
    ...(value.reference !== undefined ? { reference: requireString(value.reference, 'issue reference') } : {})
  }
}

function parseArtifactRef(value: unknown): AgentArtifactRef {
  if (!isRecord(value) || (value.kind !== 'tool_result' && value.kind !== 'child_transcript')) {
    throw new Error('Archived history index contains an invalid artifact reference.')
  }
  return {
    kind: value.kind,
    relativePath: requireNormalizedRelativePath(requireString(value.relativePath, 'artifact path'), 'artifact path'),
    sha256: requireSha256(value.sha256, 'artifact sha256'),
    bytes: requireNonNegativeSafeInteger(value.bytes, 'artifact bytes'),
    ...(value.lines !== undefined ? { lines: requireNonNegativeSafeInteger(value.lines, 'artifact lines') } : {}),
    ...(value.preview !== undefined
      ? { preview: redactAgentSecretText(requireStringAllowEmpty(value.preview, 'artifact preview')) }
      : {}),
    ...(value.archivedAt !== undefined
      ? { archivedAt: requireIsoTimestamp(requireString(value.archivedAt, 'artifact archivedAt'), 'artifact archivedAt') }
      : {})
  }
}

async function verifyArtifactIntegrity(
  rootPath: string,
  artifact: AgentArtifactRef
): Promise<AgentArchivedHistoryIntegrity> {
  let relativePath: string
  try {
    relativePath = requireNormalizedRelativePath(artifact.relativePath, 'artifact path')
  } catch {
    return 'missing'
  }
  try {
    const content = await readContainedRegularFile(rootPath, join(rootPath, relativePath))
    if (content.byteLength !== artifact.bytes || sha256(content) !== artifact.sha256) return 'hash_mismatch'
    return 'verified'
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) return 'missing'
    return 'missing'
  }
}

async function writeHistoryIndex(rootPath: string, content: string): Promise<void> {
  const targetPath = join(rootPath, AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH)
  if (!isPathInsideRoot(rootPath, targetPath)) throw new Error('Archived history index path is outside the configured root.')
  const replacementId = randomUUID()
  const temporaryPath = `${targetPath}.${replacementId}.tmp`
  const backupPath = `${targetPath}.${replacementId}.bak`
  if (!isPathInsideRoot(rootPath, temporaryPath) || !isPathInsideRoot(rootPath, backupPath)) {
    throw new Error('Archived history index replacement path is outside the configured root.')
  }
  const contentSha256 = sha256(content)
  await writeContentAddressedFile({ rootPath, targetPath: temporaryPath, content, sha256: contentSha256 })
  let existingMovedToBackup = false
  let replacementInstalled = false
  try {
    const parentPath = join(rootPath, '.agent-sessions')
    if (!(await isRealPathInsideRoot(rootPath, parentPath))) {
      throw new Error('Archived history index directory escapes the configured root.')
    }
    const existing = await lstat(targetPath).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
      throw new Error('Archived history index target must be a regular file.')
    }
    const backup = await lstat(backupPath).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (backup) throw new Error('Archived history index backup path already exists.')

    // Windows does not reliably replace an existing destination with rename().
    // Move the verified regular target aside, install the new index, and restore
    // the old target if installation fails. All paths remain in one contained
    // directory, and symlink targets are rejected before replacement.
    if (existing) {
      await rename(targetPath, backupPath)
      existingMovedToBackup = true
    }
    await rename(temporaryPath, targetPath)
    replacementInstalled = true
    if (existingMovedToBackup) await rm(backupPath, { force: true }).catch(() => undefined)
  } catch (error) {
    if (existingMovedToBackup && !replacementInstalled) {
      const currentTarget = await lstat(targetPath).catch((targetError: unknown) => {
        if (isErrnoException(targetError, 'ENOENT')) return null
        throw targetError
      })
      if (!currentTarget) {
        await rename(backupPath, targetPath).catch(() => undefined)
      }
    }
    throw error
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    if (replacementInstalled) await rm(backupPath, { force: true }).catch(() => undefined)
  }
}

function requireConversationRelativePath(record: AgentConversationRecord): string {
  return requireConversationRelativePathValue(record.relativePath, record.id)
}

function requireConversationRelativePathValue(value: string, expectedId: string): string {
  const normalized = normalizeAgentConversationRelativePath(value)
  if (normalized !== value) throw new Error('Conversation history path must already be normalized.')
  const info = describeAgentConversationPath(normalized)
  if (info?.format !== 'markdown' || info.id !== expectedId) {
    throw new Error('Conversation history path is outside a conversations directory or has a mismatched id.')
  }
  return normalized
}

function auditTimestamp(entry: Record<string, unknown>, record: AgentConversationRecord): string {
  for (const candidate of [entry.timestamp, entry.createdAt, record.createdAt]) {
    if (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate))) {
      return new Date(Date.parse(candidate)).toISOString()
    }
  }
  return new Date(0).toISOString()
}

function summarizeAuditEntry(entry: Record<string, unknown>): string {
  const type = String(entry.type)
  const candidates = [
    entry.contentPreview,
    entry.argumentsPreview,
    entry.title,
    entry.detail,
    entry.toolName,
    entry.role
  ]
  const detail = candidates.find((value) => typeof value === 'string' && value.trim())
  return detail ? `${type}: ${detail as string}` : type
}

function checkpointContainsTurn(
  record: AgentConversationRecord,
  checkpoint: AgentConversationCheckpoint,
  turnId: string
): boolean {
  const index = record.turns.findIndex((turn) => turn.id === turnId)
  return index >= 0 && index < checkpoint.turnCount
}

function boundedSummary(value: string): string {
  const compact = redactAgentSecretText(value).replace(/\s+/g, ' ').trim()
  return truncateUtf8(compact, INDEX_SUMMARY_MAX_BYTES)
}

function truncateUtf8(value: string, maxBytes: number): string {
  const content = Buffer.from(value, 'utf8')
  if (content.byteLength <= maxBytes) return value
  if (maxBytes <= 3) return content.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '')
  let truncated = content.subarray(0, maxBytes - 3).toString('utf8')
  while (truncated.endsWith('\uFFFD')) truncated = truncated.slice(0, -1)
  return `${truncated}...`
}

function historyReference(type: AgentArchivedHistoryItemType, ...parts: string[]): string {
  return `${type}:${sha256(canonicalJson(parts)).slice(0, 32)}`
}

function checkpointHistoryReference(conversationRelativePath: string, checkpointId: string): string {
  return historyReference('checkpoint', conversationRelativePath, checkpointId)
}

function artifactRefsEqual(left: AgentArtifactRef, right: AgentArtifactRef): boolean {
  return left.kind === right.kind && left.relativePath === right.relativePath && left.sha256 === right.sha256 &&
    left.bytes === right.bytes && left.lines === right.lines
}

function compareHistoryItems(left: AgentArchivedHistoryItem, right: AgentArchivedHistoryItem): number {
  return left.timestamp.localeCompare(right.timestamp) ||
    left.conversationRelativePath.localeCompare(right.conversationRelativePath) ||
    left.reference.localeCompare(right.reference)
}

function cloneHistoryItem(item: AgentArchivedHistoryItem): AgentArchivedHistoryItem {
  return {
    ...item,
    ...(item.artifact ? { artifact: { ...item.artifact } } : {}),
    ...(item.checkpointIds ? { checkpointIds: [...item.checkpointIds] } : {})
  }
}

function cloneIssue(value: AgentArchivedHistoryIssue): AgentArchivedHistoryIssue {
  return { ...value }
}

function dedupeIssues(values: AgentArchivedHistoryIssue[]): AgentArchivedHistoryIssue[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = `${value.code}:${value.reference ?? ''}:${value.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function issue(code: string, error: unknown, reference?: string): AgentArchivedHistoryIssue {
  return {
    code,
    message: safeErrorMessage(error),
    ...(reference ? { reference } : {})
  }
}

function historyIndexRebuildError(detail: string): Error {
  return new Error(`${detail} Rebuild the archived history index before querying it.`)
}

function requireHistoryItemType(value: unknown): AgentArchivedHistoryItemType {
  if (typeof value !== 'string' || !HISTORY_ITEM_TYPES.has(value as AgentArchivedHistoryItemType)) {
    throw new Error('Archived history item type is invalid.')
  }
  return value as AgentArchivedHistoryItemType
}

function requireHistoryIntegrity(value: unknown): AgentArchivedHistoryIntegrity {
  if (typeof value !== 'string' || !HISTORY_INTEGRITY_VALUES.has(value as AgentArchivedHistoryIntegrity)) {
    throw new Error('Archived history integrity status is invalid.')
  }
  return value as AgentArchivedHistoryIntegrity
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`Archived history ${field} is outside the allowed bounds.`)
  }
  return result
}

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`Archived history ${field} timestamp is invalid.`)
  return timestamp
}

function requireIsoTimestamp(value: string, field: string): string {
  const timestamp = parseTimestamp(value, field)
  return new Date(timestamp).toISOString()
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Archived history ${field} is invalid.`)
  return value
}

function requireStringAllowEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Archived history ${field} is invalid.`)
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Archived history ${field} is invalid.`)
  }
  return [...new Set(value)]
}

function requireNonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Archived history ${field} is invalid.`)
  }
  return value as number
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Archived history ${field} is invalid.`)
  }
  return value
}

function requireNormalizedRelativePath(value: string, field: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (normalized !== value || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Archived history ${field} must be a normalized relative path.`)
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Archived history ${field} contains an invalid segment.`)
  }
  return normalized
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (item !== undefined) result[key] = canonicalize(item)
  }
  return result
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeErrorMessage(error: unknown): string {
  return redactAgentSecretText(error instanceof Error ? error.message : String(error)).slice(0, 1000)
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
