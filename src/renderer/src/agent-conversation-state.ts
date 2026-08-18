import {
  agentConversationAbsolutePath,
  isTemporaryAgentConversationPath,
  pendingAgentConversationRelativePath
} from '../../shared/agent-conversation-catalog'
import { agentConversationToolDisplayName } from '../../shared/agent-conversation-tool-label'
import {
  appendAgentPresentationProcess,
  appendAgentPresentationText,
  collapseConsecutiveAssistantTurns,
  sanitizeAgentConversationTurns,
  sanitizeAgentPresentationText,
  sanitizeAgentTurnContent
} from '../../shared/agent-conversation-turns'
import type {
  AgentChatMessage,
  AgentChatMode,
  AgentChatProcessEvent,
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentChatTurn,
  AgentRealtimeEvent,
  AgentToolPermissionRequest,
  AgentTurnMetadata,
  AgentConversationSummary,
  AskOption,
  AskQuestion,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../shared/teaching-types'

const TOOL_PERMISSION_NAME = 'tool_permission'

export type PendingAgentConversation = {
  workspaceId: string
  sourceConversationId: string | null
  sourceConversationRevision: number | null
  mode: AgentChatMode
  summary: AgentConversationSummary & { pending: true }
  turns: AgentChatTurn[]
  status: string
  toolsSupported: boolean | null
  /** Opaque host runtime stream correlation; never persisted as a conversation id. */
  runtimeStreamId?: string
}

export type SidebarConversationSummary = AgentConversationSummary & { pending?: true }

export type AgentConversationTurnDraft = {
  pendingConversationId: string
  sourceConversationId: string | null
  selectedCourseRelativePath: string | null
  selectedLessonPath: string | null
  assistantId: string
  priorMessages: AgentChatMessage[]
  /** IDs aligned with persisted priorMessages; used only for compaction audit lineage. */
  priorMessageTurnIds: string[]
  initialTurns: AgentChatTurn[]
  pendingConversation: PendingAgentConversation
}

export type AgentTurnProvenancePresentation = {
  kind: 'original' | 'replayed' | 'recovery_notice'
  label: string
  detail?: string
}

/** Legacy turns predate durable provenance metadata and are presented as original. */
export function presentAgentTurnProvenance(turn: AgentChatTurn): AgentTurnProvenancePresentation {
  const provenance = turn.metadata?.provenance
  if (provenance?.kind === 'recovery_notice') {
    return { kind: 'recovery_notice', label: '恢复提示', detail: '运行恢复边界，不是模型重放结果' }
  }
  if (provenance?.kind === 'replayed') {
    const source = [provenance.sourceBranchId, provenance.sourceTurnId].filter(Boolean).join(' · ')
    return {
      kind: 'replayed',
      label: '回放结果',
      detail: source ? `来源 ${source}` : '由安全回放生成，未重执行工具'
    }
  }
  return { kind: 'original', label: '原始轮次', detail: '当前分支的原始对话记录' }
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
  activeConversationRevision,
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
  activeConversationRevision: number | null
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
  const sourceConversationRevision = sourceConversationId ? activeConversationRevision : null
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
  const priorMessageTurnIds = agentTurnsToMessageTurnIds(currentTurns)
  const initialTurns = [...currentTurns, userTurn, assistantTurn]
  const pendingConversation: PendingAgentConversation = {
    workspaceId: workspace.id,
    sourceConversationId,
    sourceConversationRevision,
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
    priorMessageTurnIds,
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
  realtimeEvent,
  updatedAt
}: {
  pending: PendingAgentConversation | null
  activeConversationId: string | null
  assistantId: string
  chunk: AgentChatStreamChunk
  /** Host EventBus metadata; preserves durable presentation order while streaming. */
  realtimeEvent?: Pick<AgentRealtimeEvent, 'sequence' | 'createdAt'>
  updatedAt?: string
}): PendingConversationStorePatch | null {
  if (!pending || chunk.streamId !== pending.summary.id || latestAssistantTurnWasCanceled(pending.turns)) return null
  const visibleTextDelta = sanitizeAgentPresentationText(chunk.delta)
  let changed = false
  const turns = pending.turns.map((turn) => {
    if (turn.id !== assistantId) return turn
    changed = true
    const createdAt = realtimeEvent?.createdAt ?? updatedAt ?? new Date().toISOString()
    if (chunk.channel === 'reasoning') {
      // A Think row is only extended while it is the current visible timeline
      // boundary. If text or a tool appeared since it, create a fresh row so
      // Think → text → Think never mutates the earlier thought in place.
      const latestReasoning = [...(turn.processEvents ?? [])]
        .reverse()
        .find((event) => event.kind === 'reasoning')
      const latestPresentationEntry = turn.presentationTimeline?.at(-1)
      const continuesVisibleReasoning = Boolean(
        latestReasoning &&
        latestPresentationEntry?.kind === 'process' &&
        latestPresentationEntry.processEventId === latestReasoning.id
      )
      const processEvents = appendAgentReasoningDelta(
        turn.processEvents,
        chunk.delta,
        createdAt,
        continuesVisibleReasoning
      )
      const reasoning = [...processEvents].reverse().find((event) => event.kind === 'reasoning')
      return {
        ...turn,
        processEvents,
        presentationTimeline: reasoning
          ? appendAgentPresentationProcess(
            turn.presentationTimeline,
            reasoning.id,
            createdAt,
            `presentation-process:${reasoning.id}`,
            realtimeEvent?.sequence
          )
          : turn.presentationTimeline
      }
    }
    const existingContent = sanitizeAgentPresentationText(turn.content)
    const combinedContent = visibleTextDelta
      ? sanitizeAgentPresentationText(`${existingContent}${visibleTextDelta}`)
      : existingContent
    return {
      ...turn,
      // Keep the renderer-only pending transcript fail-closed too. A durable
      // refresh will provide canonical content later, but raw provider payloads
      // must never transiently enter local presentation state.
      content: combinedContent || existingContent,
      presentationTimeline: appendAgentPresentationText(
        turn.presentationTimeline,
        visibleTextDelta,
        createdAt,
        createAgentPresentationEntryId('text'),
        realtimeEvent?.sequence
      )
    }
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
  realtimeEvent,
  updatedAt
}: {
  pending: PendingAgentConversation | null
  activeConversationId: string | null
  assistantId: string
  status: AgentChatStreamStatus
  /** Retain the host event time on process records even though status has no flow row. */
  realtimeEvent?: Pick<AgentRealtimeEvent, 'sequence' | 'createdAt'>
  updatedAt?: string
}): PendingConversationStorePatch | null {
  if (!pending || status.streamId !== pending.summary.id || latestAssistantTurnWasCanceled(pending.turns)) return null
  const label = agentStatusLabel(status.status)
  const visibleStatusMessage = sanitizeAgentPresentationText(status.message)
  const statusText = visibleStatusMessage.startsWith('正在生成课程：')
    ? visibleStatusMessage
    : visibleStatusMessage
      ? `${label} ${visibleStatusMessage}`
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
          settlePermissionProcessEvents(
            turn.processEvents,
            status.status === 'done' || status.status === 'error' || status.status === 'canceled' || status.status === 'resource_limit' || status.status === 'suspended' || status.status === 'no_progress' || status.status === 'context_unrecoverable' || status.status === 'retry_exhausted',
            status.status === 'error'
          ),
          createAgentStatusProcessEvent(status.status, visibleStatusMessage, realtimeEvent?.createdAt)
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
  realtimeEvent,
  updatedAt
}: {
  pending: PendingAgentConversation | null
  activeConversationId: string | null
  assistantId: string
  event: AgentChatStreamToolEvent
  /** Host EventBus metadata; tool completion updates its original row in place. */
  realtimeEvent?: Pick<AgentRealtimeEvent, 'sequence' | 'createdAt'>
  updatedAt?: string
}): PendingConversationStorePatch | null {
  if (!pending || event.streamId !== pending.summary.id || latestAssistantTurnWasCanceled(pending.turns)) return null
  const turns = [...pending.turns]
  const idx = turns.findIndex((turn) => turn.id === assistantId)
  if (idx < 0) return null

  const existing = turns[idx].toolCalls ?? []
  const toolCallId = event.toolCall.id
  // A permission request deliberately reuses the guarded tool call's id so
  // the backend can resume that exact operation. Keep the two projections
  // distinct by matching both id and tool name.
  const existingIdx = existing.findIndex((toolCall) =>
    toolCall.id === toolCallId && toolCall.name === event.toolCall.name
  )
  if (existingIdx >= 0) {
    const updated = [...existing]
    // Refresh arguments when host re-publishes (e.g. ask __deadlineAt stamp, ADR-0010).
    updated[existingIdx] = {
      ...updated[existingIdx],
      arguments: event.toolCall.arguments || updated[existingIdx].arguments,
      ...(event.result !== undefined
        ? { result: event.result, isError: event.isError }
        : {})
    }
    turns[idx] = { ...turns[idx], toolCalls: updated }
  } else {
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

  // Each call owns one stable process row. A result updates that row in place
  // so the timeline remains anchored where the tool was invoked. Ask/permission
  // retain their existing resolved process kinds so recovery and approval
  // semantics do not change.
  const shouldUpdateProcessEvents = existingIdx < 0 || event.result !== undefined
  if (shouldUpdateProcessEvents) {
    const createdAt = realtimeEvent?.createdAt ?? updatedAt ?? new Date().toISOString()
    const resolvedProcessEvents = event.result !== undefined
      ? resolveAgentToolProcessEvent(turns[idx].processEvents, event, createdAt)
      : appendAgentProcessEvent(turns[idx].processEvents, createAgentToolCallProcessEvent(event, createdAt))
    const processEvents = resolvedProcessEvents
    const processEvent = latestAgentProcessEventForTool(
      processEvents,
      event.toolCall.id,
      event.toolCall.name
    )
    turns[idx] = {
      ...turns[idx],
      processEvents,
      presentationTimeline: processEvent
        ? appendAgentPresentationProcess(
          turns[idx].presentationTimeline,
          processEvent.id,
          createdAt,
          `presentation-process:${processEvent.id}`,
          realtimeEvent?.sequence
        )
        : turns[idx].presentationTimeline
    }
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
  const canceledPending: PendingAgentConversation = {
    ...pending,
    turns,
    status: '已中止',
    summary: {
      ...pending.summary,
      updatedAt: new Date().toISOString(),
      messageCount: turns.length
    }
  }
  const isVisible = activeConversationId === pending.summary.id
  return {
    agentChatBusy: false,
    // A local cancellation stops execution but must not erase the transcript.
    // Keep it as a pending-only draft: it remains visible/retryable but is never
    // promoted as a completed conversation by this cancellation path.
    pendingAgentConversation: canceledPending,
    ...(preserveToolsSupported
      ? {
          agentStatus: '',
          agentToolsSupported: pending.toolsSupported
        }
      : {}),
    ...(isVisible
      ? {
          agentTurns: turns,
          agentStatus: '',
          agentToolsSupported: preserveToolsSupported ? pending.toolsSupported : null
        }
      : {})
  }
}

export function failPendingAgentConversation({
  pending,
  activeConversationId,
  assistantId,
  message
}: {
  pending: PendingAgentConversation
  activeConversationId: string | null
  assistantId: string
  message: string
}): PendingConversationStorePatch {
  const visibleMessage = sanitizeAgentPresentationText(message) || '对话未能完成。'
  const turns = updateAgentAssistantTurn(pending.turns, assistantId, (turn) => ({
    ...turn,
    processEvents: appendAgentProcessEvent(
      turn.processEvents,
      createAgentStatusProcessEvent('error', visibleMessage)
    )
  }))
  const failedPending: PendingAgentConversation = {
    ...pending,
    turns,
    status: visibleMessage,
    summary: {
      ...pending.summary,
      updatedAt: new Date().toISOString(),
      messageCount: turns.length
    }
  }
  const isVisible = activeConversationId === pending.summary.id
  return {
    agentChatBusy: false,
    pendingAgentConversation: failedPending,
    ...(isVisible
      ? {
          agentTurns: turns,
          agentStatus: '',
          agentToolsSupported: pending.toolsSupported
        }
      : {})
  }
}

/**
 * Attach a host-authored, redacted Skill invocation result to the raw user
 * input already present in a pending transcript. This is used for local
 * resolver failures: no assistant success, provider call, or settlement is
 * fabricated merely to show the evidence.
 */
export function attachSkillInvocationToPending({
  pending,
  activeConversationId,
  presentation
}: {
  pending: PendingAgentConversation | null
  activeConversationId: string | null
  presentation: NonNullable<AgentTurnMetadata['skillInvocation']>
}): PendingConversationStorePatch | null {
  if (!pending) return null
  const userIndex = pending.turns.map((turn) => turn.role).lastIndexOf('user')
  if (userIndex < 0) return null
  const turns = [...pending.turns]
  const userTurn = turns[userIndex]!
  turns[userIndex] = {
    ...userTurn,
    metadata: { ...(userTurn.metadata ?? { version: 1 }), skillInvocation: presentation }
  }
  return syncPendingAgentConversation({
    pending,
    pendingConversationId: pending.summary.id,
    activeConversationId,
    patch: { turns }
  })
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
  toolsSupported: boolean | null
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
    resource_limit: '已达到资源边界',
    suspended: '运行已暂停',
    no_progress: '重复操作未产生进展',
    context_unrecoverable: '上下文无法安全压缩',
    retry_exhausted: '自动重试已耗尽',
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

/**
 * Recovery notices are renderer-only safety boundaries. They may be displayed
 * alongside a durable conversation but must never become model context or
 * compaction lineage for a later user request.
 */
function isAgentMessageTurn(turn: AgentChatTurn): turn is AgentChatTurn & { role: 'user' | 'assistant' } {
  return turn.metadata?.provenance?.kind !== 'recovery_notice'
    && (turn.role === 'user' || (turn.role === 'assistant' && Boolean(turn.content.trim())))
}

export function agentTurnsToMessages(turns: AgentChatTurn[]): AgentChatMessage[] {
  return turns
    .filter(isAgentMessageTurn)
    .map((turn) => ({ role: turn.role, content: turn.content }))
}

/** Turn IDs in the same order as `agentTurnsToMessages`; used only for audit lineage. */
export function agentTurnsToMessageTurnIds(turns: AgentChatTurn[]): string[] {
  return turns
    .filter(isAgentMessageTurn)
    .map((turn) => turn.id)
}

export function isPendingConversationSummary(
  conversation: AgentConversationSummary | null | undefined
): conversation is SidebarConversationSummary & { pending: true } {
  return Boolean((conversation as SidebarConversationSummary | null | undefined)?.pending)
}

export function isTemporaryConversation(conversation: AgentConversationSummary): boolean {
  return isTemporaryAgentConversationPath(conversation.relativePath)
}

/** A locally canceled pending run must ignore delayed IPC/replay delivery. */
function latestAssistantTurnWasCanceled(turns: AgentChatTurn[]): boolean {
  const assistant = [...turns].reverse().find((turn) => turn.role === 'assistant')
  return assistant?.processEvents?.some(
    (event) => event.kind === 'status' && event.status === 'canceled'
  ) ?? false
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
  // Server transcripts can still arrive as multi-assistant tool-loop fragments.
  // Collapse them first so local live process evidence maps 1:1 onto the final reply.
  const collapsedServerTurns = sanitizeAgentConversationTurns(serverTurns)
  const collapsedLocalTurns = collapseConsecutiveAssistantTurns(localTurns)
  const localAssistantTurns = collapsedLocalTurns.filter((turn) => turn.role === 'assistant')
  let assistantIndex = 0
  const reconciledServerTurns = collapsedServerTurns.map((turn) => {
    if (turn.role !== 'assistant') return turn
    const localTurn = localAssistantTurns[assistantIndex]
    assistantIndex += 1
    const processEvents = localTurn?.processEvents?.length ? localTurn.processEvents : turn.processEvents
    // A canonical read can race a still-visible live stream. Prefer the local
    // ordered projection until the host’s durable transcript catches up; this
    // preserves Think → text → tool IN/OUT boundaries when returning to chat.
    const presentationTimeline = localTurn?.presentationTimeline?.length
      ? localTurn.presentationTimeline
      : turn.presentationTimeline
    const metadata = mergeAgentTurnMetadata(turn.metadata, localTurn?.metadata)
    const content = sanitizeAgentTurnContent(turn.content || localTurn?.content || '')
    if (
      processEvents === turn.processEvents &&
      presentationTimeline === turn.presentationTimeline &&
      metadata === turn.metadata &&
      content === turn.content
    ) return turn
    return {
      ...turn,
      content,
      processEvents,
      presentationTimeline,
      metadata
    }
  })

  // A terminal notification can race the renderer's first canonical read. If
  // that read is still the exact prefix shown before this run, keep the local
  // completed tail visible until a later session read observes the host save.
  // This is projection-only: the renderer still never writes the transcript.
  const serverIsLocalPrefix = reconciledServerTurns.length < collapsedLocalTurns.length &&
    reconciledServerTurns.every((serverTurn, index) => {
      const localTurn = collapsedLocalTurns[index]
      return Boolean(localTurn) && serverTurn.role === localTurn.role && (
        serverTurn.id === localTurn.id || serverTurn.content === localTurn.content
      )
    })
  return serverIsLocalPrefix
    ? [...reconciledServerTurns, ...collapsedLocalTurns.slice(reconciledServerTurns.length)]
    : reconciledServerTurns
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

function createAgentPresentationEntryId(prefix: string): string {
  return `presentation-${createAgentProcessEventId(prefix)}`
}

function createAgentStatusProcessEvent(
  status: AgentChatStreamStatus['status'],
  message?: string,
  createdAt = new Date().toISOString()
): AgentChatProcessEvent {
  const copy = agentProcessStatusCopy(status, message)
  return {
    id: createAgentProcessEventId('status'),
    kind: copy.kind ?? 'status',
    status,
    title: copy.title,
    detail: copy.detail,
    createdAt
  }
}

function createAgentToolCallProcessEvent(
  event: AgentChatStreamToolEvent,
  createdAt = new Date().toISOString()
): AgentChatProcessEvent {
  const name = event.toolCall.name || 'tool'
  if (name === TOOL_PERMISSION_NAME) {
    const request = event.permissionRequest ?? parsePermissionArguments(event.toolCall.arguments)
    return {
      id: createAgentProcessEventId('permission-request'),
      kind: 'permission_request',
      title: '等待写入审批',
      detail: request
        ? sanitizeAgentPresentationText(`${request.operation}${request.targetPath ? `：${request.targetPath}` : ''}`) || undefined
        : undefined,
      toolCallId: event.toolCall.id,
      toolName: name,
      createdAt
    }
  }
  if (name === 'ask') {
    const questions = parseAskArgumentsEnvelope(event.toolCall.arguments)?.questions
    const firstQuestion = questions?.[0]?.prompt
    return {
      id: createAgentProcessEventId('elicitation-request'),
      kind: 'elicitation_request',
      title: '等待用户选择',
      detail: firstQuestion
        ? sanitizeAgentPresentationText(firstQuestion) || undefined
        : undefined,
      toolCallId: event.toolCall.id,
      toolName: name,
      createdAt
    }
  }
  return {
    id: createAgentProcessEventId('tool-call'),
    kind: 'tool_call',
    title: agentConversationToolDisplayName(name),
    toolCallId: event.toolCall.id,
    toolName: name,
    createdAt
  }
}

function settlePermissionProcessEvents(
  events: AgentChatProcessEvent[] | undefined,
  shouldSettle: boolean,
  isError: boolean
): AgentChatProcessEvent[] {
  const current = events ?? []
  if (!shouldSettle) return current
  return current.map((event) => event.kind === 'permission_resolved' && event.status === 'tool_running'
    ? { ...event, status: 'tool_done', isError }
    : event)
}

function latestAgentProcessEventForTool(
  events: AgentChatProcessEvent[] | undefined,
  toolCallId: string,
  toolName: string
): AgentChatProcessEvent | undefined {
  const candidates = (events ?? []).filter((item) =>
    item.toolCallId === toolCallId && item.toolName === toolName
  )
  return candidates[candidates.length - 1]
}

function resolveAgentToolProcessEvent(
  events: AgentChatProcessEvent[] | undefined,
  event: AgentChatStreamToolEvent,
  createdAt = new Date().toISOString()
): AgentChatProcessEvent[] {
  const current = events ?? []
  const index = current.findIndex((item) =>
    item.toolCallId === event.toolCall.id &&
    item.toolName === event.toolCall.name &&
    (item.kind === 'tool_call' || item.kind === 'permission_request' || item.kind === 'elicitation_request')
  )
  if (index < 0) {
    const call = createAgentToolCallProcessEvent(event, createdAt)
    return [...current, {
      ...call,
      status: 'tool_done',
      isError: event.isError
    }]
  }

  const next = [...current]
  const existing = next[index]
  const resolved = existing.kind === 'permission_request'
    ? {
        kind: 'permission_resolved' as const,
        title: permissionResolutionTitle(event.result, event.isError),
        detail: existing.detail
      }
    : existing.kind === 'elicitation_request'
      ? {
          kind: 'elicitation_resolved' as const,
          title: event.isError ? '用户选择处理失败' : '用户选择已提交',
          detail: existing.detail
        }
      : {}
  const permissionAllowed = existing.kind === 'permission_request' && !event.isError && !permissionWasDenied(event.result)
  next[index] = {
    ...existing,
    ...resolved,
    // An approval is not the end of the operation: the guarded tool may still
    // be running. Keep the row active until that tool returns.
    status: permissionAllowed ? 'tool_running' : 'tool_done',
    isError: event.isError
  }

  // Permission requests reuse the guarded tool call ID. When the real tool
  // result arrives, settle the approval row too so the process card cannot end
  // with a permanent "continuing" spinner after generation has completed.
  if (existing.kind === 'tool_call') {
    for (let itemIndex = 0; itemIndex < next.length; itemIndex += 1) {
      const item = next[itemIndex]
      if (item?.kind === 'permission_resolved' && item.status === 'tool_running' &&
        (item.toolCallId === event.toolCall.id || event.result !== undefined)) {
        next[itemIndex] = { ...item, status: 'tool_done', isError: event.isError }
      }
    }
  }
  return next
}

function permissionResolutionTitle(result: string | undefined, isError: boolean | undefined): string {
  if (isError) return '写入审批处理失败'
  if (permissionWasDenied(result)) return '写入审批已拒绝'
  return '写入审批已允许，继续执行'
}

function permissionWasDenied(result: string | undefined): boolean {
  try {
    const decision = JSON.parse(result ?? '{}') as { decision?: string }
    return decision.decision === 'deny'
  } catch {
    // A successful non-JSON result still means the approval request was resolved.
    return false
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
    resource_limit: '已达到明确资源边界',
    suspended: '高位紧急熔断器已暂停运行',
    no_progress: '重复操作未带来安全进展，未自动重试',
    context_unrecoverable: '上下文无法安全压缩，未自动重试',
    retry_exhausted: '自动重试已耗尽，未自动继续请求',
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

function appendAgentReasoningDelta(
  events: AgentChatProcessEvent[] | undefined,
  delta: string,
  createdAt: string,
  continuesVisibleReasoning: boolean
): AgentChatProcessEvent[] {
  const current = events ?? []
  const visibleDelta = sanitizeAgentPresentationText(delta)
  if (!visibleDelta) return current
  const last = current[current.length - 1]
  if (continuesVisibleReasoning && last?.kind === 'reasoning') {
    const combined = sanitizeAgentPresentationText(`${last.detail ?? ''}${visibleDelta}`)
    if (!combined) return current
    return [
      ...current.slice(0, -1),
      { ...last, detail: combined }
    ]
  }
  return [
    ...current,
    {
      id: createAgentProcessEventId('reasoning'),
      kind: 'reasoning',
      title: '思考过程',
      detail: visibleDelta,
      status: 'thinking',
      createdAt
    }
  ]
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
    toolResults: mergeMetadataItems(server.toolResults, local.toolResults, (tool) => `${tool.toolCallId}:${tool.toolName}`),
    runUsage: server.runUsage ?? local.runUsage,
    skillInvocation: server.skillInvocation ?? local.skillInvocation,
    fileTouches: server.fileTouches ?? local.fileTouches,
    runId: server.runId ?? local.runId,
    parentTurnProof: server.parentTurnProof ?? local.parentTurnProof,
    provenance: server.provenance ?? local.provenance
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
  /** Host-authoritative ISO deadline (ADR-0010); null when parameters incomplete. */
  deadlineAt: string | null
}

export type PendingToolPermission = {
  streamId: string
  toolCallId: string
  request: AgentToolPermissionRequest
}

/** The latest ask tool call's questions (pending or answered). Returns null
 *  if the turn has no `ask` tool call. A single assistant turn can contain
 *  multiple sequential ask calls, so selection must scan newest-first. */
export function parseAskToolCall(
  turn: AgentChatTurn | undefined | null
): {
  toolCallId: string
  questions: AskQuestion[]
  deadlineAt: string | null
  result?: string
  isError?: boolean
} | null {
  if (!turn?.toolCalls) return null
  for (let index = turn.toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = turn.toolCalls[index]
    if (toolCall.name !== 'ask') continue
    const parsed = parseAskArgumentsEnvelope(toolCall.arguments)
    if (!parsed) continue
    return {
      toolCallId: toolCall.id,
      questions: parsed.questions,
      deadlineAt: parsed.deadlineAt,
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
      return {
        streamId,
        toolCallId: parsed.toolCallId,
        questions: parsed.questions,
        deadlineAt: parsed.deadlineAt
      }
    }
    break
  }
  return null
}

export function parsePermissionToolCall(
  turn: AgentChatTurn | undefined | null
): { toolCallId: string; request: AgentToolPermissionRequest; result?: string; isError?: boolean } | null {
  if (!turn?.toolCalls) return null
  for (let index = turn.toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = turn.toolCalls[index]
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

function parseAskArgumentsEnvelope(
  argumentsJson: string
): { questions: AskQuestion[]; deadlineAt: string | null } | null {
  if (!argumentsJson) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return null
  }
  const raw = parsed as { questions?: unknown; __deadlineAt?: unknown }
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
      const recommended = o.recommended === true
      options.push({
        label,
        ...(description ? { description } : {}),
        ...(recommended ? { recommended: true } : {})
      })
    }
    if (options.length < 2) return
    if (!options.some((option) => option.recommended === true) && options[0]) {
      options[0] = { ...options[0], recommended: true }
    }
    out.push({
      id: typeof q.id === 'string' ? q.id : `q${index + 1}`,
      header: typeof q.header === 'string' && q.header.trim() ? q.header.trim() : undefined,
      prompt,
      multiSelect: q.multiSelect === true ? true : undefined,
      options
    })
  })
  if (out.length === 0) return null
  const deadlineAt =
    typeof raw.__deadlineAt === 'string' && Number.isFinite(Date.parse(raw.__deadlineAt))
      ? new Date(Date.parse(raw.__deadlineAt)).toISOString()
      : null
  return { questions: out, deadlineAt }
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
