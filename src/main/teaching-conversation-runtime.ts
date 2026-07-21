import { runAgentLoop, type AgentLoopEvent } from './ai/agent-loop'
import { createAgentEventBus, type AgentEventBus } from './ai/agent-event-bus'
import { attachAgentRunAuditMetadata } from './ai/agent-run-audit'
import { resolveActiveProvider, type ChatMessage } from './ai/provider-adapter'
import { buildDefaultRegistry, buildToolContext, ToolRegistry } from './ai/tools/registry'
import { loadAndMergeToolPolicyDocumentsFromWorkspace, toolPolicyDocumentOption } from './ai/tools/tool-policy-fs'
import { createAskToolEntry } from './ai/tools/ask'
import { createDelegationToolEntries } from './ai/tools/delegation'
import { createReadSkillResourceTool } from './ai/tools/skill-resource'
import { createMemoryTools } from './ai/tools/memory-tools'
import { AgentRunStore, emptyAgentRunUsage, normalizeAgentRunBudget } from './ai/agent-run-store'
import { recordTurnUsageObservation, type UsageApprovalStatus, type UsageLedgerStatus } from './usage-ledger'
import type { ContextCompactionOptions } from './ai/context-compactor'
import { deriveConversationTurnContext } from './teaching-conversation-turn-context'
import { finalizeLearnerMemoryCapture, resolveDirectMemoryConsent } from './teaching-conversation-memory'
import {
  createLessonToolLifecycle,
  lessonGenerationBudgetFallback,
  lessonGenerationSuccessFallback,
  lessonGenerationMaxIterations,
  lessonGenerationRunBudget
} from './teaching-conversation-lesson-tool'
import { createConversationPermissionResolver } from './teaching-conversation-permissions'
import { buildSessionStablePrefix, composeTeachingUserTurn, type TemporaryChatContext } from './teaching-conversation-prompt'
import { collapseConsecutiveAssistantTurns, sanitizeAgentTurnContent } from '../shared/agent-conversation-turns'
import { buildLearnerMemoryCandidate, planLearnerMemoryCapture } from '../shared/teaching-memory-capture'
import type { LessonBrief } from '../shared/teaching-workflow'
import type {
  AgentChatMessage,
  AgentChatStreamChunk,
  AgentChatStreamPayload,
  AgentChatStreamResult,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentChatTurn,
  AgentRealtimeEvent,
  CreateTeachingMemoryPayload,
  LessonSummary,
  InstalledSkillReference,
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
  /** Explicit grant from the domain service; missing values deny file-tool access. */
  workspaceToolAccessGranted: boolean
}

export type { TemporaryChatContext } from './teaching-conversation-prompt'
export { buildAgentChatSystemPrompt, buildSessionStablePrefix, composeTeachingUserTurn } from './teaching-conversation-prompt'

export type TeachingConversationRuntimeStream = {
  streamId: string
  signal?: AbortSignal
  onChunk: (chunk: AgentChatStreamChunk) => void
  onStatus: (status: AgentChatStreamStatus) => void
  onTool: (event: AgentChatStreamToolEvent) => void
  onRealtimeEvent?: (event: AgentRealtimeEvent) => void
  onEventBusReady?: (eventBus: AgentEventBus) => void
}

