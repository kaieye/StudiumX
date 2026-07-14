import type { Dirent } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'

import {
  agentConversationCourseJsonScanDirectories,
  agentConversationJsonScanDirectories,
  agentConversationMarkdownRelativePath,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../shared/agent-conversation-catalog'
import type { AgentArtifactRef } from '../shared/teaching-types'
import type { AgentArtifactProtectionSnapshot } from './agent-artifact-lifecycle'
import { scanAgentConversationCheckpoints } from './agent-conversation-checkpoints'
import { readContainedRegularFile } from './path-access'

const AGENT_CONVERSATION_RECORD_MAX_BYTES = 16 * 1024 * 1024
const AGENT_CONVERSATION_AUDIT_MAX_BYTES = 8 * 1024 * 1024
const AGENT_CONVERSATION_AUDIT_MAX_LINES = 50_000
const AGENT_CONVERSATION_AUDIT_LINE_MAX_BYTES = 256 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/

/**
 * Rebuilds the artifact live set from authoritative conversation facts, immutable checkpoints,
 * and valid append-only audit entries. A malformed source aborts cleanup conservatively.
 */
export async function collectAgentArtifactProtectionSnapshot(
  storageRoot: string
): Promise<AgentArtifactProtectionSnapshot> {
  const references = new Map<string, { relativePath: string; sha256?: string; referenceId?: string }>()
  const conversationPaths = await collectConversationRecordPaths(storageRoot)

  for (const jsonRelativePath of conversationPaths) {
    const conversationId = conversationIdFromJsonPath(jsonRelativePath)
    const conversationRelativePath = agentConversationMarkdownRelativePath(
      conversationId,
      dirname(jsonRelativePath).replace(/\\/g, '/')
    )
    const conversation = await readBoundedContainedFile({
      rootPath: storageRoot,
      targetPath: join(storageRoot, jsonRelativePath),
      maxBytes: AGENT_CONVERSATION_RECORD_MAX_BYTES,
      label: 'Conversation record'
    })
    for (const artifact of parseStrictJsonArtifactRefs(conversation.toString('utf8'), 'Conversation record')) {
      addReference(references, artifact, `conversation:${conversationId}`)
    }

    const checkpointScan = await scanAgentConversationCheckpoints({
      rootPath: storageRoot,
      conversationRelativePath
    })
    if (checkpointScan.issues.length > 0) {
      throw new Error(`Conversation checkpoint scan failed: ${checkpointScan.issues[0]?.message ?? 'unknown error'}`)
    }
    for (const checkpoint of checkpointScan.checkpoints) {
      for (const artifact of checkpoint.artifacts) {
        addReference(references, artifact, `checkpoint:${checkpoint.checkpointId}`)
      }
    }

    const auditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(conversationRelativePath)
    const audit = await readBoundedContainedFile({
      rootPath: storageRoot,
      targetPath: join(storageRoot, auditRelativePath),
      maxBytes: AGENT_CONVERSATION_AUDIT_MAX_BYTES,
      label: 'Conversation audit',
      optional: true
    })
    for (const artifact of parseStrictAuditArtifactRefs(audit.toString('utf8'))) {
      addReference(references, artifact, `audit:${conversationId}`)
    }
  }

  return { liveReferences: [...references.values()] }
}

async function collectConversationRecordPaths(storageRoot: string): Promise<string[]> {
  const rootMetadata = await lstat(storageRoot)
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('Artifact protection storage root must be a regular directory.')
  }
  const rootRealPath = await realpath(storageRoot)
  const paths: string[] = []

  for (const directory of agentConversationJsonScanDirectories()) {
    await collectConversationFilesInDirectory(storageRoot, rootRealPath, directory, paths)
  }

  const courseEntries = await readContainedDirectory(storageRoot, rootRealPath, 'courses')
  for (const entry of courseEntries) {
    if (entry.isSymbolicLink()) {
      throw new Error('Artifact protection course directory cannot be a symbolic link.')
    }
    if (!entry.isDirectory()) continue
    for (const directory of agentConversationCourseJsonScanDirectories(entry.name)) {
      await collectConversationFilesInDirectory(storageRoot, rootRealPath, directory, paths)
    }
  }

  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

async function collectConversationFilesInDirectory(
  storageRoot: string,
  rootRealPath: string,
  directory: string,
  out: string[]
): Promise<void> {
  const entries = await readContainedDirectory(storageRoot, rootRealPath, directory)
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    if (!isConversationRecordFileName(entry.name)) continue
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error('Canonical conversation JSON must be a regular file.')
    }
    out.push(`${directory.replace(/\\/g, '/')}/${entry.name}`)
  }
}

async function readContainedDirectory(
  storageRoot: string,
  rootRealPath: string,
  relativePath: string
): Promise<Dirent[]> {
  const targetPath = join(storageRoot, relativePath)
  const metadata = await lstat(targetPath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!metadata) return []
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('Artifact protection scan path must be a regular directory.')
  }
  const targetRealPath = await realpath(targetPath)
  if (!isPathInside(rootRealPath, targetRealPath)) {
    throw new Error('Artifact protection scan path escapes the storage root.')
  }
  return readdir(targetPath, { withFileTypes: true })
}

