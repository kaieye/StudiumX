import type {
  AgentConversationRecord,
  AgentConversationSummary,
  AnalyticsDateRange,
  AnalyticsLocalDate,
  AnalyticsSourceCoverage,
  AnalyticsWarning,
  LearningAnalyticsQuery,
  TeachingWorkspaceSummary,
  TokenAnalytics,
  TokenUsageFact,
  TokenUsageNumbers
} from '../../../../shared/teaching-types'
import { readLearningWorkLedgerLines } from '../../../learning-work-ledger'

/** The workspace catalog fields required to discover durable token evidence. */
export type TokenEvidenceWorkspace = {
  workspaceId: string
  workspaceName: string
  rootPath: string
  summary?: TeachingWorkspaceSummary
  error?: string
}

type InternalTokenUsageFact = TokenUsageFact & { messageCount: number }

const TOKEN_CONVERSATION_READ_CONCURRENCY = 8

export type TokenToolFact = {
  name: string
  error: boolean
  dedupeKey: string
  runDedupeKey: string
}

export type TokenGovernanceFact = {
  runDedupeKey: string
  compactionEvents: number
  replacedTokens: number
  hygieneSavedTokens: number
}

export type ConversationTokenScan = {
  facts: InternalTokenUsageFact[]
  assistantTurns: number
  assistantTurnsWithUsage: number
  missingUsageTurns: number
  invalidTimestampTurns: number
  duplicateRuns: number
  componentMissing: number
  totalInconsistent: number
  toolNames: TokenToolFact[]
  governance: TokenGovernanceFact[]
}

export type LedgerSnapshot = {
  conversationId: string
  title: string
  courseRelativePath?: string
  occurredAt: string
  ledgerCreatedAt: string
  messageCount: number
  usage: TokenUsageNumbers
  componentsComplete: boolean
  totalInconsistent: boolean
}

export type LearningWorkLedgerSnapshotsRead = {
  latestByConversation: Map<string, LedgerSnapshot>
  scanned: number
  invalid: number
  readError: boolean
}

/**
 * The durable-source seam. Adapters report unreadable sources explicitly, so the
 * discovery module—not its caller—decides whether a ledger fallback is safe.
 */
export type TokenEvidenceAdapters = {
  conversations: {
    read: (workspaceId: string, conversationId: string) => Promise<
      | { state: 'readable'; record: AgentConversationRecord }
      | { state: 'unreadable' }
    >
  }
  temporaryConversations?: {
    read: (workspaceId: string | undefined, conversationId: string) => Promise<
      | { state: 'readable'; record: AgentConversationRecord }
      | { state: 'unreadable' }
    >
  }
  ledger: {
    read: (workspace: TokenEvidenceWorkspace) => Promise<LearningWorkLedgerSnapshotsRead>
  }
}

export type TokenEvidenceCounters = {
  conversationsScanned: number
  conversationsReadable: number
  conversationsWithUsage: number
  conversationsPartiallyMissingUsage: number
  ledgerSnapshotsScanned: number
  ledgerFallbackConversations: number
  invalidLedgerRows: number
  staleLedgerSnapshots: number
  ledgerReadErrors: number
  missingUsageConversations: number
  duplicateRuns: number
  componentMissing: number
  totalInconsistent: number
  invalidTimestampTurns: number
  workspaceErrors: number
  governance: TokenGovernanceFact[]
}

/**
 * Compact evidence hand-off for analytics orchestration. It intentionally owns
 * source reconciliation while leaving section state and presentation to the
 * learning analytics module.
 */
export interface TokenEvidenceReport {
  facts: TokenUsageFact[]
  rangedFacts: TokenUsageFact[]
  toolFacts: TokenToolFact[]
  governance: TokenGovernanceFact[]
  sources: AnalyticsSourceCoverage[]
  warnings: AnalyticsWarning[]
  counters: TokenEvidenceCounters
  complete: boolean
}

export function createDurableConversationEvidenceAdapter(
  readConversation: (workspaceId: string, conversationId: string) => Promise<AgentConversationRecord>
): TokenEvidenceAdapters['conversations'] {
  return {
    async read(workspaceId, conversationId) {
      try {
        return { state: 'readable', record: await readConversation(workspaceId, conversationId) }
      } catch {
        return { state: 'unreadable' }
      }
    }
  }
}

