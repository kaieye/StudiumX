import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isPathInsideRoot } from './path-access'
import {
  cleanText,
  formatDate,
  isPathArchived,
  normalizeWorkspaceRelativePath,
  slugify,
  workspaceRelativePath,
  type WorkspacePathMeta
} from './teaching-workspace-paths'
import { requireSafeTeachingRelativePath } from '../shared/teaching-placement'
import {
  agentConversationCourseJsonScanDirectories,
  agentConversationJsonScanDirectories,
  agentConversationMarkdownRelativePath,
  describeAgentConversationPath,
  isAgentConversationMarkdownRelativePath
} from '../shared/agent-conversation-catalog'
import {
  hydrateAgentConversationArtifacts,
  readAgentConversationChildTranscriptArtifact,
  type AgentStagedChildTranscriptAllowance
} from './agent-conversation-session-audit'
import { saveAgentConversationArchive } from './agent-conversation-archive'
import { sanitizeAgentConversationTurns, sanitizeAgentTurnContent } from '../shared/agent-conversation-turns'
import type {
  AgentArtifactRef,
  AgentChildRunMetadata,
  AgentChatProcessEvent,
  AgentChatTurn,
  AgentCompactionMetadata,
  AgentConversationBranchMetadata,
  AgentConversationRecord,
  AgentConversationSummary,
  AgentContextEstimateMetadata,
  AgentContextHygieneMetadata,
  AgentSourceMetadata,
  AgentToolResultDiagnostic,
  AgentTurnMetadata,
  AgentRunUsageAggregate
} from '../shared/teaching-types'

export type AgentConversationWorkspace = {
  id: string
  name: string
  rootPath: string
}

const MAX_METADATA_ITEMS = 20
const MAX_METADATA_FILES = 40
const MAX_TEXT = 2000
const MAX_SHORT_TEXT = 240
const MAX_SNIPPET_TEXT = 500

type AgentChildRunWithArchive = AgentChildRunMetadata & {
  archive?: AgentArtifactRef
}

export type AgentConversationChildTranscript = {
  childRunId: string
  archive: AgentArtifactRef
  content: string
}

export async function listAgentConversations(
  rootPath: string,
  pathMeta: Record<string, WorkspacePathMeta> = {},
  options: {
    includeRoot?: boolean
    includeRootConversation?: boolean
    includeLegacyRootConversations?: boolean
    includeLessons?: boolean
    includeCourses?: boolean
    fallbackWorkspaceId?: string
  } = {}
): Promise<AgentConversationSummary[]> {
  const jsonRelativePaths = await collectAgentConversationJsonRelativePaths(rootPath, options)
  const records = await Promise.all(
    jsonRelativePaths.map((relativePath) => readAgentConversationRecordAt(rootPath, relativePath).catch(() => null))
  )
  return sortAgentConversationSummaries(records
    .filter((record): record is AgentConversationRecord => Boolean(record))
    .filter((record) => record.branch?.status !== 'deleted')
    .map((record) => toAgentConversationSummary(record, pathMeta, options.fallbackWorkspaceId))
    .filter((summary) => !isPathArchived(pathMeta, summary.relativePath))
  )
}

export async function nextAgentConversationId(
  rootPath: string,
  title: string,
  timestamp: string
): Promise<string> {
  const base = `chat-${formatConversationTimestamp(new Date(timestamp))}-${slugify(title, 'conversation')}`.slice(0, 96)
  let id = requireSafeAgentConversationId(base)
  let suffix = 2
  while (await agentConversationIdExists(rootPath, id)) {
    id = requireSafeAgentConversationId(`${base.slice(0, 88)}-${suffix}`)
    suffix += 1
  }
  return id
}

export async function readAgentConversationRecord(
  rootPath: string,
  conversationId: string
): Promise<AgentConversationRecord> {
  const id = requireCanonicalAgentConversationId(conversationId)
  const jsonRelativePath = await findAgentConversationJsonRelativePath(rootPath, id)
  return readAgentConversationRecordAt(rootPath, jsonRelativePath, { hydrateArtifacts: true })
}

/** Reads persisted conversation facts without hydrating archived tool results. */
export async function readRawAgentConversationRecord(
  rootPath: string,
  conversationId: string
): Promise<AgentConversationRecord> {
  const id = requireCanonicalAgentConversationId(conversationId)
  const jsonRelativePath = await findAgentConversationJsonRelativePath(rootPath, id)
  return readAgentConversationRecordAt(rootPath, jsonRelativePath, { hydrateArtifacts: false })
}

export type PersistedAgentConversationRecord = {
  jsonRelativePath: string
  record: AgentConversationRecord
}

