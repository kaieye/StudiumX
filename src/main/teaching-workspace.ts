import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { defaultSettings } from './teaching-settings'
import { TeachingMemoryStore } from './teaching-memory'
import { inspectGitWorkspace } from './teaching-git'
import { callProvider, streamProvider, resolveActiveProvider, ProviderAdapterError, toolsSupportedForFormat, type AdapterCallbacks, type ChatMessage } from './ai/provider-adapter'
import { runAgentLoop } from './ai/agent-loop'
import { buildDefaultRegistry, buildToolContext, ToolRegistry } from './ai/tools/registry'
import { buildLessonSystemPrompt, buildLessonUserPrompt } from './ai/lesson-prompts'
import {
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan,
  renderLearningRecordFromPlan
} from './ai/lesson-renderer'
import { lessonPlanSchema, sanitizePlan, type LessonPlan, type LessonPlanSource } from '../shared/lesson-schema'
import { assessTeachingReadiness, isContinuationLessonRequest } from '../shared/teaching-workflow'
import {
  buildLearnerMemoryCandidate,
  buildMemoryConsentPrompt,
  classifyMemoryConsentResponse,
  extractPendingLearnerMemoryCandidate,
  isBareMemoryConsentResponse,
  isLearnerProfileMemory,
  planLearnerMemoryCapture
} from '../shared/teaching-memory-capture'
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
  AgentChatMode,
  ReadAgentConversationPayload,
  SaveAgentConversationPayload,
  SaveAgentConversationResult,
  TeachingMemoryDiagnostics,
  TeachingMemoryRecord,
  TeachingMemoryCaptureResult,
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
  UpdateTeachingMemoryPayload,
  UpdateMissionPayload
} from '../shared/teaching-types'

