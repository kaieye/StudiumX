import {
  callProvider,
  ProviderAdapterError,
  resolveActiveProvider,
  streamProvider,
  toolsSupportedForFormat,
  type AdapterCallbacks
} from './ai/provider-adapter'
import { buildCompactLessonRegenerationPrompt } from './ai/lesson-prompts'
import { runAgentLoop } from './ai/agent-loop'
import { buildDefaultRegistry, buildToolContext } from './ai/tools/registry'
import {
  loadAndMergeToolPolicyDocumentsFromWorkspace,
  toolPolicyDocumentOption
} from './ai/tools/tool-policy-fs'
import { cleanText } from './teaching-workspace-paths'
import { type LessonPlan, type LessonPlanSource } from '../shared/lesson-schema'
import { classifyProviderError, providerErrorReason } from '../shared/provider-error'
import type { TeachingSettingsV1 } from '../shared/teaching-types'
import { parseLessonPlan, type LessonPlanParseDiagnostic } from './lesson-plan-parsing'

/** A nested research pass must stay bounded even when the conversational setting is unlimited. */
const MAX_LESSON_PLAN_TOOL_ITERATIONS = 2
const MAX_LESSON_RESEARCH_DURATION_MS = 45_000
const MAX_LESSON_RESEARCH_PROVIDER_CALLS = 2

export type PreparedLessonPlanRequest = {
  workspace: {
    rootPath: string
    /** Explicit server-derived grant; absence is intentionally untrusted. */
    workspaceToolAccessGranted?: boolean
  }
  mission: { title: string; excerpt: string }
  prompt: string
  sequence: number
  settings: TeachingSettingsV1
  systemPrompt: string
  userPrompt: string
  callbacks: AdapterCallbacks
}

export type LessonPlanProductionResult = {
  plan: LessonPlan
  source: LessonPlanSource
  reason?: string
}

/** Normalized provider failure used internally to select the safe local fallback. */
export class LessonGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LessonGenerationError'
  }
}

/**
 * Production policy for LessonPlan generation. Ordinary lessons go directly
 * to the structured provider request. A bounded tool pass is reserved for an
 * explicit research request, and invalid structured output receives at most
 * one compact regeneration before the brief-aligned local fallback is used.
 */
export async function produce(prepared: PreparedLessonPlanRequest): Promise<LessonPlanProductionResult> {
  const { workspace, mission, prompt, sequence, settings, systemPrompt, userPrompt, callbacks } = prepared
  const provider = resolveActiveProvider(settings)
  if (!provider || !provider.apiKey.trim()) {
    return localFallbackResult(prompt, mission, sequence, settings, '未配置 API Key')
  }

  // Respect the configured output budget: silently expanding it makes non-streaming
  // providers wait longer and can turn an otherwise bounded lesson request into a timeout.
  const productionSettings = settings

  if (lessonResearchRequested(prompt)) {
    const researchedPlan = await requestResearchPlan({
      workspace,
      productionSettings,
      provider,
      systemPrompt,
      userPrompt,
      callbacks
    })
    if (researchedPlan) return { plan: researchedPlan, source: 'ai' }
  }

  let rawOutput: string
  try {
    rawOutput = await requestInitialPlan({ productionSettings, provider, systemPrompt, userPrompt, callbacks })
  } catch (error) {
    if (error instanceof LessonGenerationError) {
      return localFallbackResult(
        prompt,
        mission,
        sequence,
        settings,
        `${error.message}，已使用本地学习任务模板`
      )
    }
    throw error
  }

  const initial = validate(rawOutput, callbacks, '首次生成')
  if (initial.plan) return { plan: initial.plan, source: 'ai' }

  let compactText: string
  try {
    compactText = await requestCompactRetry({
      productionSettings,
      provider,
      systemPrompt,
      userPrompt,
      diagnostic: initial.diagnostic,
      callbacks
    })
  } catch (error) {
    if (error instanceof LessonGenerationError) {
      return localFallbackResult(
        prompt,
        mission,
        sequence,
        settings,
        `${error.message}，已使用本地学习任务模板`
      )
    }
    throw error
  }

  const compact = validate(compactText, callbacks, '紧凑重试')
  if (compact.plan) {
    return { plan: compact.plan, source: 'ai', reason: '首次输出未通过校验，已用紧凑重试重新生成' }
  }
  return localFallbackResult(
    prompt,
    mission,
    sequence,
    settings,
    `AI 课程输出结构校验失败（${compact.diagnostic.message}），已使用本地学习任务模板`
  )
}

