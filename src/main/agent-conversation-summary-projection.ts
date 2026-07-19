import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'
import { sanitizePersistedConversationTitle } from '../shared/agent-persisted-history'
import {
  describeAgentConversationPath,
  isTemporaryAgentConversationPath
} from '../shared/agent-conversation-catalog'
import type {
  AgentConversationRecord,
  AgentConversationSummaryProjection,
  AgentConversationSummaryProjectionOutcome
} from '../shared/teaching-types'
import { readContainedRegularFileBounded } from './path-access'
import {
  closeC2CProjectionOutputDirectory,
  getC2CProjectionOutputDirectoryCapability,
  openC2CProjectionOutputDirectory,
  replaceDurably
} from './persistence/durable-file'
import {
  findExplicitAgentConversationJsonRelativePath,
  parseAgentConversationRecordSource,
  requireCanonicalAgentConversationId
} from './teaching-agent-conversations'

export const AGENT_CONVERSATION_SUMMARY_PROJECTION_VERSION = 1 as const
export const MAX_AGENT_CONVERSATION_PROJECTION_JSON_BYTES = 1024 * 1024
export const MAX_AGENT_CONVERSATION_PROJECTION_MARKDOWN_BYTES = 8 * 1024 * 1024
export const MAX_AGENT_CONVERSATION_SUMMARY_PROJECTION_BYTES = 64 * 1024
export const AGENT_CONVERSATION_SUMMARY_PROJECTION_CONCURRENCY = 4

const PROJECTION_DIRECTORY = '.studiumx/conversation-projections'
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_PROJECTION_TITLE_LENGTH = 160
const MAX_PROVENANCE_RELATIVE_PATH_LENGTH = 512
const UNTITLED_ARCHIVED_CONVERSATION_TITLE = 'Untitled archived conversation'

export type AgentConversationSummaryProjectionStatus = {
  conversationId: string
  status: 'current' | 'missing' | 'invalid' | 'stale'
  projection?: AgentConversationSummaryProjection
}

/** Returns the sole v1 derived-file path for a validated canonical id. */
export function agentConversationSummaryProjectionRelativePath(conversationId: string): string {
  const id = requireCanonicalAgentConversationId(conversationId)
  return `${PROJECTION_DIRECTORY}/${id}.summary.json`
}

/**
 * Explicit, per-id projection writer. It does not discover work to project,
 * accept renderer paths, touch audits/ledgers, or change canonical files.
 */
export type AgentConversationSummaryProjectionPublicationInstrumentation = {
  /** Test-only deterministic seam after the native output directory is bound and before temp creation. */
  onOutputDirectoryBound?: () => void | Promise<void>
}

export async function projectAgentConversationSummaries(input: {
  rootPath: string
  conversationIds: readonly string[]
}, instrumentation: AgentConversationSummaryProjectionPublicationInstrumentation = {}): Promise<AgentConversationSummaryProjectionOutcome[]> {
  return mapWithConcurrency(input.conversationIds, AGENT_CONVERSATION_SUMMARY_PROJECTION_CONCURRENCY,
    (conversationId) => projectOne(input.rootPath, conversationId, instrumentation))
}