type RegistryWorkspace = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
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
      { includeRoot: true, includeLessons: false, includeCourses: false }
    )
    const legacyWorkspaceConversations = (await Promise.all(
      registry.workspaces.map(async (workspace) => {
        const index = await this.loadWorkspaceIndex(workspace).catch(() => ({ pathMeta: {} }) as WorkspaceIndex)
        return listAgentConversations(
          workspace.rootPath,
          index.pathMeta ?? {},
          { includeRoot: true, includeLessons: false, includeCourses: false, fallbackWorkspaceId: workspace.id }
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
      const nextRegistry = { ...registry, activeWorkspaceId: existing.id }
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
      onChunk: (chunk: AgentChatStreamChunk) => void
      onStatus: (status: AgentChatStreamStatus) => void
      onTool: (event: AgentChatStreamToolEvent) => void
    }
  ): Promise<AgentChatStreamResult> {
    const userInput = payload.userInput.trim()
    if (!userInput) {
      return { error: true, message: '消息不能为空。' }
    }
    const settings = await this.loadSettings()
    const provider = resolveActiveProvider(settings)

    const registryState = payload.workspaceId ? await this.ensureRegistry() : null
    const workspace = payload.workspaceId && registryState
      ? findWorkspace(registryState, payload.workspaceId)
      : null
    const isTeachingConversation = (payload.mode ?? 'teaching') === 'teaching'
    const chatMode: AgentChatMode = isTeachingConversation ? 'teaching' : 'temporary'
    const workspaceRoot = isTeachingConversation ? workspace?.rootPath : undefined
    const memoryWorkspaceRoot = workspace?.rootPath
    const existingMemories = await this.memoryStore.list(memoryWorkspaceRoot)
    const pendingMemoryCandidate = extractPendingLearnerMemoryCandidate(
      latestAssistantContent(payload.messages ?? [])
    )
    const directConsentOnly = pendingMemoryCandidate && isBareMemoryConsentResponse(userInput)
    const consentDecision = directConsentOnly ? classifyMemoryConsentResponse(userInput) : null
    if (memoryWorkspaceRoot && pendingMemoryCandidate && consentDecision) {
      if (consentDecision === 'approve') {
        const memory = await this.memoryStore.create({
          content: pendingMemoryCandidate.content,
          scope: 'user',
          tags: pendingMemoryCandidate.tags,
          confidence: pendingMemoryCandidate.confidence,
          workspaceRoot: memoryWorkspaceRoot
        })
        const finalText = '已记录到用户记忆。后续课程会把这条信息作为长期背景使用。'
        const turns = directAgentTurns(payload.messages ?? [], userInput, finalText)
        return {
          turns,
          finalText,
          iterations: 0,
          toolsSupported: false,
          memoryCapture: {
            action: 'approved',
            candidateContent: pendingMemoryCandidate.content,
            memoryId: memory.id
          }
        }
      }
      const finalText = '好的，这条信息不会记录到用户记忆。'
      const turns = directAgentTurns(payload.messages ?? [], userInput, finalText)
      return {
        turns,
        finalText,
        iterations: 0,
        toolsSupported: false,
        memoryCapture: {
          action: 'rejected',
          candidateContent: pendingMemoryCandidate.content
        }
      }
    }
    const teachingAssessment = isTeachingConversation && workspace
      ? await this.assessTeachingRequest({
          workspace,
          userInput,
          messages: payload.messages ?? []
        })
      : null

    if (!provider || !provider.apiKey.trim()) {
      return { error: true, message: '未配置 API Key。' }
    }

    const ctx = buildToolContext(settings, { workspaceRoot })
    const registry = settings.tools.enabled && isTeachingConversation
      ? buildDefaultRegistry(settings, { workspaceRoot })
      : new ToolRegistry()

    const priorMessages: ChatMessage[] = (payload.messages ?? []).map(toChatMessage)
    const teachSkillReference = isTeachingConversation ? await readTeachSkillReference(workspaceRoot) : null
    const capturePlan = settings.memory.enabled && memoryWorkspaceRoot && !directConsentOnly
      ? planLearnerMemoryCapture(buildLearnerMemoryCandidate(userInput), existingMemories)
      : ({ action: 'none', reason: 'no_candidate' } as const)
    const temporaryContext = chatMode === 'temporary' && workspace
      ? await this.buildTemporaryChatContext(workspace, existingMemories)
      : null
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildAgentChatSystemPrompt({
          mode: isTeachingConversation ? 'teaching' : 'temporary',
          teachingAssessment,
          teachSkillReference,
          memoryCapturePlan: capturePlan,
          settings,
          provider,
          temporaryContext
        })
      },
      ...priorMessages.filter((m) => m.role !== 'system'),
      { role: 'user', content: userInput }
    ]

    const result = await runAgentLoop({
      settings,
      provider,
      messages,
      tools: registry.definitions(),
      toolHandlers: registry.handlerMap(ctx),
      maxIterations: settings.tools.maxIterations,
      callbacks: {
        onEvent: (e) => {
          const streamId = stream.streamId
          if (e.type === 'status') {
            stream.onStatus({ streamId, status: e.status, message: e.message })
          } else if (e.type === 'token') {
            stream.onChunk({ streamId, delta: e.delta })
          } else if (e.type === 'tool_call') {
            stream.onTool({
              streamId,
              toolCall: { id: e.toolCall.id, name: e.toolCall.function.name, arguments: e.toolCall.function.arguments }
            })
          } else if (e.type === 'tool_result') {
            stream.onTool({
              streamId,
              toolCall: { id: e.toolCallId, name: e.name, arguments: '' },
              result: e.result,
              isError: e.isError
            })
          }
        }
      }
    })

    if (result.error) {
      return { error: true, message: result.error }
    }
    let finalText = result.finalText
    let messagesWithMemory = result.messages
    let memoryCapture: TeachingMemoryCaptureResult | undefined
    if (memoryWorkspaceRoot && capturePlan.action === 'create') {
      const memory = await this.memoryStore.create({
        content: capturePlan.candidate.content,
        scope: 'user',
        tags: capturePlan.candidate.tags,
        confidence: capturePlan.candidate.confidence,
        workspaceRoot: memoryWorkspaceRoot
      })
      memoryCapture = {
        action: 'created',
        candidateContent: capturePlan.candidate.content,
        memoryId: memory.id
      }
    } else if (capturePlan.action === 'request_consent') {
      const consentPrompt = buildMemoryConsentPrompt(capturePlan.candidate)
      finalText = `${finalText}${consentPrompt}`
      messagesWithMemory = appendToLastAssistantMessage(result.messages, consentPrompt)
      stream.onChunk({ streamId: stream.streamId, delta: consentPrompt })
      memoryCapture = {
        action: 'requested_consent',
        candidateContent: capturePlan.candidate.content
      }
    }
    return {
      turns: toAgentTurns(messagesWithMemory),
      finalText,
      iterations: result.iterations,
      toolsSupported: result.toolsSupported,
      degradedReason: result.degradedReason,
      teachingAssessment: teachingAssessment ?? undefined,
      memoryCapture
    }
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
    if (!relativePath) throw new Error('relativePath is required.')
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
    if (!isInside(workspace.rootPath, absolutePath)) {
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
    const nextPathMeta = payload.kind === 'directory' && relativePath === 'lessons'
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
    const sessionRelativePath = courseRelativePath
    const sessionAbsolutePath = join(options.workspace.rootPath, sessionRelativePath)
    const fileSlug = slugify(options.title, 'lesson')
    const lessonRelativePath = workspaceRelativePath(courseRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}.html`)
    const lessonAbsolutePath = join(options.workspace.rootPath, lessonRelativePath)
    const referenceRelativePath = options.includeReference
      ? workspaceRelativePath(courseRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}-reference.html`)
      : null
    const recordRelativePath = options.includeLearningRecord
      ? workspaceRelativePath(courseRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}.md`)
      : null
    const reviewsRelativePath = options.includeReviews
      ? workspaceRelativePath(courseRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}-flashcards.json`)
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
    if (!allowedRoots.some((base) => isInside(base, target))) return null
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
      const activeWorkspaceId = existing.some((item) => item.id === registry.activeWorkspaceId)
        ? registry.activeWorkspaceId
        : existing[0]!.id
      const nextRegistry = { activeWorkspaceId, workspaces: existing }
      if (nextRegistry.workspaces.length !== registry.workspaces.length || nextRegistry.activeWorkspaceId !== registry.activeWorkspaceId) {
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
    const summaries = await Promise.all(registry.workspaces.map((workspace) => this.summarizeWorkspace(workspace)))
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
    await this.ensureWorkspaceStructure(workspace)
    const mission = await this.readMissionSummary(workspace.rootPath, workspace.name)
    const index = await this.loadWorkspaceIndex(workspace)
    const pathMeta = index.pathMeta ?? {}
    const lessons = await this.mergeLessonIndexWithDisk(workspace.rootPath, workspace.name, index.lessons, pathMeta)
    const conversations = await listAgentConversations(workspace.rootPath, pathMeta)
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

  private async ensureWorkspaceStructure(workspace: RegistryWorkspace): Promise<void> {
    await mkdir(workspace.rootPath, { recursive: true })
    await Promise.all([
      mkdir(join(workspace.rootPath, 'lessons'), { recursive: true }),
      mkdir(join(workspace.rootPath, 'reference'), { recursive: true }),
      mkdir(join(workspace.rootPath, 'learning-records'), { recursive: true }),
      mkdir(join(workspace.rootPath, 'reviews'), { recursive: true }),
      mkdir(join(workspace.rootPath, 'conversations'), { recursive: true }),
      mkdir(join(workspace.rootPath, 'assets'), { recursive: true }),
      mkdir(join(workspace.rootPath, '.teachos'), { recursive: true })
    ])
    await writeIfMissing(join(workspace.rootPath, 'assets', 'lesson.css'), LESSON_CSS)
    await writeIfMissing(join(workspace.rootPath, 'assets', 'quiz.js'), QUIZ_JS)
    await writeIfMissing(join(workspace.rootPath, 'assets', 'flashcards.css'), FLASHCARD_CSS)
    await writeIfMissing(join(workspace.rootPath, 'assets', 'flashcards.js'), FLASHCARD_JS)
    await writeIfMissing(join(workspace.rootPath, 'RESOURCES.md'), renderResources(workspace.name))
    await writeIfMissing(join(workspace.rootPath, 'MISSION.md'), renderMission(workspace.name, `学习 ${workspace.name}`))
  }

  private async loadRegistry(): Promise<WorkspaceRegistry> {
    try {
      const parsed = JSON.parse(await readFile(this.registryPath, 'utf8')) as WorkspaceRegistry
      if (!Array.isArray(parsed.workspaces)) return EMPTY_REGISTRY
      return {
        activeWorkspaceId: typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : null,
        workspaces: parsed.workspaces.filter(isRegistryWorkspace).map((workspace) => ({
          ...workspace,
          rootPath: resolve(workspace.rootPath)
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
      (file) => file.toLowerCase().endsWith('.md') && !basename(file).startsWith('MISSION') && !basename(file).startsWith('RESOURCES')
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
  return { activeWorkspaceId, workspaces: [entry, ...others] }
}

function touchRegistryWorkspace(
  registry: WorkspaceRegistry,
  workspaceId: string,
  updatedAt: string
): WorkspaceRegistry {
  return {
    activeWorkspaceId: workspaceId,
    workspaces: registry.workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, updatedAt } : workspace
    )
  }
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
  if (!allowedRoots.some((base) => isInside(base, target))) {
    throw new Error('Lesson path is outside the workspace lessons directory.')
  }
  return target
}

function isInside(rootPath: string, targetPath: string): boolean {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
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
  if (normalizedDir === 'conversations' && name.toLowerCase().endsWith('.json')) return true
  if (normalizedDir === 'lessons/conversations' && name.toLowerCase().endsWith('.json')) return true
  if (normalizedDir.startsWith('courses/') && normalizedDir.endsWith('/conversations') && name.toLowerCase().endsWith('.json')) return true
  return false
}

async function listAgentConversations(
  rootPath: string,
  pathMeta: Record<string, WorkspacePathMeta> = {},
  options: {
    includeRoot?: boolean
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
  if (!isInside(rootPath, jsonPath)) throw new Error('Conversation path is outside the workspace.')
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
  options: { includeRoot?: boolean; includeLessons?: boolean; includeCourses?: boolean } = {}
): Promise<string[]> {
  const includeRoot = options.includeRoot ?? true
  const includeLessons = options.includeLessons ?? true
  const includeCourses = options.includeCourses ?? true
  const result: string[] = []
  if (includeRoot) {
    const rootEntries = await readdir(join(rootPath, 'conversations'), { withFileTypes: true }).catch(() => [])
    for (const entry of rootEntries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        result.push(workspaceRelativePath('conversations', entry.name))
      }
    }
  }
  if (includeLessons) {
    const lessonEntries = await readdir(join(rootPath, 'lessons', 'conversations'), { withFileTypes: true }).catch(() => [])
    for (const entry of lessonEntries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        result.push(workspaceRelativePath('lessons', 'conversations', entry.name))
      }
    }
  }
  if (!includeCourses) return result
  const courseEntries = await readdir(join(rootPath, 'courses'), { withFileTypes: true }).catch(() => [])
  for (const courseEntry of courseEntries) {
    if (!courseEntry.isDirectory()) continue
    const conversationEntries = await readdir(join(rootPath, 'courses', courseEntry.name, 'conversations'), { withFileTypes: true }).catch(() => [])
    for (const entry of conversationEntries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        result.push(workspaceRelativePath('courses', courseEntry.name, 'conversations', entry.name))
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

function agentConversationDirectoryRelativePath(payload: SaveAgentConversationPayload): string {
  const selected = normalizeWorkspaceRelativePath(payload.selectedCourseRelativePath ?? '')
  if (selected && isCourseRelativePath(selected)) {
    return workspaceRelativePath(selected, 'conversations')
  }

  const lessonPath = normalizeWorkspaceRelativePath(payload.selectedLessonPath ?? '')
  const lessonCourse = courseRelativePathFromWorkspacePath(lessonPath)
  if (lessonCourse) return workspaceRelativePath(lessonCourse, 'conversations')

  if (payload.mode === 'teaching') return workspaceRelativePath('lessons', 'conversations')

  return 'conversations'
}

function courseRelativePathFromWorkspacePath(relativePath: string): string | null {
  const parts = normalizeWorkspaceRelativePath(relativePath).split('/').filter(Boolean)
  if (parts[0] === 'lessons') return 'lessons'
  if (parts[0] === 'courses' && parts[1]) return workspaceRelativePath('courses', parts[1])
  return null
}

function courseRelativePathFromConversationPath(relativePath: string): string | null {
  const parts = normalizeWorkspaceRelativePath(relativePath).split('/').filter(Boolean)
  if (parts.length === 3 && parts[0] === 'lessons' && parts[1] === 'conversations') return 'lessons'
  if (parts.length === 4 && parts[0] === 'courses' && parts[2] === 'conversations') return workspaceRelativePath('courses', parts[1])
  return null
}

function isCourseRelativePath(relativePath: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  return normalized === 'lessons' || /^courses\/[^/]+$/.test(normalized)
}

function agentConversationJsonRelativePath(id: string, conversationDir = 'conversations'): string {
  return workspaceRelativePath(normalizeAgentConversationDirectory(conversationDir), `${id}.json`)
}

function agentConversationJsonRelativePathForMarkdown(markdownRelativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(markdownRelativePath)
  if (!isAgentConversationMarkdownRelativePath(normalized)) {
    throw new Error('Conversation path is outside a conversations directory.')
  }
  return workspaceRelativePath(dirname(normalized).replace(/\\/g, '/'), `${basename(normalized).replace(/\.md$/i, '')}.json`)
}

function isAgentConversationJsonRelativePath(relativePath: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  if (!normalized.toLowerCase().endsWith('.json')) return false
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 2 && parts[0] === 'conversations') return true
  if (parts.length === 3 && parts[0] === 'lessons' && parts[1] === 'conversations') return true
  return parts.length === 4 && parts[0] === 'courses' && parts[2] === 'conversations'
}

function isAgentConversationMarkdownRelativePath(relativePath: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  if (!normalized.toLowerCase().endsWith('.md')) return false
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 2 && parts[0] === 'conversations') return true
  if (parts.length === 3 && parts[0] === 'lessons' && parts[1] === 'conversations') return true
  return parts.length === 4 && parts[0] === 'courses' && parts[2] === 'conversations'
}

function isRootAgentConversationMarkdownRelativePath(relativePath: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  if (!normalized.toLowerCase().endsWith('.md')) return false
  const parts = normalized.split('/').filter(Boolean)
  return parts.length === 2 && parts[0] === 'conversations'
}

function agentConversationMarkdownRelativePath(id: string, conversationDir = 'conversations'): string {
  return workspaceRelativePath(normalizeAgentConversationDirectory(conversationDir), `${id}.md`)
}

function normalizeAgentConversationDirectory(conversationDir: string): string {
  const normalized = normalizeWorkspaceRelativePath(conversationDir)
  if (!normalized || normalized === 'conversations') return 'conversations'
  if (normalized === 'lessons/conversations') return normalized
  if (/^courses\/[^/]+\/conversations$/.test(normalized)) return normalized
  return 'conversations'
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
  '在生成课程计划之前，你可以调用工作区只读工具读取 MISSION.md、RESOURCES.md、courses、reference 和 learning-records 中的上下文；' +
  '也可以调用 web_search 工具检索最新或课程之外的事实性信息以丰富内容（例如最新版本号、时效性事件、权威定义）。' +
  '完成必要的检索后，仍必须严格只输出一个符合下方格式的 JSON 课程计划对象，不要输出任何额外说明或 markdown 围栏。'

const AGENT_CHAT_SYSTEM_PROMPT =
  '你是 TeachOS 的学习助手。' +
  '用户进入“教学”对话时，等价于在发送真实需求的同时引用了 teach skill：把它当作教学工作区方法论和可用上下文，而不是必须照本宣科的固定流程。' +
  '保持主动判断：可以先回答、先澄清、读取工作区、建议下一步或生成课程计划；只有在学习者基础/身份、目标、约束或第一步动作确实会影响教学质量时，才问 1 到 3 个具体问题。' +
  '不要默认用户属于编程、AI、学生或任何固定人群；问题示例必须跟随用户当前主题、身份和场景。' +
  '回答使用简洁、准确的中文。' +
  '当用户询问当前教学工作区、mission、resources、课程文件、参考资料或学习记录时，优先调用 list_workspace、read_workspace_file、search_workspace 或 glob_workspace 读取本地文件后再回答；' +
  '当问题涉及时效性、最新动态或课程库之外的事实性信息时，调用 web_search 工具检索后再作答；' +
  '必要时可用 web_fetch 深入阅读某条结果。回答中适度引用信息来源链接。' +
  '若未配置工具或当前模型不支持工具调用，直接依据自身知识作答即可。'

const TEMPORARY_AGENT_CHAT_SYSTEM_PROMPT =
  '你是 TeachOS 的临时会话助手。' +
  '回答使用简洁、准确的中文。' +
  '当前不会提供工作区文件访问，也不会提供教学工作区工具；不要声称自己查看了本地文件、课程正文、mission、resources 或学习记录。' +
  '当用户询问现有课程时，只能基于已注入的课程概览回答；当用户要基于具体工作区文件继续学习时，提示其切换到教学对话。'

type TeachSkillReference = {
  source: string
  content: string
}

type TemporaryChatContext = {
  learnerProfiles: string[]
  courses: Array<{ name: string; lessonCount: number; sessionCount: number }>
}

async function readTeachSkillReference(workspaceRoot?: string): Promise<TeachSkillReference | null> {
  const candidates = [
    workspaceRoot ? join(workspaceRoot, 'teach', 'SKILL.md') : '',
    join(process.cwd(), 'teach', 'SKILL.md')
  ].filter(Boolean)
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const resolved = resolve(candidate)
    const key = resolved.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const content = cleanText(await readFile(resolved, 'utf8').catch(() => ''))
    if (content) return { source: resolved, content }
  }
  return null
}

function buildAgentChatSystemPrompt(options: {
  mode: AgentChatMode
  teachingAssessment: TeachingClarificationResult | null
  teachSkillReference: TeachSkillReference | null
  memoryCapturePlan?: ReturnType<typeof planLearnerMemoryCapture>
  settings?: TeachingSettingsV1
  provider?: ReturnType<typeof resolveActiveProvider>
  temporaryContext?: TemporaryChatContext | null
}): string {
  const {
    mode,
    teachingAssessment,
    teachSkillReference,
    memoryCapturePlan = { action: 'none', reason: 'no_candidate' },
    settings,
    provider,
    temporaryContext
  } = options
  const skillReference = teachSkillReference
    ? [
        `<teach-skill-reference source="${escapePromptAttribute(teachSkillReference.source)}">`,
        'The teach skill has been automatically loaded for this turn. Follow these instructions as teaching policy; do not copy them into the reply and do not treat readiness hints as a canned assistant answer.',
        formatTeachSkillForPrompt(teachSkillReference.content),
        '</teach-skill-reference>'
      ].join('\n')
    : [
        '<teach-skill-reference source="fallback">',
        'The user has referenced the teach skill in addition to their visible message. Use it as progressive, on-demand guidance: default to the one-line intent here, and consult workspace files/tools only when they are useful.',
        'Core intent: teach within this workspace, ground lessons in MISSION.md / RESOURCES.md / learning-records, keep lessons focused and reviewable, and prefer retrieval practice when designing exercises.',
        'Do not treat the local assessment below as a prewritten assistant reply. It is only a hint for your own judgment.',
        '</teach-skill-reference>'
      ].join('\n')

  const memoryLines = buildMemoryCapturePromptLines(memoryCapturePlan)
  const runtimeLines = buildModelRuntimePromptLines(settings, provider)
  const modeLines = mode === 'temporary'
    ? buildTemporaryChatPromptLines(temporaryContext)
    : ''

  if (mode === 'temporary') {
    return `${TEMPORARY_AGENT_CHAT_SYSTEM_PROMPT}${modeLines ? `\n\n${modeLines}` : ''}${runtimeLines ? `\n\n${runtimeLines}` : ''}${memoryLines ? `\n\n${memoryLines}` : ''}`
  }

  if (!teachingAssessment) {
    return `${AGENT_CHAT_SYSTEM_PROMPT}\n\n${skillReference}${modeLines ? `\n\n${modeLines}` : ''}${runtimeLines ? `\n\n${runtimeLines}` : ''}${memoryLines ? `\n\n${memoryLines}` : ''}`
  }

  const assessmentLines = [
    '<teaching-readiness-hints>',
    `stage: ${teachingAssessment.stage}`,
    teachingAssessment.summary ? `summary: ${teachingAssessment.summary}` : '',
    teachingAssessment.missingSignals.length
      ? `missingSignals: ${teachingAssessment.missingSignals.join(', ')}`
      : 'missingSignals: none',
    teachingAssessment.openQuestions.length
      ? `possibleQuestions: ${teachingAssessment.openQuestions.slice(0, 3).join(' | ')}`
      : '',
    '</teaching-readiness-hints>'
  ].filter(Boolean)

  return `${AGENT_CHAT_SYSTEM_PROMPT}\n\n${skillReference}${modeLines ? `\n\n${modeLines}` : ''}\n\n${assessmentLines.join('\n')}${runtimeLines ? `\n\n${runtimeLines}` : ''}${memoryLines ? `\n\n${memoryLines}` : ''}`
}

function buildTemporaryChatPromptLines(context?: TemporaryChatContext | null): string {
  const learnerProfiles = context?.learnerProfiles ?? []
  const courses = context?.courses ?? []
  const profileLines = learnerProfiles.length
    ? learnerProfiles.map((line, index) => `${index + 1}. ${line}`).join('\n')
    : 'none'
  const courseLines = courses.length
    ? courses.map((course, index) => `${index + 1}. ${course.name} (${course.lessonCount} lessons, ${course.sessionCount} sessions)`).join('\n')
    : 'none'
  return [
    '<temporary-chat-context>',
    '当前是临时会话，不是教学对话。不要查看、列出、读取、搜索或推断工作区文件内容；不要声称已经检查了 MISSION.md、RESOURCES.md、lessons、courses、reference 或 learning-records。',
    '你只能使用下方已注入的学习者画像和课程概览作为本地上下文；如果用户想基于工作区文件学习，提示其切换到教学对话。',
    '<learner-profiles>',
    profileLines,
    '</learner-profiles>',
    '<course-overview>',
    courseLines,
    '</course-overview>',
    '</temporary-chat-context>'
  ].join('\n')
}

function buildModelRuntimePromptLines(
  settings?: TeachingSettingsV1,
  provider?: ReturnType<typeof resolveActiveProvider>
): string {
  if (!settings) return ''
  const providerName = cleanText(provider?.name) || '未配置'
  const model = cleanText(settings.generator.model) || '未选择'
  return [
    '<model-runtime>',
    `configuredProvider: ${providerName}`,
    `configuredModelId: ${model}`,
    `endpointFormat: ${settings.generator.endpointFormat}`,
    '如果用户询问你是什么模型、由谁提供或当前使用哪个模型，回答必须基于这些运行时配置；不要根据训练数据、接口兼容格式或上游服务名称推断身份。',
    '</model-runtime>'
  ].join('\n')
}

function buildMemoryCapturePromptLines(memoryCapturePlan: ReturnType<typeof planLearnerMemoryCapture>): string {
  if (memoryCapturePlan.action === 'create') {
    return [
      '<memory-capture-policy>',
      '系统将在本轮回复后首次自动记录这条用户画像到 user memory；你不需要征求同意，也不要声称自己手动写入了记忆。',
      `pendingMemory: ${memoryCapturePlan.candidate.content}`,
      '</memory-capture-policy>'
    ].join('\n')
  }
  if (memoryCapturePlan.action === 'request_consent') {
    return [
      '<memory-capture-policy>',
      '本应用已经有用户画像记忆。若要新增或更新类似长期记忆，必须先请求用户同意。',
      '系统会在本轮回复后追加固定确认问题；你不要自己重复询问，也不要声称已经记录。',
      `pendingMemory: ${memoryCapturePlan.candidate.content}`,
      '</memory-capture-policy>'
    ].join('\n')
  }
  return ''
}

function formatTeachSkillForPrompt(content: string): string {
  const withoutFrontmatter = stripFrontmatter(content)
  const maxLength = 14_000
  if (withoutFrontmatter.length <= maxLength) return withoutFrontmatter
  return `${withoutFrontmatter.slice(0, maxLength).trim()}\n\n[teach skill truncated for prompt length]`
}

function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized.startsWith('---\n')) return normalized
  const end = normalized.indexOf('\n---', 4)
  return end >= 0 ? normalized.slice(end + 4).trim() : normalized
}

function escapePromptAttribute(value: string): string {
  return value.replace(/"/g, "'")
}

function toChatMessage(m: AgentChatMessage): ChatMessage {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content ?? '' }
  }
  if (m.role === 'assistant') {
    const toolCalls =
      m.toolCalls && m.toolCalls.length > 0
        ? m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments }
          }))
        : undefined
    return { role: 'assistant', content: m.content, tool_calls: toolCalls }
  }
  if (m.role === 'user') return { role: 'user', content: m.content ?? '' }
  return { role: 'system', content: m.content ?? '' }
}

