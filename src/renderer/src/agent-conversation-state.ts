import {
  agentConversationAbsolutePath,
  courseRelativePathForAgentConversation,
  isTemporaryAgentConversationPath,
  pendingAgentConversationRelativePath
} from '../../shared/agent-conversation-catalog'
import type {
  AgentChatMessage,
  AgentChatMode,
  AgentChatProcessEvent,
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentChatTurn,
  AgentToolPermissionRequest,
  AgentTurnMetadata,
  AgentConversationSummary,
  AskAnswer,
  AskOption,
  AskQuestion,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../shared/teaching-types'

const TOOL_PERMISSION_NAME = 'tool_permission'

export type PendingAgentConversation = {
  workspaceId: string
  sourceConversationId: string | null
  mode: AgentChatMode
  summary: AgentConversationSummary & { pending: true }
  turns: AgentChatTurn[]
  status: string
  toolsSupported: boolean | null
}

export type SidebarConversationSummary = AgentConversationSummary & { pending?: true }

export type AgentConversationTurnDraft = {
  pendingConversationId: string
  sourceConversationId: string | null
  selectedCourseRelativePath: string | null
  selectedLessonPath: string | null
  assistantId: string
  priorMessages: AgentChatMessage[]
  initialTurns: AgentChatTurn[]
  pendingConversation: PendingAgentConversation
}

export type PendingConversationStorePatch = Partial<{
  agentChatBusy: boolean
  pendingAgentConversation: PendingAgentConversation | null
  agentTurns: AgentChatTurn[]
  activeConversationId: string | null
  agentStatus: string
  agentToolsSupported: boolean | null
}>

export function createAgentConversationTurnDraft({
  state,
  workspace,
  input,
  mode,
  activeConversationId,
  currentTurns,
  selectedCourseRelativePath,
  currentSelectedLessonPath,
  createdAt = new Date().toISOString(),
  idSeed = Date.now()
}: {
  state: TeachingAppState
  workspace: TeachingWorkspaceSummary
  input: string
  mode: AgentChatMode
  activeConversationId: string | null
  currentTurns: AgentChatTurn[]
  selectedCourseRelativePath: string | null
  currentSelectedLessonPath: string | null
  createdAt?: string
  idSeed?: number
}): AgentConversationTurnDraft {
  const pendingConversationId = `pending-${idSeed}`
  const sourceConversationId = activeConversationId?.startsWith('pending-') ? null : activeConversationId
  const sourceConversation = sourceConversationId
    ? findConversationSummary(state, workspace.id, sourceConversationId)
    : null
  const nextSelectedCourseRelativePath = sourceConversationId || mode === 'temporary' ? null : selectedCourseRelativePath
  const nextSelectedLessonPath = !sourceConversationId && nextSelectedCourseRelativePath ? currentSelectedLessonPath : null
  const userTurn: AgentChatTurn = {
    id: `u-${idSeed}`,
    role: 'user',
    content: input,
    createdAt
  }
  const assistantId = `a-${idSeed}`
  const assistantTurn: AgentChatTurn = {
    id: assistantId,
    role: 'assistant',
    content: '',
    processEvents: [createAgentStatusProcessEvent('thinking')],
    createdAt
  }
  const priorMessages = agentTurnsToMessages(currentTurns)
  const initialTurns = [...currentTurns, userTurn, assistantTurn]
  const pendingConversation: PendingAgentConversation = {
    workspaceId: workspace.id,
    sourceConversationId,
    mode,
    summary: createPendingAgentConversationSummary({
      id: pendingConversationId,
      titleSource: sourceConversation?.title ?? input,
      createdAt,
      turns: initialTurns,
      mode,
      selectedCourseRelativePath: nextSelectedCourseRelativePath,
      sourceConversation,
      workspaceRootPath: workspace.rootPath
    }),
    turns: initialTurns,
    status: '思考中…',
    toolsSupported: null
  }

  return {
    pendingConversationId,
    sourceConversationId,
    selectedCourseRelativePath: nextSelectedCourseRelativePath,
    selectedLessonPath: nextSelectedLessonPath,
    assistantId,
    priorMessages,
    initialTurns,
    pendingConversation
  }
}

export function syncPendingAgentConversation({
  pending,
  pendingConversationId,
  activeConversationId,
  patch,
  updatedAt = new Date().toISOString()
}: {
  pending: PendingAgentConversation | null
  pendingConversationId: string
  activeConversationId: string | null
  patch: Partial<Omit<PendingAgentConversation, 'workspaceId' | 'sourceConversationId' | 'summary'>>
  updatedAt?: string
}): PendingConversationStorePatch | null {
  if (!pending || pending.summary.id !== pendingConversationId) return null
  const nextPending: PendingAgentConversation = {
    ...pending,
    ...patch,
    summary: {
      ...pending.summary,
      updatedAt,
      messageCount: patch.turns?.length ?? pending.summary.messageCount
    }
  }
  return {
    pendingAgentConversation: nextPending,
    ...visiblePendingConversationPatch(nextPending, activeConversationId)
  }
}

export function applyAgentChatChunkToPending({
  pending,
  activeConversationId,
  assistantId,
  chunk,
  updatedAt
}: {
  pending: PendingAgentConversation | null
  activeConversationId: string | null
  assistantId: string
  chunk: AgentChatStreamChunk
  updatedAt?: string
}): PendingConversationStorePatch | null {
  if (!pending || chunk.streamId !== pending.summary.id) return null
  let changed = false
  const turns = pending.turns.map((turn) => {
    if (turn.id !== assistantId) return turn
    changed = true
    return { ...turn, content: `${turn.content}${chunk.delta}` }
  })
  if (!changed) return null
  return syncPendingAgentConversation({
    pending,
    pendingConversationId: pending.summary.id,
    activeConversationId,
    patch: { turns },
    updatedAt
  })
}

export function applyAgentChatStatusToPending({
  pending,
  activeConversationId,
  assistantId,
  status,
  updatedAt
}: {
  pending: PendingAgentConversation | null
  activeConversationId: string | null
  assistantId: string
  status: AgentChatStreamStatus
  updatedAt?: string
}): PendingConversationStorePatch | null {
  if (!pending || status.streamId !== pending.summary.id) return null
  const label = agentStatusLabel(status.status)
  const statusText = status.message?.startsWith('正在生成课程：')
    ? status.message
    : status.message
      ? `${label} ${status.message}`
      : label
  return syncPendingAgentConversation({
    pending,
    pendingConversationId: pending.summary.id,
    activeConversationId,
    patch: {
      status: statusText,
      turns: updateAgentAssistantTurn(pending.turns, assistantId, (turn) => ({
        ...turn,
        processEvents: appendAgentProcessEvent(
          turn.processEvents,
          createAgentStatusProcessEvent(status.status, status.message)
        )
      }))
    },
    updatedAt
  })
}

export function applyAgentChatToolEventToPending({
  pending,
  activeConversationId,
  assistantId,
  event,
  updatedAt
}: {
  pending: PendingAgentConversation | null
  activeConversationId: string | null
  assistantId: string
  event: AgentChatStreamToolEvent
  updatedAt?: string
}): PendingConversationStorePatch | null {
  if (!pending || event.streamId !== pending.summary.id) return null
  const turns = [...pending.turns]
  const idx = turns.findIndex((turn) => turn.id === assistantId)
  if (idx < 0) return null

  const existing = turns[idx].toolCalls ?? []
  const toolCallId = event.toolCall.id
  const existingIdx = existing.findIndex((toolCall) => toolCall.id === toolCallId)
  if (existingIdx >= 0 && event.result !== undefined) {
    const updated = [...existing]
    updated[existingIdx] = {
      ...updated[existingIdx],
      result: event.result,
      isError: event.isError
    }
    turns[idx] = { ...turns[idx], toolCalls: updated }
  } else if (existingIdx < 0) {
    turns[idx] = {
      ...turns[idx],
      toolCalls: [
        ...existing,
        {
          id: toolCallId,
          name: event.toolCall.name,
          arguments: event.toolCall.arguments,
          result: event.result,
          isError: event.isError
        }
      ]
    }
  }

  turns[idx] = {
    ...turns[idx],
    processEvents: appendAgentProcessEvent(
      turns[idx].processEvents,
      event.result !== undefined
        ? createAgentToolResultProcessEvent(event)
        : createAgentToolCallProcessEvent(event)
    )
  }

  return syncPendingAgentConversation({
    pending,
    pendingConversationId: pending.summary.id,
    activeConversationId,
    patch: { turns },
    updatedAt
  })
}

export function cancelPendingAgentConversation({
  pending,
  activeConversationId,
  preserveToolsSupported = false
}: {
  pending: PendingAgentConversation
  activeConversationId: string | null
  preserveToolsSupported?: boolean
}): PendingConversationStorePatch {
  const turns = markLatestAssistantTurnCanceled(pending.turns)
  const isVisible = activeConversationId === pending.summary.id
  return {
    agentChatBusy: false,
    pendingAgentConversation: null,
    ...(preserveToolsSupported
      ? {
          agentStatus: '',
          agentToolsSupported: pending.toolsSupported
        }
      : {}),
    ...(isVisible
      ? {
          agentTurns: turns,
          activeConversationId: null,
          agentStatus: '',
          agentToolsSupported: preserveToolsSupported ? pending.toolsSupported : null
        }
      : {})
  }
}

export function failPendingAgentConversation({
  pending,
  activeConversationId,
  assistantId
}: {
  pending: PendingAgentConversation
  activeConversationId: string | null
  assistantId: string
}): PendingConversationStorePatch {
  const turns = pending.turns.filter((turn) => turn.id !== assistantId)
  const isVisible = activeConversationId === pending.summary.id
  return {
    agentChatBusy: false,
    pendingAgentConversation: null,
    ...(isVisible
      ? {
          agentTurns: turns,
          activeConversationId: null,
          agentStatus: '',
          agentToolsSupported: null
        }
      : {})
  }
}

export function finishPendingAgentConversationSave({
  pending,
  activeConversationId,
  savedConversationId,
  turns,
  toolsSupported
}: {
  pending: PendingAgentConversation
  activeConversationId: string | null
  savedConversationId: string
  turns: AgentChatTurn[]
  toolsSupported: boolean
}): PendingConversationStorePatch {
  return {
    pendingAgentConversation: null,
    ...(activeConversationId === pending.summary.id
      ? {
          agentTurns: turns,
          activeConversationId: savedConversationId,
          agentStatus: '',
          agentToolsSupported: toolsSupported
        }
      : {})
  }
}

export function visiblePendingConversationPatch(
  pending: PendingAgentConversation,
  activeConversationId: string | null
): PendingConversationStorePatch {
  return activeConversationId === pending.summary.id
    ? {
        agentTurns: pending.turns,
        agentStatus: pending.status,
        agentToolsSupported: pending.toolsSupported
      }
    : {}
}

export function agentStatusLabel(status: AgentChatStreamStatus['status']): string {
  const labels: Record<AgentChatStreamStatus['status'], string> = {
    thinking: '思考中…',
    tool_running: '调用工具…',
    tool_done: '工具调用完成',
    answering: '生成答复…',
    done: '完成',
    canceled: '已中断',
    error: '出错'
  }
  return labels[status]
}

export function findConversationSummary(
  state: TeachingAppState,
  workspaceId: string,
  conversationId: string
): AgentConversationSummary | null {
  const workspace = state.workspaces.find((item) => item.id === workspaceId) ?? state.activeWorkspace
  const workspaceConversations = workspace
    ? [
        ...workspace.conversations,
        ...workspace.courses.flatMap((course) => course.conversations)
      ]
    : []
  return workspaceConversations.find((conversation) => conversation.id === conversationId) ??
    state.temporaryConversations.find((conversation) => conversation.id === conversationId) ??
    null
}

export function activeTeachingConversationSummary({
  state,
  workspaceId,
  activeConversationId,
  pendingAgentConversation
}: {
  state: TeachingAppState
  workspaceId: string | null | undefined
  activeConversationId: string | null
  pendingAgentConversation: PendingAgentConversation | null
}): AgentConversationSummary | null {
  if (!workspaceId || !activeConversationId) return null
  const conversation = pendingAgentConversation?.workspaceId === workspaceId &&
    pendingAgentConversation.summary.id === activeConversationId
    ? pendingAgentConversation.summary
    : findConversationSummary(state, workspaceId, activeConversationId)
  return conversation && !isTemporaryConversation(conversation) ? conversation : null
}

export function agentTurnsToMessages(turns: AgentChatTurn[]): AgentChatMessage[] {
  return turns
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .map((turn) => ({ role: turn.role, content: turn.content }))
}

export function isPendingConversationSummary(
  conversation: AgentConversationSummary | null | undefined
): conversation is SidebarConversationSummary & { pending: true } {
  return Boolean((conversation as SidebarConversationSummary | null | undefined)?.pending)
}

export function isTemporaryConversation(conversation: AgentConversationSummary): boolean {
  return isTemporaryAgentConversationPath(conversation.relativePath)
}

export function markLatestAssistantTurnCanceled(turns: AgentChatTurn[]): AgentChatTurn[] {
  const index = [...turns].reverse().findIndex((turn) => turn.role === 'assistant')
  if (index < 0) return turns
  const assistantIndex = turns.length - 1 - index
  return turns.map((turn, idx) =>
    idx === assistantIndex
      ? {
          ...turn,
          processEvents: appendAgentProcessEvent(
            turn.processEvents,
            createAgentStatusProcessEvent('canceled')
          )
        }
      : turn
  )
}

export function reconcileAgentTurnsWithLocalProcess(
  serverTurns: AgentChatTurn[],
  localTurns: AgentChatTurn[]
): AgentChatTurn[] {
  const localAssistantTurns = localTurns.filter((turn) => turn.role === 'assistant')
  let assistantIndex = 0
  return serverTurns.map((turn) => {
    if (turn.role !== 'assistant') return turn
    const localTurn = localAssistantTurns[assistantIndex]
    assistantIndex += 1
    const processEvents = localTurn?.processEvents?.length ? localTurn.processEvents : turn.processEvents
    const metadata = mergeAgentTurnMetadata(turn.metadata, localTurn?.metadata)
    if (processEvents === turn.processEvents && metadata === turn.metadata) return turn
    return {
      ...turn,
      processEvents,
      metadata
    }
  })
}

export function createPendingAgentConversationSummary({
  id,
  titleSource,
  createdAt,
  turns,
  mode,
  selectedCourseRelativePath,
  sourceConversation,
  workspaceRootPath
}: {
  id: string
  titleSource: string
  createdAt: string
  turns: AgentChatTurn[]
  mode: AgentChatMode
  selectedCourseRelativePath: string | null
  sourceConversation?: AgentConversationSummary | null
  workspaceRootPath: string
}): AgentConversationSummary & { pending: true } {
  const relativePath = sourceConversation?.relativePath ?? pendingAgentConversationRelativePath({
    id,
    mode,
    selectedCourseRelativePath
  })
  return {
    id,
    title: compactText(titleSource, 48) || '新对话',
    createdAt: sourceConversation?.createdAt ?? createdAt,
    updatedAt: createdAt,
    relativePath,
    absolutePath: sourceConversation?.absolutePath ?? (mode === 'temporary' ? '' : agentConversationAbsolutePath(workspaceRootPath, relativePath)),
    messageCount: turns.length,
    pending: true
  }
}

function createAgentProcessEventId(prefix: string): string {
  agentProcessEventCounter += 1
  return `${prefix}-${Date.now()}-${agentProcessEventCounter}`
}

function createAgentStatusProcessEvent(
  status: AgentChatStreamStatus['status'],
  message?: string
): AgentChatProcessEvent {
  const copy = agentProcessStatusCopy(status, message)
  return {
    id: createAgentProcessEventId('status'),
    kind: copy.kind ?? 'status',
    status,
    title: copy.title,
    detail: copy.detail,
    createdAt: new Date().toISOString()
  }
}

function createAgentToolCallProcessEvent(event: AgentChatStreamToolEvent): AgentChatProcessEvent {
  const name = event.toolCall.name || 'tool'
  if (name === TOOL_PERMISSION_NAME) {
    const request = event.permissionRequest ?? parsePermissionArguments(event.toolCall.arguments)
    return {
      id: createAgentProcessEventId('permission-request'),
      kind: 'permission_request',
      title: '等待写入审批',
      detail: request
        ? `${request.operation}${request.targetPath ? `：${request.targetPath}` : ''}`
        : compactText(prettyJson(event.toolCall.arguments), 180),
      toolCallId: event.toolCall.id,
      toolName: name,
      createdAt: new Date().toISOString()
    }
  }
  if (name === 'ask') {
    const questions = parseAskArguments(event.toolCall.arguments)
    const firstQuestion = questions?.[0]?.prompt
    return {
      id: createAgentProcessEventId('elicitation-request'),
      kind: 'elicitation_request',
      title: '等待用户选择',
      detail: firstQuestion
        ? compactText(firstQuestion, 180)
        : compactText(prettyJson(event.toolCall.arguments), 180),
      toolCallId: event.toolCall.id,
      toolName: name,
      createdAt: new Date().toISOString()
    }
  }
  return {
    id: createAgentProcessEventId('tool-call'),
    kind: 'tool_call',
    title: `调用工具：${name}`,
    detail: compactText(prettyJson(event.toolCall.arguments), 180),
    toolCallId: event.toolCall.id,
    toolName: name,
    createdAt: new Date().toISOString()
  }
}

function createAgentToolResultProcessEvent(event: AgentChatStreamToolEvent): AgentChatProcessEvent {
  const name = event.toolCall.name || 'tool'
  if (name === TOOL_PERMISSION_NAME) {
    return {
      id: createAgentProcessEventId('permission-result'),
      kind: 'permission_resolved',
      title: event.isError ? '写入审批已拒绝' : '写入审批已允许',
      detail: compactText(prettyJson(event.result ?? ''), 180),
      toolCallId: event.toolCall.id,
      toolName: name,
      isError: event.isError,
      createdAt: new Date().toISOString()
    }
  }
  if (name === 'ask') {
    return {
      id: createAgentProcessEventId('elicitation-result'),
      kind: 'elicitation_resolved',
      title: event.isError ? '用户选择处理失败' : '用户选择已提交',
      detail: compactText(prettyJson(event.result ?? ''), 180),
      toolCallId: event.toolCall.id,
      toolName: name,
      isError: event.isError,
      createdAt: new Date().toISOString()
    }
  }
  return {
    id: createAgentProcessEventId('tool-result'),
    kind: 'tool_result',
    title: event.isError ? `工具失败：${name}` : `工具完成：${name}`,
    detail: compactText(prettyJson(event.result ?? ''), 180),
    toolCallId: event.toolCall.id,
    toolName: name,
    isError: event.isError,
    createdAt: new Date().toISOString()
  }
}

function agentProcessStatusTitle(status: AgentChatStreamStatus['status']): string {
  const labels: Record<AgentChatStreamStatus['status'], string> = {
    thinking: '分析问题与上下文',
    tool_running: '准备调用外部工具',
    tool_done: '整理工具返回结果',
    answering: '生成最终答复',
    done: '答复完成',
    canceled: '对话已中断',
    error: '过程出错'
  }
  return labels[status]
}

function agentProcessStatusCopy(
  status: AgentChatStreamStatus['status'],
  message?: string
): { kind?: AgentChatProcessEvent['kind']; title: string; detail?: string } {
  const trimmed = message?.trim()
  if (trimmed) {
    const lessonPrefix = '正在生成课程：'
    if (trimmed.startsWith(lessonPrefix)) {
      const phase = trimmed
        .slice(lessonPrefix.length)
        .replace(/[.…]+$/g, '')
        .trim()
      return { title: `generate_lesson：${phase || '生成课程'}`, detail: '课程生成工具' }
    }
    const childPrefixes: Array<[string, AgentChatProcessEvent['kind'], string]> = [
      ['子任务排队：', 'child_run_queued', '子任务排队'],
      ['子任务开始：', 'child_run_started', '子任务运行'],
      ['子任务进度：', 'child_run_delta', '子任务进度'],
      ['子任务完成：', 'child_run_completed', '子任务完成'],
      ['子任务失败：', 'child_run_failed', '子任务失败'],
      ['子任务取消：', 'child_run_canceled', '子任务取消']
    ]
    for (const [prefix, kind, title] of childPrefixes) {
      if (trimmed.startsWith(prefix)) {
        return {
          kind,
          title,
          detail: compactText(trimmed.slice(prefix.length), 180)
        }
      }
    }
    const compactionPrefixes: Array<[string, string]> = [
      ['上下文压缩开始：', '上下文压缩开始'],
      ['上下文压缩完成：', '上下文压缩完成'],
      ['上下文压缩失败，已保留原始历史：', '上下文压缩失败']
    ]
    for (const [prefix, title] of compactionPrefixes) {
      if (trimmed.startsWith(prefix)) {
        return {
          kind: 'compaction',
          title,
          detail: compactText(trimmed.slice(prefix.length), 180)
        }
      }
    }
    if (status === 'tool_running' && /^[\w.-]+$/.test(trimmed)) {
      return { title: `准备调用：${trimmed}` }
    }
    if (status === 'tool_done' && /^[\w.-]+$/.test(trimmed)) {
      return { title: `工具返回：${trimmed}` }
    }
    if (status === 'error') return { title: agentProcessStatusTitle(status), detail: trimmed }
  }
  return { title: agentProcessStatusTitle(status), detail: trimmed }
}

function appendAgentProcessEvent(
  events: AgentChatProcessEvent[] | undefined,
  event: AgentChatProcessEvent
): AgentChatProcessEvent[] {
  const current = events ?? []
  const last = current[current.length - 1]
  if (
    last?.kind === 'status' &&
    event.kind === 'status' &&
    last.status === event.status &&
    last.title === event.title &&
    last.detail === event.detail
  ) {
    return current
  }
  if (
    event.kind === 'status' &&
    current.some((existing) =>
      existing.kind === 'status' &&
      existing.status === event.status &&
      existing.title === event.title &&
      existing.detail === event.detail
    )
  ) {
    return current
  }
  return [...current, event]
}

function updateAgentAssistantTurn(
  turns: AgentChatTurn[],
  assistantId: string,
  updater: (turn: AgentChatTurn) => AgentChatTurn
): AgentChatTurn[] {
  return turns.map((turn) => (turn.id === assistantId ? updater(turn) : turn))
}

function mergeAgentTurnMetadata(
  server: AgentTurnMetadata | undefined,
  local: AgentTurnMetadata | undefined
): AgentTurnMetadata | undefined {
  if (!local) return server
  if (!server) return local
  return {
    version: 1,
    sources: mergeMetadataItems(server.sources, local.sources, (source) => source.sourceId || source.url),
    childRuns: mergeMetadataItems(server.childRuns, local.childRuns, (child) => child.childRunId),
    compactions: mergeMetadataItems(server.compactions, local.compactions, (compaction) => compaction.sourceDigest),
    contextHygiene: nonEmptyMetadataItems([...(server.contextHygiene ?? []), ...(local.contextHygiene ?? [])]),
    contextEstimate: server.contextEstimate ?? local.contextEstimate,
    toolResults: mergeMetadataItems(server.toolResults, local.toolResults, (tool) => `${tool.toolCallId}:${tool.toolName}`)
  }
}

function mergeMetadataItems<T>(
  server: T[] | undefined,
  local: T[] | undefined,
  keyOf: (item: T) => string
): T[] | undefined {
  const out = new Map<string, T>()
  for (const item of local ?? []) out.set(keyOf(item), item)
  for (const item of server ?? []) out.set(keyOf(item), item)
  return out.size > 0 ? [...out.values()] : undefined
}

function nonEmptyMetadataItems<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined
}

