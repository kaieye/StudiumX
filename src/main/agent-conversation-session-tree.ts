import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { agentConversationMarkdownRelativePath, describeAgentConversationPath } from '../shared/agent-conversation-catalog'
import type {
  AgentChatTurn,
  AgentConversationBranchMetadata,
  AgentConversationBranchStatus,
  AgentConversationForkPoint,
  AgentConversationRecord,
  AgentConversationReplaySource,
  AgentConversationSessionTree,
  AgentConversationSessionTreeNode
} from '../shared/teaching-types'
import { isPathInsideRoot } from './path-access'
import {
  listPersistedAgentConversationRecords,
  nextAgentConversationId,
  readAgentConversationRecord,
  readRawAgentConversationRecord,
  requireSafeAgentConversationId,
  writeAgentConversationRecord,
  type AgentConversationWorkspace,
  type PersistedAgentConversationRecord
} from './teaching-agent-conversations'
import type { AgentStagedChildTranscriptAllowance } from './agent-conversation-session-audit'

export const AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH = '.agent-sessions/session-open-state.v1.json'
export const AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES = 64 * 1024
const MAX_OPEN_STATE_ENTRIES = 256
const SAFE_LINEAGE_ID = /^[A-Za-z0-9._:-]{1,160}$/
const SAFE_TURN_ID = /^[A-Za-z0-9._:-]{1,240}$/
const SHA256 = /^[a-f0-9]{64}$/
const pendingRootOperations = new Map<string, Promise<void>>()

type BranchAwareConversationRecord = AgentConversationRecord & {
  branch?: AgentConversationBranchMetadata
}

type BranchMetadataInput = Partial<AgentConversationBranchMetadata> & Record<string, unknown>

type InternalSessionTreeNode = {
  sessionId: string
  conversationId: string
  branchId: string
  title: string
  parentBranchId?: string
  childBranchIds: string[]
  headTurnId?: string
  revision: number
  status: AgentConversationBranchStatus
  forkPoint?: AgentConversationForkPoint
  replaySource?: AgentConversationReplaySource
  relativePath: string
  updatedAt: string
  record: AgentConversationRecord
}

type InternalSessionTree = {
  schemaVersion: 1
  sessionId: string
  rootBranchId: string
  nodes: InternalSessionTreeNode[]
}

export type AgentConversationReplayProjection = {
  turns: AgentChatTurn[]
  forkPoint: AgentConversationForkPoint
  replaySource: AgentConversationReplaySource
}

export type AgentConversationOpenStateEntry = {
  sessionId: string
  branchId: string
  updatedAt: string
}

export type AgentConversationOpenState = {
  schemaVersion: 1
  sessions: AgentConversationOpenStateEntry[]
  integrity: {
    algorithm: 'sha256'
    digest: string
  }
}

export type AgentConversationOpenIssue = {
  code: 'open_state_invalid' | 'open_branch_unavailable'
  message: string
  repaired: true
}

export type AgentConversationOpenResult = {
  tree: AgentConversationSessionTree
  node: AgentConversationSessionTreeNode
  record: AgentConversationRecord
  selectedBy: 'requested' | 'stored' | 'root' | 'fallback'
  issues: AgentConversationOpenIssue[]
}

export class AgentConversationSessionTreeError extends Error {
  readonly code:
    | 'invalid_metadata'
    | 'duplicate_branch'
    | 'missing_root'
    | 'multiple_roots'
    | 'missing_parent'
    | 'invalid_lineage'
    | 'invalid_source_turn'
    | 'source_digest_mismatch'
    | 'replay_projection_mismatch'
    | 'cycle'
    | 'session_not_found'

  constructor(code: AgentConversationSessionTreeError['code'], message: string) {
    super(message)
    this.name = 'AgentConversationSessionTreeError'
    this.code = code
  }
}

export class AgentConversationOpenStateError extends Error {
  readonly code: 'invalid_path' | 'unsupported_version' | 'too_large' | 'invalid_json' | 'invalid_schema' | 'integrity_mismatch'

  constructor(code: AgentConversationOpenStateError['code'], message: string) {
    super(message)
    this.name = 'AgentConversationOpenStateError'
    this.code = code
  }
}

export class AgentConversationBranchRevisionConflictError extends Error {
  readonly expectedRevision: number
  readonly currentRevision: number

  constructor(expectedRevision: number, currentRevision: number) {
    super(`Conversation branch revision conflict: expected ${expectedRevision}, current ${currentRevision}.`)
    this.name = 'AgentConversationBranchRevisionConflictError'
    this.expectedRevision = expectedRevision
    this.currentRevision = currentRevision
  }
}

/** Legacy records become single active roots; persisted branch metadata remains authoritative. */
export function inferAgentConversationBranchMetadata(
  record: Pick<AgentConversationRecord, 'id'> & { branch?: AgentConversationBranchMetadata }
): AgentConversationBranchMetadata {
  const id = requireExactConversationId(record.id, 'conversation id')
  return record.branch === undefined
    ? {
        schemaVersion: 1,
        sessionId: id,
        branchId: id,
        revision: 0,
        status: 'active'
      }
    : normalizeAgentConversationBranchMetadata(record.branch, id)
}

export function normalizeAgentConversationBranchMetadata(
  value: unknown,
  conversationId: string
): AgentConversationBranchMetadata {
  const id = requireExactConversationId(conversationId, 'conversation id')
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentConversationSessionTreeError('invalid_metadata', `Branch metadata for conversation "${id}" is invalid.`)
  }
  const record = value as BranchMetadataInput
  if (record.schemaVersion !== 1) {
    throw new AgentConversationSessionTreeError('invalid_metadata', `Branch "${id}" has an unsupported schema version.`)
  }
  const sessionId = requireExactConversationId(record.sessionId, 'session id')
  const branchId = requireExactConversationId(record.branchId, 'branch id')
  if (branchId !== id) {
    throw new AgentConversationSessionTreeError(
      'invalid_metadata',
      `Branch metadata id "${branchId}" does not match conversation id "${id}".`
    )
  }
  const revision = requireNonNegativeInteger(record.revision, `Branch "${id}" revision`)
  const status = requireBranchStatus(record.status, id)
  const parentBranchId = record.parentBranchId === undefined
    ? undefined
    : requireExactConversationId(record.parentBranchId, 'parent branch id')
  const forkPoint = record.forkPoint === undefined ? undefined : normalizeForkPoint(record.forkPoint, id)
  const replaySource = record.replaySource === undefined ? undefined : normalizeReplaySource(record.replaySource, id)
  const lineageParts = [parentBranchId, forkPoint, replaySource].filter((item) => item !== undefined).length
  if (lineageParts !== 0 && lineageParts !== 3) {
    throw new AgentConversationSessionTreeError(
      'invalid_lineage',
      `Branch "${id}" must persist parentBranchId, forkPoint, and replaySource together.`
    )
  }
  if (parentBranchId === branchId) {
    throw new AgentConversationSessionTreeError('invalid_lineage', `Branch "${id}" cannot be its own parent.`)
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

export function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set<object>()))
}

