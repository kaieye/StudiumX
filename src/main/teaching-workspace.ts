import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { defaultSettings } from './teaching-settings'
import { TeachingMemoryStore } from './teaching-memory'
import { inspectGitWorkspace } from './teaching-git'
import { isPathInsideRoot } from './path-access'
import {
  buildCourseSummaries,
  buildWorkspaceCatalog,
  readMissionSummary
} from './teaching-workspace-catalog'
import { runLessonGenerationPipeline, type LessonGenerationCallbacks } from './teaching-lesson-generation'
import {
  cleanText,
  directoryExists,
  fileExists,
  normalizeWorkspaceRelativePath,
  slugify,
  toWorkspaceRelativePath,
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
import { resolveActiveProvider } from './ai/provider-adapter'
import {
  runTeachingConversationTurn,
  type TeachingConversationRuntimeStream,
  type TemporaryChatContext
} from './teaching-conversation-runtime'
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
  agentConversationJsonRelativePath,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationMarkdownRelativePath,
  isRootAgentConversationMarkdownRelativePath,
  normalizeAgentConversationDirectory
} from '../shared/agent-conversation-catalog'
import {
  ensurePreviewBaseTag,
  injectPreviewMarkdownLinkBridge,
  PREVIEW_PROTOCOL
} from '../shared/preview-markdown-bridge'
import {
  EMPTY_REGISTRY,
  applyRegistryWorkspaceMeta,
  assertSafeWorkspaceRootForRemoval,
  findWorkspace,
  isRegistryWorkspace,
  orderRegistryWorkspaces,
  samePath,
  sameRegistryWorkspaceOrder,
  touchRegistryWorkspace,
  upsertRegistryWorkspace,
  visibleRegistryWorkspaces,
  type RegistryWorkspace,
  type WorkspaceRegistry
} from './teaching-workspace/registry'
import {
  appendSessionEvent as appendWorkspaceSessionEvent,
  atomicWriteFile,
  ensureWorkspaceStructure as ensureWorkspaceLifecycleStructure,
  loadWorkspaceIndex as loadWorkspaceLifecycleIndex,
  renderMission,
  renderResources,
  saveWorkspaceIndex as saveWorkspaceLifecycleIndex,
  writeIfMissing,
  type SessionEvent,
  type WorkspaceIndex
} from './teaching-workspace/lifecycle'
import {
  archiveWorkspaceItemPathMeta,
  mergeWorkspaceItemPathMeta,
  planTemporaryConversationDiskRemoval,
  planWorkspaceItemDiskRemoval,
  pruneWorkspaceIndexForItemRemoval,
  pruneWorkspacePathMetaForItemRemoval,
  shouldArchiveWorkspaceItem
} from './teaching-workspace/item-lifecycle'
import { TeachingWorkspaceReviewModule } from './teaching-workspace/review'
import {
  captureWorkspaceChangeSnapshot,
  readWorkspaceChangeDiff,
  summarizeWorkspaceChanges
} from './teaching-workspace-changes'
import { TeachingWorkspaceChangeHistoryStore } from './teaching-workspace-change-history'
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
  AgentChatStreamChunk,
  AgentChatStreamPayload,
  AgentChatStreamResult,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
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
  WorkspaceItemKind,
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

export type WorkspacePreviewFile = {
  absolutePath: string
  mimeType: string
  relativePath: string
  workspaceId: string
}

const ROOT_MARKDOWN_DOCUMENTS = new Set([
  'MISSION.md',
  'RESOURCES.md',
  'GLOSSARY.md',
  'NOTES.md'
])

