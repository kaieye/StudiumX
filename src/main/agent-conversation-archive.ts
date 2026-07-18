import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  agentConversationChildTranscriptDirectoryRelativePathForMarkdown,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionArtifactDirectoryRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown,
  describeAgentConversationPath,
  isAgentConversationMarkdownRelativePath
} from '../shared/agent-conversation-catalog'
import type {
  AgentArtifactRef,
  AgentConversationRecord,
  AgentTurnMetadata
} from '../shared/teaching-types'
import {
  appendAgentConversationSessionAuditLog,
  archiveAgentConversationArtifacts,
  buildAgentConversationSessionAuditEntries,
  parseAgentConversationSessionAuditLines,
  type AgentStagedChildTranscriptAllowance
} from './agent-conversation-session-audit'
import { isPathInsideRoot, readContainedRegularFile } from './path-access'
import { assertAgentConversationCheckpointPrefixesPreserved } from './agent-conversation-checkpoints'
import {
  appendLearningWorkLedgerSnapshot,
  buildLearningWorkLedgerEntry,
  LEARNING_WORK_LEDGER_RELATIVE_PATH,
  readLearningWorkLedgerLines
} from './learning-work-ledger'
import { normalizeWorkspaceRelativePath } from './teaching-workspace-paths'
import { sanitizePersistedAgentConversationRecord } from '../shared/agent-persisted-history'
import { normalizeTraceId, traceIdsMatchForIdempotency } from '../shared/trace-context'
import { replaceDurably, type DurableFileOperations } from './persistence/durable-file'

export type AgentConversationArchiveWorkspace = {
  id?: string
  name: string
  rootPath: string
}

const TOOL_ARTIFACT_DIRECTORY = 'tool-results'

type AgentChildRunWithArchive = NonNullable<AgentTurnMetadata['childRuns']>[number] & {
  archive?: AgentArtifactRef
}

/**
 * Durable archive module for one Agent conversation snapshot.
 *
 * Its interface is intentionally a single save operation. Placement validation,
 * artifact materialization, canonical projections, append-only records, retry
 * idempotency, and post-save integrity repair all stay behind this seam.
 */
export async function saveAgentConversationArchive(input: {
  workspace: AgentConversationArchiveWorkspace
  record: AgentConversationRecord
  allowedStagedChildTranscripts?: readonly AgentStagedChildTranscriptAllowance[]
  /** Legacy-fork compatibility: do not mutate a shared source ledger. */
  skipLearningWorkLedger?: boolean
  /** Runs after artifact promotion/proof rebinding and before canonical JSON is written. */
  beforeCanonicalSave?: (record: AgentConversationRecord) => Promise<void>
  /** Narrow main-internal test seam for the shared canonical file publisher. */
  durableFileOperations?: DurableFileOperations
  /** Receives only the shared primitive's generic directory-fsync warning. */
  durableWarn?: (message: string) => void
}): Promise<void> {
  // This is the durable boundary. Callers retain their raw record for run
  // confirmation; every archive sink below
  // receives only this sanitized projection.
  const record = sanitizePersistedAgentConversationRecord(input.record)
  const paths = resolveArchivePaths(input.workspace.rootPath, record.relativePath, record.id)
  assertArtifactKindsMatchMetadataPlacement(record)
  await assertAgentConversationCheckpointPrefixesPreserved({
    rootPath: input.workspace.rootPath,
    record
  })
  const persistedRecord = await archiveAgentConversationArtifacts({
    rootPath: input.workspace.rootPath,
    record,
    allowedStagedChildTranscripts: input.allowedStagedChildTranscripts
  })
  await preflightAgentConversationArchive({
    workspace: input.workspace,
    record: persistedRecord,
    paths
  })
  await input.beforeCanonicalSave?.(persistedRecord)
  const canonicalJson = renderCanonicalConversationJson(input.workspace, persistedRecord)
  const canonicalMarkdown = renderAgentConversationMarkdown(input.workspace, persistedRecord)

  const persistCanonicalArchive = async (): Promise<void> => {
    // Preserve the legacy writeFile create-mode contract (0666 subject to the
    // process umask) while publishing each canonical projection through the
    // shared file-and-directory durable-replace boundary. This remains two
    // ordered publishes, not a multi-file transaction.
    await replaceDurably({
      path: paths.json,
      content: canonicalJson,
      mode: 0o666,
      operations: input.durableFileOperations,
      warn: input.durableWarn
    })
    await replaceDurably({
      path: paths.markdown,
      content: canonicalMarkdown,
      mode: 0o666,
      operations: input.durableFileOperations,
      warn: input.durableWarn
    })
    await appendAgentConversationSessionAuditLog({ rootPath: input.workspace.rootPath, record: persistedRecord })
  }
  if (input.skipLearningWorkLedger) {
    await persistCanonicalArchive()
  } else {
    // The ledger serializes identity verification with this callback. A trace
    // collision therefore rejects before canonical files can be overwritten.
    await appendLearningWorkLedgerSnapshot({
      rootPath: input.workspace.rootPath,
      workspace: input.workspace,
      record: persistedRecord,
      beforeAppend: persistCanonicalArchive
    })
  }

  await verifyAgentConversationArchive({
    workspace: input.workspace,
    record: persistedRecord,
    paths,
    canonicalJson,
    canonicalMarkdown,
    skipLearningWorkLedger: input.skipLearningWorkLedger
  })
}