/** Enumerates canonical persisted records for rebuild-only consumers such as the history index. */
export async function listPersistedAgentConversationRecords(
  rootPath: string
): Promise<PersistedAgentConversationRecord[]> {
  const relativePaths = await collectAgentConversationJsonRelativePaths(rootPath)
  return Promise.all(relativePaths.map(async (jsonRelativePath) => ({
    jsonRelativePath,
    record: await readAgentConversationRecordAt(rootPath, jsonRelativePath, { hydrateArtifacts: false })
  })))
}

/**
 * Controlled child transcript lookup. The caller supplies a conversation id and
 * childRunId, never an artifact path; the stored reference is scope- and
 * integrity-checked by the archive layer before its content is returned.
 */
export async function readAgentConversationChildTranscript(
  rootPath: string,
  conversationId: string,
  childRunId: string
): Promise<AgentConversationChildTranscript> {
  const requestedChildRunId = requireSafeAgentConversationChildRunId(childRunId)
  const record = await readAgentConversationRecord(rootPath, conversationId)
  const childRun = record.turns
    .flatMap((turn) => turn.metadata?.childRuns ?? [])
    .find((child) => child.childRunId === requestedChildRunId) as AgentChildRunWithArchive | undefined
  const archive = childRun?.archive
  if (!archive || archive.kind !== 'child_transcript') {
    throw new Error('Child transcript is not archived for this conversation.')
  }
  const content = await readAgentConversationChildTranscriptArtifact({
    rootPath,
    conversationRelativePath: record.relativePath,
    artifact: archive
  })
  return { childRunId: requestedChildRunId, archive, content }
}

export async function writeAgentConversationRecord(
  workspace: AgentConversationWorkspace,
  record: AgentConversationRecord,
  options: { allowedStagedChildTranscripts?: readonly AgentStagedChildTranscriptAllowance[] } = {}
): Promise<void> {
  await saveAgentConversationArchive({
    workspace,
    record,
    allowedStagedChildTranscripts: options.allowedStagedChildTranscripts
  })
}

export function agentParentTurnDigest(turns: readonly AgentChatTurn[]): string {
  const assistantIndex = turns.findLastIndex((turn) => turn.role === 'assistant')
  const assistant = assistantIndex >= 0 ? turns[assistantIndex] : null
  const user = assistantIndex >= 0
    ? turns.slice(0, assistantIndex).findLast((turn) => turn.role === 'user')
    : null
  if (!user || !assistant) throw new Error('A parent turn digest requires a user turn followed by an assistant turn.')
  const projection = {
    user: { id: user.id, content: user.content, createdAt: user.createdAt },
    assistant: { id: assistant.id, content: assistant.content, createdAt: assistant.createdAt }
  }
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex')
}

export function attachAgentParentTurnCommit(
  turns: readonly AgentChatTurn[],
  runId: string,
  digest: string
): AgentChatTurn[] {
  const assistantIndex = turns.findLastIndex((turn) => turn.role === 'assistant')
  if (assistantIndex < 0) throw new Error('A saved parent turn requires an assistant turn.')
  return turns.map((turn, index) => index === assistantIndex
    ? {
        ...turn,
        metadata: {
          ...(turn.metadata ?? { version: 1 as const }),
          version: 1,
          runId,
          parentTurnDigest: digest
        }
      }
    : turn)
}

export function hasAgentParentTurnCommit(
  turns: readonly AgentChatTurn[],
  runId: string,
  digest: string
): boolean {
  return turns.some((turn, index) => turn.role === 'assistant' &&
    turn.metadata?.runId === runId &&
    turn.metadata.parentTurnDigest === digest &&
    agentParentTurnDigest(turns.slice(0, index + 1)) === digest)
}

