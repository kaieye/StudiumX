import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { defaultSettings } from './teaching-settings'
import { TeachingMemoryStore } from './teaching-memory'
import { inspectGitWorkspace } from './teaching-git'
import { isPathInsideRoot } from './path-access'
import {
  buildCourseSummaries,
  buildWorkspaceCatalog,
  normalizeLessonSummary,
  readMissionSummary
} from './teaching-workspace-catalog'
import { runLessonGenerationPipeline, type LessonGenerationCallbacks } from './teaching-lesson-generation'
import {
  cleanText,
  collectTeachingFiles,
  directoryExists,
  fileExists,
  isPathArchived,
  normalizePathMeta,
  normalizeWorkspaceRelativePath,
  pathRemovedByWorkspaceItem,
  prunePathMeta,
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
import { runTeachingConversationTurn, type TemporaryChatContext } from './teaching-conversation-runtime'
import type { LessonPlanSource } from '../shared/lesson-schema'
import { assessTeachingReadiness } from '../shared/teaching-workflow'
import {
  isLearnerProfileMemory
} from '../shared/teaching-memory-capture'
import {
  agentConversationDirectoryRelativePath,
  agentConversationJsonRelativePath,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationMarkdownRelativePath,
  isRootAgentConversationMarkdownRelativePath,
  normalizeAgentConversationDirectory
} from '../shared/agent-conversation-catalog'
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
  ReviewCard,
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
  TeachingMemoryDiagnostics,
  TeachingMemoryRecord,
  TeachingClarificationResult,
  TeachingAppState,
  TeachingRuntimeState,
  TeachingSettingsV1,
  TeachingWorkspaceSummary,
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
    await this.ensureWorkspaceStructure(workspace)

    const settings = await this.loadSettings()
    const now = new Date().toISOString()
    const index = await this.loadWorkspaceIndex(workspace)
    const callbacks: LessonGenerationCallbacks = {
      onToken: (delta) => {
        if (stream) stream.onChunk({ streamId: stream.streamId, delta })
      },
      onStatus: (step) => {
        if (stream) stream.onStatus({ streamId: stream.streamId, step })
      }
    }

    const generation = await runLessonGenerationPipeline({
      workspace,
      settings,
      lessons: index.lessons,
      prompt,
      requestedCourseName: payload.courseName,
      messages: payload.messages ?? [],
      now,
      retrieveMemories: (query) => this.memoryStore.retrieve(query),
      callbacks
    })

    if (generation.kind === 'clarification') {
      if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
      return {
        kind: 'clarification',
        state: await this.buildState(registry, workspace.id, null),
        clarification: generation.clarification
      }
    }

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

    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
    return {
      kind: 'lesson',
      state: await this.buildState(nextRegistry, workspace.id, generation.lesson.absolutePath),
      lesson: generation.lesson,
      source: generation.source,
      reason: generation.reason
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
    const mission = await readMissionSummary(options.workspace.rootPath, options.workspace.name)
    return assessTeachingReadiness({
      userInput: options.userInput,
      messages: options.messages,
      missionTitle: mission.title,
      missionExcerpt: mission.excerpt
    })
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