type ArchivePaths = {
  markdownRelativePath: string
  jsonRelativePath: string
  auditRelativePath: string
  artifactDirectoryRelativePath: string
  markdown: string
  json: string
  audit: string
  ledger: string
}

function resolveArchivePaths(rootPath: string, relativePath: string, conversationId: string): ArchivePaths {
  const markdownRelativePath = normalizeWorkspaceRelativePath(relativePath)
  const pathInfo = describeAgentConversationPath(markdownRelativePath)
  if (
    relativePath.replace(/\\/g, '/') !== markdownRelativePath ||
    !isAgentConversationMarkdownRelativePath(markdownRelativePath) ||
    pathInfo?.format !== 'markdown' ||
    pathInfo.id !== conversationId
  ) {
    throw new Error('Conversation markdown path is not canonically bound to its conversation id.')
  }
  const jsonRelativePath = agentConversationJsonRelativePathForMarkdown(markdownRelativePath)
  const auditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(markdownRelativePath)
  const artifactDirectoryRelativePath = agentConversationSessionArtifactDirectoryRelativePathForMarkdown(markdownRelativePath)
  const paths: ArchivePaths = {
    markdownRelativePath,
    jsonRelativePath,
    auditRelativePath,
    artifactDirectoryRelativePath,
    markdown: join(rootPath, markdownRelativePath),
    json: join(rootPath, jsonRelativePath),
    audit: join(rootPath, auditRelativePath),
    ledger: join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH)
  }
  for (const [name, path] of Object.entries(paths)) {
    if (name.endsWith('RelativePath')) continue
    if (!isPathInsideRoot(rootPath, path)) {
      throw new Error(`Conversation archive ${name} path is outside the workspace.`)
    }
  }
  return paths
}

function renderCanonicalConversationJson(
  workspace: AgentConversationArchiveWorkspace,
  record: AgentConversationRecord
): string {
  return `${JSON.stringify({
    version: record.branch ? 2 : 1,
    workspaceId: record.workspaceId ?? workspace.id,
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    relativePath: record.relativePath,
    traceId: normalizeTraceId(record.traceId),
    branch: record.branch,
    turns: record.turns
  }, null, 2)}\n`
}