export type TeachingConversationRuntimeDeps = {
  loadSettings: () => Promise<TeachingSettingsV1>
  listMemories: (workspaceRoot?: string, includeDeleted?: boolean) => Promise<TeachingMemoryRecord[]>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  deleteMemory?: (memoryId: string, workspaceRoot?: string) => Promise<void>
  loadSkillReferences: (skillIds: string[], userInput: string) => Promise<InstalledSkillReference[]>
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
  runStore: AgentRunStore
  /**
   * Optional app-data root for the append-only usage ledger (DB-P0-3).
   * When omitted, usage observation is skipped. Failures never fail the turn.
   */
  appDataRoot?: string
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
  const budget = normalizeAgentRunBudget(settings.tools.runBudget)
  await deps.runStore.create({
    runId: stream.streamId,
    streamId: stream.streamId,
    workspaceId: payload.workspaceId,
    conversationId: payload.conversationId,
    parentTurn: { userInput },
    budget
  })
  try {
    const result = await runTeachingConversationTurnActive(payload, stream, workspace, {
      ...deps,
      loadSettings: async () => settings
    })
    const usage = result.usage ?? emptyAgentRunUsage()
    const status = 'canceled' in result
      ? 'canceled'
      : 'error' in result
        ? 'failed'
        : 'awaiting_conversation_save'
    if ('turns' in result) {
      await deps.runStore.confirmParentTurnFinal(stream.streamId, result.finalText)
    } else {
      await deps.runStore.markParentTurnTerminal(
        stream.streamId,
        'canceled' in result ? 'canceled' : 'failed',
        'error' in result ? result.message : '运行已取消。'
      )
    }
    await deps.runStore.update(stream.streamId, {
      status,
      ...(status === 'awaiting_conversation_save' ? {} : { completedAt: new Date().toISOString() }),
      usage,
      stopReason: 'stopReason' in result ? result.stopReason : status
    })
    await deps.runStore.flush()
    await observeTurnUsageBestEffort({
      deps,
      payload,
      workspace,
      streamId: stream.streamId,
      result,
      usage,
      status: status === 'awaiting_conversation_save' ? 'completed' : status === 'canceled' ? 'canceled' : 'failed'
    })
    return result
  } catch (error) {
    await deps.runStore.markParentTurnTerminal(
      stream.streamId,
      stream.signal?.aborted ? 'canceled' : 'failed',
      error instanceof Error ? error.message : String(error)
    ).catch(() => undefined)
    await deps.runStore.update(stream.streamId, {
      status: stream.signal?.aborted ? 'canceled' : 'failed',
      completedAt: new Date().toISOString(),
      stopReason: stream.signal?.aborted ? 'canceled' : 'error'
    }).catch(() => undefined)
    await deps.runStore.flush().catch(() => undefined)
    await observeTurnUsageBestEffort({
      deps,
      payload,
      workspace,
      streamId: stream.streamId,
      result: { error: true, message: error instanceof Error ? error.message : String(error), usage: emptyAgentRunUsage() },
      usage: emptyAgentRunUsage(),
      status: stream.signal?.aborted ? 'canceled' : 'failed'
    })
    throw error
  }
}

