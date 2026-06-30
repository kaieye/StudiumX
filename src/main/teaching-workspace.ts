import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultSettings } from './teaching-settings'
import { callProvider, streamProvider, resolveActiveProvider, ProviderAdapterError, type AdapterCallbacks } from './ai/provider-adapter'
import { buildLessonSystemPrompt, buildLessonUserPrompt } from './ai/lesson-prompts'
import {
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan,
  renderLearningRecordFromPlan
} from './ai/lesson-renderer'
import { lessonPlanSchema, sanitizePlan, type LessonPlan, type LessonPlanSource } from '../shared/lesson-schema'
import type {
  CreateWorkspacePayload,
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
  RecordProgressPayload,
  ResourceSummary,
  ReviewCard,
  TeachingAppState,
  TeachingRuntimeState,
  TeachingSettingsV1,
  TeachingWorkspaceSummary,
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

type WorkspaceIndex = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  lessons: LessonSummary[]
}

type SessionEvent = {
  id: string
  kind: 'workspace_created' | 'workspace_imported' | 'mission_updated' | 'lesson_generated'
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
  private readonly defaultRoot: string
  private readonly settingsProvider?: () => Promise<TeachingSettingsV1>

  constructor(options: {
    registryPath: string
    defaultRoot: string
    settingsProvider?: () => Promise<TeachingSettingsV1>
  }) {
    this.registryPath = options.registryPath
    this.defaultRoot = options.defaultRoot
    this.settingsProvider = options.settingsProvider
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
  ): Promise<{ state: TeachingAppState; lesson: LessonSummary; source: LessonPlanSource; reason?: string }> {
    return this.runLessonGeneration(payload, stream)
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
      prompt,
      settings,
      sequence,
      callbacks
    })

    const title = clampTitle(plan.title)
    const objective = cleanText(plan.objective) || `把「${deriveTopic(prompt, mission.title)}」压缩成一次可保存、可复习的学习动作。`
    const filename = `${lessonId}-${slugify(title, 'lesson')}.html`
    const relativePath = workspaceRelativePath('lessons', filename)
    const absolutePath = join(workspace.rootPath, 'lessons', filename)
    const referenceRelativePath = settings.generator.generateReference
      ? workspaceRelativePath('reference', `${lessonId}-${slugify(title, 'reference')}.html`)
      : null
    const referenceAbsolutePath = referenceRelativePath ? join(workspace.rootPath, referenceRelativePath) : null
    const recordRelativePath = settings.generator.generateLearningRecord
      ? workspaceRelativePath('learning-records', `${lessonId}-${slugify(title, 'lesson')}.md`)
      : null
    const recordAbsolutePath = recordRelativePath ? join(workspace.rootPath, recordRelativePath) : null
    const reviewsRelativePath = plan.flashcards.length
      ? workspaceRelativePath('reviews', `${lessonId}-${slugify(title, 'flashcards')}.json`)
      : null
    const reviewsAbsolutePath = reviewsRelativePath ? join(workspace.rootPath, reviewsRelativePath) : null

    const lesson: LessonSummary = {
      id: lessonId,
      title,
      objective,
      prompt,
      createdAt: now,
      durationMinutes: plan.durationMinutes || settings.generator.lessonDurationMinutes,
      relativePath,
      absolutePath
    }

    if (stream) stream.onStatus({ streamId: stream.streamId, step: 'rendering' })
    await this.writeLessonArtifacts({
      plan,
      lesson,
      mission,
      workspaceName: workspace.name,
      recordRelativePath,
      recordAbsolutePath,
      referenceRelativePath,
      referenceAbsolutePath,
      reviewsRelativePath,
      reviewsAbsolutePath,
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
      prompt,
      paths: [relativePath, referenceRelativePath, recordRelativePath, reviewsRelativePath].filter((path): path is string => Boolean(path)),
      meta: { source, reason, model: settings.generator.model || undefined }
    })

    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    if (stream) stream.onStatus({ streamId: stream.streamId, step: 'done' })
    return {
      state: await this.buildState(nextRegistry, workspace.id, absolutePath),
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
    callbacks: AdapterCallbacks
  }): Promise<{ plan: LessonPlan; source: LessonPlanSource; reason?: string }> {
    const { workspace, mission, prompt, settings, sequence, callbacks } = opts
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
      generator: settings.generator
    })
    const userPrompt = buildLessonUserPrompt({ prompt, sequence, missionTitle: mission.title })

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

  /**
   * Aggregate flashcards from every lesson's review file (and from lesson
   * metadata) for the review deck.
   */
  async listReviewCards(workspaceId: string): Promise<ListReviewCardsResult> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    const dir = join(workspace.rootPath, 'reviews')
    const files = await readdir(dir).catch(() => [])
    const cards: ReviewCard[] = []
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.json')) continue
      const content = await readFile(join(dir, file), 'utf8').catch(() => '')
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

  async readLesson(payload: ReadLessonPayload): Promise<{ html: string }> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    const target = resolveLessonPath(workspace.rootPath, payload.lessonPath)
    return { html: withPreviewBase(await readFile(target, 'utf8'), target) }
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
      previewHtml,
      selectedLessonPath: lessonPath,
      runtime
    }
  }

  private async summarizeWorkspace(workspace: RegistryWorkspace): Promise<TeachingWorkspaceSummary> {
    await this.ensureWorkspaceStructure(workspace)
    const mission = await this.readMissionSummary(workspace.rootPath, workspace.name)
    const index = await this.loadWorkspaceIndex(workspace)
    const lessons = await this.mergeLessonIndexWithDisk(workspace.rootPath, index.lessons)
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
      recordsDir: join(workspace.rootPath, 'learning-records'),
      referenceDir: join(workspace.rootPath, 'reference'),
      reviewsDir: join(workspace.rootPath, 'reviews'),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      missionTitle: mission.title,
      missionExcerpt: mission.excerpt,
      resources: await this.readResourceSummary(workspace.rootPath),
      records: await this.readLearningRecords(workspace.rootPath),
      lessons,
      referenceCount: await countFiles(join(workspace.rootPath, 'reference'), '.html'),
      assetsReady: await fileExists(join(workspace.rootPath, 'assets', 'lesson.css'))
    }
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
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons.filter(isLessonSummary) : []
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

  private async nextLessonNumber(rootPath: string, lessons: LessonSummary[]): Promise<number> {
    const fromIndex = lessons.map((lesson) => Number.parseInt(lesson.id, 10)).filter(Number.isFinite)
    const fromDisk = await readdir(join(rootPath, 'lessons'))
      .then((files) => files.map((file) => Number.parseInt(file.slice(0, 4), 10)).filter(Number.isFinite))
      .catch(() => [])
    return Math.max(0, ...fromIndex, ...fromDisk) + 1
  }

  private async mergeLessonIndexWithDisk(rootPath: string, indexedLessons: LessonSummary[]): Promise<LessonSummary[]> {
    const indexedByPath = new Map(indexedLessons.map((lesson) => [resolve(lesson.absolutePath).toLowerCase(), lesson]))
    const files = await readdir(join(rootPath, 'lessons')).catch(() => [])
    return files
      .filter((file) => file.toLowerCase().endsWith('.html'))
      .map((file) => {
        const absolutePath = join(rootPath, 'lessons', file)
        const existing = indexedByPath.get(resolve(absolutePath).toLowerCase())
        if (existing) return existing
        const idMatch = /^(\d{4})-/.exec(file)
        return {
          id: idMatch?.[1] ?? '0000',
          title: titleFromFilename(file),
          objective: '从本地 lesson 文件恢复的课程。',
          prompt: '',
          createdAt: new Date(0).toISOString(),
          durationMinutes: 12,
          relativePath: workspaceRelativePath('lessons', file),
          absolutePath
        } satisfies LessonSummary
      })
      .sort((a, b) => b.id.localeCompare(a.id))
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
    const dir = join(rootPath, 'learning-records')
    const files = await readdir(dir).catch(() => [])
    return Promise.all(
      files
        .filter((file) => file.toLowerCase().endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 8)
        .map(async (file) => {
          const absolutePath = join(dir, file)
          const content = await readFile(absolutePath, 'utf8').catch(() => '')
          const info = await stat(absolutePath).catch(() => null)
          return {
            title: cleanText(/^#\s+(.+)$/m.exec(content)?.[1] ?? titleFromFilename(file)),
            date: formatDate(info?.mtime ?? new Date()),
            relativePath: workspaceRelativePath('learning-records', file),
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
  const lessonsRoot = resolve(rootPath, 'lessons')
  if (!isInside(lessonsRoot, target)) {
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

function adapterReason(error: ProviderAdapterError): string {
  switch (error.kind) {
    case 'no_api_key':
      return '未配置 API Key'
    case 'network':
      return '网络错误'
    case 'http':
      return `Provider 错误：${error.message}`
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
        body: '- [MISSION.md](../MISSION.md) — 学习罗盘\n- [RESOURCES.md](../RESOURCES.md) — 可信来源\n- reference/*.html — 速查材料\n- learning-records/*.md — 学习证据'
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
    referenceNotes: '先写 mission，再决定第一课；课程输出到 lessons/*.html；非显而易见的理解写入 learning-records/*.md。',
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
    <p>点击生成按钮后，第一节静态 HTML lesson 会保存到 lessons/ 并在这里预览。</p>
  </main>
</body>
</html>`
}

function withPreviewBase(html: string, filePath: string): string {
  const baseTag = `<base href="${pathToFileURL(filePath).href}" />`
  if (/<base\s/i.test(html)) return html
  return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${baseTag}`)
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