export function createDurableTemporaryConversationEvidenceAdapter(
  readConversation: (workspaceId: string | undefined, conversationId: string) => Promise<AgentConversationRecord>
): NonNullable<TokenEvidenceAdapters['temporaryConversations']> {
  return {
    async read(workspaceId, conversationId) {
      try {
        return { state: 'readable', record: await readConversation(workspaceId, conversationId) }
      } catch {
        return { state: 'unreadable' }
      }
    }
  }
}

export function createLearningWorkLedgerEvidenceAdapter(): TokenEvidenceAdapters['ledger'] {
  return { read: (workspace) => readLatestLedgerSnapshots(workspace.rootPath) }
}

export async function discoverTokenEvidence(input: {
  query: LearningAnalyticsQuery
  workspaces: TokenEvidenceWorkspace[]
  temporaryConversations?: AgentConversationSummary[]
  inheritedWarnings: AnalyticsWarning[]
  adapters: TokenEvidenceAdapters
}): Promise<TokenEvidenceReport> {
  const { query, workspaces, adapters } = input
  const warnings = [...input.inheritedWarnings]
  const facts: TokenUsageFact[] = []
  const toolFacts: TokenToolFact[] = []
  const sources: AnalyticsSourceCoverage[] = []
  const counters: TokenEvidenceCounters = {
    conversationsScanned: 0,
    conversationsReadable: 0,
    conversationsWithUsage: 0,
    conversationsPartiallyMissingUsage: 0,
    ledgerSnapshotsScanned: 0,
    ledgerFallbackConversations: 0,
    invalidLedgerRows: 0,
    staleLedgerSnapshots: 0,
    ledgerReadErrors: 0,
    missingUsageConversations: 0,
    duplicateRuns: 0,
    componentMissing: 0,
    totalInconsistent: 0,
    invalidTimestampTurns: 0,
    workspaceErrors: 0,
    governance: []
  }

  for (const workspace of workspaces) {
    if (!workspace.summary) {
      counters.workspaceErrors += 1
      warnings.push(warning('source_scan_incomplete', `Workspace ${workspace.workspaceId} could not be scanned.`, 'workspace_catalog', { workspaceId: workspace.workspaceId }))
      continue
    }

    const conversationSummaries = [...new Map(
      workspace.summary.conversations.map((summary) => [summary.id, summary])
    ).values()]
    const ledgerPromise: Promise<LearningWorkLedgerSnapshotsRead> = adapters.ledger.read(workspace).catch(() => ({
      latestByConversation: new Map(),
      scanned: 0,
      invalid: 0,
      readError: true
    }))
    const conversationReadsPromise = mapWithConcurrency(
      conversationSummaries,
      TOKEN_CONVERSATION_READ_CONCURRENCY,
      async (summary) => {
        try {
          return await adapters.conversations.read(workspace.workspaceId, summary.id)
        } catch {
          return { state: 'unreadable' as const }
        }
      }
    )
    const [ledger, conversationReads] = await Promise.all([ledgerPromise, conversationReadsPromise])

    counters.ledgerSnapshotsScanned += ledger.scanned
    counters.invalidLedgerRows += ledger.invalid
    if (ledger.readError) {
      counters.ledgerReadErrors += 1
      warnings.push(warning('source_scan_incomplete', 'The learning-work ledger could not be read; ledger fallback is unavailable for this workspace.', 'learning_work_ledger', { workspaceId: workspace.workspaceId }))
    }
    if (ledger.invalid > 0) warnings.push(warning('ledger_rows_invalid', 'Some learning-work ledger rows were invalid and ignored.', 'learning_work_ledger', { workspaceId: workspace.workspaceId, invalidRows: ledger.invalid }))

    const workspaceConversationsScanned = conversationSummaries.length
    let workspaceConversationFacts = 0
    let workspaceLedgerFacts = 0
    let workspacePartialUsage = false
    for (let index = 0; index < conversationSummaries.length; index += 1) {
      const summary = conversationSummaries[index]
      const conversationRead = conversationReads[index]
      counters.conversationsScanned += 1
      if (conversationRead.state === 'unreadable') {
        warnings.push(warning('source_scan_incomplete', 'A conversation record could not be read; a ledger fallback was attempted.', 'agent_conversations', { workspaceId: workspace.workspaceId, conversationId: summary.id }))
      } else {
        counters.conversationsReadable += 1
      }

      const conversationScan = conversationRead.state === 'readable'
        ? collectConversationTokenFacts(conversationRead.record, workspace.workspaceId, workspace.workspaceName, query.calendarContext.timeZone)
        : null
      if (conversationScan?.facts.length) {
        counters.conversationsWithUsage += 1
        workspaceConversationFacts += conversationScan.facts.length
        facts.push(...conversationScan.facts)
        toolFacts.push(...conversationScan.toolNames)
        counters.duplicateRuns += conversationScan.duplicateRuns
        counters.componentMissing += conversationScan.componentMissing
        counters.totalInconsistent += conversationScan.totalInconsistent
        counters.governance.push(...conversationScan.governance)
        counters.invalidTimestampTurns += conversationScan.invalidTimestampTurns
        if (conversationScan.missingUsageTurns > 0) {
          // Honest gaps (some assistant turns lack usage) stay as warnings only.
          // They must not mark the whole tokens section as incomplete.
          counters.conversationsPartiallyMissingUsage += 1
          warnings.push(warning('conversation_usage_partially_missing', 'Some assistant turns have no usable run usage; ledger data was not added.', 'agent_conversations', { workspaceId: workspace.workspaceId, conversationId: summary.id, missingTurns: conversationScan.missingUsageTurns }))
        }
        continue
      }

      const snapshot = ledger.latestByConversation.get(summary.id)
      if (snapshot) {
        const fact = ledgerSnapshotToFact(snapshot, workspace, query.calendarContext.timeZone)
        facts.push(fact)
        workspaceLedgerFacts += 1
        counters.ledgerFallbackConversations += 1
        if (!snapshot.componentsComplete) counters.componentMissing += 1
        if (snapshot.totalInconsistent) counters.totalInconsistent += 1
        if (isStaleLedgerSnapshot(snapshot, summary)) counters.staleLedgerSnapshots += 1
        warnings.push(warning('ledger_fallback_used', 'Learning-work ledger usage was used because the conversation had no usable usage facts.', 'learning_work_ledger', { workspaceId: workspace.workspaceId, conversationId: summary.id }))
      } else if (conversationRead.state === 'unreadable') {
        // Unreadable records without a ledger fallback are true source failures.
        counters.missingUsageConversations += 1
        workspacePartialUsage = true
        warnings.push(warning('conversation_usage_missing', 'A conversation could not be read and has no usable ledger fallback for token usage.', 'agent_conversations', { workspaceId: workspace.workspaceId, conversationId: summary.id }))
      } else if ((conversationScan?.assistantTurns ?? 0) > 0) {
        // Readable assistant history without usage is an honest gap, not a scan failure.
        warnings.push(warning('conversation_usage_missing', 'A conversation has no usable token usage in either the conversation record or its latest ledger snapshot.', 'agent_conversations', { workspaceId: workspace.workspaceId, conversationId: summary.id }))
      }
      // Readable conversations with no assistant turns (drafts / user-only) are ignored.
    }
    const conversationMissing = workspace.summary.conversations.length - workspaceConversationsScanned
    sources.push({ source: 'agent_conversations', state: conversationMissing > 0 || workspacePartialUsage ? 'partial' : 'complete', scanned: workspace.summary.conversations.length, included: workspaceConversationFacts, missing: Math.max(0, conversationMissing), rejected: 0 })
    sources.push({ source: 'learning_work_ledger', state: ledger.readError ? 'error' : ledger.invalid > 0 ? 'partial' : 'complete', scanned: ledger.scanned, included: workspaceLedgerFacts, missing: ledger.readError ? Math.max(0, workspace.summary.conversations.length - workspaceConversationFacts) : 0, rejected: ledger.invalid })
  }

  const temporarySummaries = [...new Map(
    (input.temporaryConversations ?? []).map((summary) => [
      `${summary.workspaceId ?? ''}:${summary.id}:${summary.relativePath}`,
      summary
    ])
  ).values()]
  if (temporarySummaries.length > 0) {
    const workspaceNames = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace.workspaceName]))
    const temporaryReads = await mapWithConcurrency(
      temporarySummaries,
      TOKEN_CONVERSATION_READ_CONCURRENCY,
      async (summary) => {
        if (!adapters.temporaryConversations) return { state: 'unreadable' as const }
        try {
          return await adapters.temporaryConversations.read(summary.workspaceId, summary.id)
        } catch {
          return { state: 'unreadable' as const }
        }
      }
    )
    let included = 0
    let missing = 0
    let partial = false
    for (let index = 0; index < temporarySummaries.length; index += 1) {
      const summary = temporarySummaries[index]
      const conversationRead = temporaryReads[index]
      const workspaceId = summary.workspaceId ?? 'global-temporary'
      const workspaceName = workspaceNames.get(workspaceId) ?? 'Temporary conversations'
      counters.conversationsScanned += 1
      if (conversationRead.state === 'unreadable') {
        partial = true
        missing += 1
        counters.missingUsageConversations += 1
        warnings.push(warning('source_scan_incomplete', 'A temporary conversation record could not be read.', 'agent_conversations', { workspaceId, conversationId: summary.id }))
        continue
      }

      counters.conversationsReadable += 1
      const scan = collectConversationTokenFacts(
        conversationRead.record,
        workspaceId,
        workspaceName,
        query.calendarContext.timeZone,
        `temporary:${summary.absolutePath}`
      )
      if (!scan.facts.length) {
        if (scan.assistantTurns > 0) {
          // Honest empty usage on temporary chats stays visible as a warning only.
          warnings.push(warning('conversation_usage_missing', 'A temporary conversation has no usable token usage.', 'agent_conversations', { workspaceId, conversationId: summary.id }))
        }
        continue
      }

      counters.conversationsWithUsage += 1
      included += scan.facts.length
      facts.push(...scan.facts)
      toolFacts.push(...scan.toolNames)
      counters.duplicateRuns += scan.duplicateRuns
      counters.componentMissing += scan.componentMissing
      counters.totalInconsistent += scan.totalInconsistent
      counters.governance.push(...scan.governance)
      counters.invalidTimestampTurns += scan.invalidTimestampTurns
      if (scan.missingUsageTurns > 0) {
        counters.conversationsPartiallyMissingUsage += 1
        warnings.push(warning('conversation_usage_partially_missing', 'Some assistant turns in a temporary conversation have no usable run usage.', 'agent_conversations', { workspaceId, conversationId: summary.id, missingTurns: scan.missingUsageTurns }))
      }
    }
    sources.push({
      source: 'agent_conversations',
      state: partial ? 'partial' : 'complete',
      scanned: temporarySummaries.length,
      included,
      missing,
      rejected: 0
    })
  }

  if (counters.componentMissing > 0) warnings.push(warning('token_components_missing', 'Some usage facts provide only total tokens; prompt and completion components remain unknown.', 'agent_conversations', { facts: counters.componentMissing }))
  if (counters.totalInconsistent > 0) warnings.push(warning('token_total_inconsistent', 'Some source totals differ from prompt plus completion; source totals were preserved.', 'agent_conversations', { facts: counters.totalInconsistent }))
  if (counters.duplicateRuns > 0) warnings.push(warning('custom', 'Duplicate conversation run identities were ignored.', 'agent_conversations', { duplicateRuns: counters.duplicateRuns }))
  if (counters.invalidTimestampTurns > 0) warnings.push(warning('source_scan_incomplete', 'Some usage-bearing assistant turns had invalid timestamps and were ignored.', 'agent_conversations', { turns: counters.invalidTimestampTurns }))
  warnings.push(warning('source_timezone_inferred', 'Conversation and ledger timestamps were bucketed in the query time zone.', 'agent_conversations', { timeZone: query.calendarContext.timeZone }))

  return {
    facts,
    rangedFacts: facts.filter((fact) => isDateInRange(fact.localDate, query.range)),
    toolFacts,
    governance: counters.governance,
    sources,
    warnings,
    counters,
    // Completeness tracks true source failures only. Honest gaps (assistant turns
    // without usage, provider totals without prompt/completion split) stay as
    // warnings so the tokens section can still render available data.
    complete: counters.workspaceErrors === 0 && counters.ledgerReadErrors === 0 && counters.invalidLedgerRows === 0 && counters.missingUsageConversations === 0 && counters.invalidTimestampTurns === 0
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return
        results[index] = await mapper(items[index], index)
      }
    }
  )
  await Promise.all(workers)
  return results
}

