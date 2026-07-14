import type { Dirent } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { redactAgentSecretText } from '../shared/agent-secret-redaction'

export const AGENT_ARTIFACT_LIFECYCLE_SCHEMA_VERSION = 1
export const AGENT_ARTIFACT_CLEANUP_AUDIT_RELATIVE_PATH = '.agent-sessions/artifact-cleanup.jsonl'
export const DEFAULT_AGENT_ARTIFACT_RETENTION_DAYS = 90
export const DEFAULT_AGENT_ARTIFACT_GRACE_PERIOD_HOURS = 24
export const DEFAULT_AGENT_ARTIFACT_MAX_TOTAL_BYTES = 512 * 1024 * 1024

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MAX_RETENTION_DAYS = 10 * 365
const MAX_GRACE_PERIOD_HOURS = 30 * 24
const DEFAULT_MAX_SCAN_ENTRIES = 50_000
const DEFAULT_MAX_SCAN_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_DELETE_ENTRIES = 1_000
const MAX_SCAN_ENTRIES = 1_000_000
const MAX_SCAN_BYTES = 16 * 1024 * 1024 * 1024
const MAX_DELETE_ENTRIES = 10_000
const MAX_STAGE_BYTES = 128 * 1024
const MAX_AUDIT_LINE_BYTES = 1024 * 1024
const MAX_AUDIT_DUPLICATE_GROUPS = 128
const MAX_AUDIT_DUPLICATE_PATHS = 128
const MAX_AUDIT_ISSUES = 256
const MAX_PATH_BYTES = 2048
const HASH_CHUNK_BYTES = 64 * 1024

const ACTIVE_RUN_STATUSES = new Set([
  'running',
  'waiting_for_permission',
  'waiting_for_elicitation',
  'awaiting_conversation_save',
  'interrupted'
])
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'canceled'])
const ACTIVE_PARENT_STAGE_STATUSES = new Set([
  'running',
  'waiting_for_permission',
  'waiting_for_elicitation',
  'awaiting_conversation_save',
  'interrupted'
])
const TERMINAL_PARENT_STAGE_STATUSES = new Set(['settled', 'failed', 'canceled'])

export type AgentManagedArtifactKind =
  | 'conversation_tool_result'
  | 'conversation_child_transcript'
  | 'staged_child_transcript'
  | 'parent_turn_stage'

export type AgentArtifactCleanupReason = 'retention_expired' | 'storage_budget'
export type AgentArtifactCleanupActionStatus = 'planned' | 'deleted' | 'skipped' | 'failed'

export type AgentArtifactLiveReference = {
  relativePath: string
  sha256?: string
  referenceId?: string
}

/**
 * A protection snapshot is supplied by the service layer so conversation, checkpoint, branch,
 * audit, and active-runtime references can share one mark phase without coupling this module to
 * any one persistence schema.
 */
export type AgentArtifactProtectionSnapshot = {
  liveReferences?: readonly (string | AgentArtifactLiveReference)[]
  activeRunIds?: readonly string[]
  activeParentTurnRunIds?: readonly string[]
  activeRelativePaths?: readonly string[]
  activeRelativePathPrefixes?: readonly string[]
}

export type AgentArtifactRetentionPolicy = {
  retentionDays?: number
  gracePeriodHours?: number
  maxTotalBytes?: number
  maxScanEntries?: number
  maxScanBytes?: number
  maxDeleteEntries?: number
}

export type AgentArtifactCleanupIssue = {
  code:
    | 'audit_write_failed'
    | 'budget_unmet'
    | 'candidate_changed'
    | 'delete_failed'
    | 'invalid_active_scope'
    | 'invalid_live_reference'
    | 'live_reference_hash_mismatch'
    | 'managed_path_unsafe'
    | 'parent_stage_invalid'
    | 'protection_refresh_failed'
    | 'referenced_artifact_missing'
    | 'run_checkpoint_invalid'
    | 'scan_budget_exceeded'
    | 'scan_failed'
    | 'symlink_skipped'
  message: string
  relativePath?: string
}

export type AgentArtifactDuplicateGroup = {
  sha256: string
  relativePaths: string[]
  bytes: number
}

export type AgentArtifactCleanupAction = {
  relativePath: string
  kind: AgentManagedArtifactKind
  bytes: number
  sha256: string
  reason: AgentArtifactCleanupReason
  status: AgentArtifactCleanupActionStatus
  skipReason?: string
}

export type AgentArtifactCleanupResult = {
  schemaVersion: 1
  cleanupId: string
  dryRun: boolean
  startedAt: string
  completedAt: string
  policy: Required<AgentArtifactRetentionPolicy>
  totals: {
    scannedEntries: number
    scannedBytes: number
    protectedEntries: number
    protectedBytes: number
    plannedEntries: number
    plannedBytes: number
    deletedEntries: number
    deletedBytes: number
    remainingBytes: number
  }
  actions: AgentArtifactCleanupAction[]
  duplicates: AgentArtifactDuplicateGroup[]
  issues: AgentArtifactCleanupIssue[]
  auditRelativePath?: string
}

