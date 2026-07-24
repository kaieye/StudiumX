import type {
  AgentChatProcessEvent,
  AgentChatTurn,
  AgentToolPermissionRequest,
  AgentTurnMetadata,
  AskQuestion
} from '../../shared/teaching-types'
import {
  projectFileTouchesForLearner,
  rebuildFileTouchLedgerFromToolCalls,
  type FileTouchPresentation
} from '../../shared/context-file-touch-projection'
import { buildAgentProcessTimeline } from './agent-process-timeline'

const INLINE_RESULT_LIMIT = 12_000

type AgentProcessToolCall = NonNullable<AgentChatTurn['toolCalls']>[number]

type ProvenanceKind =
  | 'status'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'permission_request'
  | 'permission_resolved'
  | 'elicitation_request'
  | 'elicitation_resolved'
  | 'child_run'
  | 'compaction'
  | 'source'
  | 'unknown'

export type AgentConversationDisclosure = {
  eligible: boolean
  label: string
  arguments?: string
  result?: string
  resultState?: 'available' | 'archived' | 'missing' | 'oversized'
  notice?: string
}

export type AgentConversationProvenanceState =
  | 'active'
  | 'complete'
  | 'error'
  | 'canceled'
  | 'pending'
  | 'interrupted'

export type AgentConversationProvenanceItem = {
  id: string
  kind: ProvenanceKind
  label: string
  detail?: string
  state: AgentConversationProvenanceState
  disclosure?: AgentConversationDisclosure
}

export type AgentConversationAnsweredAsk = {
  id: string
  answer: string
}

export type AgentConversationSourceReference = {
  id: string
  title: string
  url: string
  snippet?: string
  provider?: string
}

/**
 * Renderer-only process outcome. `interrupted` is a durable recovery boundary,
 * not a failed run and not a completed answer.
 */
export type AgentConversationTurnStatus =
  | { kind: 'active' }
  | { kind: 'completed' }
  | { kind: 'failed' }
  | { kind: 'canceled' }
  | { kind: 'interrupted' }

export type AgentConversationTurnPresentation = {
  turnId: string
  /** Retained for existing consumers; prefer the discriminated `status`. */
  active: boolean
  status: AgentConversationTurnStatus
  items: AgentConversationProvenanceItem[]
  answeredAsks: AgentConversationAnsweredAsk[]
  sources: AgentConversationSourceReference[]
  /**
   * Learner-facing files-touched reference projection (ADR-0143).
   * Not teaching outcome evidence / settlement authority.
   */
  fileTouches?: FileTouchPresentation
}

export type AgentConversationCommandDescriptor =
  | {
      kind: 'answer_ask'
      streamId: string
      toolCallId: string
    }
  | {
      kind: 'answer_tool_permission'
      streamId: string
      toolCallId: string
    }

export type AgentConversationBlockedState =
  | {
      kind: 'ask'
      title: string
      detail?: string
      questions: AskQuestion[]
      deadlineAt?: string | null
      command: Extract<AgentConversationCommandDescriptor, { kind: 'answer_ask' }>
    }
  | {
      kind: 'tool_permission'
      title: string
      detail?: string
      request: AgentToolPermissionRequest
      command: Extract<AgentConversationCommandDescriptor, { kind: 'answer_tool_permission' }>
    }

export type AgentConversationInterruption =
  | {
      kind: 'ask'
      streamId: string
      toolCallId: string
      questions: AskQuestion[]
      deadlineAt?: string | null
    }
  | {
      kind: 'tool_permission'
      streamId: string
      toolCallId: string
      request: AgentToolPermissionRequest
    }

export type AgentConversationPresentation = {
  turns: AgentConversationTurnPresentation[]
  blocked: AgentConversationBlockedState | null
  commands: AgentConversationCommandDescriptor[]
}

export function buildAgentConversationPresentation({
  turns,
  activeTurnId,
  interruption
}: {
  turns: AgentChatTurn[]
  activeTurnId?: string | null
  interruption?: AgentConversationInterruption | null
}): AgentConversationPresentation {
  const commands = interruption ? [commandForInterruption(interruption)] : []
  return {
    turns: turns.map((turn) => presentTurn(turn, turn.id === activeTurnId)),
    blocked: interruption ? blockedStateForInterruption(interruption) : null,
    commands
  }
}