function isStaleLedgerSnapshot(snapshot: LedgerSnapshot, summary: TeachingWorkspaceSummary['conversations'][number]): boolean {
  const summaryUpdatedAt = validInstant(summary.updatedAt)
  return (summaryUpdatedAt !== null && summaryUpdatedAt !== snapshot.occurredAt) || summary.messageCount !== snapshot.messageCount
}

function warning(code: AnalyticsWarning['code'], message: string, source?: AnalyticsWarning['source'], details?: AnalyticsWarning['details']): AnalyticsWarning {
  return { code, severity: code === 'source_timezone_inferred' || code === 'ledger_fallback_used' ? 'info' : 'warning', message, ...(source ? { source } : {}), ...(details ? { details } : {}) }
}

export function collectConversationTokenFacts(
  record: AgentConversationRecord,
  workspaceId: string,
  workspaceName: string,
  timeZone: string,
  evidenceScopeId = workspaceId
): ConversationTokenScan {
  const facts: InternalTokenUsageFact[] = []
  const toolNames: ConversationTokenScan['toolNames'] = []
  const governance: ConversationTokenScan['governance'] = []
  const seen = new Set<string>()
  let assistantTurns = 0
  let assistantTurnsWithUsage = 0
  let missingUsageTurns = 0
  let invalidTimestampTurns = 0
  let duplicateRuns = 0
  let componentMissing = 0
  let totalInconsistent = 0

  for (const turn of record.turns) {
    if (turn.role !== 'assistant') continue
    assistantTurns += 1
    const dedupeKey = `${evidenceScopeId}:${record.id}:${turn.id}`
    if (seen.has(dedupeKey)) {
      duplicateRuns += 1
      continue
    }
    seen.add(dedupeKey)

    const normalized = normalizeUsage(turn.metadata?.runUsage)
    if (!normalized) {
      missingUsageTurns += 1
      continue
    }
    const occurredAt = validInstant(turn.createdAt)
    if (!occurredAt) {
      invalidTimestampTurns += 1
      missingUsageTurns += 1
      continue
    }

    assistantTurnsWithUsage += 1
    if (!normalized.componentsComplete) componentMissing += 1
    if (normalized.totalInconsistent) totalInconsistent += 1
    const relativeCoursePath = coursePath(record.relativePath)
    facts.push({
      source: 'conversation',
      dedupeKey,
      conversationKey: `${evidenceScopeId}:${record.id}`,
      conversationId: record.id,
      conversationTitle: record.title,
      workspaceId,
      workspaceName,
      ...(relativeCoursePath ? { courseRelativePath: relativeCoursePath } : {}),
      turnId: turn.id,
      occurredAt,
      localDate: dateToLocalKey(new Date(occurredAt), timeZone),
      localDateSource: 'query_timezone',
      usage: normalized.usage,
      componentsComplete: normalized.componentsComplete,
      messageCount: record.messageCount
    })

    for (const tool of turn.toolCalls ?? []) {
      toolNames.push({
        name: cleanLabel(tool.name, 'tool'),
        error: Boolean(tool.isError),
        dedupeKey: `${dedupeKey}:tool:${tool.id}`,
        runDedupeKey: dedupeKey
      })
    }
    governance.push({
      runDedupeKey: dedupeKey,
      compactionEvents: turn.metadata?.compactions?.length ?? 0,
      replacedTokens: sum((turn.metadata?.compactions ?? []).map((item) => finiteNonNegative(item.replacedTokens) ?? 0)),
      hygieneSavedTokens: sum((turn.metadata?.contextHygiene ?? []).map((item) => finiteNonNegative(item.savedTokens) ?? 0))
    })
  }

  return {
    facts,
    assistantTurns,
    assistantTurnsWithUsage,
    missingUsageTurns,
    invalidTimestampTurns,
    duplicateRuns,
    componentMissing,
    totalInconsistent,
    toolNames,
    governance
  }
}

