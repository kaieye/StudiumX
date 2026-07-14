import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  agentConversationCheckpointDirectoryRelativePathForMarkdown,
  agentConversationSessionArtifactDirectoryRelativePathForMarkdown,
  describeAgentConversationPath,
  normalizeAgentConversationRelativePath
} from '../shared/agent-conversation-catalog'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'
import type {
  AgentArtifactRef,
  AgentChatTurn,
  AgentConversationCheckpoint,
  AgentConversationRecord
} from '../shared/teaching-types'
import {
  isPathInsideRoot,
  isRealPathInsideRoot,
  readContainedRegularFile,
  writeContentAddressedFile
} from './path-access'

/**
 * Durable conversation checkpoint format. This is intentionally unrelated to
 * AgentRunCheckpoint: it captures a persisted conversation prefix and never
 * resumes or replays an agent run.
 */
export const AGENT_CONVERSATION_CHECKPOINT_SCHEMA_VERSION = 1
export const AGENT_CONVERSATION_CHECKPOINT_MAX_BYTES = 1024 * 1024
export const AGENT_CONVERSATION_CHECKPOINT_DIRECTORY_NAME = 'checkpoints'

const CHECKPOINT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CHECKPOINT_TEXT_MAX_LENGTH = 1000

export type AgentConversationCheckpointIssue = {
  code: string
  message: string
  checkpointId?: string
  relativePath?: string
}

export type AgentConversationCheckpointScanResult = {
  checkpoints: AgentConversationCheckpoint[]
  issues: AgentConversationCheckpointIssue[]
}

export type ResolvedAgentConversationCheckpoint = {
  checkpoint: AgentConversationCheckpoint
  turns: AgentChatTurn[]
  artifacts: AgentArtifactRef[]
  toolsReplayed: false
  artifactsHydrated: false
}

export async function createAgentConversationCheckpoint(input: {
  rootPath: string
  record: AgentConversationRecord
  checkpointId?: string
  turnCount?: number
  label?: string
  reason?: string
  createdAt?: string
}): Promise<AgentConversationCheckpoint> {
  const conversationRelativePath = requireConversationRelativePath(input.record.relativePath, input.record.id)
  const checkpointId = validateCheckpointId(input.checkpointId ?? randomUUID())
  const turnCount = input.turnCount ?? input.record.turns.length
  if (!Number.isSafeInteger(turnCount) || turnCount < 0 || turnCount > input.record.turns.length) {
    throw new Error('Conversation checkpoint turnCount is outside the persisted conversation.')
  }

  const turns = input.record.turns.slice(0, turnCount)
  const artifacts = collectAgentConversationArtifactRefs(turns)
  for (const artifact of artifacts) {
    await assertCheckpointArtifactIntegrity({
      rootPath: input.rootPath,
      conversationRelativePath,
      artifact
    })
  }

  const unsigned = {
    schemaVersion: 1 as const,
    checkpointId,
    conversationId: input.record.id,
    conversationRelativePath,
    ...(boundedRedactedText(input.label) ? { label: boundedRedactedText(input.label) } : {}),
    ...(boundedRedactedText(input.reason) ? { reason: boundedRedactedText(input.reason) } : {}),
    createdAt: requireIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'createdAt'),
    ...(turns.at(-1)?.id ? { headTurnId: turns.at(-1)!.id } : {}),
    turnCount,
    sourceDigest: digestConversationPrefix(turns),
    artifacts
  }
  const checkpoint: AgentConversationCheckpoint = {
    ...unsigned,
    integritySha256: sha256(canonicalJson(unsigned))
  }
  const content = `${canonicalJson(checkpoint)}\n`
  if (Buffer.byteLength(content, 'utf8') > AGENT_CONVERSATION_CHECKPOINT_MAX_BYTES) {
    throw new Error('Conversation checkpoint exceeds the maximum persisted size.')
  }

  const targetPath = join(
    input.rootPath,
    agentConversationCheckpointRelativePath(conversationRelativePath, checkpointId)
  )
  await writeContentAddressedFile({
    rootPath: input.rootPath,
    targetPath,
    content,
    sha256: sha256(content)
  })
  return checkpoint
}