export function normalizeAgentConversationTurns(turns: unknown): AgentChatTurn[] {
  if (!Array.isArray(turns)) return []
  const now = new Date().toISOString()
  const normalized: AgentChatTurn[] = []
  for (const [index, item] of turns.entries()) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null
    if (!role) continue
    const toolCalls = Array.isArray(record.toolCalls)
      ? record.toolCalls.map((raw, toolIndex) => {
          const tool = (raw ?? {}) as Record<string, unknown>
          return {
            id: typeof tool.id === 'string' && tool.id ? tool.id : `tool-${index}-${toolIndex}`,
            name: typeof tool.name === 'string' ? tool.name : '',
            arguments: typeof tool.arguments === 'string' ? tool.arguments : '',
            result: typeof tool.result === 'string' ? tool.result : undefined,
            isError: tool.isError === true
          }
        })
      : undefined
    const processEvents: AgentChatProcessEvent[] | undefined = Array.isArray(record.processEvents)
      ? record.processEvents
          .filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object')
          .map((event, eventIndex): AgentChatProcessEvent => {
            const kind = normalizeAgentProcessEventKind(event.kind)
            return {
              id: typeof event.id === 'string' && event.id ? event.id : `event-${index}-${eventIndex}`,
              kind,
              title: typeof event.title === 'string' ? event.title : '',
              detail: typeof event.detail === 'string' ? event.detail : undefined,
              status: typeof event.status === 'string' ? event.status as NonNullable<AgentChatTurn['processEvents']>[number]['status'] : undefined,
              toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
              toolName: typeof event.toolName === 'string' ? event.toolName : undefined,
              isError: event.isError === true,
              createdAt: typeof event.createdAt === 'string' ? event.createdAt : now
            }
          })
      : undefined
    const metadata = normalizeAgentTurnMetadata(record.metadata)
    normalized.push({
      id: typeof record.id === 'string' && record.id ? record.id : `${role}-${index}`,
      role,
      content: sanitizeAgentTurnContent(typeof record.content === 'string' ? record.content : ''),
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      processEvents: processEvents && processEvents.length > 0 ? processEvents : undefined,
      metadata,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now
    })
  }
  return sanitizeAgentConversationTurns(normalized)
}

function normalizeAgentProcessEventKind(value: unknown): AgentChatProcessEvent['kind'] {
  switch (value) {
    case 'status':
    case 'tool_call':
    case 'tool_result':
    case 'permission_request':
    case 'permission_resolved':
    case 'elicitation_request':
    case 'elicitation_resolved':
    case 'child_run_queued':
    case 'child_run_started':
    case 'child_run_delta':
    case 'child_run_completed':
    case 'child_run_failed':
    case 'child_run_canceled':
    case 'compaction':
      return value
    default:
      return 'status'
  }
}

export function deriveConversationTitle(turns: AgentChatTurn[], timestamp: string): string {
  const firstUserContent = cleanText(turns.find((turn) => turn.role === 'user')?.content)
  if (firstUserContent) return firstUserContent.length > 48 ? `${firstUserContent.slice(0, 48)}...` : firstUserContent
  return `Conversation ${formatDate(new Date(timestamp))}`
}

export async function ensureTeachingContentDirectories(rootPath: string): Promise<void> {
  await Promise.all([
    mkdir(join(rootPath, 'lessons'), { recursive: true }),
    mkdir(join(rootPath, 'conversation'), { recursive: true })
  ])
}

export function requireSafeAgentConversationId(value: string): string {
  const id = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw new Error('Conversation id is invalid.')
  return id
}

export function requireCanonicalAgentConversationId(value: string): string {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error('Conversation id is invalid.')
  const canonical = requireSafeAgentConversationId(value)
  if (canonical !== value) throw new Error('Conversation id is not canonical.')
  return value
}

function requireSafeAgentConversationChildRunId(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > MAX_SHORT_TEXT || /[\\/\u0000\r\n]/.test(value)) {
    throw new Error('Child run id is invalid.')
  }
  return value
}

export function toAgentConversationSummary(
  record: AgentConversationRecord,
  pathMeta: Record<string, WorkspacePathMeta> = {},
  fallbackWorkspaceId?: string
): AgentConversationSummary {
  return {
    id: record.id,
    workspaceId: record.workspaceId ?? fallbackWorkspaceId,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    relativePath: record.relativePath,
    absolutePath: record.absolutePath,
    messageCount: record.messageCount,
    pinned: Boolean(pathMeta[record.relativePath]?.pinned),
    branch: record.branch
  }
}

