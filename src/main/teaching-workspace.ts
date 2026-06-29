import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  CreateWorkspacePayload,
  GenerateLessonPayload,
  GenerateLessonResult,
  LessonSummary,
  ReadLessonPayload,
  ResourceSummary,
  TeachingAppState,
  TeachingRuntimeState,
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

  constructor(options: { registryPath: string; defaultRoot: string }) {
    this.registryPath = options.registryPath
    this.defaultRoot = options.defaultRoot
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
    const prompt = cleanText(payload.prompt)
    if (!prompt) throw new Error('Lesson prompt is required.')

    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, payload.workspaceId)
    await this.ensureWorkspaceStructure(workspace)

    const now = new Date().toISOString()
    const index = await this.loadWorkspaceIndex(workspace)
    const sequence = await this.nextLessonNumber(workspace.rootPath, index.lessons)
    const lessonId = String(sequence).padStart(4, '0')
    const mission = await this.readMissionSummary(workspace.rootPath, workspace.name)
    const title = sequence === 1 ? '写出可执行的学习使命' : deriveLessonTitle(prompt, sequence)
    const objective = `把「${deriveTopic(prompt, mission.title)}」压缩成一次可保存、可复习的学习动作。`
    const filename = `${lessonId}-${slugify(title, 'lesson')}.html`
    const relativePath = workspaceRelativePath('lessons', filename)
    const absolutePath = join(workspace.rootPath, 'lessons', filename)
    const referenceRelativePath = workspaceRelativePath('reference', `${lessonId}-${slugify(title, 'reference')}.html`)
    const referenceAbsolutePath = join(workspace.rootPath, 'reference', `${lessonId}-${slugify(title, 'reference')}.html`)
    const recordRelativePath = workspaceRelativePath('learning-records', `${lessonId}-${slugify(title, 'lesson')}.md`)
    const recordAbsolutePath = join(workspace.rootPath, 'learning-records', `${lessonId}-${slugify(title, 'lesson')}.md`)

    const lesson: LessonSummary = {
      id: lessonId,
      title,
      objective,
      prompt,
      createdAt: now,
      durationMinutes: sequence === 1 ? 12 : 15,
      relativePath,
      absolutePath
    }

    await mkdir(dirname(absolutePath), { recursive: true })
    await mkdir(dirname(referenceAbsolutePath), { recursive: true })
    await mkdir(dirname(recordAbsolutePath), { recursive: true })
    await writeFile(
      absolutePath,
      renderLessonHtml({ lesson, mission, workspaceName: workspace.name, recordRelativePath, referenceRelativePath }),
      'utf8'
    )
    await writeFile(referenceAbsolutePath, renderReferenceHtml({ lesson, mission, workspaceName: workspace.name }), 'utf8')
    await writeFile(recordAbsolutePath, renderLearningRecord({ lesson, mission }), 'utf8')

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
      paths: [relativePath, referenceRelativePath, recordRelativePath]
    })

    const nextRegistry = touchRegistryWorkspace(registry, workspace.id, now)
    await this.saveRegistry(nextRegistry)
    return {
      state: await this.buildState(nextRegistry, workspace.id, absolutePath),
      lesson
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

    return {
      workspaces: summaries,
      activeWorkspace,
      previewHtml,
      selectedLessonPath: lessonPath,
      runtime: DEFAULT_RUNTIME
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
      mkdir(join(workspace.rootPath, 'assets'), { recursive: true }),
      mkdir(join(workspace.rootPath, '.teachos'), { recursive: true })
    ])
    await writeIfMissing(join(workspace.rootPath, 'assets', 'lesson.css'), LESSON_CSS)
    await writeIfMissing(join(workspace.rootPath, 'assets', 'quiz.js'), QUIZ_JS)
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
    await mkdir(this.defaultRoot, { recursive: true })
    const base = slugify(name, 'workspace')
    let candidate = join(this.defaultRoot, base)
    let suffix = 2
    while (await directoryExists(candidate)) {
      candidate = join(this.defaultRoot, `${base}-${suffix}`)
      suffix += 1
    }
    return candidate
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

function renderLessonHtml(options: {
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
  workspaceName: string
  recordRelativePath: string
  referenceRelativePath: string
}): string {
  const { lesson, mission, workspaceName, recordRelativePath, referenceRelativePath } = options
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(lesson.title)} · ${escapeHtml(workspaceName)}</title>
  <link rel="stylesheet" href="../assets/lesson.css" />