export async function readAgentConversationCheckpoint(input: {
  rootPath: string
  conversationRelativePath: string
  checkpointId: string
}): Promise<AgentConversationCheckpoint> {
  const conversationRelativePath = requireConversationRelativePath(input.conversationRelativePath)
  const checkpointId = validateCheckpointId(input.checkpointId)
  const relativePath = agentConversationCheckpointRelativePath(conversationRelativePath, checkpointId)
  return readAgentConversationCheckpointAt({
    rootPath: input.rootPath,
    targetPath: join(input.rootPath, relativePath),
    expectedConversationRelativePath: conversationRelativePath,
    expectedCheckpointId: checkpointId
  })
}

export async function scanAgentConversationCheckpoints(input: {
  rootPath: string
  conversationRelativePath: string
}): Promise<AgentConversationCheckpointScanResult> {
  const conversationRelativePath = requireConversationRelativePath(input.conversationRelativePath)
  const directoryRelativePath = agentConversationCheckpointDirectoryRelativePath(conversationRelativePath)
  const directoryPath = join(input.rootPath, directoryRelativePath)
  if (!isPathInsideRoot(input.rootPath, directoryPath)) {
    throw new Error('Conversation checkpoint directory is outside the configured root.')
  }

  let entries
  try {
    const stats = await lstat(directoryPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Conversation checkpoint directory must be a regular directory.')
    }
    if (!(await isRealPathInsideRoot(input.rootPath, directoryPath))) {
      throw new Error('Conversation checkpoint directory escapes the configured root.')
    }
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) return { checkpoints: [], issues: [] }
    throw error
  }

  const checkpoints: AgentConversationCheckpoint[] = []
  const issues: AgentConversationCheckpointIssue[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.name.toLowerCase().endsWith('.json')) continue
    const checkpointId = entry.name.slice(0, -'.json'.length)
    const relativePath = `${directoryRelativePath}/${entry.name}`
    if (entry.isSymbolicLink() || !entry.isFile()) {
      issues.push({
        code: 'checkpoint_unsafe_path',
        message: 'Conversation checkpoint path must be a regular file.',
        checkpointId,
        relativePath
      })
      continue
    }
    try {
      validateCheckpointId(checkpointId)
      checkpoints.push(await readAgentConversationCheckpointAt({
        rootPath: input.rootPath,
        targetPath: join(directoryPath, entry.name),
        expectedConversationRelativePath: conversationRelativePath,
        expectedCheckpointId: checkpointId
      }))
    } catch (error) {
      issues.push({
        code: 'checkpoint_invalid',
        message: safeErrorMessage(error),
        checkpointId,
        relativePath
      })
    }
  }

  checkpoints.sort(compareCheckpoints)
  return { checkpoints, issues }
}

export async function resolveAgentConversationCheckpoint(input: {
  rootPath: string
  record: AgentConversationRecord
  checkpointId: string
}): Promise<ResolvedAgentConversationCheckpoint> {
  const conversationRelativePath = requireConversationRelativePath(input.record.relativePath, input.record.id)
  const checkpoint = await readAgentConversationCheckpoint({
    rootPath: input.rootPath,
    conversationRelativePath,
    checkpointId: input.checkpointId
  })
  assertCheckpointMatchesConversation(checkpoint, input.record)

  for (const artifact of checkpoint.artifacts) {
    await assertCheckpointArtifactIntegrity({
      rootPath: input.rootPath,
      conversationRelativePath,
      artifact
    })
  }

  return {
    checkpoint,
    turns: dehydrateAgentConversationCheckpointTurns(input.record.turns.slice(0, checkpoint.turnCount)),
    artifacts: checkpoint.artifacts.map((artifact) => ({ ...artifact })),
    toolsReplayed: false,
    artifactsHydrated: false
  }
}

/**
 * Save-time invariant: once a checkpoint exists, every captured prefix remains
 * byte-semantically identical. This protects recovery without making the
 * checkpoint or history index an authority over the original turns.
 */
export async function assertAgentConversationCheckpointPrefixesPreserved(input: {
  rootPath: string
  record: AgentConversationRecord
}): Promise<void> {
  const scan = await scanAgentConversationCheckpoints({
    rootPath: input.rootPath,
    conversationRelativePath: input.record.relativePath
  })
  if (scan.issues.length > 0) {
    throw new Error(`Conversation checkpoint validation failed: ${scan.issues[0]!.message}`)
  }
  for (const checkpoint of scan.checkpoints) assertCheckpointMatchesConversation(checkpoint, input.record)
}

