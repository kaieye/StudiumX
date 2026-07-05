import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { callProvider, ProviderAdapterError, resolveActiveProvider, streamProvider, toolsSupportedForFormat, type AdapterCallbacks } from './ai/provider-adapter'
import { runAgentLoop } from './ai/agent-loop'
import { buildDefaultRegistry, buildToolContext } from './ai/tools/registry'
import { buildLessonSystemPrompt, buildLessonUserPrompt, buildLessonRepairPrompt, type LessonPriorLesson, type LessonWorkspaceContext } from './ai/lesson-prompts'
import {
  renderLearningRecordFromPlan,
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan
} from './ai/lesson-renderer'
import { readMissionSummary } from './teaching-workspace-catalog'
import { clampTitle, cleanText, collectTeachingFiles, fileExists, slugify, workspaceRelativePath } from './teaching-workspace-paths'
import { lessonPlanSchema, sanitizePlan, type LessonPlan, type LessonPlanSource } from '../shared/lesson-schema'
import { classifyProviderError, providerErrorReason } from '../shared/provider-error'
import {
  buildLessonPromptFromBrief,
  buildLessonPromptWithConversation,
  type LessonBrief
} from '../shared/teaching-workflow'
import type {
  AgentChatMessage,
  LessonSummary,
  TeachingMemoryRecord,
  TeachingSettingsV1
} from '../shared/teaching-types'

export type LessonGenerationWorkspace = {
  id: string
  name: string
  rootPath: string
}

export type LessonGenerationCallbacks = AdapterCallbacks

export type LessonGenerationMemoryRetriever = (options: {
  query: string
  workspaceRoot: string
  limit: number
}) => Promise<TeachingMemoryRecord[]>

export type LessonGenerationResult = {
  kind: 'lesson'
  lesson: LessonSummary
  source: LessonPlanSource
  reason?: string
  eventPrompt: string
  eventPaths: string[]
  eventMeta: { source: LessonPlanSource; reason?: string; model?: string }
}

const MIN_LESSON_PLAN_OUTPUT_TOKENS = 8192

/**
 * Raised when the provider is configured but no valid LessonPlan could be
 * produced (even after repair / compact regeneration). Callers must NOT write anything to
 * disk in this case — surfacing the failure honestly beats persisting an
 * off-topic placeholder lesson.
 */
export class LessonGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LessonGenerationError'
  }
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