export function sortAgentConversationSummaries(
  conversations: AgentConversationSummary[]
): AgentConversationSummary[] {
  return conversations.sort((left, right) => {
    const leftPinned = left.pinned ? 1 : 0
    const rightPinned = right.pinned ? 1 : 0
    if (leftPinned !== rightPinned) return rightPinned - leftPinned
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

async function readAgentConversationRecordAt(
  rootPath: string,
  jsonRelativePath: string,
  options: { hydrateArtifacts?: boolean } = {}
): Promise<AgentConversationRecord> {
  const normalizedJsonRelativePath = normalizeWorkspaceRelativePath(jsonRelativePath)
  const jsonPathInfo = describeAgentConversationPath(normalizedJsonRelativePath)
  if (!jsonPathInfo || jsonPathInfo.format !== 'json') throw new Error('Conversation JSON path is invalid.')
  const id = requireCanonicalAgentConversationId(jsonPathInfo.id)
  const jsonPath = join(rootPath, normalizedJsonRelativePath)
  if (!isPathInsideRoot(rootPath, jsonPath)) throw new Error('Conversation path is outside the workspace.')
  const parsed = safeJsonParse(await readFile(jsonPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('Conversation record is invalid.')
  const record = parsed as Record<string, unknown>
  if (record.id !== id) throw new Error('Conversation record id does not match its JSON basename.')
  const turns = normalizeAgentConversationTurns(record.turns)
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt
  const title = cleanText(record.title) || deriveConversationTitle(turns, createdAt)
  const storedMarkdownRelativePath = typeof record.relativePath === 'string'
    ? normalizeWorkspaceRelativePath(record.relativePath)
    : ''
  const conversationDir = dirname(normalizedJsonRelativePath).replace(/\\/g, '/')
  const storedPathInfo = storedMarkdownRelativePath
    ? describeAgentConversationPath(storedMarkdownRelativePath)
    : null
  if (storedMarkdownRelativePath && (
    record.relativePath !== storedMarkdownRelativePath ||
    !isAgentConversationMarkdownRelativePath(storedMarkdownRelativePath) ||
    storedPathInfo?.id !== id ||
    storedPathInfo.directoryRelativePath !== jsonPathInfo.directoryRelativePath
  )) {
    throw new Error('Conversation record relativePath is not bound to its JSON basename.')
  }
  const relativePath = storedMarkdownRelativePath || agentConversationMarkdownRelativePath(id, conversationDir)
  const conversationRecord: AgentConversationRecord = {
    id,
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : undefined,
    title,
    createdAt,
    updatedAt,
    relativePath,
    absolutePath: join(rootPath, relativePath),
    messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
    branch: normalizeAgentConversationBranchMetadata(record.branch, id),
    turns
  }
  return options.hydrateArtifacts
    ? hydrateAgentConversationArtifacts({ rootPath, record: conversationRecord })
    : conversationRecord
}


export function inferAgentConversationBranchMetadata(
  record: Pick<AgentConversationRecord, 'id' | 'branch'>
): AgentConversationBranchMetadata {
  return record.branch ?? {
    schemaVersion: 1,
    sessionId: requireSafeAgentConversationId(record.id),
    branchId: requireSafeAgentConversationId(record.id),
    revision: 0,
    status: 'active'
  }
}

function normalizeAgentConversationBranchMetadata(
  value: unknown,
  conversationId: string
): AgentConversationBranchMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) throw new Error('Conversation branch schema version is unsupported.')
  const sessionId = safeBranchIdentifier(record.sessionId)
  const branchId = safeBranchIdentifier(record.branchId)
  const revision = nonNegativeInteger(record.revision)
  const status = record.status === 'active' || record.status === 'archived' || record.status === 'deleted'
    ? record.status
    : null
  if (!sessionId || !branchId || revision === null || !status || branchId !== conversationId) {
    throw new Error('Conversation branch metadata is invalid.')
  }
  const parentBranchId = record.parentBranchId === undefined
    ? undefined
    : safeBranchIdentifier(record.parentBranchId) ?? undefined
  if (record.parentBranchId !== undefined && !parentBranchId) throw new Error('Conversation parent branch id is invalid.')
  const forkPoint = normalizeForkPoint(record.forkPoint)
  const replaySource = normalizeReplaySource(record.replaySource)
  if ((parentBranchId || forkPoint || replaySource) && !(parentBranchId && forkPoint && replaySource)) {
    throw new Error('Conversation branch lineage metadata is incomplete.')
  }
  return {
    schemaVersion: 1,
    sessionId,
    branchId,
    revision,
    status,
    parentBranchId,
    forkPoint,
    replaySource
  }
}

function normalizeForkPoint(value: unknown): AgentConversationBranchMetadata['forkPoint'] {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('Conversation fork point is invalid.')
  const record = value as Record<string, unknown>
  const sourceConversationId = safeBranchIdentifier(record.sourceConversationId)
  const sourceBranchId = safeBranchIdentifier(record.sourceBranchId)
  const sourceTurnId = record.sourceTurnId === undefined
    ? undefined
    : safeTurnIdentifier(record.sourceTurnId) ?? undefined
  const sourceTurnCount = nonNegativeInteger(record.sourceTurnCount)
  const sourceDigest = sha256Value(record.sourceDigest)
  if (!sourceConversationId || !sourceBranchId || sourceTurnCount === null || !sourceDigest ||
      (record.sourceTurnId !== undefined && !sourceTurnId)) {
    throw new Error('Conversation fork point is invalid.')
  }
  return { sourceConversationId, sourceBranchId, sourceTurnId, sourceTurnCount, sourceDigest }
}

function normalizeReplaySource(value: unknown): AgentConversationBranchMetadata['replaySource'] {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('Conversation replay source is invalid.')
  const record = value as Record<string, unknown>
  const replayId = safeBranchIdentifier(record.replayId)
  const sourceConversationId = safeBranchIdentifier(record.sourceConversationId)
  const sourceBranchId = safeBranchIdentifier(record.sourceBranchId)
  const sourceTurnCount = nonNegativeInteger(record.sourceTurnCount)
  const sourceDigest = sha256Value(record.sourceDigest)
  const createdAt = textValue(record.createdAt, MAX_SHORT_TEXT)
  if (!replayId || !sourceConversationId || !sourceBranchId || sourceTurnCount === null || !sourceDigest || !createdAt ||
      record.toolsReplayed !== false || record.archivedRetrievalPromoted !== false ||
      record.providerHistoryInjected !== false || record.memoryWritten !== false) {
    throw new Error('Conversation replay source is invalid.')
  }
  return {
    replayId, sourceConversationId, sourceBranchId, sourceTurnCount, sourceDigest, createdAt,
    toolsReplayed: false, archivedRetrievalPromoted: false, providerHistoryInjected: false, memoryWritten: false
  }
}

function normalizeAgentTurnProvenance(value: unknown): AgentTurnMetadata['provenance'] {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const kind = record.kind === 'original' || record.kind === 'replayed' || record.kind === 'recovery_notice'
    ? record.kind
    : null
  if (!kind) return undefined
  const sourceConversationId = record.sourceConversationId === undefined
    ? undefined
    : safeBranchIdentifier(record.sourceConversationId) ?? undefined
  const sourceBranchId = record.sourceBranchId === undefined
    ? undefined
    : safeBranchIdentifier(record.sourceBranchId) ?? undefined
  const sourceTurnId = record.sourceTurnId === undefined
    ? undefined
    : safeTurnIdentifier(record.sourceTurnId) ?? undefined
  const replayId = record.replayId === undefined
    ? undefined
    : safeBranchIdentifier(record.replayId) ?? undefined
  if ((record.sourceConversationId !== undefined && !sourceConversationId) ||
      (record.sourceBranchId !== undefined && !sourceBranchId) ||
      (record.sourceTurnId !== undefined && !sourceTurnId) ||
      (record.replayId !== undefined && !replayId)) return undefined
  return { kind, sourceConversationId, sourceBranchId, sourceTurnId, replayId }
}

function safeBranchIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : null
}

function safeTurnIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,240}$/.test(value) ? value : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function sha256Value(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
}

function normalizeAgentTurnMetadata(value: unknown): AgentTurnMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const sources = normalizeSources(record.sources)
  const childRuns = normalizeChildRuns(record.childRuns)
  const compactions = normalizeCompactions(record.compactions)
  const contextHygiene = normalizeContextHygiene(record.contextHygiene)
  const contextEstimate = normalizeContextEstimate(record.contextEstimate)
  const toolResults = normalizeToolResults(record.toolResults)
  const runUsage = normalizeRunUsage(record.runUsage)
  const runId = typeof record.runId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(record.runId) ? record.runId : undefined
  const parentTurnDigest = typeof record.parentTurnDigest === 'string' && /^[a-f0-9]{64}$/.test(record.parentTurnDigest)
    ? record.parentTurnDigest
    : undefined
  const provenance = normalizeAgentTurnProvenance(record.provenance)
  const metadata: AgentTurnMetadata = {
    version: 1,
    sources: sources.length > 0 ? sources : undefined,
    childRuns: childRuns.length > 0 ? childRuns : undefined,
    compactions: compactions.length > 0 ? compactions : undefined,
    contextHygiene: contextHygiene.length > 0 ? contextHygiene : undefined,
    contextEstimate,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    runUsage,
    runId,
    parentTurnDigest,
    provenance
  }
  return metadata.sources ||
    metadata.childRuns ||
    metadata.compactions ||
    metadata.contextHygiene ||
    metadata.contextEstimate ||
    metadata.toolResults ||
    metadata.runUsage ||
    metadata.runId ||
    metadata.parentTurnDigest ||
    metadata.provenance
    ? metadata
    : undefined
}