</head>
<body>
  <main class="lesson-page">
    <header class="lesson-hero">
      <p class="kicker">Lesson ${escapeHtml(lesson.id)} · ${escapeHtml(String(lesson.durationMinutes))} min</p>
      <h1>${escapeHtml(lesson.title)}</h1>
      <p>${escapeHtml(lesson.objective)}</p>
    </header>

    <section class="mission-card">
      <span>Mission</span>
      <strong>${escapeHtml(mission.title)}</strong>
      <p>${escapeHtml(mission.excerpt)}</p>
    </section>

    <section>
      <h2>这节课完成什么</h2>
      <p>先把输入的学习愿望整理成一个小闭环：使命、可信资源、可复习 lesson、learning record。这个闭环比一次性聊天更有价值，因为它能在文件系统里持续演进。</p>
      <ol class="steps">
        <li><strong>使命</strong><span>说明为什么学，以及成功是什么样子。</span></li>
        <li><strong>课程</strong><span>只教一个足够小的动作，并保存为静态 HTML。</span></li>
        <li><strong>记录</strong><span>把已经建立的理解写入 learning-records，供下次生成使用。</span></li>
      </ol>
    </section>

    <section>
      <h2>把任务拆成文件</h2>
      <div class="file-grid">
        <a href="../MISSION.md"><span>MISSION.md</span><strong>学习罗盘</strong></a>
        <a href="../RESOURCES.md"><span>RESOURCES.md</span><strong>可信来源</strong></a>
        <a href="../${escapeHtml(referenceRelativePath)}"><span>reference</span><strong>速查材料</strong></a>
        <a href="../${escapeHtml(recordRelativePath)}"><span>records</span><strong>学习证据</strong></a>
      </div>
    </section>

    <section class="practice">
      <h2>检索练习</h2>
      <article class="quiz-card" data-answer="b">
        <p>TeachOS 里最应该长期保存的真相来源是什么？</p>
        <button type="button" data-choice="a">运行时内存状态</button>
        <button type="button" data-choice="b">工作区文件资产</button>
        <button type="button" data-choice="c">单次聊天窗口</button>
        <output aria-live="polite"></output>
      </article>
    </section>

    <footer>
      <p>下一步：把不清楚的地方继续问教学助手，并把新的理解沉淀成 learning record。</p>
    </footer>
  </main>
  <script src="../assets/quiz.js"></script>
</body>
</html>
`
}

function renderReferenceHtml(options: {
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
  workspaceName: string
}): string {
  const { lesson, mission, workspaceName } = options
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(lesson.title)} Reference · ${escapeHtml(workspaceName)}</title>
  <link rel="stylesheet" href="../assets/lesson.css" />
</head>
<body>
  <main class="lesson-page reference-page">
    <header class="lesson-hero">
      <p class="kicker">Reference · Lesson ${escapeHtml(lesson.id)}</p>
      <h1>${escapeHtml(lesson.title)} 速查</h1>
      <p>${escapeHtml(mission.title)}：${escapeHtml(mission.excerpt)}</p>
    </header>
    <section>
      <h2>最小闭环</h2>
      <ul class="compact-list">
        <li>先写 mission，再决定第一课。</li>
        <li>课程输出到 lessons/*.html，样式复用 assets/lesson.css。</li>
        <li>非显而易见的理解写入 learning-records/*.md。</li>
        <li>资源索引只保留高信任来源。</li>
      </ul>
    </section>
  </main>
</body>
</html>
`
}

function renderLearningRecord(options: {
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
}): string {
  const { lesson, mission } = options
  return `# ${lesson.title}

本节课建立了一个可复用的 TeachOS 学习闭环：从「${mission.title}」出发，把任务保存为 mission、lesson、reference 和 learning record。以后生成课程时，应继续优先维护这些文件资产，而不是只依赖一次性聊天上下文。
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
  const answer = card.getAttribute('data-answer');
  const output = card.querySelector('output');
  card.querySelectorAll('button[data-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      card.querySelectorAll('button[data-choice]').forEach((item) => {
        item.classList.remove('is-correct', 'is-wrong');
      });
      const isCorrect = button.getAttribute('data-choice') === answer;
      button.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
      if (output) {
        output.textContent = isCorrect
          ? '正确：TeachOS 的长期资产是本地工作区文件。'
          : '再试一次：想想哪些内容能脱离 App 长期保存。';
      }
    });
  });
});
`