export function digestAgentConversationReplaySource(turns: readonly AgentChatTurn[]): string {
  const projection = {
    schemaVersion: 1,
    turns: turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      createdAt: turn.createdAt
    }))
  }
  return sha256(stableCanonicalJson(projection))
}

/**
 * Creates a text-only replay prefix. It never calls a tool and deliberately
 * drops tool/process data, artifact-bearing metadata, run ids, and child runs.
 */
export function projectAgentConversationReplay(input: {
  source: AgentConversationRecord
  sourceTurnId?: string
  replayId: string
  createdAt: string
}): AgentConversationReplayProjection {
  const source = input.source as BranchAwareConversationRecord
  const metadata = inferAgentConversationBranchMetadata(source)
  if (metadata.status === 'deleted') throw new Error('Deleted conversation branches cannot be replayed.')
  const replayId = requireLineageId(input.replayId, 'replay id')
  const createdAt = requireTimestamp(input.createdAt, 'replay timestamp')
  const sourceTurns = selectReplayPrefix(source.turns, input.sourceTurnId)
  if (sourceTurns.length === 0) throw new Error('A conversation branch cannot be replayed without a source turn.')
  const actualSourceTurnId = requireTurnId(sourceTurns.at(-1)?.id, 'source turn id')
  const sourceDigest = digestAgentConversationReplaySource(sourceTurns)
  const sourceTurnCount = sourceTurns.length
  const turns = sourceTurns.map((turn, index): AgentChatTurn => {
    const sourceTurnId = requireTurnId(turn.id, 'source turn id')
    return {
      id: replayTurnId(replayId, source.id, metadata.branchId, sourceTurnId, index),
      role: turn.role,
      content: turn.content,
      createdAt: turn.createdAt,
      metadata: {
        version: 1,
        provenance: {
          kind: 'replayed',
          sourceConversationId: source.id,
          sourceBranchId: metadata.branchId,
          sourceTurnId,
          replayId
        }
      }
    }
  })
  const forkPoint: AgentConversationForkPoint = {
    sourceConversationId: source.id,
    sourceBranchId: metadata.branchId,
    sourceTurnId: actualSourceTurnId,
    sourceTurnCount,
    sourceDigest
  }
  const replaySource: AgentConversationReplaySource = {
    replayId,
    sourceConversationId: source.id,
    sourceBranchId: metadata.branchId,
    sourceTurnCount,
    sourceDigest,
    createdAt,
    toolsReplayed: false,
    archivedRetrievalPromoted: false,
    providerHistoryInjected: false,
    memoryWritten: false
  }
  return { turns, forkPoint, replaySource }
}

export function rebuildAgentConversationSessionTrees(
  persisted: readonly PersistedAgentConversationRecord[]
): InternalSessionTree[] {
  const bySession = new Map<string, PersistedAgentConversationRecord[]>()
  for (const item of persisted) {
    const metadata = inferAgentConversationBranchMetadata(item.record as BranchAwareConversationRecord)
    const records = bySession.get(metadata.sessionId) ?? []
    records.push(item)
    bySession.set(metadata.sessionId, records)
  }
  return [...bySession.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sessionId, records]) => rebuildAgentConversationSessionTree(records, sessionId))
}

export function rebuildAgentConversationSessionTree(
  persisted: readonly PersistedAgentConversationRecord[],
  sessionId: string
): InternalSessionTree {
  const safeSessionId = requireExactConversationId(sessionId, 'session id')
  const nodesByBranch = new Map<string, InternalSessionTreeNode>()
  for (const item of persisted) {
    const record = item.record as BranchAwareConversationRecord
    const jsonPath = describeAgentConversationPath(item.jsonRelativePath)
    const markdownPath = describeAgentConversationPath(record.relativePath)
    if (!jsonPath || jsonPath.format !== 'json' || jsonPath.id !== record.id ||
        !markdownPath || markdownPath.format !== 'markdown' || markdownPath.id !== record.id ||
        jsonPath.directoryRelativePath !== markdownPath.directoryRelativePath) {
      throw new AgentConversationSessionTreeError(
        'invalid_metadata',
        `Conversation "${record.id}" persistence paths are not bound to its id.`
      )
    }
    const metadata = inferAgentConversationBranchMetadata(record)
    if (metadata.sessionId !== safeSessionId) continue
    if (nodesByBranch.has(metadata.branchId)) {
      throw new AgentConversationSessionTreeError(
        'duplicate_branch',
        `Session "${safeSessionId}" contains duplicate branch "${metadata.branchId}" records.`
      )
    }
    nodesByBranch.set(metadata.branchId, {
      sessionId: metadata.sessionId,
      conversationId: record.id,
      branchId: metadata.branchId,
      title: record.title,
      parentBranchId: metadata.parentBranchId,
      childBranchIds: [],
      headTurnId: record.turns.at(-1)?.id,
      revision: metadata.revision,
      status: metadata.status,
      forkPoint: metadata.forkPoint,
      replaySource: metadata.replaySource,
      relativePath: record.relativePath,
      updatedAt: record.updatedAt,
      record
    })
  }
  if (nodesByBranch.size === 0) {
    throw new AgentConversationSessionTreeError('session_not_found', `Conversation session "${safeSessionId}" was not found.`)
  }

  const roots: InternalSessionTreeNode[] = []
  for (const node of nodesByBranch.values()) {
    if (!node.parentBranchId) {
      roots.push(node)
      continue
    }
    const parent = nodesByBranch.get(node.parentBranchId)
    if (!parent) {
      throw new AgentConversationSessionTreeError(
        'missing_parent',
        `Branch "${node.branchId}" references missing parent branch "${node.parentBranchId}".`
      )
    }
    parent.childBranchIds.push(node.branchId)
    validateBranchLineage(node, parent)
  }

  if (roots.length === 0) {
    throw new AgentConversationSessionTreeError('missing_root', `Session "${safeSessionId}" has no root branch.`)
  }
  if (roots.length !== 1) {
    throw new AgentConversationSessionTreeError(
      'multiple_roots',
      `Session "${safeSessionId}" has ${roots.length} root branches; exactly one is required.`
    )
  }
  const root = roots[0]
  if (root.branchId !== safeSessionId) {
    throw new AgentConversationSessionTreeError(
      'invalid_lineage',
      `Session "${safeSessionId}" root branch must use the session id, found "${root.branchId}".`
    )
  }
  for (const node of nodesByBranch.values()) node.childBranchIds.sort((left, right) => left.localeCompare(right))
  const ordered = orderTreeNodes(root, nodesByBranch)
  return {
    schemaVersion: 1,
    sessionId: safeSessionId,
    rootBranchId: root.branchId,
    nodes: ordered
  }
}

