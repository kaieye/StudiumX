import { redactAgentSecretText } from './agent-secret-redaction'
import type {
  AgentChatPresentationTimelineEntry,
  AgentChatProcessEvent,
  AgentChatToolCallView,
  AgentChatTurn,
  AgentTurnMetadata
} from './teaching-types'

/**
 * Fullwidth-pipe DSML tool markup occasionally appears in streamed model text.
 * Keep this helper shared so persistence and UI never surface the raw blocks.
 */
const DSML_TOOL_CALLS_RE = /<｜｜DSML｜｜tool_calls>([\s\S]*?)<\/｜｜DSML｜｜tool_calls>/gi
const DSML_INVOKE_RE = /<｜｜DSML｜｜invoke\s+([^>]*)>([\s\S]*?)<\/｜｜DSML｜｜invoke>/gi
const DSML_PARAMETER_RE = /<｜｜DSML｜｜parameter\s+([^>]*)>([\s\S]*?)<\/｜｜DSML｜｜parameter>/gi
const DSML_UNCLOSED_TOOL_CALLS_RE = /<｜｜DSML｜｜tool_calls>[\s\S]*$/i
const DSML_TAG_RE = /<\/?｜｜DSML｜｜[^>\n]*>/g
// Some compatible providers emit an XML-ish tool protocol in the text channel.
// Match only the protocol shape (a tool name followed by arg_key), rather than
// arbitrary <tool_call> prose or examples a learner may legitimately discuss.
const XML_TOOL_CALL_RE = /<tool_call>\s*[A-Za-z_][\w.-]*\s*<arg_key>[\s\S]*?<\/tool_call>/gi
const XML_UNCLOSED_TOOL_CALL_RE = /<tool_call>\s*[A-Za-z_][\w.-]*\s*<arg_key>[\s\S]*$/i
const UNSAFE_AGENT_PRESENTATION_TEXT_RE = /(?:RAW-(?:ANSWER|PROMPT)|CHAIN-OF-THOUGHT|provider(?:[\s_-]*)payload|system(?:[\s_-]*)prompt)/i
const REDACTION_REMNANT_RE = /\[redacted/i

export function stripDsmlToolCallBlocks(text: string): string {
  if (!text || !text.includes('DSML')) return text ?? ''
  return text
    .replace(DSML_TOOL_CALLS_RE, '')
    .replace(DSML_UNCLOSED_TOOL_CALLS_RE, '')
    .replace(DSML_TAG_RE, '')
    .trim()
}

/** Remove raw provider tool protocols from learner-visible model text. */
export function stripRawAgentToolCallBlocks(text: string): string {
  const withoutDsml = stripDsmlToolCallBlocks(text ?? '')
  if (!withoutDsml || !withoutDsml.includes('<tool_call>')) return withoutDsml
  return withoutDsml
    .replace(XML_TOOL_CALL_RE, '')
    .replace(XML_UNCLOSED_TOOL_CALL_RE, '')
    .trim()
}

export function sanitizeAgentTurnContent(content: string | null | undefined): string {
  return stripRawAgentToolCallBlocks(content ?? '')
}

/**
 * Learner-safe text allowed in the optional conversation presentation timeline.
 *
 * This intentionally differs from the canonical assistant content sanitizer:
 * the timeline is a UI-only runtime projection and must fail closed for raw
 * provider diagnostics, credential redaction remnants, and machine-local paths.
 * It is safe to call for live deltas as well as persisted timeline entries.
 */
export function sanitizeAgentPresentationText(content: string | null | undefined): string {
  const sanitized = sanitizeAgentTurnContent(content)
  if (!sanitized) return ''
  const redacted = redactAgentSecretText(sanitized)
  if (!redacted || redacted !== sanitized || REDACTION_REMNANT_RE.test(redacted)) return ''
  if (UNSAFE_AGENT_PRESENTATION_TEXT_RE.test(redacted) || containsAbsoluteOrHomePath(redacted)) return ''
  return redacted
}

function containsAbsoluteOrHomePath(value: string): boolean {
  if (/(?:^|[^A-Za-z0-9_])[A-Za-z]:(?:\\|\/)\S/.test(value)) return true
  if (/(?:^|[\s"'`(=])(?:\\\\[^\s\\/]+\\[^\s"'`]+|\/\/[A-Za-z0-9._$-]+\/[^\s"'`]+)/.test(value)) return true
  if (/\\\\[A-Za-z0-9._$-]+\\[A-Za-z0-9._$\\\/-]+/.test(value)) return true
  if (/(?:^|[\s"'`(=])\/(?:[A-Za-z0-9._+-]+\/)+[A-Za-z0-9._+-]+/.test(value)) return true
  if (/(?:^|[\s"'`(=])\/[A-Za-z0-9._+-]{2,}(?=[\s"'`)]|$)/.test(value)) return true
  return /(?:^|[\s"'`(=])(?:~|\$HOME)(?:\/[^\s"'`]*)?(?=[\s"'`)]|$)/.test(value)
}

/**
 * One user prompt may drive many provider assistant messages (tool loop).
 * The live UI keeps a single pending assistant turn; durable history must match
 * that shape so completed runs do not replay as multiple “规划中” cards.
 */
export function collapseConsecutiveAssistantTurns(turns: readonly AgentChatTurn[]): AgentChatTurn[] {
  const collapsed: AgentChatTurn[] = []
  for (const turn of turns) {
    if (turn.role !== 'assistant') {
      collapsed.push(turn)
      continue
    }
    const previous = collapsed[collapsed.length - 1]
    if (!previous || previous.role !== 'assistant') {
      collapsed.push(sanitizeAssistantTurn(turn))
      continue
    }
    collapsed[collapsed.length - 1] = mergeAssistantTurns(previous, turn)
  }
  return collapsed
}

export function sanitizeAgentConversationTurns(turns: readonly AgentChatTurn[]): AgentChatTurn[] {
  return collapseConsecutiveAssistantTurns(turns.map((turn) => (
    turn.role === 'assistant' ? sanitizeAssistantTurn(turn) : turn
  )))
}

function sanitizeAssistantTurn(turn: AgentChatTurn): AgentChatTurn {
  const parsedToolCalls = parseDsmlToolCallsAsViews(turn.content)
  const content = sanitizeAgentTurnContent(turn.content)
  const toolCalls = mergeToolCalls(turn.toolCalls, parsedToolCalls.length ? parsedToolCalls : undefined)
  const presentationTimeline = sanitizeAgentPresentationTimeline(turn.presentationTimeline, turn.processEvents)
  if (
    content === turn.content &&
    parsedToolCalls.length === 0 &&
    toolCalls.length === (turn.toolCalls?.length ?? 0) &&
    presentationTimelinesEqual(presentationTimeline, turn.presentationTimeline)
  ) {
    return turn
  }
  return {
    ...turn,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    presentationTimeline
  }
}

function parseDsmlToolCallsAsViews(text: string | null | undefined): AgentChatToolCallView[] {
  if (!text || !text.includes('DSML')) return []
  const calls: AgentChatToolCallView[] = []
  DSML_TOOL_CALLS_RE.lastIndex = 0
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = DSML_TOOL_CALLS_RE.exec(text)) !== null) {
    const block = blockMatch[1] ?? ''
    DSML_INVOKE_RE.lastIndex = 0
    let invokeMatch: RegExpExecArray | null
    while ((invokeMatch = DSML_INVOKE_RE.exec(block)) !== null) {
      const name = readDsmlAttribute(invokeMatch[1] ?? '', 'name')
      if (!name) continue
      const args: Record<string, unknown> = {}
      const parameterBlock = invokeMatch[2] ?? ''
      DSML_PARAMETER_RE.lastIndex = 0
      let parameterMatch: RegExpExecArray | null
      while ((parameterMatch = DSML_PARAMETER_RE.exec(parameterBlock)) !== null) {
        const parameterAttrs = parameterMatch[1] ?? ''
        const parameterName = readDsmlAttribute(parameterAttrs, 'name')
        if (!parameterName) continue
        const forceString = readDsmlAttribute(parameterAttrs, 'string') === 'true'
        const rawValue = decodeDsmlText(parameterMatch[2] ?? '')
        args[parameterName] = coerceDsmlParameterValue(rawValue, forceString)
      }
      const argText = JSON.stringify(args)
      calls.push({
        id: `dsml_${calls.length}_${stableHash(`${name}:${argText}`)}`,
        name,
        arguments: argText
      })
    }
  }
  return calls
}

function readDsmlAttribute(attrs: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')
  return decodeDsmlText(attrs.match(pattern)?.[1] ?? '').trim()
}

function decodeDsmlText(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim()
}

function coerceDsmlParameterValue(value: string, forceString: boolean): unknown {
  if (forceString) return value
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  if (/^null$/i.test(value)) return null
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

function stableHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function mergeAssistantTurns(left: AgentChatTurn, right: AgentChatTurn): AgentChatTurn {
  const content = preferAssistantContent(left.content, right.content)
  const leftSanitized = sanitizeAssistantTurn(left)
  const rightSanitized = sanitizeAssistantTurn(right)
  const toolCalls = mergeToolCalls(leftSanitized.toolCalls, rightSanitized.toolCalls)
  const processEvents = mergeProcessEvents(leftSanitized.processEvents, rightSanitized.processEvents)
  const presentationTimeline = mergeAgentPresentationTimelines(
    leftSanitized,
    rightSanitized,
    processEvents
  )
  const metadata = mergeAgentTurnMetadata(left.metadata, right.metadata)
  return {
    ...left,
    // Keep the earliest durable id so live process events stay attached after reconcile.
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    processEvents: processEvents.length > 0 ? processEvents : undefined,
    presentationTimeline,
    metadata,
    createdAt: left.createdAt || right.createdAt
  }
}

function preferAssistantContent(left: string, right: string): string {
  const rightText = sanitizeAgentTurnContent(right)
  if (rightText) return rightText
  return sanitizeAgentTurnContent(left)
}

function mergeToolCalls(
  left: AgentChatToolCallView[] | undefined,
  right: AgentChatToolCallView[] | undefined
): AgentChatToolCallView[] {
  const out: AgentChatToolCallView[] = []
  const indexByKey = new Map<string, number>()
  for (const toolCall of [...(left ?? []), ...(right ?? [])]) {
    const key = `${toolCall.id}::${toolCall.name}`
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, out.length)
      out.push(toolCall)
      continue
    }
    const existing = out[existingIndex]
    out[existingIndex] = {
      ...existing,
      arguments: toolCall.arguments || existing.arguments,
      result: toolCall.result !== undefined ? toolCall.result : existing.result,
      isError: toolCall.result !== undefined ? toolCall.isError : existing.isError
    }
  }
  return out
}

function mergeProcessEvents(
  left: AgentChatProcessEvent[] | undefined,
  right: AgentChatProcessEvent[] | undefined
): AgentChatProcessEvent[] {
  const out: AgentChatProcessEvent[] = []
  const indexById = new Map<string, number>()
  for (const event of [...(left ?? []), ...(right ?? [])]) {
    const existingIndex = indexById.get(event.id)
    if (existingIndex === undefined) {
      indexById.set(event.id, out.length)
      out.push(event)
      continue
    }
    // A later tool/result update may settle the same process event. Keep its
    // stable identity and chronology while retaining earlier non-empty fields.
    const existing = out[existingIndex]
    out[existingIndex] = {
      ...existing,
      ...event,
      title: event.title || existing.title,
      detail: event.detail ?? existing.detail,
      toolCallId: event.toolCallId ?? existing.toolCallId,
      toolName: event.toolName ?? existing.toolName,
      createdAt: existing.createdAt || event.createdAt
    }
  }
  return out
}

/**
 * Append/extend a visible assistant text block without losing the arrival
 * boundary created by a preceding Think/tool row.
 */
export function appendAgentPresentationText(
  timeline: AgentChatPresentationTimelineEntry[] | undefined,
  content: string,
  createdAt: string,
  id: string,
  sequence?: number
): AgentChatPresentationTimelineEntry[] {
  const current = timeline ?? []
  const visibleContent = sanitizeAgentPresentationText(content)
  if (!visibleContent) return current
  const last = current[current.length - 1]
  if (last?.kind === 'assistant_text') {
    // Deltas can split a diagnostic marker across event boundaries. Recheck the
    // joined block before exposing it; retain the already-safe prefix if the
    // new suffix would make the visible block unsafe.
    const combined = sanitizeAgentPresentationText(`${last.content}${visibleContent}`)
    if (!combined) return current
    return [...current.slice(0, -1), { ...last, content: combined }]
  }
  return [...current, {
    id,
    sequence: validAgentPresentationTimelineSequence(sequence)
      ? sequence
      : nextAgentPresentationTimelineSequence(current),
    kind: 'assistant_text',
    content: visibleContent,
    createdAt
  }]
}

/** Add one stable reference to an existing learner-safe process event. */
export function appendAgentPresentationProcess(
  timeline: AgentChatPresentationTimelineEntry[] | undefined,
  processEventId: string,
  createdAt: string,
  id: string,
  sequence?: number
): AgentChatPresentationTimelineEntry[] {
  const current = timeline ?? []
  if (!processEventId || current.some((entry) => entry.kind === 'process' && entry.processEventId === processEventId)) {
    return current
  }
  return [...current, {
    id,
    sequence: validAgentPresentationTimelineSequence(sequence)
      ? sequence
      : nextAgentPresentationTimelineSequence(current),
    kind: 'process',
    processEventId,
    createdAt
  }]
}

export function nextAgentPresentationTimelineSequence(
  timeline: readonly AgentChatPresentationTimelineEntry[] | undefined
): number {
  let max = -1
  for (const entry of timeline ?? []) {
    if (validAgentPresentationTimelineSequence(entry.sequence) && entry.sequence > max) max = entry.sequence
  }
  return max + 1
}

/**
 * Normalizes trusted typed data before persistence or rendering. Unknown JSON
 * is checked by the persistence parser first; this helper removes raw tool
 * protocol fragments from text and canonicalizes ordering/deduplication.
 */
export function sanitizeAgentPresentationTimeline(
  timeline: readonly AgentChatPresentationTimelineEntry[] | undefined,
  processEvents?: readonly AgentChatProcessEvent[]
): AgentChatPresentationTimelineEntry[] | undefined {
  if (!timeline?.length) return undefined
  const knownProcessEventIds = processEvents
    ? new Set(processEvents.map((event) => event.id).filter(Boolean))
    : undefined
  const sorted = timeline
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftSequence = validAgentPresentationTimelineSequence(left.entry.sequence)
        ? left.entry.sequence
        : Number.MAX_SAFE_INTEGER
      const rightSequence = validAgentPresentationTimelineSequence(right.entry.sequence)
        ? right.entry.sequence
        : Number.MAX_SAFE_INTEGER
      return leftSequence - rightSequence || left.index - right.index
    })
  const seenIds = new Set<string>()
  const seenProcessIds = new Set<string>()
  const normalized: AgentChatPresentationTimelineEntry[] = []
  for (const { entry } of sorted) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      !validAgentPresentationTimelineSequence(entry.sequence) ||
      typeof entry.createdAt !== 'string' ||
      !entry.createdAt.trim() ||
      seenIds.has(entry.id)
    ) continue
    if (entry.kind === 'assistant_text') {
      if (typeof entry.content !== 'string') continue
      const content = sanitizeAgentPresentationText(entry.content)
      if (!content) continue
      seenIds.add(entry.id)
      normalized.push({
        id: entry.id,
        // Filtering a malformed/dangling predecessor must not leave holes in
        // the canonical ordering. Reindex after the stable sequence sort so
        // every persisted/rendered timeline is compact and deterministic.
        sequence: normalized.length,
        kind: 'assistant_text',
        content,
        createdAt: entry.createdAt
      })
      continue
    }
    if (
      entry.kind !== 'process' ||
      typeof entry.processEventId !== 'string' ||
      !entry.processEventId.trim() ||
      seenProcessIds.has(entry.processEventId) ||
      (knownProcessEventIds !== undefined && !knownProcessEventIds.has(entry.processEventId))
    ) continue
    seenIds.add(entry.id)
    seenProcessIds.add(entry.processEventId)
    normalized.push({
      id: entry.id,
      // Keep the arrival order chosen above while compacting the public
      // sequence after invalid rows have been discarded.
      sequence: normalized.length,
      kind: 'process',
      processEventId: entry.processEventId,
      createdAt: entry.createdAt
    })
  }
  return normalized.length > 0 ? normalized : undefined
}

function mergeAgentPresentationTimelines(
  left: AgentChatTurn,
  right: AgentChatTurn,
  processEvents: readonly AgentChatProcessEvent[]
): AgentChatPresentationTimelineEntry[] | undefined {
  // Legacy assistant turns intentionally stay timeline-free. Turning their
  // aggregate `content` into a synthetic entry here would duplicate it once a
  // completed EventBus-derived transcript is attached to the collapsed turn.
  const leftTimeline = sanitizeAgentPresentationTimeline(left.presentationTimeline, left.processEvents) ?? []
  const rightTimeline = sanitizeAgentPresentationTimeline(right.presentationTimeline, right.processEvents) ?? []
  if (leftTimeline.length === 0 && rightTimeline.length === 0) return undefined
  return sanitizeAgentPresentationTimeline([...leftTimeline, ...rightTimeline], processEvents)
}

function validAgentPresentationTimelineSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function presentationTimelinesEqual(
  left: readonly AgentChatPresentationTimelineEntry[] | undefined,
  right: readonly AgentChatPresentationTimelineEntry[] | undefined
): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((entry, index) => {
    const candidate = right[index]
    if (!candidate || entry.kind !== candidate.kind || entry.id !== candidate.id || entry.sequence !== candidate.sequence || entry.createdAt !== candidate.createdAt) return false
    return entry.kind === 'assistant_text'
      ? candidate.kind === 'assistant_text' && entry.content === candidate.content
      : candidate.kind === 'process' && entry.processEventId === candidate.processEventId
  })
}

function mergeAgentTurnMetadata(
  left: AgentTurnMetadata | undefined,
  right: AgentTurnMetadata | undefined
): AgentTurnMetadata | undefined {
  if (!left) return right
  if (!right) return left
  const sources = mergeByKey(
    [...(left.sources ?? []), ...(right.sources ?? [])],
    (source) => source.sourceId || source.url
  )
  const childRuns = mergeByKey(
    [...(left.childRuns ?? []), ...(right.childRuns ?? [])],
    (child) => child.childRunId
  )
  const compactions = mergeByKey(
    [...(left.compactions ?? []), ...(right.compactions ?? [])],
    (compaction) => compaction.id || compaction.sourceDigest
  )
  const toolResults = mergeByKey(
    [...(left.toolResults ?? []), ...(right.toolResults ?? [])],
    (tool) => `${tool.toolCallId}:${tool.toolName}`
  )
  const contextHygiene = [...(left.contextHygiene ?? []), ...(right.contextHygiene ?? [])]
  const metadata: AgentTurnMetadata = {
    version: 1,
    ...(sources.length ? { sources } : {}),
    ...(childRuns.length ? { childRuns } : {}),
    ...(compactions.length ? { compactions } : {}),
    ...(contextHygiene.length ? { contextHygiene } : {}),
    contextEstimate: right.contextEstimate ?? left.contextEstimate,
    ...(toolResults.length ? { toolResults } : {}),
    runUsage: right.runUsage ?? left.runUsage,
    runId: right.runId ?? left.runId,
    parentTurnProof: right.parentTurnProof ?? left.parentTurnProof,
    provenance: right.provenance ?? left.provenance
  }
  return hasMetadataContent(metadata) ? metadata : undefined
}

function mergeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const out = new Map<string, T>()
  for (const item of items) out.set(keyOf(item), item)
  return [...out.values()]
}

function hasMetadataContent(metadata: AgentTurnMetadata): boolean {
  return Boolean(
    metadata.sources?.length ||
    metadata.childRuns?.length ||
    metadata.compactions?.length ||
    metadata.contextHygiene?.length ||
    metadata.contextEstimate ||
    metadata.toolResults?.length ||
    metadata.runUsage ||
    metadata.runId ||
    metadata.parentTurnProof ||
    metadata.provenance
  )
}
