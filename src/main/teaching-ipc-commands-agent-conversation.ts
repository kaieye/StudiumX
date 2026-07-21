/**
 * Fail-closed IPC parsers for agent-conversation product channels
 * (save/rename/read/summaries/session-tree/branch/checkpoint + write-rewind
 * journal + archived history). Peeled from teaching-ipc-commands by ADR-0120
 * (S-03 residual by-touch). Behavior byte-identical.
 */
import type {
  AgentArchivedHistoryItemType,
  AgentChatTurn,
  CreateAgentConversationCheckpointPayload,
  ForkAgentConversationBranchPayload,
  ListAgentWriteRewindJournalPayload,
  OpenAgentConversationBranchPayload,
  QueryAgentArchivedHistoryPayload,
  RebuildAgentHistoryIndexPayload,
  ResolveAgentConversationCheckpointPayload,
  RestoreAgentWriteRewindPayload,
  ReadAgentConversationPayload,
  ProjectAgentConversationSummariesPayload,
  RenameAgentConversationPayload,
  ReadAgentConversationSessionTreePayload,
  ReplayAgentConversationBranchPayload,
  SaveAgentConversationPayload,
  UpdateAgentConversationBranchStatusPayload
} from '../shared/teaching-types'
import {
  optionalBoundedString,
  optionalBoundedTrimmedString,
  optionalCanonicalConversationId,
  optionalIsoDate,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalSafeId,
  optionalStreamId,
  optionalString,
  requireCanonicalConversationId,
  requireNonNegativeInteger,
  requireRecord,
  requireSafeId,
  requireString
} from './teaching-ipc-commands'

const MAX_SAVED_CONVERSATION_TURNS = 400
const MAX_SAVED_CONVERSATION_BYTES = 8 * 1024 * 1024
const MAX_SAVED_TURN_CONTENT_BYTES = 1024 * 1024
const SAFE_LINEAGE_ID = /^[A-Za-z0-9._:-]{1,160}$/
const SAFE_TURN_ID = /^[A-Za-z0-9._:-]{1,240}$/

export function parseSaveAgentConversationPayload(payload: unknown): SaveAgentConversationPayload {
  const record = requireRecord(payload)
  const runId = optionalStreamId(record.runId)
  const courseName = optionalString(record.courseName)
  const expectedBranchRevision = optionalNonNegativeInteger(record.expectedBranchRevision, 'expectedBranchRevision')
  return {
    workspaceId: requireSafeId(record.workspaceId, 'workspaceId'),
    ...(runId ? { runId } : {}),
    mode: record.mode === 'teaching' ? 'teaching' : record.mode === 'temporary' ? 'temporary' : undefined,
    conversationId: optionalCanonicalConversationId(record.conversationId) ?? null,
    ...(expectedBranchRevision !== undefined ? { expectedBranchRevision } : {}),
    selectedLessonPath:
      typeof record.selectedLessonPath === 'string'
        ? record.selectedLessonPath
        : record.selectedLessonPath === null
          ? null
          : undefined,
    selectedCourseRelativePath:
      typeof record.selectedCourseRelativePath === 'string'
        ? record.selectedCourseRelativePath
        : record.selectedCourseRelativePath === null
          ? null
          : undefined,
    ...(courseName ? { courseName } : {}),
    turns: parseSavedAgentConversationTurns(record.turns)
  }
}

export function parseRenameAgentConversationPayload(payload: unknown): RenameAgentConversationPayload {
  const record = requireRecord(payload)
  const title = requireString(record.title, 'title').trim()
  if (!title || title.length > 160) {
    throw new Error('IPC payload field "title" must contain 1 to 160 characters.')
  }
  const reference = parseAgentConversationBranchReference(record)
  const expectedRevision = optionalNonNegativeInteger(record.expectedRevision, 'expectedRevision')
  return {
    ...reference,
    title,
    ...(expectedRevision !== undefined ? { expectedRevision } : {})
  }
}

export function parseReadAgentConversationPayload(payload: unknown): ReadAgentConversationPayload {
  const record = requireRecord(payload)
  return parseAgentConversationBranchReference(record)
}

export function parseProjectAgentConversationSummariesPayload(
  payload: unknown
): ProjectAgentConversationSummariesPayload {
  const record = requireRecord(payload)
  if (Object.keys(record).length !== 2 || !Object.prototype.hasOwnProperty.call(record, 'workspaceId') || !Object.prototype.hasOwnProperty.call(record, 'conversationIds')) {
    throw new Error('IPC projection payload may contain only "workspaceId" and "conversationIds".')
  }
  const ids = record.conversationIds
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
    throw new Error('IPC payload field "conversationIds" must contain 1 to 100 canonical conversation ids.')
  }
  const conversationIds = ids.map((value) => requireCanonicalConversationId(value))
  if (new Set(conversationIds).size !== conversationIds.length) {
    throw new Error('IPC payload field "conversationIds" must not contain duplicate ids.')
  }
  return {
    workspaceId: requireSafeId(record.workspaceId, 'workspaceId'),
    conversationIds
  }
}

