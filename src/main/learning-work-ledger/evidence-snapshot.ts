import { createHash } from 'node:crypto'

import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown,
  courseRelativePathForAgentConversation
} from '../../shared/agent-conversation-catalog'
import { sanitizePersistedAgentConversationRecord } from '../../shared/agent-persisted-history'
import { redactAgentSecretText } from '../../shared/agent-secret-redaction'
import type {
  AgentChatProcessEvent,
  AgentChatToolCallView,
  AgentChatTurn,
  AgentConversationRecord,
  AgentSourceMetadata,
  AgentRunUsageAggregate
} from '../../shared/teaching-types'

const MAX_EVIDENCE_ITEMS = 40
const MAX_TEXT_LENGTH = 500

export type LearningWorkStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_permission'
  | 'waiting_for_learner'
  | 'completed'
  | 'failed'
  | 'canceled'

export type LearningWorkLedgerSnapshot = {
  version: 1
  entryId: string
  type: 'conversation_snapshot'
  createdAt: string
  status: LearningWorkStatus
  workspace: {
    id?: string
    name: string
  }
  conversation: {
    id: string
    title: string
    relativePath: string
    jsonRelativePath: string
    sessionAuditRelativePath: string
    courseRelativePath?: string
    updatedAt: string
    messageCount: number
  }
  pointers: {
    markdown: string
    materializedJson: string
    sessionAudit: string
  }
  evidence: {
    sources?: Array<Pick<AgentSourceMetadata, 'sourceId' | 'url' | 'title' | 'provider' | 'toolName'>>
    childRuns?: Array<{ childRunId: string; label: string; profile: string; status: string; summary?: string }>
    compactions?: Array<{ sourceDigest: string; reason: string; mode: string; failed?: boolean }>
    artifacts?: Array<{ kind: string; relativePath: string; title?: string; source?: string }>
    permissionDecisions?: Array<{ toolCallId: string; toolName?: string; operation?: string; targetPath?: string; decision?: string; isError?: boolean }>
    runUsage?: AgentRunUsageAggregate
  }
}

/**
 * Projects a durable, compact learning-work snapshot from one Agent conversation.
 * The projection deliberately excludes conversation content, tool arguments, and
 * full tool results; JSONL consumers receive only bounded evidence and pointers.
 */
export function buildLearningWorkEvidenceSnapshot(
  workspace: { id?: string; name: string },
  conversation: AgentConversationRecord
): LearningWorkLedgerSnapshot {
  // This builder is public and can be called independently of the archive.
  // Reapply the durable user-history boundary here so evidence cannot bypass it.
  const persistedConversation = sanitizePersistedAgentConversationRecord(conversation)
  const evidence = buildEvidence(persistedConversation.turns)
  const status = deriveLearningWorkStatus(persistedConversation.turns)
  const jsonRelativePath = agentConversationJsonRelativePathForMarkdown(persistedConversation.relativePath)
  const sessionAuditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(persistedConversation.relativePath)
  const courseRelativePath = courseRelativePathForAgentConversation(persistedConversation.relativePath) ?? undefined
  const identity = {
    conversationId: persistedConversation.id,
    updatedAt: persistedConversation.updatedAt,
    messageCount: persistedConversation.messageCount,
    status,
    evidenceDigest: digestJson(evidence)
  }

  return pruneUndefined({
    version: 1 as const,
    entryId: `learning-work:${persistedConversation.id}:${stableDigest(identity)}`,
    type: 'conversation_snapshot' as const,
    createdAt: new Date().toISOString(),
    status,
    workspace: pruneUndefined({
      id: workspace.id === undefined ? undefined : safeText(workspace.id, MAX_TEXT_LENGTH),
      name: safeText(workspace.name, MAX_TEXT_LENGTH)
    }),
    conversation: pruneUndefined({
      id: safeText(persistedConversation.id, MAX_TEXT_LENGTH),
      title: safeText(persistedConversation.title, MAX_TEXT_LENGTH),
      relativePath: safeText(persistedConversation.relativePath, MAX_TEXT_LENGTH),
      jsonRelativePath: safeText(jsonRelativePath, MAX_TEXT_LENGTH),
      sessionAuditRelativePath: safeText(sessionAuditRelativePath, MAX_TEXT_LENGTH),
      courseRelativePath: courseRelativePath === undefined ? undefined : safeText(courseRelativePath, MAX_TEXT_LENGTH),
      updatedAt: persistedConversation.updatedAt,
      messageCount: persistedConversation.messageCount
    }),
    pointers: {
      markdown: safeText(persistedConversation.relativePath, MAX_TEXT_LENGTH),
      materializedJson: safeText(jsonRelativePath, MAX_TEXT_LENGTH),
      sessionAudit: safeText(sessionAuditRelativePath, MAX_TEXT_LENGTH)
    },
    evidence
  })
}

