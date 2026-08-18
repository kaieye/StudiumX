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
  sanitizeFileTouchDisplayPath,
  type FileTouchPresentation
} from '../../shared/context-file-touch-projection'
import { buildAgentProcessTimeline } from './agent-process-timeline'
import {
  sanitizeAgentPresentationText,
  sanitizeAgentPresentationTimeline
} from '../../shared/agent-conversation-turns'
import { agentConversationToolDisplayName } from '../../shared/agent-conversation-tool-label'
import {
  presentAgentToolContent,
  type AgentConversationToolContent
} from './agent-tool-content-presentation'

const INLINE_RESULT_LIMIT = 12_000
const INLINE_ARGUMENT_LIMIT = 12_000
const TOOL_SUMMARY_LIMIT = 180

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
  /**
   * Bounded renderer-only presentation for well-known workspace tools. This
   * is derived solely from the same safe text projection as `arguments` and
   * `result`; it is never a raw provider/tool payload.
   */
  content?: AgentConversationToolContent
}

export type AgentConversationProvenanceState =
  | 'active'
  | 'complete'
  | 'error'
  | 'canceled'
  | 'pending'
  | 'interrupted'
  | 'resource_limit'
  | 'suspended'
  | 'no_progress'
  | 'context_unrecoverable'
  | 'retry_exhausted'

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
  | { kind: 'resource_limit' }
  | { kind: 'suspended' }
  | { kind: 'no_progress' }
  | { kind: 'context_unrecoverable' }
  | { kind: 'retry_exhausted' }

export type AgentConversationFlowItem =
  | {
      id: string
      kind: 'process'
      item: AgentConversationProvenanceItem
    }
  | {
      id: string
      kind: 'assistant_text'
      content: string
    }

