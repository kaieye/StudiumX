import { Buffer } from 'node:buffer'
import type {
  AgentChatToolCallView,
  AgentChatTurn,
  AgentArtifactRef,
  AgentChildRunMetadata,
  AgentCompactionMetadata,
  AgentContextEstimateMetadata,
  AgentContextHygieneMetadata,
  AgentSourceMetadata,
  AgentToolResultDiagnostic,
  AgentTurnMetadata,
  AgentRunUsageAggregate
} from '../../shared/teaching-types'
import type { AgentLoopEvent } from './agent-loop'

const MAX_SOURCES = 20
const MAX_CHILD_RUNS = 20
const MAX_COMPACTIONS = 20
const MAX_CONTEXT_HYGIENE = 20
const MAX_TOOL_DIAGNOSTICS = 20
const MAX_SOURCE_NODES = 2000
const MAX_SUMMARY_LENGTH = 2000
const MAX_SNIPPET_LENGTH = 500
const MAX_ERROR_LENGTH = 1000
const MAX_TITLE_LENGTH = 240
const MAX_FILES_READ = 40
const MAX_CITATIONS = 20
const LARGE_TOOL_RESULT_BYTES = 2048
const LARGE_TOOL_RESULT_LINES = 40

export function attachAgentRunAuditMetadata(
  turns: AgentChatTurn[],
  events: AgentLoopEvent[],
  usage?: AgentRunUsageAggregate
): AgentChatTurn[] {
  const assistantIndex = findLastAssistantTurnIndex(turns)
  if (assistantIndex < 0) return turns
  const metadata = buildAgentTurnAuditMetadata(events, turns[assistantIndex]?.toolCalls, usage)
  if (!metadata) return turns
  return turns.map((turn, index) =>
    index === assistantIndex
      ? { ...turn, metadata: mergeAgentTurnMetadata(turn.metadata, metadata) }
      : turn
  )
}

