import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { defaultSettings } from './teaching-settings'
import { TeachingMemoryStore } from './teaching-memory'
import { inspectGitWorkspace } from './teaching-git'
import { isPathInsideRoot } from './path-access'
import { callProvider, streamProvider, resolveActiveProvider, ProviderAdapterError, toolsSupportedForFormat, type AdapterCallbacks } from './ai/provider-adapter'
import { runAgentLoop } from './ai/agent-loop'
import { buildDefaultRegistry, buildToolContext } from './ai/tools/registry'
import { buildLessonSystemPrompt, buildLessonUserPrompt } from './ai/lesson-prompts'
import { runTeachingConversationTurn, type TemporaryChatContext } from './teaching-conversation-runtime'
import {
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan,
  renderLearningRecordFromPlan
} from './ai/lesson-renderer'
import { lessonPlanSchema, sanitizePlan, type LessonPlan, type LessonPlanSource } from '../shared/lesson-schema'
import { assessTeachingReadiness, isContinuationLessonRequest } from '../shared/teaching-workflow'
import {
  isLearnerProfileMemory
} from '../shared/teaching-memory-capture'
import {
  agentConversationCourseJsonScanDirectories,
  agentConversationDirectoryRelativePath,
  agentConversationJsonRelativePath,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationJsonScanDirectories,
  agentConversationMarkdownRelativePath,
  courseRelativePathForAgentConversation as courseRelativePathFromConversationPath,
  isAgentConversationJsonRelativePath,
  isAgentConversationMarkdownRelativePath,
  isRootAgentConversationMarkdownRelativePath,
  normalizeAgentConversationDirectory
} from '../shared/agent-conversation-catalog'
import { classifyProviderError, providerErrorReason } from '../shared/provider-error'
import type {
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
  ProgressSummary,
  QuizResultEntry,
  ReadLessonPayload,
  ReadLessonResult,
  RecordProgressPayload,
  ResourceSummary,
  ReviewCard,
  AgentConversationRecord,
  AgentConversationSummary,
  AgentChatMessage,
  AgentChatProcessEvent,
  AgentChatStreamChunk,
  AgentChatStreamPayload,
  AgentChatStreamResult,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentChatTurn,
  ReadAgentConversationPayload,
  SaveAgentConversationPayload,
  SaveAgentConversationResult,
  TeachingMemoryDiagnostics,
  TeachingMemoryRecord,
  TeachingClarificationResult,
  TeachingAppState,
  TeachingCourseSummary,
  TeachingRuntimeState,
  TeachingSessionSummary,
  TeachingSettingsV1,
  TeachingWorkspaceSummary,
  WorkspaceFileNode,
  WorkspaceItemKind,
  WorkspaceItemMetaPayload,
  WorkspaceItemRemovePayload,
  WorkspaceRemovePayload,
  UpdateTeachingMemoryPayload,
  UpdateMissionPayload
} from '../shared/teaching-types'

type RegistryWorkspace = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  archived?: boolean
}

type WorkspaceRegistry = {
  activeWorkspaceId: string | null
  workspaces: RegistryWorkspace[]
}

type WorkspacePathMeta = { pinned?: boolean; archived?: boolean }

type WorkspaceIndex = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  lessons: LessonSummary[]
  pathMeta?: Record<string, WorkspacePathMeta>
}

type ConversationIndex = {
  pathMeta?: Record<string, WorkspacePathMeta>
}

type AgentConversationLocation = {
  record: AgentConversationRecord
  rootPath: string
  global: boolean
}

type LessonArtifactPaths = {
  courseId: string
  courseName: string
  courseRelativePath: string
  courseAbsolutePath: string
  sessionId: string
  sessionName: string
  sessionRelativePath: string
  sessionAbsolutePath: string
  lessonRelativePath: string
  lessonAbsolutePath: string
  referenceRelativePath: string | null
  referenceAbsolutePath: string | null
  recordRelativePath: string | null
  recordAbsolutePath: string | null
  reviewsRelativePath: string | null
  reviewsAbsolutePath: string | null
}

export type WorkspacePreviewFile = {
  absolutePath: string
  mimeType: string
}

type SessionEvent = {
  id: string
  kind: 'workspace_created' | 'workspace_imported' | 'mission_updated' | 'lesson_generated' | 'agent_conversation_recorded'
  timestamp: string
  workspaceId: string
  prompt?: string
  paths?: string[]
  meta?: { source?: LessonPlanSource; reason?: string; model?: string }
}

const DEFAULT_RUNTIME: TeachingRuntimeState = {
  status: 'idle',
  currentStep: 'ready',
  queuedTasks: 0,
  providerLabel: 'Local structured generator'
}

const EMPTY_REGISTRY: WorkspaceRegistry = {
  activeWorkspaceId: null,
  workspaces: []
}

const WORKSPACE_SCAFFOLD_DIRECTORIES = new Set([
  'lessons',
  'conversation',
  'reference',
  'learning-records',
  'reviews',
  'assets'
])

const WORKSPACE_SCAFFOLD_FILES = new Set([
  'MISSION.md',
  'RESOURCES.md',
  'assets/lesson.css',
  'assets/quiz.js',
  'assets/flashcards.css',
  'assets/flashcards.js'
])

export class TeachingWorkspaceService {
  private readonly registryPath: string
  private readonly appDataRoot: string
  private readonly defaultRoot: string
  private readonly settingsProvider?: () => Promise<TeachingSettingsV1>
  private readonly memoryStore: TeachingMemoryStore

  constructor(options: {
    registryPath: string
    defaultRoot: string
    settingsProvider?: () => Promise<TeachingSettingsV1>
  }) {
    this.registryPath = options.registryPath
    this.appDataRoot = dirname(this.registryPath)
    this.defaultRoot = options.defaultRoot
    this.settingsProvider = options.settingsProvider
    this.memoryStore = new TeachingMemoryStore({
      rootDir: join(this.appDataRoot, 'memory'),
      settingsProvider: () => this.loadSettings()
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
    stream: {
      streamId: string
      signal?: AbortSignal
      onChunk: (chunk: AgentChatStreamChunk) => void
      onStatus: (status: AgentChatStreamStatus) => void
      onTool: (event: AgentChatStreamToolEvent) => void
    }
  ): Promise<AgentChatStreamResult> {
    const registryState = payload.workspaceId ? await this.ensureRegistry() : null
    const workspace = payload.workspaceId && registryState
      ? findWorkspace(registryState, payload.workspaceId)
      : null
    return runTeachingConversationTurn(payload, stream, workspace, {
      loadSettings: () => this.loadSettings(),
      listMemories: (workspaceRoot) => this.memoryStore.list(workspaceRoot),
      createMemory: (memoryPayload) => this.memoryStore.create(memoryPayload),
      assessTeachingRequest: (options) => this.assessTeachingRequest(options),
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
        const pathMeta = { ...(index.pathMeta ?? {}) }
        const existing = pathMeta[relativePath] ?? {}
        const merged: WorkspacePathMeta = { ...existing }
        if (payload.pinned === null) delete merged.pinned
        else if (payload.pinned !== undefined) merged.pinned = payload.pinned
        if (payload.archived === null) delete merged.archived
        else if (payload.archived !== undefined) merged.archived = payload.archived
        if (merged.pinned === undefined && merged.archived === undefined) {
          delete pathMeta[relativePath]
        } else {
          pathMeta[relativePath] = merged
        }
        await this.saveTemporaryConversationIndex({ ...index, pathMeta })
        return this.buildState(registry, workspace.id, null)
      }
    }
    const index = await this.loadWorkspaceIndex(workspace)
    const pathMeta = { ...(index.pathMeta ?? {}) }
    const existing = pathMeta[relativePath] ?? {}
    const merged: WorkspacePathMeta = { ...existing }
    if (payload.pinned === null) delete merged.pinned
    else if (payload.pinned !== undefined) merged.pinned = payload.pinned
    if (payload.archived === null) delete merged.archived
    else if (payload.archived !== undefined) merged.archived = payload.archived
    if (merged.pinned === undefined && merged.archived === undefined) {
      delete pathMeta[relativePath]
    } else {
      pathMeta[relativePath] = merged
    }
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

    if ((payload.mode ?? 'disk') === 'list') {
      return this.archiveWorkspaceItem(registry, workspace, relativePath, payload.kind)
    }

    const index = await this.loadWorkspaceIndex(workspace)

    if (payload.kind === 'conversation') {
      const id = requireSafeAgentConversationId(basename(relativePath).replace(/\.md$/i, ''))
      if (isRootAgentConversationMarkdownRelativePath(relativePath) && await this.hasTemporaryConversation(id)) {
        const index = await this.loadTemporaryConversationIndex()
        const jsonPath = join(this.appDataRoot, agentConversationJsonRelativePath(id, 'conversations'))
        const mdPath = join(this.appDataRoot, agentConversationMarkdownRelativePath(id, 'conversations'))
        await unlink(jsonPath).catch(() => {})
        await unlink(mdPath).catch(() => {})
        await this.saveTemporaryConversationIndex({
          ...index,
          pathMeta: prunePathMeta(index.pathMeta, relativePath)
        })
        return this.buildState(registry, workspace.id, null)
      }
      const conversationDir = dirname(relativePath).replace(/\\/g, '/')
      const jsonPath = join(workspace.rootPath, agentConversationJsonRelativePath(id, conversationDir))
      const mdPath = join(workspace.rootPath, agentConversationMarkdownRelativePath(id, conversationDir))
      await unlink(jsonPath).catch(() => {})
      await unlink(mdPath).catch(() => {})
    } else if (payload.kind === 'directory') {
      await rm(absolutePath, { recursive: true, force: true })
    } else {
      await unlink(absolutePath).catch(() => {})
      // If this is an indexed lesson, also clear its sibling artifacts and index entry.
      const lessonMatch = index.lessons.find(
        (lesson) => resolve(lesson.absolutePath).toLowerCase() === absolutePath.toLowerCase()
      )
      if (lessonMatch) {
        const dir = dirname(lessonMatch.absolutePath)
        const base = basename(lessonMatch.absolutePath).replace(/\.html$/i, '')
        for (const suffix of ['-reference.html', '.md', '-flashcards.json']) {
          await unlink(join(dir, `${base}${suffix}`)).catch(() => {})
        }
      }
    }

    // Drop the index entry for a removed lesson, and prune pathMeta for this path + descendants.
    const remainingLessons = index.lessons.filter(
      (lesson) => !pathRemovedByWorkspaceItem(payload.kind, relativePath, lesson.relativePath)
    )
    const prunedMeta = prunePathMeta(index.pathMeta, relativePath)
    const nextPathMeta = isWorkspaceScaffoldPath(payload.kind, relativePath)
      ? { ...prunedMeta, [relativePath]: { archived: true } }
      : prunedMeta
    await this.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      lessons: remainingLessons,
      pathMeta: nextPathMeta,
      updatedAt: new Date().toISOString()
    })

    return this.buildState(registry, workspace.id, null)
  }