export type AgentConversationTurnPresentation = {
  turnId: string
  /** Retained for existing consumers; prefer the discriminated `status`. */
  active: boolean
  status: AgentConversationTurnStatus
  items: AgentConversationProvenanceItem[]
  /**
   * Ordered visible transcript of Think/tool rows and model prose. It is a
   * renderer projection only, separate from teaching evidence and settlement.
   */
  flow?: AgentConversationFlowItem[]
  answeredAsks: AgentConversationAnsweredAsk[]
  sources: AgentConversationSourceReference[]
  /**
   * Learner-facing files-touched reference projection (ADR-0003).
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
      // A tool call owns one stable row. Legacy result events only settle
      // that row and must not turn into a second visible tool card.
      if (
        item.event.kind === 'tool_result' &&
        item.event.toolCallId &&
        liveToolCallIds.has(item.event.toolCallId)
      ) continue
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
  const flow = buildOrderedConversationFlow(turn, items)
  return {
    turnId: turn.id,
    active: effectivelyActive,
    status,
    items,
    ...(flow?.length ? { flow } : {}),
    answeredAsks,
    sources: presentSourceReferences(turn.metadata),
    fileTouches: presentFileTouches(turn)
  }
}

/**
 * Rehydrate the exact visible order captured during streaming. Only refs to
 * existing safe process items are used; malformed/dangling refs simply vanish.
 * The canonical assistant text is appended conservatively so an older or
 * partial timeline can never hide the final answer.
 */
function buildOrderedConversationFlow(
  turn: AgentChatTurn,
  items: readonly AgentConversationProvenanceItem[]
): AgentConversationFlowItem[] | undefined {
  const timeline = sanitizeAgentPresentationTimeline(turn.presentationTimeline)
  if (!timeline?.length) return undefined
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const flow: AgentConversationFlowItem[] = []
  let timelineText = ''

  const appendText = (id: string, value: string): void => {
    const content = safeTimelineAssistantText(value)
    if (!content) return
    timelineText += content
    const previous = flow[flow.length - 1]
    if (previous?.kind === 'assistant_text') {
      previous.content += content
      return
    }
    flow.push({ id, kind: 'assistant_text', content })
  }

  for (const entry of timeline) {
    if (entry.kind === 'assistant_text') {
      appendText(`timeline:${entry.id}`, entry.content)
      continue
    }
    const item = itemsById.get(`event:${entry.processEventId}`)
    if (item) flow.push({ id: `timeline:${entry.id}`, kind: 'process', item })
  }

  const canonical = safeTimelineAssistantText(turn.content)
  if (!canonical) return flow.length ? flow : undefined
  if (!timelineText) {
    appendText(`canonical:${turn.id}`, canonical)
  } else if (canonical.startsWith(timelineText)) {
    appendText(`canonical-suffix:${turn.id}`, canonical.slice(timelineText.length))
  } else if (canonical !== timelineText) {
    // A server collapse can replace intermediate prose with a distinct final
    // message. Keep it visible rather than guessing that it is duplicate.
    appendText(`canonical:${turn.id}`, canonical)
  }
  return flow.length ? flow : undefined
}

function safeTimelineAssistantText(value: string | null | undefined): string {
  return sanitizeAgentPresentationText(value)
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
  const terminalStatus = [...(turn.processEvents ?? [])].reverse().find((event) =>
    event.kind === 'status' && (
      event.status === 'done' ||
      event.status === 'canceled' ||
      event.status === 'error' ||
      event.status === 'resource_limit' ||
      event.status === 'suspended' ||
      event.status === 'no_progress' ||
      event.status === 'context_unrecoverable' ||
      event.status === 'retry_exhausted'
    )
  )?.status
  if (terminalStatus === 'resource_limit') return { kind: 'resource_limit' }
  if (terminalStatus === 'suspended') return { kind: 'suspended' }
  if (terminalStatus === 'no_progress') return { kind: 'no_progress' }
  if (terminalStatus === 'context_unrecoverable') return { kind: 'context_unrecoverable' }
  if (terminalStatus === 'retry_exhausted') return { kind: 'retry_exhausted' }
  // An interrupted recovery may carry an old generic error marker. Preserve the
  // read-only interruption semantics unless the record carries a distinct,
  // structured terminal reason above.
  if (turn.metadata?.provenance?.kind === 'recovery_notice') return { kind: 'interrupted' }
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
      detail: sanitizeAgentPresentationText(interruption.questions[0]?.prompt) || undefined,
      questions: interruption.questions,
      deadlineAt: interruption.deadlineAt ?? null,
      command: commandForInterruption(interruption) as Extract<AgentConversationCommandDescriptor, { kind: 'answer_ask' }>
    }
  }
  return {
    kind: 'tool_permission',
    title: '等待写入审批',
    detail: sanitizeAgentPresentationText(
      `${interruption.request.operation}${interruption.request.targetPath ? `：${interruption.request.targetPath}` : ''}`
    ) || undefined,
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
    // Tool argument JSON is never a learner-facing process description. Older
    // durable calls may not have the structured request UI, so fail closed.
    detail: undefined,
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
    : event.status === 'resource_limit'
      ? 'resource_limit'
      : event.status === 'suspended'
        ? 'suspended'
        : event.status === 'no_progress'
          ? 'no_progress'
          : event.status === 'context_unrecoverable'
            ? 'context_unrecoverable'
            : event.status === 'retry_exhausted'
              ? 'retry_exhausted'
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
  const disclosure = kind === 'tool_call' || kind === 'tool_result'
    ? presentToolDisclosure({
        kind,
        toolName: event.toolName ?? toolCall?.name,
        toolCall,
        diagnostic: toolDiagnostic,
        eventDetail: event.detail,
        state
      })
    : undefined
  const detail = kind === 'reasoning'
    ? sanitizeAgentPresentationText(event.detail) || undefined
    : kind === 'tool_call' || kind === 'tool_result'
      ? disclosure?.label
      : resultFocused && toolCall && isDisclosureOnlyToolResult(toolCall, toolDiagnostic)
        ? undefined
        : compactText(sanitizeAgentPresentationText(event.detail), 180)

  return {
    id: `event:${event.id}`,
    kind,
    label: kind === 'reasoning'
      ? (event.title || fallbackLabel(kind, event.status, event.toolName))
      // Tool names are runtime identifiers, not learner-facing copy. Keep the
      // presentation on the small, reviewed category vocabulary even if an
      // older durable event carried a provider-facing title.
      : kind === 'tool_call' || kind === 'tool_result'
        ? agentConversationToolDisplayName(event.toolName ?? toolCall?.name)
      : compactLabel(event.title || fallbackLabel(kind, event.status, event.toolName), 72),
    detail,
    state,
    disclosure
  }
}