export type CleanupAgentArtifactsInput = {
  storageRoot: string
  dryRun?: boolean
  now?: string | Date
  policy?: AgentArtifactRetentionPolicy
  protection?: AgentArtifactProtectionSnapshot
  /** Called before mark and again immediately before a real sweep. */
  resolveProtectionSnapshot?: () => Promise<AgentArtifactProtectionSnapshot>
  writeAudit?: boolean
}

type NormalizedProtection = {
  liveReferences: Map<string, AgentArtifactLiveReference>
  activeRunIds: Set<string>
  activeParentTurnRunIds: Set<string>
  activeRelativePaths: Set<string>
  activeRelativePathPrefixes: string[]
  valid: boolean
}

type ScannedArtifact = {
  absolutePath: string
  relativePath: string
  kind: AgentManagedArtifactKind
  runId?: string
  bytes: number
  mtimeMs: number
  sha256: string
  intrinsicallyProtected: boolean
}

type ScanContext = {
  rootPath: string
  rootRealPath: string
  policy: Required<AgentArtifactRetentionPolicy>
  artifacts: ScannedArtifact[]
  issues: AgentArtifactCleanupIssue[]
  scannedDirectoryEntries: number
  scannedBytes: number
  incomplete: boolean
  runProtection: Map<string, 'active' | 'terminal' | 'unknown'>
  parentStageProtection: Set<string>
}

export async function cleanupAgentArtifacts(input: CleanupAgentArtifactsInput): Promise<AgentArtifactCleanupResult> {
  const startedAt = normalizeNow(input.now)
  const nowMs = Date.parse(startedAt)
  const policy = normalizePolicy(input.policy)
  const dryRun = input.dryRun === true
  const cleanupId = randomUUID()
  const issues: AgentArtifactCleanupIssue[] = []
  const rootPath = resolve(input.storageRoot)
  const rootRealPath = await assertStorageRoot(rootPath)
  const initialProtection = await loadProtectionSnapshot(input, issues, false)
  const scan = await scanManagedArtifacts(rootPath, rootRealPath, policy)
  issues.push(...scan.issues)

  const protection = markProtectedArtifacts(scan.artifacts, initialProtection, issues)
  const duplicates = duplicateGroups(scan.artifacts)
  const actions = scan.incomplete || !initialProtection.valid
    ? []
    : planSweep(scan.artifacts, protection, policy, nowMs, issues)
  const protectedArtifacts = scan.artifacts.filter((artifact) => protection.has(artifact.relativePath))
  const result: AgentArtifactCleanupResult = {
    schemaVersion: AGENT_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
    cleanupId,
    dryRun,
    startedAt,
    completedAt: startedAt,
    policy,
    totals: {
      scannedEntries: scan.artifacts.length,
      scannedBytes: scan.scannedBytes,
      protectedEntries: protectedArtifacts.length,
      protectedBytes: sumBytes(protectedArtifacts),
      plannedEntries: actions.length,
      plannedBytes: sumBytes(actions),
      deletedEntries: 0,
      deletedBytes: 0,
      remainingBytes: scan.scannedBytes
    },
    actions,
    duplicates,
    issues
  }

  if (dryRun) {
    result.completedAt = new Date(nowMs).toISOString()
    return result
  }

  try {
    await appendCleanupAudit(rootPath, rootRealPath, buildAuditEvent('plan', result))
    result.auditRelativePath = AGENT_ARTIFACT_CLEANUP_AUDIT_RELATIVE_PATH
  } catch (error) {
    issues.push(issue('audit_write_failed', errorMessage(error)))
    for (const action of actions) {
      action.status = 'skipped'
      action.skipReason = 'Cleanup plan was not durably audited.'
    }
    result.completedAt = new Date(nowMs).toISOString()
    return result
  }

  const refreshedProtection = await loadProtectionSnapshot(input, issues, true)
  if (!refreshedProtection.valid) {
    for (const action of actions) {
      action.status = 'skipped'
      action.skipReason = 'Protection snapshot could not be revalidated.'
    }
  } else {
    const refreshedProtectedPaths = markProtectedArtifacts(scan.artifacts, refreshedProtection, issues)
    const artifactsByPath = new Map(scan.artifacts.map((artifact) => [artifact.relativePath, artifact]))
    for (const action of actions) {
      const artifact = artifactsByPath.get(action.relativePath)
      if (!artifact) {
        action.status = 'failed'
        action.skipReason = 'Cleanup candidate disappeared from the scan plan.'
        issues.push(issue('candidate_changed', action.skipReason, action.relativePath))
        continue
      }
      if (refreshedProtectedPaths.has(action.relativePath)) {
        action.status = 'skipped'
        action.skipReason = 'Artifact became referenced or active before sweep.'
        continue
      }
      try {
        if (!await revalidateCandidate(artifact, rootRealPath)) {
          action.status = 'skipped'
          action.skipReason = 'Artifact changed after the cleanup plan was built.'
          issues.push(issue('candidate_changed', action.skipReason, action.relativePath))
          continue
        }
        await unlinkContainedArtifact(artifact, rootRealPath)
        action.status = 'deleted'
      } catch (error) {
        action.status = 'failed'
        action.skipReason = safeIssueMessage(error)
        issues.push(issue('delete_failed', action.skipReason, action.relativePath))
      }
    }
  }

  result.totals.deletedEntries = actions.filter((action) => action.status === 'deleted').length
  result.totals.deletedBytes = sumBytes(actions.filter((action) => action.status === 'deleted'))
  result.totals.remainingBytes = Math.max(0, scan.scannedBytes - result.totals.deletedBytes)
  result.completedAt = new Date(nowMs).toISOString()

  if (result.auditRelativePath) {
    try {
      await appendCleanupAudit(rootPath, rootRealPath, buildAuditEvent('result', result))
    } catch (error) {
      issues.push(issue('audit_write_failed', errorMessage(error)))
    }
  }
  return result
}