  async removeWorkspace(payload: WorkspaceRemovePayload): Promise<TeachingAppState> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const mode = payload.mode ?? 'disk'
    if (mode === 'disk') {
      assertSafeWorkspaceRootForRemoval(workspace.rootPath)
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
        const pathMeta = { ...(index.pathMeta ?? {}) }
        pathMeta[relativePath] = { ...(pathMeta[relativePath] ?? {}), archived: true }
        await this.saveTemporaryConversationIndex({ ...index, pathMeta })
        return this.buildState(registry, workspace.id, null)
      }
    }

    const index = await this.loadWorkspaceIndex(workspace)
    const pathMeta = { ...(index.pathMeta ?? {}) }
    pathMeta[relativePath] = { ...(pathMeta[relativePath] ?? {}), archived: true }
    await this.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      pathMeta,
      updatedAt: new Date().toISOString()
    })
    return this.buildState(registry, workspace.id, null)
  }

  /**
   * Shared generation core for both the non-streaming and streaming IPC paths.
   * Calls the configured provider, validates the structured plan with Zod, and
   * falls back to a local plan on any failure — generation never hard-fails.
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
    await this.ensureWorkspaceStructure(workspace)

    const settings = await this.loadSettings()
    const now = new Date().toISOString()
    const index = await this.loadWorkspaceIndex(workspace)
    const sequence = await this.nextLessonNumber(workspace.rootPath, index.lessons)
    const lessonId = String(sequence).padStart(4, '0')
    const mission = await this.readMissionSummary(workspace.rootPath, workspace.name)
    const generationAssessment = await this.assessTeachingRequest({
      workspace,
      userInput: prompt,
      messages: payload.messages ?? []
    })
    if (
      generationAssessment.stage === 'clarifying' &&
      !isContinuationLessonRequest(prompt)
    ) {
      if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
      return {
        kind: 'clarification',
        state: await this.buildState(registry, workspace.id, null),
        clarification: generationAssessment
      }
    }
    const lessonPrompt = generationAssessment.lessonPrompt || prompt
    const recalledMemories = await this.memoryStore.retrieve({
      query: `${mission.title}\n${mission.excerpt}\n${lessonPrompt}`,
      workspaceRoot: workspace.rootPath,
      limit: settings.memory.maxInjected
    })

    const callbacks: AdapterCallbacks = {
      onToken: (delta) => {
        if (stream) stream.onChunk({ streamId: stream.streamId, delta })
      },
      onStatus: (step) => {
        if (stream) stream.onStatus({ streamId: stream.streamId, step })
      }
    }

    const { plan, source, reason } = await this.produceLessonPlan({
      workspace,
      mission,
      prompt: lessonPrompt,
      settings,
      sequence,
      recalledMemories,
      callbacks
    })

    const title = clampTitle(plan.title)
    const objective = cleanText(plan.objective) || `把「${deriveTopic(lessonPrompt, mission.title)}」压缩成一次可保存、可复习的学习动作。`
    const artifacts = this.buildLessonArtifactPaths({
      workspace,
      sequence,
      title,
      prompt: lessonPrompt,
      requestedCourseName: payload.courseName,
      includeReference: settings.generator.generateReference,
      includeLearningRecord: settings.generator.generateLearningRecord,
      includeReviews: plan.flashcards.length > 0
    })

    const lesson: LessonSummary = {
      id: lessonId,
      title,
      objective,
      prompt: lessonPrompt,
      createdAt: now,
      durationMinutes: plan.durationMinutes || settings.generator.lessonDurationMinutes,
      courseId: artifacts.courseId,
      courseName: artifacts.courseName,
      courseRelativePath: artifacts.courseRelativePath,
      courseAbsolutePath: artifacts.courseAbsolutePath,
      sessionId: artifacts.sessionId,
      sessionName: artifacts.sessionName,
      sessionRelativePath: artifacts.sessionRelativePath,
      sessionAbsolutePath: artifacts.sessionAbsolutePath,
      relativePath: artifacts.lessonRelativePath,
      absolutePath: artifacts.lessonAbsolutePath
    }

    if (stream) stream.onStatus({ streamId: stream.streamId, step: 'rendering' })
    await this.writeLessonArtifacts({
      plan,
      lesson,
      mission,
      workspaceName: workspace.name,
      recordRelativePath: artifacts.recordRelativePath,
      recordAbsolutePath: artifacts.recordAbsolutePath,
      referenceRelativePath: artifacts.referenceRelativePath,
      referenceAbsolutePath: artifacts.referenceAbsolutePath,
      reviewsRelativePath: artifacts.reviewsRelativePath,
      reviewsAbsolutePath: artifacts.reviewsAbsolutePath,
      generator: settings.generator
    })

    await this.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      updatedAt: now,
      lessons: upsertLesson(index.lessons, lesson)
    })
    await this.appendSessionEvent(workspace.rootPath, {
      id: randomUUID(),
      kind: 'lesson_generated',
      timestamp: now,
      workspaceId: workspace.id,
      prompt: lessonPrompt,
      paths: [
        artifacts.lessonRelativePath,
        artifacts.referenceRelativePath,
        artifacts.recordRelativePath,
        artifacts.reviewsRelativePath
      ].filter((path): path is string => Boolean(path)),
      meta: { source, reason, model: settings.generator.model || undefined }
    })

    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
    return {
      kind: 'lesson',
      state: await this.buildState(nextRegistry, workspace.id, artifacts.lessonAbsolutePath),
      lesson,
      source,
      reason
    }
  }

  /**
   * Produce a validated LessonPlan. Tries the AI provider; on any failure
   * (no key, network error, bad JSON, schema rejection) returns a local
   * fallback plan with source='fallback'. Never throws.
   */
  private async produceLessonPlan(opts: {
    workspace: RegistryWorkspace
    mission: { title: string; excerpt: string }
    prompt: string
    settings: TeachingSettingsV1
    sequence: number
    recalledMemories: TeachingMemoryRecord[]
    callbacks: AdapterCallbacks
  }): Promise<{ plan: LessonPlan; source: LessonPlanSource; reason?: string }> {
    const { workspace, mission, prompt, settings, sequence, recalledMemories, callbacks } = opts
    const provider = resolveActiveProvider(settings)

    if (!provider || !provider.apiKey.trim()) {
      return { plan: localFallbackPlan(prompt, mission, sequence, settings), source: 'fallback', reason: '未配置 API Key' }
    }

    const systemPrompt = buildLessonSystemPrompt({
      missionTitle: mission.title,
      missionExcerpt: mission.excerpt,
      durationMinutes: settings.generator.lessonDurationMinutes,
      includeRetrievalPractice: settings.generator.includeRetrievalPractice,
      generateReference: settings.generator.generateReference,
      generateLearningRecord: settings.generator.generateLearningRecord,
      memories: recalledMemories,
      generator: settings.generator
    })
    const userPrompt = buildLessonUserPrompt({
      prompt,
      sequence,
      missionTitle: mission.title,
      memories: recalledMemories
    })

    // Tool-augmented path: let the model inspect the workspace and/or research
    // before emitting the LessonPlan JSON. Only for chat_completions /
    // custom_endpoint formats.
    const useTools =
      settings.tools.enabled &&
      toolsSupportedForFormat(settings.generator.endpointFormat) &&
      buildDefaultRegistry(settings, { workspaceRoot: workspace.rootPath }).definitions().length > 0
    if (useTools) {
      try {
        const researchSystemPrompt = `${LESSON_RESEARCH_PREFIX}\n\n${systemPrompt}`
        const ctx = buildToolContext(settings, { workspaceRoot: workspace.rootPath })
        const registry = buildDefaultRegistry(settings, { workspaceRoot: workspace.rootPath })
        const loopResult = await runAgentLoop({
          settings,
          provider,
          messages: [
            { role: 'system', content: researchSystemPrompt },
            { role: 'user', content: userPrompt }
          ],
          tools: registry.definitions(),
          toolHandlers: registry.handlerMap(ctx),
          maxIterations: settings.tools.maxIterations,
          callbacks: {
            onEvent: (e) => {
              if (e.type === 'status') {
                if (e.status === 'thinking') callbacks.onStatus?.('calling')
                else if (e.status === 'tool_running' || e.status === 'tool_done' || e.status === 'answering') {
                  callbacks.onStatus?.('streaming')
                }
              } else if (e.type === 'token') {
                callbacks.onToken?.(e.delta)
              }
            }
          }
        })
        callbacks.onStatus?.('validating')
        const plan = parsePlan(loopResult.finalText)
        if (!plan) {
          return { plan: localFallbackPlan(prompt, mission, sequence, settings), source: 'fallback', reason: 'AI 输出未通过结构校验' }
        }
        return { plan, source: 'ai' }
      } catch (error) {
        const reason = error instanceof ProviderAdapterError ? adapterReason(error) : (error instanceof Error ? error.message : '未知错误')
        console.warn(`[TeachOS] Tool-augmented lesson generation fell back to single-shot: ${reason}`)
        // fall through to the single-shot path below
      }
    }

    try {
      const result = settings.generator.streaming
        ? await streamProvider({ settings, provider, request: { systemPrompt, userPrompt, jsonMode: true }, callbacks })
        : await callProvider({ settings, provider, request: { systemPrompt, userPrompt, jsonMode: true }, callbacks })
      callbacks.onStatus?.('validating')
      const plan = parsePlan(result.text)
      if (!plan) {
        return { plan: localFallbackPlan(prompt, mission, sequence, settings), source: 'fallback', reason: 'AI 输出未通过结构校验' }
      }
      return { plan, source: 'ai' }
    } catch (error) {
      const reason = error instanceof ProviderAdapterError ? adapterReason(error) : (error instanceof Error ? error.message : '未知错误')
      console.warn(`[TeachOS] Lesson generation fell back to local generator: ${reason}`)
      return { plan: localFallbackPlan(prompt, mission, sequence, settings), source: 'fallback', reason }
    }
  }

  private async writeLessonArtifacts(opts: {
    plan: LessonPlan
    lesson: LessonSummary
    mission: { title: string; excerpt: string }
    workspaceName: string
    recordRelativePath: string | null
    recordAbsolutePath: string | null
    referenceRelativePath: string | null
    referenceAbsolutePath: string | null
    reviewsRelativePath: string | null
    reviewsAbsolutePath: string | null
    generator: TeachingSettingsV1['generator']
  }): Promise<void> {
    const {
      plan, lesson, mission, workspaceName,
      recordRelativePath, recordAbsolutePath,
      referenceRelativePath, referenceAbsolutePath,
      reviewsRelativePath, reviewsAbsolutePath,
      generator
    } = opts

    await mkdir(dirname(lesson.absolutePath), { recursive: true })
    await mkdir(join(dirname(dirname(lesson.absolutePath)), 'conversation'), { recursive: true })
    if (referenceAbsolutePath) await mkdir(dirname(referenceAbsolutePath), { recursive: true })
    if (recordAbsolutePath) await mkdir(dirname(recordAbsolutePath), { recursive: true })
    if (reviewsAbsolutePath) await mkdir(dirname(reviewsAbsolutePath), { recursive: true })

    await writeFile(
      lesson.absolutePath,
      renderLessonHtmlFromPlan({ plan, lesson, mission, workspaceName, recordRelativePath, referenceRelativePath, generator }),
      'utf8'
    )
    if (referenceAbsolutePath) {
      await writeFile(referenceAbsolutePath, renderReferenceHtmlFromPlan({ plan, lesson, mission, workspaceName }), 'utf8')
    }
    if (recordAbsolutePath) {
      await writeFile(recordAbsolutePath, renderLearningRecordFromPlan({ plan, lesson, mission }), 'utf8')
    }
    if (reviewsAbsolutePath && plan.flashcards.length) {
      await writeFile(
        reviewsAbsolutePath,
        `${JSON.stringify({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          relativePath: reviewsRelativePath,
          cards: plan.flashcards
        }, null, 2)}\n`,
        'utf8'
      )
    }
  }

  private buildLessonArtifactPaths(options: {
    workspace: RegistryWorkspace
    sequence: number
    title: string
    prompt: string
    requestedCourseName?: string
    includeReference: boolean
    includeLearningRecord: boolean
    includeReviews: boolean
  }): LessonArtifactPaths {
    const courseName = clampTitle(options.workspace.name)
    const courseId = slugify(courseName, 'course')
    const courseRelativePath = workspaceRelativePath('lessons')
    const courseAbsolutePath = join(options.workspace.rootPath, courseRelativePath)
    const sessionId = `lesson-${String(options.sequence).padStart(4, '0')}`
    const sessionName = `${String(options.sequence).padStart(4, '0')} ${options.title}`
    const lessonDirRelativePath = courseRelativePath
    const sessionRelativePath = lessonDirRelativePath
    const sessionAbsolutePath = join(options.workspace.rootPath, sessionRelativePath)
    const fileSlug = slugify(options.title, 'lesson')
    const lessonRelativePath = workspaceRelativePath(lessonDirRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}.html`)
    const lessonAbsolutePath = join(options.workspace.rootPath, lessonRelativePath)
    const referenceRelativePath = options.includeReference
      ? workspaceRelativePath(lessonDirRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}-reference.html`)
      : null
    const recordRelativePath = options.includeLearningRecord
      ? workspaceRelativePath(lessonDirRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}.md`)
      : null
    const reviewsRelativePath = options.includeReviews
      ? workspaceRelativePath(lessonDirRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}-flashcards.json`)
      : null

    return {
      courseId,
      courseName,
      courseRelativePath,
      courseAbsolutePath,
      sessionId,
      sessionName,
      sessionRelativePath,
      sessionAbsolutePath,
      lessonRelativePath,
      lessonAbsolutePath,
      referenceRelativePath,
      referenceAbsolutePath: referenceRelativePath ? join(options.workspace.rootPath, referenceRelativePath) : null,
      recordRelativePath,
      recordAbsolutePath: recordRelativePath ? join(options.workspace.rootPath, recordRelativePath) : null,
      reviewsRelativePath,
      reviewsAbsolutePath: reviewsRelativePath ? join(options.workspace.rootPath, reviewsRelativePath) : null
    }
  }

  /**
   * Aggregate flashcards from every lesson's review file (and from lesson
   * metadata) for the review deck.
   */
  async listReviewCards(workspaceId: string): Promise<ListReviewCardsResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const files = await collectTeachingFiles(workspace.rootPath, (file) => file.toLowerCase().endsWith('-flashcards.json'))
    const cards: ReviewCard[] = []
    for (const filePath of files) {
      const content = await readFile(filePath, 'utf8').catch(() => '')
      const parsed = safeJsonParse(content)
      if (!parsed || typeof parsed !== 'object') continue
      const lessonId = String((parsed as { lessonId?: unknown }).lessonId ?? '')
      const lessonTitle = String((parsed as { lessonTitle?: unknown }).lessonTitle ?? '')
      const cardList = (parsed as { cards?: unknown }).cards
      if (!Array.isArray(cardList)) continue
      for (const item of cardList) {
        const front = String((item as { front?: unknown }).front ?? '')
        const back = String((item as { back?: unknown }).back ?? '')
        if (front && back) cards.push({ lessonId, lessonTitle, front, back })
      }
    }
    return { cards }
  }

  async recordProgress(payload: RecordProgressPayload): Promise<GetProgressResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const progressPath = join(workspace.rootPath, '.teachos', 'progress.json')
    const existing = await this.readProgressFile(progressPath)
    const byLesson = { ...existing.byLesson }
    const lessonKey = payload.lessonId
    const prev = byLesson[lessonKey] ?? { answered: 0, correct: 0 }
    const merged = {
      answered: prev.answered + payload.results.length,
      correct: prev.correct + payload.results.filter((r) => r.correct).length
    }
    byLesson[lessonKey] = merged
    const summary: ProgressSummary = {
      totalAnswered: Object.values(byLesson).reduce((sum, entry) => sum + entry.answered, 0),
      correct: Object.values(byLesson).reduce((sum, entry) => sum + entry.correct, 0),
      byLesson
    }
    await atomicWriteFile(progressPath, `${JSON.stringify(summary, null, 2)}\n`)
    return { workspaceId: workspace.id, progress: summary }
  }

  async getProgress(workspaceId: string): Promise<GetProgressResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const progressPath = join(workspace.rootPath, '.teachos', 'progress.json')
    const progress = await this.readProgressFile(progressPath)
    return { workspaceId: workspace.id, progress }
  }

  private async readProgressFile(progressPath: string): Promise<ProgressSummary> {
    const content = await readFile(progressPath, 'utf8').catch(() => '')
    const parsed = safeJsonParse(content)
    if (!parsed || typeof parsed !== 'object') {
      return { totalAnswered: 0, correct: 0, byLesson: {} }
    }
    const byLessonRaw = (parsed as { byLesson?: unknown }).byLesson
    const byLesson: ProgressSummary['byLesson'] = {}
    if (byLessonRaw && typeof byLessonRaw === 'object') {
      for (const [key, value] of Object.entries(byLessonRaw as Record<string, unknown>)) {
        if (value && typeof value === 'object') {
          byLesson[key] = {
            answered: Number((value as { answered?: unknown }).answered ?? 0) || 0,
            correct: Number((value as { correct?: unknown }).correct ?? 0) || 0
          }
        }
      }
    }
    return {
      totalAnswered: Number((parsed as { totalAnswered?: unknown }).totalAnswered ?? 0) || 0,
      correct: Number((parsed as { correct?: unknown }).correct ?? 0) || 0,
      byLesson
    }
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

  async resolvePreviewFile(workspaceId: string, relativePath: string): Promise<WorkspacePreviewFile | null> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath)
    if (!normalizedRelativePath) return null
    const target = resolve(join(workspace.rootPath, normalizedRelativePath))
    const allowedRoots = [resolve(workspace.rootPath, 'courses'), resolve(workspace.rootPath, 'lessons'), resolve(workspace.rootPath, 'assets')]
    if (!allowedRoots.some((base) => isPathInsideRoot(base, target))) return null
    if (!(await fileExists(target))) return null
    return {
      absolutePath: target,
      mimeType: mimeTypeForPath(target)
    }
  }

  async listMemory(workspaceRoot?: string): Promise<TeachingMemoryRecord[]> {
    return this.memoryStore.list(workspaceRoot)
  }

  async getMemoryDiagnostics(): Promise<TeachingMemoryDiagnostics> {
    return this.memoryStore.diagnostics()
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

    return {
      workspaces: summaries,
      activeWorkspace,
      temporaryConversations,
      previewHtml,
      previewUrl: activeWorkspace && lessonPath ? toPreviewUrl(activeWorkspace.id, toWorkspaceRelativePath(activeWorkspace.rootPath, lessonPath)) : '',
      selectedLessonPath: lessonPath,
      runtime
    }
  }

  private async summarizeWorkspace(workspace: RegistryWorkspace): Promise<TeachingWorkspaceSummary> {
    const index = await this.loadWorkspaceIndex(workspace)
    const pathMeta = index.pathMeta ?? {}
    await this.ensureWorkspaceStructure(workspace, pathMeta)
    const mission = await this.readMissionSummary(workspace.rootPath, workspace.name)
    const lessons = await this.mergeLessonIndexWithDisk(workspace.rootPath, workspace.name, index.lessons, pathMeta)
    const conversations = await listAgentConversations(
      workspace.rootPath,
      pathMeta,
      { includeRoot: true, includeRootConversation: true, includeLegacyRootConversations: false }
    )
    const fileTree = await buildWorkspaceFileTree(workspace.rootPath, pathMeta)
    const courses = buildCourseSummaries(workspace, lessons, conversations, pathMeta)
    if (lessons.length !== index.lessons.length) {
      await this.saveWorkspaceIndex(workspace.rootPath, { ...index, lessons, updatedAt: new Date().toISOString() })
    }
    return {
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      missionPath: join(workspace.rootPath, 'MISSION.md'),
      resourcesPath: join(workspace.rootPath, 'RESOURCES.md'),
      lessonsDir: join(workspace.rootPath, 'lessons'),
      recordsDir: join(workspace.rootPath, 'lessons'),
      referenceDir: join(workspace.rootPath, 'lessons'),
      reviewsDir: join(workspace.rootPath, 'lessons'),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      pinned: workspace.pinned,
      missionTitle: mission.title,
      missionExcerpt: mission.excerpt,
      courses,
      fileTree,
      conversations,
      resources: await this.readResourceSummary(workspace.rootPath),
      records: await this.readLearningRecords(workspace.rootPath),
      lessons,
      referenceCount: (await collectTeachingFiles(workspace.rootPath, (file) => file.toLowerCase().endsWith('-reference.html'))).length,
      assetsReady: await fileExists(join(workspace.rootPath, 'assets', 'lesson.css')),
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
    const learnerProfiles = memories
      .filter((memory) => memory.scope === 'user' && !memory.disabledAt && !memory.deletedAt && isLearnerProfileMemory(memory))
      .map((memory) => cleanText(memory.content))
      .filter(Boolean)
      .slice(0, 8)
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
    const effectivePathMeta = pathMeta ?? (await this.loadWorkspaceIndex(workspace).then((index) => index.pathMeta ?? {}).catch(() => ({})))
    await mkdir(workspace.rootPath, { recursive: true })
    await Promise.all([
      ...Array.from(WORKSPACE_SCAFFOLD_DIRECTORIES)
        .filter((relativePath) => !isPathArchived(effectivePathMeta, relativePath))
        .map((relativePath) => mkdir(join(workspace.rootPath, relativePath), { recursive: true })),
      mkdir(join(workspace.rootPath, '.teachos'), { recursive: true })
    ])
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/lesson.css', LESSON_CSS)
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/quiz.js', QUIZ_JS)
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/flashcards.css', FLASHCARD_CSS)
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/flashcards.js', FLASHCARD_JS)
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'RESOURCES.md', renderResources(workspace.name))
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'MISSION.md', renderMission(workspace.name, `学习 ${workspace.name}`))
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
    try {
      const parsed = JSON.parse(await readFile(join(workspace.rootPath, '.teachos', 'index.json'), 'utf8')) as WorkspaceIndex
      return {
        id: workspace.id,
        name: workspace.name,
        rootPath: workspace.rootPath,
        createdAt: parsed.createdAt ?? workspace.createdAt,
        updatedAt: parsed.updatedAt ?? workspace.updatedAt,
        lessons: Array.isArray(parsed.lessons)
          ? parsed.lessons
              .filter(isLessonSummary)
              .map((lesson) => normalizeLessonSummary(workspace.rootPath, workspace.name, lesson))
          : [],
        pathMeta: normalizePathMeta(parsed.pathMeta)
      }
    } catch {
      return {
        id: workspace.id,
        name: workspace.name,
        rootPath: workspace.rootPath,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        lessons: []
      }
    }
  }

  private async saveWorkspaceIndex(rootPath: string, index: WorkspaceIndex): Promise<void> {
    await atomicWriteFile(join(rootPath, '.teachos', 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  }

  private async appendSessionEvent(rootPath: string, event: SessionEvent): Promise<void> {
    await mkdir(join(rootPath, '.teachos'), { recursive: true })
    await appendFile(join(rootPath, '.teachos', 'sessions.jsonl'), `${JSON.stringify(event)}\n`, 'utf8')
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

  private async assessTeachingRequest(options: {
    workspace: RegistryWorkspace
    userInput: string
    messages: AgentChatMessage[]
  }): Promise<TeachingClarificationResult> {
    const mission = await this.readMissionSummary(options.workspace.rootPath, options.workspace.name)
    return assessTeachingReadiness({
      userInput: options.userInput,
      messages: options.messages,
      missionTitle: mission.title,
      missionExcerpt: mission.excerpt
    })
  }

  private async nextLessonNumber(rootPath: string, lessons: LessonSummary[]): Promise<number> {
    const fromIndex = lessons.map((lesson) => Number.parseInt(lesson.id, 10)).filter(Number.isFinite)
    const files = await collectTeachingFiles(rootPath, (file) => file.toLowerCase().endsWith('.html'))
    const fromDisk = files
      .map((file) => Number.parseInt(basename(file).slice(0, 4), 10))
      .filter(Number.isFinite)
    return Math.max(0, ...fromIndex, ...fromDisk) + 1
  }

  private async mergeLessonIndexWithDisk(
    rootPath: string,
    workspaceName: string,
    indexedLessons: LessonSummary[],
    pathMeta: Record<string, WorkspacePathMeta> = {}
  ): Promise<LessonSummary[]> {
    const indexedByPath = new Map(indexedLessons.map((lesson) => [resolve(lesson.absolutePath).toLowerCase(), lesson]))
    const files = await collectTeachingFiles(rootPath, (filePath) => {
      const lower = filePath.toLowerCase()
      if (!lower.endsWith('.html')) return false
      if (lower.endsWith('-reference.html')) return false
      return true
    })
    return files
      .map((absolutePath) => {
        const existing = indexedByPath.get(resolve(absolutePath).toLowerCase())
        if (existing) return existing
        const file = basename(absolutePath)
        const relativePath = toWorkspaceRelativePath(rootPath, absolutePath)
        const placement = deriveLessonPlacementFromPath(rootPath, workspaceName, absolutePath)
        const idMatch = /^(\d{4})-/.exec(file)
        return {
          id: idMatch?.[1] ?? '0000',
          title: titleFromFilename(file),
          objective: '从本地 lesson 文件恢复的课程。',
          prompt: '',
          createdAt: new Date(0).toISOString(),
          durationMinutes: 12,
          courseId: placement.courseId,
          courseName: placement.courseName,
          courseRelativePath: placement.courseRelativePath,
          courseAbsolutePath: placement.courseAbsolutePath,
          sessionId: placement.sessionId,
          sessionName: placement.sessionName,
          sessionRelativePath: placement.sessionRelativePath,
          sessionAbsolutePath: placement.sessionAbsolutePath,
          relativePath,
          absolutePath
        } satisfies LessonSummary
      })
      .map((lesson) => ({ ...lesson, pinned: Boolean(pathMeta[lesson.relativePath]?.pinned) }))
      .filter((lesson) => !isPathArchived(pathMeta, lesson.relativePath))
      .sort((a, b) => {
        const aPinned = a.pinned ? 1 : 0
        const bPinned = b.pinned ? 1 : 0
        if (aPinned !== bPinned) return bPinned - aPinned
        return b.id.localeCompare(a.id)
      })
  }

  private async readMissionSummary(rootPath: string, fallbackName: string): Promise<{ title: string; excerpt: string }> {
    const content = await readFile(join(rootPath, 'MISSION.md'), 'utf8').catch(() => '')
    const title = /^#\s+Mission:\s*(.+)$/m.exec(content)?.[1] ?? /^#\s+(.+)$/m.exec(content)?.[1] ?? fallbackName
    const excerpt = /##\s+Why\s+([\s\S]*?)(?:\n##\s+|$)/m.exec(content)?.[1] ?? content
    return {
      title: cleanText(title),
      excerpt: compactMarkdown(excerpt) || '等待补充学习使命。'
    }
  }

  private async readResourceSummary(rootPath: string): Promise<ResourceSummary[]> {
    const content = await readFile(join(rootPath, 'RESOURCES.md'), 'utf8').catch(() => '')
    const rows: ResourceSummary[] = []
    let currentSection = '资源'
    for (const line of content.split(/\r?\n/)) {
      const heading = /^##\s+(.+)$/.exec(line)
      if (heading) {
        currentSection = heading[1]!.trim()
        continue
      }
      if (!line.startsWith('- ')) continue
      const item = line.slice(2).trim()
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/.exec(item)
      const localMatch = /^([^:]+):\s*(.+)$/.exec(item)
      const title = linkMatch?.[1] ?? localMatch?.[1] ?? item.split(' — ')[0] ?? item
      const detail = compactMarkdown(linkMatch?.[3] ?? localMatch?.[2] ?? item.split(' — ').slice(1).join(' — ')) || '已记录在资源索引中。'
      rows.push({ title: cleanText(title), detail, tag: currentSection })
    }
    return rows.length > 0 ? rows.slice(0, 8) : [{ title: 'RESOURCES.md', detail: '等待添加首批可信资源。', tag: 'Gaps' }]
  }

  private async readLearningRecords(rootPath: string): Promise<TeachingWorkspaceSummary['records']> {
    const files = await collectTeachingFiles(
      rootPath,
      (file) => {
        if (!file.toLowerCase().endsWith('.md')) return false
        if (basename(file).startsWith('MISSION') || basename(file).startsWith('RESOURCES')) return false
        return !isAgentConversationMarkdownRelativePath(toWorkspaceRelativePath(rootPath, file))
      }
    )
    return Promise.all(
      files
        .sort()
        .reverse()
        .slice(0, 8)
        .map(async (absolutePath) => {
          const file = basename(absolutePath)
          const content = await readFile(absolutePath, 'utf8').catch(() => '')
          const info = await stat(absolutePath).catch(() => null)
          return {
            title: cleanText(/^#\s+(.+)$/m.exec(content)?.[1] ?? titleFromFilename(file)),
            date: formatDate(info?.mtime ?? new Date()),
            relativePath: toWorkspaceRelativePath(rootPath, absolutePath),
            absolutePath
          }
        })
    )
  }
}

function upsertRegistryWorkspace(
  registry: WorkspaceRegistry,
  entry: RegistryWorkspace,
  activeWorkspaceId: string
): WorkspaceRegistry {
  const others = registry.workspaces.filter((workspace) => workspace.id !== entry.id)
  return { activeWorkspaceId, workspaces: orderRegistryWorkspaces([entry, ...others]) }
}

function touchRegistryWorkspace(
  registry: WorkspaceRegistry,
  workspaceId: string,
  updatedAt: string
): WorkspaceRegistry {
  return {
    activeWorkspaceId: workspaceId,
    workspaces: orderRegistryWorkspaces(registry.workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, updatedAt } : workspace
    ))
  }
}

function orderRegistryWorkspaces(workspaces: RegistryWorkspace[]): RegistryWorkspace[] {
  return workspaces
    .map((workspace, index) => ({ workspace, index }))
    .sort((left, right) => {
      const leftPinned = left.workspace.pinned ? 1 : 0
      const rightPinned = right.workspace.pinned ? 1 : 0
      if (leftPinned !== rightPinned) return rightPinned - leftPinned
      return left.index - right.index
    })
    .map(({ workspace }) => workspace)
}

function visibleRegistryWorkspaces(workspaces: RegistryWorkspace[]): RegistryWorkspace[] {
  return workspaces.filter((workspace) => !workspace.archived)
}

function applyRegistryWorkspaceMeta(
  workspace: RegistryWorkspace,
  patch: Pick<WorkspaceItemMetaPayload, 'pinned' | 'archived'>
): RegistryWorkspace {
  const next = { ...workspace }
  if (patch.pinned === null) delete next.pinned
  else if (patch.pinned !== undefined) next.pinned = patch.pinned
  if (patch.archived === null) delete next.archived
  else if (patch.archived !== undefined) next.archived = patch.archived
  return next
}

function sameRegistryWorkspaceOrder(left: RegistryWorkspace[], right: RegistryWorkspace[]): boolean {
  if (left.length !== right.length) return false
  return left.every((workspace, index) => workspace.id === right[index]?.id)
}

function findWorkspace(registry: WorkspaceRegistry, workspaceId: string): RegistryWorkspace {
  const workspace = registry.workspaces.find((entry) => entry.id === workspaceId)
  if (!workspace) throw new Error('Workspace not found.')
  return workspace
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

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

function assertSafeWorkspaceRootForRemoval(rootPath: string): void {
  const root = resolve(rootPath)
  if (samePath(root, dirname(root))) {
    throw new Error('Cannot remove a filesystem root as a workspace.')
  }
}

async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, path)
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await fileExists(path)) return
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

