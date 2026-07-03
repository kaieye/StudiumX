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
  AgentConversationSummary,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../shared/teaching-types'

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
  return syncPendingAgentConversation({
    pending,
    pendingConversationId: pending.summary.id,
    activeConversationId,
    patch: {
      status: status.message ? `${label} ${status.message}` : label,
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
    if (!localTurn?.processEvents?.length) return turn
    return { ...turn, processEvents: localTurn.processEvents }
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
  return {
    id: createAgentProcessEventId('status'),
    kind: 'status',
    status,
    title: agentProcessStatusTitle(status),
    detail: message,
    createdAt: new Date().toISOString()
  }
}

function createAgentToolCallProcessEvent(event: AgentChatStreamToolEvent): AgentChatProcessEvent {
  const name = event.toolCall.name || 'tool'
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
    last.detail === event.detail
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