function buildEvidence(turns: AgentChatTurn[]): LearningWorkLedgerSnapshot['evidence'] {
  const sources = new Map<string, NonNullable<LearningWorkLedgerSnapshot['evidence']['sources']>[number]>()
  const childRuns = new Map<string, NonNullable<LearningWorkLedgerSnapshot['evidence']['childRuns']>[number]>()
  const compactions = new Map<string, NonNullable<LearningWorkLedgerSnapshot['evidence']['compactions']>[number]>()
  const artifacts = new Map<string, NonNullable<LearningWorkLedgerSnapshot['evidence']['artifacts']>[number]>()
  const permissionDecisions = new Map<string, NonNullable<LearningWorkLedgerSnapshot['evidence']['permissionDecisions']>[number]>()
  let runUsage: AgentRunUsageAggregate | undefined

  for (const turn of turns) {
    if (turn.metadata?.runUsage) runUsage = turn.metadata.runUsage
    for (const source of turn.metadata?.sources ?? []) {
      const key = source.sourceId || source.url
      if (!key || sources.has(key)) continue
      sources.set(key, pruneUndefined({
        sourceId: safeText(source.sourceId, MAX_TEXT_LENGTH),
        url: safeText(source.url, MAX_TEXT_LENGTH),
        title: safeOptionalText(source.title),
        provider: safeOptionalText(source.provider),
        toolName: safeOptionalText(source.toolName)
      }))
    }
    for (const child of turn.metadata?.childRuns ?? []) {
      if (childRuns.has(child.childRunId)) continue
      childRuns.set(child.childRunId, pruneUndefined({
        childRunId: safeText(child.childRunId, MAX_TEXT_LENGTH),
        label: safeText(child.label, MAX_TEXT_LENGTH),
        profile: safeText(child.profile, MAX_TEXT_LENGTH),
        status: safeText(child.status, MAX_TEXT_LENGTH),
        summary: safeOptionalText(child.summary)
      }))
    }
    for (const compaction of turn.metadata?.compactions ?? []) {
      if (compactions.has(compaction.sourceDigest)) continue
      compactions.set(compaction.sourceDigest, pruneUndefined({
        sourceDigest: safeText(compaction.sourceDigest, MAX_TEXT_LENGTH),
        reason: safeText(compaction.reason, MAX_TEXT_LENGTH),
        mode: safeText(compaction.mode, MAX_TEXT_LENGTH),
        failed: compaction.failed === true ? true : undefined
      }))
    }
    for (const diagnostic of turn.metadata?.toolResults ?? []) {
      if (!diagnostic.archive) continue
      const key = `${diagnostic.archive.kind}:${diagnostic.archive.relativePath}`
      if (artifacts.has(key)) continue
      artifacts.set(key, {
        kind: safeText(diagnostic.archive.kind, MAX_TEXT_LENGTH),
        relativePath: safeText(diagnostic.archive.relativePath, MAX_TEXT_LENGTH),
        source: safeText(diagnostic.toolName, MAX_TEXT_LENGTH)
      })
    }
    for (const toolCall of turn.toolCalls ?? []) {
      collectToolArtifact(toolCall, artifacts)
      collectPermissionDecision(toolCall, permissionDecisions)
    }
  }

  return pruneUndefined({
    sources: limitedValues(sources),
    childRuns: limitedValues(childRuns),
    compactions: limitedValues(compactions),
    artifacts: limitedValues(artifacts),
    permissionDecisions: limitedValues(permissionDecisions),
    runUsage
  })
}