export async function listAgentConversationSessionTreesAtRoot(
  rootPath: string
): Promise<AgentConversationSessionTree[]> {
  return runAgentConversationRootExclusive(rootPath, async () => {
    const internalTrees = rebuildAgentConversationSessionTrees(await listPersistedAgentConversationRecords(rootPath))
    const state = await readOrRepairAgentConversationOpenStateUnlocked(rootPath, internalTrees)
    return internalTrees.map((tree) => {
      const storedBranchId = state?.sessions.find((entry) => entry.sessionId === tree.sessionId)?.branchId
      return toSharedSessionTree(tree, selectActiveOpenBranchId(tree, storedBranchId))
    })
  })
}

export async function readAgentConversationSessionTreeAtRoot(
  rootPath: string,
  sessionId: string
): Promise<AgentConversationSessionTree> {
  return runAgentConversationRootExclusive(rootPath, async () => {
    const safeSessionId = requireExactConversationId(sessionId, 'session id')
    const internalTrees = rebuildAgentConversationSessionTrees(await listPersistedAgentConversationRecords(rootPath))
    const internalTree = internalTrees.find((tree) => tree.sessionId === safeSessionId)
    if (!internalTree) {
      throw new AgentConversationSessionTreeError('session_not_found', `Conversation session "${safeSessionId}" was not found.`)
    }
    const state = await readOrRepairAgentConversationOpenStateUnlocked(rootPath, internalTrees)
    const storedBranchId = state?.sessions.find((entry) => entry.sessionId === internalTree.sessionId)?.branchId
    return toSharedSessionTree(internalTree, selectActiveOpenBranchId(internalTree, storedBranchId))
  })
}


/** Reads a source branch and returns its safe, non-executing replay projection without persisting it. */
export async function replayAgentConversationBranchAtRoot(
  rootPath: string,
  sourceConversationId: string,
  options: {
    sourceTurnId?: string
    replayId?: string
    now?: string
  } = {}
): Promise<AgentConversationReplayProjection> {
  const source = await readRawAgentConversationRecord(rootPath, requireExactConversationId(sourceConversationId, 'source conversation id'))
  return projectAgentConversationReplay({
    source,
    sourceTurnId: options.sourceTurnId,
    replayId: options.replayId ?? `replay-${randomUUID()}`,
    createdAt: options.now ?? new Date().toISOString()
  })
}

export async function forkAgentConversationBranchAtRoot(
  workspace: AgentConversationWorkspace,
  sourceConversationId: string,
  options: {
    sourceTurnId?: string
    title?: string
    now?: string
    expectedRevision?: number
    createConversationId?: (rootPath: string, title: string, timestamp: string) => string | Promise<string>
    replayId?: string
  } = {}
): Promise<AgentConversationRecord> {
  return runAgentConversationRootExclusive(workspace.rootPath, async () => {
    const source = await readRawAgentConversationRecord(
      workspace.rootPath,
      requireExactConversationId(sourceConversationId, 'source conversation id')
    ) as BranchAwareConversationRecord
    const sourceMetadata = inferAgentConversationBranchMetadata(source)
    if (sourceMetadata.status === 'deleted') throw new Error('Deleted conversation branches cannot be forked.')
    assertRequiredExpectedRevision(sourceMetadata.revision, options.expectedRevision)
    const now = requireTimestamp(options.now ?? new Date().toISOString(), 'fork timestamp')
    const title = options.title?.trim() || `${source.title} (fork)`
    const allocate = options.createConversationId ?? nextAgentConversationId
    const newId = requireExactConversationId(await allocate(workspace.rootPath, title, now), 'fork conversation id')
    const persisted = await listPersistedAgentConversationRecords(workspace.rootPath)
    if (persisted.some((item) => item.record.id === newId)) {
      throw new Error(`Conversation branch "${newId}" already exists.`)
    }
    const replayId = requireLineageId(options.replayId ?? `replay-${randomUUID()}`, 'replay id')
    const projection = projectAgentConversationReplay({
      source,
      sourceTurnId: options.sourceTurnId,
      replayId,
      createdAt: now
    })
    const sourcePath = describeAgentConversationPath(source.relativePath)
    if (!sourcePath || sourcePath.format !== 'markdown' || sourcePath.id !== source.id) {
      throw new Error('Source conversation path is not bound to its conversation id.')
    }

    // Materialize inferred metadata before a legacy root gains descendants. Keeping
    // revision 0 makes a failed first fork safely retryable with the same CAS token.
    if (!source.branch) {
      const upgradedSource: BranchAwareConversationRecord = {
        ...source,
        branch: sourceMetadata
      }
      await writeAgentConversationRecord(workspace, upgradedSource)
      source.branch = sourceMetadata
      const persistedSource = persisted.find((item) => item.record.id === source.id)
      if (persistedSource) persistedSource.record = upgradedSource
    }

    const relativePath = agentConversationMarkdownRelativePath(newId, sourcePath.directoryRelativePath)
    const record: BranchAwareConversationRecord = {
      id: newId,
      workspaceId: source.workspaceId ?? workspace.id,
      title,
      createdAt: now,
      updatedAt: now,
      relativePath,
      absolutePath: join(workspace.rootPath, relativePath),
      messageCount: projection.turns.length,
      branch: {
        schemaVersion: 1,
        sessionId: sourceMetadata.sessionId,
        branchId: newId,
        revision: 1,
        status: 'active',
        parentBranchId: sourceMetadata.branchId,
        forkPoint: projection.forkPoint,
        replaySource: projection.replaySource
      },
      turns: projection.turns
    }
    validateCandidateConversationRecord(persisted, record, sourceMetadata.sessionId)
    await writeAgentConversationRecord(workspace, record)
    return record
  })
}

