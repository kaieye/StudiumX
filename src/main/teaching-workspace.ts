import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { defaultSettings } from './teaching-settings'
import { TeachingMemoryStore } from './teaching-memory'
import { createLearningSessionLedger, type LearningSessionLedger } from './learning-session-ledger'
import { createLearningOutcomeCommitter, type LearningOutcomeCommitter } from './learning-outcome-committer'
import { createLessonInteractionRecorder } from './lesson-interaction-recorder'
import { inspectGitWorkspace } from './teaching-git'
import {
  buildCourseSummaries,
  buildWorkspaceCatalog
} from './teaching-workspace-catalog'
import { planLessonIndexReconciliation } from './teaching-workspace/catalog-reconciliation'
import { runLessonGenerationPipeline, type LessonGenerationCallbacks } from './teaching-lesson-generation'
import { finalizeLessonArtifactPublication } from './teaching-lesson-artifacts'
import {
  cleanText,
  normalizeWorkspaceRelativePath,
  type WorkspacePathMeta
} from './teaching-workspace-paths'
import {
  agentParentTurnDigest,
  attachAgentParentTurnCommit,
  deriveConversationTitle,
  hasAgentParentTurnCommit,
  inferAgentConversationBranchMetadata,
  ensureTeachingContentDirectories,
  listAgentConversations,
  nextAgentConversationId,
  normalizeAgentConversationTurns,
  readAgentConversationRecord,
  readRawAgentConversationRecord,
  listPersistedAgentConversationRecords,
  requireCanonicalAgentConversationId,
  requireSafeAgentConversationId,
  sortAgentConversationSummaries,
  toAgentConversationSummary,
  writeAgentConversationRecord
} from './teaching-agent-conversations'
import {
  runTeachingConversationTurn,
  type TeachingConversationRuntimeStream,
  type TemporaryChatContext
} from './teaching-conversation-runtime'
import { AgentRunStore } from './ai/agent-run-store'
import type { AgentStagedChildTranscriptAllowance } from './agent-conversation-session-audit'
import { createAgentConversationCheckpoint, resolveAgentConversationCheckpoint } from './agent-conversation-checkpoints'
import {
  forkAgentConversationBranchAtRoot,
  openAgentConversationBranchAtRoot,
  readAgentConversationSessionTreeAtRoot,
  replayAgentConversationBranchAtRoot,
  saveAgentConversationBranchAtRoot,
  updateAgentConversationBranchStatusAtRoot
} from './agent-conversation-session-tree'
import { cleanupAgentArtifacts as runAgentArtifactCleanup } from './agent-artifact-lifecycle'
import {
  AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH,
  queryAgentArchivedHistory as queryArchivedHistoryAtRoot,
  rebuildAgentConversationHistoryIndex
} from './agent-conversation-history'
import { collectAgentArtifactProtectionSnapshot } from './agent-artifact-protection'
import type { SkillLibraryService } from './skill-library'
import type { LessonPlanSource } from '../shared/lesson-schema'
import {
  lessonStyleCss,
  normalizeLessonStyleId
} from '../shared/lesson-styles'
import type { LessonBrief } from '../shared/teaching-workflow'
import { activeLearnerProfileLines } from '../shared/teaching-personalization'
import { createPreviewLessonInteraction } from '../shared/preview-markdown-bridge'
import {
  normalizePreviewLessonInteractionIntent,
  type LessonInteraction,
  type PreviewLessonInteractionIntent,
  type PreviewLessonInteractionReceipt
} from '../shared/teaching-types/lesson-interaction'
import type { LearningSessionSnapshot } from '../shared/teaching-types/learning-session'
import type { LearningOutcomeCommitResult } from '../shared/teaching-types/learning-outcome'
import type { CommitLearningOutcomeRequest } from '../shared/teaching-types/system-api'
import { isLearningSessionId } from '../shared/teaching-placement'
import {
  agentConversationDirectoryRelativePath,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationMarkdownRelativePath,
  isRootAgentConversationMarkdownRelativePath,
  isTemporaryAgentConversationPath,
  normalizeAgentConversationDirectory
} from '../shared/agent-conversation-catalog'
import {
  EMPTY_REGISTRY,
  applyRegistryWorkspaceMeta,
  assertSafeWorkspaceRootForRemoval,
  findWorkspace,
  orderRegistryWorkspaces,
  touchRegistryWorkspace,
  visibleRegistryWorkspaces,
  type RegistryWorkspace,
  type WorkspaceRegistry
} from './teaching-workspace/registry'
import {
  appendSessionEvent as appendWorkspaceSessionEvent,
  atomicWriteFile,
  deriveWorkspaceTopic,
  ensureWorkspaceStructure as ensureWorkspaceLifecycleStructure,
  loadWorkspaceIndex as loadWorkspaceLifecycleIndex,
  renderMission,
  saveWorkspaceIndex as saveWorkspaceLifecycleIndex,
  type SessionEvent,
  type WorkspaceIndex
} from './teaching-workspace/lifecycle'
import { TeachingWorkspaceItemLifecycleExecutor } from './teaching-workspace/item-lifecycle-executor'
import { TeachingWorkspaceActivationLifecycle } from './teaching-workspace/activation-lifecycle'
import { TeachingWorkspaceReviewDeck } from './teaching-workspace/review'
import { TeachingWorkspaceChangeAudit } from './teaching-workspace-change-audit'
import {
  TeachingWorkspaceDocuments,
  previewUrlForDocument,
  type WorkspacePreviewFile
} from './teaching-workspace-documents'
export type { WorkspacePreviewFile } from './teaching-workspace-documents'
import type { AnalyticsWorkspaceScanResult } from './teaching/services/learning-analytics'
import { buildConnectorStatuses } from './connector-status'
import type {
  ApplyLessonStylePayload,
  AgentArchivedHistoryIssue,
  AgentConversationCheckpoint,
  AgentConversationSessionTree,
  AgentConversationStorageScope,
  CleanupAgentArtifactsPayload,
  CleanupAgentArtifactsResult,
  CreateAgentConversationCheckpointPayload,
  ForkAgentConversationBranchPayload,
  ForkAgentConversationBranchResult,
  OpenAgentConversationBranchPayload,
  OpenAgentConversationBranchResult,
  QueryAgentArchivedHistoryPayload,
  QueryAgentArchivedHistoryResult,
  RebuildAgentHistoryIndexPayload,
  RebuildAgentHistoryIndexResult,
  ResolveAgentConversationCheckpointPayload,
  ResolveAgentConversationCheckpointResult,
  ConnectorStatusesResult,
  CreateWorkspacePayload,
  CreateTeachingMemoryPayload,
  GenerateLessonPayload,
  GenerateLessonResult,
  GenerateLessonStreamPayload,
  GetProgressResult,
  LessonStreamChunk,
  LessonStreamStatus,
  LessonSummary,
  ListReviewCardsResult,
  ReadLessonPayload,
  ReadLessonResult,
  RecordProgressPayload,
  AgentConversationRecord,
  AgentConversationSummary,
  AgentChatMessage,
  AgentChatTurn,
  AgentChatStreamPayload,
  AgentChatStreamResult,
  ReadAgentConversationPayload,
  ReadAgentConversationSessionTreePayload,
  ReplayAgentConversationBranchPayload,
  ReplayAgentConversationBranchResult,
  SaveAgentConversationPayload,
  SaveAgentConversationResult,
  ReadWorkspaceMarkdownPayload,
  SaveWorkspaceMarkdownPayload,
  SaveWorkspaceMarkdownResult,
  TeachingMemoryDiagnostics,
  TeachingMemoryRecord,
  TeachingAppState,
  TeachingRuntimeState,
  TeachingSettingsV1,
  TeachingWorkspaceChangeSummary,
  TeachingWorkspaceSummary,
  InterruptedAgentRun,
  WorkspaceMarkdownDocument,
  WorkspaceItemMetaPayload,
  WorkspaceItemRemovePayload,
  WorkspaceRemovePayload,
  UpdateAgentConversationBranchStatusPayload,
  UpdateAgentConversationBranchStatusResult,
  UpdateTeachingMemoryPayload,
  UpdateMissionPayload
} from '../shared/teaching-types'

type LearningOutcomeLedger = Pick<LearningSessionLedger, 'load'>
type LearningOutcomeCommitterPort = Pick<LearningOutcomeCommitter, 'commit'>
type LearningOutcomeLedgerFactory = (workspaceRoot: string) => LearningOutcomeLedger
type LearningOutcomeCommitterFactory = (
  workspaceRoot: string,
  ledger: LearningOutcomeLedger
) => LearningOutcomeCommitterPort

type ConversationIndex = {
  pathMeta?: Record<string, WorkspacePathMeta>
}

type AgentConversationLocation = {
  record: AgentConversationRecord
  rootPath: string
  global: boolean
}

type BoundPreviewLessonInteraction = {
  intent: PreviewLessonInteractionIntent
  event: LessonInteraction
}

type PreviewLessonBindingState = 'pending_initial_navigation' | 'active'

export type PreviewLessonNavigation = {
  url: string | null
  isMainFrame: boolean | null
  isSameDocument: boolean | null
  frameProcessId: number | null
  frameRoutingId: number | null
}

type ActivePreviewBinding = {
  workspaceRoot: string
  workspaceId: string
  courseId: string
  courseName: string
  courseRelativePath: string
  sessionId: string
  lessonId: string
  lessonTitle: string
  lessonRelativePath: string
  /** Immutable assessment sidecar path, not the previewed normal Lesson path. */
  assessmentRelativePath: string
  /** Immutable assessment sidecar SHA-256, never a renderer-provided Lesson hash. */
  artifactDigest: string
  /** Exact canonical protocol URL that alone may activate the pending child frame. */
  previewUrl: string
  navigationState: PreviewLessonBindingState
  activeFrameProcessId: number | null
  activeFrameRoutingId: number | null
  /** Host-issued binding attempt; makes event-ID replays across bindings conflict. */
  attempt: number
  revoked: boolean
  recordedInteractions: Map<string, BoundPreviewLessonInteraction>
}

export type PreviewLessonInteractionBindingErrorCode =
  | 'sender_unavailable'
  | 'binding_unavailable'
  | 'binding_identity_mismatch'
  | 'binding_intent_conflict'

export class PreviewLessonInteractionBindingError extends Error {
  constructor(readonly code: PreviewLessonInteractionBindingErrorCode, message: string) {
    super(message)
    this.name = 'PreviewLessonInteractionBindingError'
  }
}