export function aggregateTokenFacts(
  facts: TokenUsageFact[],
  toolFacts: ConversationTokenScan['toolNames'],
  extra: {
    conversationsScanned: number
    conversationsReadable: number
    conversationsWithUsage: number
    conversationsPartiallyMissingUsage: number
    ledgerSnapshotsScanned: number
    ledgerFallbackConversations: number
    invalidLedgerRows: number
    governance?: ConversationTokenScan['governance']
  }
): TokenAnalytics {
  const uniqueFacts = new Map<string, TokenUsageFact>()
  for (const fact of facts) {
    if (!uniqueFacts.has(fact.dedupeKey)) uniqueFacts.set(fact.dedupeKey, fact)
  }
  const accepted = [...uniqueFacts.values()]
  const componentsKnown = accepted.length > 0 && accepted.every(
    (fact) => fact.usage.promptTokens !== undefined && fact.usage.completionTokens !== undefined
  )
  const totals = {
    ...(componentsKnown ? {
      promptTokens: sum(accepted.map((fact) => fact.usage.promptTokens ?? 0)),
      completionTokens: sum(accepted.map((fact) => fact.usage.completionTokens ?? 0))
    } : {}),
    totalTokens: sum(accepted.map((fact) => fact.usage.totalTokens)),
    providerCalls: sum(accepted.map((fact) => fact.usage.providerCalls)),
    toolCalls: sum(accepted.map((fact) => fact.usage.toolCalls)),
    toolErrors: sum(accepted.map((fact) => fact.usage.toolErrors)),
    iterations: sum(accepted.map((fact) => fact.usage.iterations)),
    childRuns: sum(accepted.map((fact) => fact.usage.childRuns)),
    durationMs: sum(accepted.map((fact) => fact.usage.durationMs)),
    budgetStops: accepted.filter((fact) => fact.usage.budgetStopReason).length
  }

  const byDayMap = new Map<string, TokenUsageFact[]>()
  const byConversationMap = new Map<string, TokenUsageFact[]>()
  const byWorkspaceMap = new Map<string, TokenUsageFact[]>()
  for (const fact of accepted) {
    pushMap(byDayMap, fact.localDate, fact)
    pushMap(byConversationMap, fact.conversationKey, fact)
    if (fact.workspaceId) pushMap(byWorkspaceMap, fact.workspaceId, fact)
  }

  const byDay = [...byDayMap.entries()].map(([date, items]) => {
    const known = items.every(
      (fact) => fact.usage.promptTokens !== undefined && fact.usage.completionTokens !== undefined
    )
    return {
      date,
      ...(known ? {
        promptTokens: sum(items.map((fact) => fact.usage.promptTokens ?? 0)),
        completionTokens: sum(items.map((fact) => fact.usage.completionTokens ?? 0))
      } : {}),
      totalTokens: sum(items.map((fact) => fact.usage.totalTokens)),
      runs: items.length
    }
  }).sort((left, right) => left.date.localeCompare(right.date))

  const byConversation = [...byConversationMap.entries()].map(([conversationKey, items]) => {
    const latest = [...items].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]
    const known = items.every(
      (fact) => fact.usage.promptTokens !== undefined && fact.usage.completionTokens !== undefined
    )
    const messageCount = Math.max(...items.map((fact) => internalMessageCount(fact)), items.length)
    return {
      conversationKey,
      conversationId: latest.conversationId,
      title: latest.conversationTitle,
      ...(latest.workspaceId ? { workspaceId: latest.workspaceId } : {}),
      ...(latest.workspaceName ? { workspaceName: latest.workspaceName } : {}),
      ...(latest.courseRelativePath ? { courseRelativePath: latest.courseRelativePath } : {}),
      source: items.some((fact) => fact.source === 'conversation')
        ? 'conversation' as const
        : 'ledger_fallback' as const,
      ...(known ? {
        promptTokens: sum(items.map((fact) => fact.usage.promptTokens ?? 0)),
        completionTokens: sum(items.map((fact) => fact.usage.completionTokens ?? 0))
      } : {}),
      totalTokens: sum(items.map((fact) => fact.usage.totalTokens)),
      providerCalls: sum(items.map((fact) => fact.usage.providerCalls)),
      toolCalls: sum(items.map((fact) => fact.usage.toolCalls)),
      toolErrors: sum(items.map((fact) => fact.usage.toolErrors)),
      messageCount,
      durationMs: sum(items.map((fact) => fact.usage.durationMs)),
      updatedAt: latest.occurredAt
    }
  }).sort((left, right) => right.totalTokens - left.totalTokens || left.conversationKey.localeCompare(right.conversationKey))

  const byWorkspace = [...byWorkspaceMap.entries()].map(([workspaceId, items]) => ({
    workspaceId,
    name: items.find((fact) => fact.workspaceName)?.workspaceName ?? workspaceId,
    totalTokens: sum(items.map((fact) => fact.usage.totalTokens)),
    conversationCount: new Set(items.map((fact) => fact.conversationKey)).size
  })).sort((left, right) => right.totalTokens - left.totalTokens || left.workspaceId.localeCompare(right.workspaceId))

  const acceptedKeys = new Set(accepted.filter((fact) => fact.source === 'conversation').map((fact) => fact.dedupeKey))
  const byToolMap = new Map<string, { calls: number; errors: number }>()
  const seenTools = new Set<string>()
  for (const tool of toolFacts) {
    if (!acceptedKeys.has(tool.runDedupeKey) || seenTools.has(tool.dedupeKey)) continue
    seenTools.add(tool.dedupeKey)
    const current = byToolMap.get(tool.name) ?? { calls: 0, errors: 0 }
    current.calls += 1
    current.errors += tool.error ? 1 : 0
    byToolMap.set(tool.name, current)
  }
  const byTool = [...byToolMap.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name))

  const governance = (extra.governance ?? []).filter((item) => acceptedKeys.has(item.runDedupeKey))
  const messageCount = byConversation.reduce((total, conversation) => total + conversation.messageCount, 0)
  return {
    totals,
    byDay,
    byConversation,
    byWorkspace,
    byTool,
    efficiency: {
      averageTokensPerUsageFact: accepted.length ? totals.totalTokens / accepted.length : null,
      averageTokensPerConversation: byConversation.length ? totals.totalTokens / byConversation.length : null,
      averageTokensPerMessage: messageCount ? totals.totalTokens / messageCount : null,
      averageDurationMs: accepted.length ? totals.durationMs / accepted.length : null,
      toolErrorRate: totals.toolCalls ? totals.toolErrors / totals.toolCalls : null
    },
    contextGovernance: {
      compactionEvents: sum(governance.map((item) => item.compactionEvents)),
      replacedTokens: sum(governance.map((item) => item.replacedTokens)),
      hygieneSavedTokens: sum(governance.map((item) => item.hygieneSavedTokens)),
      childRunShare: totals.providerCalls ? totals.childRuns / totals.providerCalls : null
    },
    sourceCoverage: {
      conversationsScanned: extra.conversationsScanned,
      conversationsReadable: extra.conversationsReadable,
      conversationsWithUsage: extra.conversationsWithUsage,
      conversationsPartiallyMissingUsage: extra.conversationsPartiallyMissingUsage,
      ledgerSnapshotsScanned: extra.ledgerSnapshotsScanned,
      ledgerFallbackConversations: extra.ledgerFallbackConversations,
      invalidLedgerRows: extra.invalidLedgerRows
    }
  }
}