export async function saveAgentConversationBranchAtRoot(
  workspace: AgentConversationWorkspace,
  record: AgentConversationRecord,
  options: {
    expectedRevision?: number
    allowedStagedChildTranscripts?: readonly AgentStagedChildTranscriptAllowance[]
  } = {}
): Promise<AgentConversationRecord> {
  return runAgentConversationRootExclusive(workspace.rootPath, async () => {
    const id = requireExactConversationId(record.id, 'conversation id')
    const current = await readRawAgentConversationRecord(workspace.rootPath, id) as BranchAwareConversationRecord
    const currentMetadata = inferAgentConversationBranchMetadata(current)
    if (currentMetadata.status === 'deleted') throw new Error('Deleted conversation branches cannot be saved.')
    if (currentMetadata.status === 'archived') throw new Error('Archived conversation branches must be restored before saving.')
    assertRequiredExpectedRevision(currentMetadata.revision, options.expectedRevision)
    const next: BranchAwareConversationRecord = {
      ...record,
      id: current.id,
      workspaceId: current.workspaceId ?? record.workspaceId ?? workspace.id,
      createdAt: current.createdAt,
      relativePath: current.relativePath,
      absolutePath: join(workspace.rootPath, current.relativePath),
      branch: {
        ...currentMetadata,
        revision: currentMetadata.revision + 1
      }
    }
    const persisted = await listPersistedAgentConversationRecords(workspace.rootPath)
    validateCandidateConversationRecord(persisted, next, currentMetadata.sessionId)
    await writeAgentConversationRecord(workspace, next, {
      allowedStagedChildTranscripts: options.allowedStagedChildTranscripts
    })
    return next
  })
}

export async function updateAgentConversationBranchStatusAtRoot(
  workspace: AgentConversationWorkspace,
  conversationId: string,
  status: AgentConversationBranchStatus,
  options: { expectedRevision?: number } = {}
): Promise<AgentConversationRecord> {
  return runAgentConversationRootExclusive(workspace.rootPath, async () => {
    const id = requireExactConversationId(conversationId, 'conversation id')
    const targetStatus = requireBranchStatus(status, id)
    const current = await readRawAgentConversationRecord(workspace.rootPath, id) as BranchAwareConversationRecord
    const metadata = inferAgentConversationBranchMetadata(current)
    const expectedRevision = requireExpectedRevision(options.expectedRevision)

    // A response may be lost after the canonical JSON commit but before every
    // archive projection is verified. The same-state retry is therefore a repair
    // operation and accepts the immediately preceding CAS token.
    if (targetStatus === metadata.status) {
      if (expectedRevision !== metadata.revision && expectedRevision !== metadata.revision - 1) {
        throw new AgentConversationBranchRevisionConflictError(expectedRevision, metadata.revision)
      }
      const repairRecord: BranchAwareConversationRecord = current.branch
        ? current
        : { ...current, branch: metadata }
      await writeAgentConversationRecord(workspace, repairRecord)
      return repairRecord
    }

    assertExpectedRevision(metadata.revision, expectedRevision)
    if (metadata.status === 'deleted') {
      throw new Error('Deleted conversation branches are tombstones and cannot be restored.')
    }
    if (targetStatus === 'archived' && metadata.status !== 'active') {
      throw new Error('Only active conversation branches can be archived.')
    }
    if (targetStatus === 'active' && metadata.status !== 'archived') {
      throw new Error('Only archived conversation branches can be restored.')
    }
    if (metadata.status === 'active' && targetStatus !== 'active') {
      const sessionTree = await readInternalSessionTreeAtRoot(workspace.rootPath, metadata.sessionId)
      const hasActiveFallback = sessionTree.nodes.some((node) => (
        node.branchId !== metadata.branchId && node.status === 'active'
      ))
      if (!hasActiveFallback) {
        throw new Error('The last active conversation branch cannot be archived or deleted.')
      }
    }
    const next: BranchAwareConversationRecord = {
      ...current,
      branch: {
        ...metadata,
        revision: metadata.revision + 1,
        status: targetStatus
      }
    }
    const persisted = await listPersistedAgentConversationRecords(workspace.rootPath)
    validateCandidateConversationRecord(persisted, next, metadata.sessionId)
    await writeAgentConversationRecord(workspace, next)
    return next
  })
}




export async function readAgentConversationOpenStateAtRoot(
  rootPath: string
): Promise<AgentConversationOpenState | null> {
  return runAgentConversationRootExclusive(rootPath, () => readAgentConversationOpenStateAtRootUnlocked(rootPath))
}

export async function writeAgentConversationOpenStateAtRoot(
  rootPath: string,
  entries: readonly AgentConversationOpenStateEntry[]
): Promise<AgentConversationOpenState> {
  return runAgentConversationRootExclusive(rootPath, () => writeAgentConversationOpenStateAtRootUnlocked(rootPath, entries))
}