export function agentConversationCheckpointDirectoryRelativePath(conversationRelativePath: string): string {
  const normalized = requireConversationRelativePath(conversationRelativePath)
  return agentConversationCheckpointDirectoryRelativePathForMarkdown(normalized)
}

export function agentConversationCheckpointRelativePath(
  conversationRelativePath: string,
  checkpointId: string
): string {
  return `${agentConversationCheckpointDirectoryRelativePath(conversationRelativePath)}/${validateCheckpointId(checkpointId)}.json`
}

export function digestConversationPrefix(turns: readonly AgentChatTurn[]): string {
  return sha256(canonicalJson(dehydrateAgentConversationCheckpointTurns(turns)))
}

/**
 * Removes runtime-hydrated tool results from a checkpoint projection. Artifact
 * references and their hashes remain, so recovery can reconstruct the durable
 * prefix without exposing artifact content or pretending to replay a tool.
 */
export function dehydrateAgentConversationCheckpointTurns(
  turns: readonly AgentChatTurn[]
): AgentChatTurn[] {
  return turns.map((turn) => {
    const archivesByToolCallId = new Map(
      (turn.metadata?.toolResults ?? [])
        .filter((diagnostic) => diagnostic.archive?.kind === 'tool_result')
        .map((diagnostic) => [diagnostic.toolCallId, normalizeArtifactRef(diagnostic.archive!, true)] as const)
    )
    const toolCalls = turn.toolCalls?.map((toolCall) => {
      const archive = archivesByToolCallId.get(toolCall.id)
      return archive
        ? { ...toolCall, result: archivedToolResultPlaceholder(archive) }
        : { ...toolCall }
    })
    const metadata = turn.metadata
      ? normalizeCheckpointDigestValue(turn.metadata) as AgentChatTurn['metadata']
      : undefined
    return {
      ...turn,
      ...(toolCalls ? { toolCalls } : {}),
      ...(turn.processEvents ? { processEvents: turn.processEvents.map((event) => ({ ...event })) } : {}),
      ...(metadata ? { metadata } : {})
    }
  })
}


export function collectAgentConversationArtifactRefs(turns: readonly AgentChatTurn[]): AgentArtifactRef[] {
  const artifacts = new Map<string, AgentArtifactRef>()
  const visited = new Set<object>()
  const visit = (value: unknown, parentKey?: string): void => {
    if (!value || typeof value !== 'object') return
    if (visited.has(value)) return
    visited.add(value)
    if (isAgentArtifactRef(value)) {
      const key = `${value.kind}:${value.relativePath}:${value.sha256}`
      if (!artifacts.has(key)) artifacts.set(key, normalizeArtifactRef(value, true))
      return
    }
    const record = value as Record<string, unknown>
    if (parentKey === 'archive' || record.kind === 'tool_result' || record.kind === 'child_transcript') {
      throw new Error('Conversation contains an invalid artifact reference.')
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const [key, item] of Object.entries(record)) visit(item, key)
  }
  visit(turns)
  return [...artifacts.values()].sort(compareArtifactRefs)
}

async function readAgentConversationCheckpointAt(input: {
  rootPath: string
  targetPath: string
  expectedConversationRelativePath: string
  expectedCheckpointId: string
}): Promise<AgentConversationCheckpoint> {
  let content: Buffer
  try {
    content = await readContainedRegularFile(input.rootPath, input.targetPath)
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) throw new Error('Conversation checkpoint was not found.')
    throw error
  }
  if (content.byteLength > AGENT_CONVERSATION_CHECKPOINT_MAX_BYTES) {
    throw new Error('Conversation checkpoint exceeds the maximum persisted size.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content.toString('utf8'))
  } catch {
    throw new Error('Conversation checkpoint is malformed JSON.')
  }
  const checkpoint = parseCheckpoint(parsed)
  if (checkpoint.checkpointId !== input.expectedCheckpointId) {
    throw new Error('Conversation checkpoint id does not match its filename.')
  }
  if (checkpoint.conversationRelativePath !== input.expectedConversationRelativePath) {
    throw new Error('Conversation checkpoint belongs to a different conversation path.')
  }
  return checkpoint
}