export async function readLatestLedgerSnapshots(rootPath: string): Promise<{ latestByConversation: Map<string, LedgerSnapshot>; scanned: number; invalid: number; readError: boolean }> {
  let lines: string[] = []
  let readError = false
  try {
    lines = await readLearningWorkLedgerLines(rootPath)
  } catch {
    readError = true
  }
  const latestByConversation = new Map<string, LedgerSnapshot>(); let scanned = 0, invalid = 0
  for (const line of lines) { scanned++; const snapshot = parseLedgerSnapshot(line); if (!snapshot) { invalid++; continue }; const previous = latestByConversation.get(snapshot.conversationId); if (!previous || compareSnapshot(snapshot, previous) > 0) latestByConversation.set(snapshot.conversationId, snapshot) }
  return { latestByConversation, scanned, invalid, readError }
}
function parseLedgerSnapshot(line: string): LedgerSnapshot | null {
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>, conversation = objectValue(record.conversation), evidence = objectValue(record.evidence)
  if (record.version !== 1 || record.type !== 'conversation_snapshot' || !conversation || !evidence) return null
  const conversationId = cleanString(conversation.id), usage = normalizeUsage(evidence.runUsage)
  const occurredAt = validInstant(conversation.updatedAt)
  const ledgerCreatedAt = validInstant(record.createdAt)
  const messageCount = finiteNonNegative(conversation.messageCount)
  if (!conversationId || !occurredAt || !ledgerCreatedAt || messageCount === null || !usage) return null
  return { conversationId, title: cleanString(conversation.title) ?? conversationId, courseRelativePath: cleanString(conversation.courseRelativePath), occurredAt, ledgerCreatedAt, messageCount, usage: usage.usage, componentsComplete: usage.componentsComplete, totalInconsistent: usage.totalInconsistent }
}