async function readAgentConversationOpenStateAtRootUnlocked(
  rootPath: string
): Promise<AgentConversationOpenState | null> {
  const targetPath = openStatePath(rootPath)
  const targetStats = await lstat(targetPath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!targetStats) return null
  if (targetStats.isSymbolicLink() || !targetStats.isFile()) {
    throw new AgentConversationOpenStateError('invalid_path', 'Conversation open-state sidecar must be a regular file.')
  }
  if (targetStats.size > AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES) {
    throw new AgentConversationOpenStateError(
      'too_large',
      `Conversation open-state sidecar exceeds ${AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES} bytes.`
    )
  }
  await assertExistingPathContained(rootPath, targetPath)
  const text = await readFile(targetPath, 'utf8')
  if (Buffer.byteLength(text, 'utf8') > AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES) {
    throw new AgentConversationOpenStateError(
      'too_large',
      `Conversation open-state sidecar exceeds ${AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES} bytes.`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AgentConversationOpenStateError('invalid_json', 'Conversation open-state sidecar contains invalid JSON.')
  }
  return normalizeOpenState(parsed)
}

async function writeAgentConversationOpenStateAtRootUnlocked(
  rootPath: string,
  entries: readonly AgentConversationOpenStateEntry[]
): Promise<AgentConversationOpenState> {
  const sessions = compactOpenStateEntries(entries)
  const payload = { schemaVersion: 1 as const, sessions }
  const state: AgentConversationOpenState = {
    ...payload,
    integrity: {
      algorithm: 'sha256',
      digest: sha256(stableCanonicalJson(payload))
    }
  }
  const serialized = `${JSON.stringify(state, null, 2)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES) {
    throw new AgentConversationOpenStateError(
      'too_large',
      `Conversation open-state sidecar exceeds ${AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES} bytes.`
    )
  }
  const targetPath = openStatePath(rootPath)
  const directory = dirname(targetPath)
  await ensureContainedOpenStateDirectory(rootPath, directory)
  await assertReplaceableTargetContained(rootPath, targetPath)
  const temporaryPath = join(directory, `.session-open-state.v1.${randomUUID()}.tmp`)
  if (!isPathInsideRoot(rootPath, temporaryPath)) {
    throw new AgentConversationOpenStateError('invalid_path', 'Conversation open-state temporary path escapes the workspace.')
  }
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, targetPath)
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
  return state
}

export async function openAgentConversationBranchAtRoot(
  rootPath: string,
  sessionId: string,
  options: {
    requestedBranchId?: string
    now?: string
    repairInvalidOpenState?: boolean
  } = {}
): Promise<AgentConversationOpenResult> {
  return runAgentConversationRootExclusive(rootPath, () => openAgentConversationBranchAtRootUnlocked(rootPath, sessionId, options))
}

async function openAgentConversationBranchAtRootUnlocked(
  rootPath: string,
  sessionId: string,
  options: {
    requestedBranchId?: string
    now?: string
    repairInvalidOpenState?: boolean
  }
): Promise<AgentConversationOpenResult> {
  const internalTree = await readInternalSessionTreeAtRoot(rootPath, sessionId)
  const nodes = new Map(internalTree.nodes.map((node) => [node.branchId, node]))
  const issues: AgentConversationOpenIssue[] = []
  const requestedBranchId = options.requestedBranchId === undefined
    ? undefined
    : requireExactConversationId(options.requestedBranchId, 'requested branch id')
  if (requestedBranchId) {
    const requested = nodes.get(requestedBranchId)
    if (!requested) {
      throw new Error(`Requested conversation branch "${requestedBranchId}" was not found in session "${internalTree.sessionId}".`)
    }
    if (requested.status === 'deleted') throw new Error('Deleted conversation branches cannot be opened.')
    if (requested.status !== 'active') throw new Error('Archived conversation branches must be restored before opening.')
  }

  let state: AgentConversationOpenState | null = null
  try {
    state = await readAgentConversationOpenStateAtRootUnlocked(rootPath)
  } catch (error) {
    if (options.repairInvalidOpenState === false) throw error
    const message = error instanceof Error ? error.message : 'Conversation open-state sidecar is invalid.'
    issues.push({ code: 'open_state_invalid', message, repaired: true })
  }

  const storedEntry = state?.sessions.find((entry) => entry.sessionId === internalTree.sessionId)
  const storedNode = storedEntry ? nodes.get(storedEntry.branchId) : undefined
  if (storedEntry && (!storedNode || storedNode.status !== 'active')) {
    issues.push({
      code: 'open_branch_unavailable',
      message: `Stored open branch "${storedEntry.branchId}" is unavailable; an active fallback was selected.`,
      repaired: true
    })
  }

  let selectedBy: AgentConversationOpenResult['selectedBy']
  let node: InternalSessionTreeNode | undefined
  if (requestedBranchId) {
    node = nodes.get(requestedBranchId)
    selectedBy = 'requested'
  } else if (storedNode?.status === 'active') {
    node = storedNode
    selectedBy = 'stored'
  } else {
    const root = nodes.get(internalTree.rootBranchId)
    if (root?.status === 'active') {
      node = root
      selectedBy = 'root'
    } else {
      node = internalTree.nodes.find((candidate) => candidate.status === 'active')
      selectedBy = 'fallback'
    }
  }
  if (!node) throw new Error(`Conversation session "${internalTree.sessionId}" has no active branch to open.`)

  const now = requireTimestamp(options.now ?? new Date().toISOString(), 'open-state timestamp')
  const preservedEntries = state?.sessions.filter((entry) => entry.sessionId !== internalTree.sessionId) ?? []
  const nextEntries = [...preservedEntries, { sessionId: internalTree.sessionId, branchId: node.branchId, updatedAt: now }]
  const shouldWrite = !state || storedEntry?.branchId !== node.branchId || requestedBranchId !== undefined || issues.length > 0
  if (shouldWrite) await writeAgentConversationOpenStateAtRootUnlocked(rootPath, nextEntries)
  const tree = toSharedSessionTree(internalTree, node.branchId)
  const sharedNode = tree.branches.find((branch) => branch.branchId === node?.branchId)
  if (!sharedNode) throw new Error(`Opened conversation branch "${node.branchId}" disappeared from the rebuilt tree.`)
  const hydratedRecord = await readAgentConversationRecord(rootPath, node.conversationId)
  return { tree, node: sharedNode, record: hydratedRecord, selectedBy, issues }
}


function normalizeForkPoint(value: unknown, branchId: string): AgentConversationForkPoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentConversationSessionTreeError('invalid_lineage', `Branch "${branchId}" fork point is invalid.`)
  }
  const record = value as Record<string, unknown>
  return {
    sourceConversationId: requireExactConversationId(record.sourceConversationId, 'source conversation id'),
    sourceBranchId: requireExactConversationId(record.sourceBranchId, 'source branch id'),
    sourceTurnId: record.sourceTurnId === undefined ? undefined : requireTurnId(record.sourceTurnId, 'source turn id'),
    sourceTurnCount: requireNonNegativeInteger(record.sourceTurnCount, `Branch "${branchId}" source turn count`),
    sourceDigest: requireSha256(record.sourceDigest, `Branch "${branchId}" source digest`)
  }
}

function normalizeReplaySource(value: unknown, branchId: string): AgentConversationReplaySource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentConversationSessionTreeError('invalid_lineage', `Branch "${branchId}" replay source is invalid.`)
  }
  const record = value as Record<string, unknown>
  if (record.toolsReplayed !== false || record.archivedRetrievalPromoted !== false ||
      record.providerHistoryInjected !== false || record.memoryWritten !== false) {
    throw new AgentConversationSessionTreeError(
      'invalid_lineage',
      `Branch "${branchId}" replay safety flags must all be false.`
    )
  }
  return {
    replayId: requireLineageId(record.replayId, 'replay id'),
    sourceConversationId: requireExactConversationId(record.sourceConversationId, 'source conversation id'),
    sourceBranchId: requireExactConversationId(record.sourceBranchId, 'source branch id'),
    sourceTurnCount: requireNonNegativeInteger(record.sourceTurnCount, `Branch "${branchId}" replay turn count`),
    sourceDigest: requireSha256(record.sourceDigest, `Branch "${branchId}" replay digest`),
    createdAt: requireTimestamp(record.createdAt, 'replay timestamp'),
    toolsReplayed: false,
    archivedRetrievalPromoted: false,
    providerHistoryInjected: false,
    memoryWritten: false
  }
}

function validateBranchLineage(
  node: InternalSessionTreeNode,
  parent: InternalSessionTreeNode
): void {
  const fork = node.forkPoint
  const replay = node.replaySource
  if (!fork || !replay || !node.parentBranchId) {
    throw new AgentConversationSessionTreeError('invalid_lineage', `Branch "${node.branchId}" has incomplete lineage metadata.`)
  }
  if (fork.sourceBranchId !== parent.branchId || fork.sourceConversationId !== parent.conversationId ||
      replay.sourceBranchId !== parent.branchId || replay.sourceConversationId !== parent.conversationId) {
    throw new AgentConversationSessionTreeError(
      'invalid_lineage',
      `Branch "${node.branchId}" lineage does not reference parent branch "${parent.branchId}" consistently.`
    )
  }
  if (fork.sourceTurnCount <= 0 || replay.sourceTurnCount !== fork.sourceTurnCount ||
      replay.sourceDigest !== fork.sourceDigest) {
    throw new AgentConversationSessionTreeError(
      'invalid_lineage',
      `Branch "${node.branchId}" fork point and replay source disagree.`
    )
  }
  const sourcePrefix = selectReplayPrefix(parent.record.turns, fork.sourceTurnId)
  if (sourcePrefix.length !== fork.sourceTurnCount) {
    throw new AgentConversationSessionTreeError(
      'invalid_source_turn',
      `Branch "${node.branchId}" source prefix length is ${sourcePrefix.length}, expected ${fork.sourceTurnCount}.`
    )
  }
  const actualDigest = digestAgentConversationReplaySource(sourcePrefix)
  if (actualDigest !== fork.sourceDigest) {
    throw new AgentConversationSessionTreeError(
      'source_digest_mismatch',
      `Branch "${node.branchId}" source prefix digest does not match parent branch "${parent.branchId}".`
    )
  }
  validatePersistedReplayPrefix(node, sourcePrefix, replay)
}

function validatePersistedReplayPrefix(
  node: InternalSessionTreeNode,
  sourcePrefix: readonly AgentChatTurn[],
  replay: AgentConversationReplaySource
): void {
  if (node.record.turns.length < sourcePrefix.length) {
    throw new AgentConversationSessionTreeError(
      'replay_projection_mismatch',
      `Branch "${node.branchId}" does not contain its complete replay prefix.`
    )
  }
  for (const [index, source] of sourcePrefix.entries()) {
    const replayed = node.record.turns[index]
    const provenance = replayed?.metadata?.provenance
    const onlyReplayMetadata = replayed?.metadata && Object.entries(replayed.metadata)
      .every(([key, value]) => key === 'version' || key === 'provenance' || value === undefined)
    if (!replayed || replayed.role !== source.role || replayed.content !== source.content || replayed.createdAt !== source.createdAt ||
        replayed.toolCalls !== undefined || replayed.processEvents !== undefined || !onlyReplayMetadata ||
        provenance?.kind !== 'replayed' || provenance.sourceConversationId !== replay.sourceConversationId ||
        provenance.sourceBranchId !== replay.sourceBranchId || provenance.sourceTurnId !== source.id ||
        provenance.replayId !== replay.replayId) {
      throw new AgentConversationSessionTreeError(
        'replay_projection_mismatch',
        `Branch "${node.branchId}" replay turn ${index + 1} is not a safe projection of its source prefix.`
      )
    }
  }
}

function orderTreeNodes(
  root: InternalSessionTreeNode,
  nodes: ReadonlyMap<string, InternalSessionTreeNode>
): InternalSessionTreeNode[] {
  const ordered: InternalSessionTreeNode[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (node: InternalSessionTreeNode): void => {
    if (visiting.has(node.branchId)) {
      throw new AgentConversationSessionTreeError('cycle', `Session tree contains a cycle at branch "${node.branchId}".`)
    }
    if (visited.has(node.branchId)) return
    visiting.add(node.branchId)
    ordered.push(node)
    for (const childId of node.childBranchIds) {
      const child = nodes.get(childId)
      if (!child) {
        throw new AgentConversationSessionTreeError('missing_parent', `Session tree child branch "${childId}" is missing.`)
      }
      visit(child)
    }
    visiting.delete(node.branchId)
    visited.add(node.branchId)
  }
  visit(root)
  if (visited.size !== nodes.size) {
    const unreachable = [...nodes.keys()].filter((branchId) => !visited.has(branchId)).sort()
    throw new AgentConversationSessionTreeError(
      'cycle',
      `Session tree contains unreachable or cyclic branches: ${unreachable.join(', ')}.`
    )
  }
  return ordered
}

function selectReplayPrefix(turns: readonly AgentChatTurn[], sourceTurnId?: string): AgentChatTurn[] {
  if (sourceTurnId === undefined) return [...turns]
  const safeTurnId = requireTurnId(sourceTurnId, 'source turn id')
  const matches = turns.reduce<number[]>((indices, turn, index) => {
    if (turn.id === safeTurnId) indices.push(index)
    return indices
  }, [])
  if (matches.length === 0) throw new Error(`Source turn "${safeTurnId}" was not found.`)
  if (matches.length > 1) throw new Error(`Source turn "${safeTurnId}" is ambiguous because it appears more than once.`)
  return turns.slice(0, matches[0] + 1)
}

function replayTurnId(
  replayId: string,
  sourceConversationId: string,
  sourceBranchId: string,
  sourceTurnId: string,
  index: number
): string {
  return `replay-${sha256(stableCanonicalJson({ replayId, sourceConversationId, sourceBranchId, sourceTurnId, index })).slice(0, 32)}`
}

async function readOrRepairAgentConversationOpenStateUnlocked(
  rootPath: string,
  trees: readonly InternalSessionTree[]
): Promise<AgentConversationOpenState | null> {
  let state: AgentConversationOpenState | null = null
  let corrupted = false
  try {
    state = await readAgentConversationOpenStateAtRootUnlocked(rootPath)
  } catch {
    corrupted = true
  }
  if (!state && !corrupted) return null

  const treesBySession = new Map(trees.map((tree) => [tree.sessionId, tree]))
  const nextEntries: AgentConversationOpenStateEntry[] = []
  let repaired = corrupted
  for (const entry of state?.sessions ?? []) {
    const tree = treesBySession.get(entry.sessionId)
    if (!tree) {
      repaired = true
      continue
    }
    const selected = selectActiveOpenBranchId(tree, entry.branchId)
    if (selected !== entry.branchId) repaired = true
    nextEntries.push({ ...entry, branchId: selected })
    treesBySession.delete(entry.sessionId)
  }
  if (corrupted) {
    const now = new Date().toISOString()
    for (const tree of treesBySession.values()) {
      nextEntries.push({
        sessionId: tree.sessionId,
        branchId: selectActiveOpenBranchId(tree),
        updatedAt: now
      })
    }
  }
  return repaired
    ? writeAgentConversationOpenStateAtRootUnlocked(rootPath, nextEntries)
    : state
}

function compactOpenStateEntries(
  entries: readonly AgentConversationOpenStateEntry[]
): AgentConversationOpenStateEntry[] {
  const latestBySession = new Map<string, AgentConversationOpenStateEntry>()
  for (const entry of entries) {
    const normalized = normalizeOpenStateEntries([entry])[0]
    const existing = latestBySession.get(normalized.sessionId)
    if (!existing || existing.updatedAt <= normalized.updatedAt) {
      latestBySession.set(normalized.sessionId, normalized)
    }
  }
  return [...latestBySession.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.sessionId.localeCompare(right.sessionId))
    .slice(0, MAX_OPEN_STATE_ENTRIES)
}

function normalizeOpenState(value: unknown): AgentConversationOpenState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentConversationOpenStateError('invalid_schema', 'Conversation open-state sidecar must contain an object.')
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) {
    throw new AgentConversationOpenStateError('unsupported_version', 'Conversation open-state schema version is unsupported.')
  }
  assertOnlyKeys(record, ['schemaVersion', 'sessions', 'integrity'], 'Conversation open-state sidecar')
  const sessions = normalizeOpenStateEntries(record.sessions)
  if (!record.integrity || typeof record.integrity !== 'object' || Array.isArray(record.integrity)) {
    throw new AgentConversationOpenStateError('invalid_schema', 'Conversation open-state integrity metadata is invalid.')
  }
  const integrity = record.integrity as Record<string, unknown>
  assertOnlyKeys(integrity, ['algorithm', 'digest'], 'Conversation open-state integrity metadata')
  if (integrity.algorithm !== 'sha256' || typeof integrity.digest !== 'string' || !SHA256.test(integrity.digest)) {
    throw new AgentConversationOpenStateError('invalid_schema', 'Conversation open-state integrity metadata is invalid.')
  }
  const expected = sha256(stableCanonicalJson({ schemaVersion: 1, sessions }))
  if (integrity.digest !== expected) {
    throw new AgentConversationOpenStateError('integrity_mismatch', 'Conversation open-state integrity check failed.')
  }
  return {
    schemaVersion: 1,
    sessions,
    integrity: { algorithm: 'sha256', digest: integrity.digest }
  }
}

function normalizeOpenStateEntries(value: unknown): AgentConversationOpenStateEntry[] {
  if (!Array.isArray(value) || value.length > MAX_OPEN_STATE_ENTRIES) {
    throw new AgentConversationOpenStateError('invalid_schema', 'Conversation open-state sessions are invalid or exceed the entry limit.')
  }
  const seen = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AgentConversationOpenStateError('invalid_schema', `Conversation open-state entry ${index + 1} is invalid.`)
    }
    const entry = item as Record<string, unknown>
    assertOnlyKeys(entry, ['sessionId', 'branchId', 'updatedAt'], `Conversation open-state entry ${index + 1}`)
    const sessionId = requireOpenStateConversationId(entry.sessionId, 'session id')
    const branchId = requireOpenStateConversationId(entry.branchId, 'branch id')
    const updatedAt = requireOpenStateTimestamp(entry.updatedAt)
    if (seen.has(sessionId)) {
      throw new AgentConversationOpenStateError('invalid_schema', `Conversation open-state session "${sessionId}" is duplicated.`)
    }
    seen.add(sessionId)
    return { sessionId, branchId, updatedAt }
  })
}

function openStatePath(rootPath: string): string {
  if (typeof rootPath !== 'string' || !rootPath.trim()) {
    throw new AgentConversationOpenStateError('invalid_path', 'Workspace root path is required.')
  }
  const absoluteRoot = resolve(rootPath)
  const targetPath = resolve(absoluteRoot, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)
  if (!isPathInsideRoot(absoluteRoot, targetPath)) {
    throw new AgentConversationOpenStateError('invalid_path', 'Conversation open-state path escapes the workspace.')
  }
  return targetPath
}

async function ensureContainedOpenStateDirectory(rootPath: string, directory: string): Promise<void> {
  const absoluteRoot = resolve(rootPath)
  const rootStats = await stat(absoluteRoot)
  if (!rootStats.isDirectory()) throw new AgentConversationOpenStateError('invalid_path', 'Workspace root is not a directory.')
  if (!isPathInsideRoot(absoluteRoot, directory)) {
    throw new AgentConversationOpenStateError('invalid_path', 'Conversation open-state directory escapes the workspace.')
  }
  await mkdir(directory, { recursive: true })
  const directoryStats = await lstat(directory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new AgentConversationOpenStateError('invalid_path', 'Conversation open-state directory must be a real directory.')
  }
  await assertExistingPathContained(absoluteRoot, directory)
}

async function assertReplaceableTargetContained(rootPath: string, targetPath: string): Promise<void> {
  const targetStats = await lstat(targetPath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!targetStats) return
  if (targetStats.isSymbolicLink() || !targetStats.isFile()) {
    throw new AgentConversationOpenStateError('invalid_path', 'Conversation open-state target must be a regular file.')
  }
  await assertExistingPathContained(rootPath, targetPath)
}

async function assertExistingPathContained(rootPath: string, targetPath: string): Promise<void> {
  const absoluteRoot = resolve(rootPath)
  const absoluteTarget = resolve(targetPath)
  if (!isPathInsideRoot(absoluteRoot, absoluteTarget)) {
    throw new AgentConversationOpenStateError('invalid_path', 'Conversation open-state path escapes the workspace.')
  }
  const [realRoot, realTarget] = await Promise.all([realpath(absoluteRoot), realpath(absoluteTarget)])
  const relation = relative(realRoot, realTarget)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new AgentConversationOpenStateError('invalid_path', 'Conversation open-state path escapes the workspace after resolving links.')
  }
}

async function readInternalSessionTreeAtRoot(rootPath: string, sessionId: string): Promise<InternalSessionTree> {
  return rebuildAgentConversationSessionTree(await listPersistedAgentConversationRecords(rootPath), sessionId)
}

function validateCandidateConversationRecord(
  persisted: readonly PersistedAgentConversationRecord[],
  candidate: AgentConversationRecord,
  sessionId: string
): void {
  const candidatePath = describeAgentConversationPath(candidate.relativePath)
  if (!candidatePath || candidatePath.format !== 'markdown' || candidatePath.id !== candidate.id) {
    throw new Error('Conversation record path is not bound to its conversation id.')
  }
  let replaced = false
  const next = persisted.map((item) => {
    if (item.record.id !== candidate.id) return item
    if (replaced) throw new AgentConversationSessionTreeError(
      'duplicate_branch',
      `Conversation "${candidate.id}" has multiple persisted records.`
    )
    replaced = true
    return { ...item, record: candidate }
  })
  if (!replaced) {
    next.push({
      jsonRelativePath: candidate.relativePath.replace(/\.md$/i, '.json'),
      record: candidate
    })
  }
  rebuildAgentConversationSessionTree(next, sessionId)
}

function selectActiveOpenBranchId(
  tree: InternalSessionTree,
  storedBranchId?: string
): string {
  if (storedBranchId) {
    const stored = tree.nodes.find((node) => node.branchId === storedBranchId)
    if (stored?.status === 'active') return stored.branchId
  }
  const root = tree.nodes.find((node) => node.branchId === tree.rootBranchId)
  if (root?.status === 'active') return root.branchId
  const fallback = tree.nodes.find((node) => node.status === 'active')
  if (!fallback) throw new Error(`Conversation session "${tree.sessionId}" has no active branch to open.`)
  return fallback.branchId
}

function toSharedSessionTree(tree: InternalSessionTree, openBranchId: string): AgentConversationSessionTree {
  return {
    schemaVersion: 1,
    sessionId: tree.sessionId,
    openBranchId,
    branches: tree.nodes.map((node): AgentConversationSessionTreeNode => ({
      sessionId: node.sessionId,
      branchId: node.branchId,
      conversationId: node.conversationId,
      title: node.title,
      status: node.status,
      revision: node.revision,
      parentBranchId: node.parentBranchId,
      forkPoint: node.forkPoint,
      replaySource: node.replaySource,
      head: {
        turnId: node.headTurnId,
        turnCount: node.record.turns.length,
        updatedAt: node.updatedAt
      },
      relativePath: node.relativePath,
      isOpen: node.branchId === openBranchId
    }))
  }
}

function canonicalize(value: unknown, stack: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') throw new TypeError('BigInt cannot be encoded as canonical JSON.')
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value !== 'object') return value
  const object = value as object
  if (stack.has(object)) throw new TypeError('Cyclic values cannot be encoded as canonical JSON.')
  stack.add(object)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalize(item, stack) ?? null)
    }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = canonicalize((value as Record<string, unknown>)[key], stack)
      if (item !== undefined) out[key] = item
    }
    return out
  } finally {
    stack.delete(object)
  }
}

function requireExactConversationId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error(`${label} is invalid.`)
  const normalized = requireSafeAgentConversationId(value)
  if (normalized !== value) throw new Error(`${label} is invalid.`)
  return value
}

function requireOpenStateConversationId(value: unknown, label: string): string {
  try {
    return requireExactConversationId(value, label)
  } catch {
    throw new AgentConversationOpenStateError('invalid_schema', `Conversation open-state ${label} is invalid.`)
  }
}

function requireLineageId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !SAFE_LINEAGE_ID.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function requireTurnId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !SAFE_TURN_ID.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`)
  return value
}