async function scanManagedArtifacts(
  rootPath: string,
  rootRealPath: string,
  policy: Required<AgentArtifactRetentionPolicy>
): Promise<ScanContext> {
  const context: ScanContext = {
    rootPath,
    rootRealPath,
    policy,
    artifacts: [],
    issues: [],
    scannedDirectoryEntries: 0,
    scannedBytes: 0,
    incomplete: false,
    runProtection: new Map(),
    parentStageProtection: new Set()
  }
  await scanRunCheckpoints(context)
  await scanParentTurnStages(context)
  await scanStagedChildTranscripts(context)
  await scanConversationArtifacts(context)
  return context
}

async function scanRunCheckpoints(context: ScanContext): Promise<void> {
  const directoryRelativePath = '.agent-sessions/runs'
  const entries = await readManagedDirectory(context, directoryRelativePath)
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const relativePath = `${directoryRelativePath}/${entry.name}`
    const fallbackRunId = entry.name.slice(0, -5)
    try {
      const value = await readBoundedJson(context, relativePath, MAX_STAGE_BYTES)
      if (value.version !== 1) throw new Error('Invalid run checkpoint schema version.')
      const runId = safeRunId(value.runId) ? value.runId : fallbackRunId
      const status = typeof value.status === 'string' ? value.status : ''
      if (!safeRunId(runId) || (!ACTIVE_RUN_STATUSES.has(status) && !TERMINAL_RUN_STATUSES.has(status))) {
        throw new Error('Invalid run checkpoint identity or status.')
      }
      context.runProtection.set(runId, ACTIVE_RUN_STATUSES.has(status) ? 'active' : 'terminal')
    } catch (error) {
      if (safeRunId(fallbackRunId)) context.runProtection.set(fallbackRunId, 'unknown')
      context.issues.push(issue('run_checkpoint_invalid', errorMessage(error), relativePath))
    }
  }
}

async function scanParentTurnStages(context: ScanContext): Promise<void> {
  const directoryRelativePath = '.agent-sessions/parent-turns'
  const entries = await readManagedDirectory(context, directoryRelativePath)
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const relativePath = `${directoryRelativePath}/${entry.name}`
    const fallbackRunId = entry.name.slice(0, -5)
    let intrinsicallyProtected = true
    let runId = safeRunId(fallbackRunId) ? fallbackRunId : undefined
    try {
      const value = await readBoundedJson(context, relativePath, MAX_STAGE_BYTES)
      if (value.schemaVersion !== 1 || !safeRunId(value.runId)) throw new Error('Invalid parent-turn staging schema.')
      if (value.runId !== fallbackRunId) throw new Error('Parent-turn staging filename does not match its run id.')
      if (typeof value.status !== 'string' ||
        (!ACTIVE_PARENT_STAGE_STATUSES.has(value.status) && !TERMINAL_PARENT_STAGE_STATUSES.has(value.status))) {
        throw new Error('Invalid parent-turn staging status.')
      }
      runId = value.runId
      intrinsicallyProtected = ACTIVE_PARENT_STAGE_STATUSES.has(value.status)
      if (intrinsicallyProtected) context.parentStageProtection.add(runId)
    } catch (error) {
      if (runId) context.parentStageProtection.add(runId)
      context.issues.push(issue('parent_stage_invalid', errorMessage(error), relativePath))
    }
    await collectArtifact(context, relativePath, 'parent_turn_stage', runId, intrinsicallyProtected)
  }
}