function prettyJson(value: string): string {
  if (!value) return ''
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

let agentProcessEventCounter = 0

// ---- ask tool: locate and parse the pending question card ----

export type PendingAsk = {
  streamId: string
  toolCallId: string
  questions: AskQuestion[]
}

export type PendingToolPermission = {
  streamId: string
  toolCallId: string
  request: AgentToolPermissionRequest
}

/** A single ask tool call's questions (pending or answered). Returns null
 *  if the turn has no `ask` tool call. Used both for the active AskCard
 *  (result===undefined) and the inline Q&A block (result defined). */
export function parseAskToolCall(
  turn: AgentChatTurn | undefined | null
): { toolCallId: string; questions: AskQuestion[]; result?: string; isError?: boolean } | null {
  if (!turn?.toolCalls) return null
  for (const toolCall of turn.toolCalls) {
    if (toolCall.name !== 'ask') continue
    const questions = parseAskArguments(toolCall.arguments)
    if (!questions) continue
    return {
      toolCallId: toolCall.id,
      questions,
      result: toolCall.result,
      isError: toolCall.isError
    }
  }
  return null
}

/** Find the active (unanswered) ask on the latest assistant turn. */
export function selectPendingAsk(
  turns: AgentChatTurn[],
  streamId: string
): PendingAsk | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]
    if (turn.role !== 'assistant') continue
    const parsed = parseAskToolCall(turn)
    if (parsed && parsed.result === undefined) {
      return { streamId, toolCallId: parsed.toolCallId, questions: parsed.questions }
    }
    break
  }
  return null
}

