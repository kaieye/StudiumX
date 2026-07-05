import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runAgentLoop } from './ai/agent-loop'
import { resolveActiveProvider, type ChatMessage, type ToolDefinition } from './ai/provider-adapter'
import { buildDefaultRegistry, buildToolContext, ToolRegistry } from './ai/tools/registry'
import { createAskToolEntry } from './ai/tools/ask'
import {
  buildLearnerMemoryCandidate,
  buildMemoryConsentPrompt,
  classifyMemoryConsentResponse,
  extractPendingLearnerMemoryCandidate,
  isBareMemoryConsentResponse,
  planLearnerMemoryCapture
} from '../shared/teaching-memory-capture'
import { normalizeLessonBrief, type LessonBrief } from '../shared/teaching-workflow'
import type {
  AgentChatMessage,
  AgentChatMode,
  AgentChatStreamChunk,
  AgentChatStreamPayload,
  AgentChatStreamResult,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentChatTurn,
  CreateTeachingMemoryPayload,
  LessonSummary,
  TeachingMemoryCaptureResult,
  TeachingMemoryRecord,
  TeachingSettingsV1
} from '../shared/teaching-types'

export type TeachingConversationRuntimeWorkspace = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  archived?: boolean
}

export type TemporaryChatContext = {
  learnerProfiles: string[]
  courses: Array<{ name: string; lessonCount: number; sessionCount: number }>
}

export type TeachingConversationRuntimeStream = {
  streamId: string
  signal?: AbortSignal
  onChunk: (chunk: AgentChatStreamChunk) => void
  onStatus: (status: AgentChatStreamStatus) => void
  onTool: (event: AgentChatStreamToolEvent) => void
}

export type TeachingConversationRuntimeDeps = {
  loadSettings: () => Promise<TeachingSettingsV1>
  listMemories: (workspaceRoot?: string) => Promise<TeachingMemoryRecord[]>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  /**
   * Execute the lesson generation pipeline for a brief the conversation agent
   * assembled. Provided only for teaching-mode conversations with an active
   * workspace; its presence enables the generate_lesson tool.
   */
  generateLessonFromBrief?: (brief: LessonBrief) => Promise<LessonSummary>
  buildTemporaryChatContext: (
    workspace: TeachingConversationRuntimeWorkspace,
    memories: TeachingMemoryRecord[]
  ) => Promise<TemporaryChatContext>
}