async function preflightAgentConversationArchive(input: {
  workspace: AgentConversationArchiveWorkspace
  record: AgentConversationRecord
  paths: ArchivePaths
}): Promise<void> {
  if (
    normalizeWorkspaceRelativePath(input.record.relativePath) !== input.paths.markdownRelativePath ||
    describeAgentConversationPath(input.record.relativePath)?.id !== input.record.id ||
    (input.record.workspaceId ?? input.workspace.id) !== input.workspace.id
  ) {
    throw new Error('Conversation archive placement does not match its record.')
  }
  assertArtifactKindsMatchMetadataPlacement(input.record)
  await verifyArchivedToolArtifacts(
    input.workspace.rootPath,
    input.record,
    input.paths.artifactDirectoryRelativePath
  )
  await verifyArchivedChildTranscriptArtifacts(input.workspace.rootPath, input.record)
}

async function verifyAgentConversationArchive(input: {
  workspace: AgentConversationArchiveWorkspace
  record: AgentConversationRecord
  paths: ArchivePaths
  canonicalJson: string
  canonicalMarkdown: string
  skipLearningWorkLedger?: boolean
}): Promise<void> {
  const [json, markdown, audit, ledgerLines] = await Promise.all([
    readFile(input.paths.json, 'utf8'),
    readFile(input.paths.markdown, 'utf8'),
    readFile(input.paths.audit, 'utf8'),
    readLearningWorkLedgerLines(input.workspace.rootPath)
  ])
  if (json !== input.canonicalJson) throw new Error('Conversation archive JSON verification failed.')
  if (markdown !== input.canonicalMarkdown) throw new Error('Conversation archive Markdown verification failed.')

  const parsed = safeParseJson(json)
  if (!parsed || typeof parsed !== 'object') throw new Error('Conversation archive JSON is invalid.')
  const stored = parsed as Record<string, unknown>
  if (
    stored.id !== input.record.id ||
    typeof stored.relativePath !== 'string' ||
    normalizeWorkspaceRelativePath(stored.relativePath) !== input.paths.markdownRelativePath ||
    stored.workspaceId !== (input.record.workspaceId ?? input.workspace.id)
  ) {
    throw new Error('Conversation archive placement does not match its record.')
  }

  await verifyArchivedToolArtifacts(input.workspace.rootPath, input.record, input.paths.artifactDirectoryRelativePath)
  await verifyArchivedChildTranscriptArtifacts(input.workspace.rootPath, input.record)

  const auditLines = parseAgentConversationSessionAuditLines(audit)
  const auditIds = new Set(auditLines.map((line) => line.id))
  if (!auditLines.some((line) => line.type === 'session' && line.id === input.record.id)) {
    throw new Error('Conversation archive session audit header is missing.')
  }
  for (const entry of buildAgentConversationSessionAuditEntries(input.record)) {
    if (!auditIds.has(entry.id)) throw new Error('Conversation archive session audit is incomplete.')
  }

  if (input.skipLearningWorkLedger) return
  const expectedLedgerEntry = buildLearningWorkLedgerEntry(input.workspace, input.record)
  let hasLedgerEntry = false
  for (const line of ledgerLines) {
    const entry = safeParseJson(line)
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as {
      entryId?: unknown
      traceId?: unknown
      conversation?: { relativePath?: unknown; jsonRelativePath?: unknown; sessionAuditRelativePath?: unknown }
    }
    if (candidate.entryId !== expectedLedgerEntry.entryId) continue
    if (!traceIdsMatchForIdempotency(candidate.traceId, expectedLedgerEntry.traceId)) {
      throw new Error('Conversation archive learning-work ledger trace does not match its canonical record.')
    }
    if (
      candidate.conversation?.relativePath === input.paths.markdownRelativePath &&
      candidate.conversation?.jsonRelativePath === input.paths.jsonRelativePath &&
      candidate.conversation?.sessionAuditRelativePath === input.paths.auditRelativePath
    ) {
      hasLedgerEntry = true
    }
  }
  if (!hasLedgerEntry) throw new Error('Conversation archive learning-work ledger is incomplete.')
}