function presentTurn(turn: AgentChatTurn, active: boolean): AgentConversationTurnPresentation {
  if (turn.role !== 'assistant') {
    return {
      turnId: turn.id,
      active: false,
      status: { kind: 'completed' },
      items: [],
      answeredAsks: [],
      sources: [],
      fileTouches: undefined
    }
  }

  const status = statusForTurn(turn, active)
  const effectivelyActive = status.kind === 'active'
  const toolResultDiagnostics = new Map(
    (turn.metadata?.toolResults ?? []).map((diagnostic) => [diagnostic.toolCallId, diagnostic])
  )
  const items: AgentConversationProvenanceItem[] = []
  const answeredAsks: AgentConversationAnsweredAsk[] = []

  const liveToolCallIds = new Set(
    (turn.processEvents ?? [])
      .filter((event) => event.kind === 'tool_call' && event.toolCallId)
      .map((event) => event.toolCallId as string)
  )
  for (const item of buildAgentProcessTimeline(turn)) {
    if (item.kind === 'event') {
      if (item.event.kind === 'tool_result' && item.event.toolCallId && liveToolCallIds.has(item.event.toolCallId)) continue
      items.push(presentProcessEvent(item.event, item.toolCall, toolResultDiagnostics, effectivelyActive, status))
      continue
    }

    const syntheticEvents = synthesizeToolCallEvents(item.toolCall, toolResultDiagnostics.get(item.toolCall.id))
    for (const event of syntheticEvents) {
      items.push(presentProcessEvent(event, item.toolCall, toolResultDiagnostics, effectivelyActive, status))
    }
  }

  for (const toolCall of turn.toolCalls ?? []) {
    const diagnostic = toolResultDiagnostics.get(toolCall.id)
    if (
      toolCall.name !== 'ask' ||
      toolCall.result === undefined ||
      toolCall.isError ||
      isDisclosureOnlyToolResult(toolCall, diagnostic)
    ) continue
    answeredAsks.push({ id: `answered-ask:${toolCall.id}`, answer: toolCall.result })
  }

  appendMetadataEvidence(items, turn.metadata)
  keepOnlyLatestItemActive(items)
  return {
    turnId: turn.id,
    active: effectivelyActive,
    status,
    items,
    answeredAsks,
    sources: presentSourceReferences(turn.metadata),
    fileTouches: presentFileTouches(turn)
  }
}

/**
 * Prefer durable metadata.fileTouches; fall back to rebuilding from toolCalls
 * so live streams still show files-touched before audit metadata attaches.
 */
function presentFileTouches(turn: AgentChatTurn): FileTouchPresentation | undefined {
  const fromMetadata = turn.metadata?.fileTouches
  const ledger = fromMetadata?.files?.length
    ? fromMetadata
    : rebuildFileTouchLedgerFromToolCalls(turn.toolCalls)
  const presentation = projectFileTouchesForLearner(ledger)
  return presentation.empty ? undefined : presentation
}

function statusForTurn(turn: AgentChatTurn, active: boolean): AgentConversationTurnStatus {
  if (turn.metadata?.provenance?.kind === 'recovery_notice') return { kind: 'interrupted' }

  const terminalStatus = [...(turn.processEvents ?? [])].reverse().find((event) =>
    event.kind === 'status' && (event.status === 'done' || event.status === 'canceled' || event.status === 'error')
  )?.status
  if (terminalStatus === 'error') return { kind: 'failed' }
  if (terminalStatus === 'canceled') return { kind: 'canceled' }
  if (terminalStatus === 'done') return { kind: 'completed' }
  return active ? { kind: 'active' } : { kind: 'completed' }
}

function keepOnlyLatestItemActive(items: AgentConversationProvenanceItem[]): void {
  const latestIndex = items.length - 1
  items.forEach((item, index) => {
    if (item.state === 'active' && index !== latestIndex) item.state = 'complete'
  })
}

function commandForInterruption(interruption: AgentConversationInterruption): AgentConversationCommandDescriptor {
  if (interruption.kind === 'ask') {
    return {
      kind: 'answer_ask',
      streamId: interruption.streamId,
      toolCallId: interruption.toolCallId
    }
  }
  return {
    kind: 'answer_tool_permission',
    streamId: interruption.streamId,
    toolCallId: interruption.toolCallId
  }
}