function parseCheckpoint(value: unknown): AgentConversationCheckpoint {
  if (!isRecord(value)) throw new Error('Conversation checkpoint must be an object.')
  if (value.schemaVersion !== AGENT_CONVERSATION_CHECKPOINT_SCHEMA_VERSION) {
    throw new Error('Unsupported conversation checkpoint schema version.')
  }
  const checkpointId = requireString(value.checkpointId, 'checkpointId')
  validateCheckpointId(checkpointId)
  const conversationId = requireString(value.conversationId, 'conversationId')
  const conversationRelativePath = requireConversationRelativePath(
    requireString(value.conversationRelativePath, 'conversationRelativePath'),
    conversationId
  )
  const createdAt = requireIsoTimestamp(requireString(value.createdAt, 'createdAt'), 'createdAt')
  const turnCount = requireNonNegativeSafeInteger(value.turnCount, 'turnCount')
  const headTurnId = optionalString(value.headTurnId, 'headTurnId')
  if (turnCount === 0 && headTurnId !== undefined) {
    throw new Error('Empty conversation checkpoint cannot have a head turn.')
  }
  if (turnCount > 0 && !headTurnId) {
    throw new Error('Non-empty conversation checkpoint must have a head turn.')
  }
  const sourceDigest = requireSha256(value.sourceDigest, 'sourceDigest')
  const integritySha256 = requireSha256(value.integritySha256, 'integritySha256')
  if (!Array.isArray(value.artifacts)) throw new Error('Conversation checkpoint artifacts must be an array.')
  const artifacts = value.artifacts.map((artifact) => {
    if (!isAgentArtifactRef(artifact)) throw new Error('Conversation checkpoint has an invalid artifact reference.')
    return normalizeArtifactRef(artifact)
  })
  const label = optionalString(value.label, 'label')
  const reason = optionalString(value.reason, 'reason')
  if ((label && label.length > CHECKPOINT_TEXT_MAX_LENGTH) || (reason && reason.length > CHECKPOINT_TEXT_MAX_LENGTH)) {
    throw new Error('Conversation checkpoint text exceeds the maximum length.')
  }

  const unsigned = {
    schemaVersion: 1 as const,
    checkpointId,
    conversationId,
    conversationRelativePath,
    ...(label ? { label } : {}),
    ...(reason ? { reason } : {}),
    createdAt,
    ...(headTurnId ? { headTurnId } : {}),
    turnCount,
    sourceDigest,
    artifacts
  }
  const actualIntegrity = sha256(canonicalJson(unsigned))
  if (actualIntegrity !== integritySha256) {
    throw new Error('Conversation checkpoint failed integrity validation.')
  }
  return { ...unsigned, integritySha256 }
}

function assertCheckpointMatchesConversation(
  checkpoint: AgentConversationCheckpoint,
  record: AgentConversationRecord
): void {
  const conversationRelativePath = requireConversationRelativePath(record.relativePath, record.id)
  if (checkpoint.conversationId !== record.id || checkpoint.conversationRelativePath !== conversationRelativePath) {
    throw new Error('Conversation checkpoint belongs to a different conversation.')
  }
  if (record.turns.length < checkpoint.turnCount) {
    throw new Error('Persisted conversation is shorter than the checkpoint prefix.')
  }
  const turns = record.turns.slice(0, checkpoint.turnCount)
  if (turns.at(-1)?.id !== checkpoint.headTurnId) {
    throw new Error('Conversation checkpoint head turn does not match the persisted prefix.')
  }
  if (digestConversationPrefix(turns) !== checkpoint.sourceDigest) {
    throw new Error('Conversation checkpoint prefix digest does not match the persisted conversation.')
  }
}

async function assertCheckpointArtifactIntegrity(input: {
  rootPath: string
  conversationRelativePath: string
  artifact: AgentArtifactRef
}): Promise<void> {
  const normalizedPath = normalizeArtifactRelativePath(input.artifact.relativePath)
  const expectedPrefix = `${agentConversationSessionArtifactDirectoryRelativePathForMarkdown(input.conversationRelativePath)}/`
  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new Error('Conversation checkpoint artifact is outside its durable conversation scope.')
  }
  const targetPath = join(input.rootPath, normalizedPath)
  const content = await readContainedRegularFile(input.rootPath, targetPath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) throw new Error('Conversation checkpoint artifact is missing.')
    throw error
  })
  if (content.byteLength !== input.artifact.bytes || sha256(content) !== input.artifact.sha256) {
    throw new Error('Conversation checkpoint artifact failed integrity validation.')
  }
}

