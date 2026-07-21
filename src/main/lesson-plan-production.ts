import {
  callProvider,
  ProviderAdapterError,
  resolveActiveProvider,
  streamProvider,
  toolsSupportedForFormat,
  type AdapterCallbacks
} from './ai/provider-adapter'
import { buildCompactLessonRegenerationPrompt, buildLessonRepairPrompt } from './ai/lesson-prompts'
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

const MIN_LESSON_PLAN_OUTPUT_TOKENS = 8192

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

/** Raised only after a configured provider cannot produce a valid plan. */
export class LessonGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LessonGenerationError'
  }
}

/**
 * Production policy for LessonPlan generation. This is the one seam that owns
 * provider absence, tool preference, request attempts, parse diagnostics, and
 * the bounded repair/retry policy. Callers prepare context and publish only a
 * successful plan.
 */
export async function produce(prepared: PreparedLessonPlanRequest): Promise<LessonPlanProductionResult> {
  const { workspace, mission, prompt, sequence, settings, systemPrompt, userPrompt, callbacks } = prepared
  const provider = resolveActiveProvider(settings)
  if (!provider || !provider.apiKey.trim()) {
    return {
      plan: localFallbackPlan(prompt, mission, sequence, settings),
      source: 'fallback',
      reason: '未配置 API Key'
    }
  }

  const productionSettings = withLessonPlanOutputBudget(settings)
  let rawOutput = ''
  let diagnostic: LessonPlanParseDiagnostic | null = null

  // `generate_lesson` remains available for untrusted workspaces, but its
  // nested production agent must not regain generic workspace-file access.
  // This explicit server-derived grant is fail-closed when absent.
  const workspaceToolOptions = workspace.workspaceToolAccessGranted === true
    ? { workspaceRoot: workspace.rootPath }
    : {}
  // Optional workspace tool-policy only when grant is true (ADR-0088 / ADR-0117 multi-path).
  // Grant false: no FS load and no toolPolicyDocument field.
  let toolContextOptions: {
    workspaceRoot?: string
  } & ReturnType<typeof toolPolicyDocumentOption> = { ...workspaceToolOptions }
  if (workspace.workspaceToolAccessGranted === true && workspace.rootPath) {
    const workspaceToolPolicy = await loadAndMergeToolPolicyDocumentsFromWorkspace({
      workspaceRoot: workspace.rootPath
    })
    toolContextOptions = {
      ...toolContextOptions,
      ...toolPolicyDocumentOption(workspaceToolPolicy)
    }
  }
  const registry = buildDefaultRegistry(productionSettings, workspaceToolOptions)
  const toolDefinitions = registry.definitions()
  const useTools = productionSettings.tools.enabled &&
    toolsSupportedForFormat(productionSettings.generator.endpointFormat) &&
    toolDefinitions.length > 0

  if (useTools) {
    try {
      const loopResult = await runAgentLoop({
        settings: productionSettings,
        provider,
        messages: [
          { role: 'system', content: `${LESSON_RESEARCH_PREFIX}\n\n${systemPrompt}` },
          { role: 'user', content: userPrompt }
        ],
        tools: toolDefinitions,
        toolHandlers: registry.handlerMap(buildToolContext(productionSettings, toolContextOptions)),
        workspaceRoot: workspaceToolOptions.workspaceRoot,
        runId: `lesson-plan-${Date.now()}`,
        jsonMode: true,
        maxIterations: productionSettings.tools.maxIterations,
        callbacks: {
          onEvent: (event) => {
            if (event.type === 'status') {
              if (event.status === 'thinking') callbacks.onStatus?.('calling')
              else if (event.status === 'tool_running' || event.status === 'tool_done' || event.status === 'answering') {
                callbacks.onStatus?.('streaming')
              }
            } else if (event.type === 'token') {
              callbacks.onToken?.(event.delta)
            }
          }
        }
      })
      const parsed = validate(loopResult.finalText, callbacks, '工具生成')
      if (parsed.plan) return { plan: parsed.plan, source: 'ai' }
      rawOutput = loopResult.finalText
      diagnostic = parsed.diagnostic
    } catch (error) {
      const reason = error instanceof ProviderAdapterError ? adapterReason(error) : error instanceof Error ? error.message : '未知错误'
      console.warn(`[StudiumX] Tool-augmented lesson generation fell back to single-shot: ${reason}`)
    }
  }

  if (!rawOutput) {
    const resultText = await requestInitialPlan({ productionSettings, provider, systemPrompt, userPrompt, callbacks })
    const parsed = validate(resultText, callbacks, '首次生成')
    if (parsed.plan) return { plan: parsed.plan, source: 'ai' }
    rawOutput = resultText
    diagnostic = parsed.diagnostic
  }

  const firstDiagnostic = diagnostic ?? { kind: 'missing_json' as const, message: '输出中找不到 JSON 对象' }
  const repairedText = await requestRepair({
    productionSettings,
    provider,
    systemPrompt,
    userPrompt,
    rawOutput,
    diagnostic: firstDiagnostic,
    callbacks
  })
  const repaired = validate(repairedText, callbacks, '修复生成')
  if (repaired.plan) {
    return { plan: repaired.plan, source: 'ai', reason: '首次输出未通过校验，已自动修复' }
  }

  const compactText = await requestCompactRetry({
    productionSettings,
    provider,
    systemPrompt,
    userPrompt,
    diagnostic: repaired.diagnostic,
    callbacks
  })
  const compact = validate(compactText, callbacks, '紧凑重试')
  if (compact.plan) {
    return { plan: compact.plan, source: 'ai', reason: '首次输出和修复均未通过校验，已用紧凑重试重新生成' }
  }
  throw new LessonGenerationError(`AI 三次输出均未通过课程计划校验：${compact.diagnostic.message}`)
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

async function requestRepair(opts: {
  productionSettings: TeachingSettingsV1
  provider: NonNullable<ReturnType<typeof resolveActiveProvider>>
  systemPrompt: string
  userPrompt: string
  rawOutput: string
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
        userPrompt: `${opts.userPrompt}\n\n---\n\n${buildLessonRepairPrompt({ rawOutput: opts.rawOutput, validationError: opts.diagnostic.message })}`,
        jsonMode: true
      },
      callbacks: opts.callbacks
    })
    return result.text
  } catch (error) {
    const reason = error instanceof ProviderAdapterError ? adapterReason(error) : error instanceof Error ? error.message : '未知错误'
    throw new LessonGenerationError(`课程计划修复请求失败：${reason}（首次校验错误：${opts.diagnostic.message}）`)
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
    throw new LessonGenerationError(`课程计划紧凑重试请求失败：${reason}（修复轮校验错误：${opts.diagnostic.message}）`)
  }
}

function validate(text: string, callbacks: AdapterCallbacks, stage: string) {
  callbacks.onStatus?.('validating')
  const parsed = parseLessonPlan(text)
  if (!parsed.plan) console.warn(`[StudiumX] Lesson plan ${stage} validation failed: ${parsed.diagnostic.message}`)
  return parsed
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
          question: 'StudiumX 里最应该长期保存的真相来源是什么？',
          choices: ['运行时内存状态', '工作区文件资产', '单次聊天窗口'],
          answer: 1,
          explanation: '工作区文件能脱离 App 长期保存。'
        }]
      : [],
    flashcards: [],
    callouts: [],
    referenceNotes: '先写 mission，再决定第一课；课程输出到 lessons/*.html；对话记录写入 conversation/*.md。',
    learningRecordNote: `本节围绕「${mission.title}」建立了可复用的 StudiumX 学习闭环。`
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
