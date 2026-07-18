import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  LESSON_FLASHCARD_CSS,
  LESSON_FLASHCARD_JS,
  LESSON_QUIZ_JS,
  lessonStyleCss,
  normalizeLessonStyleId
} from '../../shared/lesson-styles'
import type { LessonPlanSource } from '../../shared/lesson-schema'
import { normalizeTraceId } from '../../shared/trace-context'
import { LEARNING_SESSIONS_ROOT_RELATIVE_PATH } from '../../shared/teaching-placement'
import type { LessonSummary, TeachingSettingsV1, WorkspaceItemKind } from '../../shared/teaching-types'
import { normalizeLessonSummary } from '../teaching-workspace-catalog'
import {
  cleanText,
  fileExists,
  isPathArchived,
  normalizePathMeta,
  normalizeWorkspaceRelativePath,
  type WorkspacePathMeta
} from '../teaching-workspace-paths'
import type { RegistryWorkspace } from './registry'
import { appendDurableJsonlLine, readDurableJsonlLines } from '../durable-jsonl'
import { readValidatedWithBackup, replaceWithBackup } from '../persistence/durable-file'

export type WorkspaceIndex = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  lessons: LessonSummary[]
  pathMeta?: Record<string, WorkspacePathMeta>
}

export type WorkspaceLifecycleEvent = {
  id: string
  kind: 'workspace_created' | 'workspace_imported' | 'mission_updated' | 'lesson_generated' | 'lesson_style_applied' | 'agent_conversation_recorded'
  timestamp: string
  workspaceId: string
  /** Opaque diagnostic correlation metadata; never participates in lifecycle identity or filtering. */
  traceId?: string
  prompt?: string
  paths?: string[]
  meta?: { source?: LessonPlanSource; reason?: string; model?: string; styleId?: string }
}

/** @deprecated Use WorkspaceLifecycleEvent. This is not a teaching Session evidence event. */
export type SessionEvent = WorkspaceLifecycleEvent

const WORKSPACE_SCAFFOLD_DIRECTORIES = new Set([
  'lessons',
  'conversation',
  'reference',
  'learning-records',
  'reviews',
  'assets',
  LEARNING_SESSIONS_ROOT_RELATIVE_PATH
])

const WORKSPACE_SCAFFOLD_FILES = new Set([
  'MISSION.md',
  'RESOURCES.md',
  'GLOSSARY.md',
  'NOTES.md',
  'assets/lesson.css',
  'assets/quiz.js',
  'assets/flashcards.css',
  'assets/flashcards.js'
])

export async function ensureWorkspaceStructure(
  workspace: RegistryWorkspace,
  options: {
    pathMeta?: Record<string, WorkspacePathMeta>
    loadSettings: () => Promise<TeachingSettingsV1>
  }
): Promise<void> {
  const effectivePathMeta = options.pathMeta ?? (await loadWorkspaceIndex(workspace).then((index) => index.pathMeta ?? {}).catch(() => ({})))
  await mkdir(workspace.rootPath, { recursive: true })
  await Promise.all([
    ...Array.from(WORKSPACE_SCAFFOLD_DIRECTORIES)
      .filter((relativePath) => !isPathArchived(effectivePathMeta, relativePath))
      .map((relativePath) => mkdir(join(workspace.rootPath, relativePath), { recursive: true })),
    mkdir(join(workspace.rootPath, '.studiumx'), { recursive: true })
  ])
  const lessonStyleId = normalizeLessonStyleId(
    await options.loadSettings().then((settings) => settings.workspace.lessonStyleId).catch(() => undefined)
  )
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/lesson.css', lessonStyleCss(lessonStyleId))
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/quiz.js', LESSON_QUIZ_JS)
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/flashcards.css', LESSON_FLASHCARD_CSS)
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'assets/flashcards.js', LESSON_FLASHCARD_JS)
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'RESOURCES.md', renderResources(workspace.name))
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'GLOSSARY.md', renderGlossary())
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'NOTES.md', renderNotes())
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, effectivePathMeta, 'MISSION.md', renderMission(workspace.name, `学习 ${workspace.name}`))
}

export async function provisionWorkspaceMaterial(
  workspace: RegistryWorkspace,
  options: {
    pathMeta?: Record<string, WorkspacePathMeta>
    loadSettings: () => Promise<TeachingSettingsV1>
    topic: string
    prompt: string
  }
): Promise<void> {
  const pathMeta = options.pathMeta ?? {}
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, pathMeta, 'MISSION.md', renderMission(options.topic, options.prompt))
  await writeWorkspaceScaffoldFileIfMissing(workspace.rootPath, pathMeta, 'RESOURCES.md', renderResources(options.topic))
  await ensureWorkspaceStructure(workspace, {
    pathMeta,
    loadSettings: options.loadSettings
  })
}