export function parsePermissionToolCall(
  turn: AgentChatTurn | undefined | null
): { toolCallId: string; request: AgentToolPermissionRequest; result?: string; isError?: boolean } | null {
  if (!turn?.toolCalls) return null
  for (const toolCall of turn.toolCalls) {
    if (toolCall.name !== TOOL_PERMISSION_NAME) continue
    const request = parsePermissionArguments(toolCall.arguments)
    if (!request) continue
    return {
      toolCallId: toolCall.id,
      request,
      result: toolCall.result,
      isError: toolCall.isError
    }
  }
  return null
}

export function selectPendingToolPermission(
  turns: AgentChatTurn[],
  streamId: string
): PendingToolPermission | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]
    if (turn.role !== 'assistant') continue
    const parsed = parsePermissionToolCall(turn)
    if (parsed && parsed.result === undefined) {
      return { streamId, toolCallId: parsed.toolCallId, request: parsed.request }
    }
    break
  }
  return null
}

function parseAskArguments(argumentsJson: string): AskQuestion[] | null {
  if (!argumentsJson) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return null
  }
  const raw = parsed as { questions?: unknown }
  const rawQuestions = Array.isArray(raw?.questions) ? raw.questions : []
  if (rawQuestions.length === 0) return null
  const out: AskQuestion[] = []
  rawQuestions.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const q = item as Record<string, unknown>
    const prompt = typeof q.question === 'string' ? q.question.trim() : ''
    if (!prompt) return
    const rawOptions = Array.isArray(q.options) ? q.options : []
    const options: AskOption[] = []
    for (const opt of rawOptions) {
      if (!opt || typeof opt !== 'object') continue
      const o = opt as Record<string, unknown>
      const label = typeof o.label === 'string' ? o.label.trim() : ''
      if (!label) continue
      const description = typeof o.description === 'string' ? o.description.trim() : ''
      options.push(description ? { label, description } : { label })
    }
    if (options.length < 2) return
    out.push({
      id: typeof q.id === 'string' ? q.id : `q${index + 1}`,
      header: typeof q.header === 'string' && q.header.trim() ? q.header.trim() : undefined,
      prompt,
      multiSelect: q.multiSelect === true ? true : undefined,
      options
    })
  })
  return out.length > 0 ? out : null
}

function parsePermissionArguments(argumentsJson: string): AgentToolPermissionRequest | null {
  if (!argumentsJson) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const toolName = typeof record.toolName === 'string' ? record.toolName.trim() : ''
  const operation = typeof record.operation === 'string' ? record.operation.trim() : ''
  const kind = record.kind === 'workspace_write' || record.kind === 'workspace_read' || record.kind === 'external_network'
    ? record.kind
    : null
  if (!id || !kind || !toolName || !operation) return null
  const targetPath = typeof record.targetPath === 'string' && record.targetPath.trim()
    ? record.targetPath.trim()
    : undefined
  const reason = typeof record.reason === 'string' && record.reason.trim()
    ? record.reason.trim()
    : undefined
  return {
    id,
    kind,
    toolName,
    operation,
    targetPath,
    reason,
    creates: record.creates === true ? true : record.creates === false ? false : undefined
  }
}
