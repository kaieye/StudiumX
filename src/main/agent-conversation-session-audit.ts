import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  agentConversationChildTranscriptDirectoryRelativePathForMarkdown,
  agentConversationSessionArtifactDirectoryRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../shared/agent-conversation-catalog'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'
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
const TOOL_RESULT_PREVIEW_LENGTH = 1200
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
  allowedStagedChildTranscripts?: readonly AgentStagedChildTranscriptAllowance[]
}): Promise<AgentConversationRecord> {
  let changed = false
  const now = input.now ?? new Date().toISOString()
  const turns: AgentChatTurn[] = []
  for (const turn of input.record.turns) {
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

    const childTranscriptResult = await archiveChildRunTranscripts({
      rootPath: input.rootPath,
      conversationRelativePath: input.record.relativePath,
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
  return changed ? { ...input.record, turns } : input.record
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
    const redactedSource = redactSourceMetadata(source)
    entries.push({
      type: 'source',
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
      diagnostic: redactToolResultDiagnostic(diagnostic)
    })
  }
}

function agentConversationSessionAuditHeader(record: AgentConversationRecord): AgentConversationSessionAuditHeader {
  return pruneUndefined({
    type: 'session' as const,
    version: AGENT_CONVERSATION_SESSION_AUDIT_VERSION,
    id: record.id,
    workspaceId: record.workspaceId,
    title: redactAgentSecretText(record.title),
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

function redactAgentTurnPersistenceText(turn: AgentChatTurn): AgentChatTurn {
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
  if (!toolCallsChanged && !processEventsChanged && metadata === turn.metadata) return turn
  return {
    ...turn,
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
  const changed = Boolean(
    sources?.some((source, index) => source !== metadata.sources?.[index]) ||
    childRuns?.some((child, index) => child !== metadata.childRuns?.[index]) ||
    compactions?.some((compaction, index) => compaction !== metadata.compactions?.[index]) ||
    toolResults?.some((diagnostic, index) => diagnostic !== metadata.toolResults?.[index])
  )
  if (!changed) return metadata
  return {
    ...metadata,
    ...(sources === undefined ? {} : { sources }),
    ...(childRuns === undefined ? {} : { childRuns }),
    ...(compactions === undefined ? {} : { compactions }),
    ...(toolResults === undefined ? {} : { toolResults })
  }
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