export function buildAgentTurnAuditMetadata(
  events: AgentLoopEvent[],
  toolCalls: AgentChatToolCallView[] | undefined = undefined,
  usage?: AgentRunUsageAggregate
): AgentTurnMetadata | undefined {
  const sources = new Map<string, AgentSourceMetadata>()
  const childRuns = new Map<string, AgentChildRunMetadata>()
  const compactions: AgentCompactionMetadata[] = []
  const contextHygiene: AgentContextHygieneMetadata[] = []
  const toolResults: AgentToolResultDiagnostic[] = []
  let contextEstimate: AgentContextEstimateMetadata | undefined

  for (const event of events) {
    if (isChildRunEvent(event)) {
      upsertChildRun(childRuns, childRunMetadataFromRuntimeEvent(event.child))
      continue
    }
    if (event.type === 'context_compaction_completed') {
      compactions.push({
        id: event.compactionId || `compaction:${event.sourceDigest}`,
        createdAt: event.createdAt || '1970-01-01T00:00:00.000Z',
        replacedTurnIds: event.replacedTurnIds ?? [],
        sourceDigest: event.sourceDigest,
        reason: event.reason,
        mode: event.mode,
        beforeTokens: event.beforeTokens,
        afterTokens: event.afterTokens,
        replacedTokens: event.replacedTokens,
        summaryTokens: event.summaryTokens,
        replacedMessages: event.replacedMessages,
        tailMessages: event.tailMessages,
        cached: event.cached
      })
      continue
    }
    if (event.type === 'context_compaction_failed') {
      compactions.push({
        id: event.compactionId || `compaction:${event.sourceDigest}:failed`,
        createdAt: event.createdAt || '1970-01-01T00:00:00.000Z',
        replacedTurnIds: event.replacedTurnIds ?? [],
        sourceDigest: event.sourceDigest,
        reason: event.reason,
        mode: event.mode,
        failed: true,
        error: compactText(event.error, MAX_ERROR_LENGTH)
      })
      continue
    }
    if (event.type === 'context_hygiene_applied') {
      if (
        event.changed ||
        event.savedTokens > 0 ||
        event.compactedToolResults > 0 ||
        event.digestedToolResults > 0 ||
        event.compactedToolCallArgs > 0
      ) {
        contextHygiene.push({
          changed: event.changed,
          savedTokens: event.savedTokens,
          compactedToolResults: event.compactedToolResults,
          digestedToolResults: event.digestedToolResults,
          compactedToolCallArgs: event.compactedToolCallArgs
        })
      }
      continue
    }
    if (event.type === 'context_estimated') {
      contextEstimate = {
        messageTokens: event.estimate.messageTokens,
        overheadTokens: event.estimate.overheadTokens,
        totalTokens: event.estimate.totalTokens,
        source: event.estimate.source
      }
      continue
    }
    if (event.type === 'tool_result') {
      collectToolResultAudit(event, sources, childRuns, toolResults)
    }
  }

  for (const toolCall of toolCalls ?? []) {
    if (toolCall.result === undefined) continue
    collectToolResultAudit(
      {
        type: 'tool_result',
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: toolCall.result,
        isError: toolCall.isError === true
      },
      sources,
      childRuns,
      toolResults
    )
  }

  const metadata: AgentTurnMetadata = { version: 1 }
  const sourceList = [...sources.values()].slice(0, MAX_SOURCES)
  const childRunList = [...childRuns.values()].slice(0, MAX_CHILD_RUNS)
  const compactionList = uniqueBy(compactions, (item) => item.id).slice(-MAX_COMPACTIONS)
  const hygieneList = contextHygiene.slice(-MAX_CONTEXT_HYGIENE)
  const diagnosticList = toolResults.slice(-MAX_TOOL_DIAGNOSTICS)
  if (sourceList.length) metadata.sources = sourceList
  if (childRunList.length) metadata.childRuns = childRunList
  if (compactionList.length) metadata.compactions = compactionList
  if (hygieneList.length) metadata.contextHygiene = hygieneList
  if (contextEstimate) metadata.contextEstimate = contextEstimate
  if (diagnosticList.length) metadata.toolResults = diagnosticList
  if (usage) metadata.runUsage = normalizeRunUsage(usage)
  return hasAgentTurnMetadataContent(metadata) ? metadata : undefined
}

function collectToolResultAudit(
  event: Extract<AgentLoopEvent, { type: 'tool_result' }>,
  sources: Map<string, AgentSourceMetadata>,
  childRuns: Map<string, AgentChildRunMetadata>,
  toolResults: AgentToolResultDiagnostic[]
): void {
  const diagnostics = toolResultDiagnostic(event)
  if (diagnostics) toolResults.push(diagnostics)

  const parsed = safeParseJson(event.result)
  if (!parsed) return
  if (event.name === 'web_search' || event.name === 'web_fetch') {
    collectSources(parsed, sources, {
      toolCallId: event.toolCallId,
      toolName: event.name
    })
  }
  if (event.name === 'delegate_task' || event.name === 'read_only_task') {
    const child = childRunMetadataFromToolResult(parsed)
    if (child) {
      upsertChildRun(childRuns, child)
      collectChildRunSources(child, sources, event)
    }
  }
  if (event.name === 'parallel_tasks' && parsed && typeof parsed === 'object') {
    const results = (parsed as { results?: unknown }).results
    if (Array.isArray(results)) {
      for (const result of results) {
        const child = childRunMetadataFromToolResult(result)
        if (!child) continue
        upsertChildRun(childRuns, child)
        collectChildRunSources(child, sources, event)
      }
    }
  }
}