function blockedStateForInterruption(interruption: AgentConversationInterruption): AgentConversationBlockedState {
  if (interruption.kind === 'ask') {
    return {
      kind: 'ask',
      title: '等待用户选择',
      detail: compactText(interruption.questions[0]?.prompt, 180),
      questions: interruption.questions,
      deadlineAt: interruption.deadlineAt ?? null,
      command: commandForInterruption(interruption) as Extract<AgentConversationCommandDescriptor, { kind: 'answer_ask' }>
    }
  }
  return {
    kind: 'tool_permission',
    title: '等待写入审批',
    detail: compactText(
      `${interruption.request.operation}${interruption.request.targetPath ? `：${interruption.request.targetPath}` : ''}`,
      180
    ),
    request: interruption.request,
    command: commandForInterruption(interruption) as Extract<AgentConversationCommandDescriptor, { kind: 'answer_tool_permission' }>
  }
}

function synthesizeToolCallEvents(
  toolCall: AgentProcessToolCall,
  diagnostic: NonNullable<AgentTurnMetadata['toolResults']>[number] | undefined
): AgentChatProcessEvent[] {
  const name = normalizedToolName(toolCall)
  const requestKind = name === 'ask'
    ? 'elicitation_request'
    : name === 'tool_permission'
      ? 'permission_request'
      : 'tool_call'
  const completed = toolCall.result !== undefined || Boolean(diagnostic)
  return [{
    id: `durable:${toolCall.id}:call`,
    kind: requestKind,
    title: requestTitleForTool(toolCall),
    detail: requestKind === 'tool_call' ? undefined : compactText(toolCall.arguments, 180),
    status: completed ? 'tool_done' : undefined,
    toolCallId: toolCall.id,
    toolName: name,
    isError: completed ? toolCall.isError : undefined,
    createdAt: ''
  }]
}

function presentProcessEvent(
  event: AgentChatProcessEvent,
  toolCall: AgentProcessToolCall | undefined,
  diagnostics: Map<string, NonNullable<AgentTurnMetadata['toolResults']>[number]>,
  active: boolean,
  turnStatus: AgentConversationTurnStatus
): AgentConversationProvenanceItem {
  const kind = normalizeKind(event.kind)
  const toolDiagnostic = event.toolCallId ? diagnostics.get(event.toolCallId) : undefined
  const toolCompleted = kind === 'tool_call' && Boolean(
    event.status === 'tool_done' || toolCall?.result !== undefined || toolDiagnostic
  )
  const toolFailed = kind === 'tool_call' && toolCompleted && Boolean(event.isError || toolCall?.isError)
  const state: AgentConversationProvenanceState = turnStatus.kind === 'interrupted' && event.kind === 'status'
    ? 'interrupted'
    : event.isError || event.status === 'error' || toolFailed
      ? 'error'
      : event.status === 'canceled'
        ? 'canceled'
        : isPendingEvent(event)
          ? 'pending'
          : toolCompleted
            ? 'complete'
            : active && event.status !== 'done' && event.status !== 'tool_done'
              ? 'active'
              : 'complete'
  const resultFocused = isResultEvidence(kind)
  const disclosure = undefined
  const detail = kind === 'tool_call'
    ? undefined
    : resultFocused && toolCall && isDisclosureOnlyToolResult(toolCall, toolDiagnostic)
      ? undefined
      : kind === 'reasoning' ? preserveReasoningText(event.detail) : compactText(event.detail, 180)

  return {
    id: `event:${event.id}`,
    kind,
    label: compactLabel(event.title || fallbackLabel(kind, event.status, event.toolName), 72),
    detail,
    state,
    disclosure
  }
}

function isDisclosureOnlyToolResult(
  toolCall: AgentProcessToolCall,
  diagnostic: NonNullable<AgentTurnMetadata['toolResults']>[number] | undefined
): boolean {
  return resultDisclosureState(toolCall, diagnostic) !== 'available'
}

function resultDisclosureState(
  toolCall: AgentProcessToolCall,
  diagnostic: NonNullable<AgentTurnMetadata['toolResults']>[number] | undefined
): NonNullable<AgentConversationDisclosure['resultState']> {
  if (diagnostic?.archive) return 'archived'
  if (
    (toolCall.result !== undefined && toolCall.result.length > INLINE_RESULT_LIMIT) ||
    (diagnostic && diagnostic.bytes > INLINE_RESULT_LIMIT)
  ) return 'oversized'
  if (toolCall.result === undefined) return 'missing'
  return 'available'
}