async function scanStagedChildTranscripts(context: ScanContext): Promise<void> {
  const baseRelativePath = '.agent-sessions/child-transcripts'
  const runEntries = await readManagedDirectory(context, baseRelativePath)
  for (const runEntry of runEntries) {
    if (!runEntry.isDirectory()) {
      if (runEntry.isSymbolicLink()) {
        context.issues.push(issue(
          'symlink_skipped',
          'Staged transcript run directory is a symbolic link.',
          `${baseRelativePath}/${runEntry.name}`
        ))
      }
      continue
    }
    const runId = runEntry.name
    const runRelativePath = `${baseRelativePath}/${runId}`
    if (!safeRunId(runId)) {
      context.issues.push(issue('managed_path_unsafe', 'Staged transcript run directory has an unsafe id.', runRelativePath))
      continue
    }
    const intrinsicallyProtected = context.runProtection.get(runId) === 'active' ||
      context.runProtection.get(runId) === 'unknown' ||
      context.parentStageProtection.has(runId)
    const transcriptEntries = await readManagedDirectory(context, runRelativePath)
    for (const transcriptEntry of transcriptEntries) {
      if (transcriptEntry.isSymbolicLink()) {
        context.issues.push(issue(
          'symlink_skipped',
          'Staged transcript artifact is a symbolic link.',
          `${runRelativePath}/${transcriptEntry.name}`
        ))
        continue
      }
      if (!transcriptEntry.isFile() || !transcriptEntry.name.endsWith('.txt')) continue
      await collectArtifact(
        context,
        `${runRelativePath}/${transcriptEntry.name}`,
        'staged_child_transcript',
        runId,
        intrinsicallyProtected
      )
    }
  }
}

async function scanConversationArtifacts(context: ScanContext): Promise<void> {
  const conversationDirectories = [
    'conversation',
    'conversations',
    'lessons/conversation',
    'lessons/conversations'
  ]
  const courseEntries = await readManagedDirectory(context, 'courses')
  for (const entry of courseEntries) {
    if (entry.isSymbolicLink()) {
      context.issues.push(issue('symlink_skipped', 'Course directory is a symbolic link.', `courses/${entry.name}`))
      continue
    }
    if (!entry.isDirectory()) continue
    conversationDirectories.push(`courses/${entry.name}/conversation`, `courses/${entry.name}/conversations`)
  }

  for (const conversationDirectory of conversationDirectories) {
    const sessionRoot = `${conversationDirectory}/.agent-sessions`
    const sessionEntries = await readManagedDirectory(context, sessionRoot)
    for (const sessionEntry of sessionEntries) {
      if (sessionEntry.isSymbolicLink()) {
        context.issues.push(issue(
          'symlink_skipped',
          'Conversation artifact directory is a symbolic link.',
          `${sessionRoot}/${sessionEntry.name}`
        ))
        continue
      }
      if (!sessionEntry.isDirectory()) continue
      const artifactRoot = `${sessionRoot}/${sessionEntry.name}`
      await scanConversationArtifactDirectory(context, `${artifactRoot}/tool-results`, 'conversation_tool_result')
      await scanConversationArtifactDirectory(context, `${artifactRoot}/child-transcripts`, 'conversation_child_transcript')
    }
  }
}

async function scanConversationArtifactDirectory(
  context: ScanContext,
  directoryRelativePath: string,
  kind: Extract<AgentManagedArtifactKind, 'conversation_tool_result' | 'conversation_child_transcript'>
): Promise<void> {
  const entries = await readManagedDirectory(context, directoryRelativePath)
  for (const entry of entries) {
    const relativePath = `${directoryRelativePath}/${entry.name}`
    if (entry.isSymbolicLink()) {
      context.issues.push(issue('symlink_skipped', 'Conversation artifact is a symbolic link.', relativePath))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.txt')) continue
    await collectArtifact(context, relativePath, kind, undefined, false)
  }
}

async function collectArtifact(
  context: ScanContext,
  relativePath: string,
  kind: AgentManagedArtifactKind,
  runId: string | undefined,
  intrinsicallyProtected: boolean
): Promise<void> {
  if (context.incomplete) return
  let normalized: string
  try {
    normalized = normalizeRelativePath(relativePath)
  } catch (error) {
    context.issues.push(issue('managed_path_unsafe', errorMessage(error), relativePath))
    return
  }
  const absolutePath = resolve(context.rootPath, ...normalized.split('/'))
  try {
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink()) {
      context.issues.push(issue('symlink_skipped', 'Managed artifact is a symbolic link.', normalized))
      return
    }
    if (!metadata.isFile()) return
    context.scannedBytes += metadata.size
    if (context.scannedBytes > context.policy.maxScanBytes) {
      context.incomplete = true
      context.issues.push(issue('scan_budget_exceeded', 'Managed artifact bytes exceed the bounded scan budget.', normalized))
      return
    }
    const real = await realpath(absolutePath)
    if (!inside(context.rootRealPath, real)) throw new Error('Managed artifact escapes the storage root.')
    const sha256 = await hashOpenedRegularFile(absolutePath, context.rootRealPath, metadata.size)
    context.artifacts.push({
      absolutePath,
      relativePath: normalized,
      kind,
      runId,
      bytes: metadata.size,
      mtimeMs: metadata.mtimeMs,
      sha256,
      intrinsicallyProtected
    })
  } catch (error) {
    if (isNotFound(error)) return
    context.issues.push(issue('scan_failed', errorMessage(error), normalized))
  }
}