/** A small ordered worker pool; exported so the command's concurrency bound is regression-testable. */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer.')
  const results = new Array<R>(values.length)
  let next = 0
  const run = async (): Promise<void> => {
    while (true) {
      const index = next
      next += 1
      if (index >= values.length) return
      results[index] = await worker(values[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()))
  return results
}

/**
 * Projection failure is self-contained: canonical readers do not consult this
 * status. A projection document must be the exact canonical bytes produced by
 * this version; this rejects duplicate JSON keys and every noncanonical edit.
 */
export async function readAgentConversationSummaryProjectionStatus(input: {
  rootPath: string
  conversationId: string
}): Promise<AgentConversationSummaryProjectionStatus> {
  let id: string
  try {
    id = requireCanonicalAgentConversationId(input.conversationId)
  } catch {
    return { conversationId: input.conversationId, status: 'invalid' }
  }

  let projectionBytes: Buffer
  try {
    const read = await readContainedRegularFileBounded(
      input.rootPath,
      join(input.rootPath, agentConversationSummaryProjectionRelativePath(id)),
      MAX_AGENT_CONVERSATION_SUMMARY_PROJECTION_BYTES
    )
    if (read.status === 'over_limit') return { conversationId: id, status: 'invalid' }
    projectionBytes = read.content
  } catch (error) {
    if (isMissingFile(error)) return { conversationId: id, status: 'missing' }
    return { conversationId: id, status: 'invalid' }
  }

  const projection = parseSummaryProjection(projectionBytes)
  if (!projection || projection.conversationId !== id || !projectionBytes.equals(canonicalProjectionBytes(projection))) {
    return { conversationId: id, status: 'invalid' }
  }

  try {
    const jsonRelativePath = await findExplicitAgentConversationJsonRelativePath(input.rootPath, id)
    const sources = await readVerifiedCanonicalSources(input.rootPath, id, jsonRelativePath)
    if (!isEligible(sources.record, sources.markdownRelativePath)) return { conversationId: id, status: 'stale' }
    return sameProjection(projection, buildProjection(sources))
      ? { conversationId: id, status: 'current', projection }
      : { conversationId: id, status: 'stale' }
  } catch {
    return { conversationId: id, status: 'stale' }
  }
}

async function projectOne(
  rootPath: string,
  requestedId: string,
  instrumentation: AgentConversationSummaryProjectionPublicationInstrumentation
): Promise<AgentConversationSummaryProjectionOutcome> {
  let id: string
  try {
    id = requireCanonicalAgentConversationId(requestedId)
  } catch {
    return { conversationId: requestedId, status: 'rejected', reason: 'invalid_source' }
  }

  const nativeCapability = getC2CProjectionOutputDirectoryCapability()
  if (!nativeCapability.available) {
    return { conversationId: id, status: 'rejected', reason: nativeCapability.reason }
  }

  try {
    // Resolve once, then use the same validated path for both source snapshots.
    const jsonRelativePath = await findExplicitAgentConversationJsonRelativePath(rootPath, id)
    const sources = await readVerifiedCanonicalSources(rootPath, id, jsonRelativePath)
    const ineligible = eligibilityReason(sources.record, sources.markdownRelativePath)
    if (ineligible) return { conversationId: id, status: 'ineligible', reason: ineligible }

    const verified = await readVerifiedCanonicalSources(rootPath, id, jsonRelativePath)
    if (
      verified.jsonRelativePath !== sources.jsonRelativePath ||
      verified.markdownRelativePath !== sources.markdownRelativePath ||
      verified.jsonSha256 !== sources.jsonSha256 ||
      verified.markdownSha256 !== sources.markdownSha256
    ) return { conversationId: id, status: 'rejected', reason: 'source_drift' }

    try {
      const outputDirectory = openC2CProjectionOutputDirectory(rootPath)
      try {
        await replaceDurably({
          directory: outputDirectory,
          filename: `${id}.summary.json`,
          content: canonicalProjectionBytes(buildProjection(sources)),
          mode: 0o600,
          onDirectoryBound: instrumentation.onOutputDirectoryBound
        })
      } finally {
        closeC2CProjectionOutputDirectory(outputDirectory)
      }
    } catch {
      return { conversationId: id, status: 'rejected', reason: 'write_failed' }
    }
    return { conversationId: id, status: 'generated' }
  } catch (error) {
    if (error instanceof Error && error.message === 'Conversation not found.') {
      return { conversationId: id, status: 'not_found' }
    }
    return { conversationId: id, status: 'rejected', reason: 'invalid_source' }
  }
}

async function readVerifiedCanonicalSources(
  rootPath: string,
  conversationId: string,
  jsonRelativePath: string
): Promise<VerifiedCanonicalSources> {
  const jsonPathInfo = describeAgentConversationPath(jsonRelativePath)
  if (!jsonPathInfo || jsonPathInfo.format !== 'json' || jsonPathInfo.id !== conversationId) {
    throw new Error('Conversation JSON path is invalid.')
  }
  const jsonBytes = await readBoundedSource(rootPath, join(rootPath, jsonRelativePath), MAX_AGENT_CONVERSATION_PROJECTION_JSON_BYTES)
  const record = await parseAgentConversationRecordSource(rootPath, jsonRelativePath, jsonBytes.toString('utf8'), { hydrateArtifacts: false })
  const exactMetadata = projectionMetadataFromExactJson(jsonBytes)
  const markdownRelativePath = exactMetadata.markdownRelativePath
  if (record.relativePath !== markdownRelativePath) throw new Error('Conversation Markdown path changed during canonical parsing.')

  const markdownPathInfo = describeAgentConversationPath(markdownRelativePath)
  if (
    !markdownPathInfo || markdownPathInfo.format !== 'markdown' || markdownPathInfo.id !== conversationId ||
    markdownPathInfo.directoryRelativePath !== jsonPathInfo.directoryRelativePath
  ) throw new Error('Conversation Markdown sibling path is invalid.')
  if (!isSafeProjectionProvenancePath(jsonRelativePath) || !isSafeProjectionProvenancePath(markdownRelativePath)) {
    throw new Error('Conversation provenance path is invalid.')
  }
  const markdownBytes = await readBoundedSource(rootPath, join(rootPath, markdownRelativePath), MAX_AGENT_CONVERSATION_PROJECTION_MARKDOWN_BYTES)
  return {
    record,
    projectionTitle: exactMetadata.title,
    jsonRelativePath,
    markdownRelativePath,
    jsonSha256: sha256(jsonBytes),
    markdownSha256: sha256(markdownBytes)
  }
}

async function readBoundedSource(rootPath: string, targetPath: string, maximum: number): Promise<Buffer> {
  const read = await readContainedRegularFileBounded(rootPath, targetPath, maximum)
  if (read.status === 'over_limit') throw new Error('Conversation source exceeds the C-2C size limit.')
  return read.content
}

type VerifiedCanonicalSources = {
  record: AgentConversationRecord
  projectionTitle: string
  jsonRelativePath: string
  markdownRelativePath: string
  jsonSha256: string
  markdownSha256: string
}

function eligibilityReason(record: AgentConversationRecord, markdownRelativePath: string): Extract<AgentConversationSummaryProjectionOutcome['reason'], 'not_archived' | 'deleted' | 'temporary'> | null {
  if (isTemporaryAgentConversationPath(markdownRelativePath)) return 'temporary'
  if (record.branch?.status === 'deleted') return 'deleted'
  if (record.branch?.status !== 'archived') return 'not_archived'
  return null
}

function isEligible(record: AgentConversationRecord, markdownRelativePath: string): boolean {
  return eligibilityReason(record, markdownRelativePath) === null
}

function buildProjection(sources: VerifiedCanonicalSources): AgentConversationSummaryProjection {
  const user = sources.record.turns.filter((turn) => turn.role === 'user').length
  const assistant = sources.record.turns.filter((turn) => turn.role === 'assistant').length
  return {
    projectionVersion: AGENT_CONVERSATION_SUMMARY_PROJECTION_VERSION,
    conversationId: sources.record.id,
    timeCompacting: true,
    source: {
      jsonRelativePath: sources.jsonRelativePath,
      markdownRelativePath: sources.markdownRelativePath,
      jsonSha256: sources.jsonSha256,
      markdownSha256: sources.markdownSha256
    },
    summary: {
      template: 'conversation-summary-v1',
      title: sources.projectionTitle,
      turnCounts: { total: sources.record.turns.length, user, assistant }
    }
  }
}

function projectionMetadataFromExactJson(jsonBytes: Buffer): { title: string; markdownRelativePath: string } {
  const value: unknown = JSON.parse(jsonBytes.toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Conversation projection metadata is invalid.')
  const record = value as Record<string, unknown>
  if (typeof record.relativePath !== 'string') throw new Error('Conversation projection requires an explicit Markdown relativePath.')
  const title = typeof record.title === 'string' && record.title.trim()
    ? boundedProjectionString(sanitizePersistedConversationTitle(record.title), MAX_PROJECTION_TITLE_LENGTH)
    : ''
  return { title: title || UNTITLED_ARCHIVED_CONVERSATION_TITLE, markdownRelativePath: record.relativePath }
}

function parseSummaryProjection(content: Buffer): AgentConversationSummaryProjection | null {
  let value: unknown
  try { value = JSON.parse(content.toString('utf8')) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!hasExactKeys(record, ['projectionVersion', 'conversationId', 'timeCompacting', 'source', 'summary'])) return null
  if (record.projectionVersion !== AGENT_CONVERSATION_SUMMARY_PROJECTION_VERSION || record.timeCompacting !== true || !isCanonicalProjectionId(record.conversationId)) return null
  if (!record.source || typeof record.source !== 'object' || Array.isArray(record.source) || !record.summary || typeof record.summary !== 'object' || Array.isArray(record.summary)) return null
  const source = record.source as Record<string, unknown>
  const summary = record.summary as Record<string, unknown>
  if (!hasExactKeys(source, ['jsonRelativePath', 'markdownRelativePath', 'jsonSha256', 'markdownSha256']) || !hasExactKeys(summary, ['template', 'title', 'turnCounts'])) return null
  const jsonPath = typeof source.jsonRelativePath === 'string' ? describeAgentConversationPath(source.jsonRelativePath) : null
  const markdownPath = typeof source.markdownRelativePath === 'string' ? describeAgentConversationPath(source.markdownRelativePath) : null
  if (
    !jsonPath || jsonPath.format !== 'json' || !markdownPath || markdownPath.format !== 'markdown' ||
    !isSafeProjectionProvenancePath(source.jsonRelativePath) || !isSafeProjectionProvenancePath(source.markdownRelativePath) ||
    jsonPath.id !== record.conversationId || markdownPath.id !== record.conversationId || jsonPath.directoryRelativePath !== markdownPath.directoryRelativePath ||
    typeof source.jsonSha256 !== 'string' || !SHA256_PATTERN.test(source.jsonSha256) ||
    typeof source.markdownSha256 !== 'string' || !SHA256_PATTERN.test(source.markdownSha256) ||
    summary.template !== 'conversation-summary-v1' || !isBoundedProjectionString(summary.title, MAX_PROJECTION_TITLE_LENGTH) || !isTurnCounts(summary.turnCounts)
  ) return null
  return value as AgentConversationSummaryProjection
}

function canonicalProjectionBytes(projection: AgentConversationSummaryProjection): Buffer {
  return Buffer.from(`${JSON.stringify(projection, null, 2)}\n`, 'utf8')
}

function sameProjection(left: AgentConversationSummaryProjection, right: AgentConversationSummaryProjection): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isTurnCounts(value: unknown): value is AgentConversationSummaryProjection['summary']['turnCounts'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const counts = value as Record<string, unknown>
  return hasExactKeys(counts, ['total', 'user', 'assistant']) && isCount(counts.total) && isCount(counts.user) && isCount(counts.assistant) && counts.total === counts.user + counts.assistant
}
function isCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(record); return keys.length === expected.length && keys.every((key) => expected.includes(key)) }
function isSafeProjectionProvenancePath(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= MAX_PROVENANCE_RELATIVE_PATH_LENGTH && redactAgentSecretText(value) === value }
function isCanonicalProjectionId(value: unknown): value is string { if (typeof value !== 'string') return false; try { return requireCanonicalAgentConversationId(value) === value } catch { return false } }
function boundedProjectionString(value: string, maximum: number): string { const redacted = redactAgentSecretText(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return redacted.length <= maximum ? redacted : `${redacted.slice(0, Math.max(0, maximum - 3))}...` }
function isBoundedProjectionString(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum && boundedProjectionString(value, maximum) === value }
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
function isMissingFile(error: unknown): boolean { return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') }