type PendingAgentRunArchiveScope = {
  workspaceId: string
  mode: 'teaching' | 'temporary'
  conversationId: string | null
  allowances: AgentStagedChildTranscriptAllowance[]
  createdAt: number
}

const SAFE_OUTCOME_COMMIT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/

function isOutcomeCommitRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSafeCommitLearningOutcomeRequest(value: unknown): value is CommitLearningOutcomeRequest {
  if (!isOutcomeCommitRecord(value)) return false
  return value.schemaVersion === 1 &&
    value.type === 'commit' &&
    isSafeOutcomeCommitId(value.workspaceId) &&
    typeof value.sessionId === 'string' &&
    isLearningSessionId(value.sessionId) &&
    isSafeOutcomeCommitId(value.operationId)
}

function isSafeOutcomeCommitId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_OUTCOME_COMMIT_ID.test(value)
}

function projectLearningOutcomeCommitResult(result: unknown): LearningOutcomeCommitResult {
  if (!isOutcomeCommitRecord(result)) return retryableOutcomeCommitFailure()
  if (result.status === 'committed' || result.status === 'already_committed') {
    const outcome = isOutcomeCommitRecord(result.outcome) ? result.outcome : null
    const kind = outcome?.kind
    if (
      (kind === 'established' || kind === 'misconception_corrected' || kind === 'needs_practice') &&
      typeof result.recordSaved === 'boolean'
    ) {
      return { status: result.status, outcome: { kind }, recordSaved: result.recordSaved }
    }
    return retryableOutcomeCommitFailure()
  }
  if (result.status === 'insufficient_evidence' && result.reason === 'not_evidenced') {
    return { status: 'insufficient_evidence', reason: 'not_evidenced' }
  }
  if (result.status === 'conflict' && result.reason === 'review_required') {
    return { status: 'conflict', reason: 'review_required' }
  }
  if (
    result.status === 'retryable_failure' &&
    (result.reason === 'reconciliation_required' || result.reason === 'temporarily_unavailable')
  ) {
    return { status: 'retryable_failure', reason: result.reason }
  }
  if (
    result.status === 'non_retryable_failure' &&
    (result.reason === 'invalid_session' || result.reason === 'invalid_request' || result.reason === 'read_only' || result.reason === 'not_found')
  ) {
    return { status: 'non_retryable_failure', reason: result.reason }
  }
  return retryableOutcomeCommitFailure()
}

function nonRetryableOutcomeCommitFailure(
  reason: Extract<LearningOutcomeCommitResult, { status: 'non_retryable_failure' }>['reason']
): Extract<LearningOutcomeCommitResult, { status: 'non_retryable_failure' }> {
  return { status: 'non_retryable_failure', reason }
}

function retryableOutcomeCommitFailure(): Extract<LearningOutcomeCommitResult, { status: 'retryable_failure' }> {
  return { status: 'retryable_failure', reason: 'temporarily_unavailable' }
}

const DEFAULT_RUNTIME: TeachingRuntimeState = {
  status: 'idle',
  currentStep: 'ready',
  queuedTasks: 0,
  providerLabel: 'Local structured generator'
}

export class TeachingWorkspaceService {
  private readonly registryPath: string
  private readonly appDataRoot: string
  private readonly defaultRoot: string
  private readonly settingsProvider?: () => Promise<TeachingSettingsV1>
  private readonly skillLibraryService?: SkillLibraryService
  private readonly memoryStore: TeachingMemoryStore
  private readonly reviewDeck = new TeachingWorkspaceReviewDeck()
  private readonly changeAudit: TeachingWorkspaceChangeAudit
  private readonly documents = new TeachingWorkspaceDocuments()
  private readonly activation: TeachingWorkspaceActivationLifecycle
  private readonly learningOutcomeLedgerFactory: LearningOutcomeLedgerFactory
  private readonly learningOutcomeCommitterFactory: LearningOutcomeCommitterFactory
  private readonly pendingAgentRunArchiveScopes = new Map<string, PendingAgentRunArchiveScope>()
  /** Per-renderer trusted preview authority; never stores a WebContents object. */
  private readonly activePreviewBindings = new Map<number, ActivePreviewBinding>()
  private readonly previewInteractionQueues = new Map<number, Promise<void>>()
  private nextPreviewBindingAttempt = 1
  private readonly previewReadGenerations = new Map<number, number>()

  constructor(options: {
    registryPath: string
    defaultRoot: string
    settingsProvider?: () => Promise<TeachingSettingsV1>
    skillLibraryService?: SkillLibraryService
    /** R2-only seams used to verify root/session authorization before commit delegation. */
    learningOutcomeLedgerFactory?: LearningOutcomeLedgerFactory
    learningOutcomeCommitterFactory?: LearningOutcomeCommitterFactory
  }) {
    this.registryPath = options.registryPath
    this.appDataRoot = dirname(this.registryPath)
    this.defaultRoot = options.defaultRoot
    this.settingsProvider = options.settingsProvider
    this.skillLibraryService = options.skillLibraryService
    this.learningOutcomeLedgerFactory = options.learningOutcomeLedgerFactory ?? ((workspaceRoot) =>
      createLearningSessionLedger({ workspaceRoot })
    )
    this.learningOutcomeCommitterFactory = options.learningOutcomeCommitterFactory ?? ((workspaceRoot, ledger) =>
      createLearningOutcomeCommitter({ workspaceRoot, ledger: ledger as LearningSessionLedger })
    )
    this.memoryStore = new TeachingMemoryStore({
      rootDir: join(this.appDataRoot, 'memory'),
      settingsProvider: () => this.loadSettings()
    })
    this.changeAudit = new TeachingWorkspaceChangeAudit({
      historyFilePath: join(this.appDataRoot, 'learning-changes', 'history.json')
    })
    this.activation = new TeachingWorkspaceActivationLifecycle({
      registryPath: this.registryPath,
      defaultRoot: this.defaultRoot,
      loadSettings: () => this.loadSettings(),
      summarizeWorkspace: (workspace) => this.summarizeWorkspace(workspace),
      listTemporaryConversations: (registry) => this.listTemporaryConversations(registry),
      readLessonHtml: async (workspaceId, lessonPath) => (await this.readLesson({ workspaceId, lessonPath })).html,
      runtimeState: () => this.runtimeState(),
      listChangeHistory: (workspaceId) => this.changeAudit.listSummaries(workspaceId),
      renderEmptyPreview
    })
  }

  private async ensureTemporaryConversationStructure(): Promise<void> {
    await mkdir(join(this.appDataRoot, 'conversations'), { recursive: true })
  }

  private async loadTemporaryConversationIndex(): Promise<ConversationIndex> {
    const indexPath = join(this.appDataRoot, 'conversations', '.index.json')
    const parsed = safeJsonParse(await readFile(indexPath, 'utf8').catch(() => ''))
    if (!parsed || typeof parsed !== 'object') return {}
    const pathMetaRaw = (parsed as { pathMeta?: unknown }).pathMeta
    const pathMeta: Record<string, WorkspacePathMeta> = {}
    if (pathMetaRaw && typeof pathMetaRaw === 'object') {
      for (const [key, rawMeta] of Object.entries(pathMetaRaw as Record<string, unknown>)) {
        if (!rawMeta || typeof rawMeta !== 'object') continue
        const relativePath = normalizeWorkspaceRelativePath(key)
        if (!isRootAgentConversationMarkdownRelativePath(relativePath)) continue
        const meta = rawMeta as WorkspacePathMeta
        pathMeta[relativePath] = {
          ...(meta.pinned === true ? { pinned: true } : {}),
          ...(meta.archived === true ? { archived: true } : {})
        }
      }
    }
    return { pathMeta }
  }

  private async saveTemporaryConversationIndex(index: ConversationIndex): Promise<void> {
    await this.ensureTemporaryConversationStructure()
    await atomicWriteFile(join(this.appDataRoot, 'conversations', '.index.json'), `${JSON.stringify(index, null, 2)}\n`)
  }

  private async listTemporaryConversations(registry: WorkspaceRegistry): Promise<AgentConversationSummary[]> {
    await this.ensureTemporaryConversationStructure()
    const temporaryIndex = await this.loadTemporaryConversationIndex()
    const globalConversations = await listAgentConversations(
      this.appDataRoot,
      temporaryIndex.pathMeta ?? {},
      { includeRoot: true, includeRootConversation: false, includeLegacyRootConversations: true, includeLessons: false, includeCourses: false }
    )
    const legacyWorkspaceConversations = (await Promise.all(
      registry.workspaces.map(async (workspace) => {
        const index = await this.loadWorkspaceIndex(workspace).catch(() => ({ pathMeta: {} }) as WorkspaceIndex)
        return listAgentConversations(
          workspace.rootPath,
          index.pathMeta ?? {},
          {
            includeRoot: true,
            includeRootConversation: false,
            includeLegacyRootConversations: true,
            includeLessons: false,
            includeCourses: false,
            fallbackWorkspaceId: workspace.id
          }
        )
      })
    )).flat()
    const deduped = new Map<string, AgentConversationSummary>()
    for (const conversation of [...globalConversations, ...legacyWorkspaceConversations]) {
      deduped.set(`${conversation.workspaceId ?? ''}:${conversation.id}:${conversation.relativePath}`, conversation)
    }
    return sortAgentConversationSummaries([...deduped.values()])
  }