async function readManagedDirectory(context: ScanContext, relativePath: string): Promise<Dirent[]> {
  if (context.incomplete) return []
  let normalized: string
  try {
    normalized = normalizeRelativePath(relativePath)
  } catch (error) {
    context.issues.push(issue('managed_path_unsafe', errorMessage(error), relativePath))
    return []
  }
  const absolutePath = resolve(context.rootPath, ...normalized.split('/'))
  try {
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink()) {
      context.issues.push(issue('symlink_skipped', 'Managed directory is a symbolic link.', normalized))
      return []
    }
    if (!metadata.isDirectory()) return []
    const real = await realpath(absolutePath)
    if (!inside(context.rootRealPath, real)) throw new Error('Managed directory escapes the storage root.')
    const entries = await readdir(absolutePath, { withFileTypes: true })
    context.scannedDirectoryEntries += entries.length
    if (context.scannedDirectoryEntries > context.policy.maxScanEntries) {
      context.incomplete = true
      context.issues.push(issue('scan_budget_exceeded', 'Managed directory entries exceed the bounded scan budget.', normalized))
      return []
    }
    return entries
  } catch (error) {
    if (isNotFound(error)) return []
    context.issues.push(issue('scan_failed', errorMessage(error), normalized))
    return []
  }
}