export async function runTeachingConversationTurn(
  payload: AgentChatStreamPayload,
  stream: TeachingConversationRuntimeStream,
  workspace: TeachingConversationRuntimeWorkspace | null,
  deps: TeachingConversationRuntimeDeps
): Promise<AgentChatStreamResult> {
  const userInput = payload.userInput.trim()
  if (!userInput) {
    return { error: true, message: '消息不能为空。' }
  }
  if (stream.signal?.aborted) {
    return { canceled: true }
  }

  const settings = await deps.loadSettings()
  const provider = resolveActiveProvider(settings)
  const isTeachingConversation = (payload.mode ?? 'teaching') === 'teaching'
  const chatMode: AgentChatMode = isTeachingConversation ? 'teaching' : 'temporary'
  const workspaceRoot = isTeachingConversation ? workspace?.rootPath : undefined
  const memoryWorkspaceRoot = workspace?.rootPath
  const existingMemories = await deps.listMemories(memoryWorkspaceRoot)

  const pendingMemoryCandidate = extractPendingLearnerMemoryCandidate(
    latestAssistantContent(payload.messages ?? [])
  )
  const directConsentOnly = pendingMemoryCandidate && isBareMemoryConsentResponse(userInput)
  const consentDecision = directConsentOnly ? classifyMemoryConsentResponse(userInput) : null
  if (memoryWorkspaceRoot && pendingMemoryCandidate && consentDecision) {
    if (consentDecision === 'approve') {
      const memory = await deps.createMemory({
        content: pendingMemoryCandidate.content,
        scope: 'user',
        tags: pendingMemoryCandidate.tags,
        confidence: pendingMemoryCandidate.confidence,
        workspaceRoot: memoryWorkspaceRoot
      })
      const finalText = '已记录到用户记忆。后续课程会把这条信息作为长期背景使用。'
      return {
        turns: directAgentTurns(payload.messages ?? [], userInput, finalText),
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
    return {
      turns: directAgentTurns(payload.messages ?? [], userInput, finalText),
      finalText,
      iterations: 0,
      toolsSupported: false,
      memoryCapture: {
        action: 'rejected',
        candidateContent: pendingMemoryCandidate.content
      }
    }
  }

  if (!provider || !provider.apiKey.trim()) {
    return { error: true, message: '未配置 API Key。' }
  }

  const ctx = buildToolContext(settings, { workspaceRoot })
  const registry = settings.tools.enabled && isTeachingConversation
    ? buildDefaultRegistry(settings, { workspaceRoot, workspaceWrite: true })
    : new ToolRegistry()
  // The `ask` tool is a pure conversational decision tool — registered
  // whenever tool calling is enabled (teaching or temporary mode) so the
  // model can present clickable options at a real user-owned fork. It
  // respects the master `tools.enabled` switch like every other tool.
  if (settings.tools.enabled) {
    registry.register(createAskToolEntry({ streamId: stream.streamId, signal: stream.signal }))
  }
  // Lesson generation is a tool of this conversation, not a parallel
  // pipeline: the agent clarifies, decides readiness, and hands a structured
  // brief to the same generator the direct entry uses.
  const generatedLessons: LessonSummary[] = []
  const generateLessonFromBrief = deps.generateLessonFromBrief
  const lessonToolEnabled =
    isTeachingConversation && Boolean(workspace) && settings.tools.enabled && typeof generateLessonFromBrief === 'function'
  if (lessonToolEnabled && generateLessonFromBrief) {
    registry.register({
      definition: GENERATE_LESSON_TOOL_DEFINITION,
      handler: async (args) => {
        const brief = normalizeLessonBrief(args)
        if (!brief) {
          throw new Error(
            'generate_lesson 参数不完整：topic 与 firstLessonFocus 必须是有实际内容的完整句子。请根据对话内容补全后重新调用。'
          )
        }
        const lesson = await generateLessonFromBrief(brief)
        generatedLessons.push(lesson)
        return JSON.stringify({
          ok: true,
          lessonId: lesson.id,
          title: lesson.title,
          path: lesson.relativePath,
          message: `课程已生成并登记：${lesson.title}（${lesson.relativePath}）`
        })
      }
    })
  }

  const priorMessages: ChatMessage[] = (payload.messages ?? []).map(toChatMessage)
  const teachSkillReference = isTeachingConversation ? await readTeachSkillReference(workspaceRoot) : null
  const capturePlan = settings.memory.enabled && memoryWorkspaceRoot && !directConsentOnly
    ? planLearnerMemoryCapture(buildLearnerMemoryCandidate(userInput), existingMemories)
    : ({ action: 'none', reason: 'no_candidate' } as const)
  const temporaryContext = chatMode === 'temporary' && workspace
    ? await deps.buildTemporaryChatContext(workspace, existingMemories)
    : null
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildAgentChatSystemPrompt({
        mode: isTeachingConversation ? 'teaching' : 'temporary',
        lessonToolEnabled,
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
    shouldErrorOnMaxIterations: () =>
      lessonToolEnabled && generatedLessons.length === 0 && isLessonGenerationRequest(userInput),
    maxIterationsErrorMessage:
      '工具调用上限已用完，generate_lesson 尚未执行，所以课程尚未生成。请重试，或在设置里提高工具调用上限。',
    signal: stream.signal,
    callbacks: {
      onEvent: (event) => {
        const streamId = stream.streamId
        if (event.type === 'status') {
          stream.onStatus({ streamId, status: event.status, message: event.message })
        } else if (event.type === 'token') {
          stream.onChunk({ streamId, delta: event.delta })
        } else if (event.type === 'tool_call') {
          stream.onTool({
            streamId,
            toolCall: {
              id: event.toolCall.id,
              name: event.toolCall.function.name,
              arguments: event.toolCall.function.arguments
            }
          })
        } else if (event.type === 'tool_result') {
          stream.onTool({
            streamId,
            toolCall: { id: event.toolCallId, name: event.name, arguments: '' },
            result: event.result,
            isError: event.isError
          })
        }
      }
    }
  })

  if (result.stopReason === 'canceled') {
    return { canceled: true }
  }
  const recovered = await recoverLessonGenerationAfterToolBudget({
    result,
    userInput,
    payloadMessages: payload.messages ?? [],
    workspace,
    lessonToolEnabled,
    generatedLessons,
    generateLessonFromBrief,
    stream
  })
  if (recovered) return recovered
  if (result.error) {
    return { error: true, message: result.error }
  }
  if (stream.signal?.aborted) {
    return { canceled: true }
  }

  let finalText = result.finalText
  let messagesWithMemory = result.messages
  let memoryCapture: TeachingMemoryCaptureResult | undefined
  if (memoryWorkspaceRoot && capturePlan.action === 'create') {
    const memory = await deps.createMemory({
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
    generatedLessons: generatedLessons.length > 0 ? generatedLessons : undefined,
    memoryCapture
  }
}

type TeachSkillReference = {
  source: string
  content: string
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
  lessonToolEnabled: boolean
  teachSkillReference: TeachSkillReference | null
  memoryCapturePlan?: ReturnType<typeof planLearnerMemoryCapture>
  settings?: TeachingSettingsV1
  provider?: ReturnType<typeof resolveActiveProvider>
  temporaryContext?: TemporaryChatContext | null
}): string {
  const {
    mode,
    lessonToolEnabled,
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
        '</teach-skill-reference>'
      ].join('\n')

  const memoryLines = buildMemoryCapturePromptLines(memoryCapturePlan)
  const runtimeLines = buildModelRuntimePromptLines(settings, provider)
  const modeLines = mode === 'temporary'
    ? buildTemporaryChatPromptLines(temporaryContext)
    : ''

  if (mode === 'temporary') {
    return `${TEMPORARY_AGENT_CHAT_SYSTEM_PROMPT}${modeLines ? `\n\n${modeLines}` : ''}${runtimeLines ? `\n\n${runtimeLines}` : ''}${memoryLines ? `\n\n${memoryLines}` : ''}\n\n${ASK_TOOL_POLICY_PROMPT}`
  }

  const lessonPolicy = lessonToolEnabled
    ? LESSON_TOOL_POLICY_PROMPT
    : LESSON_TOOL_UNAVAILABLE_PROMPT
  return `${AGENT_CHAT_SYSTEM_PROMPT}\n\n${lessonPolicy}\n\n${ASK_TOOL_POLICY_PROMPT}\n\n${skillReference}${runtimeLines ? `\n\n${runtimeLines}` : ''}${memoryLines ? `\n\n${memoryLines}` : ''}`
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

function toChatMessage(message: AgentChatMessage): ChatMessage {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content ?? '' }
  }
  if (message.role === 'assistant') {
    const toolCalls =
      message.toolCalls && message.toolCalls.length > 0
        ? message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function' as const,
            function: { name: toolCall.name, arguments: toolCall.arguments }
          }))
        : undefined
    return { role: 'assistant', content: message.content, tool_calls: toolCalls }
  }
  if (message.role === 'user') return { role: 'user', content: message.content ?? '' }
  return { role: 'system', content: message.content ?? '' }
}