function assertArtifactKindsMatchMetadataPlacement(record: AgentConversationRecord): void {
  for (const turn of record.turns) {
    for (const childRun of turn.metadata?.childRuns ?? []) {
      const archive = (childRun as AgentChildRunWithArchive).archive
      if (archive && archive.kind !== 'child_transcript') {
        throw new Error('Conversation child run contains a non-transcript artifact reference.')
      }
    }
    for (const diagnostic of turn.metadata?.toolResults ?? []) {
      if (diagnostic.archive && diagnostic.archive.kind !== 'tool_result') {
        throw new Error('Conversation tool result contains a non-tool artifact reference.')
      }
    }
  }
}

async function verifyArchivedToolArtifacts(
  rootPath: string,
  record: AgentConversationRecord,
  artifactDirectoryRelativePath: string
): Promise<void> {
  const expectedPrefix = `${artifactDirectoryRelativePath}/${TOOL_ARTIFACT_DIRECTORY}/`
  for (const artifact of collectToolResultArtifacts(record)) {
    const relativePath = normalizeWorkspaceRelativePath(artifact.relativePath)
    if (!isArtifactPathWithinDirectory(artifact.relativePath, expectedPrefix)) {
      throw new Error('Conversation tool artifact is outside its conversation archive.')
    }
    const absolutePath = join(rootPath, relativePath)
    if (!isPathInsideRoot(rootPath, absolutePath)) {
      throw new Error('Conversation tool artifact path is outside the workspace.')
    }
    const content = await readArchivedArtifact(rootPath, absolutePath, 'tool')
    if (content.byteLength !== artifact.bytes) {
      throw new Error('Conversation tool artifact byte count does not match.')
    }
    if (createHash('sha256').update(content).digest('hex') !== artifact.sha256) {
      throw new Error('Conversation tool artifact digest does not match.')
    }
  }
}

async function verifyArchivedChildTranscriptArtifacts(
  rootPath: string,
  record: AgentConversationRecord
): Promise<void> {
  const expectedPrefix = `${agentConversationChildTranscriptDirectoryRelativePathForMarkdown(record.relativePath)}/`
  for (const artifact of collectChildTranscriptArtifacts(record)) {
    const relativePath = normalizeWorkspaceRelativePath(artifact.relativePath)
    if (!isArtifactPathWithinDirectory(artifact.relativePath, expectedPrefix)) {
      throw new Error('Conversation child transcript artifact is outside its conversation archive.')
    }
    const absolutePath = join(rootPath, relativePath)
    if (!isPathInsideRoot(rootPath, absolutePath)) {
      throw new Error('Conversation child transcript artifact path is outside the workspace.')
    }
    const content = await readArchivedArtifact(rootPath, absolutePath, 'child transcript')
    if (content.byteLength !== artifact.bytes) {
      throw new Error('Conversation child transcript artifact byte count does not match.')
    }
    const text = content.toString('utf8')
    const lines = text ? text.split(/\r\n|\r|\n/).length : 0
    if (artifact.lines !== undefined && lines !== artifact.lines) {
      throw new Error('Conversation child transcript artifact line count does not match.')
    }
    if (createHash('sha256').update(content).digest('hex') !== artifact.sha256) {
      throw new Error('Conversation child transcript artifact digest does not match.')
    }
  }
}