  private async findAgentConversationLocation(
    workspaceRoot: string,
    conversationId: string,
    scope?: 'workspace' | 'temporary'
  ): Promise<AgentConversationLocation> {
    const id = requireCanonicalAgentConversationId(conversationId)
    if (scope === 'temporary') {
      const record = await readAgentConversationRecord(this.appDataRoot, id)
      return { record, rootPath: this.appDataRoot, global: true }
    }
    if (scope === 'workspace') {
      const record = await readAgentConversationRecord(workspaceRoot, id)
      return { record, rootPath: workspaceRoot, global: false }
    }
    const [globalRecord, workspaceRecord] = await Promise.all([
      readAgentConversationRecord(this.appDataRoot, id).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'Conversation not found.') return null
        throw error
      }),
      readAgentConversationRecord(workspaceRoot, id).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'Conversation not found.') return null
        throw error
      })
    ])
    if (globalRecord && workspaceRecord) {
      throw new Error(`Conversation id "${id}" exists in both temporary and workspace storage; an explicit scope is required.`)
    }
    if (globalRecord) return { record: globalRecord, rootPath: this.appDataRoot, global: true }
    if (workspaceRecord) return { record: workspaceRecord, rootPath: workspaceRoot, global: false }
    throw new Error('Conversation not found.')
  }

  private async hasTemporaryConversation(id: string): Promise<boolean> {
    return readAgentConversationRecord(this.appDataRoot, id).then(() => true).catch(() => false)
  }

  async getState(options: {
    activeWorkspaceId?: string | null
    selectedLessonPath?: string | null
  } = {}): Promise<TeachingAppState> {
    return this.activation.load(options)
  }


  async listWorkspaceSummariesForAnalytics(): Promise<AnalyticsWorkspaceScanResult[]> {
    const registry = await this.ensureRegistry()
    const visible = visibleRegistryWorkspaces(orderRegistryWorkspaces(registry.workspaces))
    return Promise.all(visible.map(async (workspace) => {
      try {
        return {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          rootPath: workspace.rootPath,
          summary: await this.summarizeWorkspace(workspace)
        }
      } catch {
        return {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          rootPath: workspace.rootPath,
          error: 'workspace_scan_failed'
        }
      }
    }))
  }

  async listTemporaryConversationSummariesForAnalytics(): Promise<AgentConversationSummary[]> {
    return this.listTemporaryConversations(await this.ensureRegistry())
  }

  async readTemporaryConversationForAnalytics(
    workspaceId: string | undefined,
    conversationId: string
  ): Promise<AgentConversationRecord> {
    const id = requireSafeAgentConversationId(conversationId)
    const globalRecord = await readAgentConversationRecord(this.appDataRoot, id).catch(() => null)
    if (globalRecord && isTemporaryAgentConversationPath(globalRecord.relativePath)) return globalRecord

    const registry = await this.ensureRegistry()
    const candidates = workspaceId
      ? registry.workspaces.filter((workspace) => workspace.id === workspaceId)
      : registry.workspaces
    for (const workspace of candidates) {
      const record = await readAgentConversationRecord(workspace.rootPath, id).catch(() => null)
      if (record && isTemporaryAgentConversationPath(record.relativePath)) return record
    }
    throw new Error(`Temporary conversation ${id} was not found.`)
  }

  async listWorkspaceChangesForAnalytics(
    workspaceId: string
  ): Promise<TeachingWorkspaceChangeSummary[]> {
    return this.changeAudit.listSummaries(workspaceId)
  }

  async reconcileInterruptedAgentRuns(): Promise<InterruptedAgentRun[]> {
    const stores = await this.agentRunStores()
    return (await Promise.all(stores.map((store) => store.reconcileInterrupted(async (stage) => {
      if (!stage.targetConversationId || !stage.expectedTurnDigest) return false
      const record = await readAgentConversationRecord(store.storageRoot, stage.targetConversationId).catch(() => null)
      return Boolean(record && hasAgentParentTurnCommit(record.turns, stage.runId, stage.expectedTurnDigest))
    }).catch(() => [])))).flat()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listInterruptedAgentRuns(): Promise<InterruptedAgentRun[]> {
    const stores = await this.agentRunStores()
    return (await Promise.all(stores.map((store) => store.listInterrupted().catch(() => [])))).flat()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private async agentRunStores(): Promise<AgentRunStore[]> {
    const registry = await this.ensureRegistry()
    const roots = new Map<string, string>()
    for (const root of [this.appDataRoot, ...registry.workspaces.map((workspace) => workspace.rootPath)]) {
      roots.set(resolve(root), root)
    }
    return [...roots.values()].map((root) => new AgentRunStore(root))
  }

  async createWorkspace(payload: CreateWorkspacePayload): Promise<TeachingAppState> {
    return this.activation.create(payload)
  }

  async selectWorkspace(workspaceId: string): Promise<TeachingAppState> {
    return this.activation.select(workspaceId)
  }

  async importWorkspace(rootPath: string): Promise<TeachingAppState> {
    return this.activation.import(rootPath)
  }

  async updateMission(payload: UpdateMissionPayload): Promise<TeachingAppState> {
    const prompt = cleanText(payload.prompt)
    if (!prompt) throw new Error('Mission prompt is required.')

    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const now = new Date().toISOString()
    const topic = deriveWorkspaceTopic(prompt, workspace.name)
    await atomicWriteFile(join(workspace.rootPath, 'MISSION.md'), renderMission(topic, prompt))
    await this.appendSessionEvent(workspace.rootPath, {
      id: randomUUID(),
      kind: 'mission_updated',
      timestamp: now,
      workspaceId: workspace.id,
      prompt,
      paths: ['MISSION.md']
    })
    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    return this.buildState(nextRegistry, workspace.id, null)
  }

  async generateLesson(payload: GenerateLessonPayload): Promise<GenerateLessonResult> {
    return this.runLessonGeneration(payload, null)
  }

  /**
   * Overwrites the workspace's `assets/lesson.css` with the selected theme so
   * every existing and future lesson page picks up the style immediately.
   */
  async applyLessonStyle(payload: ApplyLessonStylePayload): Promise<TeachingAppState> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const styleId = normalizeLessonStyleId(payload.styleId)
    const now = new Date().toISOString()
    await atomicWriteFile(join(workspace.rootPath, 'assets', 'lesson.css'), lessonStyleCss(styleId))
    await this.appendSessionEvent(workspace.rootPath, {
      id: randomUUID(),
      kind: 'lesson_style_applied',
      timestamp: now,
      workspaceId: workspace.id,
      paths: ['assets/lesson.css'],
      meta: { styleId }
    })
    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    return this.buildState(nextRegistry, workspace.id, null)
  }

  async generateLessonStream(
    payload: GenerateLessonStreamPayload,
    stream: {
      streamId: string
      onChunk: (chunk: LessonStreamChunk) => void
      onStatus: (status: LessonStreamStatus) => void
    }
  ): Promise<GenerateLessonResult> {
    return this.runLessonGeneration(payload, stream)
  }

  /**
   * Conversational agent with tool-calling (web_search etc.). Runs the agent
   * loop and streams status / tool events / final answer back to the renderer.
   * Returns the reconciled transcript turns plus loop metadata.
   */
  async agentChatStream(
    payload: AgentChatStreamPayload,
    stream: TeachingConversationRuntimeStream
  ): Promise<AgentChatStreamResult> {
    const registryState = payload.workspaceId ? await this.ensureRegistry() : null
    const workspace = payload.workspaceId && registryState
      ? findWorkspace(registryState, payload.workspaceId)
      : null
    const isTeachingConversation = (payload.mode ?? 'teaching') === 'teaching'
    if (workspace && payload.conversationId) {
      const location = await this.findAgentConversationLocation(
        workspace.rootPath,
        payload.conversationId,
        isTeachingConversation ? 'workspace' : 'temporary'
      )
      const branch = inferAgentConversationBranchMetadata(location.record)
      if (branch.status === 'deleted') throw new Error('Deleted conversation branches cannot be continued.')
      if (branch.status === 'archived') throw new Error('Archived conversation branches must be restored before continuing.')
      if (payload.expectedBranchRevision === undefined) {
        throw new Error('Expected branch revision is required when continuing an existing conversation.')
      }
      if (payload.expectedBranchRevision !== branch.revision) {
        throw new Error(
          `Conversation branch revision conflict: expected ${payload.expectedBranchRevision}, current ${branch.revision}.`
        )
      }
    }
    const runStorageRoot = isTeachingConversation && workspace ? workspace.rootPath : this.appDataRoot
    // A stream id is a one-run capability. Reusing it must never retain a prior
    // run's staged transcript promotion allowance, including after a failed run.
    this.pendingAgentRunArchiveScopes.delete(stream.streamId)
    const result = await runTeachingConversationTurn(payload, stream, workspace, {
      runStore: new AgentRunStore(runStorageRoot),
      loadSettings: () => this.loadSettings(),
      listMemories: (workspaceRoot) => this.memoryStore.list(workspaceRoot),
      createMemory: (memoryPayload) => this.memoryStore.create(memoryPayload),
      loadSkillReferences: (skillIds, userInput) =>
        this.skillLibraryService?.readInvokedSkillReferences(userInput, skillIds) ?? Promise.resolve([]),
      generateLessonFromBrief: workspace && isTeachingConversation
        ? async (brief) => {
            const generation = await this.generateAndPersistLesson({
              workspace,
              prompt: brief.topic,
              brief,
              messages: [],
              triggerKind: 'agent_lesson_generation',
              callbacks: {
                onStatus: (step) => {
                  const message = lessonToolStepMessage(step)
                  if (message) stream.onStatus({ streamId: stream.streamId, status: 'tool_running', message })
                }
              }
            })
            return generation.lesson
          }
        : undefined,
      buildTemporaryChatContext: (runtimeWorkspace, memories) => this.buildTemporaryChatContext(runtimeWorkspace, memories)
    })
    if ('turns' in result) {
      const allowances = collectStagedChildTranscriptAllowances(result.turns)
      if (allowances.length > 0) {
        this.pendingAgentRunArchiveScopes.set(stream.streamId, {
          workspaceId: payload.workspaceId ?? '',
          mode: isTeachingConversation ? 'teaching' : 'temporary',
          conversationId: payload.conversationId ?? null,
          allowances,
          createdAt: Date.now()
        })
        prunePendingAgentRunArchiveScopes(this.pendingAgentRunArchiveScopes)
      }
    }
    return result
  }

  async saveAgentConversation(payload: SaveAgentConversationPayload): Promise<SaveAgentConversationResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    await this.ensureWorkspaceStructure(workspace)

    let turns = normalizeAgentConversationTurns(payload.turns)
    if (turns.length === 0) throw new Error('Conversation is empty.')

    const now = new Date().toISOString()
    const requestedScope = payload.mode === 'temporary'
      ? 'temporary' as const
      : payload.mode === 'teaching'
        ? 'workspace' as const
        : undefined
    const existingLocation = payload.conversationId
      ? await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, requestedScope)
          .catch((error: unknown) => {
            if (error instanceof Error && error.message === 'Conversation not found.') return null
            throw error
          })
      : null
    const existing = existingLocation?.record ?? null
    const isTemporaryConversation = existingLocation?.global === true || payload.mode === 'temporary'
    const storageRoot = isTemporaryConversation ? this.appDataRoot : workspace.rootPath
    if (isTemporaryConversation) await this.ensureTemporaryConversationStructure()
    const runId = payload.runId?.trim()
    const runStore = runId ? new AgentRunStore(storageRoot) : null
    const stagedParentTurn = runStore && runId
      ? await runStore.readParentTurnStage(runId).catch(() => null)
      : null
    const title = existing?.title ?? deriveConversationTitle(turns, now)
    const id = existing?.id ?? stagedParentTurn?.targetConversationId ?? await nextAgentConversationId(storageRoot, title, now)
    const existingBranch = existing ? inferAgentConversationBranchMetadata(existing) : null
    if (existingBranch?.status === 'deleted') throw new Error('Deleted conversation branches cannot be updated.')
    if (existingBranch?.status === 'archived') throw new Error('Archived conversation branches must be restored before updating.')
    if (existingBranch && payload.expectedBranchRevision === undefined) {
      throw new Error('Expected branch revision is required when saving an existing conversation.')
    }
    if (existingBranch && payload.expectedBranchRevision !== existingBranch.revision) {
      throw new Error(`Conversation branch revision conflict: expected ${payload.expectedBranchRevision}, current ${existingBranch.revision}.`)
    }
    turns = turns.map((turn) => turn.metadata?.provenance
      ? turn
      : {
          ...turn,
          metadata: {
            ...(turn.metadata ?? { version: 1 as const }),
            version: 1,
            provenance: { kind: 'original' as const }
          }
        })
    const parentTurnDigest = runId ? agentParentTurnDigest(turns) : null
    const conversationDir = existing
      ? normalizeAgentConversationDirectory(dirname(existing.relativePath).replace(/\\/g, '/'))
      : isTemporaryConversation
        ? 'conversations'
      : agentConversationDirectoryRelativePath(payload)
    if (!isTemporaryConversation) await ensureTeachingContentDirectories(workspace.rootPath)
    const stagedAllowances = collectStagedChildTranscriptAllowances(turns)
    const authorizedAllowances = stagedAllowances.length > 0
      ? await this.authorizeStagedChildTranscriptPromotion({
          payload,
          workspaceId: workspace.id,
          storageRoot,
          allowances: stagedAllowances
        })
      : []
    if (runStore && runId && parentTurnDigest) {
      if (!stagedParentTurn) {
        throw new Error('Parent turn staging is unavailable; refusing an unverified conversation save.')
      }
      const finalAssistantIndex = turns.findLastIndex((turn) => turn.role === 'assistant')
      const finalAssistant = finalAssistantIndex >= 0 ? turns[finalAssistantIndex] : null
      const finalUser = finalAssistantIndex >= 0
        ? turns.slice(0, finalAssistantIndex).findLast((turn) => turn.role === 'user')
        : null
      const confirmedSha256 = finalAssistant
        ? createHash('sha256').update(finalAssistant.content).digest('hex')
        : null
      const userInputSha256 = finalUser
        ? createHash('sha256').update(finalUser.content.trim()).digest('hex')
        : null
      if (!stagedParentTurn.confirmedAssistant || confirmedSha256 !== stagedParentTurn.confirmedAssistant.sha256) {
        throw new Error('Conversation final answer does not match the explicitly confirmed parent turn.')
      }
      if (userInputSha256 !== stagedParentTurn.userInput.sha256) {
        throw new Error('Conversation user input does not match the staged parent turn.')
      }
      await runStore.prepareParentTurnSave(runId, id, parentTurnDigest)
      turns = attachAgentParentTurnCommit(turns, runId, parentTurnDigest)
    }

    const record: AgentConversationRecord = {
      id,
      workspaceId: existing?.workspaceId ?? workspace.id,
      title,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      relativePath: agentConversationMarkdownRelativePath(id, conversationDir),
      absolutePath: join(storageRoot, agentConversationMarkdownRelativePath(id, conversationDir)),
      messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
      branch: existingBranch
        ? existingBranch
        : { schemaVersion: 1, sessionId: id, branchId: id, revision: 1, status: 'active' },
      turns
    }

    await invalidateAgentHistoryIndex(storageRoot)
    const persistedRecord = existing
      ? await saveAgentConversationBranchAtRoot({ ...workspace, rootPath: storageRoot }, record, {
          expectedRevision: payload.expectedBranchRevision,
          allowedStagedChildTranscripts: authorizedAllowances
        })
      : (await writeAgentConversationRecord({ ...workspace, rootPath: storageRoot }, record, {
          allowedStagedChildTranscripts: authorizedAllowances
        }), record)
    if (!isTemporaryConversation) {
      await this.appendSessionEvent(workspace.rootPath, {
        id: randomUUID(),
        kind: 'agent_conversation_recorded',
        timestamp: persistedRecord.updatedAt,
        workspaceId: workspace.id,
        prompt: title,
        paths: [persistedRecord.relativePath, agentConversationJsonRelativePathForMarkdown(persistedRecord.relativePath)]
      })
    }

    const nextRegistry = isTemporaryConversation ? registry : touchRegistryWorkspace(registry, workspace.id, now)
    if (!isTemporaryConversation) await this.saveRegistry(nextRegistry)
    if (runStore && runId && parentTurnDigest && stagedParentTurn) {
      await runStore.settleParentTurn(runId, id, parentTurnDigest)
    }
    const result = {
      state: await this.buildState(nextRegistry, workspace.id, payload.selectedLessonPath ?? null),
      conversation: toAgentConversationSummary(persistedRecord, {}, workspace.id)
    }
    if (runId && authorizedAllowances.length > 0) {
      this.pendingAgentRunArchiveScopes.delete(runId)
    }
    return result
  }

  private async authorizeStagedChildTranscriptPromotion(input: {
    payload: SaveAgentConversationPayload
    workspaceId: string
    storageRoot: string
    allowances: AgentStagedChildTranscriptAllowance[]
  }): Promise<AgentStagedChildTranscriptAllowance[]> {
    const runId = input.payload.runId?.trim()
    if (!runId) throw new Error('A run id is required to promote staged child transcripts.')
    const scope = this.pendingAgentRunArchiveScopes.get(runId)
    if (!scope) throw new Error('Staged child transcript promotion is not authorized for this run.')
    const mode = input.payload.mode ?? 'teaching'
    if (
      scope.workspaceId !== input.workspaceId ||
      scope.mode !== mode ||
      scope.conversationId !== (input.payload.conversationId ?? null)
    ) {
      throw new Error('Staged child transcript promotion scope does not match this conversation save.')
    }
    if (!sameStagedChildTranscriptAllowances(scope.allowances, input.allowances)) {
      throw new Error('Staged child transcript promotion contains an unrecognized artifact reference.')
    }
    const expectedRunPrefix = `${STAGED_CHILD_TRANSCRIPT_PREFIX}${runId}/`
    if (input.allowances.some((allowance) => !allowance.archive.relativePath.startsWith(expectedRunPrefix))) {
      throw new Error('Staged child transcript promotion is not bound to this run.')
    }

    const runStore = new AgentRunStore(input.storageRoot)
    const checkpoint = await runStore.readCheckpoint(runId)
    if (
      checkpoint.runId !== runId ||
      checkpoint.streamId !== runId ||
      checkpoint.workspaceId !== input.workspaceId ||
      (checkpoint.conversationId ?? null) !== scope.conversationId
    ) {
      throw new Error('Staged child transcript run checkpoint does not match this conversation save.')
    }
    const durableChildren = new Map((await runStore.listChildRuns(runId)).map((child) => [child.childRunId, child]))
    for (const allowance of input.allowances) {
      const child = durableChildren.get(allowance.childRunId)
      if (!child || (child.status !== 'completed' && child.status !== 'failed' && child.status !== 'canceled')) {
        throw new Error('Staged child transcript does not have a terminal durable child record.')
      }
    }
    return scope.allowances
  }

  async readAgentConversation(payload: ReadAgentConversationPayload): Promise<AgentConversationRecord> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const record = (await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, payload.scope)).record
    return { ...record, branch: inferAgentConversationBranchMetadata(record) }
  }

  async readAgentConversationSessionTree(
    payload: ReadAgentConversationSessionTreePayload
  ): Promise<AgentConversationSessionTree> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const location = await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, payload.scope)
    const branch = inferAgentConversationBranchMetadata(location.record)
    return readAgentConversationSessionTreeAtRoot(location.rootPath, branch.sessionId)
  }

  async openAgentConversationBranch(
    payload: OpenAgentConversationBranchPayload
  ): Promise<OpenAgentConversationBranchResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const location = await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, payload.scope)
    const branch = inferAgentConversationBranchMetadata(location.record)
    const opened = await openAgentConversationBranchAtRoot(location.rootPath, branch.sessionId, {
      requestedBranchId: branch.branchId
    })
    return {
      conversation: { ...opened.record, branch: inferAgentConversationBranchMetadata(opened.record) },
      tree: opened.tree
    }
  }

  async replayAgentConversationBranch(
    payload: ReplayAgentConversationBranchPayload
  ): Promise<ReplayAgentConversationBranchResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const location = await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, payload.scope)
    const projection = await replayAgentConversationBranchAtRoot(location.rootPath, location.record.id, {
      sourceTurnId: payload.sourceTurnId
    })
    return { turns: projection.turns, replaySource: projection.replaySource }
  }

  async forkAgentConversationBranch(
    payload: ForkAgentConversationBranchPayload
  ): Promise<ForkAgentConversationBranchResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const location = await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, payload.scope)
    const storageWorkspace = { ...workspace, rootPath: location.rootPath }
    await invalidateAgentHistoryIndex(location.rootPath)
    const record = await forkAgentConversationBranchAtRoot(storageWorkspace, location.record.id, {
      sourceTurnId: payload.sourceTurnId,
      title: payload.title,
      expectedRevision: payload.expectedRevision
    })
    const branch = inferAgentConversationBranchMetadata(record)
    const opened = await openAgentConversationBranchAtRoot(location.rootPath, branch.sessionId, {
      requestedBranchId: branch.branchId
    })
    let nextRegistry = registry
    if (!location.global) {
      await this.appendSessionEvent(workspace.rootPath, {
        id: randomUUID(),
        kind: 'agent_conversation_recorded',
        timestamp: record.updatedAt,
        workspaceId: workspace.id,
        prompt: record.title,
        paths: [record.relativePath, agentConversationJsonRelativePathForMarkdown(record.relativePath)]
      })
      nextRegistry = touchRegistryWorkspace(registry, workspace.id, record.updatedAt)
      await this.saveRegistry(nextRegistry)
    }
    return {
      state: await this.buildState(nextRegistry, workspace.id, null),
      conversation: { ...record, branch },
      tree: opened.tree
    }
  }

  async updateAgentConversationBranchStatus(
    payload: UpdateAgentConversationBranchStatusPayload
  ): Promise<UpdateAgentConversationBranchStatusResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const location = await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, payload.scope)
    const storageWorkspace = { ...workspace, rootPath: location.rootPath }
    await invalidateAgentHistoryIndex(location.rootPath)
    const record = await updateAgentConversationBranchStatusAtRoot(
      storageWorkspace,
      location.record.id,
      payload.status,
      { expectedRevision: payload.expectedRevision }
    )
    const branch = inferAgentConversationBranchMetadata(record)
    const opened = await openAgentConversationBranchAtRoot(location.rootPath, branch.sessionId, {
      ...(branch.status === 'active' ? { requestedBranchId: branch.branchId } : {})
    })
    const nextRegistry = location.global
      ? registry
      : touchRegistryWorkspace(registry, workspace.id, record.updatedAt)
    if (!location.global) await this.saveRegistry(nextRegistry)
    return {
      state: await this.buildState(nextRegistry, workspace.id, null),
      conversation: { ...record, branch },
      tree: opened.tree
    }
  }

  async createAgentConversationCheckpoint(
    payload: CreateAgentConversationCheckpointPayload
  ): Promise<AgentConversationCheckpoint> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const location = await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId)
    const record = await readRawAgentConversationRecord(location.rootPath, payload.conversationId)
    await invalidateAgentHistoryIndex(location.rootPath)
    const checkpoint = await createAgentConversationCheckpoint({
      rootPath: location.rootPath,
      record,
      label: payload.label,
      reason: payload.reason
    })
    return checkpoint
  }

  async resolveAgentConversationCheckpoint(
    payload: ResolveAgentConversationCheckpointPayload
  ): Promise<ResolveAgentConversationCheckpointResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const location = await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId)
    const record = await readRawAgentConversationRecord(location.rootPath, payload.conversationId)
    return resolveAgentConversationCheckpoint({
      rootPath: location.rootPath,
      record,
      checkpointId: payload.checkpointId
    })
  }

  async rebuildAgentHistoryIndex(
    payload: RebuildAgentHistoryIndexPayload
  ): Promise<RebuildAgentHistoryIndexResult> {
    const roots = await this.agentStorageRoots(payload.workspaceId, payload.scope)
    const scopes = await Promise.all(roots.map(async ({ scope, rootPath }) => {
      const records = (await listPersistedAgentConversationRecords(rootPath)).map((entry) => entry.record)
      const rebuilt = await rebuildAgentConversationHistoryIndex({ rootPath, records })
      return {
        scope,
        entries: rebuilt.index.items.length,
        issues: rebuilt.issues,
        indexRelativePath: rebuilt.indexRelativePath
      }
    }))
    return { scopes }
  }

  async queryAgentArchivedHistory(
    payload: QueryAgentArchivedHistoryPayload
  ): Promise<QueryAgentArchivedHistoryResult> {
    const roots = await this.agentStorageRoots(payload.workspaceId, payload.scope)
    const limit = payload.limit ?? 100
    const maxBytes = payload.maxBytes ?? 256 * 1024
    const maxExcerptBytes = payload.maxExcerptBytes ?? 1200
    const scoped = await Promise.all(roots.map(async ({ scope, rootPath }) => ({
      scope,
      result: await queryArchivedHistoryAtRoot({
        rootPath,
        conversationId: payload.conversationId,
        from: payload.from,
        to: payload.to,
        types: payload.types,
        checkpointId: payload.checkpointId,
        limit,
        maxBytes,
        maxExcerptBytes
      })
    })))

    const candidates = scoped.flatMap(({ scope, result }) => result.items.map((item) => ({
      ...item,
      reference: `${scope}:${item.reference}`
    }))).sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp) || left.reference.localeCompare(right.reference)
    )
    const items: QueryAgentArchivedHistoryResult['items'] = []
    let bytes = 0
    let truncated = scoped.some((entry) => entry.result.truncated)
    for (const item of candidates) {
      if (items.length >= limit) {
        truncated = true
        break
      }
      const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8')
      if (bytes + itemBytes > maxBytes) {
        truncated = true
        break
      }
      items.push(item)
      bytes += itemBytes
    }
    if (items.length < candidates.length) truncated = true

    const issues: AgentArchivedHistoryIssue[] = scoped.flatMap(({ scope, result }) =>
      result.issues.map((issue) => ({
        ...issue,
        ...(issue.reference ? { reference: `${scope}:${issue.reference}` } : {})
      })))
    return {
      items,
      truncated,
      usage: { items: items.length, bytes, limit, maxBytes, maxExcerptBytes },
      issues,
      providerInjection: 'none',
      memoryWrite: 'none'
    }
  }

  async cleanupAgentArtifacts(payload: CleanupAgentArtifactsPayload): Promise<CleanupAgentArtifactsResult> {
    const roots = await this.agentStorageRoots(payload.workspaceId, payload.scope)
    const results = await Promise.all(roots.map(async ({ scope, rootPath }) => ({
      scope,
      result: await runAgentArtifactCleanup({
        storageRoot: rootPath,
        dryRun: payload.dryRun !== false,
        policy: {
          retentionDays: payload.retentionDays,
          gracePeriodHours: payload.graceHours,
          maxTotalBytes: payload.maxTotalBytes
        },
        resolveProtectionSnapshot: () => collectAgentArtifactProtectionSnapshot(rootPath)
      })
    })))

    return {
      dryRun: payload.dryRun !== false,
      scanned: results.reduce((sum, entry) => sum + entry.result.totals.scannedEntries, 0),
      scannedBytes: results.reduce((sum, entry) => sum + entry.result.totals.scannedBytes, 0),
      deleted: results.reduce((sum, entry) => sum + entry.result.totals.deletedEntries, 0),
      deletedBytes: results.reduce((sum, entry) => sum + entry.result.totals.deletedBytes, 0),
      retained: results.reduce((sum, entry) => sum + entry.result.totals.protectedEntries, 0),
      duplicateGroups: results.reduce((sum, entry) => sum + entry.result.duplicates.length, 0),
      actions: results.flatMap(({ scope, result }) => [
        ...result.actions.map((action) => ({
          relativePath: `${scope}:${action.relativePath}`,
          kind: cleanupArtifactKind(action.kind),
          bytes: action.bytes,
          sha256: action.sha256,
          reason: action.reason === 'storage_budget' ? 'over_budget' as const : 'expired_orphan' as const,
          action: action.status === 'deleted' || action.status === 'planned' ? 'delete' as const : 'retain' as const
        })),
        ...result.duplicates.flatMap((duplicate) => duplicate.relativePaths.map((relativePath) => ({
          relativePath: `${scope}:${relativePath}`,
          kind: 'unknown' as const,
          bytes: duplicate.bytes,
          sha256: duplicate.sha256,
          reason: 'duplicate' as const,
          action: 'report_duplicate' as const
        })))
      ]),
      issues: results.flatMap(({ scope, result }) => result.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        ...(issue.relativePath ? { relativePath: `${scope}:${issue.relativePath}` } : {})
      }))),
      auditRelativePaths: results.flatMap(({ scope, result }) => result.auditRelativePath
        ? [`${scope}:${result.auditRelativePath}`]
        : [])
    }
  }

  private async agentStorageRoots(
    workspaceId: string,
    scope: AgentConversationStorageScope = 'all'
  ): Promise<Array<{ scope: 'workspace' | 'temporary'; rootPath: string }>> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const roots: Array<{ scope: 'workspace' | 'temporary'; rootPath: string }> = []
    if (scope === 'all' || scope === 'temporary') roots.push({ scope: 'temporary', rootPath: this.appDataRoot })
    if (scope === 'all' || scope === 'workspace') roots.push({ scope: 'workspace', rootPath: workspace.rootPath })
    return roots.filter((entry, index, values) =>
      values.findIndex((candidate) => resolve(candidate.rootPath) === resolve(entry.rootPath)) === index)
  }

  async setWorkspaceItemMeta(payload: WorkspaceItemMetaPayload): Promise<TeachingAppState> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const relativePath = normalizeWorkspaceRelativePath(payload.relativePath)
    if (!relativePath) {
      const workspaces = orderRegistryWorkspaces(registry.workspaces.map((entry) =>
        entry.id === workspace.id
          ? applyRegistryWorkspaceMeta(entry, payload)
          : entry
      ))
      const visible = visibleRegistryWorkspaces(workspaces)
      const activeWorkspaceId = registry.activeWorkspaceId && visible.some((entry) => entry.id === registry.activeWorkspaceId)
        ? registry.activeWorkspaceId
        : visible[0]?.id ?? null
      const nextRegistry = { activeWorkspaceId, workspaces }
      await this.saveRegistry(nextRegistry)
      return this.buildState(nextRegistry, activeWorkspaceId, null)
    }

    return this.createItemLifecycleExecutor(registry).execute({
      workspace,
      target: {
        relativePath: payload.relativePath,
        kind: isRootAgentConversationMarkdownRelativePath(relativePath) ? 'conversation' : 'file'
      },
      intent: { type: 'set-meta', change: payload }
    })
  }

  async removeWorkspaceItem(payload: WorkspaceItemRemovePayload): Promise<TeachingAppState> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    if (payload.kind === 'conversation' && (payload.mode ?? 'disk') === 'disk') {
      const id = requireCanonicalAgentConversationId(basename(normalizeWorkspaceRelativePath(payload.relativePath)).replace(/\.md$/i, ''))
      const scope = isTemporaryAgentConversationPath(payload.relativePath) ? 'temporary' : 'workspace'
      const location = await this.findAgentConversationLocation(workspace.rootPath, id, scope).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'Conversation not found.') return null
        throw error
      })
      if (location) {
        const branch = inferAgentConversationBranchMetadata(location.record)
        const tree = await readAgentConversationSessionTreeAtRoot(location.rootPath, branch.sessionId)
        await invalidateAgentHistoryIndex(location.rootPath)
        // A multi-branch Session must keep a tombstone so its lineage remains
        // valid. A single-branch Session has no surviving lineage to protect and
        // must fall through to the workspace item lifecycle for physical removal;
        // routing it through branch deletion violates the last-active-branch guard.
        if (tree.branches.length > 1) {
          await updateAgentConversationBranchStatusAtRoot(
            { ...workspace, rootPath: location.rootPath },
            id,
            'deleted',
            { expectedRevision: branch.revision }
          )
          await openAgentConversationBranchAtRoot(location.rootPath, branch.sessionId)
          return this.buildState(registry, workspace.id, null)
        }
      }
    }
    return this.createItemLifecycleExecutor(registry).execute({
      workspace,
      target: { relativePath: payload.relativePath, kind: payload.kind },
      intent: { type: 'remove', mode: payload.mode }
    })
  }

  async removeWorkspace(payload: WorkspaceRemovePayload): Promise<TeachingAppState> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const mode = payload.mode ?? 'disk'
    if (mode === 'disk') {
      const settings = await this.loadSettings()
      assertSafeWorkspaceRootForRemoval(workspace.rootPath, [this.defaultRoot, settings.workspace.defaultRoot])
      await rm(workspace.rootPath, { recursive: true, force: true })
    }
    const workspaces = orderRegistryWorkspaces(registry.workspaces.filter((entry) => entry.id !== workspace.id))
    const visible = visibleRegistryWorkspaces(workspaces)
    const activeWorkspaceId = registry.activeWorkspaceId === workspace.id
      ? visible[0]?.id ?? null
      : registry.activeWorkspaceId && visible.some((entry) => entry.id === registry.activeWorkspaceId)
        ? registry.activeWorkspaceId
        : visible[0]?.id ?? null
    const nextRegistry = { activeWorkspaceId, workspaces }
    await this.saveRegistry(nextRegistry)
    return this.buildState(nextRegistry, activeWorkspaceId, null)
  }

  /**
   * Shared generation entry for both the non-streaming and streaming IPC paths.
   * The lesson generation module owns the deeper implementation; this method
   * keeps the service focused on registry/index/session/runtime composition.
   */
  private async runLessonGeneration(
    payload: GenerateLessonPayload,
    stream: {
      streamId: string
      onChunk: (chunk: LessonStreamChunk) => void
      onStatus: (status: LessonStreamStatus) => void
    } | null
  ): Promise<GenerateLessonResult> {
    const prompt = cleanText(payload.prompt)
    if (!prompt) throw new Error('Lesson prompt is required.')

    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const callbacks: LessonGenerationCallbacks = {
      onToken: (delta) => {
        if (stream) stream.onChunk({ streamId: stream.streamId, delta })
      },
      onStatus: (step) => {
        if (stream) stream.onStatus({ streamId: stream.streamId, step })
      }
    }

    const generation = await this.generateAndPersistLesson({
      workspace,
      prompt,
      messages: payload.messages ?? [],
      requestedCourseName: payload.courseName,
      callbacks,
      triggerKind: 'lesson_generation'
    })

    if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
    return {
      kind: 'lesson',
      state: await this.buildState(generation.registry, workspace.id, generation.lesson.absolutePath),
      lesson: generation.lesson,
      source: generation.source,
      reason: generation.reason,
      changeSummary: generation.changeSummary
    }
  }

  /**
   * Generate one lesson and persist every side effect (files, workspace
   * index, session event, registry touch). Both the direct IPC entry and the
   * conversation agent's generate_lesson tool go through here, so a lesson
   * created mid-conversation is indistinguishable from a directly generated
   * one. Throws LessonGenerationError instead of persisting anything when the
   * provider fails to produce a valid plan.
   */
  private async generateAndPersistLesson(options: {
    workspace: RegistryWorkspace
    prompt: string
    brief?: LessonBrief
    messages: AgentChatMessage[]
    requestedCourseName?: string
    triggerKind?: 'lesson_generation' | 'agent_lesson_generation'
    callbacks?: LessonGenerationCallbacks
  }): Promise<{
    lesson: LessonSummary
    source: LessonPlanSource
    reason?: string
    registry: WorkspaceRegistry
    changeSummary: TeachingWorkspaceChangeSummary | null
  }> {
    const { workspace } = options
    const beforeChanges = await this.changeAudit.capturePreMutation(workspace.rootPath)
    await this.ensureWorkspaceStructure(workspace)

    const settings = await this.loadSettings()
    const now = new Date().toISOString()
    const index = await this.loadWorkspaceIndex(workspace)

    const generation = await runLessonGenerationPipeline({
      workspace,
      settings,
      lessons: index.lessons,
      prompt: options.prompt,
      brief: options.brief,
      requestedCourseName: options.requestedCourseName,
      messages: options.messages,
      now,
      retrieveMemories: (query) => this.memoryStore.retrieve(query),
      callbacks: options.callbacks,
      bindCanonicalSession: async ({ lesson, assessment }) => this.openCanonicalLessonSession(workspace, lesson, assessment)
    })

    await this.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      updatedAt: now,
      lessons: upsertLesson(index.lessons, generation.lesson)
    })
    await this.appendSessionEvent(workspace.rootPath, {
      id: randomUUID(),
      kind: 'lesson_generated',
      timestamp: now,
      workspaceId: workspace.id,
      prompt: generation.eventPrompt,
      paths: generation.eventPaths,
      meta: generation.eventMeta
    })
    // The filesystem index and event log are canonical projections. Once both
    // are durable, retaining the publisher journal would only cause recovery
    // work; failure to remove it is harmless and recoverable on the next scan.
    await finalizeLessonArtifactPublication(workspace.rootPath, generation.transactionId).catch(() => undefined)
    const changeSummary = await this.changeAudit.recordCompletedMutation({
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      timestamp: now,
      trigger: {
        kind: options.triggerKind ?? 'lesson_generation',
        label: options.triggerKind === 'agent_lesson_generation' ? 'Agent-generated lesson' : 'Generated lesson',
        detail: generation.lesson.title
      },
      before: beforeChanges,
      affectedPaths: [
        ...generation.eventPaths,
        '.studiumx/index.json',
        '.studiumx/sessions.jsonl'
      ]
    })

    const registry = await this.ensureRegistry()
    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    return {
      lesson: generation.lesson,
      source: generation.source,
      reason: generation.reason,
      registry: nextRegistry,
      changeSummary
    }
  }

  /**
   * Authorizes an outcome commit against the main-process workspace registry,
   * then delegates the canonical request to the existing sole writer. No IPC
   * path or outcome/evidence data participates in this decision.
   */
  async commitLearningOutcome(request: CommitLearningOutcomeRequest): Promise<LearningOutcomeCommitResult> {
    if (!isSafeCommitLearningOutcomeRequest(request)) return nonRetryableOutcomeCommitFailure('invalid_request')

    let registry: WorkspaceRegistry
    try {
      registry = await this.ensureRegistry()
    } catch {
      return retryableOutcomeCommitFailure()
    }

    const workspace = registry.workspaces.find((candidate) => candidate.id === request.workspaceId)
    if (!workspace) return nonRetryableOutcomeCommitFailure('not_found')

    let ledger: LearningOutcomeLedger
    let session: LearningSessionSnapshot | null
    try {
      ledger = this.learningOutcomeLedgerFactory(workspace.rootPath)
      session = await ledger.load(request.sessionId)
    } catch {
      return retryableOutcomeCommitFailure()
    }
    if (!session) return nonRetryableOutcomeCommitFailure('not_found')
    if (session.source !== 'canonical' || session.readOnly) return nonRetryableOutcomeCommitFailure('read_only')
    if (session.workspaceId !== workspace.id) return nonRetryableOutcomeCommitFailure('invalid_session')

    try {
      const result = await this.learningOutcomeCommitterFactory(workspace.rootPath, ledger).commit({
        sessionId: request.sessionId,
        operationId: request.operationId
      })
      return projectLearningOutcomeCommitResult(result)
    } catch {
      return retryableOutcomeCommitFailure()
    }
  }

  /**
   * Aggregate durable flashcard review files for the review deck.
   */
  async listReviewCards(workspaceId: string): Promise<ListReviewCardsResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const deck = await this.reviewDeck.loadDeck(workspace)
    return { cards: deck.cards }
  }

  async recordProgress(payload: RecordProgressPayload): Promise<GetProgressResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const deck = await this.reviewDeck.recordAttempt(workspace, payload)
    return { workspaceId: workspace.id, progress: deck.progress }
  }

  async getProgress(workspaceId: string): Promise<GetProgressResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const deck = await this.reviewDeck.loadDeck(workspace)
    return { workspaceId: workspace.id, progress: deck.progress }
  }

  async readLesson(payload: ReadLessonPayload, webContentsId?: number): Promise<ReadLessonResult> {
    const requestGeneration = typeof webContentsId === 'number' ? this.beginPreviewLessonRead(webContentsId) : null

    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const result = await this.documents.readLesson(workspace, payload.lessonPath)
    if (requestGeneration === null || !this.isCurrentPreviewLessonRead(webContentsId, requestGeneration)) return result

    const index = await this.loadWorkspaceIndex(workspace)
    const requestedPath = normalizeWorkspaceRelativePath(payload.lessonPath)
    const lesson = index.lessons.find((candidate) => normalizeWorkspaceRelativePath(candidate.relativePath) === requestedPath)
    if (!lesson) return result

    const previewFile = await this.documents.resolvePreviewFile(workspace, lesson.relativePath)
    const previewUrl = previewUrlForDocument(workspace.id, lesson.relativePath)
    if (
      !previewFile ||
      normalizeWorkspaceRelativePath(previewFile.relativePath) !== normalizeWorkspaceRelativePath(lesson.relativePath) ||
      result.url !== previewUrl
    ) {
      return result
    }

    const ledger = createLearningSessionLedger({ workspaceRoot: workspace.rootPath })
    const session = await ledger.load(lesson.sessionId)
    if (!isCanonicalWritableLessonSession(session, workspace, lesson)) return result

    const assessment = session?.lessonRef?.assessment
    if (!assessment) return result
    if (!this.isCurrentPreviewLessonRead(webContentsId, requestGeneration)) return result
    this.activePreviewBindings.set(webContentsId, {
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      courseId: lesson.courseId,
      courseName: lesson.courseName,
      courseRelativePath: lesson.courseRelativePath,
      sessionId: lesson.sessionId,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      lessonRelativePath: lesson.relativePath,
      assessmentRelativePath: assessment.relativePath,
      artifactDigest: assessment.contentSha256,
      previewUrl,
      navigationState: 'pending_initial_navigation',
      activeFrameProcessId: null,
      activeFrameRoutingId: null,
      attempt: this.nextPreviewBindingAttempt++,
      revoked: false,
      recordedInteractions: new Map()
    })
    return result
  }

  async readWorkspaceMarkdown(payload: ReadWorkspaceMarkdownPayload, webContentsId?: number): Promise<WorkspaceMarkdownDocument> {
    if (typeof webContentsId === 'number') this.clearPreviewLessonBinding(webContentsId)
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    return this.documents.readMarkdown(workspace, payload.documentPath)
  }

  clearPreviewLessonBinding(webContentsId: number): void {
    this.revokePreviewLessonBinding(webContentsId)
    this.advancePreviewReadGeneration(webContentsId)
  }

  /**
   * Main-process navigation proof for a renderer-owned lesson iframe. A binding
   * starts pending and may activate exactly once for its canonical protocol URL;
   * srcDoc/about:srcdoc and any other first navigation cannot establish trust.
   */
  observePreviewLessonNavigation(webContentsId: number, navigation: PreviewLessonNavigation): void {
    const binding = this.activePreviewBindings.get(webContentsId)
    if (!binding || binding.revoked) return

    if (navigation.isMainFrame !== false) {
      this.clearPreviewLessonBinding(webContentsId)
      return
    }

    if (binding.navigationState === 'pending_initial_navigation') {
      if (
        navigation.isSameDocument !== false ||
        navigation.url !== binding.previewUrl ||
        !isSafePreviewFrameId(navigation.frameProcessId) ||
        !isSafePreviewFrameId(navigation.frameRoutingId)
      ) {
        this.clearPreviewLessonBinding(webContentsId)
        return
      }
      binding.navigationState = 'active'
      binding.activeFrameProcessId = navigation.frameProcessId
      binding.activeFrameRoutingId = navigation.frameRoutingId
      return
    }

    // A same-document child transition keeps the active document. Every
    // cross-document child transition, including the same iframe WindowProxy,
    // invalidates authority before it can post another narrow IPC intent.
    if (navigation.isSameDocument !== true) this.clearPreviewLessonBinding(webContentsId)
  }

  async recordPreviewLessonInteraction(
    webContentsId: number,
    intent: PreviewLessonInteractionIntent
  ): Promise<PreviewLessonInteractionReceipt> {
    const normalizedIntent = normalizePreviewLessonInteractionIntent(intent)
    return this.serializePreviewInteraction(webContentsId, async () => {
      const binding = this.activePreviewBindings.get(webContentsId)
      if (!binding || binding.revoked || binding.navigationState !== 'active') {
        throw new PreviewLessonInteractionBindingError('binding_unavailable', 'No trusted Lesson preview binding is active.')
      }

      const ledger = createLearningSessionLedger({ workspaceRoot: binding.workspaceRoot })
      const session = await ledger.load(binding.sessionId)
      if (!this.isActivePreviewBinding(webContentsId, binding)) {
        throw new PreviewLessonInteractionBindingError('binding_unavailable', 'No trusted Lesson preview binding is active.')
      }
      if (!isCanonicalWritablePreviewBinding(session, binding)) {
        throw new PreviewLessonInteractionBindingError(
          'binding_identity_mismatch',
          'Trusted Lesson preview binding no longer matches a writable canonical Learning Session.'
        )
      }

      const event = this.previewInteractionEvent(binding, normalizedIntent)
      const receipt = await createLessonInteractionRecorder({ ledger }).record(event)
      return {
        eventId: receipt.eventId,
        sessionId: receipt.sessionId,
        sequence: receipt.sequence,
        duplicate: receipt.duplicate
      }
    })
  }

  async readWorkspaceChangeDiff(payload: { workspaceId: string; relativePath: string; changeId?: string }) {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    return this.changeAudit.readSelectedDiff({
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      relativePath: payload.relativePath,
      ...(payload.changeId ? { changeId: payload.changeId } : {})
    })
  }

  async saveWorkspaceMarkdown(payload: SaveWorkspaceMarkdownPayload): Promise<SaveWorkspaceMarkdownResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const document = await this.documents.saveMarkdown(workspace, payload.documentPath, payload.content)
    // A failed document write must not make the workspace appear newer in the registry.
    const now = new Date().toISOString()
    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    return {
      state: await this.buildState(nextRegistry, workspace.id, document.absolutePath),
      document
    }
  }

  async resolvePreviewFile(workspaceId: string, relativePath: string): Promise<WorkspacePreviewFile | null> {
    const registry = await this.ensureRegistry()
    const workspace = registry.workspaces.find((candidate) => candidate.id === workspaceId)
    return workspace ? this.documents.resolvePreviewFile(workspace, relativePath) : null
  }

  async readPreviewDocument(workspaceId: string, relativePath: string, requestUrl: string) {
    const registry = await this.ensureRegistry()
    const workspace = registry.workspaces.find((candidate) => candidate.id === workspaceId)
    return workspace ? this.documents.readPreview(workspace, relativePath, requestUrl) : null
  }

  async listMemory(workspaceRoot?: string): Promise<TeachingMemoryRecord[]> {
    return this.memoryStore.list(workspaceRoot)
  }

  async getMemoryDiagnostics(): Promise<TeachingMemoryDiagnostics> {
    return this.memoryStore.diagnostics()
  }

  async getConnectorStatuses(): Promise<ConnectorStatusesResult> {
    const settings = await this.loadSettings()
    const registry = await this.ensureRegistry().catch(() => EMPTY_REGISTRY)
    const activeWorkspace = registry.activeWorkspaceId
      ? registry.workspaces.find((workspace) => workspace.id === registry.activeWorkspaceId) ?? null
      : null
    return buildConnectorStatuses(settings, activeWorkspace)
  }

  async createMemory(payload: CreateTeachingMemoryPayload): Promise<TeachingMemoryRecord> {
    return this.memoryStore.create(payload)
  }

  async updateMemory(memoryId: string, patch: UpdateTeachingMemoryPayload): Promise<TeachingMemoryRecord> {
    return this.memoryStore.update(memoryId, patch, {
      workspaceRoot: patch.workspaceRoot
    })
  }

  async deleteMemory(memoryId: string, workspaceRoot?: string): Promise<void> {
    await this.memoryStore.delete(memoryId, { workspaceRoot })
  }

  private async ensureRegistry(): Promise<WorkspaceRegistry> {
    return this.activation.ensureRegistry()
  }

  private async saveRegistry(registry: WorkspaceRegistry): Promise<void> {
    await this.activation.saveRegistry(registry)
  }

  private async buildState(
    registry: WorkspaceRegistry,
    activeWorkspaceId?: string | null,
    selectedLessonPath?: string | null
  ): Promise<TeachingAppState> {
    return this.activation.assembleState(registry, activeWorkspaceId, selectedLessonPath)
  }

  private async summarizeWorkspace(workspace: RegistryWorkspace): Promise<TeachingWorkspaceSummary> {
    const index = await this.loadWorkspaceIndex(workspace)
    const pathMeta = index.pathMeta ?? {}
    await this.ensureWorkspaceStructure(workspace, pathMeta)
    const lessonIndexPlan = await planLessonIndexReconciliation({
      rootPath: workspace.rootPath,
      workspaceName: workspace.name,
      workspaceId: workspace.id,
      lessons: index.lessons
    })
    if (lessonIndexPlan.requiresPersist) {
      await this.saveWorkspaceIndex(workspace.rootPath, {
        ...index,
        lessons: lessonIndexPlan.lessons,
        updatedAt: new Date().toISOString()
      })
    }
    const catalog = await buildWorkspaceCatalog(workspace, {
      lessons: lessonIndexPlan.lessons,
      pathMeta
    })
    return {
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      pinned: workspace.pinned,
      ...catalog,
      git: await inspectGitWorkspace(workspace.rootPath)
    }
  }

  private async buildTemporaryChatContext(
    workspace: RegistryWorkspace,
    memories: TeachingMemoryRecord[]
  ): Promise<TemporaryChatContext> {
    const index = await this.loadWorkspaceIndex(workspace).catch(() => null)
    const lessons = index?.lessons ?? []
    const courses = buildCourseSummaries(workspace, lessons, [], index?.pathMeta ?? {}).map((course) => ({
      name: course.name,
      lessonCount: course.lessonCount,
      sessionCount: course.sessionCount
    }))
    const learnerProfiles = activeLearnerProfileLines(memories, 8)
    return { learnerProfiles, courses }
  }

  private beginPreviewLessonRead(webContentsId: number): number {
    this.revokePreviewLessonBinding(webContentsId)
    return this.advancePreviewReadGeneration(webContentsId)
  }

  private revokePreviewLessonBinding(webContentsId: number): void {
    const binding = this.activePreviewBindings.get(webContentsId)
    if (binding) binding.revoked = true
    this.activePreviewBindings.delete(webContentsId)
  }

  private isActivePreviewBinding(webContentsId: number, binding: ActivePreviewBinding): boolean {
    return !binding.revoked && binding.navigationState === 'active' && this.activePreviewBindings.get(webContentsId) === binding
  }

  private async serializePreviewInteraction<Result>(
    webContentsId: number,
    action: () => Promise<Result>
  ): Promise<Result> {
    const previous = this.previewInteractionQueues.get(webContentsId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.previewInteractionQueues.set(webContentsId, current)
    await previous.catch(() => undefined)
    try {
      return await action()
    } finally {
      release()
      if (this.previewInteractionQueues.get(webContentsId) === current) this.previewInteractionQueues.delete(webContentsId)
    }
  }

  private previewInteractionEvent(
    binding: ActivePreviewBinding,
    intent: PreviewLessonInteractionIntent
  ): LessonInteraction {
    const existing = binding.recordedInteractions.get(intent.eventId)
    if (existing) {
      if (!samePreviewLessonInteractionIntent(existing.intent, intent)) {
        throw new PreviewLessonInteractionBindingError(
          'binding_intent_conflict',
          `Preview Lesson event ID "${intent.eventId}" is already bound to a different intent.`
        )
      }
      return existing.event
    }

    const event = createPreviewLessonInteraction({
      ...binding,
      observedAt: new Date().toISOString(),
      attempt: binding.attempt,
      surface: 'lesson_preview'
    }, intent)
    binding.recordedInteractions.set(intent.eventId, { intent, event })
    return event
  }

  private advancePreviewReadGeneration(webContentsId: number): number {
    const generation = (this.previewReadGenerations.get(webContentsId) ?? 0) + 1
    this.previewReadGenerations.set(webContentsId, generation)
    return generation
  }

  private isCurrentPreviewLessonRead(webContentsId: number | undefined, generation: number | null): webContentsId is number {
    return typeof webContentsId === 'number' && generation !== null && this.previewReadGenerations.get(webContentsId) === generation
  }

  private async openCanonicalLessonSession(
    workspace: RegistryWorkspace,
    lesson: LessonSummary,
    assessment: { relativePath: string; contentSha256: string }
  ): Promise<(() => Promise<void>) | void> {
    const ledger = createLearningSessionLedger({ workspaceRoot: workspace.rootPath })
    // A retry may find the exact immutable session already open. Only remove a
    // session that this publication invocation created; a compensator must not
    // erase a previously durable canonical root.
    const prior = typeof ledger.load === 'function' ? await ledger.load(lesson.sessionId) : null
    const session = await ledger.open({
      sessionId: lesson.sessionId,
      workspaceId: workspace.id,
      courseRef: {
        courseId: lesson.courseId,
        courseName: lesson.courseName,
        relativePath: lesson.courseRelativePath
      },
      lessonRef: {
        lessonId: lesson.id,
        title: lesson.title,
        relativePath: lesson.relativePath,
        assessment
      }
    })
    if (!isCanonicalWritableLessonSession(session, workspace, lesson)) {
      throw new Error('Generated Lesson could not open its canonical writable Learning Session.')
    }
    // The generated session ID is scoped to this just-rendered Lesson. If the
    // final Lesson commit fails, remove only that matching canonical root so a
    // future retry can open the same immutable identity cleanly.
    if (prior) return
    return async () => {
      const current = await ledger.load(lesson.sessionId)
      if (!isCanonicalWritableLessonSession(current, workspace, lesson)) return
      await rm(join(workspace.rootPath, 'learning-sessions', lesson.sessionId), { recursive: true, force: true })
    }
  }

  private async ensureWorkspaceStructure(
    workspace: RegistryWorkspace,
    pathMeta?: Record<string, WorkspacePathMeta>
  ): Promise<void> {
    await ensureWorkspaceLifecycleStructure(workspace, {
      pathMeta,
      loadSettings: () => this.loadSettings()
    })
  }

  private async loadWorkspaceIndex(workspace: RegistryWorkspace): Promise<WorkspaceIndex> {
    return loadWorkspaceLifecycleIndex(workspace)
  }

  private async saveWorkspaceIndex(rootPath: string, index: WorkspaceIndex): Promise<void> {
    await saveWorkspaceLifecycleIndex(rootPath, index)
  }

  private async appendSessionEvent(rootPath: string, event: SessionEvent): Promise<void> {
    await appendWorkspaceSessionEvent(rootPath, event)
  }

  private createItemLifecycleExecutor(
    registry: WorkspaceRegistry
  ): TeachingWorkspaceItemLifecycleExecutor<TeachingAppState> {
    return new TeachingWorkspaceItemLifecycleExecutor({
      appDataRoot: this.appDataRoot,
      loadWorkspaceIndex: (workspace) => this.loadWorkspaceIndex(workspace),
      saveWorkspaceIndex: (rootPath, index) => this.saveWorkspaceIndex(rootPath, index),
      loadTemporaryConversationIndex: () => this.loadTemporaryConversationIndex(),
      saveTemporaryConversationIndex: (index) => this.saveTemporaryConversationIndex(index),
      hasTemporaryConversation: (id) => this.hasTemporaryConversation(id),
      rebuildState: (workspace) => this.buildState(registry, workspace.id, null)
    })
  }

  private async loadSettings(): Promise<TeachingSettingsV1> {
    if (this.settingsProvider) return this.settingsProvider()
    return defaultSettings(this.defaultRoot)
  }

  private async runtimeState(): Promise<TeachingRuntimeState> {
    try {
      const settings = await this.loadSettings()
      const provider =
        settings.provider.providers.find((item) => item.id === settings.generator.providerId) ??
        settings.provider.providers.find((item) => item.id === settings.provider.activeProviderId)
      const modelLabel = settings.generator.model || 'auto'
      return {
        ...DEFAULT_RUNTIME,
        providerLabel: `${provider?.name ?? 'Model provider'} · ${modelLabel}`
      }
    } catch {
      return DEFAULT_RUNTIME
    }
  }

}