async function writeWorkspaceScaffoldFileIfMissing(
  rootPath: string,
  pathMeta: Record<string, WorkspacePathMeta>,
  relativePath: string,
  content: string
): Promise<void> {
  if (isPathArchived(pathMeta, relativePath)) return
  await writeIfMissing(join(rootPath, relativePath), content)
}

function isWorkspaceScaffoldPath(kind: WorkspaceItemKind, relativePath: string): boolean {
  const path = normalizeWorkspaceRelativePath(relativePath)
  if (!path) return false
  if (kind === 'directory') return WORKSPACE_SCAFFOLD_DIRECTORIES.has(path)
  if (kind === 'file') return WORKSPACE_SCAFFOLD_FILES.has(path)
  return false
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile()).catch(() => false)
}

async function directoryExists(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isDirectory()).catch(() => false)
}

async function countFiles(path: string, extension: string): Promise<number> {
  return readdir(path)
    .then((files) => files.filter((file) => file.toLowerCase().endsWith(extension)).length)
    .catch(() => 0)
}

async function countFilesRecursive(path: string, extension: string): Promise<number> {
  const files = await walkFiles(path, (file) => file.toLowerCase().endsWith(extension))
  return files.length
}

async function collectTeachingFiles(rootPath: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  const roots = [join(rootPath, 'courses'), join(rootPath, 'lessons'), join(rootPath, 'learning-records'), join(rootPath, 'reviews'), join(rootPath, 'reference')]
  const results = await Promise.all(roots.map((path) => walkFiles(path, predicate)))
  return results.flat()
}