async function runTeachingConversationTurnActive(
  payload: AgentChatStreamPayload,
  stream: TeachingConversationRuntimeStream,
  workspace: TeachingConversationRuntimeWorkspace | null,
  deps: TeachingConversationRuntimeDeps
): Promise<AgentChatStreamResult> {
  const userInput = payload.userInput.trim()

  const settings = await deps.loadSettings()
  const provider = resolveActiveProvider(settings)
  const conversation = deriveConversationTurnContext({
    mode: payload.mode,
    workspace,
    toolsEnabled: settings.tools.enabled,
    hasLessonGenerator: typeof deps.generateLessonFromBrief === 'function'
  })
  const existingMemories = await deps.listMemories(conversation.memoryWorkspaceRoot)

  const directMemoryConsent = await resolveDirectMemoryConsent({
    userInput,
    previousAssistantContent: latestAssistantContent(payload.messages ?? []),
    workspaceRoot: conversation.memoryWorkspaceRoot,
    createMemory: deps.createMemory
  })
  if (directMemoryConsent.handled) {
    return {
      turns: directAgentTurns(payload.messages ?? [], userInput, directMemoryConsent.finalText),
      finalText: directMemoryConsent.finalText,
      iterations: 0,
      toolsSupported: false,
      usage: emptyAgentRunUsage(),
      memoryCapture: directMemoryConsent.memoryCapture
    }
  }
  const directConsentOnly = directMemoryConsent.isBareConsentResponse

  if (!provider || !provider.apiKey.trim()) {
    return { error: true, message: '未配置 API Key。' }
  }

  const eventBus = createAgentEventBus({
    streamId: stream.streamId,
    onChunk: stream.onChunk,
    onStatus: stream.onStatus,
    onTool: stream.onTool,
    onRealtimeEvent: stream.onRealtimeEvent,
    onRecorded: (event) => {
      void deps.runStore.recordParentTurnEvent(stream.streamId, event).catch(() => undefined)
    }
  })
  stream.onEventBusReady?.(eventBus)

  // Optional workspace tool-policy (ADR-0083 / ADR-0115 / B-08): multi-path load+merge
  // (primary + optional course overlay); fail-closed; omit field on null so registry
  // keeps DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT (default-equivalent). Secondary miss
  // is fail-soft and keeps primary-only behavior identical to single-file load.
  const workspaceToolPolicy =
    conversation.workspaceRoot
      ? await loadAndMergeToolPolicyDocumentsFromWorkspace({
          workspaceRoot: conversation.workspaceRoot
        })
      : null

  const ctx = buildToolContext(settings, {
    workspaceRoot: conversation.workspaceRoot,
    signal: stream.signal,
    runId: stream.streamId,
    operationJournal: deps.runStore,
    requestToolPermission: createConversationPermissionResolver({
      runId: stream.streamId,
      signal: stream.signal,
      eventBus,
      onWaiting: async (permissionId) => {
        await deps.runStore.update(stream.streamId, {
          status: 'waiting_for_permission',
          pendingPermissionId: permissionId
        })
      },
      onResolved: async () => {
        await deps.runStore.update(stream.streamId, {
          status: 'running',
          pendingPermissionId: undefined
        })
      }
    }),
    ...toolPolicyDocumentOption(workspaceToolPolicy)
  })
  // Register the established candidates first, then project the completed registry
  // through the explicit turn policy below. The allow-list keeps new registrations
  // fail-closed until they are intentionally assigned to a teaching capability.
  const baseRegistry = settings.tools.enabled
    ? buildDefaultRegistry(
        settings,
        conversation.capabilityPolicy.workspaceToolsEnabled
          ? { workspaceRoot: conversation.workspaceRoot, workspaceWrite: true }
          : {}
      )
    : new ToolRegistry()
  // The `ask` tool is a pure conversational decision tool — registered
  // whenever tool calling is enabled (teaching or temporary mode) so the
  // model can present clickable options at a real user-owned fork. It
  // respects the master `tools.enabled` switch like every other tool.
  if (settings.tools.enabled) {
    baseRegistry.register(createAskToolEntry({
      streamId: stream.streamId,
      signal: stream.signal,
      onWaiting: async (toolCallId) => {
        await deps.runStore.update(stream.streamId, {
          status: 'waiting_for_elicitation',
          pendingElicitationId: toolCallId
        })
      },
      onResolved: async () => {
        await deps.runStore.update(stream.streamId, {
          status: 'running',
          pendingElicitationId: undefined
        }).catch(() => undefined)
      }
    }))
  }
  if (conversation.capabilityPolicy.delegationEnabled) {
    for (const tool of createDelegationToolEntries({
      provider,
      streamId: stream.streamId,
      signal: stream.signal,
      runStore: deps.runStore
    })) {
      baseRegistry.register(tool)
    }
  }
  // The lesson lifecycle stays inside this turn: it validates the brief,
  // prevents repeated failed calls, and exposes only successful lessons.
  const lessonTool = createLessonToolLifecycle({
    enabled: conversation.capabilityPolicy.lessonToolEnabled,
    generateLessonFromBrief: deps.generateLessonFromBrief
  })
  lessonTool.registerInto(baseRegistry)

  const priorMessages: ChatMessage[] = (payload.messages ?? []).map(toChatMessage)
  const requestedSkillIds = [...new Set((payload.skillIds ?? []).map((id) => id.trim()).filter(Boolean))]
  const activeSkillIds = conversation.isTeachingConversation
    ? [...new Set([...requestedSkillIds, 'teach'])]
    : requestedSkillIds
  const skillReferences = activeSkillIds.length > 0 || /^\/[a-z0-9][a-z0-9._-]{0,63}(?:\s|$)/i.test(userInput)
    ? await deps.loadSkillReferences(activeSkillIds, userInput)
    : []
  const skillResourceTool = settings.tools.enabled ? createReadSkillResourceTool(skillReferences) : null
  if (skillResourceTool) baseRegistry.register(skillResourceTool)
  // Slice F: memory search + human-approved synthetic teaching memory (no FTS).
  if (
    settings.tools.enabled &&
    settings.memory.enabled &&
    conversation.capabilityPolicy.workspaceToolsEnabled
  ) {
    for (const tool of createMemoryTools({
      memoryStore: {
        list: (workspaceRoot, includeDeleted) => deps.listMemories(workspaceRoot, includeDeleted),
        create: (payload) => deps.createMemory(payload),
        delete: async (id, workspaceRoot) => {
          if (!deps.deleteMemory) {
            throw new Error('Memory delete is not available for this turn.')
          }
          await deps.deleteMemory(id, workspaceRoot)
        }
      }
    })) {
      baseRegistry.register(tool)
    }
  }
  const registry = baseRegistry.project({
    allow: conversation.capabilityPolicy.allowedToolNames,
    deny: conversation.capabilityPolicy.deniedToolNames
  })
  const availableTools = registry.definitions()
  const webSearchTool = availableTools.find((tool) => tool.function.name === 'web_search')
  const requiresFreshWebSearch = shouldRequireFreshWebSearch(userInput, Boolean(webSearchTool))
  let webSearchAttempted = false
  const toolHandlers = registry.handlerMap(ctx)
  if (requiresFreshWebSearch && toolHandlers.web_search) {
    const executeWebSearch = toolHandlers.web_search
    toolHandlers.web_search = async (args, callCtx) => {
      webSearchAttempted = true
      return executeWebSearch(args, callCtx)
    }
  }
  const capturePlan = settings.memory.enabled && conversation.memoryWorkspaceRoot && !directConsentOnly
    ? planLearnerMemoryCapture(buildLearnerMemoryCandidate(userInput), existingMemories)
    : ({ action: 'none', reason: 'no_candidate' } as const)
  const temporaryContext = conversation.mode === 'temporary' && workspace
    ? await deps.buildTemporaryChatContext(workspace, existingMemories)
    : null
  const priorMessageTurnIds = payload.messageTurnIds?.length === priorMessages.length
    ? payload.messageTurnIds.map((id) => id || undefined)
    : priorMessages.map(() => undefined)
  const priorMessagesWithTurnIds = priorMessages
    .map((message, index) => ({ message, turnId: priorMessageTurnIds[index] }))
    .filter(({ message }) => message.role !== 'system')
  const promptOptions = {
    mode: conversation.mode,
    lessonToolEnabled: lessonTool.enabled,
    skillReferences,
    memoryCapturePlan: capturePlan,
    existingMemories,
    settings,
    provider,
    temporaryContext,
    visiblePageContext: payload.context
  } as const
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSessionStablePrefix(promptOptions)
    },
    ...priorMessagesWithTurnIds.map(({ message }) => message),
    { role: 'user', content: [composeTeachingUserTurn(promptOptions), userInput].filter(Boolean).join('\n\n') }
  ]
  const messageTurnIds = [
    undefined,
    ...priorMessagesWithTurnIds.map(({ turnId }) => turnId),
    undefined
  ]
  const lessonGenerationRequested = lessonTool.isGenerationRequested(userInput)
  const maxIterations = lessonGenerationRequested
    ? lessonGenerationMaxIterations(settings.tools.maxIterations)
    : settings.tools.maxIterations
  // Keep the longer ceiling available for every turn that can invoke the
  // durable lesson pipeline. The model may legitimately call generate_lesson
  // after a short confirmation such as “开始吧”, which is not always matched
  // by the explicit generation-intent heuristic above.
  const runBudget = lessonTool.enabled
    ? lessonGenerationRunBudget(settings.tools.runBudget)
    : settings.tools.runBudget
  if (runBudget !== settings.tools.runBudget) {
    await deps.runStore.update(stream.streamId, { budget: runBudget })
  }

  const lessonIterationRecovery = lessonGenerationRequested
    ? (() => {
        const generateLessonTool = availableTools.find((tool) => tool.function.name === 'generate_lesson')
        return generateLessonTool
          ? {
              shouldAttempt: () => !lessonTool.hasAttemptedGeneration(),
              instruction:
                '常规规划轮次已经结束。现在只执行课程生成：立即根据已确认的对话内容调用 generate_lesson；不要调用其他工具，也不要继续提问。',
              tools: [generateLessonTool],
              toolChoice: { type: 'function' as const, function: { name: 'generate_lesson' } },
              maxAttempts: 2
            }
          : undefined
      })()
    : undefined
  const webSearchIterationRecovery = requiresFreshWebSearch && webSearchTool
    ? {
        shouldAttempt: () => !webSearchAttempted,
        instruction:
          '这个问题需要核实当前公开信息。现在只调用 web_search 搜索权威来源；不要直接凭记忆回答，也不要调用其他工具。',
        tools: [webSearchTool],
        toolChoice: { type: 'function' as const, function: { name: 'web_search' } },
        maxAttempts: 1
      }
    : undefined

  const runEvents: AgentLoopEvent[] = []
  const result = await runAgentLoop({
    settings,
    provider,
    messages,
    messageTurnIds,
    tools: availableTools,
    toolHandlers,
    workspaceRoot: conversation.workspaceRoot,
    runId: stream.streamId,
    initialToolChoice: requiresFreshWebSearch
      ? { type: 'function', function: { name: 'web_search' } }
      : undefined,
    maxIterations,
    shouldErrorOnMaxIterations: () =>
      lessonGenerationRequested && !lessonTool.hasAttemptedGeneration(),
    maxIterationsErrorMessage:
      '本轮操作次数已达到上限，课程尚未生成。当前对话和规划内容已保留；请继续发送“生成课程”重试，或在设置中提高工具调用上限。',
    iterationLimitRecovery: lessonIterationRecovery ?? webSearchIterationRecovery,
    contextCompaction: buildContextCompactionOptions(payload.contextCompaction),
    budget: runBudget,
    budgetExhaustionFallback: (reason) =>
      lessonGenerationBudgetFallback(lessonTool.generatedLessons(), reason),
    durableSuccessFallback: () =>
      lessonGenerationSuccessFallback(lessonTool.generatedLessons()),
    shouldFinalizeAfterToolExecution: () => lessonTool.generatedLessons().length > 0,
    signal: stream.signal,
    callbacks: {
      onEvent: (event) => {
        runEvents.push(event)
        eventBus.publishLoopEvent(event)
      }
    }
  })

  if (result.stopReason === 'canceled') {
    return { canceled: true, usage: result.usage }
  }
  if (result.error) {
    return { error: true, message: result.error, usage: result.usage }
  }
  if (lessonGenerationRequested && !lessonTool.hasAttemptedGeneration()) {
    return {
      error: true,
      message: lessonTool.missingGenerationMessage(),
      usage: result.usage
    }
  }
  if (stream.signal?.aborted) {
    return { canceled: true }
  }

  const memoryOutcome = await finalizeLearnerMemoryCapture({
    workspaceRoot: conversation.memoryWorkspaceRoot,
    capturePlan,
    createMemory: deps.createMemory,
    finalText: result.finalText,
    messages: result.messages,
    appendToLastAssistantMessage,
    publishConsentPrompt: (prompt) => eventBus.publishChunk(prompt)
  })

  const generatedLessons = lessonTool.generatedLessons()
  return {
    turns: attachAgentRunAuditMetadata(toAgentTurns(memoryOutcome.messages), runEvents, result.usage),
    finalText: memoryOutcome.finalText,
    iterations: result.iterations,
    toolsSupported: result.toolsSupported,
    degradedReason: result.degradedReason,
    generatedLessons: generatedLessons.length > 0 ? generatedLessons : undefined,
    memoryCapture: memoryOutcome.memoryCapture,
    usage: result.usage,
    stopReason: result.stopReason
  }
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
        content: sanitizeAgentTurnContent(message.content),
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        createdAt
      })
    }
  }
  // Provider tool loops emit many assistant messages per user prompt. Persist them as
  // one coherent assistant turn so the completed UI does not re-split into plan cards.
  return collapseConsecutiveAssistantTurns(turns)
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
    { id: `t${prior.length + 1}`, role: 'assistant', content: sanitizeAgentTurnContent(assistantText), createdAt }
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

