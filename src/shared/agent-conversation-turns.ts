import type {
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
  if (content === turn.content && parsedToolCalls.length === 0 && toolCalls.length === (turn.toolCalls?.length ?? 0)) {
    return turn
  }
  return {
    ...turn,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined
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
  const processEvents = preferProcessEvents(left.processEvents, right.processEvents)
  const metadata = mergeAgentTurnMetadata(left.metadata, right.metadata)
  return {
    ...left,
    // Keep the earliest durable id so live process events stay attached after reconcile.
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    processEvents: processEvents.length > 0 ? processEvents : undefined,
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

function preferProcessEvents(
  left: AgentChatProcessEvent[] | undefined,
  right: AgentChatProcessEvent[] | undefined
): AgentChatProcessEvent[] {
  const leftEvents = left ?? []
  const rightEvents = right ?? []
  if (leftEvents.length === 0) return rightEvents
  if (rightEvents.length === 0) return leftEvents
  // Live UI process timeline is usually richer than reconstructed durable turns.
  return leftEvents.length >= rightEvents.length ? leftEvents : rightEvents
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