async function requestResearchPlan(opts: {
  workspace: PreparedLessonPlanRequest['workspace']
  productionSettings: TeachingSettingsV1
  provider: NonNullable<ReturnType<typeof resolveActiveProvider>>
  systemPrompt: string
  userPrompt: string
  callbacks: AdapterCallbacks
}): Promise<LessonPlan | null> {
  if (!toolsSupportedForFormat(opts.productionSettings.generator.endpointFormat)) return null

  // `generate_lesson` remains available for untrusted workspaces, but its
  // nested research agent must not regain generic workspace-file access.
  const workspaceToolOptions = opts.workspace.workspaceToolAccessGranted === true
    ? { workspaceRoot: opts.workspace.rootPath }
    : {}
  // Optional workspace tool-policy only when grant is true (ADR-0088 / ADR-0117 multi-path).
  // Grant false: no FS load and no toolPolicyDocument field.
  let toolContextOptions: {
    workspaceRoot?: string
    toolPolicyDocument?: import('./ai/tools/tool-policy').ToolPolicyDocument
  } = { ...workspaceToolOptions }
  if (opts.workspace.workspaceToolAccessGranted === true && opts.workspace.rootPath) {
    const workspaceToolPolicy = await loadAndMergeToolPolicyDocumentsFromWorkspace({
      workspaceRoot: opts.workspace.rootPath
    })
    toolContextOptions = {
      ...toolContextOptions,
      ...toolPolicyDocumentOption(workspaceToolPolicy)
    }
  }

  const registry = buildDefaultRegistry(opts.productionSettings, workspaceToolOptions)
  const toolDefinitions = registry.definitions()
  if (!toolDefinitions.length) return null

  try {
    const loopResult = await runAgentLoop({
      settings: opts.productionSettings,
      provider: opts.provider,
      messages: [
        { role: 'system', content: `${LESSON_RESEARCH_PREFIX}\n\n${opts.systemPrompt}` },
        { role: 'user', content: opts.userPrompt }
      ],
      tools: toolDefinitions,
      toolHandlers: registry.handlerMap(buildToolContext(opts.productionSettings, toolContextOptions)),
      workspaceRoot: workspaceToolOptions.workspaceRoot,
      runId: `lesson-plan-${Date.now()}`,
      jsonMode: true,
      maxIterations: lessonPlanToolMaxIterations(opts.productionSettings.tools.maxIterations),
      budget: lessonResearchBudget(opts.productionSettings),
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'status') {
            if (event.status === 'thinking') opts.callbacks.onStatus?.('calling')
            else if (event.status === 'tool_running' || event.status === 'tool_done' || event.status === 'answering') {
              opts.callbacks.onStatus?.('streaming')
            }
          } else if (event.type === 'token') {
            opts.callbacks.onToken?.(event.delta)
          }
        }
      }
    })
    const parsed = validate(loopResult.finalText, opts.callbacks, '工具生成')
    if (parsed.plan) return parsed.plan
    console.warn(
      `[StudiumX] Tool-augmented lesson output was invalid; retrying with a fresh direct structured request: ${parsed.diagnostic.message}`
    )
  } catch (error) {
    const reason = error instanceof ProviderAdapterError ? adapterReason(error) : error instanceof Error ? error.message : '未知错误'
    console.warn(`[StudiumX] Tool-augmented lesson generation fell back to direct generation: ${reason}`)
  }
  return null
}

async function requestInitialPlan(opts: {
  productionSettings: TeachingSettingsV1
  provider: NonNullable<ReturnType<typeof resolveActiveProvider>>
  systemPrompt: string
  userPrompt: string
  callbacks: AdapterCallbacks
}): Promise<string> {
  try {
    const result = opts.productionSettings.generator.streaming
      ? await streamProvider({ settings: opts.productionSettings, provider: opts.provider, request: { systemPrompt: opts.systemPrompt, userPrompt: opts.userPrompt, jsonMode: true }, callbacks: opts.callbacks })
      : await callProvider({ settings: opts.productionSettings, provider: opts.provider, request: { systemPrompt: opts.systemPrompt, userPrompt: opts.userPrompt, jsonMode: true }, callbacks: opts.callbacks })
    return result.text
  } catch (error) {
    const reason = error instanceof ProviderAdapterError ? adapterReason(error) : error instanceof Error ? error.message : '未知错误'
    throw new LessonGenerationError(`课程生成请求失败：${reason}`)
  }
}