function collectSources(
  value: unknown,
  out: Map<string, AgentSourceMetadata>,
  tool: { toolCallId: string; toolName: string }
): void {
  let remaining = MAX_SOURCE_NODES
  const visit = (node: unknown, inheritedProvider?: string): void => {
    if (remaining <= 0 || !node) return
    remaining -= 1
    if (Array.isArray(node)) {
      for (const item of node) visit(item, inheritedProvider)
      return
    }
    if (typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const provider = textValue(record.provider, MAX_TITLE_LENGTH) ?? inheritedProvider
    const url = textValue(record.finalUrl, 2000) ?? textValue(record.url, 2000)
    if (url) {
      const sourceId = textValue(record.sourceId, MAX_TITLE_LENGTH) ?? sourceIdForUrl(url)
      addSource(out, {
        sourceId,
        url,
        title: textValue(record.title, MAX_TITLE_LENGTH),
        snippet: textValue(record.snippet, MAX_SNIPPET_LENGTH),
        provider,
        retrievedAt: textValue(record.retrievedAt, MAX_TITLE_LENGTH),
        publishedAt: textValue(record.publishedAt, MAX_TITLE_LENGTH),
        toolCallId: tool.toolCallId,
        toolName: tool.toolName
      })
    }
    for (const nested of Object.values(record)) visit(nested, provider)
  }
  visit(value)
}

function collectChildRunSources(
  child: AgentChildRunMetadata,
  out: Map<string, AgentSourceMetadata>,
  event: Extract<AgentLoopEvent, { type: 'tool_result' }>
): void {
  for (const citation of child.citations ?? []) {
    addSource(out, {
      sourceId: citation.sourceId,
      url: citation.url,
      title: citation.title,
      toolCallId: event.toolCallId,
      toolName: event.name
    })
  }
}

function addSource(out: Map<string, AgentSourceMetadata>, source: AgentSourceMetadata): void {
  const key = source.sourceId || source.url
  if (!key) return
  const existing = out.get(key)
  if (!existing) {
    out.set(key, pruneUndefined(source))
    return
  }
  out.set(key, pruneUndefined({
    ...existing,
    ...source,
    title: existing.title ?? source.title,
    snippet: existing.snippet ?? source.snippet,
    provider: existing.provider ?? source.provider,
    retrievedAt: existing.retrievedAt ?? source.retrievedAt,
    publishedAt: existing.publishedAt ?? source.publishedAt
  }))
}

function childRunMetadataFromRuntimeEvent(child: {
  id: string
  label: string
  profile: string
  status: AgentChildRunMetadata['status']
  summary?: string
  error?: string
  startedAt?: string
  completedAt?: string
  usage?: AgentChildRunMetadata['usage']
  archive?: AgentChildRunMetadata['archive']
}): AgentChildRunMetadata {
  return pruneUndefined({
    childRunId: child.id,
    label: compactText(child.label, MAX_TITLE_LENGTH) || child.id,
    profile: compactText(child.profile, MAX_TITLE_LENGTH) || 'read_only',
    status: child.status,
    summary: textValue(child.summary, MAX_SUMMARY_LENGTH),
    error: textValue(child.error, MAX_ERROR_LENGTH),
    startedAt: textValue(child.startedAt, MAX_TITLE_LENGTH),
    completedAt: textValue(child.completedAt, MAX_TITLE_LENGTH),
    usage: normalizeUsage(child.usage),
    archive: normalizeChildTranscriptArchive(child.archive)
  })
}

function childRunMetadataFromToolResult(value: unknown): AgentChildRunMetadata | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const childRunId = textValue(record.childRunId, MAX_TITLE_LENGTH) ?? textValue(record.id, MAX_TITLE_LENGTH)
  if (!childRunId) return null
  return pruneUndefined({
    childRunId,
    label: textValue(record.label, MAX_TITLE_LENGTH) ?? childRunId,
    profile: textValue(record.profile, MAX_TITLE_LENGTH) ?? 'read_only',
    status: normalizeChildRunStatus(record.status),
    summary: textValue(record.summary, MAX_SUMMARY_LENGTH),
    error: textValue(record.error, MAX_ERROR_LENGTH),
    filesRead: normalizeStringArray(record.filesRead, MAX_FILES_READ, MAX_TITLE_LENGTH),
    citations: normalizeCitations(record.citations),
    usage: normalizeUsage(record.usage),
    archive: normalizeChildTranscriptArchive(record.archive),
    startedAt: textValue(record.startedAt, MAX_TITLE_LENGTH),
    completedAt: textValue(record.completedAt, MAX_TITLE_LENGTH)
  })
}