function toAgentTurns(messages: ChatMessage[]): AgentChatTurn[] {
  const turns: AgentChatTurn[] = []
  let counter = 0
  const createdAt = new Date().toISOString()
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ id: `t${counter++}`, role: 'user', content: message.content ?? '', createdAt })
    } else if (message.role === 'assistant') {
      const toolCalls = message.tool_calls?.map((toolCall) => {
        const resultMessage = messages.find(
          (candidate) => candidate.role === 'tool' && candidate.tool_call_id === toolCall.id
        )
        const content = resultMessage ? resultMessage.content : undefined
        return {
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
          result: content ?? undefined,
          isError: content ? /\berror\b/i.test(content) : undefined
        }
      })
      turns.push({
        id: `t${counter++}`,
        role: 'assistant',
        content: message.content ?? '',
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

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value || '{}')
  } catch {
    return {}
  }
}

async function recoverLessonGenerationAfterToolBudget(options: {
  result: Awaited<ReturnType<typeof runAgentLoop>>
  userInput: string
  payloadMessages: AgentChatMessage[]
  workspace: TeachingConversationRuntimeWorkspace | null
  lessonToolEnabled: boolean
  generatedLessons: LessonSummary[]
  generateLessonFromBrief?: (brief: LessonBrief) => Promise<LessonSummary>
  stream: TeachingConversationRuntimeStream
}): Promise<AgentChatStreamResult | null> {
  const {
    result,
    userInput,
    payloadMessages,
    workspace,
    lessonToolEnabled,
    generatedLessons,
    generateLessonFromBrief,
    stream
  } = options
  if (
    !lessonToolEnabled ||
    generatedLessons.length > 0 ||
    !generateLessonFromBrief ||
    !workspace ||
    !shouldRecoverLessonGenerationAfterToolBudget({ userInput, result })
  ) {
    return null
  }
  if (stream.signal?.aborted) return { canceled: true }

  const brief = findLatestGenerateLessonBrief(result.messages) ??
    buildRecoveryLessonBrief({ userInput, payloadMessages, workspace })
  stream.onStatus({ streamId: stream.streamId, status: 'tool_running', message: 'generate_lesson' })
  try {
    const lesson = await generateLessonFromBrief(brief)
    generatedLessons.push(lesson)
    const finalText = `课程已生成：${lesson.title}\n\n保存路径：${lesson.relativePath}\n\n下一步建议：打开这节课通读一遍，学完后继续告诉我哪里偏简单或哪里需要加深。`
    stream.onChunk({ streamId: stream.streamId, delta: finalText })
    stream.onStatus({ streamId: stream.streamId, status: 'done' })
    return {
      turns: toAgentTurns([...result.messages, { role: 'assistant', content: finalText }]),
      finalText,
      iterations: result.iterations,
      toolsSupported: result.toolsSupported,
      degradedReason: result.degradedReason,
      generatedLessons
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stream.onStatus({ streamId: stream.streamId, status: 'error', message })
    return { error: true, message: `工具调用上限已用完，自动补生成课程也失败：${message}` }
  }
}

function buildRecoveryLessonBrief(options: {
  userInput: string
  payloadMessages: AgentChatMessage[]
  workspace: TeachingConversationRuntimeWorkspace
}): LessonBrief {
  const userLines = options.payloadMessages
    .filter((message) => message.role === 'user')
    .map((message) => cleanText(message.content))
    .filter(Boolean)
    .slice(-4)
  const recentContext = [...userLines, cleanText(options.userInput)].filter(Boolean).join(' / ')
  const topic = deriveRecoveryLessonTopic(options.userInput, options.workspace)
  return {
    topic,
    firstLessonFocus: cleanText(
      `根据当前教学工作区的 MISSION.md、NOTES.md、已完成课程和学习记录，继续生成下一节正式课程；用户本轮要求是：${options.userInput}`
    ).slice(0, 600),
    goal: '继续当前教学工作区的课程进度，产出一节可保存、可复习的正式课程。',
    constraints: '优先沿用工作区已有课程规划；如果上一课偏简单，本节适当加深内容密度。',
    extraNotes: recentContext ? `最近用户原话：${recentContext}`.slice(0, 600) : undefined
  }
}

function shouldRecoverLessonGenerationAfterToolBudget(options: {
  userInput: string
  result: Awaited<ReturnType<typeof runAgentLoop>>
}): boolean {
  if (!isToolBudgetExhaustionResult(options.result)) return false
  if (isLessonGenerationRequest(options.userInput)) return true
  if (findLatestGenerateLessonBrief(options.result.messages)) return true
  const assistantTexts = [
    options.result.finalText,
    ...[...options.result.messages]
      .reverse()
      .filter((message) => message.role === 'assistant')
      .slice(0, 3)
      .map((message) => message.content ?? '')
  ].join('\n')
  return hasLessonGenerationIntent(assistantTexts)
}

function isToolBudgetExhaustionResult(result: Awaited<ReturnType<typeof runAgentLoop>>): boolean {
  if (result.stopReason === 'max_iterations') return true
  if (result.stopReason !== 'error') return false
  return /达到工具调用上限后/.test(result.error ?? '')
}

function findLatestGenerateLessonBrief(messages: ChatMessage[]): LessonBrief | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue
    const calls = [...(message.tool_calls ?? [])].reverse()
    for (const call of calls) {
      if (call.function.name !== 'generate_lesson') continue
      const brief = normalizeLessonBrief(safeParseJson(call.function.arguments))
      if (brief) return brief
    }
  }
  return null
}