async function readArchivedArtifact(
  rootPath: string,
  absolutePath: string,
  label: 'tool' | 'child transcript'
): Promise<Buffer> {
  try {
    return await readContainedRegularFile(rootPath, absolutePath)
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Conversation ${label} artifact is unavailable.${detail}`)
  }
}

function collectChildTranscriptArtifacts(record: AgentConversationRecord): AgentArtifactRef[] {
  const artifacts = new Map<string, AgentArtifactRef>()
  for (const turn of record.turns) {
    for (const childRun of turn.metadata?.childRuns ?? []) {
      const archive = (childRun as AgentChildRunWithArchive).archive
      if (archive?.kind !== 'child_transcript') continue
      artifacts.set(archive.relativePath, archive)
    }
  }
  return [...artifacts.values()]
}

function collectToolResultArtifacts(record: AgentConversationRecord): AgentArtifactRef[] {
  const artifacts = new Map<string, AgentArtifactRef>()
  for (const turn of record.turns) {
    for (const diagnostic of turn.metadata?.toolResults ?? []) {
      if (diagnostic.archive?.kind !== 'tool_result') continue
      artifacts.set(diagnostic.archive.relativePath, diagnostic.archive)
    }
  }
  return [...artifacts.values()]
}

function renderAgentConversationMarkdown(
  workspace: AgentConversationArchiveWorkspace,
  record: AgentConversationRecord
): string {
  const lines = [
    `# ${record.title}`,
    '',
    `Workspace: ${workspace.name}`,
    `Created: ${record.createdAt}`,
    `Updated: ${record.updatedAt}`,
    ...(record.branch ? [
      `Session: ${record.branch.sessionId}`,
      `Branch: ${record.branch.branchId} (${record.branch.status}, revision ${record.branch.revision})`
    ] : []),
    ''
  ]
  for (const turn of record.turns) {
    lines.push(`## ${turn.role === 'user' ? 'User' : 'Assistant'}`, '')
    lines.push(turn.content.trim() || '(empty)', '')
    if (turn.toolCalls?.length) {
      lines.push('Tool calls:', '')
      for (const tool of turn.toolCalls) {
        lines.push(`- ${tool.name || 'tool'}: ${compactTextForMarkdown(tool.result || tool.arguments || '', 240)}`)
      }
      lines.push('')
    }
    renderAgentTurnMetadataMarkdown(lines, turn.metadata)
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`
}

function renderAgentTurnMetadataMarkdown(lines: string[], metadata: AgentTurnMetadata | undefined): void {
  if (!metadata) return
  if (metadata.sources?.length) {
    lines.push('Sources:', '')
    for (const source of metadata.sources) {
      const label = source.title || source.url
      const suffix = source.provider ? ` (${source.provider})` : ''
      lines.push(`- ${label}: ${source.url}${suffix}`)
    }
    lines.push('')
  }
  if (metadata.childRuns?.length) {
    lines.push('Child runs:', '')
    for (const child of metadata.childRuns) {
      const summary = child.summary ? `: ${compactTextForMarkdown(child.summary, 240)}` : ''
      const archive = (child as AgentChildRunWithArchive).archive
      const transcript = archive?.kind === 'child_transcript' ? ` (transcript: ${archive.relativePath})` : ''
      lines.push(`- ${child.label} [${child.status}, ${child.profile}]${summary}${transcript}`)
    }
    lines.push('')
  }
  if (metadata.compactions?.length) {
    lines.push('Context compaction:', '')
    for (const compaction of metadata.compactions) {
      const saved = compaction.beforeTokens !== undefined && compaction.afterTokens !== undefined
        ? ` saved ${Math.max(0, compaction.beforeTokens - compaction.afterTokens)} tokens`
        : ''
      lines.push(`- ${compaction.sourceDigest} (${compaction.mode}/${compaction.reason})${compaction.failed ? ' failed' : saved}`)
    }
    lines.push('')
  }
  if (metadata.toolResults?.length) {
    lines.push('Tool result diagnostics:', '')
    for (const tool of metadata.toolResults) {
      lines.push(`- ${tool.toolName} ${tool.toolCallId}: ${tool.bytes} bytes, ${tool.lines} lines${tool.isError ? ', error' : ''}`)
    }
    lines.push('')
  }
}

function isArtifactPathWithinDirectory(relativePath: string, expectedPrefix: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  return normalized === relativePath.replace(/\\/g, '/') &&
    !normalized.split('/').some((part) => part === '.' || part === '..') &&
    normalized.startsWith(expectedPrefix)
}

function compactTextForMarkdown(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return '(empty)'
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