function presentSourceReferences(metadata: AgentTurnMetadata | undefined): AgentConversationSourceReference[] {
  if (!metadata?.sources?.length) return []
  const seen = new Set<string>()
  const sources: AgentConversationSourceReference[] = []
  for (const source of metadata.sources) {
    const url = source.url?.trim()
    if (!url) continue
    const key = source.sourceId || url
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({
      id: key,
      title: compactLabel(source.title || source.url || '引用来源', 96),
      url,
      snippet: source.snippet ? compactText(source.snippet, 180) : undefined,
      provider: source.provider
    })
  }
  return sources
}

function appendMetadataEvidence(items: AgentConversationProvenanceItem[], metadata: AgentTurnMetadata | undefined): void {
  if (!metadata) return
  for (const child of metadata.childRuns ?? []) {
    const state = child.status === 'failed'
      ? 'error'
      : child.status === 'canceled'
        ? 'canceled'
        : child.status === 'queued'
          ? 'pending'
          : child.status === 'running'
            ? 'active'
            : 'complete'
    items.push({
      id: `child:${child.childRunId}`,
      kind: 'child_run',
      label: compactLabel(child.label || '子任务', 72),
      detail: compactText(child.error || child.summary || child.profile, 180),
      state
    })
  }
  for (const [index, compaction] of (metadata.compactions ?? []).entries()) {
    items.push({
      id: `compaction:${index}:${compaction.sourceDigest}`,
      kind: 'compaction',
      label: compaction.failed ? '上下文压缩失败' : '上下文已压缩',
      detail: compactText(compaction.error || compaction.reason || compaction.mode, 180),
      state: compaction.failed ? 'error' : 'complete'
    })
  }
}

function normalizeKind(kind: unknown): ProvenanceKind {
  switch (kind) {
    case 'status':
    case 'reasoning':
    case 'tool_call':
    case 'tool_result':
    case 'permission_request':
    case 'permission_resolved':
    case 'elicitation_request':
    case 'elicitation_resolved':
      return kind
    case 'child_run_queued':
    case 'child_run_started':
    case 'child_run_delta':
    case 'child_run_completed':
    case 'child_run_failed':
    case 'child_run_canceled':
      return 'child_run'
    case 'compaction':
      return 'compaction'
    default:
      return 'unknown'
  }
}

function isResultEvidence(kind: ProvenanceKind): boolean {
  return kind === 'tool_result' || kind === 'permission_resolved' || kind === 'elicitation_resolved'
}

function isPendingEvent(event: AgentChatProcessEvent): boolean {
  return event.kind === 'permission_request' || event.kind === 'elicitation_request'
}

function normalizedToolName(toolCall: AgentProcessToolCall): string {
  return toolCall.name.trim() || 'tool'
}

function requestTitleForTool(toolCall: AgentProcessToolCall): string {
  const name = normalizedToolName(toolCall)
  if (name === 'ask') return '等待用户选择'
  if (name === 'tool_permission') return '等待写入审批'
  return `调用工具：${name}`
}

function fallbackLabel(kind: ProvenanceKind, status?: string, toolName?: string): string {
  if (kind === 'reasoning') return '思考过程'
  if (kind === 'tool_call') return `调用工具：${toolName || 'tool'}`
  if (kind === 'tool_result') return `工具结果：${toolName || 'tool'}`
  if (kind === 'permission_request') return '等待写入审批'
  if (kind === 'permission_resolved') return '写入审批已处理'
  if (kind === 'elicitation_request') return '等待用户选择'
  if (kind === 'elicitation_resolved') return '用户选择已提交'
  if (kind === 'child_run') return '子任务活动'
  if (kind === 'compaction') return '上下文压缩'
  if (kind === 'status' && status) return `Agent：${status}`
  return 'Agent 活动'
}

function compactLabel(value: string, limit: number): string {
  return compactText(value, limit) || 'Agent 活动'
}

function preserveReasoningText(value: string | undefined): string | undefined {
  const text = value?.trim() ?? ''
  return text || undefined
}

function compactText(value: string | undefined, limit: number): string | undefined {
  const compacted = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!compacted) return undefined
  return compacted.length > limit ? `${compacted.slice(0, Math.max(0, limit - 1))}…` : compacted
}