function normalizeSources(value: unknown): AgentSourceMetadata[] {
  if (!Array.isArray(value)) return []
  const out = new Map<string, AgentSourceMetadata>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const url = textValue(record.url, 2000)
    if (!url) continue
    const sourceId = textValue(record.sourceId, MAX_SHORT_TEXT) ?? sourceIdForUrl(url)
    if (out.has(sourceId)) continue
    out.set(sourceId, pruneUndefined({
      sourceId,
      url,
      title: textValue(record.title, MAX_SHORT_TEXT),
      snippet: textValue(record.snippet, MAX_SNIPPET_TEXT),
      provider: textValue(record.provider, MAX_SHORT_TEXT),
      retrievedAt: textValue(record.retrievedAt, MAX_SHORT_TEXT),
      publishedAt: textValue(record.publishedAt, MAX_SHORT_TEXT),
      toolCallId: textValue(record.toolCallId, MAX_SHORT_TEXT),
      toolName: textValue(record.toolName, MAX_SHORT_TEXT)
    }))
    if (out.size >= MAX_METADATA_ITEMS) break
  }
  return [...out.values()]
}

function normalizeChildRuns(value: unknown): AgentChildRunWithArchive[] {
  if (!Array.isArray(value)) return []
  const out: AgentChildRunWithArchive[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const childRunId = textValue(record.childRunId, MAX_SHORT_TEXT)
    if (!childRunId) continue
    out.push(pruneUndefined({
      childRunId,
      label: textValue(record.label, MAX_SHORT_TEXT) ?? childRunId,
      profile: textValue(record.profile, MAX_SHORT_TEXT) ?? 'read_only',
      status: normalizeChildRunStatus(record.status),
      summary: textValue(record.summary, MAX_TEXT),
      error: textValue(record.error, 1000),
      filesRead: normalizeStringArray(record.filesRead, MAX_METADATA_FILES, MAX_SHORT_TEXT),
      citations: normalizeCitations(record.citations),
      usage: normalizeChildUsage(record.usage),
      archive: normalizeChildTranscriptArchive(record.archive),
      startedAt: textValue(record.startedAt, MAX_SHORT_TEXT),
      completedAt: textValue(record.completedAt, MAX_SHORT_TEXT)
    }))
    if (out.length >= MAX_METADATA_ITEMS) break
  }
  return out
}