async function readBoundedJson(context: ScanContext, relativePath: string, maxBytes: number): Promise<Record<string, unknown>> {
  const normalized = normalizeRelativePath(relativePath)
  const absolutePath = resolve(context.rootPath, ...normalized.split('/'))
  const metadata = await lstat(absolutePath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('Expected a regular JSON file.')
  if (metadata.size > maxBytes) throw new Error('Persisted JSON exceeds its size limit.')
  const real = await realpath(absolutePath)
  if (!inside(context.rootRealPath, real)) throw new Error('Persisted JSON escapes the storage root.')
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.')
  return parsed as Record<string, unknown>
}

function markProtectedArtifacts(
  artifacts: readonly ScannedArtifact[],
  protection: NormalizedProtection,
  issues: AgentArtifactCleanupIssue[]
): Set<string> {
  const protectedPaths = new Set<string>()
  const artifactsByPath = new Map(artifacts.map((artifact) => [artifact.relativePath, artifact]))
  for (const artifact of artifacts) {
    if (artifact.intrinsicallyProtected ||
      (artifact.runId && (protection.activeRunIds.has(artifact.runId) || protection.activeParentTurnRunIds.has(artifact.runId))) ||
      protection.activeRelativePaths.has(artifact.relativePath) ||
      protection.activeRelativePathPrefixes.some((prefix) =>
        artifact.relativePath === prefix || artifact.relativePath.startsWith(`${prefix}/`)
      )) {
      protectedPaths.add(artifact.relativePath)
    }
  }
  for (const reference of protection.liveReferences.values()) {
    const artifact = artifactsByPath.get(reference.relativePath)
    if (!artifact) {
      issues.push(issue(
        'referenced_artifact_missing',
        'A live artifact reference does not resolve to a managed artifact.',
        reference.relativePath
      ))
      continue
    }
    protectedPaths.add(artifact.relativePath)
    if (reference.sha256 && reference.sha256 !== artifact.sha256) {
      issues.push(issue(
        'live_reference_hash_mismatch',
        'A live artifact reference digest does not match the persisted file.',
        artifact.relativePath
      ))
    }
  }
  return protectedPaths
}

function planSweep(
  artifacts: readonly ScannedArtifact[],
  protectedPaths: ReadonlySet<string>,
  policy: Required<AgentArtifactRetentionPolicy>,
  nowMs: number,
  issues: AgentArtifactCleanupIssue[]
): AgentArtifactCleanupAction[] {
  const retentionMs = policy.retentionDays * DAY_MS
  const graceMs = policy.gracePeriodHours * HOUR_MS
  const available = artifacts
    .filter((artifact) => !protectedPaths.has(artifact.relativePath))
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.relativePath.localeCompare(right.relativePath))
  const selected = new Map<string, AgentArtifactCleanupAction>()

  for (const artifact of available) {
    const ageMs = Math.max(0, nowMs - artifact.mtimeMs)
    if (ageMs < retentionMs || ageMs < graceMs) continue
    if (selected.size >= policy.maxDeleteEntries) break
    selected.set(artifact.relativePath, toAction(artifact, 'retention_expired'))
  }

  let remainingBytes = sumBytes(artifacts) - sumBytes([...selected.values()])
  if (remainingBytes > policy.maxTotalBytes) {
    for (const artifact of available) {
      if (remainingBytes <= policy.maxTotalBytes || selected.size >= policy.maxDeleteEntries) break
      if (selected.has(artifact.relativePath)) continue
      const ageMs = Math.max(0, nowMs - artifact.mtimeMs)
      if (ageMs < graceMs) continue
      selected.set(artifact.relativePath, toAction(artifact, 'storage_budget'))
      remainingBytes -= artifact.bytes
    }
  }

  if (remainingBytes > policy.maxTotalBytes) {
    issues.push(issue(
      'budget_unmet',
      `Managed artifacts remain above the ${policy.maxTotalBytes}-byte storage budget because protected, grace-period, or per-run deletion limits apply.`
    ))
  }
  return [...selected.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function duplicateGroups(artifacts: readonly ScannedArtifact[]): AgentArtifactDuplicateGroup[] {
  const groups = new Map<string, ScannedArtifact[]>()
  for (const artifact of artifacts) {
    const group = groups.get(artifact.sha256) ?? []
    group.push(artifact)
    groups.set(artifact.sha256, group)
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([sha256, group]) => ({
      sha256,
      relativePaths: group.map((artifact) => artifact.relativePath).sort(),
      bytes: sumBytes(group)
    }))
    .sort((left, right) => left.sha256.localeCompare(right.sha256))
}

async function loadProtectionSnapshot(
  input: CleanupAgentArtifactsInput,
  issues: AgentArtifactCleanupIssue[],
  refresh: boolean
): Promise<NormalizedProtection> {
  let dynamic: AgentArtifactProtectionSnapshot = {}
  if (input.resolveProtectionSnapshot) {
    try {
      dynamic = await input.resolveProtectionSnapshot()
    } catch (error) {
      issues.push(issue(
        'protection_refresh_failed',
        `${refresh ? 'Pre-sweep' : 'Initial'} protection snapshot failed: ${errorMessage(error)}`
      ))
      return emptyProtection(false)
    }
  }
  return normalizeProtection(mergeProtection(input.protection, dynamic), issues)
}

function normalizeProtection(
  snapshot: AgentArtifactProtectionSnapshot,
  issues: AgentArtifactCleanupIssue[]
): NormalizedProtection {
  const normalized = emptyProtection(true)
  for (const value of snapshot.liveReferences ?? []) {
    const reference = typeof value === 'string' ? { relativePath: value } : value
    try {
      const relativePath = normalizeRelativePath(reference.relativePath)
      if (reference.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(reference.sha256)) {
        throw new Error('Live artifact reference has an invalid digest.')
      }
      normalized.liveReferences.set(relativePath, { ...reference, relativePath })
    } catch (error) {
      normalized.valid = false
      issues.push(issue('invalid_live_reference', errorMessage(error), safeRelativePathForIssue(reference.relativePath)))
    }
  }
  for (const runId of snapshot.activeRunIds ?? []) {
    if (!safeRunId(runId)) {
      normalized.valid = false
      issues.push(issue('invalid_active_scope', 'Active run id is unsafe.'))
    } else {
      normalized.activeRunIds.add(runId)
    }
  }
  for (const runId of snapshot.activeParentTurnRunIds ?? []) {
    if (!safeRunId(runId)) {
      normalized.valid = false
      issues.push(issue('invalid_active_scope', 'Active parent-turn run id is unsafe.'))
    } else {
      normalized.activeParentTurnRunIds.add(runId)
    }
  }
  for (const value of snapshot.activeRelativePaths ?? []) {
    try {
      normalized.activeRelativePaths.add(normalizeRelativePath(value))
    } catch (error) {
      normalized.valid = false
      issues.push(issue('invalid_active_scope', errorMessage(error), safeRelativePathForIssue(value)))
    }
  }
  for (const value of snapshot.activeRelativePathPrefixes ?? []) {
    try {
      normalized.activeRelativePathPrefixes.push(normalizeRelativePath(value))
    } catch (error) {
      normalized.valid = false
      issues.push(issue('invalid_active_scope', errorMessage(error), safeRelativePathForIssue(value)))
    }
  }
  normalized.activeRelativePathPrefixes.sort()
  return normalized
}

function mergeProtection(
  left: AgentArtifactProtectionSnapshot | undefined,
  right: AgentArtifactProtectionSnapshot
): AgentArtifactProtectionSnapshot {
  return {
    liveReferences: [...(left?.liveReferences ?? []), ...(right.liveReferences ?? [])],
    activeRunIds: [...(left?.activeRunIds ?? []), ...(right.activeRunIds ?? [])],
    activeParentTurnRunIds: [...(left?.activeParentTurnRunIds ?? []), ...(right.activeParentTurnRunIds ?? [])],
    activeRelativePaths: [...(left?.activeRelativePaths ?? []), ...(right.activeRelativePaths ?? [])],
    activeRelativePathPrefixes: [
      ...(left?.activeRelativePathPrefixes ?? []),
      ...(right.activeRelativePathPrefixes ?? [])
    ]
  }
}

async function revalidateCandidate(artifact: ScannedArtifact, rootRealPath: string): Promise<boolean> {
  const metadata = await lstat(artifact.absolutePath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) return false
  if (metadata.size !== artifact.bytes || metadata.mtimeMs !== artifact.mtimeMs) return false
  const parentRealPath = await realpath(dirname(artifact.absolutePath))
  if (!inside(rootRealPath, parentRealPath)) return false
  const fileRealPath = await realpath(artifact.absolutePath)
  if (!inside(rootRealPath, fileRealPath)) return false
  return await hashOpenedRegularFile(artifact.absolutePath, rootRealPath, artifact.bytes) === artifact.sha256
}

async function unlinkContainedArtifact(artifact: ScannedArtifact, rootRealPath: string): Promise<void> {
  const parentRealPath = await realpath(dirname(artifact.absolutePath))
  if (!inside(rootRealPath, parentRealPath)) throw new Error('Artifact parent escaped the storage root before deletion.')
  const metadata = await lstat(artifact.absolutePath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('Artifact is no longer a regular file.')
  await unlink(artifact.absolutePath)
}

async function hashOpenedRegularFile(absolutePath: string, rootRealPath: string, expectedBytes: number): Promise<string> {
  const file = await open(absolutePath, fsConstants.O_RDONLY)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size !== expectedBytes) throw new Error('Artifact changed while it was being inspected.')
    const real = await realpath(absolutePath)
    if (!inside(rootRealPath, real)) throw new Error('Artifact escapes the storage root.')
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(1, expectedBytes)))
    let position = 0
    while (position < expectedBytes) {
      const length = Math.min(buffer.length, expectedBytes - position)
      const { bytesRead } = await file.read(buffer, 0, length, position)
      if (bytesRead <= 0) throw new Error('Artifact changed while it was being hashed.')
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } finally {
    await file.close()
  }
}