function collectToolArtifact(
  toolCall: AgentChatToolCallView,
  artifacts: Map<string, NonNullable<LearningWorkLedgerSnapshot['evidence']['artifacts']>[number]>
): void {
  const parsed = safeParseJson(toolCall.result)
  if (!parsed || typeof parsed !== 'object') return
  const record = parsed as Record<string, unknown>
  const candidates = [
    { path: stringValue(record.path), title: stringValue(record.title), kind: toolCall.name },
    { path: stringValue(record.relativePath), title: stringValue(record.title), kind: toolCall.name },
    { path: stringValue(record.lessonPath), title: stringValue(record.title), kind: 'lesson' }
  ]

  for (const candidate of candidates) {
    if (!candidate.path) continue
    const key = `${candidate.kind}:${candidate.path}`
    if (artifacts.has(key)) continue
    artifacts.set(key, pruneUndefined({
      kind: safeText(candidate.kind, MAX_TEXT_LENGTH),
      relativePath: safeText(candidate.path, MAX_TEXT_LENGTH),
      title: candidate.title === undefined ? undefined : safeText(candidate.title, MAX_TEXT_LENGTH),
      source: safeText(toolCall.name, MAX_TEXT_LENGTH)
    }))
  }
}

function collectPermissionDecision(
  toolCall: AgentChatToolCallView,
  out: Map<string, NonNullable<LearningWorkLedgerSnapshot['evidence']['permissionDecisions']>[number]>
): void {
  if (toolCall.name !== 'tool_permission' || out.has(toolCall.id)) return
  const request = safeParseJson(toolCall.arguments)
  const result = safeParseJson(toolCall.result)
  const requestRecord = request && typeof request === 'object' ? request as Record<string, unknown> : {}
  const resultRecord = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  out.set(toolCall.id, pruneUndefined({
    toolCallId: safeText(toolCall.id, MAX_TEXT_LENGTH),
    toolName: safeUnknownText(requestRecord.toolName),
    operation: safeUnknownText(requestRecord.operation),
    targetPath: safeUnknownText(requestRecord.targetPath),
    decision: safeUnknownText(resultRecord.decision),
    isError: toolCall.isError === true ? true : undefined
  }))
}

function deriveLearningWorkStatus(turns: AgentChatTurn[]): LearningWorkStatus {
  const events = turns.flatMap((turn) => turn.processEvents ?? [])
  if (hasUnresolvedEvent(events, 'permission_request', 'permission_resolved')) return 'waiting_for_permission'
  if (hasUnresolvedEvent(events, 'elicitation_request', 'elicitation_resolved')) return 'waiting_for_learner'

  const lastEvent = events.at(-1)
  if (lastEvent?.status === 'canceled' || lastEvent?.kind === 'child_run_canceled') return 'canceled'
  if (lastEvent?.isError || lastEvent?.status === 'error' || lastEvent?.kind === 'child_run_failed') return 'failed'
  if (
    lastEvent?.status === 'thinking' ||
    lastEvent?.status === 'tool_running' ||
    lastEvent?.status === 'answering' ||
    lastEvent?.kind === 'child_run_queued' ||
    lastEvent?.kind === 'child_run_started' ||
    lastEvent?.kind === 'child_run_delta'
  ) {
    return 'running'
  }
  return turns.length === 0 ? 'queued' : 'completed'
}

function hasUnresolvedEvent(
  events: AgentChatProcessEvent[],
  requestKind: AgentChatProcessEvent['kind'],
  resolvedKind: AgentChatProcessEvent['kind']
): boolean {
  const requested = events.filter((event) => event.kind === requestKind).length
  const resolved = events.filter((event) => event.kind === resolvedKind).length
  return requested > resolved
}

function limitedValues<T>(map: Map<string, T>): T[] | undefined {
  const values = [...map.values()].slice(0, MAX_EVIDENCE_ITEMS)
  return values.length > 0 ? values : undefined
}

function stableDigest(value: unknown): string {
  return digestJson(value).slice(0, 16)
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function safeParseJson(value: unknown): unknown | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function safeText(value: string, maxLength: number): string {
  return compactText(redactAgentSecretText(value), maxLength)
}

function safeOptionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : safeText(value, MAX_TEXT_LENGTH) || undefined
}

function safeUnknownText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? safeText(value, MAX_TEXT_LENGTH) || undefined : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? compactText(value, MAX_TEXT_LENGTH) : undefined
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item
  }
  return out as T
}