/**
 * A tool trace is useful only when it stays a small, safe renderer projection.
 * Do not surface raw provider frames, secrets, machine-local paths, or an
 * arbitrary unbounded payload. The structured tool-call record is the source
 * for normal calls; a typed event detail is only a legacy fallback when that
 * record is unavailable.
 */
function presentToolDisclosure({
  kind,
  toolName,
  toolCall,
  diagnostic,
  eventDetail,
  state
}: {
  kind: Extract<ProvenanceKind, 'tool_call' | 'tool_result'>
  toolName: string | undefined
  toolCall: AgentProcessToolCall | undefined
  diagnostic: NonNullable<AgentTurnMetadata['toolResults']>[number] | undefined
  eventDetail: string | undefined
  state: AgentConversationProvenanceState
}): AgentConversationDisclosure | undefined {
  const argumentSource = toolCall?.arguments ?? (kind === 'tool_call' ? eventDetail : undefined)
  const resultSource = toolCall?.result ?? (kind === 'tool_result' ? eventDetail : undefined)
  const argumentsProjection = projectToolPayload(argumentSource, INLINE_ARGUMENT_LIMIT)
  const resultState = toolCall
    ? resultDisclosureState(toolCall, diagnostic)
    : resultStateForLegacyEvent(resultSource)
  const resultProjection: ToolPayloadProjection = resultState === 'available'
    ? projectToolPayload(resultSource, INLINE_RESULT_LIMIT)
    : { state: 'missing' }
  const inputSummary = toolSummaryFromArguments(toolName, argumentSource)
  const outputSummary = resultProjection.value ? firstToolOutputLine(resultProjection.value) : undefined
  const notice = toolDisclosureNotice({
    argumentState: argumentsProjection.state,
    resultState,
    projectedResultState: resultProjection.state,
    completed: state !== 'active' && state !== 'pending',
    failed: state === 'error'
  })
  const label = state === 'error'
    ? outputSummary ?? inputSummary ?? toolStateSummary(state)
    : inputSummary ?? outputSummary ?? toolStateSummary(state)
  const eligible = Boolean(argumentsProjection.value || resultProjection.value || notice)

  if (!eligible) return undefined
  // Feed the structured-card presenter the raw (internally bounded) sources, not
  // the display projection: a large write/read/terminal payload may exceed the
  // 12 KiB display projection yet still deserves its card. The card presenters
  // re-run their own per-value redaction and length bounds.
  const content = presentAgentToolContent({
    toolName,
    argumentsText: argumentSource,
    resultText: resultSource,
    running: state === 'active' || state === 'pending',
    failed: state === 'error'
  })
  return {
    eligible,
    label,
    arguments: argumentsProjection.value,
    result: resultProjection.value,
    resultState,
    notice,
    ...(content ? { content } : {})
  }
}

type ToolPayloadState = 'available' | 'missing' | 'unsafe' | 'oversized'

type ToolPayloadProjection = {
  state: ToolPayloadState
  value?: string
}

/**
 * Parse JSON before screening it so escaped keys/paths are canonicalized before
 * the secret and absolute-path guards run. Non-JSON tools (for example a shell
 * command) retain their plain text shape.
 */
function projectToolPayload(raw: string | undefined, limit: number): ToolPayloadProjection {
  if (typeof raw !== 'string' || !raw.trim()) return { state: 'missing' }
  if (raw.length > limit) return { state: 'oversized' }
  const formatted = formatToolPayload(raw)
  if (!formatted || formatted.length > limit) return { state: 'oversized' }
  const safe = sanitizeAgentPresentationText(formatted)
  // sanitizeAgentPresentationText deliberately drops protocol fragments as well
  // as unsafe payloads. A transformed value must never be mistaken for a safe
  // original tool payload.
  if (!safe || safe !== formatted) return { state: 'unsafe' }
  return { state: 'available', value: safe }
}

function formatToolPayload(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const formatted = JSON.stringify(parsed, null, 2)
    return typeof formatted === 'string' ? formatted : trimmed
  } catch {
    return trimmed
  }
}