function ledgerSnapshotToFact(snapshot: LedgerSnapshot, workspace: TokenEvidenceWorkspace, timeZone: string): InternalTokenUsageFact {
  return { source: 'ledger_fallback', dedupeKey: `${workspace.workspaceId}:${snapshot.conversationId}:ledger:${snapshot.occurredAt}:${snapshot.ledgerCreatedAt}`, conversationKey: `${workspace.workspaceId}:${snapshot.conversationId}`, conversationId: snapshot.conversationId, conversationTitle: snapshot.title, workspaceId: workspace.workspaceId, workspaceName: workspace.workspaceName, ...(snapshot.courseRelativePath ? { courseRelativePath: snapshot.courseRelativePath } : {}), occurredAt: snapshot.occurredAt, localDate: dateToLocalKey(new Date(snapshot.occurredAt), timeZone), localDateSource: 'query_timezone', usage: snapshot.usage, componentsComplete: snapshot.componentsComplete, messageCount: snapshot.messageCount }
}

function normalizeUsage(raw: unknown): { usage: TokenUsageNumbers; componentsComplete: boolean; totalInconsistent: boolean } | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>, promptTokens = finiteNonNegative(value.promptTokens), completionTokens = finiteNonNegative(value.completionTokens), sourceTotal = finiteNonNegative(value.totalTokens), derivedTotal = promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null, totalTokens = sourceTotal ?? derivedTotal
  if (totalTokens === null) return null
  const stop = ['duration', 'provider_calls', 'tool_calls', 'total_tokens'].includes(String(value.budgetStopReason)) ? value.budgetStopReason as TokenUsageNumbers['budgetStopReason'] : undefined
  return { usage: { ...(promptTokens !== null ? { promptTokens } : {}), ...(completionTokens !== null ? { completionTokens } : {}), totalTokens, providerCalls: finiteNonNegative(value.providerCalls) ?? 0, toolCalls: finiteNonNegative(value.toolCalls) ?? 0, toolErrors: finiteNonNegative(value.toolErrors) ?? 0, iterations: finiteNonNegative(value.iterations) ?? 0, childRuns: finiteNonNegative(value.childRuns) ?? 0, durationMs: finiteNonNegative(value.durationMs) ?? 0, ...(stop ? { budgetStopReason: stop } : {}) }, componentsComplete: promptTokens !== null && completionTokens !== null, totalInconsistent: sourceTotal !== null && derivedTotal !== null && sourceTotal !== derivedTotal }
}