function conversationIdFromJsonPath(jsonRelativePath: string): string {
  const fileName = basename(jsonRelativePath)
  if (!isConversationRecordFileName(fileName)) {
    throw new Error('Canonical conversation JSON has an invalid file name.')
  }
  return fileName.slice(0, -'.json'.length)
}

function isConversationRecordFileName(fileName: string): boolean {
  if (!fileName.endsWith('.json')) return false
  const id = fileName.slice(0, -'.json'.length)
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(id)
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function addReference(
  references: Map<string, { relativePath: string; sha256?: string; referenceId?: string }>,
  artifact: AgentArtifactRef,
  referenceId: string
): void {
  const relativePath = requireSafeRelativePath(artifact.relativePath)
  const existing = references.get(relativePath)
  if (existing?.sha256 && existing.sha256 !== artifact.sha256) {
    throw new Error(`Conflicting live artifact digests for ${relativePath}.`)
  }
  references.set(relativePath, { relativePath, sha256: artifact.sha256, referenceId })
}

function parseStrictJsonArtifactRefs(text: string, label: string): AgentArtifactRef[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${label} is corrupt.`)
  }
  const artifacts: AgentArtifactRef[] = []
  collectStrictArtifactRefs(value, artifacts, '$')
  return artifacts
}

function parseStrictAuditArtifactRefs(text: string): AgentArtifactRef[] {
  const lines = text.split(/\r?\n/)
  if (lines.length > AGENT_CONVERSATION_AUDIT_MAX_LINES + 1) {
    throw new Error('Conversation audit exceeds the cleanup protection line limit.')
  }

  const artifacts: AgentArtifactRef[] = []
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    if (Buffer.byteLength(line, 'utf8') > AGENT_CONVERSATION_AUDIT_LINE_MAX_BYTES) {
      throw new Error(`Conversation audit line ${index + 1} exceeds the cleanup protection size limit.`)
    }
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error(`Conversation audit line ${index + 1} is corrupt.`)
    }
    if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).type !== 'string') {
      throw new Error(`Conversation audit line ${index + 1} has an invalid schema.`)
    }
    collectStrictArtifactRefs(value, artifacts, `$[${index}]`)
  }
  return artifacts
}

function collectStrictArtifactRefs(
  value: unknown,
  out: AgentArtifactRef[],
  context: string,
  parentKey?: string
): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectStrictArtifactRefs(item, out, `${context}[${index}]`)
    }
    return
  }

  const record = value as Record<string, unknown>
  const artifactCandidate = parentKey === 'archive' || record.kind === 'tool_result' || record.kind === 'child_transcript'
  if (artifactCandidate) {
    out.push(requireStrictArtifactRef(record, context))
    return
  }

  for (const [key, nested] of Object.entries(record)) {
    collectStrictArtifactRefs(nested, out, `${context}.${key}`, key)
  }
}

function requireStrictArtifactRef(record: Record<string, unknown>, context: string): AgentArtifactRef {
  if (record.kind !== 'tool_result' && record.kind !== 'child_transcript') {
    throw new Error(`Artifact reference at ${context} has an invalid kind.`)
  }
  if (typeof record.relativePath !== 'string') {
    throw new Error(`Artifact reference at ${context} has an invalid path.`)
  }
  const relativePath = requireSafeRelativePath(record.relativePath)
  if (typeof record.sha256 !== 'string' || !SHA256_PATTERN.test(record.sha256)) {
    throw new Error(`Artifact reference at ${context} has an invalid digest.`)
  }
  if (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0) {
    throw new Error(`Artifact reference at ${context} has an invalid byte count.`)
  }
  if (record.lines !== undefined && (!Number.isSafeInteger(record.lines) || (record.lines as number) < 0)) {
    throw new Error(`Artifact reference at ${context} has an invalid line count.`)
  }
  if (record.preview !== undefined && typeof record.preview !== 'string') {
    throw new Error(`Artifact reference at ${context} has an invalid preview.`)
  }
  if (record.archivedAt !== undefined && (
    typeof record.archivedAt !== 'string' || !Number.isFinite(Date.parse(record.archivedAt))
  )) {
    throw new Error(`Artifact reference at ${context} has an invalid archive timestamp.`)
  }

  return {
    kind: record.kind,
    relativePath,
    sha256: record.sha256,
    bytes: record.bytes as number,
    ...(record.lines !== undefined ? { lines: record.lines as number } : {}),
    ...(record.preview !== undefined ? { preview: record.preview } : {}),
    ...(record.archivedAt !== undefined ? { archivedAt: new Date(record.archivedAt).toISOString() } : {})
  }
}

async function readBoundedContainedFile(input: {
  rootPath: string
  targetPath: string
  maxBytes: number
  label: string
  optional?: boolean
}): Promise<Buffer> {
  const metadata = await lstat(input.targetPath).catch((error: unknown) => {
    if (input.optional && isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!metadata) return Buffer.alloc(0)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${input.label} must be a regular file inside the storage root.`)
  }
  if (metadata.size > input.maxBytes) {
    throw new Error(`${input.label} exceeds the cleanup protection size limit.`)
  }
  const content = await readContainedRegularFile(input.rootPath, input.targetPath)
  if (content.byteLength > input.maxBytes) {
    throw new Error(`${input.label} exceeds the cleanup protection size limit.`)
  }
  return content
}

function requireSafeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || normalized !== value || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Artifact reference path is invalid.')
  }
  return normalized
}

function isErrnoException(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}