async function appendCleanupAudit(rootPath: string, rootRealPath: string, event: Record<string, unknown>): Promise<void> {
  const relativePath = normalizeRelativePath(AGENT_ARTIFACT_CLEANUP_AUDIT_RELATIVE_PATH)
  const absolutePath = resolve(rootPath, ...relativePath.split('/'))
  const directory = dirname(absolutePath)
  await ensureContainedDirectory(directory, rootPath, rootRealPath)
  const line = `${JSON.stringify(event)}\n`
  if (Buffer.byteLength(line, 'utf8') > MAX_AUDIT_LINE_BYTES) throw new Error('Cleanup audit event exceeds its size limit.')
  const parentRealPath = await realpath(directory)
  if (!inside(rootRealPath, parentRealPath)) throw new Error('Cleanup audit path escapes the storage root.')
  const existing = await lstat(absolutePath).catch((error: unknown) => {
    if (isNotFound(error)) return null
    throw error
  })
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new Error('Cleanup audit path is not a regular file.')
  }
  await appendFile(absolutePath, line, { encoding: 'utf8', mode: 0o600 })
}

async function ensureContainedDirectory(directory: string, rootPath: string, rootRealPath: string): Promise<void> {
  if (!inside(rootPath, directory)) throw new Error('Cleanup audit directory escapes the storage root.')
  const rel = relative(rootPath, directory)
  let current = rootPath
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part)
    const metadata = await lstat(current).catch((error: unknown) => {
      if (isNotFound(error)) return null
      throw error
    })
    if (metadata?.isSymbolicLink()) throw new Error('Cleanup audit directory contains a symbolic link.')
    if (metadata && !metadata.isDirectory()) throw new Error('Cleanup audit parent is not a directory.')
    if (!metadata) await mkdir(current, { mode: 0o700 })
    const currentRealPath = await realpath(current)
    if (!inside(rootRealPath, currentRealPath)) throw new Error('Cleanup audit directory escapes the storage root.')
  }
}