function toAgentTurns(messages: ChatMessage[]): AgentChatTurn[] {
  const turns: AgentChatTurn[] = []
  let counter = 0
  const createdAt = new Date().toISOString()
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ id: `t${counter++}`, role: 'user', content: m.content ?? '', createdAt })
    } else if (m.role === 'assistant') {
      const toolCalls = m.tool_calls?.map((tc) => {
        const resultMsg = messages.find(
          (x) => x.role === 'tool' && x.tool_call_id === tc.id
        )
        const content = resultMsg ? resultMsg.content : undefined
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          result: content ?? undefined,
          isError: content ? /\berror\b/i.test(content) : undefined
        }
      })
      turns.push({
        id: `t${counter++}`,
        role: 'assistant',
        content: m.content ?? '',
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        createdAt
      })
    }
  }
  return turns
}

function latestAssistantContent(messages: AgentChatMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? ''
}

function directAgentTurns(messages: AgentChatMessage[], userInput: string, assistantText: string): AgentChatTurn[] {
  const createdAt = new Date().toISOString()
  const prior = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message, index): AgentChatTurn => ({
      id: `t${index}`,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content ?? '',
      createdAt
    }))
  return [
    ...prior,
    { id: `t${prior.length}`, role: 'user', content: userInput, createdAt },
    { id: `t${prior.length + 1}`, role: 'assistant', content: assistantText, createdAt }
  ]
}