const MARKDOWN_DOCUMENT_DIRECTORIES = [
  'courses',
  'lessons',
  'learning-records',
  'reviews',
  'reference',
  'conversation'
]

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
  private readonly reviewModule = new TeachingWorkspaceReviewModule()
  private readonly changeHistory: TeachingWorkspaceChangeHistoryStore

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
    this.changeHistory = new TeachingWorkspaceChangeHistoryStore({
      filePath: join(this.appDataRoot, 'learning-changes', 'history.json')
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
    const registry = await this.ensureRegistry()
    return this.buildState(registry, options.activeWorkspaceId, options.selectedLessonPath)
  }

  async createWorkspace(payload: CreateWorkspacePayload): Promise<TeachingAppState> {
    const now = new Date().toISOString()
    const name = cleanText(payload.name) || 'learn'
    const prompt = cleanText(payload.prompt) || `学习 ${name}`
    const entry = await this.initializeWorkspace({
      id: randomUUID(),
      name,
      rootPath: await this.nextWorkspacePath(name),
      prompt,
      now,
      eventKind: 'workspace_created'
    })
    const registry = await this.loadRegistry()
    const nextRegistry = upsertRegistryWorkspace(registry, entry, entry.id)
    await this.saveRegistry(nextRegistry)
    return this.buildState(nextRegistry, entry.id, null)
  }

  async selectWorkspace(workspaceId: string): Promise<TeachingAppState> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const nextRegistry = { ...registry, activeWorkspaceId: workspace.id }
    await this.saveRegistry(nextRegistry)
    return this.buildState(nextRegistry, workspace.id, null)
  }

  async importWorkspace(rootPath: string): Promise<TeachingAppState> {
    const now = new Date().toISOString()
    const normalizedRoot = resolve(rootPath)
    const info = await stat(normalizedRoot)
    if (!info.isDirectory()) throw new Error('Selected path is not a directory.')

    const registry = await this.loadRegistry()
    const existing = registry.workspaces.find((workspace) => samePath(workspace.rootPath, normalizedRoot))
    if (existing) {
      const nextRegistry = {
        activeWorkspaceId: existing.id,
        workspaces: orderRegistryWorkspaces(registry.workspaces.map((workspace) =>
          workspace.id === existing.id
            ? { ...workspace, archived: false, updatedAt: now }
            : workspace
        ))
      }
      await this.saveRegistry(nextRegistry)
      return this.buildState(nextRegistry, existing.id, null)
    }

    const entry = await this.initializeWorkspace({
      id: randomUUID(),
      name: basename(normalizedRoot) || 'workspace',
      rootPath: normalizedRoot,
      prompt: `继续整理 ${basename(normalizedRoot) || 'workspace'} 教学工作区`,
      now,
      eventKind: 'workspace_imported'
    })
    const nextRegistry = upsertRegistryWorkspace(registry, entry, entry.id)
    await this.saveRegistry(nextRegistry)
    return this.buildState(nextRegistry, entry.id, null)
  }

  async updateMission(payload: UpdateMissionPayload): Promise<TeachingAppState> {
    const prompt = cleanText(payload.prompt)
    if (!prompt) throw new Error('Mission prompt is required.')

    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const now = new Date().toISOString()
    const topic = deriveTopic(prompt, workspace.name)
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
    return runTeachingConversationTurn(payload, stream, workspace, {
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

    await writeAgentConversationRecord({ ...workspace, rootPath: storageRoot }, record)
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
    return {
      state: await this.buildState(nextRegistry, workspace.id, payload.selectedLessonPath ?? null),
      conversation: toAgentConversationSummary(record, {}, workspace.id)
    }
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
    if (isRootAgentConversationMarkdownRelativePath(relativePath)) {
      const id = requireSafeAgentConversationId(basename(relativePath).replace(/\.md$/i, ''))
      if (await this.hasTemporaryConversation(id)) {
        const index = await this.loadTemporaryConversationIndex()
        const pathMeta = mergeWorkspaceItemPathMeta(index.pathMeta, relativePath, payload)
        await this.saveTemporaryConversationIndex({ ...index, pathMeta })
        return this.buildState(registry, workspace.id, null)
      }
    }
    const index = await this.loadWorkspaceIndex(workspace)
    const pathMeta = mergeWorkspaceItemPathMeta(index.pathMeta, relativePath, payload)
    await this.saveWorkspaceIndex(workspace.rootPath, { ...index, pathMeta, updatedAt: new Date().toISOString() })
    return this.buildState(registry, workspace.id, null)
  }

  async removeWorkspaceItem(payload: WorkspaceItemRemovePayload): Promise<TeachingAppState> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const relativePath = normalizeWorkspaceRelativePath(payload.relativePath)
    if (!relativePath) throw new Error('relativePath is required.')
    const absolutePath = resolve(join(workspace.rootPath, relativePath))
    if (!isPathInsideRoot(workspace.rootPath, absolutePath)) {
      throw new Error('Path is outside the workspace.')
    }

    if (shouldArchiveWorkspaceItem(payload.mode)) {
      return this.archiveWorkspaceItem(registry, workspace, relativePath, payload.kind)
    }

    const index = await this.loadWorkspaceIndex(workspace)

    if (payload.kind === 'conversation') {
      const id = requireSafeAgentConversationId(basename(relativePath).replace(/\.md$/i, ''))
      if (isRootAgentConversationMarkdownRelativePath(relativePath) && await this.hasTemporaryConversation(id)) {
        const index = await this.loadTemporaryConversationIndex()
        const plan = planTemporaryConversationDiskRemoval(this.appDataRoot, relativePath)
        for (const file of plan.files) await unlink(file).catch(() => {})
        await this.saveTemporaryConversationIndex({
          ...index,
          pathMeta: pruneWorkspacePathMetaForItemRemoval(index.pathMeta, { relativePath, kind: payload.kind })
        })
        return this.buildState(registry, workspace.id, null)
      }
    }

    const plan = planWorkspaceItemDiskRemoval(workspace.rootPath, index, { relativePath, kind: payload.kind })
    for (const directory of plan.directories) await rm(directory, { recursive: true, force: true })
    for (const file of plan.files) await unlink(file).catch(() => {})

    const { lessons, pathMeta } = pruneWorkspaceIndexForItemRemoval(index, { relativePath, kind: payload.kind })
    await this.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      lessons,
      pathMeta,
      updatedAt: new Date().toISOString()
    })

    return this.buildState(registry, workspace.id, null)
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

  private async archiveWorkspaceItem(
    registry: WorkspaceRegistry,
    workspace: RegistryWorkspace,
    relativePath: string,
    kind: WorkspaceItemKind
  ): Promise<TeachingAppState> {
    if (kind === 'conversation') {
      const id = requireSafeAgentConversationId(basename(relativePath).replace(/\.md$/i, ''))
      if (isRootAgentConversationMarkdownRelativePath(relativePath) && await this.hasTemporaryConversation(id)) {
        const index = await this.loadTemporaryConversationIndex()
        const pathMeta = archiveWorkspaceItemPathMeta(index.pathMeta, relativePath)
        await this.saveTemporaryConversationIndex({ ...index, pathMeta })
        return this.buildState(registry, workspace.id, null)
      }
    }

    const index = await this.loadWorkspaceIndex(workspace)
    const pathMeta = archiveWorkspaceItemPathMeta(index.pathMeta, relativePath)
    await this.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      pathMeta,
      updatedAt: new Date().toISOString()
    })
    return this.buildState(registry, workspace.id, null)
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
    const beforeChanges = await captureWorkspaceChangeSnapshot(workspace.rootPath)
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
    const changeSummary = await summarizeWorkspaceChanges({
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
    if (changeSummary) await this.changeHistory.append(workspace.id, changeSummary)

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
    return this.reviewModule.listReviewCards(workspace)
  }

  async recordProgress(payload: RecordProgressPayload): Promise<GetProgressResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    return this.reviewModule.recordProgress(workspace, payload)
  }

  async getProgress(workspaceId: string): Promise<GetProgressResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    return this.reviewModule.getProgress(workspace)
  }

  async readLesson(payload: ReadLessonPayload): Promise<ReadLessonResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const target = resolveLessonPath(workspace.rootPath, payload.lessonPath)
    const relativePath = toWorkspaceRelativePath(workspace.rootPath, target)
    const previewUrl = toPreviewUrl(workspace.id, relativePath)
    return {
      html: withPreviewBase(await readFile(target, 'utf8'), previewUrl),
      url: previewUrl
    }
  }

  async readWorkspaceMarkdown(payload: ReadWorkspaceMarkdownPayload): Promise<WorkspaceMarkdownDocument> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const target = resolveWorkspaceMarkdownPath(workspace.rootPath, payload.documentPath)
    return readWorkspaceMarkdownDocument(workspace.rootPath, target)
  }

  async readWorkspaceChangeDiff(payload: { workspaceId: string; relativePath: string; changeId?: string }) {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const change = payload.changeId
      ? await this.changeHistory.get(workspace.id, payload.changeId)
      : await this.changeHistory.latest(workspace.id)
    return readWorkspaceChangeDiff({
      workspaceRoot: workspace.rootPath,
      relativePath: payload.relativePath,
      checkpoint: change?.checkpoint
    })
  }

  async saveWorkspaceMarkdown(payload: SaveWorkspaceMarkdownPayload): Promise<SaveWorkspaceMarkdownResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const target = resolveWorkspaceMarkdownPath(workspace.rootPath, payload.documentPath)
    await atomicWriteFile(target, payload.content)
    const now = new Date().toISOString()
    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    return {
      state: await this.buildState(nextRegistry, workspace.id, target),
      document: await readWorkspaceMarkdownDocument(workspace.rootPath, target)
    }
  }

  async resolvePreviewFile(workspaceId: string, relativePath: string): Promise<WorkspacePreviewFile | null> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath)
    if (!normalizedRelativePath) return null
    const target = resolve(join(workspace.rootPath, normalizedRelativePath))
    const allowedRoots = [resolve(workspace.rootPath, 'courses'), resolve(workspace.rootPath, 'lessons'), resolve(workspace.rootPath, 'assets')]
    if (!allowedRoots.some((base) => isPathInsideRoot(base, target)) && !isWorkspaceMarkdownPathAllowed(workspace.rootPath, target)) return null
    if (!(await fileExists(target))) return null
    return {
      absolutePath: target,
      mimeType: mimeTypeForPath(target),
      relativePath: normalizedRelativePath,
      workspaceId: workspace.id
    }
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
    const registry = await this.loadRegistry()
    const existing = await this.existingRegistryWorkspaces(registry.workspaces)
    if (existing.length > 0) {
      const orderedExisting = orderRegistryWorkspaces(existing)
      const visible = visibleRegistryWorkspaces(orderedExisting)
      const activeWorkspaceId = visible.some((item) => item.id === registry.activeWorkspaceId)
        ? registry.activeWorkspaceId
        : visible[0]?.id ?? null
      const nextRegistry = { activeWorkspaceId, workspaces: orderedExisting }
      if (
        nextRegistry.workspaces.length !== registry.workspaces.length ||
        nextRegistry.activeWorkspaceId !== registry.activeWorkspaceId ||
        !sameRegistryWorkspaceOrder(nextRegistry.workspaces, registry.workspaces)
      ) {
        await this.saveRegistry(nextRegistry)
      }
      return nextRegistry
    }

    const now = new Date().toISOString()
    const entry = await this.initializeWorkspace({
      id: randomUUID(),
      name: 'learn',
      rootPath: await this.nextWorkspacePath('learn'),
      prompt: '搭建个人化 AI 教学系统的第一版工作流',
      now,
      eventKind: 'workspace_created'
    })
    const nextRegistry = { activeWorkspaceId: entry.id, workspaces: [entry] }
    await this.saveRegistry(nextRegistry)
    return nextRegistry
  }

  private async buildState(
    registry: WorkspaceRegistry,
    activeWorkspaceId?: string | null,
    selectedLessonPath?: string | null
  ): Promise<TeachingAppState> {
    const visibleWorkspaces = visibleRegistryWorkspaces(orderRegistryWorkspaces(registry.workspaces))
    const summaries = await Promise.all(visibleWorkspaces.map((workspace) => this.summarizeWorkspace(workspace)))
    const temporaryConversations = await this.listTemporaryConversations(registry)
    const activeId = activeWorkspaceId ?? registry.activeWorkspaceId ?? summaries[0]?.id ?? null
    const activeWorkspace = summaries.find((workspace) => workspace.id === activeId) ?? summaries[0] ?? null
    const lessonPath = selectedLessonPath ?? activeWorkspace?.lessons[0]?.absolutePath ?? null
    const previewHtml =
      activeWorkspace && lessonPath
        ? await this.readLesson({ workspaceId: activeWorkspace.id, lessonPath }).then((result) => result.html).catch(() => renderEmptyPreview(activeWorkspace))
        : activeWorkspace
          ? renderEmptyPreview(activeWorkspace)
          : ''
    const runtime = await this.runtimeState()
    const changeHistory = activeWorkspace ? await this.changeHistory.list(activeWorkspace.id) : []

    return {
      workspaces: summaries,
      activeWorkspace,
      temporaryConversations,
      previewHtml,
      previewUrl: activeWorkspace && lessonPath ? toPreviewUrl(activeWorkspace.id, toWorkspaceRelativePath(activeWorkspace.rootPath, lessonPath)) : '',
      selectedLessonPath: lessonPath,
      runtime,
      recentChangeSummary: changeHistory[0] ?? null,
      changeHistory
    }
  }

  private async summarizeWorkspace(workspace: RegistryWorkspace): Promise<TeachingWorkspaceSummary> {
    const index = await this.loadWorkspaceIndex(workspace)
    const pathMeta = index.pathMeta ?? {}
    await this.ensureWorkspaceStructure(workspace, pathMeta)
    const { lessonIndexChanged, ...catalog } = await buildWorkspaceCatalog(workspace, index)
    if (lessonIndexChanged) {
      await this.saveWorkspaceIndex(workspace.rootPath, { ...index, lessons: catalog.lessons, updatedAt: new Date().toISOString() })
    }
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

  private async initializeWorkspace(options: {
    id: string
    name: string
    rootPath: string
    prompt: string
    now: string
    eventKind: SessionEvent['kind']
  }): Promise<RegistryWorkspace> {
    const entry: RegistryWorkspace = {
      id: options.id,
      name: options.name,
      rootPath: resolve(options.rootPath),
      createdAt: options.now,
      updatedAt: options.now
    }
    await this.ensureWorkspaceStructure(entry)
    const topic = deriveTopic(options.prompt, options.name)
    await writeIfMissing(join(entry.rootPath, 'MISSION.md'), renderMission(topic, options.prompt))
    await writeIfMissing(join(entry.rootPath, 'RESOURCES.md'), renderResources(topic))
    await this.saveWorkspaceIndex(entry.rootPath, {
      id: entry.id,
      name: entry.name,
      rootPath: entry.rootPath,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lessons: []
    })
    await this.appendSessionEvent(entry.rootPath, {
      id: randomUUID(),
      kind: options.eventKind,
      timestamp: options.now,
      workspaceId: entry.id,
      prompt: options.prompt,
      paths: ['MISSION.md', 'RESOURCES.md', 'assets/lesson.css', 'assets/quiz.js']
    })
    return entry
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

  private async loadRegistry(): Promise<WorkspaceRegistry> {
    try {
      const parsed = JSON.parse(await readFile(this.registryPath, 'utf8')) as WorkspaceRegistry
      if (!Array.isArray(parsed.workspaces)) return EMPTY_REGISTRY
      return {
        activeWorkspaceId: typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : null,
        workspaces: parsed.workspaces.filter(isRegistryWorkspace).map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          rootPath: resolve(workspace.rootPath),
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
          ...(workspace.pinned === true ? { pinned: true } : {}),
          ...(workspace.archived === true ? { archived: true } : {})
        }))
      }
    } catch {
      return EMPTY_REGISTRY
    }
  }

  private async saveRegistry(registry: WorkspaceRegistry): Promise<void> {
    await atomicWriteFile(this.registryPath, `${JSON.stringify(registry, null, 2)}\n`)
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

  private async existingRegistryWorkspaces(workspaces: RegistryWorkspace[]): Promise<RegistryWorkspace[]> {
    const existing: RegistryWorkspace[] = []
    const seen = new Set<string>()
    for (const workspace of workspaces) {
      const rootPath = resolve(workspace.rootPath)
      const key = rootPath.toLowerCase()
      if (seen.has(key)) continue
      if (await directoryExists(rootPath)) {
        existing.push({ ...workspace, rootPath })
        seen.add(key)
      }
    }
    return existing
  }

  private async nextWorkspacePath(name: string): Promise<string> {
    const defaultRoot = await this.resolveDefaultRoot()
    await mkdir(defaultRoot, { recursive: true })
    const base = slugify(name, 'workspace')
    let candidate = join(defaultRoot, base)
    let suffix = 2
    while (await directoryExists(candidate)) {
      candidate = join(defaultRoot, `${base}-${suffix}`)
      suffix += 1
    }
    return candidate
  }

  private async resolveDefaultRoot(): Promise<string> {
    try {
      return (await this.loadSettings()).workspace.defaultRoot || this.defaultRoot
    } catch {
      return this.defaultRoot
    }
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

function resolveLessonPath(rootPath: string, lessonPath: string): string {
  const target = isAbsolute(lessonPath) ? resolve(lessonPath) : resolve(rootPath, lessonPath)
  const allowedRoots = [resolve(rootPath, 'courses'), resolve(rootPath, 'lessons')]
  if (!allowedRoots.some((base) => isPathInsideRoot(base, target))) {
    throw new Error('Lesson path is outside the workspace lessons directory.')
  }
  return target
}

function resolveWorkspaceMarkdownPath(rootPath: string, documentPath: string): string {
  const target = isAbsolute(documentPath) ? resolve(documentPath) : resolve(rootPath, documentPath)
  if (!isWorkspaceMarkdownPathAllowed(rootPath, target)) {
    throw new Error('Markdown path is outside the allowed workspace documents.')
  }
  return target
}

function isWorkspaceMarkdownPathAllowed(rootPath: string, targetPath: string): boolean {
  const relativePath = normalizeWorkspaceRelativePath(toWorkspaceRelativePath(rootPath, targetPath))
  if (!relativePath || relativePath.includes('../')) return false
  if (!targetPath.toLowerCase().endsWith('.md')) return false
  if (ROOT_MARKDOWN_DOCUMENTS.has(relativePath)) return true
  return MARKDOWN_DOCUMENT_DIRECTORIES.some((dir) => {
    const base = resolve(rootPath, dir)
    return isPathInsideRoot(base, targetPath)
  })
}

function deriveTopic(prompt: string, fallback: string): string {
  const cleaned = cleanText(prompt)
    .replace(/^我想(先)?学习/, '')
    .replace(/^学习/, '')
    .replace(/^如何/, '')
  const firstSentence = cleaned.split(/[。.!?？\n]/)[0]?.trim()
  const topic = firstSentence && firstSentence.length <= 34 ? firstSentence : firstSentence?.slice(0, 34)
  return topic || cleanText(fallback) || '学习任务'
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

async function readWorkspaceMarkdownDocument(
  rootPath: string,
  absolutePath: string
): Promise<WorkspaceMarkdownDocument> {
  const [content, info] = await Promise.all([
    readFile(absolutePath, 'utf8'),
    stat(absolutePath).catch(() => null)
  ])
  const relativePath = normalizeWorkspaceRelativePath(toWorkspaceRelativePath(rootPath, absolutePath))
  return {
    title: cleanText(/^#\s+(.+)$/m.exec(content)?.[1] ?? titleFromMarkdownPath(relativePath)),
    relativePath,
    absolutePath,
    content,
    updatedAt: info?.mtime ? info.mtime.toISOString() : null
  }
}

function titleFromMarkdownPath(relativePath: string): string {
  const name = basename(relativePath)
  if (ROOT_MARKDOWN_DOCUMENTS.has(name)) return name.replace(/\.md$/i, '')
  return name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ')
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

function withPreviewBase(html: string, baseHref: string): string {
  return injectPreviewMarkdownLinkBridge(ensurePreviewBaseTag(html, baseHref))
}

function toPreviewUrl(workspaceId: string, relativePath: string): string {
  return `${PREVIEW_PROTOCOL}://${encodeURIComponent(workspaceId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

function mimeTypeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown; charset=utf-8'
  if (lower.endsWith('.css')) return 'text/css; charset=utf-8'
  if (lower.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.woff2')) return 'font/woff2'
  if (lower.endsWith('.woff')) return 'font/woff'
  return 'application/octet-stream'
}
