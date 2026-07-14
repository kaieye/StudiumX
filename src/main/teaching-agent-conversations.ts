import { mkdir, readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
import {
  agentConversationCourseJsonScanDirectories,
  agentConversationJsonScanDirectories,
  agentConversationMarkdownRelativePath,
  isAgentConversationMarkdownRelativePath
} from '../shared/agent-conversation-catalog'
import {
  hydrateAgentConversationArtifacts,
  readAgentConversationChildTranscriptArtifact,
  type AgentStagedChildTranscriptAllowance
} from './agent-conversation-session-audit'
import { saveAgentConversationArchive } from './agent-conversation-archive'
import type {
  AgentArtifactRef,
  AgentChildRunMetadata,
  AgentChatProcessEvent,
  AgentChatTurn,
  AgentCompactionMetadata,
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
  const id = requireSafeAgentConversationId(conversationId)
  const jsonRelativePath = await findAgentConversationJsonRelativePath(rootPath, id)
  return readAgentConversationRecordAt(rootPath, jsonRelativePath, { hydrateArtifacts: true })
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
      content: typeof record.content === 'string' ? record.content : '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      processEvents: processEvents && processEvents.length > 0 ? processEvents : undefined,
      metadata,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now
    })
  }
  return normalized
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
    pinned: Boolean(pathMeta[record.relativePath]?.pinned)
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
  const id = requireSafeAgentConversationId(basename(normalizedJsonRelativePath).replace(/\.json$/i, ''))
  const jsonPath = join(rootPath, jsonRelativePath)
  if (!isPathInsideRoot(rootPath, jsonPath)) throw new Error('Conversation path is outside the workspace.')
  const parsed = safeJsonParse(await readFile(jsonPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('Conversation record is invalid.')
  const record = parsed as Record<string, unknown>
  const turns = normalizeAgentConversationTurns(record.turns)
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt
  const title = cleanText(record.title) || deriveConversationTitle(turns, createdAt)
  const storedMarkdownRelativePath = typeof record.relativePath === 'string'
    ? normalizeWorkspaceRelativePath(record.relativePath)
    : ''
  const conversationDir = dirname(normalizedJsonRelativePath).replace(/\\/g, '/')
  const relativePath = isAgentConversationMarkdownRelativePath(storedMarkdownRelativePath)
    ? storedMarkdownRelativePath
    : agentConversationMarkdownRelativePath(id, conversationDir)
  const conversationRecord: AgentConversationRecord = {
    id,
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : undefined,
    title,
    createdAt,
    updatedAt,
    relativePath,
    absolutePath: join(rootPath, relativePath),
    messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
    turns
  }
  return options.hydrateArtifacts
    ? hydrateAgentConversationArtifacts({ rootPath, record: conversationRecord })
    : conversationRecord
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
  const metadata: AgentTurnMetadata = {
    version: 1,
    sources: sources.length > 0 ? sources : undefined,
    childRuns: childRuns.length > 0 ? childRuns : undefined,
    compactions: compactions.length > 0 ? compactions : undefined,
    contextHygiene: contextHygiene.length > 0 ? contextHygiene : undefined,
    contextEstimate,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    runUsage
  }
  return metadata.sources ||
    metadata.childRuns ||
    metadata.compactions ||
    metadata.contextHygiene ||
    metadata.contextEstimate ||
    metadata.toolResults ||
    metadata.runUsage
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
    const entries = await readdir(join(rootPath, directory), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && isAgentConversationRecordFileName(entry.name)) {
        result.push(workspaceRelativePath(directory, entry.name))
      }
    }
  }
  if (!includeCourses) return result
  const courseEntries = await readdir(join(rootPath, 'courses'), { withFileTypes: true }).catch(() => [])
  for (const courseEntry of courseEntries) {
    if (!courseEntry.isDirectory()) continue
    for (const directory of agentConversationCourseJsonScanDirectories(courseEntry.name)) {
      const entries = await readdir(join(rootPath, directory), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isFile() && isAgentConversationRecordFileName(entry.name)) {
          result.push(workspaceRelativePath(directory, entry.name))
        }
      }
    }
  }
  return result
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
  return findAgentConversationJsonRelativePath(rootPath, id)
    .then(() => true)
    .catch(() => false)
}

async function findAgentConversationJsonRelativePath(rootPath: string, id: string): Promise<string> {
  const safeId = requireSafeAgentConversationId(id)
  const matches = (await collectAgentConversationJsonRelativePaths(rootPath))
    .filter((relativePath) => basename(relativePath).replace(/\.json$/i, '') === safeId)
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))
  const first = matches[0]
  if (!first) throw new Error('Conversation not found.')
  return first
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