function requireBranchStatus(value: unknown, branchId: string): AgentConversationBranchStatus {
  if (value !== 'active' && value !== 'archived' && value !== 'deleted') {
    throw new AgentConversationSessionTreeError('invalid_metadata', `Branch "${branchId}" status is invalid.`)
  }
  return value
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

function requireTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) throw new Error(`${label} is invalid.`)
  return value
}

function requireOpenStateTimestamp(value: unknown): string {
  try {
    return requireTimestamp(value, 'updatedAt')
  } catch {
    throw new AgentConversationOpenStateError('invalid_schema', 'Conversation open-state updatedAt is invalid.')
  }
}

function requireExpectedRevision(expectedRevision: number | undefined): number {
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision ?? -1) < 0) {
    throw new Error('Expected branch revision is required and must be a non-negative integer.')
  }
  return expectedRevision as number
}

function assertRequiredExpectedRevision(currentRevision: number, expectedRevision: number | undefined): void {
  assertExpectedRevision(currentRevision, requireExpectedRevision(expectedRevision))
}

function assertExpectedRevision(currentRevision: number, expectedRevision: number | undefined): void {
  if (expectedRevision === undefined) return
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Expected branch revision is invalid.')
  if (currentRevision !== expectedRevision) {
    throw new AgentConversationBranchRevisionConflictError(expectedRevision, currentRevision)
  }
}

function assertOnlyKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const allowed = new Set(expected)
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new AgentConversationOpenStateError('invalid_schema', `${label} contains unsupported fields.`)
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function runAgentConversationRootExclusive<T>(rootPath: string, operation: () => Promise<T>): Promise<T> {
  const key = resolve(rootPath).replace(/\\/g, '/').toLowerCase()
  const previous = pendingRootOperations.get(key) ?? Promise.resolve()
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const queued = previous.catch(() => undefined).then(() => gate)
  pendingRootOperations.set(key, queued)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release?.()
    if (pendingRootOperations.get(key) === queued) pendingRootOperations.delete(key)
  }
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
