import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown,
  courseRelativePathForAgentConversation
} from '../shared/agent-conversation-catalog'
import type {
  AgentChatProcessEvent,
  AgentChatToolCallView,
  AgentChatTurn,
  AgentConversationRecord,
  AgentSourceMetadata,
  AgentRunUsageAggregate
} from '../shared/teaching-types'

export const LEARNING_WORK_LEDGER_RELATIVE_PATH = '.studiumx/learning-work.jsonl'

const MAX_ITEMS = 40
const MAX_TEXT = 500

type LearningWorkStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_permission'
  | 'waiting_for_learner'
  | 'completed'
  | 'failed'
  | 'canceled'

type LearningWorkLedgerEntry = {
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

export async function appendLearningWorkLedgerSnapshot(options: {
  rootPath: string
  workspace: { id?: string; name: string }
  record: AgentConversationRecord
}): Promise<void> {
  const entry = buildLearningWorkLedgerEntry(options.workspace, options.record)
  const ledgerPath = join(options.rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH)
  if (await ledgerEntryExists(ledgerPath, entry.entryId)) return
  await mkdir(dirname(ledgerPath), { recursive: true })
  await appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
}

export function buildLearningWorkLedgerEntry(
  workspace: { id?: string; name: string },
  record: AgentConversationRecord
): LearningWorkLedgerEntry {
  const jsonRelativePath = agentConversationJsonRelativePathForMarkdown(record.relativePath)
  const sessionAuditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(record.relativePath)
  const courseRelativePath = courseRelativePathForAgentConversation(record.relativePath) ?? undefined
  const entryCore = {
    conversationId: record.id,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    status: deriveLearningWorkStatus(record.turns),
    evidenceDigest: digestJson(buildEvidence(record.turns))
  }
  return pruneUndefined({
    version: 1 as const,
    entryId: `learning-work:${record.id}:${stableDigest(entryCore)}`,
    type: 'conversation_snapshot' as const,
    createdAt: new Date().toISOString(),
    status: entryCore.status,
    workspace: pruneUndefined({
      id: workspace.id,
      name: compactText(workspace.name, MAX_TEXT)
    }),
    conversation: pruneUndefined({
      id: record.id,
      title: compactText(record.title, MAX_TEXT),
      relativePath: record.relativePath,
      jsonRelativePath,
      sessionAuditRelativePath,
      courseRelativePath,
      updatedAt: record.updatedAt,
      messageCount: record.messageCount
    }),
    pointers: {
      markdown: record.relativePath,
      materializedJson: jsonRelativePath,
      sessionAudit: sessionAuditRelativePath
    },
    evidence: buildEvidence(record.turns)
  })
}

async function ledgerEntryExists(path: string, entryId: string): Promise<boolean> {
  const content = await readFile(path, 'utf8').catch(() => '')
  return content.split(/\r?\n/).some((line) => {
    if (!line.trim()) return false
    const parsed = safeParseJson(line)
    return Boolean(parsed && typeof parsed === 'object' && (parsed as { entryId?: unknown }).entryId === entryId)
  })
}

function buildEvidence(turns: AgentChatTurn[]): LearningWorkLedgerEntry['evidence'] {
  const sources = new Map<string, NonNullable<LearningWorkLedgerEntry['evidence']['sources']>[number]>()
  const childRuns = new Map<string, NonNullable<LearningWorkLedgerEntry['evidence']['childRuns']>[number]>()
  const compactions = new Map<string, NonNullable<LearningWorkLedgerEntry['evidence']['compactions']>[number]>()
  const artifacts = new Map<string, NonNullable<LearningWorkLedgerEntry['evidence']['artifacts']>[number]>()
  const permissionDecisions = new Map<string, NonNullable<LearningWorkLedgerEntry['evidence']['permissionDecisions']>[number]>()
  let runUsage: AgentRunUsageAggregate | undefined

  for (const turn of turns) {
    if (turn.metadata?.runUsage) runUsage = turn.metadata.runUsage
    for (const source of turn.metadata?.sources ?? []) {
      const key = source.sourceId || source.url
      if (!key || sources.has(key)) continue
      sources.set(key, pruneUndefined({
        sourceId: source.sourceId,
        url: source.url,
        title: compactText(source.title ?? '', MAX_TEXT) || undefined,
        provider: source.provider,
        toolName: source.toolName
      }))
    }
    for (const child of turn.metadata?.childRuns ?? []) {
      if (childRuns.has(child.childRunId)) continue
      childRuns.set(child.childRunId, pruneUndefined({
        childRunId: child.childRunId,
        label: compactText(child.label, MAX_TEXT),
        profile: child.profile,
        status: child.status,
        summary: compactText(child.summary ?? '', MAX_TEXT) || undefined
      }))
    }
    for (const compaction of turn.metadata?.compactions ?? []) {
      if (compactions.has(compaction.sourceDigest)) continue
      compactions.set(compaction.sourceDigest, pruneUndefined({
        sourceDigest: compaction.sourceDigest,
        reason: compaction.reason,
        mode: compaction.mode,
        failed: compaction.failed === true ? true : undefined
      }))
    }
    for (const diagnostic of turn.metadata?.toolResults ?? []) {
      if (!diagnostic.archive) continue
      const key = `${diagnostic.archive.kind}:${diagnostic.archive.relativePath}`
      artifacts.set(key, {
        kind: diagnostic.archive.kind,
        relativePath: diagnostic.archive.relativePath,
        source: diagnostic.toolName
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
  artifacts: Map<string, NonNullable<LearningWorkLedgerEntry['evidence']['artifacts']>[number]>
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
    artifacts.set(key, pruneUndefined({
      kind: candidate.kind,
      relativePath: candidate.path,
      title: compactText(candidate.title ?? '', MAX_TEXT) || undefined,
      source: toolCall.name
    }))
  }
}

function collectPermissionDecision(
  toolCall: AgentChatToolCallView,
  out: Map<string, NonNullable<LearningWorkLedgerEntry['evidence']['permissionDecisions']>[number]>
): void {
  if (toolCall.name !== 'tool_permission') return
  const request = safeParseJson(toolCall.arguments)
  const result = safeParseJson(toolCall.result)
  const requestRecord = request && typeof request === 'object' ? request as Record<string, unknown> : {}
  const resultRecord = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  out.set(toolCall.id, pruneUndefined({
    toolCallId: toolCall.id,
    toolName: stringValue(requestRecord.toolName),
    operation: stringValue(requestRecord.operation),
    targetPath: stringValue(requestRecord.targetPath),
    decision: stringValue(resultRecord.decision),
    isError: toolCall.isError === true ? true : undefined
  }))
}

function deriveLearningWorkStatus(turns: AgentChatTurn[]): LearningWorkStatus {
  const events = turns.flatMap((turn) => turn.processEvents ?? [])
  if (hasUnresolvedEvent(events, 'permission_request', 'permission_resolved')) return 'waiting_for_permission'
  if (hasUnresolvedEvent(events, 'elicitation_request', 'elicitation_resolved')) return 'waiting_for_learner'
  const lastEvent = events[events.length - 1]
  if (lastEvent?.status === 'canceled' || lastEvent?.kind === 'child_run_canceled') return 'canceled'
  if (lastEvent?.isError || lastEvent?.status === 'error' || lastEvent?.kind === 'child_run_failed') return 'failed'
  if (
    lastEvent?.status === 'tool_running' ||
    lastEvent?.kind === 'child_run_queued' ||
    lastEvent?.kind === 'child_run_started' ||
    lastEvent?.kind === 'child_run_delta'
  ) {
    return 'running'
  }
  if (turns.length === 0) return 'queued'
  return 'completed'
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
  const values = [...map.values()].slice(0, MAX_ITEMS)
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? compactText(value, MAX_TEXT) : undefined
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