function dateToLocalKey(date: Date, timeZone: string): AnalyticsLocalDate {
  if (Number.isNaN(date.getTime())) return '0001-01-01'
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value, month = parts.find((part) => part.type === 'month')?.value, day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : '0001-01-01'
}
function isDateInRange(date: string, range: AnalyticsDateRange): boolean { return date >= range.from && date <= range.to }
function validInstant(value: unknown): string | null { if (typeof value !== 'string') return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString() }
function cleanString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function cleanLabel(value: unknown, fallback: string): string { return cleanString(value)?.slice(0, 160) ?? fallback }
function finiteNonNegative(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null }
function internalMessageCount(fact: TokenUsageFact): number { return finiteNonNegative((fact as Partial<InternalTokenUsageFact>).messageCount) ?? 0 }
function objectValue(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function coursePath(relativePath: string): string | undefined { const normalized = relativePath.replace(/\\/g, '/'), marker = '/conversations/', index = normalized.lastIndexOf(marker); return index > 0 ? normalized.slice(0, index) : undefined }
function compareSnapshot(left: LedgerSnapshot, right: LedgerSnapshot): number { return left.occurredAt.localeCompare(right.occurredAt) || left.ledgerCreatedAt.localeCompare(right.ledgerCreatedAt) }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0) }
function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void { const current = map.get(key) ?? []; current.push(value); map.set(key, current) }
