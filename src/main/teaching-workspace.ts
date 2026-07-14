import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { defaultSettings } from './teaching-settings'
import { TeachingMemoryStore } from './teaching-memory'
import { inspectGitWorkspace } from './teaching-git'
import {
  buildCourseSummaries,
  buildWorkspaceCatalog
} from './teaching-workspace-catalog'
import { planLessonIndexReconciliation } from './teaching-workspace/catalog-reconciliation'
import { runLessonGenerationPipeline, type LessonGenerationCallbacks } from './teaching-lesson-generation'
import {
  cleanText,
  normalizeWorkspaceRelativePath,
  type WorkspacePathMeta
} from './teaching-workspace-paths'
import {
  deriveConversationTitle,
  ensureTeachingContentDirectories,
  listAgentConversations,
  nextAgentConversationId,
  normalizeAgentConversationTurns,
  readAgentConversationRecord,
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
import type { SkillLibraryService } from './skill-library'
import type { LessonPlanSource } from '../shared/lesson-schema'
import {
  lessonStyleCss,
  normalizeLessonStyleId
} from '../shared/lesson-styles'
import type { LessonBrief } from '../shared/teaching-workflow'
import { activeLearnerProfileLines } from '../shared/teaching-personalization'
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
  type WorkspacePreviewFile
} from './teaching-workspace-documents'
export type { WorkspacePreviewFile } from './teaching-workspace-documents'
import type { AnalyticsWorkspaceScanResult } from './teaching/services/learning-analytics'
import { buildConnectorStatuses } from './connector-status'
import type {
  ApplyLessonStylePayload,
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
  UpdateTeachingMemoryPayload,
  UpdateMissionPayload
} from '../shared/teaching-types'

type ConversationIndex = {
  pathMeta?: Record<string, WorkspacePathMeta>
}

type AgentConversationLocation = {
  record: AgentConversationRecord
  rootPath: string
  global: boolean
}

type PendingAgentRunArchiveScope = {
  workspaceId: string
  mode: 'teaching' | 'temporary'
  conversationId: string | null
  allowances: AgentStagedChildTranscriptAllowance[]
  createdAt: number
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
  private readonly pendingAgentRunArchiveScopes = new Map<string, PendingAgentRunArchiveScope>()

  constructor(options: {
    registryPath: string
    defaultRoot: string
    settingsProvider?: () => Promise<TeachingSettingsV1>
    skillLibraryService?: SkillLibraryService
  }) {
    this.registryPath = options.registryPath
    this.appDataRoot = dirname(this.registryPath)
    this.defaultRoot = options.defaultRoot
    this.settingsProvider = options.settingsProvider
    this.skillLibraryService = options.skillLibraryService
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

  private async findAgentConversationLocation(workspaceRoot: string, conversationId: string): Promise<AgentConversationLocation> {
    const id = requireSafeAgentConversationId(conversationId)
    const globalRecord = await readAgentConversationRecord(this.appDataRoot, id).catch(() => null)
    if (globalRecord) {
      return { record: globalRecord, rootPath: this.appDataRoot, global: true }
    }
    const workspaceRecord = await readAgentConversationRecord(workspaceRoot, id)
    return { record: workspaceRecord, rootPath: workspaceRoot, global: false }
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
    return (await Promise.all(stores.map((store) => store.reconcileInterrupted().catch(() => [])))).flat()
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

    const turns = normalizeAgentConversationTurns(payload.turns)
    if (turns.length === 0) throw new Error('Conversation is empty.')

    const now = new Date().toISOString()
    const existingLocation = payload.conversationId
      ? await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId).catch(() => null)
      : null
    const existing = existingLocation?.record ?? null
    const isTemporaryConversation = existingLocation?.global === true || payload.mode === 'temporary'
    const storageRoot = isTemporaryConversation ? this.appDataRoot : workspace.rootPath
    if (isTemporaryConversation) await this.ensureTemporaryConversationStructure()
    const title = existing?.title ?? deriveConversationTitle(turns, now)
    const id = existing?.id ?? await nextAgentConversationId(storageRoot, title, now)
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

    const record: AgentConversationRecord = {
      id,
      workspaceId: existing?.workspaceId ?? workspace.id,
      title,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      relativePath: agentConversationMarkdownRelativePath(id, conversationDir),
      absolutePath: join(storageRoot, agentConversationMarkdownRelativePath(id, conversationDir)),
      messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
      turns
    }

    await writeAgentConversationRecord({ ...workspace, rootPath: storageRoot }, record, {
      allowedStagedChildTranscripts: authorizedAllowances
    })
    if (!isTemporaryConversation) {
      await this.appendSessionEvent(workspace.rootPath, {
        id: randomUUID(),
        kind: 'agent_conversation_recorded',
        timestamp: now,
        workspaceId: workspace.id,
        prompt: title,
        paths: [record.relativePath, agentConversationJsonRelativePathForMarkdown(record.relativePath)]
      })
    }

    const nextRegistry = isTemporaryConversation ? registry : touchRegistryWorkspace(registry, workspace.id, now)
    if (!isTemporaryConversation) await this.saveRegistry(nextRegistry)
    const result = {
      state: await this.buildState(nextRegistry, workspace.id, payload.selectedLessonPath ?? null),
      conversation: toAgentConversationSummary(record, {}, workspace.id)
    }
    const runId = payload.runId?.trim()
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
    return (await this.findAgentConversationLocation(workspace.rootPath, payload.conversationId)).record
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
      callbacks: options.callbacks
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
        '.teachos/index.json',
        '.teachos/sessions.jsonl'
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

  async readLesson(payload: ReadLessonPayload): Promise<ReadLessonResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    return this.documents.readLesson(workspace, payload.lessonPath)
  }

  async readWorkspaceMarkdown(payload: ReadWorkspaceMarkdownPayload): Promise<WorkspaceMarkdownDocument> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    return this.documents.readMarkdown(workspace, payload.documentPath)
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