function hasLessonGenerationIntent(value: string): boolean {
  const text = cleanText(value)
  if (!text) return false
  if (/(?:尚未|还没|未能|无法|不能|不会|失败|报错|错误|重试|提高工具调用上限|没有生成|未生成)/.test(text)) {
    return false
  }
  return [
    /(?:现在|马上|接下来|开始|继续|我来|帮你|为你|将|会).{0,32}(?:生成|创建|产出|保存).{0,32}(?:课程|课|lesson|session)/i,
    /(?:生成|创建|产出|保存).{0,32}(?:第一节|第一课|下一节|下一课|下节课|正式课程|lesson|session)/i,
    /(?:课程|课|lesson|session).{0,32}(?:已生成|已创建|已保存)/i
  ].some((pattern) => pattern.test(text))
}

function deriveRecoveryLessonTopic(
  userInput: string,
  workspace: TeachingConversationRuntimeWorkspace
): string {
  const text = cleanText(userInput)
  const extracted = [
    /(?:我想|想要|准备|打算)?(?:学习|学|了解|掌握|研究)\s*([^，。,.!?？\n]{2,40})/i,
    /(?:teach me|learn|study)\s+([^，。,.!?？\n]{2,40})/i
  ]
    .map((pattern) => pattern.exec(text)?.[1])
    .map((match) => cleanText(match))
    .find(Boolean)
  if (extracted) return extracted
  return `${workspace.name} 下一节课程`
}