function buildContextCompactionOptions(
  request: AgentChatStreamPayload['contextCompaction']
): ContextCompactionOptions | undefined {
  if (!request) return undefined
  return {
    enabled: request.enabled,
    force: request.force,
    contextWindowTokens: request.contextWindowTokens,
    softThresholdTokens: request.softThresholdTokens,
    hardThresholdTokens: request.hardThresholdTokens
  }
}

function shouldRequireFreshWebSearch(userInput: string, webSearchAvailable: boolean): boolean {
  if (!webSearchAvailable) return false
  const input = userInput.trim()
  if (!input) return false

  // The user can explicitly opt out of network use even for a normally fresh fact.
  if (/(?:不要|无需|不用|别).{0,8}(?:联网|上网|网络|网页|搜索|检索|查询)/u.test(input)) return false

  const explicitSearchRequest = /(?:联网|上网|网络|网页|互联网|web).{0,12}(?:查|搜索|检索|查询)|(?:查|搜索|检索|查询).{0,12}(?:联网|上网|网络|网页|互联网|web)/iu
  if (explicitSearchRequest.test(input)) return true

  const freshnessCue = /今年|最新|今天|近期|当前|现在|何时|什么时候|几时|哪天|何日|何月|出分|公布|发布|开售|上线|更新/iu
  const timeSensitiveFact = /(?:四|4)[六6]级|\bCET\b|成绩|考试|报名|录取|招生|政策|法规|价格|汇率|天气|新闻|比赛|赛程|股价|版本|发布会|日期|时间/iu
  return freshnessCue.test(input) && timeSensitiveFact.test(input)
}