async function requestCompactRetry(opts: {
  productionSettings: TeachingSettingsV1
  provider: NonNullable<ReturnType<typeof resolveActiveProvider>>
  systemPrompt: string
  userPrompt: string
  diagnostic: LessonPlanParseDiagnostic
  callbacks: AdapterCallbacks
}): Promise<string> {
  opts.callbacks.onStatus?.('calling')
  try {
    const result = await callProvider({
      settings: opts.productionSettings,
      provider: opts.provider,
      request: {
        systemPrompt: opts.systemPrompt,
        userPrompt: buildCompactLessonRegenerationPrompt({
          userPrompt: opts.userPrompt,
          validationError: opts.diagnostic.message
        }),
        jsonMode: true
      },
      callbacks: opts.callbacks
    })
    return result.text
  } catch (error) {
    const reason = error instanceof ProviderAdapterError ? adapterReason(error) : error instanceof Error ? error.message : '未知错误'
    throw new LessonGenerationError(`课程计划紧凑重试请求失败：${reason}（首次校验错误：${opts.diagnostic.message}）`)
  }
}

function validate(text: string, callbacks: AdapterCallbacks, stage: string) {
  callbacks.onStatus?.('validating')
  const parsed = parseLessonPlan(text)
  if (!parsed.plan) console.warn(`[StudiumX] Lesson plan ${stage} validation failed: ${parsed.diagnostic.message}`)
  return parsed
}

function lessonResearchRequested(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  return [
    /(?:联网|网上|网页|互联网|网络).{0,10}(?:搜索|检索|查找|查询|浏览|资料)/i,
    /(?:搜索|检索|查找|查询|浏览).{0,12}(?:网页|网络|互联网|资料|来源|官方)/i,
    /(?:官方文档|权威来源|引用来源|来源链接|参考链接)/i,
    /(?:最新|实时|截至|今日|今天|近期|现行|当前(?:版本|政策|规定|数据|状态|进展|资料|信息))/i,
    /\b(?:latest|current version|up-to-date|today|recent|real-time|as of|official docs?|authoritative sources?|citations?|search the web|web search|browse the web|look up online)\b/i
  ].some((pattern) => pattern.test(normalized))
}

function lessonPlanToolMaxIterations(configuredMaxIterations: number): number {
  if (!Number.isFinite(configuredMaxIterations) || configuredMaxIterations <= 0) {
    return MAX_LESSON_PLAN_TOOL_ITERATIONS
  }
  return Math.min(Math.floor(configuredMaxIterations), MAX_LESSON_PLAN_TOOL_ITERATIONS)
}

function lessonResearchBudget(settings: TeachingSettingsV1): TeachingSettingsV1['tools']['runBudget'] {
  return {
    ...settings.tools.runBudget,
    maxDurationMs: Math.min(settings.tools.runBudget.maxDurationMs, MAX_LESSON_RESEARCH_DURATION_MS),
    maxProviderCalls: Math.min(settings.tools.runBudget.maxProviderCalls, MAX_LESSON_RESEARCH_PROVIDER_CALLS)
  }
}

function localFallbackResult(
  prompt: string,
  mission: { title: string; excerpt: string },
  sequence: number,
  settings: TeachingSettingsV1,
  reason: string
): LessonPlanProductionResult {
  return {
    plan: localFallbackPlan(prompt, mission, sequence, settings),
    source: 'fallback',
    reason
  }
}

function adapterReason(error: ProviderAdapterError): string {
  switch (error.kind) {
    case 'no_api_key': return '未配置 API Key'
    case 'network': return '网络错误'
    case 'http': return providerErrorReason(classifyProviderError(error.message) ?? { kind: 'http' })
    case 'parse': return '响应解析失败'
    case 'timeout': return '请求超时'
    case 'unsupported': return '不支持的 endpoint 格式'
    default: return error.message
  }
}

const LESSON_RESEARCH_PREFIX =
  '在生成课程计划之前，你可以调用工作区只读工具读取 MISSION.md、RESOURCES.md、lessons、reference 和 learning-records 中的上下文；' +
  '也可以调用 web_search 工具检索最新或课程之外的事实性信息以丰富内容（例如最新版本号、时效性事件、权威定义）。' +
  '完成必要的检索后，仍必须严格只输出一个符合下方格式的 JSON 课程计划对象，不要输出任何额外说明或 markdown 围栏。'

type LocalFallbackBrief = {
  topic: string
  focus: string
  learnerProfile?: string
  goal?: string
  constraints?: string
  extraNotes?: string
}