function buildAuditEvent(stage: 'plan' | 'result', result: AgentArtifactCleanupResult): Record<string, unknown> {
  return {
    schemaVersion: AGENT_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
    type: stage === 'plan' ? 'agent_artifact_cleanup_plan' : 'agent_artifact_cleanup_result',
    cleanupId: result.cleanupId,
    timestamp: stage === 'plan' ? result.startedAt : result.completedAt,
    policy: result.policy,
    totals: result.totals,
    actions: result.actions.map((action) => ({
      relativePath: action.relativePath,
      kind: action.kind,
      bytes: action.bytes,
      sha256: action.sha256,
      reason: action.reason,
      status: action.status,
      ...(action.skipReason ? { error: safeIssueMessage(action.skipReason) } : {})
    })),
    duplicates: result.duplicates.slice(0, MAX_AUDIT_DUPLICATE_GROUPS).map((duplicate) => ({
      sha256: duplicate.sha256,
      bytes: duplicate.bytes,
      relativePaths: duplicate.relativePaths.slice(0, MAX_AUDIT_DUPLICATE_PATHS),
      omittedPaths: Math.max(0, duplicate.relativePaths.length - MAX_AUDIT_DUPLICATE_PATHS)
    })),
    omittedDuplicateGroups: Math.max(0, result.duplicates.length - MAX_AUDIT_DUPLICATE_GROUPS),
    issues: result.issues.slice(0, MAX_AUDIT_ISSUES).map((item) => ({
      code: item.code,
      ...(item.relativePath ? { relativePath: item.relativePath } : {}),
      error: safeIssueMessage(item.message)
    })),
    omittedIssues: Math.max(0, result.issues.length - MAX_AUDIT_ISSUES)
  }
}

function normalizePolicy(value: AgentArtifactRetentionPolicy | undefined): Required<AgentArtifactRetentionPolicy> {
  return {
    retentionDays: boundedNumber(
      value?.retentionDays ?? DEFAULT_AGENT_ARTIFACT_RETENTION_DAYS,
      0,
      MAX_RETENTION_DAYS,
      'retentionDays'
    ),
    gracePeriodHours: boundedNumber(
      value?.gracePeriodHours ?? DEFAULT_AGENT_ARTIFACT_GRACE_PERIOD_HOURS,
      0,
      MAX_GRACE_PERIOD_HOURS,
      'gracePeriodHours'
    ),
    maxTotalBytes: boundedInteger(
      value?.maxTotalBytes ?? DEFAULT_AGENT_ARTIFACT_MAX_TOTAL_BYTES,
      1,
      Number.MAX_SAFE_INTEGER,
      'maxTotalBytes'
    ),
    maxScanEntries: boundedInteger(
      value?.maxScanEntries ?? DEFAULT_MAX_SCAN_ENTRIES,
      1,
      MAX_SCAN_ENTRIES,
      'maxScanEntries'
    ),
    maxScanBytes: boundedInteger(value?.maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES, 1, MAX_SCAN_BYTES, 'maxScanBytes'),
    maxDeleteEntries: boundedInteger(
      value?.maxDeleteEntries ?? DEFAULT_MAX_DELETE_ENTRIES,
      1,
      MAX_DELETE_ENTRIES,
      'maxDeleteEntries'
    )
  }
}

async function assertStorageRoot(rootPath: string): Promise<string> {
  const metadata = await lstat(rootPath)
  if (!metadata.isDirectory()) throw new Error('Artifact lifecycle storage root must be a directory.')
  return realpath(rootPath)
}

function normalizeNow(value: string | Date | undefined): string {
  const parsed = value instanceof Date ? value : new Date(value ?? Date.now())
  if (!Number.isFinite(parsed.getTime())) throw new Error('Artifact lifecycle now timestamp is invalid.')
  return parsed.toISOString()
}

function normalizeRelativePath(value: string): string {
  if (typeof value !== 'string') throw new Error('Persisted artifact path must be a string.')
  if (Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) throw new Error('Persisted artifact path is too long.')
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!normalized || normalized.includes('\0') || isAbsolute(normalized)) throw new Error('Persisted artifact path is unsafe.')
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Persisted artifact path is unsafe.')
  return parts.join('/')
}

function safeRelativePathForIssue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return normalizeRelativePath(value)
  } catch {
    return undefined
  }
}

function safeRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
}

function toAction(artifact: ScannedArtifact, reason: AgentArtifactCleanupReason): AgentArtifactCleanupAction {
  return {
    relativePath: artifact.relativePath,
    kind: artifact.kind,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    reason,
    status: 'planned'
  }
}

function emptyProtection(valid: boolean): NormalizedProtection {
  return {
    liveReferences: new Map(),
    activeRunIds: new Set(),
    activeParentTurnRunIds: new Set(),
    activeRelativePaths: new Set(),
    activeRelativePathPrefixes: [],
    valid
  }
}

function issue(
  code: AgentArtifactCleanupIssue['code'],
  message: string,
  relativePath?: string
): AgentArtifactCleanupIssue {
  return {
    code,
    message: safeIssueMessage(message),
    ...(relativePath ? { relativePath } : {})
  }
}

function safeIssueMessage(value: unknown): string {
  return redactAgentSecretText(errorMessage(value)).replace(/[\r\n]+/g, ' ').slice(0, 1000)
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function boundedNumber(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number between ${min} and ${max}.`)
  }
  return value
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite integer between ${min} and ${max}.`)
  }
  return value
}

function sumBytes(values: readonly { bytes: number }[]): number {
  return values.reduce((sum, value) => sum + value.bytes, 0)
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
  )
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