export async function runLessonGenerationPipeline(options: {
  workspace: LessonGenerationWorkspace
  settings: TeachingSettingsV1
  lessons: LessonSummary[]
  prompt: string
  /** Structured brief authored by the teaching conversation agent, if any. */
  brief?: LessonBrief
  requestedCourseName?: string
  messages: AgentChatMessage[]
  now: string
  retrieveMemories: LessonGenerationMemoryRetriever
  callbacks?: LessonGenerationCallbacks
}): Promise<LessonGenerationResult> {
  const {
    workspace,
    settings,
    lessons,
    prompt,
    brief,
    requestedCourseName,
    messages,
    now,
    retrieveMemories,
    callbacks
  } = options
  // One-time, idempotent: relocate legacy learning records left in lessons/
  // (pre-2026-07) into the scaffolded learning-records/ directory.
  await migrateLegacyLearningRecords(workspace.rootPath)
  const mission = await readMissionSummary(workspace.rootPath, workspace.name)
  const workspaceContext = await readWorkspaceContextSummary(workspace.rootPath)
  const glossaryAvailable = await fileExists(join(workspace.rootPath, 'GLOSSARY.md'))
  const conversationExcerpt = collectConversationExcerpt(messages)
  const priorLessons = buildPriorLessons(lessons)
  // The conversation agent owns the readiness judgment. A brief is the
  // preferred, structured hand-off; the direct entry falls back to the user's
  // verbatim prompt plus their own recent words — never extracted "signals".
  const lessonPrompt = brief
    ? buildLessonPromptFromBrief(brief)
    : buildLessonPromptWithConversation(prompt, messages)
  const sequence = await nextLessonNumber(workspace.rootPath, lessons)
  const lessonId = String(sequence).padStart(4, '0')
  const recalledMemories = await retrieveMemories({
    query: `${mission.title}\n${mission.excerpt}\n${lessonPrompt}`,
    workspaceRoot: workspace.rootPath,
    limit: settings.memory.maxInjected
  })
  const { plan, source, reason } = await produceLessonPlan({
    workspace,
    mission,
    prompt: lessonPrompt,
    settings,
    sequence,
    recalledMemories,
    priorLessons,
    conversationExcerpt,
    workspaceContext,
    callbacks: callbacks ?? {}
  })

  const title = clampTitle(plan.title)
  const objective = cleanText(plan.objective) || `把「${deriveTopic(lessonPrompt, mission.title)}」压缩成一次可保存、可复习的学习动作。`
  const artifacts = buildLessonArtifactPaths({
    workspace,
    sequence,
    title,
    requestedCourseName,
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

  callbacks?.onStatus?.('rendering')
  await writeLessonArtifacts({
    plan,
    lesson,
    mission,
    workspaceName: workspace.name,
    lessons,
    glossaryAvailable,
    recordRelativePath: artifacts.recordRelativePath,
    recordAbsolutePath: artifacts.recordAbsolutePath,
    referenceRelativePath: artifacts.referenceRelativePath,
    referenceAbsolutePath: artifacts.referenceAbsolutePath,
    reviewsRelativePath: artifacts.reviewsRelativePath,
    reviewsAbsolutePath: artifacts.reviewsAbsolutePath,
    generator: settings.generator
  })

  return {
    kind: 'lesson',
    lesson,
    source,
    reason,
    eventPrompt: lessonPrompt,
    eventPaths: [
      artifacts.lessonRelativePath,
      artifacts.referenceRelativePath,
      artifacts.recordRelativePath,
      artifacts.reviewsRelativePath
    ].filter((path): path is string => Boolean(path)),
    eventMeta: { source, reason, model: settings.generator.model || undefined }
  }
}

async function produceLessonPlan(opts: {
  workspace: LessonGenerationWorkspace
  mission: { title: string; excerpt: string }
  prompt: string
  settings: TeachingSettingsV1
  sequence: number
  recalledMemories: TeachingMemoryRecord[]
  priorLessons: LessonPriorLesson[]
  conversationExcerpt: string
  workspaceContext: LessonWorkspaceContext
  callbacks: AdapterCallbacks
}): Promise<{ plan: LessonPlan; source: LessonPlanSource; reason?: string }> {
  const { workspace, mission, prompt, settings, sequence, recalledMemories, priorLessons, conversationExcerpt, workspaceContext, callbacks } = opts
  const provider = resolveActiveProvider(settings)
  const generationSettings = withLessonPlanOutputBudget(settings)

  // The only legitimate fallback: no provider at all. Every other failure is
  // surfaced as an error instead of silently writing a templated lesson.
  if (!provider || !provider.apiKey.trim()) {
    return { plan: localFallbackPlan(prompt, mission, sequence, generationSettings), source: 'fallback', reason: '未配置 API Key' }
  }

  const systemPrompt = buildLessonSystemPrompt({
    missionTitle: mission.title,
    missionExcerpt: mission.excerpt,
    durationMinutes: generationSettings.generator.lessonDurationMinutes,
    includeRetrievalPractice: generationSettings.generator.includeRetrievalPractice,
    generateReference: generationSettings.generator.generateReference,
    generateLearningRecord: generationSettings.generator.generateLearningRecord,
    memories: recalledMemories,
    generator: generationSettings.generator,
    priorLessons,
    conversationExcerpt,
    workspaceContext
  })
  const userPrompt = buildLessonUserPrompt({
    prompt,
    sequence,
    missionTitle: mission.title,
    memories: recalledMemories
  })

  let rawOutput = ''
  let parseError = ''

  // Tool-augmented path: let the model inspect the workspace and/or research
  // before emitting the LessonPlan JSON. Only for chat_completions /
  // custom_endpoint formats. Transport errors fall through to single-shot.
  const useTools =
    generationSettings.tools.enabled &&
    toolsSupportedForFormat(generationSettings.generator.endpointFormat) &&
    buildDefaultRegistry(generationSettings, { workspaceRoot: workspace.rootPath }).definitions().length > 0
  if (useTools) {
    try {
      const researchSystemPrompt = `${LESSON_RESEARCH_PREFIX}\n\n${systemPrompt}`
      const ctx = buildToolContext(generationSettings, { workspaceRoot: workspace.rootPath })
      const registry = buildDefaultRegistry(generationSettings, { workspaceRoot: workspace.rootPath })
      const loopResult = await runAgentLoop({
        settings: generationSettings,
        provider,
        messages: [
          { role: 'system', content: researchSystemPrompt },
          { role: 'user', content: userPrompt }
        ],
        tools: registry.definitions(),
        toolHandlers: registry.handlerMap(ctx),
        maxIterations: generationSettings.tools.maxIterations,
        jsonMode: true,
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
      const parsed = parsePlan(loopResult.finalText)
      if (parsed.plan) return { plan: parsed.plan, source: 'ai' }
      rawOutput = loopResult.finalText
      parseError = parsed.error
    } catch (error) {
      const reason = error instanceof ProviderAdapterError ? adapterReason(error) : (error instanceof Error ? error.message : '未知错误')
      console.warn(`[TeachOS] Tool-augmented lesson generation fell back to single-shot: ${reason}`)
      // fall through to the single-shot path below
    }
  }

  if (!rawOutput) {
    let resultText = ''
    try {
      const result = generationSettings.generator.streaming
        ? await streamProvider({ settings: generationSettings, provider, request: { systemPrompt, userPrompt, jsonMode: true }, callbacks })
        : await callProvider({ settings: generationSettings, provider, request: { systemPrompt, userPrompt, jsonMode: true }, callbacks })
      resultText = result.text
    } catch (error) {
      const reason = error instanceof ProviderAdapterError ? adapterReason(error) : (error instanceof Error ? error.message : '未知错误')
      throw new LessonGenerationError(`课程生成请求失败：${reason}`)
    }
    callbacks.onStatus?.('validating')
    const parsed = parsePlan(resultText)
    if (parsed.plan) return { plan: parsed.plan, source: 'ai' }
    rawOutput = resultText
    parseError = parsed.error
  }

  // One repair round: hand the raw output and the validation error back to
  // the model so it can fix its own JSON.
  callbacks.onStatus?.('calling')
  let repairedText = ''
  try {
    const repairUserPrompt = `${userPrompt}\n\n---\n\n${buildLessonRepairPrompt({ rawOutput, validationError: parseError })}`
    const repaired = await callProvider({
      settings: generationSettings,
      provider,
      request: { systemPrompt, userPrompt: repairUserPrompt, jsonMode: true },
      callbacks
    })
    repairedText = repaired.text
  } catch (error) {
    const reason = error instanceof ProviderAdapterError ? adapterReason(error) : (error instanceof Error ? error.message : '未知错误')
    throw new LessonGenerationError(`课程计划修复请求失败：${reason}（首次校验错误：${parseError}）`)
  }
  callbacks.onStatus?.('validating')
  const reparsed = parsePlan(repairedText)
  if (reparsed.plan) {
    return { plan: reparsed.plan, source: 'ai', reason: '首次输出未通过校验，已自动修复' }
  }
  const compact = await regenerateCompactLessonPlan({
    settings: generationSettings,
    provider,
    mission,
    prompt,
    sequence,
    recalledMemories,
    previousErrors: [parseError, reparsed.error],
    callbacks
  })
  if (compact.plan) {
    return { plan: compact.plan, source: 'ai', reason: '前两次输出未通过校验，已用紧凑模式重生成' }
  }
  throw new LessonGenerationError(`AI 三次输出均未通过课程计划校验：${compact.error}`)
}

function withLessonPlanOutputBudget(settings: TeachingSettingsV1): TeachingSettingsV1 {
  if (settings.generator.maxOutputTokens >= MIN_LESSON_PLAN_OUTPUT_TOKENS) return settings
  return {
    ...settings,
    generator: {
      ...settings.generator,
      maxOutputTokens: MIN_LESSON_PLAN_OUTPUT_TOKENS
    }
  }
}

async function regenerateCompactLessonPlan(opts: {
  settings: TeachingSettingsV1
  provider: NonNullable<ReturnType<typeof resolveActiveProvider>>
  mission: { title: string; excerpt: string }
  prompt: string
  sequence: number
  recalledMemories: TeachingMemoryRecord[]
  previousErrors: string[]
  callbacks: AdapterCallbacks
}): Promise<{ plan: LessonPlan; error?: undefined } | { plan: null; error: string }> {
  const systemPrompt = buildCompactLessonSystemPrompt({
    mission: opts.mission,
    durationMinutes: opts.settings.generator.lessonDurationMinutes,
    includeRetrievalPractice: opts.settings.generator.includeRetrievalPractice,
    generateReference: opts.settings.generator.generateReference,
    generateLearningRecord: opts.settings.generator.generateLearningRecord
  })
  const memoryBlock = opts.recalledMemories.length > 0
    ? `\n\n相关长期记忆：\n${opts.recalledMemories.map((memory, index) => `${index + 1}. ${memory.content}`).join('\n')}`
    : ''
  const userPrompt = [
    `当前是第 ${opts.sequence} 节课程。`,
    `学习请求：${opts.prompt}`,
    memoryBlock,
    '',
    '前两次输出未通过 JSON 校验：',
    ...opts.previousErrors.map((error, index) => `${index + 1}. ${error}`),
    '',
    '请从头重新生成一份更短、更稳的课程计划。'
  ].join('\n')

  let compactText = ''
  try {
    opts.callbacks.onStatus?.('calling')
    const compact = await callProvider({
      settings: opts.settings,
      provider: opts.provider,
      request: { systemPrompt, userPrompt, jsonMode: true },
      callbacks: opts.callbacks
    })
    compactText = compact.text
  } catch (error) {
    const reason = error instanceof ProviderAdapterError ? adapterReason(error) : (error instanceof Error ? error.message : '未知错误')
    return { plan: null, error: `紧凑重生成请求失败：${reason}` }
  }
  opts.callbacks.onStatus?.('validating')
  return parsePlan(compactText)
}

function buildCompactLessonSystemPrompt(opts: {
  mission: { title: string; excerpt: string }
  durationMinutes: number
  includeRetrievalPractice: boolean
  generateReference: boolean
  generateLearningRecord: boolean
}): string {
  return `你是 TeachOS 的课程计划生成器。只输出一个合法 JSON 对象，不要 markdown 围栏、不要解释。

目标：在 JSON 稳定性优先的前提下，生成一节中文课程。

必须字段：
{
  "title": "≤24字",
  "objective": "≤60字",
  "durationMinutes": ${opts.durationMinutes},
  "sections": [
    { "heading": "≤18字", "body": "120到350字中文，允许简短 markdown，但不要代码块，不要复杂表格" }
  ],
  "keyPoints": ["3到6个，每个≤30字"],
  "quiz": ${opts.includeRetrievalPractice ? '[{"type":"single","question":"...","choices":["...","..."],"answer":0,"explanation":"≤80字"}]' : '[]'},
  "flashcards": [{"front":"...","back":"..."}],
  "referenceNotes": ${opts.generateReference ? '"≤300字 markdown 速查材料"' : '""'},
  "learningRecordNote": ${opts.generateLearningRecord ? '"两段 markdown：## 判定 和 ## 影响"' : '""'},
  "callouts": [],
  "flowDiagram": ""
}

约束：
- 只保留 3 到 4 个 sections，每个 body 必须是单行 JSON 字符串；所有换行写成 \\n。
- body 内不要出现未转义的英文双引号；需要引用术语时用中文书名号或反引号。
- 不输出 HTML。
- Mission：${opts.mission.title}。${opts.mission.excerpt}`
}

async function writeLessonArtifacts(opts: {
  plan: LessonPlan
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
  workspaceName: string
  lessons: LessonSummary[]
  glossaryAvailable: boolean
  recordRelativePath: string | null
  recordAbsolutePath: string | null
  referenceRelativePath: string | null
  referenceAbsolutePath: string | null
  reviewsRelativePath: string | null
  reviewsAbsolutePath: string | null
  generator: TeachingSettingsV1['generator']
}): Promise<void> {
  const {
    plan, lesson, mission, workspaceName, lessons, glossaryAvailable,
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
    renderLessonHtmlFromPlan({ plan, lesson, mission, workspaceName, lessons, glossaryAvailable, recordRelativePath, referenceRelativePath, generator }),
    'utf8'
  )
  if (referenceAbsolutePath) {
    await writeFile(referenceAbsolutePath, renderReferenceHtmlFromPlan({ plan, lesson, mission, workspaceName, glossaryAvailable }), 'utf8')
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

function buildLessonArtifactPaths(options: {
  workspace: LessonGenerationWorkspace
  sequence: number
  title: string
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
  // Learning records live in the scaffolded learning-records/ directory (not
  // lessons/) so they're distinct from lesson pages and pickable by the
  // records catalog. Legacy records in lessons/ are migrated at pipeline start.
  const recordsDirRelativePath = 'learning-records'
  const recordRelativePath = options.includeLearningRecord
    ? workspaceRelativePath(recordsDirRelativePath, `${String(options.sequence).padStart(4, '0')}-${fileSlug}.md`)
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

async function nextLessonNumber(rootPath: string, lessons: LessonSummary[]): Promise<number> {
  const fromIndex = lessons.map((lesson) => Number.parseInt(lesson.id, 10)).filter(Number.isFinite)
  const files = await collectTeachingFiles(rootPath, (file) => file.toLowerCase().endsWith('.html'))
  const fromDisk = files
    .map((file) => Number.parseInt(basename(file).slice(0, 4), 10))
    .filter(Number.isFinite)
  return Math.max(0, ...fromIndex, ...fromDisk) + 1
}

/**
 * Best-effort read of NOTES.md / GLOSSARY.md / RESOURCES.md so the lesson
 * generator (the "second brain") sees terminology, learner preferences and
 * trusted sources the conversation agent has already established. Missing
 * files yield empty strings — the prompt builder skips empty sections.
 */
async function readWorkspaceContextSummary(rootPath: string): Promise<LessonWorkspaceContext> {
  const readSafe = async (name: string): Promise<string> => {
    const content = await readFile(join(rootPath, name), 'utf8').catch(() => '')
    return content.replace(/\r?\n/g, '\n')
  }
  const [notes, glossary, resources] = await Promise.all([
    readSafe('NOTES.md'),
    readSafe('GLOSSARY.md'),
    readSafe('RESOURCES.md')
  ])
  return { notes, glossary, resources }
}

/**
 * Fold the user's recent verbatim turns into a concise excerpt for the lesson
 * prompt. Assistant text is deliberately excluded — only honest user signal.
 * Mirrors the extraction in buildLessonPromptWithConversation but returns the
 * raw lines for system-prompt injection rather than a folded prompt string.
 */
function collectConversationExcerpt(messages: AgentChatMessage[] | undefined): string {
  const userLines = (messages ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => cleanText(message.content))
    .filter(Boolean)
    .slice(-6)
  return userLines.map((line) => `- ${line}`).join('\n')
}

/**
 * Surface the most recent prior lessons (by id ascending) so the generator
 * can link to the previous lesson and avoid re-teaching established ground.
 * Capped at 8 to keep the prompt bounded.
 */
function buildPriorLessons(lessons: LessonSummary[]): LessonPriorLesson[] {
  return [...lessons]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(-8)
    .map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      objective: lesson.objective,
      relativePath: lesson.relativePath
    }))
}

/**
 * One-time, idempotent migration: learning records written to lessons/ before
 * the 2026-07 path change are moved into learning-records/ so the records
 * catalog and scaffold stay consistent. Only moves NNNN-*.md files; never
 * touches .html lessons or non-numbered markdown.
 */
async function migrateLegacyLearningRecords(rootPath: string): Promise<void> {
  const lessonsDir = join(rootPath, 'lessons')
  const recordsDir = join(rootPath, 'learning-records')
  const legacyFiles = await collectTeachingFiles(rootPath, (file) => {
    const lower = file.toLowerCase()
    if (!lower.endsWith('.md')) return false
    const name = basename(file)
    return /^\d{4}-/.test(name)
  })
  for (const absolutePath of legacyFiles) {
    if (!absolutePath.replace(/\\/g, '/').includes('/lessons/')) continue
    const name = basename(absolutePath)
    const target = join(recordsDir, name)
    if (await fileExists(target)) continue
    await mkdir(recordsDir, { recursive: true })
    await rename(absolutePath, target).catch(() => {
      /* ignore race / fs errors — migration is best-effort */
    })
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
 * prose. On failure returns a human-readable error for the repair round.
 */
export function parsePlan(text: string): { plan: LessonPlan; error?: undefined } | { plan: null; error: string } {
  const candidates = extractJsonCandidates(text)
  if (candidates.length === 0) return { plan: null, error: '输出中找不到 JSON 对象' }

  let lastError = ''
  for (const raw of candidates) {
    const parsed = parseJsonCandidate(raw)
    if (parsed.ok) {
      const validated = validatePlan(parsed.value)
      if (validated.plan) return validated
      lastError = validated.error
      continue
    }
    lastError = parsed.error

    const repaired = repairLikelyTruncatedJson(raw)
    if (repaired && repaired !== raw) {
      const reparsed = parseJsonCandidate(repaired)
      if (reparsed.ok) {
        const validated = validatePlan(reparsed.value)
        if (validated.plan) return validated
        lastError = validated.error
      } else {
        lastError = reparsed.error
      }
    }
  }

  return { plan: null, error: lastError || 'JSON 解析失败' }
}

function validatePlan(parsed: unknown): { plan: LessonPlan; error?: undefined } | { plan: null; error: string } {
  const result = lessonPlanSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('；')
    console.warn('[TeachOS] Lesson plan schema validation failed:', issues)
    return { plan: null, error: `结构校验失败：${issues}` }
  }
  return { plan: sanitizePlan(result.data) }
}

function parseJsonCandidate(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

function extractJsonCandidates(text: string): string[] {
  const trimmed = stripJsonFence(text.trim())
  const candidates: string[] = []
  const add = (candidate: string): void => {
    const normalized = candidate.trim()
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized)
  }

  const balanced = extractFirstBalancedJsonObject(trimmed)
  if (balanced) add(balanced)
  if (trimmed.startsWith('{')) add(trimmed)

  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) add(trimmed.slice(first, last + 1))
  return candidates
}

function stripJsonFence(text: string): string {
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(text)
  return fenceMatch ? fenceMatch[1]!.trim() : text
}

function extractFirstBalancedJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start < 0) return ''

  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      stack.push('}')
    } else if (char === '[') {
      stack.push(']')
    } else if (char === '}' || char === ']') {
      if (stack.length === 0 || stack[stack.length - 1] !== char) return ''
      stack.pop()
      if (stack.length === 0) return text.slice(start, index + 1)
    }
  }
  return ''
}

function repairLikelyTruncatedJson(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return ''

  let repaired = ''
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    repaired += char
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      stack.push('}')
    } else if (char === '[') {
      stack.push(']')
    } else if (char === '}' || char === ']') {
      if (stack[stack.length - 1] !== char) return ''
      stack.pop()
    }
  }

  if (escaped) repaired += '\\'
  if (inString) repaired += '"'
  repaired = repaired.replace(/,\s*$/, '')
  while (stack.length > 0) {
    const close = stack.pop()!
    repaired = repaired.replace(/,\s*$/, '')
    repaired += close
  }
  return removeTrailingJsonCommas(repaired)
}

function removeTrailingJsonCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, '$1')
}

/**
 * Local fallback plan — used only when no provider is configured. Provider
 * failures are surfaced instead of being hidden behind a placeholder lesson.
 */
function localFallbackPlan(
  prompt: string,
  mission: { title: string; excerpt: string },
  sequence: number,
  settings: TeachingSettingsV1
): LessonPlan {
  const topic = deriveTopic(prompt, mission.title)
  const title = deriveLessonTitle(prompt, sequence)
  const includeQuiz = settings.generator.includeRetrievalPractice
  return {
    title,
    objective: `用一个可复述框架掌握「${topic}」的关键判断。`,
    durationMinutes: settings.generator.lessonDurationMinutes,
    sections: [
      {
        heading: '先回答什么',
        body: `本课围绕「${topic}」建立一个最小闭环：它是什么、为什么重要、实际判断时看哪些信号。学习时先不要追求覆盖所有分支，而是把主题压缩成一段能讲给面试官或同事听的解释。`
      },
      {
        heading: '三步框架',
        body: `1. **定义边界**：说明「${topic}」解决哪类问题，也说明它不负责什么。\n2. **抓住取舍**：列出 2 到 3 个会影响结果的关键参数或设计选择。\n3. **落到例子**：用 Mission「${mission.title}」里的真实目标，把抽象概念换成一个具体判断。`
      },
      {
        heading: '复述模板',
        body: `可以这样复述：在「${mission.title}」里，${topic} 的价值不是记住名词，而是能解释它改变了哪一步决策。先讲目标，再讲机制，最后讲一个常见误区或边界条件。`
      }
    ],
    keyPoints: [`先定义「${topic}」边界`, '用取舍而不是名词记忆', '用一个具体例子复述'],
    quiz: includeQuiz
      ? [{
          type: 'single',
          question: `学习「${topic}」时，最稳的复述顺序是什么？`,
          choices: ['目标、机制、边界', '名词列表、工具列表、版本号', '先背结论，再补原因'],
          answer: 0,
          explanation: '先讲目标，再讲机制和边界，最不容易跑题。'
        }]
      : [],
    flashcards: [
      { front: `${topic} 的学习抓手`, back: '定义边界、关键取舍、具体例子。' }
    ],
    callouts: [],
    referenceNotes: `围绕「${topic}」复习时，优先检查：它解决的问题、关键取舍、一个可讲清的例子。`,
    learningRecordNote: `## 判定\n本节为「${topic}」建立了可复述框架：目标、机制、边界。\n\n## 影响\n后续课程可以在这个框架上继续补具体参数、案例和面试问答。`
  }
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