type ObserveTurnUsageInput = {
  deps: TeachingConversationRuntimeDeps
  payload: AgentChatStreamPayload
  workspace: TeachingConversationRuntimeWorkspace | null
  streamId: string
  result: AgentChatStreamResult
  usage: import('../shared/teaching-types').AgentRunUsageAggregate
  status: UsageLedgerStatus
}

/**
 * Best-effort usage ledger write. Projection/ledger faults must never fail the turn.
 */
async function observeTurnUsageBestEffort(input: ObserveTurnUsageInput): Promise<void> {
  const appDataRoot = input.deps.appDataRoot
  if (!appDataRoot) return
  try {
    const settings = await input.deps.loadSettings().catch(() => null)
    const provider = settings ? resolveActiveProvider(settings) : null
    const tools = collectToolUsageFromResult(input.result)
    await recordTurnUsageObservation({
      appDataRoot,
      workspaceRoot: input.workspace?.rootPath,
      provider: provider?.id,
      model: settings?.generator.model,
      conversationId: input.payload.conversationId,
      traceId: input.streamId,
      turnId: input.streamId,
      status: input.status,
      usage: input.usage,
      tools
    })
  } catch {
    // Observability must never affect turn success.
  }
}

function collectToolUsageFromResult(result: AgentChatStreamResult): Array<{
  toolName: string
  approvalStatus?: UsageApprovalStatus
  isError?: boolean
}> {
  if (!('turns' in result) || !Array.isArray(result.turns)) return []
  const tools: Array<{ toolName: string; approvalStatus?: UsageApprovalStatus; isError?: boolean }> = []
  for (const turn of result.turns) {
    for (const tool of turn.toolCalls ?? []) {
      if (!tool?.name) continue
      tools.push({
        toolName: tool.name,
        isError: tool.isError === true,
        approvalStatus: 'not_required'
      })
    }
  }
  return tools
}