export function deriveWorkspaceTopic(prompt: string, fallback: string): string {
  const cleaned = cleanText(prompt)
    .replace(/^我想(先)?学习/, '')
    .replace(/^学习/, '')
    .replace(/^如何/, '')
  const firstSentence = cleaned.split(/[。.!?？\n]/)[0]?.trim()
  const topic = firstSentence && firstSentence.length <= 34 ? firstSentence : firstSentence?.slice(0, 34)
  return topic || cleanText(fallback) || '学习任务'
}
export async function loadWorkspaceIndex(workspace: RegistryWorkspace): Promise<WorkspaceIndex> {
  const indexPath = join(workspace.rootPath, '.studiumx', 'index.json')
  const recovered = await readValidatedWithBackup({
    path: indexPath,
    validate: isWorkspaceIndexDocument
  })
  if (recovered.value) return normalizeWorkspaceIndex(workspace, recovered.value)

  const legacyIndexPath = join(workspace.rootPath, '.teachos', 'index.json')
  try {
    const parsed = JSON.parse(await readFile(legacyIndexPath, 'utf8')) as unknown
    return isWorkspaceIndexDocument(parsed)
      ? normalizeWorkspaceIndex(workspace, parsed)
      : emptyWorkspaceIndex(workspace)
  } catch (error) {
    if (isMissingFile(error) || error instanceof SyntaxError) return emptyWorkspaceIndex(workspace)
    throw error
  }
}

export async function saveWorkspaceIndex(rootPath: string, index: WorkspaceIndex): Promise<void> {
  await replaceWithBackup({
    path: join(rootPath, '.studiumx', 'index.json'),
    content: `${JSON.stringify(index, null, 2)}\n`,
    validate: isWorkspaceIndexDocument,
    mode: 0o600
  })
}

export const WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH = '.studiumx/sessions.jsonl'

export async function appendWorkspaceLifecycleEvent(rootPath: string, event: WorkspaceLifecycleEvent): Promise<void> {
  // Never spread the raw trace back into durable JSONL: it is diagnostic
  // metadata and may otherwise carry malformed or secret-like input.
  const { traceId: rawTraceId, ...eventWithoutTrace } = event
  const traceId = normalizeTraceId(rawTraceId)
  const persistedEvent: WorkspaceLifecycleEvent = {
    ...eventWithoutTrace,
    ...(traceId ? { traceId } : {})
  }
  await appendDurableJsonlLine({
    activePath: join(rootPath, WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH)
  }, JSON.stringify(persistedEvent))
}

/** Reads strict sealed lifecycle segments before the active lifecycle JSONL. */
export async function readWorkspaceLifecycleEventLines(rootPath: string): Promise<string[]> {
  return readDurableJsonlLines(join(rootPath, WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH))
}

/** Reads well-formed lifecycle events from all strict sealed and active segments. */
export async function readWorkspaceLifecycleEvents(rootPath: string): Promise<WorkspaceLifecycleEvent[]> {
  const lines = await readWorkspaceLifecycleEventLines(rootPath)
  return lines.flatMap((line) => {
    try {
      const value = JSON.parse(line)
      return isWorkspaceLifecycleEvent(value) ? [value] : []
    } catch {
      return []
    }
  })
}

/** @deprecated Use appendWorkspaceLifecycleEvent. This log does not contain teaching Session evidence. */
export async function appendSessionEvent(rootPath: string, event: SessionEvent): Promise<void> {
  await appendWorkspaceLifecycleEvent(rootPath, event)
}

/**
 * Best-effort compatibility helper for high-frequency/scaffold callers. It
 * uses temp-and-rename but intentionally does not fsync the file or directory;
 * durable state must call replaceDurably or replaceWithBackup explicitly.
 */
export async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, path)
}

export async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await fileExists(path)) return
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

export function isWorkspaceScaffoldPath(kind: WorkspaceItemKind, relativePath: string): boolean {
  const path = normalizeWorkspaceRelativePath(relativePath)
  if (!path) return false
  if (kind === 'directory') return WORKSPACE_SCAFFOLD_DIRECTORIES.has(path)
  if (kind === 'file') return WORKSPACE_SCAFFOLD_FILES.has(path)
  return false
}

export function renderMission(topic: string, prompt: string): string {
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

export function renderResources(topic: string): string {
  const safeTopic = cleanText(topic) || 'StudiumX'
  return `# ${safeTopic} Resources

## Knowledge

- Built-in skill: ~/.studiumx/skills/teach/SKILL.md
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

function renderGlossary(): string {
  return `# Glossary

本表记录已在本工作区确立的术语写法，供所有课程沿用。未触达的术语留空；每节课引入新术语后由教学对话增量补充（用 write_workspace_file 覆盖本文件，追加到对应分区）。

## 通用

- LLM：大语言模型
- Token：模型处理文本的最小单位
- Prompt：送给模型的输入
- Context window：模型一次能接收的最大 token 数

## 主题相关

_占位：本工作区学习主题涉及的核心术语会在对应课程触达后由对话补充到这里。_
`
}

function renderNotes(): string {
  return `# Notes

记录用户的学习偏好与工作备忘，供课程生成时参考。由教学对话维护：用户表达偏好或背景时，用 write_workspace_file（overwrite: true）增量更新本文件。

- 语言：中文讲解，专业术语保留英文
- 深度：暂未确认
- 其他：暂无
`
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

function normalizeWorkspaceIndex(workspace: RegistryWorkspace, parsed: WorkspaceIndex): WorkspaceIndex {
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
}

function emptyWorkspaceIndex(workspace: RegistryWorkspace): WorkspaceIndex {
  return {
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.rootPath,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    lessons: []
  }
}

function isWorkspaceIndexDocument(value: unknown): value is WorkspaceIndex {
  // Existing indexes are intentionally normalized tolerantly, but only a
  // top-level object is eligible to become a retained modern backup.
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
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

function isWorkspaceLifecycleEvent(value: unknown): value is WorkspaceLifecycleEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  return typeof event.id === 'string' &&
    typeof event.kind === 'string' &&
    typeof event.timestamp === 'string' &&
    typeof event.workspaceId === 'string'
}