/** Progress copy shown in the conversation while generate_lesson runs. */
function isSafePreviewFrameId(value: number | null): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function samePreviewLessonInteractionIntent(
  left: PreviewLessonInteractionIntent,
  right: PreviewLessonInteractionIntent
): boolean {
  if (left.eventId !== right.eventId || left.kind !== right.kind || left.itemId !== right.itemId) return false
  switch (left.kind) {
    case 'lesson_opened':
    case 'lesson_completed':
      return true
    case 'quiz_answered':
      return right.kind === 'quiz_answered' && left.correct === right.correct &&
        left.selectedOptionIds.length === right.selectedOptionIds.length &&
        left.selectedOptionIds.every((value, index) => value === right.selectedOptionIds[index])
    case 'flashcard_rated':
      return right.kind === 'flashcard_rated' && left.rating === right.rating
    case 'retrieval_response_submitted':
    case 'learner_response_recorded':
      return right.kind === left.kind && left.responseDigest === right.responseDigest && left.responseKind === right.responseKind
  }
}

function isCanonicalWritableLessonSession(
  session: LearningSessionSnapshot | null,
  workspace: RegistryWorkspace,
  lesson: LessonSummary
): boolean {
  return Boolean(
    session &&
    session.source === 'canonical' &&
    !session.readOnly &&
    session.status === 'active' &&
    session.id === lesson.sessionId &&
    session.workspaceId === workspace.id &&
    session.courseRef.courseId === lesson.courseId &&
    session.courseRef.courseName === lesson.courseName &&
    session.courseRef.relativePath === lesson.courseRelativePath &&
    session.lessonRef?.lessonId === lesson.id &&
    session.lessonRef.title === lesson.title &&
    session.lessonRef.relativePath === lesson.relativePath &&
    Boolean(session.lessonRef.assessment)
  )
}

