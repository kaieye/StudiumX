import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { defaultSettings } from './teaching-settings'
import { Logger } from './logger'
import { TeachingMemoryStore } from './teaching-memory'
import { createLearningSessionLedger, type LearningSessionLedger } from './learning-session-ledger'
import { createLearningOutcomeCommitter, type LearningOutcomeCommitter, type LearningOutcomeCommitterFaultPoint } from './learning-outcome-committer'
import { createLessonInteractionRecorder } from './lesson-interaction-recorder'
import { inspectGitWorkspace } from './teaching-git'
import {
  buildCourseSummaries,
  buildWorkspaceCatalog
} from './teaching-workspace-catalog'
import { planLessonIndexReconciliation } from './teaching-workspace/catalog-reconciliation'
import { runLessonGenerationPipeline, type LessonGenerationCallbacks } from './teaching-lesson-generation'
import {
  DIRECT_LESSON_OPERATION,
  DirectLessonActionMutex,
  DirectLessonInFlightRegistry,
  assertActionId,
  computeRequestTag,
  isReceiptResultExpired,
  loadOrCreateInstallKey,
  readDirectLessonReceipt,
  requestTagsEqual,
  writeDirectLessonReceipt,
  type CanonicalDirectLessonInput,
  type DirectLessonReceipt
} from './direct-lesson-action'
import { finalizeLessonArtifactPublication } from './teaching-lesson-artifacts'
import {
  cleanText,
  normalizeWorkspaceRelativePath,
  type WorkspacePathMeta
} from './teaching-workspace-paths'
import {
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
import { parentTurnStageSafeTextDigest } from './ai/agent-parent-turn-staging'
import type { AgentStagedChildTranscriptAllowance } from './agent-conversation-session-audit'
import { createAgentConversationCheckpoint, resolveAgentConversationCheckpoint } from './agent-conversation-checkpoints'
import {
  readWriteRewindJournal,
  restoreWriteRewindJournal
} from './ai/tools/write-rewind-journal'
import {
  forkAgentConversationBranchAtRoot,
  openAgentConversationBranchAtRoot,
  readAgentConversationSessionTreeAtRoot,
  replayAgentConversationBranchAtRoot,
  saveAgentConversationBranchAtRoot,
  updateAgentConversationBranchStatusAtRoot
} from './agent-conversation-session-tree'
import {
  AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH,
  queryAgentArchivedHistory as queryArchivedHistoryAtRoot,
  rebuildAgentConversationHistoryIndex
} from './agent-conversation-history'
import { projectAgentConversationSummaries } from './agent-conversation-summary-projection'
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

const E2E_CRASH_POINTS: readonly LearningOutcomeCommitterFaultPoint[] = [
  'after_stage_flush',
  'before_catalog_reconcile',
  'after_record_publish',
  'after_outcome_publish'
]

/** Returns a crash seam only for explicitly marked Electron E2E test runtimes. */
export function resolveE2ECrashPoint(env: NodeJS.ProcessEnv): LearningOutcomeCommitterFaultPoint | undefined {
  if (env.NODE_ENV !== 'test' || env.STUDIUMX_TEST !== '1' || env.STUDIUMX_E2E !== '1') return undefined
  const candidate = env.STUDIUMX_E2E_CRASH_POINT
  return E2E_CRASH_POINTS.includes(candidate as LearningOutcomeCommitterFaultPoint)
    ? candidate as LearningOutcomeCommitterFaultPoint
    : undefined
}

/** Only the first evidence revision is exempted so correction (outcome-seq-2) still crashes. */
export function isInitialCatalogReconcileOperation(point: LearningOutcomeCommitterFaultPoint, operationId: string): boolean {
  return point === 'before_catalog_reconcile' && operationId === 'outcome-seq-1'
}

import type { CommitLearningOutcomeRequest } from '../shared/teaching-types/system-api'
import { isLearningSessionId } from '../shared/teaching-placement'
import { persistedAgentParentTurnProof, sanitizePersistedConversationTitle } from '../shared/agent-persisted-history'
import {
  agentConversationDirectoryRelativePath,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationMarkdownRelativePath,
  isRootAgentConversationMarkdownRelativePath,
  isTemporaryAgentConversationPath
} from '../shared/agent-conversation-catalog'
import {
  EMPTY_REGISTRY,
  applyRegistryWorkspaceMeta,
  assertSafeWorkspaceRootForRemoval,
  findWorkspace,
  isWorkspaceTrust,
  orderRegistryWorkspaces,
  setRegistryWorkspaceTrust,
  touchRegistryWorkspace,
  visibleRegistryWorkspaces,
  workspaceTrust,
  type RegistryWorkspace,
  type WorkspaceRegistry
} from './teaching-workspace/registry'
import {
  appendSessionEvent as appendWorkspaceSessionEvent,
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
import { replaceDurably, type DurableFileOperations } from './persistence/durable-file'
import {
  advanceMissionActionReceiptPhase,
  computeMissionRequestTag,
  loadOrCreateMissionActionBindingKey,
  missionRequestTagsMatch,
  readMissionActionReceipt,
  writeMissionActionReceipt,
  type MissionActionReceipt
} from './teaching-workspace/mission-action-receipt'
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
  CreateAgentConversationCheckpointPayload,
  ListAgentWriteRewindJournalPayload,
  ListAgentWriteRewindJournalResult,
  RestoreAgentWriteRewindPayload,
  RestoreAgentWriteRewindResult,
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
  DirectLessonActionStatus,
  DirectLessonActionStatusPayload,
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
  RenameAgentConversationPayload,
  RenameAgentConversationResult,
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
  ProjectAgentConversationSummariesPayload,
  ProjectAgentConversationSummariesResult,
  UpdateTeachingMemoryPayload,
  MissionMutationResult,
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
  /** Generated only for a new trusted event ID and reused by retries. */
  traceId: string
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

type TeachingWorkspaceServiceOptions = {
  registryPath: string
  defaultRoot: string
  settingsProvider?: () => Promise<TeachingSettingsV1>
  skillLibraryService?: SkillLibraryService
  /** Main-process diagnostic sink; renderer payloads never supply trace context. */
  logger?: Logger
  /** R2-only seams used to verify root/session authorization before commit delegation. */
  learningOutcomeLedgerFactory?: LearningOutcomeLedgerFactory
  learningOutcomeCommitterFactory?: LearningOutcomeCommitterFactory
  /** Narrow C-4 test seam for canonical durable publication. */
  durableFileOperations?: DurableFileOperations
  /** Receives only the shared primitive's generic directory-fsync warning. */
  durableWarn?: (message: string) => void
  /** Optional user MCP session manager for agent-run inject (ADR-0128). */
  mcpSessionManager?: import('./mcp/session-manager').McpSessionManager | null
  /**
   * Optional MCP host for multi-source prepare / controlled auto-connect
   * before agent-run inject (ADR-0137). When present, preferred over bare session manager.
   */
  mcpHost?: import('./mcp/host').McpHost | null
}

export class TeachingWorkspaceService {
  private readonly registryPath: string
  private readonly appDataRoot: string
  private readonly mcpSessionManager: import('./mcp/session-manager').McpSessionManager | null
  private readonly mcpHost: import('./mcp/host').McpHost | null
  private readonly defaultRoot: string
  private readonly settingsProvider?: () => Promise<TeachingSettingsV1>
  private readonly skillLibraryService?: SkillLibraryService
  private readonly logger?: Logger
  private readonly memoryStore: TeachingMemoryStore
  private readonly reviewDeck = new TeachingWorkspaceReviewDeck()
  private readonly changeAudit: TeachingWorkspaceChangeAudit
  private readonly documents = new TeachingWorkspaceDocuments()
  private readonly activation: TeachingWorkspaceActivationLifecycle
  private readonly learningOutcomeLedgerFactory: LearningOutcomeLedgerFactory
  private readonly learningOutcomeCommitterFactory: LearningOutcomeCommitterFactory
  private readonly durableFileOperations?: DurableFileOperations
  private readonly durableWarn?: (message: string) => void
  private readonly pendingAgentRunArchiveScopes = new Map<string, PendingAgentRunArchiveScope>()
  /** Per-renderer trusted preview authority; never stores a WebContents object. */
  private readonly activePreviewBindings = new Map<number, ActivePreviewBinding>()
  private readonly previewInteractionQueues = new Map<number, Promise<void>>()
  private nextPreviewBindingAttempt = 1
  private readonly previewReadGenerations = new Map<number, number>()
  /** Instance-local queue for whole-registry trust read-modify-write operations. */
  private workspaceTrustMutationQueue: Promise<void> = Promise.resolve()
  /** Per-workspace serialization for mission_update receipt + participant writes. */
  private readonly missionMutationQueues = new Map<string, Promise<void>>()
  private missionBindingKeyPromise: Promise<Buffer> | null = null  /** Direct-UI lesson action serialization and in-flight markers (not used by agent). */
  private readonly directLessonActionMutex = new DirectLessonActionMutex()
  private readonly directLessonInFlight = new DirectLessonInFlightRegistry()
  private directLessonInstallKey: Buffer | null = null
  constructor(options: TeachingWorkspaceServiceOptions) {
    this.registryPath = options.registryPath
    this.appDataRoot = dirname(this.registryPath)
    this.mcpSessionManager = options.mcpSessionManager ?? null
    this.mcpHost = options.mcpHost ?? null
    this.defaultRoot = options.defaultRoot
    this.settingsProvider = options.settingsProvider
    this.skillLibraryService = options.skillLibraryService
    this.logger = options.logger
    this.durableFileOperations = options.durableFileOperations
    this.durableWarn = options.durableWarn
    this.learningOutcomeLedgerFactory = options.learningOutcomeLedgerFactory ?? ((workspaceRoot) =>
      createLearningSessionLedger({ workspaceRoot })
    )
    this.learningOutcomeCommitterFactory = options.learningOutcomeCommitterFactory ?? ((workspaceRoot, ledger) => {
      const crashPoint = resolveE2ECrashPoint(process.env)
      return createLearningOutcomeCommitter({
        workspaceRoot,
        ledger: ledger as LearningSessionLedger,
        testingFaults: crashPoint ? {
          inject: async (point, context) => {
            if (point === crashPoint && isInitialCatalogReconcileOperation(point, context.operationId)) return
            if (point === crashPoint) process.kill(process.pid, 'SIGKILL')
          }
        } : undefined
      })
    })
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
    await replaceDurably({
      path: join(this.appDataRoot, 'conversations', '.index.json'),
      content: `${JSON.stringify(index, null, 2)}\n`,
      mode: 0o600
    })
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
    const state = await this.activation.load(options)
    this.maybePrepareMcpForActiveWorkspace(state)
    return state
  }

  async createWorkspace(payload: CreateWorkspacePayload): Promise<TeachingAppState> {
    const state = await this.activation.create(payload)
    this.maybePrepareMcpForActiveWorkspace(state)
    return state
  }

  async selectWorkspace(workspaceId: string): Promise<TeachingAppState> {
    const state = await this.activation.select(workspaceId)
    this.maybePrepareMcpForActiveWorkspace(state)
    return state
  }

  async importWorkspace(rootPath: string): Promise<TeachingAppState> {
    const state = await this.activation.import(rootPath)
    this.maybePrepareMcpForActiveWorkspace(state)
    return state
  }

  /**
   * ADR-0141: when a workspace becomes active and MCP host is present,
   * prepare multi-source config + controlled auto-connect (fail-soft).
   */
  private maybePrepareMcpForActiveWorkspace(state: TeachingAppState): void {
    const root = state.activeWorkspace?.rootPath
    if (!root || !this.mcpHost) return
    void this.mcpHost.prepareForWorkspace(root).catch(() => undefined)
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

  async listWorkspaceSummariesForAnalytics(): Promise<AnalyticsWorkspaceScanResult[]> {
    const registry = await this.ensureRegistry()
    const results = await Promise.all(
      registry.workspaces.map(async (workspace): Promise<AnalyticsWorkspaceScanResult> => {
        try {
          const summary = await this.summarizeWorkspace(workspace)
          return {
            workspaceId: workspace.id,
            workspaceName: summary.name ?? workspace.id,
            rootPath: workspace.rootPath,
            summary
          }
        } catch (error) {
          return {
            workspaceId: workspace.id,
            workspaceName: workspace.id,
            rootPath: workspace.rootPath,
            error: error instanceof Error ? error.message : 'summarize failed'
          }
        }
      })
    )
    return results
  }

  async listTemporaryConversationSummariesForAnalytics(): Promise<AgentConversationSummary[]> {
    const registry = await this.ensureRegistry()
    return this.listTemporaryConversations(registry)
  }

    async listWorkspaceChangesForAnalytics(
    workspaceId: string
  ): Promise<TeachingWorkspaceChangeSummary[]> {
    return this.changeAudit.listSummaries(workspaceId)
  }

  async reconcileInterruptedAgentRuns(): Promise<InterruptedAgentRun[]> {
    const stores = await this.agentRunStores()
    return (await Promise.all(stores.map((store) => store.reconcileInterrupted(async (stage) => {
      if (!stage.targetConversationId || !stage.expectedParentTurnProof) return false
      const record = await readRawAgentConversationRecord(store.storageRoot, stage.targetConversationId).catch(() => null)
      return Boolean(record && hasAgentParentTurnCommit(record.turns, stage.runId, stage.expectedParentTurnProof))
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

  /**
   * Stores the workspace-level positive agent-tool grant in application data.
   * This deliberately avoids workspace `.studiumx` material and leaves every
   * unrelated registry field (including future write/permission settings) intact.
   */
  async setWorkspaceTrust(workspaceId: string, trust: 'trusted' | 'untrusted'): Promise<TeachingAppState> {
    if (!isWorkspaceTrust(trust)) throw new Error('Workspace trust must be trusted or untrusted.')
    return this.serializeWorkspaceTrustMutation(async () => {
      const registry = await this.ensureRegistry()
      const workspace = findWorkspace(registry, workspaceId)
      if (workspace.archived) throw new Error('Workspace not found.')
      const nextRegistry: WorkspaceRegistry = {
        ...registry,
        workspaces: registry.workspaces.map((entry) =>
          entry.id === workspace.id ? setRegistryWorkspaceTrust(entry, trust) : entry
        )
      }
      await this.saveRegistry(nextRegistry)
      return this.buildState(nextRegistry, registry.activeWorkspaceId, null)
    })
  }

  /**
   * Trust changes replace the complete registry file, so they must serialize
   * within this main-process service instance. A failed mutation releases the
   * queue; no module-global lock or unrelated workspace operation is affected.
   */
  private async serializeWorkspaceTrustMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.workspaceTrustMutationQueue.then(operation, operation)
    this.workspaceTrustMutationQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  async updateMission(payload: UpdateMissionPayload): Promise<MissionMutationResult> {
    return this.serializeMissionMutation(payload.workspaceId, () => this.runMissionUpdate(payload))
  }

  private async runMissionUpdate(payload: UpdateMissionPayload): Promise<MissionMutationResult> {
    const prompt = cleanText(payload.prompt)
    if (!prompt) throw new Error('Mission prompt is required.')

    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const actionId = payload.actionId

    let bindingKey: Buffer
    try {
      bindingKey = await this.getMissionActionBindingKey()
    } catch {
      this.logger?.warn('Mission action binding key unavailable.', {
        component: 'main',
        tag: 'mission-action'
      })
      return { disposition: 'indeterminate', retryable: false }
    }

    const requestTag = computeMissionRequestTag({
      bindingKey,
      workspaceId: workspace.id,
      actionId,
      prompt
    })

    const existingRead = await readMissionActionReceipt({
      workspaceRoot: workspace.rootPath,
      actionId,
      operations: this.durableFileOperations
    })

    if (existingRead.status === 'invalid') {
      this.logger?.warn('Mission action receipt unreadable.', {
        component: 'main',
        tag: 'mission-action'
      })
      return { disposition: 'indeterminate', retryable: false }
    }

    if (existingRead.status === 'valid') {
      return this.reconcileExistingMissionAction({
        receipt: existingRead.receipt,
        workspaceId: workspace.id,
        requestTag
      })
    }

    const now = new Date().toISOString()
    const traceId = randomUUID()
    const eventId = randomUUID()
    let receipt: MissionActionReceipt = {
      schemaVersion: 1,
      kind: 'mission_update',
      workspaceId: workspace.id,
      actionId,
      traceId,
      eventId,
      phase: 'prepared',
      requestTag,
      createdAt: now,
      updatedAt: now
    }

    try {
      await writeMissionActionReceipt({
        workspaceRoot: workspace.rootPath,
        receipt,
        operations: this.durableFileOperations,
        warn: this.durableWarn
      })
    } catch {
      this.logger?.warn('Mission action receipt prepare failed.', {
        component: 'main',
        tag: 'mission-action',
        traceId
      })
      return { disposition: 'indeterminate', retryable: false }
    }

    const topic = deriveWorkspaceTopic(prompt, workspace.name)
    try {
      await replaceDurably({
        path: join(workspace.rootPath, 'MISSION.md'),
        content: renderMission(topic, prompt),
        // Keep the legacy writeFile create-mode contract (subject to umask) for
        // this user-visible canonical artifact.
        mode: 0o666,
        operations: this.durableFileOperations,
        warn: this.durableWarn
      })
    } catch (error) {
      this.logger?.warn('Mission canonical publish failed.', {
        component: 'main',
        tag: 'mission-action',
        traceId
      })
      throw error
    }

    receipt = advanceMissionActionReceiptPhase(receipt, 'mission_published', new Date().toISOString())
    await writeMissionActionReceipt({
      workspaceRoot: workspace.rootPath,
      receipt,
      operations: this.durableFileOperations,
      warn: this.durableWarn
    })

    try {
      await this.appendSessionEvent(workspace.rootPath, {
        id: eventId,
        kind: 'mission_updated',
        timestamp: now,
        workspaceId: workspace.id,
        prompt,
        paths: ['MISSION.md'],
        traceId
      })
    } catch (error) {
      this.logger?.warn('Mission lifecycle append failed.', {
        component: 'main',
        tag: 'mission-action',
        traceId
      })
      throw error
    }

    receipt = advanceMissionActionReceiptPhase(receipt, 'event_appended', new Date().toISOString())
    await writeMissionActionReceipt({
      workspaceRoot: workspace.rootPath,
      receipt,
      operations: this.durableFileOperations,
      warn: this.durableWarn
    })

    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    try {
      await this.saveRegistry(nextRegistry)
    } catch (error) {
      this.logger?.warn('Mission registry save failed.', {
        component: 'main',
        tag: 'mission-action',
        traceId
      })
      throw error
    }

    receipt = advanceMissionActionReceiptPhase(receipt, 'final', new Date().toISOString())
    await writeMissionActionReceipt({
      workspaceRoot: workspace.rootPath,
      receipt,
      operations: this.durableFileOperations,
      warn: this.durableWarn
    })

    const state = await this.buildState(nextRegistry, workspace.id, null)
    this.logger?.info('Mission update completed.', {
      component: 'main',
      tag: 'mission-action',
      traceId
    })
    return { disposition: 'completed', state }
  }

  private async reconcileExistingMissionAction(options: {
    receipt: MissionActionReceipt
    workspaceId: string
    requestTag: string
  }): Promise<MissionMutationResult> {
    const { receipt, workspaceId, requestTag } = options
    if (
      receipt.kind !== 'mission_update' ||
      receipt.workspaceId !== workspaceId ||
      !missionRequestTagsMatch(receipt.requestTag, requestTag)
    ) {
      this.logger?.warn('Mission action conflict.', {
        component: 'main',
        tag: 'mission-action',
        traceId: receipt.traceId
      })
      return { disposition: 'conflict', retryable: false }
    }

    if (receipt.phase === 'final') {
      const registry = await this.ensureRegistry()
      const state = await this.buildState(registry, workspaceId, null)
      this.logger?.info('Mission update result reused.', {
        component: 'main',
        tag: 'mission-action',
        traceId: receipt.traceId
      })
      return { disposition: 'reused', state }
    }

    // Non-final phases are not auto-continued in the mission-first slice: without
    // a stronger canonical ownership proof, continuing could double-append or
    // silently accept external edits.
    this.logger?.warn('Mission action indeterminate non-final receipt.', {
      component: 'main',
      tag: 'mission-action',
      traceId: receipt.traceId
    })
    return { disposition: 'indeterminate', retryable: false }
  }

  private async getMissionActionBindingKey(): Promise<Buffer> {
    if (!this.missionBindingKeyPromise) {
      this.missionBindingKeyPromise = loadOrCreateMissionActionBindingKey({
        appDataRoot: this.appDataRoot,
        durableOperations: this.durableFileOperations,
        warn: this.durableWarn
      }).catch((error) => {
        this.missionBindingKeyPromise = null
        throw error
      })
    }
    return this.missionBindingKeyPromise
  }

  private async serializeMissionMutation<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.missionMutationQueues.get(workspaceId) ?? Promise.resolve()
    const queued = previous.then(operation, operation)
    this.missionMutationQueues.set(
      workspaceId,
      queued.then(() => undefined, () => undefined)
    )
    return queued
  }

  async generateLesson(payload: GenerateLessonPayload): Promise<GenerateLessonResult> {
    return this.runDirectLessonAction(payload, null)
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
    await replaceDurably({
      path: join(workspace.rootPath, 'assets', 'lesson.css'),
      content: lessonStyleCss(styleId),
      // Preserve writeFile's legacy create-mode contract (subject to umask)
      // for this user-visible canonical stylesheet.
      mode: 0o666,
      operations: this.durableFileOperations,
      warn: this.durableWarn
    })
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
    return this.runDirectLessonAction(payload, stream)
  }

  /**
   * Status-only lookup for direct-UI lesson generation. Never re-enters the
   * provider. Reload recovery polls this after restoring a pending actionId.
   */
  async getDirectLessonActionStatus(payload: DirectLessonActionStatusPayload): Promise<DirectLessonActionStatus> {
    let actionId: string
    try {
      actionId = assertActionId(payload.actionId)
    } catch {
      return { disposition: 'rejected', actionId: String(payload.actionId ?? ''), code: 'invalid_request' }
    }

    let registry
    try {
      registry = await this.ensureRegistry()
    } catch {
      return { disposition: 'rejected', actionId, code: 'workspace_unavailable' }
    }

    const workspace = registry.workspaces.find((candidate) => candidate.id === payload.workspaceId && !candidate.archived)
    if (!workspace) {
      return { disposition: 'rejected', actionId, code: 'workspace_unavailable' }
    }

    if (this.directLessonInFlight.isActive(workspace.id, actionId)) {
      return { disposition: 'in_progress', actionId }
    }

    const receiptRead = await readDirectLessonReceipt(workspace.rootPath, actionId)
    if (receiptRead.status === 'missing') {
      return { disposition: 'indeterminate', actionId, code: 'receipt_unavailable' }
    }
    if (receiptRead.status === 'corrupt') {
      return { disposition: 'conflict', actionId, code: 'receipt_corrupt' }
    }

    const receipt = receiptRead.receipt
    if (receipt.workspaceId !== workspace.id) {
      return { disposition: 'conflict', actionId, code: 'workspace_mismatch' }
    }
    if (receipt.operation !== DIRECT_LESSON_OPERATION) {
      return { disposition: 'conflict', actionId, code: 'operation_mismatch' }
    }
    if (isReceiptResultExpired(receipt)) {
      return { disposition: 'conflict', actionId, code: 'expired' }
    }
    if (receipt.phase === 'completed') {
      return this.rebuildDirectLessonResultFromReceipt({
        workspace,
        registry,
        receipt,
        disposition: 'reused'
      })
    }
    if (receipt.phase === 'tombstone') {
      return { disposition: 'conflict', actionId, code: 'expired' }
    }
    // accepted / provider_started without in-flight worker: fail closed (no auto-continue from status).
    return { disposition: 'indeterminate', actionId, code: 'provider_outcome_unknown' }
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
    if (workspace?.archived) throw new Error('Workspace not found.')
    const settings = await this.loadSettings()
    // The three approval modes are the only user-facing file permission model.
    // File tools remain unavailable when the workspace-file tool itself is off.
    const workspaceToolAccessGranted = workspace ? settings.tools.workspaceRead : false
    const runtimeWorkspace = workspace ? { ...workspace, workspaceToolAccessGranted } : null
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
    const result = await runTeachingConversationTurn(payload, stream, runtimeWorkspace, {
      appDataRoot: this.appDataRoot,
      mcpSessionManager: this.mcpSessionManager,
      mcpHost: this.mcpHost,
      runStore: new AgentRunStore(runStorageRoot),
      loadSettings: () => this.loadSettings(),
      listMemories: (workspaceRoot, includeDeleted) => this.memoryStore.list(workspaceRoot, includeDeleted === true),
      createMemory: (memoryPayload) => this.memoryStore.create(memoryPayload),
      deleteMemory: (memoryId, workspaceRoot) => this.memoryStore.delete(memoryId, { workspaceRoot }),
      loadSkillReferences: (skillIds, userInput) =>
        this.skillLibraryService?.readInvokedSkillReferences(userInput, skillIds) ?? Promise.resolve([]),
      generateLessonFromBrief: runtimeWorkspace && isTeachingConversation
        ? async (brief) => {
            const generation = await this.generateAndPersistLesson({
              workspace: runtimeWorkspace,
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
    // Generated only in the main process and used solely for diagnostic correlation.
    const traceId = randomUUID()
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
    const title = sanitizePersistedConversationTitle(existing?.title ?? deriveConversationTitle(turns, now))
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
    let persistedParentTurnProof: string | null = null
    const createdAt = existing?.createdAt ?? now
    const newConversationDir = isTemporaryConversation
      ? agentConversationDirectoryRelativePath({ ...payload, createdAt, mode: 'temporary' })
      : agentConversationDirectoryRelativePath({ ...payload, createdAt })
    const relativePath = existing?.relativePath ?? agentConversationMarkdownRelativePath(id, newConversationDir)
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
    if (runStore && runId) {
      if (!stagedParentTurn) {
        throw new Error('Parent turn staging is unavailable; refusing an unverified conversation save.')
      }
      const finalAssistantIndex = turns.findLastIndex((turn) => turn.role === 'assistant')
      const finalAssistant = finalAssistantIndex >= 0 ? turns[finalAssistantIndex] : null
      const finalUser = finalAssistantIndex >= 0
        ? turns.slice(0, finalAssistantIndex).findLast((turn) => turn.role === 'user')
        : null
      const confirmedSha256 = finalAssistant
        ? parentTurnStageSafeTextDigest(finalAssistant.content)
        : null
      const userInputSha256 = finalUser
        ? parentTurnStageSafeTextDigest(finalUser.content)
        : null
      if (!stagedParentTurn.confirmedAssistant || confirmedSha256 !== stagedParentTurn.confirmedAssistant.sha256) {
        throw new Error('Conversation final answer does not match the explicitly confirmed parent turn.')
      }
      if (userInputSha256 !== stagedParentTurn.userInput.sha256) {
        throw new Error('Conversation user input does not match the staged parent turn.')
      }
      turns = attachAgentParentTurnCommit(turns, runId)
    }

    const record: AgentConversationRecord = {
      id,
      workspaceId: existing?.workspaceId ?? workspace.id,
      title,
      createdAt,
      updatedAt: now,
      // Existing records retain their exact stored location; saving never migrates layouts.
      relativePath,
      absolutePath: join(storageRoot, relativePath),
      messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
      traceId,
      branch: existingBranch
        ? existingBranch
        : { schemaVersion: 1, sessionId: id, branchId: id, revision: 1, status: 'active' },
      turns
    }

    const stageFinalCanonicalSave = runStore && runId && stagedParentTurn
      ? async (canonicalRecord: AgentConversationRecord): Promise<void> => {
          // Archive promotion has now replaced large inline results and staged child
          // references with their final stored placeholders. Bind the stage to that
          // exact unhydrated canonical prefix before JSON becomes durable.
          persistedParentTurnProof = persistedAgentParentTurnProof(canonicalRecord.turns).digest
          await runStore.prepareParentTurnSave(runId, id, persistedParentTurnProof)
        }
      : undefined

    await invalidateAgentHistoryIndex(storageRoot)
    let persistedRecord: AgentConversationRecord | undefined
    const captureFinalCanonicalSave = async (canonicalRecord: AgentConversationRecord): Promise<void> => {
      // The public archive/write APIs intentionally resolve void. The final
      // post-promotion projection needed for workspace staging and summaries
      // crosses this private callback seam instead.
      persistedRecord = canonicalRecord
      await stageFinalCanonicalSave?.(canonicalRecord)
    }
    if (existing) {
      persistedRecord = await saveAgentConversationBranchAtRoot({ ...workspace, rootPath: storageRoot }, record, {
        expectedRevision: payload.expectedBranchRevision,
        allowedStagedChildTranscripts: authorizedAllowances,
        beforeCanonicalSave: captureFinalCanonicalSave
      })
    } else {
      await writeAgentConversationRecord({ ...workspace, rootPath: storageRoot }, record, {
        allowedStagedChildTranscripts: authorizedAllowances,
        beforeCanonicalSave: captureFinalCanonicalSave
      })
    }
    if (!persistedRecord) throw new Error('Conversation archive did not provide its canonical record.')
    this.logger?.info('Conversation archive persisted.', { component: 'main', tag: 'agent-archive', traceId })
    if (!isTemporaryConversation) {
      await this.appendSessionEvent(workspace.rootPath, {
        id: randomUUID(),
        kind: 'agent_conversation_recorded',
        timestamp: persistedRecord.updatedAt,
        workspaceId: workspace.id,
        traceId: persistedRecord.traceId,
        prompt: title,
        paths: [persistedRecord.relativePath, agentConversationJsonRelativePathForMarkdown(persistedRecord.relativePath)]
      })
    }

    const nextRegistry = isTemporaryConversation ? registry : touchRegistryWorkspace(registry, workspace.id, now)
    if (!isTemporaryConversation) await this.saveRegistry(nextRegistry)
    if (runStore && runId && persistedParentTurnProof && stagedParentTurn) {
      await runStore.settleParentTurn(runId, id, persistedParentTurnProof)
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

  async renameAgentConversation(payload: RenameAgentConversationPayload): Promise<RenameAgentConversationResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const requestedTitle = cleanText(payload.title)
    if (!requestedTitle || requestedTitle.length > 160) throw new Error('Conversation title must contain 1 to 160 characters.')

    const title = sanitizePersistedConversationTitle(requestedTitle)
    const location = await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, payload.scope)
    const persistedRecord = await saveAgentConversationBranchAtRoot(
      { ...workspace, rootPath: location.rootPath },
      { ...location.record, title, updatedAt: new Date().toISOString() },
      { expectedRevision: payload.expectedRevision }
    )
    await invalidateAgentHistoryIndex(location.rootPath)

    const nextRegistry = location.global
      ? registry
      : touchRegistryWorkspace(registry, workspace.id, persistedRecord.updatedAt)
    if (!location.global) await this.saveRegistry(nextRegistry)

    return {
      state: await this.buildState(nextRegistry, workspace.id, null),
      conversation: toAgentConversationSummary(persistedRecord, {}, workspace.id)
    }
  }

  async readAgentConversation(payload: ReadAgentConversationPayload): Promise<AgentConversationRecord> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const record = (await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId, payload.scope)).record
    return { ...record, branch: inferAgentConversationBranchMetadata(record) }
  }

  async projectAgentConversationSummaries(
    payload: ProjectAgentConversationSummariesPayload
  ): Promise<ProjectAgentConversationSummariesResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    return {
      // This deliberately targets the workspace root only. Temporary/app-data
      // conversations are ineligible and never receive a projection.
      outcomes: await projectAgentConversationSummaries({
        rootPath: workspace.rootPath,
        conversationIds: payload.conversationIds
      })
    }
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
    // Generated only in the main process; each fork child has its own archive
    // correlation trace and never inherits its parent or replay identity.
    const traceId = randomUUID()
    await invalidateAgentHistoryIndex(location.rootPath)
    const record = await forkAgentConversationBranchAtRoot(storageWorkspace, location.record.id, {
      sourceTurnId: payload.sourceTurnId,
      title: payload.title,
      expectedRevision: payload.expectedRevision,
      traceId
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
        traceId: record.traceId,
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

  /**
   * Restore tool write pre-images for one agent run.
   * UI copy: 「撤销本轮写入」— distinct from conversation prefix checkpoint restore.
   */
  async restoreAgentWriteRewind(
    payload: RestoreAgentWriteRewindPayload
  ): Promise<RestoreAgentWriteRewindResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const result = await restoreWriteRewindJournal({
      workspaceRoot: workspace.rootPath,
      runId: payload.runId
    })
    return {
      kind: 'tool_write_rewind',
      runId: payload.runId.trim(),
      restored: result.restored,
      deleted: result.deleted,
      skipped: result.skipped
    }
  }

  async listAgentWriteRewindJournal(
    payload: ListAgentWriteRewindJournalPayload
  ): Promise<ListAgentWriteRewindJournalResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const entries = await readWriteRewindJournal({
      workspaceRoot: workspace.rootPath,
      runId: payload.runId
    })
    return {
      kind: 'tool_write_rewind_journal',
      runId: payload.runId.trim(),
      entries: entries.map((entry) => ({
        relativePath: entry.relativePath,
        capturedAt: entry.capturedAt,
        existed: entry.existed,
        bytes: entry.bytes
      }))
    }
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
   * Direct-UI action coordinator for generateLesson / generateLessonStream.
   * Agent generation never enters this path and must not carry actionId.
   */
  private async runDirectLessonAction(
    payload: GenerateLessonPayload,
    stream: {
      streamId: string
      onChunk: (chunk: LessonStreamChunk) => void
      onStatus: (status: LessonStreamStatus) => void
    } | null
  ): Promise<GenerateLessonResult> {
    let actionId: string
    try {
      actionId = assertActionId(payload.actionId)
    } catch {
      return { disposition: 'rejected', actionId: String(payload.actionId ?? ''), code: 'invalid_request' }
    }

    const prompt = cleanText(payload.prompt)
    if (!prompt) {
      return { disposition: 'rejected', actionId, code: 'invalid_request' }
    }

    let registry
    try {
      registry = await this.ensureRegistry()
    } catch {
      return { disposition: 'rejected', actionId, code: 'workspace_unavailable' }
    }

    let workspace
    try {
      workspace = findWorkspace(registry, payload.workspaceId)
    } catch {
      return { disposition: 'rejected', actionId, code: 'workspace_unavailable' }
    }

    return this.directLessonActionMutex.runExclusive(workspace.id, actionId, async () => {
      this.directLessonInFlight.mark(workspace.id, actionId)
      try {
        return await this.executeDirectLessonAction({
          payload: { ...payload, actionId, prompt },
          workspace,
          registry,
          stream
        })
      } finally {
        this.directLessonInFlight.clear(workspace.id, actionId)
      }
    })
  }

  private async executeDirectLessonAction(options: {
    payload: GenerateLessonPayload & { prompt: string }
    workspace: RegistryWorkspace
    registry: WorkspaceRegistry
    stream: {
      streamId: string
      onChunk: (chunk: LessonStreamChunk) => void
      onStatus: (status: LessonStreamStatus) => void
    } | null
  }): Promise<GenerateLessonResult> {
    const { payload, workspace, stream } = options
    const actionId = assertActionId(payload.actionId)
    const messages = payload.messages ?? []
    const canonicalInput: CanonicalDirectLessonInput = {
      workspaceId: workspace.id,
      prompt: payload.prompt,
      courseName: payload.courseName,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content ?? null,
        ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls !== undefined
          ? {
              toolCalls: message.toolCalls.map((call) => ({
                id: call.id,
                name: call.name,
                arguments: call.arguments
              }))
            }
          : {})
      }))
    }

    let installKey: Buffer
    try {
      installKey = await this.getDirectLessonInstallKey()
    } catch {
      this.logger?.warn('Direct lesson action binding key unavailable.', {
        component: 'main',
        tag: 'direct-lesson-action'
      })
      return { disposition: 'indeterminate', actionId, code: 'receipt_unavailable' }
    }

    const requestTag = computeRequestTag(installKey, canonicalInput)
    const receiptRead = await readDirectLessonReceipt(workspace.rootPath, actionId)

    if (receiptRead.status === 'corrupt') {
      this.logger?.warn('Direct lesson action receipt unreadable.', {
        component: 'main',
        tag: 'direct-lesson-action'
      })
      return { disposition: 'conflict', actionId, code: 'receipt_corrupt' }
    }

    if (receiptRead.status === 'ok') {
      return this.reconcileExistingDirectLessonAction({
        receipt: receiptRead.receipt,
        workspace,
        registry: options.registry,
        requestTag,
        payload,
        stream
      })
    }

    // First accept for this actionId.
    const now = new Date().toISOString()
    const publicationTransactionId = randomUUID()
    const lifecycleEventId = randomUUID()
    let receipt: DirectLessonReceipt = {
      schemaVersion: 1,
      operation: DIRECT_LESSON_OPERATION,
      actionId,
      workspaceId: workspace.id,
      createdAt: now,
      updatedAt: now,
      phase: 'accepted',
      requestTag,
      effectTimestamp: now,
      publicationTransactionId,
      lifecycleEventId
    }

    try {
      receipt = await writeDirectLessonReceipt(receipt, {
        workspaceRoot: workspace.rootPath,
        operations: this.durableFileOperations,
        warn: this.durableWarn
      })
    } catch {
      this.logger?.warn('Direct lesson action receipt prepare failed.', {
        component: 'main',
        tag: 'direct-lesson-action'
      })
      return { disposition: 'indeterminate', actionId, code: 'receipt_unavailable' }
    }

    return this.continueDirectLessonAfterAccept({
      receipt,
      workspace,
      payload,
      stream
    })
  }

  private async continueDirectLessonAfterAccept(options: {
    receipt: DirectLessonReceipt
    workspace: RegistryWorkspace
    payload: GenerateLessonPayload & { prompt: string }
    stream: {
      streamId: string
      onChunk: (chunk: LessonStreamChunk) => void
      onStatus: (status: LessonStreamStatus) => void
    } | null
  }): Promise<GenerateLessonResult> {
    const { workspace, payload, stream } = options
    const actionId = options.receipt.actionId
    const publicationTransactionId = options.receipt.publicationTransactionId ?? randomUUID()
    const lifecycleEventId = options.receipt.lifecycleEventId ?? randomUUID()
    const effectTimestamp = options.receipt.effectTimestamp ?? new Date().toISOString()

    let receipt: DirectLessonReceipt = {
      ...options.receipt,
      phase: 'provider_started',
      generationStartedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publicationTransactionId,
      lifecycleEventId,
      effectTimestamp
    }

    try {
      receipt = await writeDirectLessonReceipt(receipt, {
        workspaceRoot: workspace.rootPath,
        operations: this.durableFileOperations,
        warn: this.durableWarn
      })
    } catch {
      this.logger?.warn('Direct lesson action provider_started write failed.', {
        component: 'main',
        tag: 'direct-lesson-action'
      })
      return { disposition: 'indeterminate', actionId, code: 'provider_outcome_unknown' }
    }

    const callbacks: LessonGenerationCallbacks = {
      onToken: (delta) => {
        if (stream) stream.onChunk({ streamId: stream.streamId, delta })
      },
      onStatus: (step) => {
        if (stream) stream.onStatus({ streamId: stream.streamId, step })
      }
    }

    const settings = await this.loadSettings()
    const runtimeWorkspace = {
      ...workspace,
      workspaceToolAccessGranted: settings.tools.workspaceRead
    }

    let generation: {
      lesson: LessonSummary
      source: 'ai' | 'fallback'
      reason?: string
      registry: WorkspaceRegistry
      changeSummary: TeachingWorkspaceChangeSummary | null
      lifecycleEventId: string
      publicationTransactionId: string
    }
    try {
      generation = await this.generateAndPersistLesson({
        workspace: runtimeWorkspace,
        prompt: payload.prompt,
        messages: payload.messages ?? [],
        requestedCourseName: payload.courseName,
        callbacks,
        triggerKind: 'lesson_generation',
        reservedTransactionId: publicationTransactionId,
        fixedEffectTimestamp: effectTimestamp,
        fixedLifecycleEventId: lifecycleEventId
      })
    } catch (error) {
      // Provider may have been entered; never auto-retry this actionId.
      this.logger?.warn('Direct lesson generation failed after provider_started.', {
        component: 'main',
        tag: 'direct-lesson-action'
      })
      const message = error instanceof Error ? error.message : String(error)
      // Preserve throw semantics for the session-open fail-closed gate used by
      // generation-session unit coverage (pre-publication abort) and for
      // infrastructure unavailability before a durable lesson can be proven.
      if (
        message.includes('controlled canonical session open failure') ||
        message.includes('Descriptor-relative contained directory access is unavailable') ||
        message.includes('descriptor-relative contained directory native capability is unavailable')
      ) {
        throw error
      }
      return { disposition: 'indeterminate', actionId, code: 'provider_outcome_unknown' }
    }

    receipt = {
      ...receipt,
      phase: 'completed',
      updatedAt: new Date().toISOString(),
      lessonId: generation.lesson.id,
      lessonRelativePath: generation.lesson.relativePath,
      lifecycleEventId: generation.lifecycleEventId,
      publicationTransactionId: generation.publicationTransactionId,
      source: generation.source,
      reason: generation.reason,
      terminalKind: 'completed'
    }
    try {
      await writeDirectLessonReceipt(receipt, {
        workspaceRoot: workspace.rootPath,
        operations: this.durableFileOperations,
        warn: this.durableWarn
      })
    } catch {
      this.logger?.warn('Direct lesson action completed receipt write failed.', {
        component: 'main',
        tag: 'direct-lesson-action'
      })
      return { disposition: 'indeterminate', actionId, code: 'projection_unprovable' }
    }

    if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
    this.logger?.info('Direct lesson generation completed.', {
      component: 'main',
      tag: 'direct-lesson-action'
    })
    return {
      disposition: 'succeeded',
      actionId,
      kind: 'lesson',
      state: await this.buildState(generation.registry, workspace.id, generation.lesson.absolutePath),
      lesson: generation.lesson,
      source: generation.source,
      reason: generation.reason,
      changeSummary: generation.changeSummary
    }
  }

  private async reconcileExistingDirectLessonAction(options: {
    receipt: DirectLessonReceipt
    workspace: RegistryWorkspace
    registry: WorkspaceRegistry
    requestTag: string
    payload: GenerateLessonPayload & { prompt: string }
    stream: {
      streamId: string
      onChunk: (chunk: LessonStreamChunk) => void
      onStatus: (status: LessonStreamStatus) => void
    } | null
  }): Promise<GenerateLessonResult> {
    const { receipt, workspace, requestTag, payload, stream } = options
    const actionId = receipt.actionId

    if (receipt.workspaceId !== workspace.id) {
      return { disposition: 'conflict', actionId, code: 'workspace_mismatch' }
    }
    if (receipt.operation !== DIRECT_LESSON_OPERATION) {
      return { disposition: 'conflict', actionId, code: 'operation_mismatch' }
    }
    if (!requestTagsEqual(receipt.requestTag, requestTag)) {
      return { disposition: 'conflict', actionId, code: 'request_mismatch' }
    }
    if (isReceiptResultExpired(receipt) || receipt.phase === 'tombstone' || receipt.terminalKind === 'expired') {
      return { disposition: 'conflict', actionId, code: 'expired' }
    }

    if (receipt.phase === 'completed') {
      if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
      return this.rebuildDirectLessonResultFromReceipt({
        workspace,
        registry: options.registry,
        receipt,
        disposition: 'reused'
      })
    }

    if (receipt.phase === 'accepted') {
      // Proven not to have reached provider_started: may continue once.
      return this.continueDirectLessonAfterAccept({
        receipt,
        workspace,
        payload,
        stream
      })
    }

    // provider_started (or unknown non-terminal): never re-enter provider.
    this.logger?.warn('Direct lesson action indeterminate non-final receipt.', {
      component: 'main',
      tag: 'direct-lesson-action'
    })
    return { disposition: 'indeterminate', actionId, code: 'provider_outcome_unknown' }
  }

  private async rebuildDirectLessonResultFromReceipt(options: {
    workspace: RegistryWorkspace
    registry: WorkspaceRegistry
    receipt: DirectLessonReceipt
    disposition: 'succeeded' | 'reused'
  }): Promise<GenerateLessonResult> {
    const { workspace, receipt, disposition } = options
    const actionId = receipt.actionId
    if (!receipt.lessonId || !receipt.lessonRelativePath || !receipt.source) {
      return { disposition: 'indeterminate', actionId, code: 'projection_unprovable' }
    }

    let index
    try {
      index = await this.loadWorkspaceIndex(workspace)
    } catch {
      return { disposition: 'indeterminate', actionId, code: 'projection_unprovable' }
    }

    const lesson = index.lessons.find(
      (candidate) => candidate.id === receipt.lessonId && candidate.relativePath === receipt.lessonRelativePath
    )
    if (!lesson) {
      return { disposition: 'conflict', actionId, code: 'external_mutation' }
    }

    this.logger?.info('Direct lesson generation result reused.', {
      component: 'main',
      tag: 'direct-lesson-action'
    })
    return {
      disposition,
      actionId,
      kind: 'lesson',
      state: await this.buildState(options.registry, workspace.id, lesson.absolutePath),
      lesson,
      source: receipt.source,
      reason: receipt.reason,
      changeSummary: null
    }
  }

  private async getDirectLessonInstallKey(): Promise<Buffer> {
    if (this.directLessonInstallKey) return this.directLessonInstallKey
    const key = await loadOrCreateInstallKey(this.appDataRoot)
    this.directLessonInstallKey = key
    return key
  }

  /**
   * Generate one lesson and persist every side effect (files, workspace
   * index, session event, registry touch). Both the direct IPC entry and the
   * conversation agent's generate_lesson tool go through here, so a lesson
   * created mid-conversation is indistinguishable from a directly generated
   * one. Throws LessonGenerationError instead of persisting anything when the
   * provider fails to produce a valid plan.
   *
   * Direct-UI may reserve publicationTransactionId / lifecycleEventId via
   * options; the agent path omits those fields and never uses action receipts.
   */
  private async generateAndPersistLesson(options: {
    workspace: RegistryWorkspace
    prompt: string
    brief?: LessonBrief
    messages: AgentChatMessage[]
    requestedCourseName?: string
    triggerKind?: 'lesson_generation' | 'agent_lesson_generation'
    callbacks?: LessonGenerationCallbacks
    reservedTransactionId?: string
    fixedEffectTimestamp?: string
    fixedLifecycleEventId?: string
  }): Promise<{
    lesson: LessonSummary
    source: LessonPlanSource
    reason?: string
    registry: WorkspaceRegistry
    changeSummary: TeachingWorkspaceChangeSummary | null
    lifecycleEventId: string
    publicationTransactionId: string
  }> {
    const { workspace } = options
    const beforeChanges = await this.changeAudit.capturePreMutation(workspace.rootPath)
    await this.ensureWorkspaceStructure(workspace)

    const settings = await this.loadSettings()
    const now = options.fixedEffectTimestamp ?? new Date().toISOString()
    const lifecycleEventId = options.fixedLifecycleEventId ?? randomUUID()
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
      bindCanonicalSession: async ({ lesson, assessment }) => this.openCanonicalLessonSession(workspace, lesson, assessment),
      reservedTransactionId: options.reservedTransactionId
    })

    await this.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      updatedAt: now,
      lessons: upsertLesson(index.lessons, generation.lesson)
    })
    await this.appendSessionEvent(workspace.rootPath, {
      id: lifecycleEventId,
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
      changeSummary,
      lifecycleEventId,
      publicationTransactionId: generation.transactionId
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

      const interaction = this.previewInteractionEvent(binding, normalizedIntent)
      const receipt = await createLessonInteractionRecorder({ ledger }).record(interaction.event, {
        traceId: interaction.traceId
      })
      if (!receipt.duplicate) {
        this.logger?.info('Learning Session event persisted.', {
          component: 'main',
          tag: 'learning-session-ledger',
          traceId: interaction.traceId
        })
      }
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
    const document = await this.documents.saveMarkdown(workspace, payload.documentPath, payload.content, {
      durableFileOperations: this.durableFileOperations,
      durableWarn: this.durableWarn
    })
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
    // Generated only in the main process and used solely for diagnostic correlation.
    const traceId = randomUUID()
    const memory = await this.memoryStore.create(payload, { traceId })
    this.logger?.info('Memory created.', { component: 'main', tag: 'memory-catalog', traceId })
    return memory
  }

  async updateMemory(memoryId: string, patch: UpdateTeachingMemoryPayload): Promise<TeachingMemoryRecord> {
    // Generated only in the main process and used solely for diagnostic correlation.
    const traceId = randomUUID()
    const memory = await this.memoryStore.update(memoryId, patch, {
      workspaceRoot: patch.workspaceRoot
    }, { traceId })
    this.logger?.info('Memory updated.', { component: 'main', tag: 'memory-catalog', traceId })
    return memory
  }

  async deleteMemory(memoryId: string, workspaceRoot?: string): Promise<void> {
    // Generated only in the main process and used solely for diagnostic correlation.
    const traceId = randomUUID()
    await this.memoryStore.delete(memoryId, { workspaceRoot }, { traceId })
    this.logger?.info('Memory deleted.', { component: 'main', tag: 'memory-catalog', traceId })
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
      agentWorkspaceTrust: workspaceTrust(workspace),
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
  ): BoundPreviewLessonInteraction {
    const existing = binding.recordedInteractions.get(intent.eventId)
    if (existing) {
      if (!samePreviewLessonInteractionIntent(existing.intent, intent)) {
        throw new PreviewLessonInteractionBindingError(
          'binding_intent_conflict',
          `Preview Lesson event ID "${intent.eventId}" is already bound to a different intent.`
        )
      }
      return existing
    }

    // Correlation provenance belongs to the trusted event identity cache. A
    // retry of this exact event must reuse it instead of creating a new UUID.
    const event = createPreviewLessonInteraction({
      ...binding,
      observedAt: new Date().toISOString(),
      attempt: binding.attempt,
      surface: 'lesson_preview'
    }, intent)
    const interaction = { intent, event, traceId: randomUUID() }
    binding.recordedInteractions.set(intent.eventId, interaction)
    return interaction
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


async function invalidateAgentHistoryIndex(rootPath: string): Promise<void> {
  await rm(join(rootPath, AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH), { force: true })
}