function normalizeCompactions(value: unknown): AgentCompactionMetadata[] {
  if (!Array.isArray(value)) return []
  const out: AgentCompactionMetadata[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const sourceDigest = textValue(record.sourceDigest, MAX_SHORT_TEXT)
    if (!sourceDigest) continue
    const id = textValue(record.id, MAX_SHORT_TEXT) ?? `compaction:${sourceDigest}`
    const createdAt = textValue(record.createdAt, MAX_SHORT_TEXT) ?? '1970-01-01T00:00:00.000Z'
    out.push(pruneUndefined({
      id,
      createdAt,
      replacedTurnIds: normalizeStringArray(record.replacedTurnIds, MAX_METADATA_ITEMS, MAX_SHORT_TEXT) ?? [],
      sourceDigest,
      reason: textValue(record.reason, MAX_SHORT_TEXT) ?? 'unknown',
      mode: textValue(record.mode, MAX_SHORT_TEXT) ?? 'normal',
      beforeTokens: numberValue(record.beforeTokens),
      afterTokens: numberValue(record.afterTokens),
      replacedTokens: numberValue(record.replacedTokens),
      summaryTokens: numberValue(record.summaryTokens),
      replacedMessages: numberValue(record.replacedMessages),
      tailMessages: numberValue(record.tailMessages),
      cached: typeof record.cached === 'boolean' ? record.cached : undefined,
      failed: record.failed === true ? true : undefined,
      error: textValue(record.error, 1000)
    }))
    if (out.length >= MAX_METADATA_ITEMS) break
  }
  return out
}

function normalizeContextHygiene(value: unknown): AgentContextHygieneMetadata[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      return {
        changed: record.changed === true,
        savedTokens: numberValue(record.savedTokens) ?? 0,
        compactedToolResults: numberValue(record.compactedToolResults) ?? 0,
        digestedToolResults: numberValue(record.digestedToolResults) ?? 0,
        compactedToolCallArgs: numberValue(record.compactedToolCallArgs) ?? 0
      }
    })
    .filter((item): item is AgentContextHygieneMetadata => Boolean(item))
    .slice(0, MAX_METADATA_ITEMS)
}

function normalizeContextEstimate(value: unknown): AgentContextEstimateMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const totalTokens = numberValue(record.totalTokens)
  if (totalTokens === undefined) return undefined
  return {
    messageTokens: numberValue(record.messageTokens) ?? 0,
    overheadTokens: numberValue(record.overheadTokens) ?? 0,
    totalTokens,
    source: textValue(record.source, MAX_SHORT_TEXT) ?? 'local'
  }
}

function normalizeToolResults(value: unknown): AgentToolResultDiagnostic[] {
  if (!Array.isArray(value)) return []
  const out: AgentToolResultDiagnostic[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const toolCallId = textValue(record.toolCallId, MAX_SHORT_TEXT)
    const toolName = textValue(record.toolName, MAX_SHORT_TEXT)
    const bytes = numberValue(record.bytes)
    const lines = numberValue(record.lines)
    if (!toolCallId || !toolName || bytes === undefined || lines === undefined) continue
    out.push(pruneUndefined({
      toolCallId,
      toolName,
      bytes,
      lines,
      approxTokens: numberValue(record.approxTokens),
      isError: record.isError === true ? true : undefined,
      archive: normalizeToolResultArchive(record.archive)
    }))
    if (out.length >= MAX_METADATA_ITEMS) break
  }
  return out
}