function appendToLastAssistantMessage(messages: ChatMessage[], extra: string): ChatMessage[] {
  const next = [...messages]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index]
    if (message?.role === 'assistant') {
      next[index] = { ...message, content: `${message.content ?? ''}${extra}` }
      return next
    }
  }
  return [...next, { role: 'assistant', content: extra }]
}

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
        body: '- [MISSION.md](../MISSION.md) — 学习罗盘\n- [RESOURCES.md](../RESOURCES.md) — 可信来源\n- lessons/*.html — 课程讲义与速查材料\n- lessons/*.md — 学习证据'
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
    referenceNotes: '先写 mission，再决定第一课；课程输出到 lessons/*.html；非显而易见的理解写入同名 lesson 记录文件。',
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
  color: #24324a;
  background: #f7f8fb;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; }
.lesson-page { max-width: 820px; margin: 0 auto; padding: 46px 28px 64px; }
.lesson-hero { margin-bottom: 30px; padding-bottom: 24px; border-bottom: 1px solid #e3e8f2; }
.kicker { margin: 0 0 10px; color: #4f7cf5; font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
h1 { margin: 0; color: #162033; font-size: 38px; line-height: 1.14; letter-spacing: 0; }
h2 { margin: 34px 0 12px; color: #1f2d44; font-size: 22px; letter-spacing: 0; }
p, li { color: #536278; font-size: 16px; line-height: 1.75; }
a { color: inherit; text-decoration: none; }
.mission-card { padding: 18px; border: 1px solid #dfe7f4; border-radius: 8px; background: #fff; }
.mission-card span, .file-grid span { display: block; color: #8b98aa; font-size: 12px; font-weight: 800; }
.mission-card strong { display: block; margin-top: 6px; color: #20304a; font-size: 18px; }
.steps { display: grid; gap: 10px; padding: 0; list-style: none; }
.steps li, .file-grid a, .quiz-card, .compact-list li { border: 1px solid #e3e8f2; border-radius: 8px; background: #fff; }
.steps li { display: grid; grid-template-columns: 90px 1fr; gap: 12px; padding: 14px 16px; }
.steps strong { color: #24324a; }
.steps span { color: #65748a; }
.file-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.file-grid a { display: block; padding: 16px; }
.file-grid strong { display: block; margin-top: 6px; color: #25354f; }
.practice { margin-top: 8px; }
.quiz-card { display: grid; gap: 10px; padding: 18px; }
.quiz-card p { margin: 0 0 4px; }
.quiz-card button { min-height: 40px; border: 1px solid #dfe7f4; border-radius: 8px; background: #f8fafc; color: #2d3d56; font: inherit; cursor: pointer; }
.quiz-card button:hover { background: #eef4ff; }
.quiz-card button.is-correct { border-color: #68b692; background: #eaf8f2; }
.quiz-card button.is-wrong { border-color: #e5a0af; background: #fff0f4; }
output { min-height: 24px; color: #2f9b73; font-weight: 700; }
footer { margin-top: 38px; padding-top: 18px; border-top: 1px solid #e3e8f2; }
.compact-list { display: grid; gap: 10px; padding: 0; list-style: none; }
.compact-list li { padding: 12px 14px; }
@media (max-width: 640px) {
  .lesson-page { padding: 30px 18px 48px; }
  h1 { font-size: 30px; }
  .file-grid { grid-template-columns: 1fr; }
  .steps li { grid-template-columns: 1fr; }
}
`

const QUIZ_JS = `document.querySelectorAll('.quiz-card').forEach((card) => {
  const type = card.getAttribute('data-type') || 'single';
  const answer = card.getAttribute('data-answer') || '';
  const output = card.querySelector('output');
  const explanation = card.querySelector('.quiz-explanation');
  const report = (correct, msg) => {
    if (output) output.textContent = msg;
    if (explanation) explanation.style.display = correct ? 'block' : 'none';
    // Notify the TeachOS host so progress can be recorded.
    try { window.parent.postMessage({ source: 'teachos-lesson', kind: 'quiz', question: card.querySelector('p')?.textContent || '', correct }, '*'); } catch {}
  };

  if (type === 'fill') {
    const input = card.querySelector('input[type="text"]');
    const submit = card.querySelector('button[data-choice="submit"]');
    const normalize = (s) => s.trim().toLowerCase().replace(/\\s+/g, ' ').replace(/[。.,，！!？?]/g, '');
    const check = () => {
      const value = input?.value || '';
      const isCorrect = Boolean(value.trim()) && normalize(value) === normalize(answer);
      if (input) input.classList.toggle('is-correct', isCorrect), input.classList.toggle('is-wrong', !isCorrect && value.trim().length > 0);
      report(isCorrect, isCorrect ? '正确！' : '再想想，或查看解析。');
    };
    submit?.addEventListener('click', check);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    return;
  }

  const answers = type === 'multi' ? answer.split(',').map((s) => s.trim()) : [answer];
  card.querySelectorAll('button[data-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      if (type === 'multi') {
        button.classList.toggle('is-selected');
        const selected = Array.from(card.querySelectorAll('button[data-choice].is-selected')).map((b) => b.getAttribute('data-choice'));
        const isCorrect = selected.length === answers.length && selected.every((c) => answers.includes(c)) && answers.every((c) => selected.includes(c));
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