function isLessonGenerationRequest(input: string): boolean {
  const text = cleanText(input).toLowerCase()
  if (!text) return false
  return [
    /(?:生成|创建|产出|保存).*(?:课程|课|lesson|session)/,
    /(?:课程|课|lesson|session).*(?:生成|创建|产出|保存)/,
    /(?:继续|开始|进入|上|讲|学|直接).*(?:下一节|下一课|下节课|第二节|第二课|第[一二三四五六七八九十0-9]+节|第[一二三四五六七八九十0-9]+课)/,
    /(?:下一节|下一课|下节课|第二节|第二课)/,
    /(?:next|continue|start).*(?:lesson|session|course)/
  ].some((pattern) => pattern.test(text))
}

const AGENT_CHAT_SYSTEM_PROMPT =
  '你是 TeachOS 的教学助手，负责这个教学工作区里的完整学习闭环：澄清学习需求、答疑、维护工作区文件、决定何时生成课程。' +
  '用户进入“教学”对话时，等价于在发送真实需求的同时引用了 teach skill：把它当作教学方法论，而不是必须照本宣科的固定流程。' +
  '保持主动判断：可以先回答、先澄清、读取工作区或建议下一步；只有在学习者基础/身份、目标、约束或第一步动作确实会影响教学质量时，才问 1 到 3 个具体问题，问完即止。' +
  '不要默认用户属于编程、AI、学生或任何固定人群；问题示例必须跟随用户当前主题、身份和场景。' +
  '回答使用简洁、准确的中文。' +
  '当用户询问当前教学工作区、mission、resources、课程文件、参考资料或学习记录时，优先调用 list_workspace、read_workspace_file、search_workspace 或 glob_workspace 读取本地文件后再回答；' +
  '你可以且应该用 write_workspace_file 维护 MISSION.md、RESOURCES.md、NOTES.md、GLOSSARY.md、reference/ 速查材料与 learning-records/ 学习记录，回复中只给出保存路径与简短摘要，不要把完整文件内容粘贴进聊天；' +
  'GLOSSARY.md 是术语真相来源：当对话或课程确立了新术语的标准写法时，用 write_workspace_file（overwrite: true）增量更新——追加到对应分区，或把占位项转正，不要整表重写；课程生成时会读它来保持术语一致。' +
  'learning-records/ 记录用户已展示的非平凡理解或纠正的误解（判定 + 对未来课程的影响），供后续课程的 zone of proximal development 决策；不要把每轮对话都写成记录，只在用户展示真实理解时追加新文件。' +
  '当问题涉及时效性、最新动态或课程库之外的事实性信息时，调用 web_search 工具检索后再作答，必要时用 web_fetch 深入阅读，回答中适度引用信息来源链接。' +
  '若未配置工具或当前模型不支持工具调用，直接依据自身知识作答即可。'