function requireConversationRelativePath(value: string, expectedId?: string): string {
  const normalized = normalizeAgentConversationRelativePath(value)
  if (normalized !== value) {
    throw new Error('Conversation checkpoint path must already be normalized.')
  }
  const info = describeAgentConversationPath(normalized)
  if (info?.format !== 'markdown') {
    throw new Error('Conversation checkpoint path is outside a conversations directory.')
  }
  if (expectedId !== undefined && info.id !== expectedId) {
    throw new Error('Conversation checkpoint id does not match its conversation path.')
  }
  return normalized
}

function validateCheckpointId(value: string): string {
  if (!CHECKPOINT_ID_PATTERN.test(value)) throw new Error('Invalid conversation checkpoint id.')
  return value
}

function isAgentArtifactRef(value: unknown): value is AgentArtifactRef {
  if (!isRecord(value)) return false
  if (value.kind !== 'tool_result' && value.kind !== 'child_transcript') return false
  if (typeof value.relativePath !== 'string' || value.relativePath.length === 0) return false
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) return false
  if (!Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0) return false
  if (value.lines !== undefined && (!Number.isSafeInteger(value.lines) || (value.lines as number) < 0)) return false
  if (value.preview !== undefined && typeof value.preview !== 'string') return false
  if (value.archivedAt !== undefined && typeof value.archivedAt !== 'string') return false
  try {
    normalizeArtifactRelativePath(value.relativePath)
  } catch {
    return false
  }
  return true
}

function normalizeArtifactRef(value: AgentArtifactRef, redactPreview = false): AgentArtifactRef {
  return {
    kind: value.kind,
    relativePath: normalizeArtifactRelativePath(value.relativePath),
    sha256: value.sha256,
    bytes: value.bytes,
    ...(value.lines !== undefined ? { lines: value.lines } : {}),
    ...(value.preview !== undefined
      ? { preview: redactPreview ? boundedRedactedText(value.preview, 1200) : value.preview }
      : {}),
    ...(value.archivedAt !== undefined ? { archivedAt: requireIsoTimestamp(value.archivedAt, 'artifact archivedAt') } : {})
  }
}


function normalizeCheckpointDigestValue(value: unknown): unknown {
  if (isAgentArtifactRef(value)) return normalizeArtifactRef(value, true)
  if (Array.isArray(value)) return value.map(normalizeCheckpointDigestValue)
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = normalizeCheckpointDigestValue(item)
  }
  return result
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

function normalizeArtifactRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (normalized !== value || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('Artifact path must be a normalized relative path.')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Artifact path contains an invalid segment.')
  }
  return normalized
}

function boundedRedactedText(value: string | undefined, maxLength = CHECKPOINT_TEXT_MAX_LENGTH): string {
  if (typeof value !== 'string') return ''
  const redacted = redactAgentSecretText(value).trim()
  if (!redacted) return ''
  return redacted.length > maxLength ? redacted.slice(0, maxLength) : redacted
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

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Conversation checkpoint ${field} is invalid.`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requireString(value, field)
}

function requireNonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Conversation checkpoint ${field} is invalid.`)
  }
  return value as number
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`Conversation checkpoint ${field} is invalid.`)
  }
  return value
}

function requireIsoTimestamp(value: string, field: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`Conversation checkpoint ${field} is invalid.`)
  return new Date(timestamp).toISOString() === value ? value : new Date(timestamp).toISOString()
}

function compareArtifactRefs(left: AgentArtifactRef, right: AgentArtifactRef): number {
  return `${left.kind}:${left.relativePath}:${left.sha256}`.localeCompare(
    `${right.kind}:${right.relativePath}:${right.sha256}`
  )
}

function compareCheckpoints(left: AgentConversationCheckpoint, right: AgentConversationCheckpoint): number {
  return left.createdAt.localeCompare(right.createdAt) || left.checkpointId.localeCompare(right.checkpointId)
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