export function parseReadAgentConversationSessionTreePayload(
  payload: unknown
): ReadAgentConversationSessionTreePayload {
  return parseAgentConversationBranchReference(requireRecord(payload))
}

export function parseOpenAgentConversationBranchPayload(payload: unknown): OpenAgentConversationBranchPayload {
  return parseAgentConversationBranchReference(requireRecord(payload))
}

export function parseForkAgentConversationBranchPayload(payload: unknown): ForkAgentConversationBranchPayload {
  const record = requireRecord(payload)
  const branch = parseAgentConversationBranchReference(record)
  const sourceTurnId = optionalSafeId(record.sourceTurnId, 'sourceTurnId', 240)
  const title = optionalBoundedTrimmedString(record.title, 'title', 240)
  const expectedRevision = requireNonNegativeInteger(record.expectedRevision, 'expectedRevision')
  return {
    ...branch,
    ...(sourceTurnId ? { sourceTurnId } : {}),
    ...(title ? { title } : {}),
    expectedRevision
  }
}

export function parseReplayAgentConversationBranchPayload(payload: unknown): ReplayAgentConversationBranchPayload {
  const record = requireRecord(payload)
  const sourceTurnId = optionalSafeId(record.sourceTurnId, 'sourceTurnId', 240)
  return {
    ...parseAgentConversationBranchReference(record),
    ...(sourceTurnId ? { sourceTurnId } : {})
  }
}

export function parseUpdateAgentConversationBranchStatusPayload(
  payload: unknown
): UpdateAgentConversationBranchStatusPayload {
  const record = requireRecord(payload)
  const branch = parseAgentConversationBranchReference(record)
  const status = requireAgentConversationBranchStatus(record.status)
  const expectedRevision = requireNonNegativeInteger(record.expectedRevision, 'expectedRevision')
  return {
    ...branch,
    status,
    expectedRevision
  }
}

export function parseCreateAgentConversationCheckpointPayload(payload: unknown): CreateAgentConversationCheckpointPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    conversationId: requireString(record.conversationId, 'conversationId'),
    label: optionalBoundedString(record.label, 240),
    reason: optionalBoundedString(record.reason, 2_000)
  }
}

export function parseResolveAgentConversationCheckpointPayload(payload: unknown): ResolveAgentConversationCheckpointPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    conversationId: requireString(record.conversationId, 'conversationId'),
    checkpointId: requireString(record.checkpointId, 'checkpointId')
  }
}

export function parseRestoreAgentWriteRewindPayload(payload: unknown): RestoreAgentWriteRewindPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    runId: requireString(record.runId, 'runId')
  }
}

export function parseListAgentWriteRewindJournalPayload(payload: unknown): ListAgentWriteRewindJournalPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    runId: requireString(record.runId, 'runId')
  }
}

export function parseQueryAgentArchivedHistoryPayload(payload: unknown): QueryAgentArchivedHistoryPayload {
  const record = requireRecord(payload)
  const types = Array.isArray(record.types)
    ? record.types.map((value): AgentArchivedHistoryItemType => {
        if (value === 'conversation_turn' || value === 'session_sidecar' || value === 'tool_result' ||
          value === 'child_transcript' || value === 'checkpoint') return value
        throw new Error('IPC payload field "types" contains an invalid archived history item type.')
      })
    : undefined
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    scope: requireAgentConversationStorageScope(record.scope),
    conversationId: optionalString(record.conversationId),
    from: optionalIsoDate(record.from, 'from'),
    to: optionalIsoDate(record.to, 'to'),
    types: types?.length ? types : undefined,
    checkpointId: optionalString(record.checkpointId),
    limit: optionalPositiveInteger(record.limit, 1, 500),
    maxBytes: optionalPositiveInteger(record.maxBytes, 1_024, 2 * 1024 * 1024),
    maxExcerptBytes: optionalPositiveInteger(record.maxExcerptBytes, 64, 8 * 1024)
  }
}

export function parseRebuildAgentHistoryIndexPayload(payload: unknown): RebuildAgentHistoryIndexPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    scope: requireAgentConversationStorageScope(record.scope)
  }
}