function resultStateForLegacyEvent(result: string | undefined): NonNullable<AgentConversationDisclosure['resultState']> {
  if (typeof result !== 'string') return 'missing'
  return result.length > INLINE_RESULT_LIMIT ? 'oversized' : 'available'
}

function toolDisclosureNotice({
  argumentState,
  resultState,
  projectedResultState,
  completed,
  failed
}: {
  argumentState: ToolPayloadState
  resultState: NonNullable<AgentConversationDisclosure['resultState']>
  projectedResultState: ToolPayloadState
  completed: boolean
  failed: boolean
}): string | undefined {
  if (argumentState === 'unsafe') return '工具参数包含不安全内容，未在对话中显示。'
  if (argumentState === 'oversized') return '工具参数过长，未在对话中内联显示。'
  if (resultState === 'archived') return '工具结果已归档，未在对话中内联显示。'
  if (resultState === 'oversized' || projectedResultState === 'oversized') return '工具结果过长，未在对话中内联显示。'
  if (projectedResultState === 'unsafe') return '工具结果包含不安全内容，未在对话中显示。'
  if (completed && resultState === 'missing' && argumentState !== 'available') {
    return failed ? '工具执行失败，未返回可显示的详情。' : '工具未返回可显示的结果。'
  }
  return undefined
}

/** Summary order mirrors the reference transcript: a file mutation shows its
 * relative path, a shell call prefers its human description, and a search
 * shows the query/pattern. Every candidate came through projectToolPayload
 * first; paths additionally use the workspace-relative path projector. */
function toolSummaryFromArguments(toolName: string | undefined, argumentsText: string | undefined): string | undefined {
  if (!argumentsText) return undefined
  const values = parseToolArgumentRecord(argumentsText)
  if (!values) return compactText(argumentsText, TOOL_SUMMARY_LIMIT)

  const path = safeToolPathValue(values, [
    'path', 'file_path', 'filePath', 'targetPath', 'relativePath', 'filename', 'file'
  ])
  const description = safeToolTextValue(values, ['description', 'summary', 'title', 'message'])
  const command = safeToolTextValue(values, ['command', 'cmd', 'script'])
  const query = safeToolTextValue(values, ['query', 'pattern', 'search', 'q', 'term'])

  switch (agentConversationToolDisplayName(toolName)) {
    case 'Bash': return description ?? command ?? query ?? path
    case 'READ':
    case 'Write':
    case 'Edit': return path ?? description ?? command ?? query
    case 'Search': return query ?? path ?? description ?? command
    default: return description ?? path ?? command ?? query
  }
}

function parseToolArgumentRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function safeToolPathValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    const safe = sanitizeFileTouchDisplayPath(value)
    if (safe) return compactText(safe, TOOL_SUMMARY_LIMIT)
  }
  return undefined
}

function safeToolTextValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const safe = sanitizeAgentPresentationText(value)
    const compact = compactText(safe, TOOL_SUMMARY_LIMIT)
    if (compact) return compact
  }
  return undefined
}

function firstToolOutputLine(value: string): string | undefined {
  return compactText(value.split(/\r?\n/, 1)[0], TOOL_SUMMARY_LIMIT)
}

function toolStateSummary(state: AgentConversationProvenanceState): string {
  switch (state) {
    case 'active': return '正在执行'
    case 'pending': return '等待执行'
    case 'error': return '工具执行失败'
    case 'canceled': return '工具调用已取消'
    case 'interrupted': return '工具调用等待确认'
    case 'resource_limit': return '已达到资源边界'
    case 'suspended': return '运行已暂停'
    case 'no_progress': return '未检测到安全进展'
    case 'context_unrecoverable': return '上下文无法继续'
    case 'retry_exhausted': return '重试已用尽'
    default: return '已完成'
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
  return agentConversationToolDisplayName(name)
}

function fallbackLabel(kind: ProvenanceKind, status?: string, toolName?: string): string {
  if (kind === 'reasoning') return '思考过程'
  if (kind === 'tool_call' || kind === 'tool_result') return agentConversationToolDisplayName(toolName)
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

function compactText(value: string | undefined, limit: number): string | undefined {
  const compacted = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!compacted) return undefined
  return compacted.length > limit ? `${compacted.slice(0, Math.max(0, limit - 1))}…` : compacted
}
