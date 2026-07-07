import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { callProvider, ProviderAdapterError, resolveActiveProvider, streamProvider, toolsSupportedForFormat, type AdapterCallbacks } from './ai/provider-adapter'
import { runAgentLoop } from './ai/agent-loop'
import { buildDefaultRegistry, buildToolContext } from './ai/tools/registry'
import { buildLessonSystemPrompt, buildLessonUserPrompt, buildLessonRepairPrompt } from './ai/lesson-prompts'
import {
  renderLearningRecordFromPlan,
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan
} from './ai/lesson-renderer'
import { readMissionSummary } from './teaching-workspace-catalog'
import { clampTitle, cleanText, collectTeachingFiles } from './teaching-workspace-paths'
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
import { buildLessonArtifactPlacement } from '../shared/teaching-placement'

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

/**
 * Raised when the provider is configured but no valid LessonPlan could be
 * produced (even after one repair round). Callers must NOT write anything to
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
  const mission = await readMissionSummary(workspace.rootPath, workspace.name)
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
  callbacks: AdapterCallbacks
}): Promise<{ plan: LessonPlan; source: LessonPlanSource; reason?: string }> {
  const { workspace, mission, prompt, settings, sequence, recalledMemories, callbacks } = opts
  const provider = resolveActiveProvider(settings)

  // The only legitimate fallback: no provider at all. Every other failure is
  // surfaced as an error instead of silently writing a templated lesson.
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

  let rawOutput = ''
  let parseError = ''

  // Tool-augmented path: let the model inspect the workspace and/or research
  // before emitting the LessonPlan JSON. Only for chat_completions /
  // custom_endpoint formats. Transport errors fall through to single-shot.
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
      const result = settings.generator.streaming
        ? await streamProvider({ settings, provider, request: { systemPrompt, userPrompt, jsonMode: true }, callbacks })
        : await callProvider({ settings, provider, request: { systemPrompt, userPrompt, jsonMode: true }, callbacks })
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
      settings,
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
  throw new LessonGenerationError(`AI 两次输出均未通过课程计划校验：${reparsed.error}`)
}

async function writeLessonArtifacts(opts: {
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

function buildLessonArtifactPaths(options: {
  workspace: LessonGenerationWorkspace
  sequence: number
  title: string
  requestedCourseName?: string
  includeReference: boolean
  includeLearningRecord: boolean
  includeReviews: boolean
}): LessonArtifactPaths {
  const placement = buildLessonArtifactPlacement({
    workspaceName: options.workspace.name,
    sequence: options.sequence,
    title: options.title,
    requestedCourseName: options.requestedCourseName,
    includeReference: options.includeReference,
    includeLearningRecord: options.includeLearningRecord,
    includeReviews: options.includeReviews
  })
  const courseRelativePath = placement.courseRelativePath
  const courseAbsolutePath = join(options.workspace.rootPath, courseRelativePath)

  return {
    courseId: placement.courseId,
    courseName: placement.courseName,
    courseRelativePath,
    courseAbsolutePath,
    sessionId: placement.sessionId,
    sessionName: placement.sessionName,
    sessionRelativePath: placement.sessionRelativePath,
    sessionAbsolutePath: join(options.workspace.rootPath, placement.sessionRelativePath),
    lessonRelativePath: placement.lessonRelativePath,
    lessonAbsolutePath: join(options.workspace.rootPath, placement.lessonRelativePath),
    referenceRelativePath: placement.referenceRelativePath,
    referenceAbsolutePath: placement.referenceRelativePath ? join(options.workspace.rootPath, placement.referenceRelativePath) : null,
    recordRelativePath: placement.recordRelativePath,
    recordAbsolutePath: placement.recordRelativePath ? join(options.workspace.rootPath, placement.recordRelativePath) : null,
    reviewsRelativePath: placement.reviewsRelativePath,
    reviewsAbsolutePath: placement.reviewsRelativePath ? join(options.workspace.rootPath, placement.reviewsRelativePath) : null
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
function parsePlan(text: string): { plan: LessonPlan; error?: undefined } | { plan: null; error: string } {
  const raw = extractJsonText(text)
  if (!raw) return { plan: null, error: '输出中找不到 JSON 对象' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { plan: null, error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
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