function upsertChildRun(
  out: Map<string, AgentChildRunMetadata>,
  child: AgentChildRunMetadata
): void {
  const existing = out.get(child.childRunId)
  if (!existing) {
    out.set(child.childRunId, child)
    return
  }
  out.set(child.childRunId, pruneUndefined({
    ...existing,
    ...child,
    label: child.label || existing.label,
    profile: child.profile || existing.profile,
    summary: child.summary ?? existing.summary,
    error: child.error ?? existing.error,
    filesRead: child.filesRead ?? existing.filesRead,
    citations: child.citations ?? existing.citations,
    usage: child.usage ?? existing.usage,
    archive: child.archive ?? existing.archive,
    startedAt: existing.startedAt ?? child.startedAt,
    completedAt: child.completedAt ?? existing.completedAt
  }))
}

function toolResultDiagnostic(
  event: Extract<AgentLoopEvent, { type: 'tool_result' }>
): AgentToolResultDiagnostic | null {
  const bytes = Buffer.byteLength(event.result, 'utf8')
  const lines = event.result ? event.result.split(/\r\n|\r|\n/).length : 0
  if (!event.isError && bytes < LARGE_TOOL_RESULT_BYTES && lines < LARGE_TOOL_RESULT_LINES) {
    return null
  }
  return pruneUndefined({
    toolCallId: event.toolCallId,
    toolName: event.name,
    bytes,
    lines,
    approxTokens: Math.ceil(event.result.length / 4),
    isError: event.isError || undefined
  })
}

function mergeAgentTurnMetadata(
  existing: AgentTurnMetadata | undefined,
  incoming: AgentTurnMetadata
): AgentTurnMetadata {
  if (!existing) return incoming
  return pruneUndefined({
    version: 1 as const,
    sources: nonEmpty(mergeBy(existing.sources, incoming.sources, (source) => source.sourceId || source.url).slice(0, MAX_SOURCES)),
    childRuns: nonEmpty(mergeBy(existing.childRuns, incoming.childRuns, (child) => child.childRunId).slice(0, MAX_CHILD_RUNS)),
    compactions: nonEmpty([...(existing.compactions ?? []), ...(incoming.compactions ?? [])].slice(-MAX_COMPACTIONS)),
    contextHygiene: nonEmpty([...(existing.contextHygiene ?? []), ...(incoming.contextHygiene ?? [])].slice(-MAX_CONTEXT_HYGIENE)),
    contextEstimate: incoming.contextEstimate ?? existing.contextEstimate,
    toolResults: nonEmpty(mergeBy(existing.toolResults, incoming.toolResults, (tool) => `${tool.toolCallId}:${tool.toolName}`).slice(-MAX_TOOL_DIAGNOSTICS)),
    runUsage: incoming.runUsage ?? existing.runUsage,
    runId: incoming.runId ?? existing.runId,
    parentTurnDigest: incoming.parentTurnDigest ?? existing.parentTurnDigest
  })
}

function mergeBy<T>(left: T[] | undefined, right: T[] | undefined, keyOf: (item: T) => string): T[] {
  const out = new Map<string, T>()
  for (const item of left ?? []) out.set(keyOf(item), item)
  for (const item of right ?? []) out.set(keyOf(item), item)
  return [...out.values()]
}

function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined
}

function hasAgentTurnMetadataContent(metadata: AgentTurnMetadata): boolean {
  return Boolean(
    metadata.sources?.length ||
    metadata.childRuns?.length ||
    metadata.compactions?.length ||
    metadata.contextHygiene?.length ||
    metadata.contextEstimate ||
    metadata.toolResults?.length ||
    metadata.runUsage ||
    metadata.runId ||
    metadata.parentTurnDigest
  )
}

