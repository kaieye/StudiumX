import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  agentConversationSessionArtifactDirectoryRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../shared/agent-conversation-catalog'
import { isPathInsideRoot } from './path-access'
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
const TOOL_RESULT_PREVIEW_LENGTH = 1200
const MAX_TOOL_RESULT_DIAGNOSTICS = 20

export type AgentConversationSessionAuditHeader = {
  type: 'session'
  version: 1
  id: string
  workspaceId?: string
  title: string
  createdAt: string
  conversationRelativePath: string
}

export type AgentConversationSessionAuditEntryBase = {
  type: string
  id: string
  parentId: string | null
  timestamp: string
  turnId?: string
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
}): Promise<AgentConversationRecord> {
  let changed = false
  const now = input.now ?? new Date().toISOString()
  const turns: AgentChatTurn[] = []
  for (const turn of input.record.turns) {
    let nextTurn = turn
    const toolCalls: AgentChatToolCallView[] = []
    let toolCallsChanged = false
    for (const tool of turn.toolCalls ?? []) {
      if (!shouldArchiveToolResult(tool.result)) {
        toolCalls.push(tool)
        continue
      }
      const result = tool.result ?? ''
      const artifact = await writeToolResultArtifact({
        rootPath: input.rootPath,
        conversationRelativePath: input.record.relativePath,
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
    turns.push(nextTurn)
  }
  return changed ? { ...input.record, turns } : input.record
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
      const content = await readArtifactContent(input.rootPath, artifact)
      if (content === null) return tool
      changed = true
      return { ...tool, result: content }
    }))
    return { ...turn, toolCalls }
  }))
  return changed ? { ...input.record, turns } : input.record
}

export async function appendAgentConversationSessionAuditLog(input: {
  rootPath: string
  record: AgentConversationRecord
}): Promise<string> {
  const relativePath = agentConversationSessionAuditRelativePathForMarkdown(input.record.relativePath)
  const absolutePath = join(input.rootPath, relativePath)
  const existing = parseAgentConversationSessionAuditLines(
    await readFile(absolutePath, 'utf8').catch(() => '')
  )
  const existingIds = new Set(
    existing
      .filter((line): line is AgentConversationSessionAuditEntry => line.type !== 'session')
      .map((line) => line.id)
  )
  const hasHeader = existing.some((line) => line.type === 'session')
  const nextLines: AgentConversationSessionAuditLine[] = []
  if (!hasHeader) nextLines.push(agentConversationSessionAuditHeader(input.record))
  for (const entry of buildAgentConversationSessionAuditEntries(input.record)) {
    if (existingIds.has(entry.id)) continue
    existingIds.add(entry.id)
    nextLines.push(entry)
  }
  if (nextLines.length > 0) {
    await mkdir(dirname(absolutePath), { recursive: true })
    await appendFile(absolutePath, `${nextLines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
  }
  return relativePath
}

export function buildAgentConversationSessionAuditEntries(
  record: AgentConversationRecord
): AgentConversationSessionAuditEntry[] {
  const entries: AgentConversationSessionAuditEntry[] = []
  let previousTurnEntryId: string | null = null
  for (const turn of record.turns) {
    const turnEntryId = auditEntryId('turn', turn.id)
    entries.push({
      type: 'turn',
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
    appendMetadataEntries(entries, turnEntryId, turn, record.updatedAt)
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
  fallbackTimestamp: string
): void {
  const timestamp = timestampValue(turn.createdAt, fallbackTimestamp)
  const metadata = turn.metadata
  if (!metadata) return
  for (const source of metadata.sources ?? []) {
    entries.push({
      type: 'source',
      id: auditEntryId('source', turn.id, source.sourceId || hashText(source.url)),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      source
    })
  }
  for (const childRun of metadata.childRuns ?? []) {
    entries.push({
      type: 'child_run',
      id: auditEntryId('child', turn.id, childRun.childRunId),
      parentId: turnEntryId,
      timestamp: timestampValue(childRun.completedAt ?? childRun.startedAt, timestamp),
      turnId: turn.id,
      childRun
    })
  }
  metadata.compactions?.forEach((compaction, index) => {
    entries.push({
      type: 'compaction',
      id: auditEntryId('compaction', turn.id, compaction.sourceDigest, String(index)),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      compaction
    })
  })
  metadata.contextHygiene?.forEach((contextHygiene, index) => {
    entries.push({
      type: 'context_hygiene',
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
      id: auditEntryId('tool-result', turn.id, diagnostic.toolCallId, diagnostic.toolName),
      parentId: turnEntryId,
      timestamp,
      turnId: turn.id,
      diagnostic
    })
  }
}

function agentConversationSessionAuditHeader(record: AgentConversationRecord): AgentConversationSessionAuditHeader {
  return pruneUndefined({
    type: 'session' as const,
    version: AGENT_CONVERSATION_SESSION_AUDIT_VERSION,
    id: record.id,
    workspaceId: record.workspaceId,
    title: record.title,
    createdAt: record.createdAt,
    conversationRelativePath: record.relativePath
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
  const sha256 = createHash('sha256').update(input.result).digest('hex')
  const baseDir = agentConversationSessionArtifactDirectoryRelativePathForMarkdown(input.conversationRelativePath)
  const fileName = `${safePathPart(input.turnId)}-${safePathPart(input.toolCallId)}-${sha256.slice(0, 16)}.txt`
  const relativePath = join(baseDir, 'tool-results', fileName).replace(/\\/g, '/')
  const absolutePath = join(input.rootPath, relativePath)
  if (!isPathInsideRoot(input.rootPath, absolutePath)) {
    throw new Error('Tool result artifact path is outside the workspace.')
  }
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, input.result, 'utf8')
  return {
    kind: 'tool_result',
    relativePath,
    sha256,
    bytes: byteLength(input.result),
    lines: lineCount(input.result),
    preview: compactText(input.result, TOOL_RESULT_PREVIEW_LENGTH),
    archivedAt: input.now
  }
}

async function readArtifactContent(rootPath: string, artifact: AgentArtifactRef): Promise<string | null> {
  if (artifact.kind !== 'tool_result') return null
  const absolutePath = join(rootPath, artifact.relativePath)
  if (!isPathInsideRoot(rootPath, absolutePath)) return null
  const content = await readFile(absolutePath, 'utf8').catch(() => null)
  if (content === null) return null
  const sha256 = createHash('sha256').update(content).digest('hex')
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
    artifact.preview ? `preview: ${artifact.preview}` : ''
  ].filter(Boolean).join('\n')
}

function isArchivedToolResultPlaceholder(value: string): boolean {
  return value.startsWith('[tool result archived]\n')
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
  const compact = value.replace(/\s+/g, ' ').trim()
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
