import type {
  AgentChatProcessEvent,
  AgentChatTurn,
  AgentToolPermissionRequest,
  AgentTurnMetadata,
  AskQuestion
} from '../../shared/teaching-types'
import { buildAgentProcessTimeline } from './agent-process-timeline'

const INLINE_RESULT_LIMIT = 12_000
const INLINE_ARGUMENT_LIMIT = 8_000

type AgentProcessToolCall = NonNullable<AgentChatTurn['toolCalls']>[number]

type ProvenanceKind =
  | 'status'
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

export type AgentConversationProvenanceItem = {
  id: string
  kind: ProvenanceKind
  label: string
  detail?: string
  state: 'active' | 'complete' | 'error' | 'canceled' | 'pending'
  disclosure?: AgentConversationDisclosure
}

export type AgentConversationAnsweredAsk = {
  id: string
  answer: string
}

export type AgentConversationTurnPresentation = {
  turnId: string
  active: boolean
  items: AgentConversationProvenanceItem[]
  answeredAsks: AgentConversationAnsweredAsk[]
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
    return { turnId: turn.id, active: false, items: [], answeredAsks: [] }
  }

  const toolResultDiagnostics = new Map(
    (turn.metadata?.toolResults ?? []).map((diagnostic) => [diagnostic.toolCallId, diagnostic])
  )
  const items: AgentConversationProvenanceItem[] = []
  const answeredAsks: AgentConversationAnsweredAsk[] = []

  for (const item of buildAgentProcessTimeline(turn)) {
    if (item.kind === 'event') {
      items.push(presentProcessEvent(item.event, item.toolCall, toolResultDiagnostics, active))
      continue
    }

    const syntheticEvents = synthesizeToolCallEvents(item.toolCall, toolResultDiagnostics.get(item.toolCall.id))
    for (const event of syntheticEvents) {
      items.push(presentProcessEvent(event, item.toolCall, toolResultDiagnostics, active))
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
  return { turnId: turn.id, active, items, answeredAsks }
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
  const resultKind = name === 'ask'
    ? 'elicitation_resolved'
    : name === 'tool_permission'
      ? 'permission_resolved'
      : 'tool_result'
  const call: AgentChatProcessEvent = {
    id: `durable:${toolCall.id}:call`,
    kind: requestKind,
    title: requestTitleForTool(toolCall),
    detail: compactText(toolCall.arguments, 180),
    toolCallId: toolCall.id,
    toolName: name,
    createdAt: ''
  }
  if (toolCall.result === undefined && !diagnostic) return [call]
  return [
    call,
    {
      id: `durable:${toolCall.id}:result`,
      kind: resultKind,
      title: resultTitleForTool(toolCall),
      detail: isDisclosureOnlyToolResult(toolCall, diagnostic) ? undefined : compactText(toolCall.result, 180),
      toolCallId: toolCall.id,
      toolName: name,
      isError: toolCall.isError,
      createdAt: ''
    }
  ]
}

function presentProcessEvent(
  event: AgentChatProcessEvent,
  toolCall: AgentProcessToolCall | undefined,
  diagnostics: Map<string, NonNullable<AgentTurnMetadata['toolResults']>[number]>,
  active: boolean
): AgentConversationProvenanceItem {
  const kind = normalizeKind(event.kind)
  const toolDiagnostic = event.toolCallId ? diagnostics.get(event.toolCallId) : undefined
  const state = event.isError || event.status === 'error'
    ? 'error'
    : event.status === 'canceled'
      ? 'canceled'
      : isPendingEvent(event)
        ? 'pending'
        : active && event.status !== 'done' && event.status !== 'tool_done'
          ? 'active'
          : 'complete'
  const resultFocused = isResultEvidence(kind)
  const disclosure = toolCall && isToolEvidence(kind)
    ? disclosureForTool(toolCall, toolDiagnostic, resultFocused)
    : undefined
  const detail = resultFocused && toolCall && isDisclosureOnlyToolResult(toolCall, toolDiagnostic)
    ? undefined
    : compactText(event.detail, 180)

  return {
    id: `event:${event.id}`,
    kind,
    label: compactLabel(event.title || fallbackLabel(kind, event.status, event.toolName), 72),
    detail,
    state,
    disclosure
  }
}

function disclosureForTool(
  toolCall: AgentProcessToolCall,
  diagnostic: NonNullable<AgentTurnMetadata['toolResults']>[number] | undefined,
  resultFocused: boolean
): AgentConversationDisclosure | undefined {
  const argumentsText = compactDisclosure(toolCall.arguments, INLINE_ARGUMENT_LIMIT)
  const result = toolCall.result
  const resultState = resultDisclosureState(toolCall, diagnostic)
  const safeResult = resultState === 'available' ? compactDisclosure(result, INLINE_RESULT_LIMIT) : undefined
  const hasArguments = Boolean(argumentsText)
  const shouldDescribeResult = resultFocused || result !== undefined || Boolean(diagnostic)
  const eligible = hasArguments || shouldDescribeResult
  if (!eligible) return undefined

  return {
    eligible,
    label: disclosureLabel(toolCall, resultFocused, resultState),
    arguments: argumentsText,
    result: safeResult,
    resultState: shouldDescribeResult ? resultState : undefined,
    notice: resultNotice(resultState, diagnostic)
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

function appendMetadataEvidence(items: AgentConversationProvenanceItem[], metadata: AgentTurnMetadata | undefined): void {
  if (!metadata) return
  for (const source of metadata.sources ?? []) {
    items.push({
      id: `source:${source.sourceId}`,
      kind: 'source',
      label: compactLabel(source.title || '引用来源', 72),
      detail: compactText(source.snippet || source.provider || source.url, 180),
      state: 'complete'
    })
  }
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

function isToolEvidence(kind: ProvenanceKind): boolean {
  return kind === 'tool_call' ||
    kind === 'tool_result' ||
    kind === 'permission_request' ||
    kind === 'permission_resolved' ||
    kind === 'elicitation_request' ||
    kind === 'elicitation_resolved'
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

function resultTitleForTool(toolCall: AgentProcessToolCall): string {
  const name = normalizedToolName(toolCall)
  if (name === 'ask') return toolCall.isError ? '用户选择处理失败' : '用户选择已提交'
  if (name === 'tool_permission') return toolCall.isError ? '写入审批已拒绝' : '写入审批已允许'
  return toolCall.isError ? `工具失败：${name}` : `工具完成：${name}`
}

function fallbackLabel(kind: ProvenanceKind, status?: string, toolName?: string): string {
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

function disclosureLabel(
  toolCall: AgentProcessToolCall,
  resultFocused: boolean,
  resultState: AgentConversationDisclosure['resultState']
): string {
  if (toolCall.name === 'tool_permission') return resultFocused ? '查看审批结果' : '查看审批请求'
  if (toolCall.name === 'ask') return resultFocused ? '查看用户回答' : '查看问题参数'
  if (resultFocused || resultState === 'archived' || resultState === 'oversized') return '查看工具结果'
  return '查看工具参数'
}

function resultNotice(
  resultState: AgentConversationDisclosure['resultState'],
  diagnostic: NonNullable<AgentTurnMetadata['toolResults']>[number] | undefined
): string | undefined {
  if (resultState === 'archived') {
    const location = diagnostic?.archive?.relativePath
    return location ? `结果已归档，未在对话中内嵌：${location}` : '结果已归档，未在对话中内嵌。'
  }
  if (resultState === 'oversized') return '结果过大，未在对话中内嵌。'
  if (resultState === 'missing') return '结果不可用或未保存到此对话。'
  return undefined
}

function compactDisclosure(value: string | undefined, limit: number): string | undefined {
  if (!value || value.length > limit) return undefined
  const formatted = prettyJson(value)
  return formatted.length <= limit ? formatted : value
}

function compactLabel(value: string, limit: number): string {
  return compactText(value, limit) || 'Agent 活动'
}

function compactText(value: string | undefined, limit: number): string | undefined {
  const compacted = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!compacted) return undefined
  return compacted.length > limit ? `${compacted.slice(0, Math.max(0, limit - 1))}…` : compacted
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