function localFallbackPlan(
  prompt: string,
  mission: { title: string; excerpt: string },
  sequence: number,
  settings: TeachingSettingsV1
): LessonPlan {
  const brief = parseLocalFallbackBrief(prompt, mission.title)
  const includeQuiz = settings.generator.includeRetrievalPractice
  const context = [
    `**学习主题：** ${brief.topic}`,
    brief.learnerProfile ? `**学习者背景：** ${brief.learnerProfile}` : '',
    brief.goal ? `**学习目标：** ${brief.goal}` : '',
    brief.constraints ? `**约束：** ${brief.constraints}` : '',
    `**本节课要完成的动作：** ${brief.focus}`
  ].filter(Boolean).join('\n\n')
  return {
    title: deriveLessonTitle(brief.topic, sequence),
    objective: boundedText(`完成以下学习动作：${brief.focus}`, 400),
    durationMinutes: sequence === 1 ? Math.min(12, settings.generator.lessonDurationMinutes) : settings.generator.lessonDurationMinutes,
    sections: [
      {
        heading: '学习任务',
        body: boundedText(context, 8000)
      },
      {
        heading: '执行与自检',
        body: boundedText([
          `1. 围绕「${brief.topic}」提取完成本节动作所需的关键概念、判断依据或步骤。`,
          `2. 按照“${brief.focus}”完成一次示例、练习或口头讲解。`,
          '3. 对照学习目标检查：是否能独立复述步骤、说明判断理由，并指出仍不确定的部分。',
          '4. 若任务需要事实材料、题目或权威来源，请在 AI 生成服务恢复后重新生成完整课程，不用未经核验的内容填补空白。'
        ].join('\n'), 8000)
      }
    ],
    keyPoints: [
      boundedText(`主题：${brief.topic}`, 200),
      boundedText(`核心动作：${brief.focus}`, 200),
      '先完成可观察的学习动作，再根据结果决定下一步。'
    ],
    quiz: includeQuiz
      ? [{
          type: 'fill',
          question: '请写出本节课要完成的核心学习动作。',
          choices: [],
          answer: boundedText(brief.focus, 200),
          acceptedAnswers: [],
          explanation: boundedText(`回答应围绕：${brief.focus}`, 600)
        }]
      : [],
    flashcards: [],
    callouts: [],
    referenceNotes: boundedText(
      brief.extraNotes
        ? `补充要求：${brief.extraNotes}。当前为本地降级课程，未添加未经核验的外部事实或来源。`
        : '当前为本地降级课程，未添加未经核验的外部事实或来源；AI 生成服务恢复后可重新生成完整讲解与练习。',
      8000
    ),
    learningRecordNote: boundedText(
      `完成标准：学习者能围绕「${brief.topic}」独立完成“${brief.focus}”，并说明自己的判断依据。`,
      4000
    )
  }
}

function parseLocalFallbackBrief(prompt: string, fallbackTopic: string): LocalFallbackBrief {
  const fields: Partial<Record<'topic' | 'focus' | 'learnerProfile' | 'goal' | 'constraints' | 'extraNotes', string>> = {}
  const labels: Record<string, keyof typeof fields> = {
    '主题': 'topic',
    '学习者背景': 'learnerProfile',
    '学习目标': 'goal',
    '约束': 'constraints',
    '本节课要完成的动作': 'focus',
    '额外说明': 'extraNotes'
  }
  for (const line of prompt.split(/\r?\n/)) {
    const match = /^\s*-\s*([^：:]+)[：:]\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const field = labels[match[1]?.trim() ?? '']
    const value = cleanText(match[2] ?? '')
    if (field && value) fields[field] = value
  }
  const topic = fields.topic || deriveTopic(prompt, fallbackTopic)
  const focus = fields.focus || fields.goal || `围绕「${topic}」完成一次可检查的理解与练习`
  return {
    topic: boundedText(topic, 200),
    focus: boundedText(focus, 1500),
    ...(fields.learnerProfile ? { learnerProfile: boundedText(fields.learnerProfile, 1500) } : {}),
    ...(fields.goal ? { goal: boundedText(fields.goal, 1500) } : {}),
    ...(fields.constraints ? { constraints: boundedText(fields.constraints, 1500) } : {}),
    ...(fields.extraNotes ? { extraNotes: boundedText(fields.extraNotes, 1500) } : {})
  }
}

function boundedText(value: string, maxLength: number): string {
  const trimmed = value.replace(/\r/g, '').trim()
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, Math.max(1, maxLength - 1))}…`
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