function normalizeRunUsage(value: AgentRunUsageAggregate): AgentRunUsageAggregate {
  return pruneUndefined({
    providerCalls: numberValue(value.providerCalls) ?? 0,
    toolCalls: numberValue(value.toolCalls) ?? 0,
    toolErrors: numberValue(value.toolErrors) ?? 0,
    iterations: numberValue(value.iterations) ?? 0,
    childRuns: numberValue(value.childRuns) ?? 0,
    durationMs: numberValue(value.durationMs) ?? 0,
    promptTokens: numberValue(value.promptTokens),
    completionTokens: numberValue(value.completionTokens),
    totalTokens: numberValue(value.totalTokens),
    budgetStopReason: value.budgetStopReason,
    usageProvenance: value.usageProvenance
  })
}

function normalizeChildRunStatus(value: unknown): AgentChildRunMetadata['status'] {
  return value === 'queued' ||
    value === 'running' ||
    value === 'failed' ||
    value === 'canceled' ||
    value === 'completed'
    ? value
    : 'completed'
}

function normalizeUsage(value: unknown): AgentChildRunMetadata['usage'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const toolCalls = numberValue(record.toolCalls)
  const usage = pruneUndefined({
    providerCalls: numberValue(record.providerCalls),
    toolCalls: toolCalls ?? 0,
    promptTokens: numberValue(record.promptTokens),
    completionTokens: numberValue(record.completionTokens),
    totalTokens: numberValue(record.totalTokens)
  })
  return usage.toolCalls > 0 ||
    usage.providerCalls !== undefined ||
    usage.promptTokens !== undefined ||
    usage.completionTokens !== undefined ||
    usage.totalTokens !== undefined
    ? usage
    : undefined
}

function normalizeChildTranscriptArchive(value: unknown): AgentArtifactRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.kind !== 'child_transcript') return undefined
  const relativePath = typeof record.relativePath === 'string' ? record.relativePath : ''
  if (!relativePath || relativePath.length > 2000 || relativePath.includes('\\') ||
    relativePath.startsWith('/') || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    return undefined
  }
  const sha256 = typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256)
    ? record.sha256
    : undefined
  const bytes = strictNonNegativeInteger(record.bytes)
  const lines = record.lines === undefined ? undefined : strictNonNegativeInteger(record.lines)
  if (!sha256 || bytes === undefined || (record.lines !== undefined && lines === undefined)) return undefined
  return pruneUndefined({
    kind: 'child_transcript' as const,
    relativePath,
    sha256,
    bytes,
    lines,
    preview: textValue(record.preview, 1200),
    archivedAt: textValue(record.archivedAt, MAX_TITLE_LENGTH)
  })
}

function strictNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function normalizeCitations(value: unknown): AgentChildRunMetadata['citations'] | undefined {
  if (!Array.isArray(value)) return undefined
  const citations = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const url = textValue(record.url, 2000)
      if (!url) return null
      return pruneUndefined({
        sourceId: textValue(record.sourceId, MAX_TITLE_LENGTH) ?? sourceIdForUrl(url),
        url,
        title: textValue(record.title, MAX_TITLE_LENGTH)
      })
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, MAX_CITATIONS)
  return citations.length ? citations : undefined
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map((item) => textValue(item, maxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems)
  return items.length ? items : undefined
}

function isChildRunEvent(
  event: AgentLoopEvent
): event is Extract<AgentLoopEvent, { type: 'child_run_queued' | 'child_run_started' | 'child_run_completed' | 'child_run_failed' | 'child_run_canceled' }> {
  return event.type === 'child_run_queued' ||
    event.type === 'child_run_started' ||
    event.type === 'child_run_completed' ||
    event.type === 'child_run_failed' ||
    event.type === 'child_run_canceled'
}

function findLastAssistantTurnIndex(turns: AgentChatTurn[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.role === 'assistant') return index
  }
  return -1
}

function textValue(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' ? compactText(value, maxLength) || undefined : undefined
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const valueKey = key(value)
    if (seen.has(valueKey)) return false
    seen.add(valueKey)
    return true
  })
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function sourceIdForUrl(url: string): string {
  return `source-${stableHash(url)}`
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item
  }
  return out as T
}