function normalizeToolResultArchive(value: unknown): AgentArtifactRef | undefined {
  const artifact = normalizeArtifactRef(value)
  return artifact?.kind === 'tool_result' ? artifact : undefined
}

function normalizeChildTranscriptArchive(value: unknown): AgentArtifactRef | undefined {
  const artifact = normalizeArtifactRef(value)
  return artifact?.kind === 'child_transcript' ? artifact : undefined
}

function normalizeArtifactRef(value: unknown): AgentArtifactRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const kind = record.kind === 'tool_result' || record.kind === 'child_transcript' ? record.kind : null
  const relativePath = textValue(record.relativePath, 2000)
  const sha256 = textValue(record.sha256, MAX_SHORT_TEXT)
  const bytes = numberValue(record.bytes)
  if (!kind || !relativePath || !sha256 || bytes === undefined) return undefined
  const artifact: AgentArtifactRef = {
    kind,
    relativePath,
    sha256,
    bytes,
    lines: numberValue(record.lines),
    preview: textValue(record.preview, MAX_SNIPPET_TEXT),
    archivedAt: textValue(record.archivedAt, MAX_SHORT_TEXT)
  }
  return pruneUndefined(artifact)
}

function normalizeChildRunStatus(value: unknown): AgentChildRunMetadata['status'] {
  return value === 'queued' ||
    value === 'running' ||
    value === 'failed' ||
    value === 'canceled' ||
    value === 'completed'
    ? value
    : 'completed'
}

function normalizeChildUsage(value: unknown): AgentChildRunMetadata['usage'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const toolCalls = numberValue(record.toolCalls)
  const usage = pruneUndefined({
    providerCalls: numberValue(record.providerCalls),
    toolCalls: toolCalls ?? 0,
    promptTokens: numberValue(record.promptTokens),
    completionTokens: numberValue(record.completionTokens),
    totalTokens: numberValue(record.totalTokens)
  })
  return usage.toolCalls > 0 ||
    usage.providerCalls !== undefined ||
    usage.promptTokens !== undefined ||
    usage.completionTokens !== undefined ||
    usage.totalTokens !== undefined
    ? usage
    : undefined
}

function normalizeRunUsage(value: unknown): AgentRunUsageAggregate | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const providerCalls = numberValue(record.providerCalls)
  const toolCalls = numberValue(record.toolCalls)
  if (providerCalls === undefined || toolCalls === undefined) return undefined
  const budgetStopReason: AgentRunUsageAggregate['budgetStopReason'] = record.budgetStopReason === 'duration' ||
    record.budgetStopReason === 'provider_calls' ||
    record.budgetStopReason === 'tool_calls' ||
    record.budgetStopReason === 'total_tokens'
    ? record.budgetStopReason
    : undefined
  return pruneUndefined({
    providerCalls,
    toolCalls,
    toolErrors: numberValue(record.toolErrors) ?? 0,
    iterations: numberValue(record.iterations) ?? 0,
    childRuns: numberValue(record.childRuns) ?? 0,
    durationMs: numberValue(record.durationMs) ?? 0,
    promptTokens: numberValue(record.promptTokens),
    completionTokens: numberValue(record.completionTokens),
    totalTokens: numberValue(record.totalTokens),
    budgetStopReason
  })
}

function normalizeCitations(value: unknown): AgentChildRunMetadata['citations'] | undefined {
  if (!Array.isArray(value)) return undefined
  const citations = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const url = textValue(record.url, 2000)
      if (!url) return null
      return pruneUndefined({
        sourceId: textValue(record.sourceId, MAX_SHORT_TEXT) ?? sourceIdForUrl(url),
        url,
        title: textValue(record.title, MAX_SHORT_TEXT)
      })
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, MAX_METADATA_ITEMS)
  return citations.length > 0 ? citations : undefined
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result = value
    .map((item) => textValue(item, maxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems)
  return result.length > 0 ? result : undefined
}


async function collectAgentConversationJsonRelativePaths(
  rootPath: string,
  options: {
    includeRoot?: boolean
    includeRootConversation?: boolean
    includeLegacyRootConversations?: boolean
    includeLessons?: boolean
    includeCourses?: boolean
  } = {}
): Promise<string[]> {
  const includeCourses = options.includeCourses ?? true
  const result: string[] = []
  for (const directory of agentConversationJsonScanDirectories(options)) {
    await collectAgentConversationJsonFilesInBaseDirectory(rootPath, directory, result)
  }
  if (includeCourses) {
    const courseEntries = await readAgentConversationDirectoryEntries(rootPath, 'courses')
    for (const courseEntry of courseEntries) {
      // Dirent#isDirectory is false for symlinks. Do not follow a course root
      // or recurse into an arbitrary entry name.
      if (!courseEntry.isDirectory() || !isSafeAgentConversationDirectoryEntryName(courseEntry.name)) continue
      for (const directory of agentConversationCourseJsonScanDirectories(courseEntry.name)) {
        await collectAgentConversationJsonFilesInBaseDirectory(rootPath, directory, result)
      }
    }
  }
  return assertUniqueAgentConversationIds(result)
}