const WORKSPACE_TREE_MAX_DEPTH = 5
const WORKSPACE_TREE_MAX_ENTRIES_PER_DIR = 80
const WORKSPACE_TREE_IGNORED_DIRS = new Set([
  '.git',
  '.teachos',
  'node_modules',
  'out',
  'dist',
  'release'
])

async function buildWorkspaceFileTree(
  rootPath: string,
  pathMeta: Record<string, WorkspacePathMeta> = {}
): Promise<WorkspaceFileNode[]> {
  return readWorkspaceTreeDirectory(rootPath, '', 0, pathMeta)
}

async function readWorkspaceTreeDirectory(
  rootPath: string,
  relativeDir: string,
  depth: number,
  pathMeta: Record<string, WorkspacePathMeta>
): Promise<WorkspaceFileNode[]> {
  const absoluteDir = relativeDir ? join(rootPath, relativeDir) : rootPath
  const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => [])
  const visibleEntries = entries
    .filter((entry) => !shouldHideWorkspaceTreeEntry(relativeDir, entry.name, entry.isDirectory()))
    .filter((entry) => {
      const relativePath = workspaceRelativePath(relativeDir.replace(/\\/g, '/'), entry.name)
      return !isPathArchived(pathMeta, relativePath)
    })
    .sort((left, right) => {
      const leftPath = workspaceRelativePath(relativeDir.replace(/\\/g, '/'), left.name)
      const rightPath = workspaceRelativePath(relativeDir.replace(/\\/g, '/'), right.name)
      const leftPinned = pathMeta[leftPath]?.pinned ? 1 : 0
      const rightPinned = pathMeta[rightPath]?.pinned ? 1 : 0
      if (leftPinned !== rightPinned) return rightPinned - leftPinned
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
    .slice(0, WORKSPACE_TREE_MAX_ENTRIES_PER_DIR)

  const nodes = await Promise.all(
    visibleEntries.map(async (entry): Promise<WorkspaceFileNode | null> => {
      if (!entry.isDirectory() && !entry.isFile()) return null
      const relativePath = workspaceRelativePath(relativeDir.replace(/\\/g, '/'), entry.name)
      const absolutePath = join(rootPath, relativePath)
      const pinned = Boolean(pathMeta[relativePath]?.pinned)
      if (entry.isDirectory()) {
        const atDepthLimit = depth + 1 >= WORKSPACE_TREE_MAX_DEPTH
        return {
          name: entry.name,
          kind: 'directory',
          relativePath,
          absolutePath,
          children: atDepthLimit ? [] : await readWorkspaceTreeDirectory(rootPath, relativePath, depth + 1, pathMeta),
          truncated: atDepthLimit || entries.length > WORKSPACE_TREE_MAX_ENTRIES_PER_DIR || undefined,
          pinned
        }
      }
      return {
        name: entry.name,
        kind: 'file',
        relativePath,
        absolutePath,
        pinned
      }
    })
  )

  return nodes.filter((node): node is WorkspaceFileNode => Boolean(node))
}

function shouldHideWorkspaceTreeEntry(relativeDir: string, name: string, isDirectory: boolean): boolean {
  if (isDirectory && WORKSPACE_TREE_IGNORED_DIRS.has(name)) return true
  const normalizedDir = relativeDir.replace(/\\/g, '/')
  if (name.toLowerCase().endsWith('.json') && isAgentConversationJsonRelativePath(workspaceRelativePath(normalizedDir, name))) return true
  return false
}

async function listAgentConversations(
  rootPath: string,
  pathMeta: Record<string, WorkspacePathMeta> = {},
  options: {
    includeRoot?: boolean
    includeRootConversation?: boolean
    includeLegacyRootConversations?: boolean
    includeLessons?: boolean
    includeCourses?: boolean
    fallbackWorkspaceId?: string
  } = {}
): Promise<AgentConversationSummary[]> {
  const jsonRelativePaths = await collectAgentConversationJsonRelativePaths(rootPath, options)
  const records = await Promise.all(
    jsonRelativePaths.map((relativePath) => readAgentConversationRecordAt(rootPath, relativePath).catch(() => null))
  )
  return sortAgentConversationSummaries(records
    .filter((record): record is AgentConversationRecord => Boolean(record))
    .map((record) => toAgentConversationSummary(record, pathMeta, options.fallbackWorkspaceId))
    .filter((summary) => !isPathArchived(pathMeta, summary.relativePath))
  )
}

async function nextAgentConversationId(rootPath: string, title: string, timestamp: string): Promise<string> {
  const base = `chat-${formatConversationTimestamp(new Date(timestamp))}-${slugify(title, 'conversation')}`.slice(0, 96)
  let id = requireSafeAgentConversationId(base)
  let suffix = 2
  while (await agentConversationIdExists(rootPath, id)) {
    id = requireSafeAgentConversationId(`${base.slice(0, 88)}-${suffix}`)
    suffix += 1
  }
  return id
}

async function readAgentConversationRecord(rootPath: string, conversationId: string): Promise<AgentConversationRecord> {
  const id = requireSafeAgentConversationId(conversationId)
  const jsonRelativePath = await findAgentConversationJsonRelativePath(rootPath, id)
  return readAgentConversationRecordAt(rootPath, jsonRelativePath)
}

async function readAgentConversationRecordAt(rootPath: string, jsonRelativePath: string): Promise<AgentConversationRecord> {
  const normalizedJsonRelativePath = normalizeWorkspaceRelativePath(jsonRelativePath)
  const id = requireSafeAgentConversationId(basename(normalizedJsonRelativePath).replace(/\.json$/i, ''))
  const jsonPath = join(rootPath, jsonRelativePath)
  if (!isPathInsideRoot(rootPath, jsonPath)) throw new Error('Conversation path is outside the workspace.')
  const parsed = safeJsonParse(await readFile(jsonPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('Conversation record is invalid.')
  const record = parsed as Record<string, unknown>
  const turns = normalizeAgentConversationTurns(record.turns)
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt
  const title = cleanText(record.title) || deriveConversationTitle(turns, createdAt)
  const storedMarkdownRelativePath = typeof record.relativePath === 'string'
    ? normalizeWorkspaceRelativePath(record.relativePath)
    : ''
  const conversationDir = dirname(normalizedJsonRelativePath).replace(/\\/g, '/')
  const relativePath = isAgentConversationMarkdownRelativePath(storedMarkdownRelativePath)
    ? storedMarkdownRelativePath
    : agentConversationMarkdownRelativePath(id, conversationDir)
  return {
    id,
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : undefined,
    title,
    createdAt,
    updatedAt,
    relativePath,
    absolutePath: join(rootPath, relativePath),
    messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
    turns
  }
}

async function writeAgentConversationRecord(
  workspace: RegistryWorkspace,
  record: AgentConversationRecord
): Promise<void> {
  const jsonRelativePath = agentConversationJsonRelativePathForMarkdown(record.relativePath)
  const markdownRelativePath = normalizeWorkspaceRelativePath(record.relativePath)
  if (!isAgentConversationMarkdownRelativePath(markdownRelativePath)) {
    throw new Error('Conversation markdown path is outside a conversations directory.')
  }
  await atomicWriteFile(
    join(workspace.rootPath, jsonRelativePath),
    `${JSON.stringify({
      version: 1,
      workspaceId: record.workspaceId ?? workspace.id,
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      relativePath: record.relativePath,
      turns: record.turns
    }, null, 2)}\n`
  )
  await atomicWriteFile(
    join(workspace.rootPath, markdownRelativePath),
    renderAgentConversationMarkdown(workspace, record)
  )
}

function renderAgentConversationMarkdown(workspace: RegistryWorkspace, record: AgentConversationRecord): string {
  const lines = [
    `# ${record.title}`,
    '',
    `Workspace: ${workspace.name}`,
    `Created: ${record.createdAt}`,
    `Updated: ${record.updatedAt}`,
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
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`
}

function normalizeAgentConversationTurns(turns: unknown): AgentChatTurn[] {
  if (!Array.isArray(turns)) return []
  const now = new Date().toISOString()
  const normalized: AgentChatTurn[] = []
  for (const [index, item] of turns.entries()) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null
    if (!role) continue
    const toolCalls = Array.isArray(record.toolCalls)
      ? record.toolCalls.map((raw, toolIndex) => {
          const tool = (raw ?? {}) as Record<string, unknown>
          return {
            id: typeof tool.id === 'string' && tool.id ? tool.id : `tool-${index}-${toolIndex}`,
            name: typeof tool.name === 'string' ? tool.name : '',
            arguments: typeof tool.arguments === 'string' ? tool.arguments : '',
            result: typeof tool.result === 'string' ? tool.result : undefined,
            isError: tool.isError === true
          }
        })
      : undefined
    const processEvents: AgentChatProcessEvent[] | undefined = Array.isArray(record.processEvents)
      ? record.processEvents
          .filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object')
          .map((event, eventIndex): AgentChatProcessEvent => {
            const kind: AgentChatProcessEvent['kind'] =
              event.kind === 'tool_call' || event.kind === 'tool_result' ? event.kind : 'status'
            return {
              id: typeof event.id === 'string' && event.id ? event.id : `event-${index}-${eventIndex}`,
              kind,
              title: typeof event.title === 'string' ? event.title : '',
              detail: typeof event.detail === 'string' ? event.detail : undefined,
              status: typeof event.status === 'string' ? event.status as NonNullable<AgentChatTurn['processEvents']>[number]['status'] : undefined,
              toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
              toolName: typeof event.toolName === 'string' ? event.toolName : undefined,
              isError: event.isError === true,
              createdAt: typeof event.createdAt === 'string' ? event.createdAt : now
            }
          })
      : undefined
    normalized.push({
      id: typeof record.id === 'string' && record.id ? record.id : `${role}-${index}`,
      role,
      content: typeof record.content === 'string' ? record.content : '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      processEvents: processEvents && processEvents.length > 0 ? processEvents : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now
    })
  }
  return normalized
}

function deriveConversationTitle(turns: AgentChatTurn[], timestamp: string): string {
  const firstUserContent = cleanText(turns.find((turn) => turn.role === 'user')?.content)
  if (firstUserContent) return firstUserContent.length > 48 ? `${firstUserContent.slice(0, 48)}...` : firstUserContent
  return `Conversation ${formatDate(new Date(timestamp))}`
}

async function collectAgentConversationJsonRelativePaths(
  rootPath: string,
  options: {
    includeRoot?: boolean
    includeRootConversation?: boolean
    includeLegacyRootConversations?: boolean
    includeLessons?: boolean
    includeCourses?: boolean
  } = {}
): Promise<string[]> {
  const includeCourses = options.includeCourses ?? true
  const result: string[] = []
  for (const directory of agentConversationJsonScanDirectories(options)) {
    const entries = await readdir(join(rootPath, directory), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        result.push(workspaceRelativePath(directory, entry.name))
      }
    }
  }
  if (!includeCourses) return result
  const courseEntries = await readdir(join(rootPath, 'courses'), { withFileTypes: true }).catch(() => [])
  for (const courseEntry of courseEntries) {
    if (!courseEntry.isDirectory()) continue
    for (const directory of agentConversationCourseJsonScanDirectories(courseEntry.name)) {
      const entries = await readdir(join(rootPath, directory), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
          result.push(workspaceRelativePath(directory, entry.name))
        }
      }
    }
  }
  return result
}

async function agentConversationIdExists(rootPath: string, id: string): Promise<boolean> {
  return findAgentConversationJsonRelativePath(rootPath, id)
    .then(() => true)
    .catch(() => false)
}

async function findAgentConversationJsonRelativePath(rootPath: string, id: string): Promise<string> {
  const safeId = requireSafeAgentConversationId(id)
  const matches = (await collectAgentConversationJsonRelativePaths(rootPath))
    .filter((relativePath) => basename(relativePath).replace(/\.json$/i, '') === safeId)
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))
  const first = matches[0]
  if (!first) throw new Error('Conversation not found.')
  return first
}

async function ensureTeachingContentDirectories(rootPath: string): Promise<void> {
  await Promise.all([
    mkdir(join(rootPath, 'lessons'), { recursive: true }),
    mkdir(join(rootPath, 'conversation'), { recursive: true })
  ])
}

function requireSafeAgentConversationId(value: string): string {
  const id = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw new Error('Conversation id is invalid.')
  return id
}

function formatConversationTimestamp(date: Date): string {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}-${pad(safeDate.getHours())}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`
}

function toAgentConversationSummary(
  record: AgentConversationRecord,
  pathMeta: Record<string, WorkspacePathMeta> = {},
  fallbackWorkspaceId?: string
): AgentConversationSummary {
  return {
    id: record.id,
    workspaceId: record.workspaceId ?? fallbackWorkspaceId,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    relativePath: record.relativePath,
    absolutePath: record.absolutePath,
    messageCount: record.messageCount,
    pinned: Boolean(pathMeta[record.relativePath]?.pinned)
  }
}

function sortAgentConversationSummaries(conversations: AgentConversationSummary[]): AgentConversationSummary[] {
  return conversations.sort((left, right) => {
    const leftPinned = left.pinned ? 1 : 0
    const rightPinned = right.pinned ? 1 : 0
    if (leftPinned !== rightPinned) return rightPinned - leftPinned
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

function compactTextForMarkdown(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return '(empty)'
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact
}

async function walkFiles(rootPath: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  if (!(await directoryExists(rootPath))) return []
  const result: string[] = []
  const stack = [rootPath]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const nextPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(nextPath)
        continue
      }
      if (entry.isFile() && predicate(nextPath)) {
        result.push(nextPath)
      }
    }
  }
  return result
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
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

function deriveLessonTitle(prompt: string, sequence: number): string {
  const topic = deriveTopic(prompt, `第 ${sequence} 节`)
  return topic.length > 18 ? `${topic.slice(0, 18)}...` : topic
}

function clampTitle(value: string): string {
  const trimmed = cleanText(value)
  if (!trimmed) return '学习任务'
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed
}

function deriveCourseName(prompt: string, title: string, fallback: string): string {
  const topic = deriveTopic(prompt, title || fallback)
  return topic || cleanText(fallback) || '默认课程'
}

function toWorkspaceRelativePath(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).replace(/\\/g, '/')
}

function deriveLessonPlacementFromPath(
  rootPath: string,
  workspaceName: string,
  absolutePath: string
): Pick<
  LessonSummary,
  | 'courseId'
  | 'courseName'
  | 'courseRelativePath'
  | 'courseAbsolutePath'
  | 'sessionId'
  | 'sessionName'
  | 'sessionRelativePath'
  | 'sessionAbsolutePath'
> {
  const relativePath = toWorkspaceRelativePath(rootPath, absolutePath)
  const parts = relativePath.split('/').filter(Boolean)
  const file = basename(absolutePath)
  const courseRelativePath = parts[0] === 'courses' && parts[1]
    ? workspaceRelativePath('courses', parts[1])
    : workspaceRelativePath('lessons')
  const courseName = courseRelativePath === 'lessons'
    ? clampTitle(workspaceName)
    : titleFromFilename(parts[1] ?? workspaceName)
  const courseId = slugify(courseName, 'course')
  const idMatch = /^(\d{4})-/.exec(file)
  const sessionId = idMatch?.[1] ? `lesson-${idMatch[1]}` : `lesson-${parts.at(-1)?.slice(0, 4) || '0000'}`
  const sessionRelativePath = dirname(relativePath).replace(/\\/g, '/')
  return {
    courseId,
    courseName,
    courseRelativePath,
    courseAbsolutePath: join(rootPath, courseRelativePath),
    sessionId,
    sessionName: titleFromFilename(file),
    sessionRelativePath,
    sessionAbsolutePath: join(rootPath, sessionRelativePath)
  }
}

function buildCourseSummaries(
  workspace: RegistryWorkspace,
  lessons: LessonSummary[],
  conversations: AgentConversationSummary[] = [],
  pathMeta: Record<string, WorkspacePathMeta> = {}
): TeachingCourseSummary[] {
  const courseMap = new Map<string, {
    id: string
    name: string
    relativePath: string
    absolutePath: string
    sessions: TeachingSessionSummary[]
    conversations: AgentConversationSummary[]
  }>()
  const ensureCourse = (relativePath: string): NonNullable<ReturnType<typeof courseMap.get>> => {
    const normalized = normalizeWorkspaceRelativePath(relativePath) || 'lessons'
    const existing = courseMap.get(normalized)
    if (existing) return existing
    const name = normalized === 'lessons' ? clampTitle(workspace.name) : titleFromFilename(basename(normalized))
    const course = {
      id: slugify(name, 'course'),
      name,
      relativePath: normalized,
      absolutePath: join(workspace.rootPath, normalized),
      sessions: [],
      conversations: []
    }
    courseMap.set(normalized, course)
    return course
  }

  if (!isPathArchived(pathMeta, 'lessons')) {
    ensureCourse('lessons')
  }
  for (const lesson of lessons) {
    if (isPathArchived(pathMeta, lesson.courseRelativePath)) continue
    ensureCourse(lesson.courseRelativePath).sessions.push({
      id: lesson.sessionId,
      name: lesson.sessionName,
      relativePath: lesson.sessionRelativePath,
      absolutePath: lesson.sessionAbsolutePath,
      lesson
    })
  }
  for (const conversation of conversations) {
    const courseRelativePath = courseRelativePathFromConversationPath(conversation.relativePath)
    if (!courseRelativePath) continue
    if (isPathArchived(pathMeta, courseRelativePath)) continue
    ensureCourse(courseRelativePath).conversations.push(conversation)
  }

  return [...courseMap.values()]
    .filter((course) => !isPathArchived(pathMeta, course.relativePath))
    .map((course): TeachingCourseSummary => {
      const sortedSessions = course.sessions.sort((left, right) => right.lesson.id.localeCompare(left.lesson.id))
      const sortedConversations = sortAgentConversationSummaries(course.conversations)
      return {
        id: course.id,
        name: course.name,
        relativePath: course.relativePath,
        absolutePath: course.absolutePath,
        lessonCount: sortedSessions.length,
        sessionCount: sortedSessions.length + sortedConversations.length,
        sessions: sortedSessions,
        conversations: sortedConversations
      }
    })
    .sort((left, right) => {
      if (left.relativePath === 'lessons') return -1
      if (right.relativePath === 'lessons') return 1
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
}

function normalizeLessonSummary(rootPath: string, workspaceName: string, lesson: LessonSummary): LessonSummary {
  const placement = deriveLessonPlacementFromPath(rootPath, workspaceName, lesson.absolutePath)
  return {
    ...lesson,
    courseId: placement.courseId,
    courseName: placement.courseName,
    courseRelativePath: placement.courseRelativePath,
    courseAbsolutePath: placement.courseAbsolutePath,
    sessionId: placement.sessionId,
    sessionName: placement.sessionName,
    sessionRelativePath: placement.sessionRelativePath,
    sessionAbsolutePath: placement.sessionAbsolutePath
  }
}

function adapterReason(error: ProviderAdapterError): string {
  switch (error.kind) {
    case 'no_api_key':
      return '未配置 API Key'
    case 'network':
      return '网络错误'
    case 'http':
      return providerErrorReason(classifyProviderError(error.message) ?? { kind: 'http' })
    case 'parse':
      return '响应解析失败'
    case 'timeout':
      return '请求超时'
    case 'unsupported':
      return '不支持的 endpoint 格式'
    default:
      return error.message
  }
}

const LESSON_RESEARCH_PREFIX =
  '在生成课程计划之前，你可以调用工作区只读工具读取 MISSION.md、RESOURCES.md、lessons、reference 和 learning-records 中的上下文；' +
  '也可以调用 web_search 工具检索最新或课程之外的事实性信息以丰富内容（例如最新版本号、时效性事件、权威定义）。' +
  '完成必要的检索后，仍必须严格只输出一个符合下方格式的 JSON 课程计划对象，不要输出任何额外说明或 markdown 围栏。'

/**
 * Parse + Zod-validate the model's text into a LessonPlan. Strips markdown
 * fences and extracts the outermost JSON object if the model wrapped it in
 * prose. Returns null on any failure (caller falls back to local plan).
 */
function parsePlan(text: string): LessonPlan | null {
  const raw = extractJsonText(text)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = lessonPlanSchema.safeParse(parsed)
  if (!result.success) {
    console.warn('[TeachOS] Lesson plan schema validation failed:', result.error.issues[0]?.message)
    return null
  }
  return sanitizePlan(result.data)
}

function extractJsonText(text: string): string {
  const trimmed = text.trim()
  // Strip ```json ... ``` fences
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed)
  if (fenceMatch) return fenceMatch[1]!.trim()
  // If it starts with { assume pure JSON
  if (trimmed.startsWith('{')) return trimmed
  // Otherwise extract the last balanced { ... } block
  const start = trimmed.lastIndexOf('{')
  const end = trimmed.indexOf('}', start)
  if (start >= 0 && end > start) {
    // Greedy: take from first { to last }
    const first = trimmed.indexOf('{')
    const last = trimmed.lastIndexOf('}')
    if (first >= 0 && last > first) return trimmed.slice(first, last + 1)
  }
  return ''
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Local fallback plan — used when no provider is configured or the AI call
 * fails. Mirrors the original templated lesson content so the fallback path
 * stays educational rather than empty.
 */
function localFallbackPlan(
  prompt: string,
  mission: { title: string; excerpt: string },
  sequence: number,
  settings: TeachingSettingsV1
): LessonPlan {
  const topic = deriveTopic(prompt, mission.title)
  const title = sequence === 1 ? '写出可执行的学习使命' : deriveLessonTitle(prompt, sequence)
  const includeQuiz = settings.generator.includeRetrievalPractice
  return {
    title,
    objective: `把「${topic}」压缩成一次可保存、可复习的学习动作。`,
    durationMinutes: sequence === 1 ? Math.min(12, settings.generator.lessonDurationMinutes) : settings.generator.lessonDurationMinutes,
    sections: [
      {
        heading: '这节课完成什么',
        body: '先把输入的学习愿望整理成一个小闭环：使命、可信资源、可复习 lesson、learning record。这个闭环比一次性聊天更有价值，因为它能在文件系统里持续演进。\n\n1. **使命** — 说明为什么学，以及成功是什么样子。\n2. **课程** — 只教一个足够小的动作，并保存为静态 HTML。\n3. **记录** — 把已经建立的理解写入 learning-records，供下次生成使用。'
      },
      {
        heading: '把任务拆成文件',
        body: '- [MISSION.md](../MISSION.md) — 学习罗盘\n- [RESOURCES.md](../RESOURCES.md) — 可信来源\n- lessons/*.html — 课程讲义与速查材料\n- lessons/*.md — 学习证据\n- conversation/*.md — 对话记录'
      }
    ],
    keyPoints: ['文件系统是真相来源', '每节 lesson 短小且可复习', '本地优先，AI 可选'],
    quiz: includeQuiz
      ? [{
          type: 'single',
          question: 'TeachOS 里最应该长期保存的真相来源是什么？',
          choices: ['运行时内存状态', '工作区文件资产', '单次聊天窗口'],
          answer: 1,
          explanation: '工作区文件能脱离 App 长期保存。'
        }]
      : [],
    flashcards: [],
    referenceNotes: '先写 mission，再决定第一课；课程输出到 lessons/*.html；对话记录写入 conversation/*.md。',
    learningRecordNote: `本节围绕「${mission.title}」建立了可复用的 TeachOS 学习闭环。`
  }
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function titleFromFilename(file: string): string {
  return (
    file
      .replace(/\.[^.]+$/, '')
      .replace(/^\d{4}-/, '')
      .split('-')
      .filter(Boolean)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(' ') || file
  )
}

function workspaceRelativePath(...parts: string[]): string {
  return parts.filter(Boolean).join('/')
}

/** Normalize a stored relative path key: forward slashes, no leading slash, no `./`. */
function normalizeWorkspaceRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').replace(/\/+$/, '')
}

function normalizePathMeta(value: unknown): Record<string, WorkspacePathMeta> {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  const result: Record<string, WorkspacePathMeta> = {}
  for (const [key, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object') continue
    const meta = entry as { pinned?: unknown; archived?: unknown }
    const normalized: WorkspacePathMeta = {}
    if (meta.pinned === true) normalized.pinned = true
    if (meta.archived === true) normalized.archived = true
    const normalizedKey = normalizeWorkspaceRelativePath(key)
    if (!normalizedKey) continue
    result[normalizedKey] = normalized
  }
  return result
}

function isPathArchived(pathMeta: Record<string, WorkspacePathMeta>, relativePath: string): boolean {
  const path = normalizeWorkspaceRelativePath(relativePath)
  if (!path) return false
  return Object.entries(pathMeta).some(([key, meta]) => {
    if (!meta.archived) return false
    const archivedPath = normalizeWorkspaceRelativePath(key)
    return path === archivedPath || path.startsWith(`${archivedPath}/`)
  })
}

function pathRemovedByWorkspaceItem(
  kind: WorkspaceItemKind,
  removedRelativePath: string,
  currentRelativePath: string
): boolean {
  const removed = normalizeWorkspaceRelativePath(removedRelativePath)
  const current = normalizeWorkspaceRelativePath(currentRelativePath)
  if (!removed || !current) return false
  if (kind === 'directory') return current === removed || current.startsWith(`${removed}/`)
  return current === removed
}

/** Remove a path's meta entry and any descendant entries (for folder removal). */
function prunePathMeta(
  value: Record<string, WorkspacePathMeta> | undefined,
  relativePath: string
): Record<string, WorkspacePathMeta> {
  if (!value) return {}
  const key = normalizeWorkspaceRelativePath(relativePath)
  const prefix = key ? `${key}/` : ''
  const result: Record<string, WorkspacePathMeta> = {}
  for (const [entryKey, meta] of Object.entries(value)) {
    if (entryKey === key) continue
    if (prefix && (entryKey === prefix.slice(0, -1) || entryKey.startsWith(prefix))) continue
    result[entryKey] = meta
  }
  return result
}

function compactMarkdown(value: string): string {
  return cleanText(
    value
      .replace(/^#+\s+/gm, '')
      .replace(/^-+\s*/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  )
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderMission(topic: string, prompt: string): string {
  const safeTopic = cleanText(topic) || '学习任务'
  const safePrompt = cleanText(prompt) || `学习 ${safeTopic}`
  return `# Mission: ${safeTopic}

## Why
${safePrompt}。这个工作区会把学习目标、可信资源、课程讲义和复习记录沉淀为可迁移的本地文件。

## Success looks like
- 能把模糊学习需求整理成一段可执行的 mission
- 能从 mission 生成第一节可保存、可打印的 HTML lesson
- 能在后续学习中持续积累 resources、reference 和 learning records

## Constraints
- 文件系统是真相来源，App 只负责索引、生成和预览
- 每节 lesson 应短小，并包含一次明确的检索练习
- 早期先使用本地结构化生成器，后续再接入 AI provider

## Out of scope
- 云同步、多用户权限和复杂 RAG
- 把每节课做成重型 React SPA
`
}

function renderResources(topic: string): string {
  const safeTopic = cleanText(topic) || 'TeachOS'
  return `# ${safeTopic} Resources

## Knowledge

- Local: teach/SKILL.md
  定义 MISSION、RESOURCES、lessons、reference、learning-records 和 assets 的长期文件约定。Use for: 判断工作区是否完整。
- Local: teaching-system-tech-stack.md
  记录 Electron、React、本地文件、结构化生成和静态 HTML lesson 的 MVP 技术路线。Use for: 判断实现优先级。

## Wisdom (Communities)

- Local: 与用户的后续教学对话
  用于验证 lesson 是否真的帮用户完成一个可观察的学习动作。

## Gaps

- 还需要为具体学习主题补充高信任外部资料。
`
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
    <div class="badge">TeachOS</div>
    <h1>${escapeHtml(workspace.missionTitle)}</h1>
    <p>${escapeHtml(workspace.missionExcerpt)}</p>
    <p>点击生成按钮后，静态 HTML lesson 会保存到当前课程的 lessons 文件夹，并在这里预览。</p>
  </main>
</body>
</html>`
}

function withPreviewBase(html: string, baseHref: string): string {
  const baseTag = `<base href="${baseHref}" />`
  if (/<base\s/i.test(html)) return html
  return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${baseTag}`)
}

function toPreviewUrl(workspaceId: string, relativePath: string): string {
  return `teachos-preview://${encodeURIComponent(workspaceId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

function mimeTypeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8'
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

function isRegistryWorkspace(value: unknown): value is RegistryWorkspace {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.rootPath === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  )
}

function isLessonSummary(value: unknown): value is LessonSummary {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.objective === 'string' &&
    typeof record.prompt === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.durationMinutes === 'number' &&
    typeof record.relativePath === 'string' &&
    typeof record.absolutePath === 'string'
  )
}

const LESSON_CSS = `:root {
  color: #263044;
  background: #f3f5f8;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.75;
  --page-max: 920px;
  --ink: #172033;
  --muted: #5f6f86;
  --soft: #f7f9fc;
  --panel: #ffffff;
  --line: #dde5f0;
  --accent: #3468d8;
  --accent-soft: #eaf1ff;
  --green: #167a58;
  --green-soft: #eaf7f1;
  --amber: #a05f00;
  --amber-soft: #fff6df;
  --rose: #b23857;
  --rose-soft: #fff0f4;
  --shadow: 0 16px 40px rgba(23, 32, 51, 0.08);
}

* {
  box-sizing: border-box;
}

html {
  background: #f3f5f8;
}

body {
  min-height: 100vh;
  margin: 0;
  padding: 0 0 56px;
  color: var(--ink);
  background: #f3f5f8;
}

body > header,
body > main,
body > section,
body > article,
body > footer {
  width: min(calc(100% - 48px), var(--page-max));
  margin-right: auto;
  margin-left: auto;
}

.lesson-page {
  width: min(calc(100% - 48px), var(--page-max));
  max-width: none;
  margin: 0 auto;
  padding: 0;
}

body > header,
.lesson-hero {
  margin-top: 32px;
  margin-bottom: 28px;
  padding: 38px 42px 40px;
  color: #ffffff;
  border: 1px solid #202a3f;
  border-radius: 8px;
  background: #172033;
  box-shadow: var(--shadow);
}

.lesson-hero {
  border-bottom: 0;
}

.kicker,
body > header .kicker {
  margin: 0 0 10px;
  color: #96b7ff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  margin: 0;
  color: var(--ink);
  line-height: 1.22;
  letter-spacing: 0;
}

body > header h1,
.lesson-hero h1 {
  max-width: 760px;
  color: #ffffff;
  font-size: 40px;
  line-height: 1.16;
}

body > header p,
.lesson-hero p {
  max-width: 720px;
  margin: 14px 0 0;
  color: #d7e2f6;
  font-size: 17px;
}

.subtitle {
  color: #b8c9e8;
  font-weight: 700;
}

section,
article {
  margin-top: 24px;
}

section > h2,
.lesson-page > section > h2 {
  margin: 0 0 14px;
  padding-top: 10px;
  color: #1e2a3d;
  font-size: 24px;
}

h3 {
  font-size: 19px;
}

p,
li,
td,
th {
  color: var(--muted);
  font-size: 16px;
  line-height: 1.78;
}

p {
  margin: 10px 0;
}

strong {
  color: #1d293d;
  font-weight: 800;
}

a {
  color: #245fc8;
  text-decoration: none;
  border-bottom: 1px solid rgba(36, 95, 200, 0.28);
}

a:hover {
  color: #143f8f;
  border-bottom-color: currentColor;
}

ul,
ol {
  margin: 10px 0 0;
  padding-left: 1.35rem;
}

li + li {
  margin-top: 8px;
}

code {
  color: #20304a;
  border: 1px solid #d7e0ee;
  border-radius: 6px;
  background: #eef3fb;
  padding: 0.12em 0.38em;
  font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 0.92em;
}

pre {
  overflow: auto;
  margin: 14px 0 0;
  padding: 16px;
  color: #e8eef9;
  border-radius: 8px;
  background: #151d2c;
}

pre code {
  color: inherit;
  border: 0;
  background: transparent;
  padding: 0;
}

blockquote {
  margin: 16px 0 0;
  padding: 16px 18px;
  border-left: 4px solid var(--accent);
  border-radius: 0 8px 8px 0;
  background: var(--accent-soft);
}

blockquote p:first-child {
  margin-top: 0;
}

blockquote p:last-child {
  margin-bottom: 0;
}

hr {
  height: 1px;
  margin: 18px 0;
  border: 0;
  background: var(--line);
}

table {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 16px 0 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  border-spacing: 0;
  border-collapse: separate;
  background: var(--panel);
}

thead {
  background: #172033;
}

th,
td {
  min-width: 150px;
  padding: 12px 14px;
  text-align: left;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

th {
  color: #ffffff;
  font-weight: 800;
}

tr:last-child td {
  border-bottom: 0;
}

th:last-child,
td:last-child {
  border-right: 0;
}

tbody tr:nth-child(even) {
  background: #f8fafc;
}

.mission-card,
.qa-block,
.quiz-card,
.flashcard,
.summary,
.teachos-generated-quiz {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 10px 28px rgba(23, 32, 51, 0.06);
}

.mission-card {
  padding: 18px 20px;
  border-left: 4px solid var(--green);
}

.mission-card span,
.file-grid span {
  display: block;
  color: #748197;
  font-size: 12px;
  font-weight: 800;
}

.mission-card strong {
  display: block;
  margin-top: 6px;
  color: #20304a;
  font-size: 18px;
}

.mission-card p {
  margin-bottom: 0;
}

.qa-block {
  overflow: hidden;
}

.qa-block h3 {
  padding: 18px 22px;
  color: #172033;
  border-bottom: 1px solid var(--line);
  background: #fbfcff;
}

.answer {
  padding: 18px 22px 22px;
}

.answer > :first-child {
  margin-top: 0;
}

.answer > :last-child {
  margin-bottom: 0;
}

.tip {
  margin-top: 14px;
  padding: 13px 15px;
  color: #6f4300;
  border: 1px solid #f0d99b;
  border-left: 4px solid #d99016;
  border-radius: 8px;
  background: var(--amber-soft);
}

.tip strong {
  color: #5c3700;
}

.summary {
  padding: 22px;
  border-color: #cfd9e8;
  background: #fbfcff;
}

.summary h2 {
  padding-top: 0;
}

.summary blockquote {
  border-left-color: var(--green);
  background: var(--green-soft);
}

.steps,
.compact-list {
  display: grid;
  gap: 10px;
  padding: 0;
  list-style: none;
}

.steps li,
.compact-list li {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.steps li {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
}

.steps strong {
  color: #24324a;
}

.steps span {
  color: #65748a;
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.file-grid a {
  display: block;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.file-grid strong {
  display: block;
  margin-top: 6px;
  color: #25354f;
}

.practice,
.teachos-generated-quiz {
  margin-top: 28px;
}

.teachos-generated-quiz {
  padding: 20px;
}

.quiz-card {
  display: grid;
  gap: 12px;
  padding: 18px;
  box-shadow: none;
}

.quiz-card + .quiz-card {
  margin-top: 12px;
}

.quiz-card p {
  margin: 0;
}

.quiz-choices,
.quiz-fill {
  display: grid;
  gap: 8px;
}

.quiz-fill {
  grid-template-columns: minmax(0, 1fr) auto;
}

.quiz-card button,
.quiz-fill input {
  min-height: 40px;
  border: 1px solid #cfd9e8;
  border-radius: 8px;
  font: inherit;
}

.quiz-card button {
  background: #f8fafc;
  color: #2d3d56;
  cursor: pointer;
}

.quiz-card button:hover {
  background: #eef4ff;
}

.quiz-card button.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.quiz-card button.is-correct,
.quiz-fill input.is-correct {
  border-color: #68b692;
  background: var(--green-soft);
}

.quiz-card button.is-wrong,
.quiz-fill input.is-wrong {
  border-color: #e5a0af;
  background: var(--rose-soft);
}

.quiz-fill input {
  width: 100%;
  padding: 0 12px;
  color: var(--ink);
  background: #ffffff;
}

output {
  min-height: 24px;
  color: var(--green);
  font-weight: 800;
}

.quiz-explanation {
  display: none;
  margin: 0;
  color: #65748a;
  font-size: 14px;
}

footer,
body > footer {
  margin-top: 38px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

footer p {
  color: #65748a;
}

@media (max-width: 700px) {
  body {
    padding-bottom: 36px;
  }

  body > header,
  body > main,
  body > section,
  body > article,
  body > footer,
  .lesson-page {
    width: min(calc(100% - 28px), var(--page-max));
  }

  body > header,
  .lesson-hero {
    margin-top: 18px;
    padding: 28px 22px;
  }

  body > header h1,
  .lesson-hero h1 {
    font-size: 30px;
  }

  section > h2,
  .lesson-page > section > h2 {
    font-size: 21px;
  }

  .qa-block h3,
  .answer,
  .summary,
  .teachos-generated-quiz {
    padding-right: 16px;
    padding-left: 16px;
  }

  .file-grid,
  .quiz-fill {
    grid-template-columns: 1fr;
  }

  .steps li {
    grid-template-columns: 1fr;
  }
}
`
const QUIZ_JS = `function setupTeachOsQuizCards(root = document) {
  root.querySelectorAll('.quiz-card').forEach((card) => {
    if (card.dataset.quizReady === 'true') return;
    card.dataset.quizReady = 'true';

    const type = card.getAttribute('data-type') || 'single';
    const answer = card.getAttribute('data-answer') || '';
    const output = card.querySelector('output');
    const explanation = card.querySelector('.quiz-explanation');
    const report = (correct, msg) => {
      if (output) output.textContent = msg;
      if (explanation) explanation.style.display = correct ? 'block' : 'none';
      try {
        window.parent.postMessage({
          source: 'teachos-lesson',
          kind: 'quiz',
          question: card.querySelector('p')?.textContent || '',
          correct
        }, '*');
      } catch {}
    };

    if (type === 'fill') {
      const input = card.querySelector('input[type="text"]');
      const submit = card.querySelector('button[data-choice="submit"]');
      const normalize = (s) => s.trim().toLowerCase().replace(/\\s+/g, ' ').replace(/[。.,，！!？?]/g, '');
      const check = () => {
        const value = input?.value || '';
        const isCorrect = Boolean(value.trim()) && normalize(value) === normalize(answer);
        if (input) {
          input.classList.toggle('is-correct', isCorrect);
          input.classList.toggle('is-wrong', !isCorrect && value.trim().length > 0);
        }
        report(isCorrect, isCorrect ? '正确！' : '再想想，或查看解析。');
      };
      submit?.addEventListener('click', check);
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') check();
      });
      return;
    }

    const answers = type === 'multi' ? answer.split(',').map((s) => s.trim()) : [answer];
    card.querySelectorAll('button[data-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        if (type === 'multi') {
          button.classList.toggle('is-selected');
          const selected = Array.from(card.querySelectorAll('button[data-choice].is-selected'))
            .map((b) => b.getAttribute('data-choice'));
          const isCorrect = selected.length === answers.length &&
            selected.every((c) => answers.includes(c)) &&
            answers.every((c) => selected.includes(c));
          report(isCorrect, isCorrect ? '全部正确！' : '选择还不完整或不正确，再看看。');
        } else {
          card.querySelectorAll('button[data-choice]').forEach((item) => item.classList.remove('is-correct', 'is-wrong'));
          const isCorrect = button.getAttribute('data-choice') === answer;
          button.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
          report(isCorrect, isCorrect ? '正确！' : '再试一次。');
        }
      });
    });
  });
}

function appendFillQuizCard(container, item, index) {
  const card = document.createElement('article');
  card.className = 'quiz-card';
  card.dataset.type = 'fill';
  card.dataset.answer = String(item.answer ?? '');

  const question = document.createElement('p');
  question.textContent = \`\${index + 1}. \${String(item.question ?? '请作答')}\`;

  const fill = document.createElement('div');
  fill.className = 'quiz-fill';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '输入你的答案';
  input.setAttribute('aria-label', '答案输入');

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.choice = 'submit';
  button.textContent = '提交';

  const output = document.createElement('output');
  output.setAttribute('aria-live', 'polite');

  const explanation = document.createElement('p');
  explanation.className = 'quiz-explanation';
  explanation.textContent = item.explanation ? String(item.explanation) : \`参考答案：\${String(item.answer ?? '')}\`;

  fill.append(input, button);
  card.append(question, fill, output, explanation);
  container.append(card);
}

window.Quiz = class Quiz {
  constructor(items = [], options = {}) {
    const mount = typeof options.mount === 'string' ? document.querySelector(options.mount) : options.mount;
    const section = mount || document.createElement('section');
    section.classList.add('practice', 'teachos-generated-quiz');

    if (!mount) {
      const title = document.createElement('h2');
      title.textContent = options.title || '小测验';
      section.append(title);
    }

    items.forEach((item, index) => appendFillQuizCard(section, item, index));

    if (!mount) {
      const anchor = document.currentScript;
      if (anchor?.parentNode) anchor.parentNode.insertBefore(section, anchor);
      else document.body.append(section);
    }

    setupTeachOsQuizCards(section);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setupTeachOsQuizCards());
} else {
  setupTeachOsQuizCards();
}
`

const FLASHCARD_CSS = `.flashcards { display: grid; gap: 12px; }
.flashcard { position: relative; min-height: 120px; perspective: 1000px; cursor: pointer; border: 1px solid #e3e8f2; border-radius: 12px; background: #fff; }
.flashcard-face { display: grid; place-items: center; padding: 22px; text-align: center; backface-visibility: hidden; }
.flashcard-front { color: #24324a; font-weight: 600; }
.flashcard-back { position: absolute; inset: 0; transform: rotateY(180deg); color: #536278; background: #f8fafc; border-radius: 12px; }
.flashcard.is-flipped .flashcard-front { opacity: 0; }
.flashcard.is-flipped .flashcard-back { transform: rotateY(0deg); }
.flashcard-self { display: flex; gap: 8px; margin-top: 10px; justify-content: center; }
.flashcard-self button { border: 1px solid #dfe7f4; border-radius: 8px; background: #f8fafc; color: #2d3d56; font: inherit; padding: 6px 12px; cursor: pointer; }
.flashcard-self button:hover { background: #eef4ff; }
.quiz-choices { display: grid; gap: 8px; }
.quiz-choices button.is-selected { border-color: #4f7cf5; background: #edf4ff; }
.quiz-fill { display: flex; gap: 8px; }
.quiz-fill input { flex: 1; min-height: 40px; border: 1px solid #dfe7f4; border-radius: 8px; padding: 0 12px; font: inherit; }
.quiz-fill input.is-correct { border-color: #68b692; background: #eaf8f2; }
.quiz-fill input.is-wrong { border-color: #e5a0af; background: #fff0f4; }
.quiz-explanation { display: none; margin: 6px 0 0; color: #65748a; font-size: 14px; }
`

const FLASHCARD_JS = `document.querySelectorAll('.flashcard').forEach((card) => {
  const flip = () => card.classList.toggle('is-flipped');
  card.addEventListener('click', flip);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  card.querySelectorAll('.flashcard-self button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.parent.postMessage({ source: 'teachos-lesson', kind: 'flashcard', rating: btn.getAttribute('data-rating') }, '*'); } catch {}
    });
  });
});
`