const LESSON_TOOL_POLICY_PROMPT = [
  '<lesson-generation-policy>',
  '正式课程只能通过 generate_lesson 工具产出；不要用 write_workspace_file 直接写 lessons/ 目录下的课程页面（该工具会拒绝这类写入）。',
  '当你已经基本清楚「教什么主题、为谁教、为什么学、本节课要完成什么动作」时，立即调用 generate_lesson：把这些信息整理成完整的中文句子填入参数，只填写对话中真实确认过的内容，不确定的字段留空，绝不能用碎片词或占位词充数。',
  '当用户要求“继续下一节/下一课/直接开始/直接生成”且已有足够上下文时，优先调用 generate_lesson；不要先做开放式 web_search、assets 检查或长篇资料收集，generate_lesson 后续流水线会负责课程计划生成。',
  '在当前轮次没有收到 generate_lesson 的 ok:true 工具结果之前，不要说课程已经生成、正在生成、开始生成或已保存。',
  '用户明确表示“直接生成、别问了”时，跳过澄清，基于已知信息与 MISSION.md 直接调用 generate_lesson。',
  '生成成功后：向用户简短汇报课程标题与保存路径，并给一句下一步建议。生成失败时：如实转述失败原因，可建议重试或调整，不要假装已生成，也不要改用其他方式硬写课程文件。',
  '生成成功后的增量维护（与汇报同轮完成，不要拖到下一轮）：若本课引入了新术语，立即用 write_workspace_file（overwrite: true）把 GLOSSARY.md 对应分区增量更新（追加或把占位项转正）；若用户在近期对话中展示了非平凡理解或纠正了误解，写一条 learning-records/00NN-<slug>.md（判定 + 对未来课程的影响）。这两步是 TeachOS 学习闭环的核心，不是可选项。',
  '</lesson-generation-policy>'
].join('\n')

const LESSON_TOOL_UNAVAILABLE_PROMPT = [
  '<lesson-generation-policy>',
  '当前会话未启用 generate_lesson 工具（工具未开启或没有激活的工作区）。你可以澄清需求、答疑并维护工作区文件，但不要直接写 lessons/ 下的课程页面；若用户希望生成正式课程，提示其在设置中启用工具调用。',
  '</lesson-generation-policy>'
].join('\n')

const ASK_TOOL_POLICY_PROMPT = [
  '<ask-tool-policy>',
  '当存在真正属于用户的决策岔路（学习方向、身份基础、目标优先级、约束选择等，每个选项对应实质不同的后续路径）时，调用 ask 工具给出 1-4 个问题、每题 2-4 个具体选项，推荐项放第一个，然后等待 tool result。',
  '不要用 ask 询问有明显默认值或你能合理推断的决策；不要在散文里重复 ask 已经问过的内容。',
  '调用 ask 后会阻塞直到用户回答；在收到真实 ask tool result 之前，不要假设用户做了任何选择，也不要替用户挑选项。用户跳过未答的题，请视为"不要替我决定"。',
  '</ask-tool-policy>'
].join('\n')

const GENERATE_LESSON_TOOL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_lesson',
    description:
      '生成一节正式课程并保存到当前教学工作区（统一编号、渲染课程模板、写入课程索引与复习卡）。当学习主题、学习者背景、目标和本节课要完成的动作已经基本清楚时调用。参数请用完整中文句子，只填对话中真实确认过的信息。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '学习主题，例如「RAG 检索增强生成」'
        },
        firstLessonFocus: {
          type: 'string',
          description: '本节课要完成的最小可观察动作，完整句子，例如「用一张流程图讲清 RAG 的五个核心步骤，并给出可直接使用的面试话术」'
        },
        learnerProfile: {
          type: 'string',
          description: '学习者背景/基础/身份，完整句子；对话中未确认可留空'
        },
        goal: {
          type: 'string',
          description: '学习动机与目标，例如「准备面试，概念为主不写代码」；未确认可留空'
        },
        constraints: {
          type: 'string',
          description: '时间、设备、范围等约束，例如「每节课 15-20 分钟，不涉及编码实现」；未确认可留空'
        },
        extraNotes: {
          type: 'string',
          description: '其他对课程设计有用的说明（语气、深度、引用偏好等）；可留空'
        }
      },
      required: ['topic', 'firstLessonFocus']
    }
  }
}

const TEMPORARY_AGENT_CHAT_SYSTEM_PROMPT =
  '你是 TeachOS 的临时会话助手。' +
  '回答使用简洁、准确的中文。' +
  '当前不会提供工作区文件访问，也不会提供教学工作区工具；不要声称自己查看了本地文件、课程正文、mission、resources 或学习记录。' +
  '当用户询问现有课程时，只能基于已注入的课程概览回答；当用户要基于具体工作区文件继续学习时，提示其切换到教学对话。'