function parseSavedAgentConversationTurns(value: unknown): AgentChatTurn[] {
  if (!Array.isArray(value)) throw new Error('IPC payload field "turns" must be an array.')
  if (value.length > MAX_SAVED_CONVERSATION_TURNS) {
    throw new Error(`IPC payload field "turns" must contain at most ${MAX_SAVED_CONVERSATION_TURNS} turns.`)
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('IPC payload field "turns" must be JSON serializable.')
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SAVED_CONVERSATION_BYTES) {
    throw new Error(`IPC payload field "turns" exceeds ${MAX_SAVED_CONVERSATION_BYTES} bytes.`)
  }

  const ids = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`IPC payload turn ${index} must be an object.`)
    }
    const turn = item as Record<string, unknown>
    const id = requireSafeTurnId(turn.id, `turns[${index}].id`)
    if (ids.has(id)) throw new Error(`IPC payload field "turns" contains duplicate turn id "${id}".`)
    ids.add(id)
    if (turn.role !== 'user' && turn.role !== 'assistant') {
      throw new Error(`IPC payload field "turns[${index}].role" must be user or assistant.`)
    }
    if (typeof turn.content !== 'string') {
      throw new Error(`IPC payload field "turns[${index}].content" must be a string.`)
    }
    if (Buffer.byteLength(turn.content, 'utf8') > MAX_SAVED_TURN_CONTENT_BYTES) {
      throw new Error(`IPC payload field "turns[${index}].content" is too large.`)
    }
    if (typeof turn.createdAt !== 'string' || Number.isNaN(Date.parse(turn.createdAt))) {
      throw new Error(`IPC payload field "turns[${index}].createdAt" must be an ISO date.`)
    }
    validateSavedTurnProvenance(turn.metadata, index)
    return item as AgentChatTurn
  })
}

function validateSavedTurnProvenance(metadata: unknown, turnIndex: number): void {
  if (metadata === undefined) return
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`IPC payload field "turns[${turnIndex}].metadata" must be an object.`)
  }
  const provenance = (metadata as Record<string, unknown>).provenance
  if (provenance === undefined) return
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error(`IPC payload field "turns[${turnIndex}].metadata.provenance" is invalid.`)
  }
  const record = provenance as Record<string, unknown>
  const allowedKeys = new Set(['kind', 'sourceConversationId', 'sourceBranchId', 'sourceTurnId', 'replayId'])
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new Error(`IPC payload field "turns[${turnIndex}].metadata.provenance" contains unsupported fields.`)
  }
  const kind = record.kind
  if (kind !== 'original' && kind !== 'replayed' && kind !== 'recovery_notice') {
    throw new Error(`IPC payload field "turns[${turnIndex}].metadata.provenance.kind" is invalid.`)
  }
  const sourceConversationId = optionalExactSafeId(record.sourceConversationId, SAFE_LINEAGE_ID)
  const sourceBranchId = optionalExactSafeId(record.sourceBranchId, SAFE_LINEAGE_ID)
  const sourceTurnId = optionalExactSafeId(record.sourceTurnId, SAFE_TURN_ID)
  const replayId = optionalExactSafeId(record.replayId, SAFE_LINEAGE_ID)
  if (kind === 'original' && (sourceConversationId || sourceBranchId || sourceTurnId || replayId)) {
    throw new Error('Original conversation turns cannot claim replay provenance.')
  }
  if (kind === 'replayed' && !(sourceConversationId && sourceBranchId && sourceTurnId && replayId)) {
    throw new Error('Replayed conversation turns require complete source provenance.')
  }
  if (kind === 'recovery_notice' && (sourceBranchId || sourceTurnId || replayId)) {
    throw new Error('Recovery notices cannot claim replay provenance.')
  }
}

function optionalExactSafeId(value: unknown, pattern: RegExp): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value !== value.trim() || !pattern.test(value)) {
    throw new Error('Conversation turn provenance contains an invalid id.')
  }
  return value
}

function requireSafeTurnId(value: unknown, key: string): string {
  const id = requireString(value, key)
  if (id !== id.trim() || !SAFE_TURN_ID.test(id)) {
    throw new Error(`IPC payload field "${key}" must be a safe turn id.`)
  }
  return id
}

function requireAgentConversationLookupScope(value: unknown): 'workspace' | 'temporary' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'workspace' || value === 'temporary') return value
  throw new Error('IPC payload field "scope" must be workspace or temporary.')
}

function parseAgentConversationBranchReference(record: Record<string, unknown>): {
  workspaceId: string
  conversationId: string
  scope?: 'workspace' | 'temporary'
} {
  const scope = requireAgentConversationLookupScope(record.scope)
  return {
    workspaceId: requireSafeId(record.workspaceId, 'workspaceId'),
    conversationId: requireCanonicalConversationId(record.conversationId),
    ...(scope ? { scope } : {})
  }
}

function requireAgentConversationBranchStatus(value: unknown): 'active' | 'archived' | 'deleted' {
  if (value === 'active' || value === 'archived' || value === 'deleted') return value
  throw new Error('IPC payload field "status" must be active, archived, or deleted.')
}

function requireAgentConversationStorageScope(value: unknown): 'workspace' | 'temporary' | 'all' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'workspace' || value === 'temporary' || value === 'all') return value
  throw new Error('IPC payload field "scope" must be workspace, temporary, or all.')
}
