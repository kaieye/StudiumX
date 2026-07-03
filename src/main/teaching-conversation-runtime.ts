import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runAgentLoop } from './ai/agent-loop'
import { resolveActiveProvider, type ChatMessage } from './ai/provider-adapter'
import { buildDefaultRegistry, buildToolContext, ToolRegistry } from './ai/tools/registry'
import {
  buildLearnerMemoryCandidate,
  buildMemoryConsentPrompt,
  classifyMemoryConsentResponse,
  extractPendingLearnerMemoryCandidate,
  isBareMemoryConsentResponse,
  planLearnerMemoryCapture
} from '../shared/teaching-memory-capture'
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
  TeachingClarificationResult,
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
  assessTeachingRequest: (options: {
    workspace: TeachingConversationRuntimeWorkspace
    userInput: string
    messages: AgentChatMessage[]
  }) => Promise<TeachingClarificationResult>
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

  const teachingAssessment = isTeachingConversation && workspace
    ? await deps.assessTeachingRequest({
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
    ? buildDefaultRegistry(settings, { workspaceRoot, workspaceWrite: true })
    : new ToolRegistry()
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
    teachingAssessment: teachingAssessment ?? undefined,
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

const AGENT_CHAT_SYSTEM_PROMPT =
  '你是 TeachOS 的学习助手。' +
  '用户进入“教学”对话时，等价于在发送真实需求的同时引用了 teach skill：把它当作教学工作区方法论和可用上下文，而不是必须照本宣科的固定流程。' +
  '保持主动判断：可以先回答、先澄清、读取工作区、建议下一步或生成课程计划；只有在学习者基础/身份、目标、约束或第一步动作确实会影响教学质量时，才问 1 到 3 个具体问题。' +
  '不要默认用户属于编程、AI、学生或任何固定人群；问题示例必须跟随用户当前主题、身份和场景。' +
  '回答使用简洁、准确的中文。' +
  '当用户询问当前教学工作区、mission、resources、课程文件、参考资料或学习记录时，优先调用 list_workspace、read_workspace_file、search_workspace 或 glob_workspace 读取本地文件后再回答；' +
  '当用户要求制作、保存或更新 HTML/Markdown/JSON/课程文件时，优先调用 write_workspace_file 写入当前工作区；默认保存 lesson 到 lessons/*.html，并在回复中只给出保存路径、简短摘要和下一步建议，不要把完整文件内容粘贴进聊天；' +
  '当问题涉及时效性、最新动态或课程库之外的事实性信息时，调用 web_search 工具检索后再作答；' +
  '必要时可用 web_fetch 深入阅读某条结果。回答中适度引用信息来源链接。' +
  '若未配置工具或当前模型不支持工具调用，直接依据自身知识作答即可。'

const TEMPORARY_AGENT_CHAT_SYSTEM_PROMPT =
  '你是 TeachOS 的临时会话助手。' +
  '回答使用简洁、准确的中文。' +
  '当前不会提供工作区文件访问，也不会提供教学工作区工具；不要声称自己查看了本地文件、课程正文、mission、resources 或学习记录。' +
  '当用户询问现有课程时，只能基于已注入的课程概览回答；当用户要基于具体工作区文件继续学习时，提示其切换到教学对话。'