function isCanonicalWritablePreviewBinding(
  session: LearningSessionSnapshot | null,
  binding: ActivePreviewBinding
): boolean {
  return Boolean(
    session &&
    session.source === 'canonical' &&
    !session.readOnly &&
    session.status === 'active' &&
    session.id === binding.sessionId &&
    session.workspaceId === binding.workspaceId &&
    session.courseRef.courseId === binding.courseId &&
    session.courseRef.courseName === binding.courseName &&
    session.courseRef.relativePath === binding.courseRelativePath &&
    session.lessonRef?.lessonId === binding.lessonId &&
    session.lessonRef.title === binding.lessonTitle &&
    session.lessonRef.relativePath === binding.lessonRelativePath &&
    session.lessonRef.assessment?.relativePath === binding.assessmentRelativePath &&
    session.lessonRef.assessment?.contentSha256 === binding.artifactDigest
  )
}

function lessonToolStepMessage(step: string): string {
  switch (step) {
    case 'calling':
      return '正在生成课程：调用模型…'
    case 'streaming':
      return '正在生成课程：撰写课程计划…'
    case 'validating':
      return '正在生成课程：校验课程结构…'
    case 'rendering':
      return '正在生成课程：渲染课程文件…'
    default:
      return ''
  }
}

function upsertLesson(lessons: LessonSummary[], lesson: LessonSummary): LessonSummary[] {
  return [lesson, ...lessons.filter((item) => item.absolutePath !== lesson.absolutePath)]
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderEmptyPreview(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; font-family: Inter, "Microsoft YaHei", sans-serif; color: #24324a; background: #fbfcff; }
    main { max-width: 680px; margin: 0 auto; padding: 46px 34px; }
    p { color: #68778f; line-height: 1.8; }
    .badge { color: #4f7cf5; font-size: 12px; font-weight: 800; text-transform: uppercase; }
  </style>
</head>
<body>
  <main>
    <div class="badge">StudiumX</div>
    <h1>${escapeHtml(workspace.missionTitle)}</h1>
    <p>${escapeHtml(workspace.missionExcerpt)}</p>
    <p>点击生成按钮后，静态 HTML lesson 会保存到当前课程的 lessons 文件夹，并在这里预览。</p>
  </main>
</body>
</html>`
}

const STAGED_CHILD_TRANSCRIPT_PREFIX = '.agent-sessions/child-transcripts/'
const MAX_PENDING_AGENT_RUN_ARCHIVE_SCOPES = 64

function collectStagedChildTranscriptAllowances(turns: readonly AgentChatTurn[]): AgentStagedChildTranscriptAllowance[] {
  const allowances: AgentStagedChildTranscriptAllowance[] = []
  const seen = new Set<string>()
  for (const turn of turns) {
    for (const child of turn.metadata?.childRuns ?? []) {
      const archive = child.archive
      if (archive?.kind !== 'child_transcript' || !archive.relativePath.startsWith(STAGED_CHILD_TRANSCRIPT_PREFIX)) continue
      const key = stagedChildTranscriptAllowanceKey({ childRunId: child.childRunId, archive })
      if (seen.has(key)) continue
      seen.add(key)
      allowances.push({ childRunId: child.childRunId, archive: { ...archive } })
    }
  }
  return allowances
}

function sameStagedChildTranscriptAllowances(
  expected: readonly AgentStagedChildTranscriptAllowance[],
  actual: readonly AgentStagedChildTranscriptAllowance[]
): boolean {
  if (expected.length !== actual.length) return false
  const expectedKeys = new Set(expected.map(stagedChildTranscriptAllowanceKey))
  return actual.every((allowance) => expectedKeys.has(stagedChildTranscriptAllowanceKey(allowance)))
}

function stagedChildTranscriptAllowanceKey(allowance: AgentStagedChildTranscriptAllowance): string {
  const { archive } = allowance
  return JSON.stringify([
    allowance.childRunId,
    archive.kind,
    archive.relativePath,
    archive.sha256,
    archive.bytes,
    archive.lines ?? null
  ])
}

function prunePendingAgentRunArchiveScopes(scopes: Map<string, PendingAgentRunArchiveScope>): void {
  while (scopes.size > MAX_PENDING_AGENT_RUN_ARCHIVE_SCOPES) {
    const oldest = [...scopes.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt)[0]
    if (!oldest) return
    scopes.delete(oldest[0])
  }
}

function cleanupArtifactKind(kind: string): 'tool_result' | 'child_transcript' | 'parent_turn_staging' | 'unknown' {
  if (kind === 'conversation_tool_result') return 'tool_result'
  if (kind === 'conversation_child_transcript' || kind === 'staged_child_transcript') return 'child_transcript'
  if (kind === 'parent_turn_stage') return 'parent_turn_staging'
  return 'unknown'
}

async function invalidateAgentHistoryIndex(rootPath: string): Promise<void> {
  await rm(join(rootPath, AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH), { force: true })
}
