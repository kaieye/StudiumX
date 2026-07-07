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
import {
  LESSON_FLASHCARD_CSS,
  LESSON_FLASHCARD_JS,
  LESSON_QUIZ_JS,
  lessonStyleCss,
  normalizeLessonStyleId
} from '../shared/lesson-styles'
import type { LessonBrief } from '../shared/teaching-workflow'
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
import type {
  ApplyLessonStylePayload,
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
  kind: 'workspace_created' | 'workspace_imported' | 'mission_updated' | 'lesson_generated' | 'lesson_style_applied' | 'agent_conversation_recorded'
  timestamp: string
  workspaceId: string
  prompt?: string
  paths?: string[]
  meta?: { source?: LessonPlanSource; reason?: string; model?: string; styleId?: string }
}

const DEFAULT_RUNTIME: TeachingRuntimeState = {
  status: 'idle',
  currentStep: 'ready',
  queuedTasks: 0,
  providerLabel: 'Local structured generator'
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
    const isTeachingConversation = (payload.mode ?? 'teaching') === 'teaching'
    return runTeachingConversationTurn(payload, stream, workspace, {
      loadSettings: () => this.loadSettings(),
      listMemories: (workspaceRoot) => this.memoryStore.list(workspaceRoot),
      createMemory: (memoryPayload) => this.memoryStore.create(memoryPayload),
      generateLessonFromBrief: workspace && isTeachingConversation
        ? async (brief) => {
            const generation = await this.generateAndPersistLesson({
              workspace,
              prompt: brief.topic,
              brief,
              messages: [],
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
      callbacks
    })

    if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
    return {
      kind: 'lesson',
      state: await this.buildState(generation.registry, workspace.id, generation.lesson.absolutePath),
      lesson: generation.lesson,
      source: generation.source,
      reason: generation.reason
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
    callbacks?: LessonGenerationCallbacks
  }): Promise<{
    lesson: LessonSummary
    source: LessonPlanSource
    reason?: string
    registry: WorkspaceRegistry
  }> {
    const { workspace } = options
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

    const registry = await this.ensureRegistry()
    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    return {
      lesson: generation.lesson,
      source: generation.source,
      reason: generation.reason,
      registry: nextRegistry
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
    const lessonStyleId = normalizeLessonStyleId(
      await this.loadSettings().then((settings) => settings.workspace.lessonStyleId).catch(() => undefined)
    )
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/lesson.css', lessonStyleCss(lessonStyleId))
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/quiz.js', LESSON_QUIZ_JS)
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/flashcards.css', LESSON_FLASHCARD_CSS)
    await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/flashcards.js', LESSON_FLASHCARD_JS)
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

async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
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