/** Scans one base at exactly depth 0 (legacy) and depth 2 (UTC YYYY/MM). */
async function collectAgentConversationJsonFilesInBaseDirectory(
  rootPath: string,
  directory: string,
  out: string[]
): Promise<void> {
  const entries = await readAgentConversationDirectoryEntries(rootPath, directory)
  for (const entry of entries) {
    if (entry.isFile() && isAgentConversationRecordFileName(entry.name)) {
      out.push(workspaceRelativePath(directory, entry.name))
      continue
    }
    if (!entry.isDirectory() || !isAgentConversationUtcYear(entry.name)) continue
    const yearDirectory = workspaceRelativePath(directory, entry.name)
    const monthEntries = await readAgentConversationDirectoryEntries(rootPath, yearDirectory)
    for (const monthEntry of monthEntries) {
      if (!monthEntry.isDirectory() || !isAgentConversationUtcMonth(monthEntry.name)) continue
      const monthDirectory = workspaceRelativePath(yearDirectory, monthEntry.name)
      const files = await readAgentConversationDirectoryEntries(rootPath, monthDirectory)
      for (const file of files) {
        if (file.isFile() && isAgentConversationRecordFileName(file.name)) {
          out.push(workspaceRelativePath(monthDirectory, file.name))
        }
      }
    }
  }
}

/** Never follow symlinked bases, partitions, or files while discovering records. */
async function readAgentConversationDirectoryEntries(rootPath: string, relativePath: string) {
  const targetPath = join(rootPath, relativePath)
  if (!isPathInsideRoot(rootPath, targetPath)) return []
  const metadata = await lstat(targetPath).catch(() => null)
  if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()) return []
  return readdir(targetPath, { withFileTypes: true }).catch(() => [])
}

function assertUniqueAgentConversationIds(relativePaths: readonly string[]): string[] {
  const pathsById = new Map<string, string>()
  for (const relativePath of relativePaths) {
    const info = describeAgentConversationPath(relativePath)
    if (!info || info.format !== 'json') continue
    const existing = pathsById.get(info.id)
    if (existing && existing !== relativePath) {
      throw new Error(`Duplicate conversation id "${info.id}" is present at "${existing}" and "${relativePath}".`)
    }
    pathsById.set(info.id, relativePath)
  }
  return [...relativePaths].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'variant' }))
}

function isAgentConversationUtcYear(value: string): boolean {
  return /^\d{4}$/.test(value)
}

function isAgentConversationUtcMonth(value: string): boolean {
  return /^(0[1-9]|1[0-2])$/.test(value)
}

function isSafeAgentConversationDirectoryEntryName(value: string): boolean {
  try {
    return requireSafeTeachingRelativePath(value, 'Course folder') === value
  } catch {
    return false
  }
}

function isAgentConversationRecordFileName(fileName: string): boolean {
  if (!fileName.endsWith('.json')) return false
  const id = fileName.slice(0, -'.json'.length)
  try {
    return requireSafeAgentConversationId(id) === id
  } catch {
    return false
  }
}

async function agentConversationIdExists(rootPath: string, id: string): Promise<boolean> {
  const safeId = requireCanonicalAgentConversationId(id)
  return (await collectAgentConversationJsonRelativePaths(rootPath))
    .some((relativePath) => describeAgentConversationPath(relativePath)?.id === safeId)
}

async function findAgentConversationJsonRelativePath(rootPath: string, id: string): Promise<string> {
  const safeId = requireCanonicalAgentConversationId(id)
  const matches = (await collectAgentConversationJsonRelativePaths(rootPath))
    .filter((relativePath) => describeAgentConversationPath(relativePath)?.id === safeId)
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'variant' }))
  if (matches.length === 0) throw new Error('Conversation not found.')
  if (matches.length > 1) {
    throw new Error(`Conversation id "${safeId}" is ambiguous within this storage root.`)
  }
  return matches[0]
}

function formatConversationTimestamp(date: Date): string {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}-${pad(safeDate.getHours())}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`
}


function textValue(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined
}

function sourceIdForUrl(url: string): string {
  return `source-${stableHash(url)}`
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item
  }
  return out as T
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
