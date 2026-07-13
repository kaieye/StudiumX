import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AgentConversationRecord,
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsExportManifest,
  AnalyticsExportRequest,
  AnalyticsLocalDate,
  AnalyticsSectionId,
  AnalyticsSectionResult,
  AnalyticsSourceCoverage,
  AnalyticsTemporalBasis,
  AnalyticsWarning,
  ClearAnalyticsRequest,
  ClearAnalyticsResult,
  ConnectorStatusesResult,
  GetProgressResult,
  LearningAnalyticsBundle,
  LearningAnalyticsQuery,
  LearningAnalyticsRequest,
  MemoryAnalytics,
  PlatformAnalytics,
  PresenceSnapshotAnalytics,
  ReviewAnalytics,
  SkillCatalogResult,
  TeachingMemoryDiagnostics,
  TeachingMemoryRecord,
  TeachingSettingsV1,
  TeachingWorkspaceChangeSummary,
  TeachingWorkspaceSummary,
  TokenAnalytics,
  TokenUsageFact,
  TokenUsageNumbers,
  WorkspaceAssetsAnalytics
} from '../../../shared/teaching-types'
import { agentConversationJsonRelativePathForMarkdown } from '../../../shared/agent-conversation-catalog'
import { LEARNING_WORK_LEDGER_RELATIVE_PATH } from '../../learning-work-ledger'
import {
  buildPersonalStudyAnalytics,
  validatePersonalStudySnapshot,
  type PersonalStudySnapshotValidation
} from '../../../shared/learning-analytics/personal-study-source'

const CONTRACT_VERSION = 1 as const
const RETENTION_DAYS = 400 as const
const CACHE_LIMIT = 12
const ANALYTICS_DIR = 'analytics'
const TRACKING_FILE = 'tracking-start.json'

export type AnalyticsWorkspaceScanResult = {
  workspaceId: string
  workspaceName: string
  rootPath: string
  summary?: TeachingWorkspaceSummary
  error?: string
}

export type LearningAnalyticsDependencies = {
  appDataRoot: string
  listWorkspaceSummaries: () => Promise<AnalyticsWorkspaceScanResult[]>
  readConversation: (workspaceId: string, conversationId: string) => Promise<AgentConversationRecord>
  getProgress: (workspaceId: string) => Promise<GetProgressResult>
  listReviewCards: (workspaceId: string) => Promise<{ cards: Array<{ lessonId: string; lessonTitle: string }> }>
  listMemory: (workspaceRoot?: string) => Promise<TeachingMemoryRecord[]>
  getMemoryDiagnostics: () => Promise<TeachingMemoryDiagnostics>
  listSkills: () => Promise<SkillCatalogResult>
  loadSettings: () => Promise<TeachingSettingsV1>
  getConnectorStatuses?: () => Promise<ConnectorStatusesResult>
  listWorkspaceChanges?: (workspaceId: string) => Promise<TeachingWorkspaceChangeSummary[]>
  now?: () => Date
}

type CacheEntry = { fingerprint: string; bundle: LearningAnalyticsBundle; touchedAt: number }
type ScanHeader = {
  selected: AnalyticsWorkspaceScanResult[]
  settings: TeachingSettingsV1 | null
  skills: SkillCatalogResult | null
  connectorStatuses: ConnectorStatusesResult | null
  warnings: AnalyticsWarning[]
  fingerprint: string
}
type LedgerSnapshot = {
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
type InternalTokenUsageFact = TokenUsageFact & { messageCount: number }
type ConversationTokenScan = {
  facts: InternalTokenUsageFact[]
  assistantTurns: number
  assistantTurnsWithUsage: number
  missingUsageTurns: number
  invalidTimestampTurns: number
  duplicateRuns: number
  componentMissing: number
  totalInconsistent: number
  toolNames: Array<{ name: string; error: boolean; dedupeKey: string; runDedupeKey: string }>
  governance: Array<{
    runDedupeKey: string
    compactionEvents: number
    replacedTokens: number
    hygieneSavedTokens: number
  }>
}
type TokenScanResult = { section: AnalyticsSectionResult<TokenAnalytics> }
export type AnalyticsPreparedExport = { fileName: string; content: string; manifest: AnalyticsExportManifest }

export class LearningAnalyticsService {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<LearningAnalyticsBundle>>()

  constructor(private readonly dependencies: LearningAnalyticsDependencies) {}

  async getLearningAnalytics(request: LearningAnalyticsRequest | LearningAnalyticsQuery): Promise<LearningAnalyticsBundle> {
    const normalized = normalizeLearningAnalyticsRequest(request)
    validateLearningAnalyticsQuery(normalized.query)
    const personal = normalized.query.scope.personalFocus.kind === 'personal'
      ? validatePersonalStudySnapshot(normalized.personalStudy, {
          clientId: normalized.query.scope.personalFocus.clientId,
          localToday: normalized.query.calendarContext.localToday,
          now: this.now()
        })
      : ({ state: 'missing', cacheIdentity: 'missing', warnings: [] } as PersonalStudySnapshotValidation)
    const queryKey = digest(stableJson({ query: normalized.query, personal: personalCacheFingerprint(personal) }))
    const existing = this.inFlight.get(queryKey)
    if (existing) return existing
    const pending = this.loadBundle(normalized.query, personal, queryKey).finally(() => {
      if (this.inFlight.get(queryKey) === pending) this.inFlight.delete(queryKey)
    })
    this.inFlight.set(queryKey, pending)
    return pending
  }

  async prepareExport(request: AnalyticsExportRequest): Promise<AnalyticsPreparedExport> {
    validateAnalyticsExportRequest(request)
    return createSafeAnalyticsExport(await this.getLearningAnalytics({ query: request.query, personalStudy: request.personalStudy }), request)
  }

  async clearLearningAnalytics(request: ClearAnalyticsRequest): Promise<ClearAnalyticsResult> {
    validateClearAnalyticsRequest(request)
    const cleared: ClearAnalyticsResult['cleared'] = []
    const analyticsRoot = join(this.dependencies.appDataRoot, ANALYTICS_DIR)
    let trackingRestartedOn: string | undefined
    for (const target of [...new Set(request.targets)]) {
      if (target === 'derived_cache') {
        this.cache.clear()
        await safeRemove(join(analyticsRoot, 'cache'))
        await safeRemove(join(analyticsRoot, 'daily-projections'))
      } else if (target === 'personal_activity_history') {
        await safeRemove(join(analyticsRoot, 'personal-activity'))
        await safeRemove(join(analyticsRoot, 'study-activity-v1.json'))
        await safeRemove(join(analyticsRoot, 'study-daily-projection-v1.json'))
        trackingRestartedOn = dateToLocalKey(this.now(), this.localTimeZone())
        await mkdir(analyticsRoot, { recursive: true })
        await writeFile(join(analyticsRoot, TRACKING_FILE), `${JSON.stringify({ trackingStartedOn: trackingRestartedOn })}\n`, { mode: 0o600 })
        this.cache.clear()
      } else {
        await safeRemove(join(analyticsRoot, 'preferences.json'))
      }
      cleared.push(target)
    }
    return {
      cleared,
      preservedSourceDomains: ['teaching_workspaces', 'conversations', 'ledger', 'review', 'memory', 'current_tasks'],
      ...(trackingRestartedOn ? { trackingRestartedOn } : {})
    }
  }

  invalidate(): void { this.cache.clear() }

  private async loadBundle(query: LearningAnalyticsQuery, personal: PersonalStudySnapshotValidation, queryKey: string): Promise<LearningAnalyticsBundle> {
    const header = await this.loadScanHeader(query, personal)
    const cached = this.cache.get(queryKey)
    if (cached?.fingerprint === header.fingerprint) {
      cached.touchedAt = Date.now()
      return cached.bundle
    }
    const bundle = await this.aggregate(query, header, personal)
    this.cache.set(queryKey, { fingerprint: header.fingerprint, bundle, touchedAt: Date.now() })
    this.pruneCache()
    return bundle
  }

  private async loadScanHeader(query: LearningAnalyticsQuery, personal: PersonalStudySnapshotValidation): Promise<ScanHeader> {
    const warnings: AnalyticsWarning[] = []
    const [workspaceResult, settingsResult, skillsResult, connectorsResult] = await Promise.allSettled([
      this.dependencies.listWorkspaceSummaries(),
      this.dependencies.loadSettings(),
      this.dependencies.listSkills(),
      this.dependencies.getConnectorStatuses?.() ?? Promise.resolve(null)
    ])
    const workspaces = workspaceResult.status === 'fulfilled' ? workspaceResult.value : []
    if (workspaceResult.status === 'rejected') warnings.push(warning('source_scan_incomplete', 'Teaching workspace catalog could not be scanned.', 'workspace_catalog'))
    const selected = selectWorkspaceScans(query, workspaces)
    const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null
    const skills = skillsResult.status === 'fulfilled' ? skillsResult.value : null
    const connectorStatuses = connectorsResult.status === 'fulfilled' ? connectorsResult.value : null
    if (!settings) warnings.push(warning('source_scan_incomplete', 'Settings could not be read for analytics.', 'settings'))
    if (!skills) warnings.push(warning('source_scan_incomplete', 'Skill catalog could not be read for analytics.', 'skill_catalog'))
    const fingerprint = await this.fingerprint(query, selected, settings, skills, connectorStatuses, personal)
    return { selected, settings, skills, connectorStatuses, warnings, fingerprint }
  }

  private async fingerprint(
    query: LearningAnalyticsQuery,
    selected: AnalyticsWorkspaceScanResult[],
    settings: TeachingSettingsV1 | null,
    skills: SkillCatalogResult | null,
    connectors: ConnectorStatusesResult | null,
    personal: PersonalStudySnapshotValidation
  ): Promise<string> {
    const paths = new Set<string>([
      join(this.dependencies.appDataRoot, 'memory'),
      join(this.dependencies.appDataRoot, 'learning-changes', 'history.json'),
      join(this.dependencies.appDataRoot, ANALYTICS_DIR, TRACKING_FILE)
    ])
    for (const item of selected) {
      paths.add(join(item.rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH))
      paths.add(join(item.rootPath, '.teachos', 'progress.json'))
      paths.add(join(item.rootPath, '.teachos', 'reviews'))
      paths.add(join(item.rootPath, '.teachos', 'review'))
      paths.add(join(item.rootPath, 'MISSION.md'))
      for (const conversation of item.summary?.conversations ?? []) {
        paths.add(conversation.absolutePath)
        paths.add(join(item.rootPath, agentConversationJsonRelativePathForMarkdown(conversation.relativePath)))
      }
      for (const lesson of item.summary?.lessons ?? []) paths.add(lesson.absolutePath)
    }
    return digest(stableJson({
      contractVersion: CONTRACT_VERSION,
      query,
      workspaces: selected.map((item) => ({
        id: item.workspaceId,
        name: item.workspaceName,
        error: Boolean(item.error),
        updatedAt: item.summary?.updatedAt,
        conversations: item.summary?.conversations.map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt, messageCount: entry.messageCount })),
        lessons: item.summary?.lessons.map((entry) => ({ id: entry.id, createdAt: entry.createdAt })),
        resources: item.summary?.resources.length,
        records: item.summary?.records.length,
        references: item.summary?.referenceCount
      })),
      settings,
      skills: skills?.skills.map((entry) => ({ id: entry.id, installed: entry.installed, version: entry.version, category: entry.category })),
      connectors: connectors?.connectors.map((entry) => ({ id: entry.id, state: entry.state })),
      personalStudy: personalCacheFingerprint(personal),
      mtimes: await collectPathVersions([...paths])
    }))
  }

  private async aggregate(query: LearningAnalyticsQuery, header: ScanHeader, personal: PersonalStudySnapshotValidation): Promise<LearningAnalyticsBundle> {
    const generatedAt = this.now().toISOString()
    const [tokenScan, workspaceAssets, review, memory, platform] = await Promise.all([
      this.scanTokens(query, header.selected, header.warnings),
      Promise.resolve(buildWorkspaceAssetsSection(query, generatedAt, header.selected, header.warnings)),
      this.scanReview(query, generatedAt, header.selected, header.warnings),
      this.scanMemory(query, generatedAt, header.selected, header.warnings),
      this.scanPlatform(query, generatedAt, header)
    ])
    const personalSections = buildPersonalStudyAnalytics({
      query,
      validation: personal,
      generatedAt,
      tokens: tokenScan.section
    })
    const { hero, focus, tasks } = personalSections
    const presence = query.scope.presence.kind === 'none'
      ? unavailableSection<PresenceSnapshotAnalytics>(asOfTemporal(generatedAt), coverage(query, false, [], [], true), 'not_applicable', [])
      : unavailableSection<PresenceSnapshotAnalytics>(liveTemporal(generatedAt), coverage(query, false, [], [], false), 'source_missing', [warning('source_not_configured', 'Presence is a live renderer snapshot, not Teaching history.', 'presence')])
    return {
      contractVersion: CONTRACT_VERSION,
      generatedAt,
      query,
      hero,
      focus,
      tasks,
      tokens: tokenScan.section,
      workspaceAssets,
      review,
      memory,
      platform,
      presence,
      insights: buildInsightsSection(query, generatedAt, tokenScan.section, workspaceAssets, review, memory, platform)
    }
  }
  private async scanTokens(query: LearningAnalyticsQuery, selected: AnalyticsWorkspaceScanResult[], inheritedWarnings: AnalyticsWarning[]): Promise<TokenScanResult> {
    if (query.scope.teaching.kind === 'none') return { section: unavailableSection(queryTemporal(query), coverage(query, true, [], [], true), 'not_applicable', []) }
    if (query.scope.teaching.kind === 'workspace' && selected.length === 0) return { section: unavailableSection(queryTemporal(query), coverage(query, true, [], [], false), 'no_active_workspace', []) }
    const warnings = [...inheritedWarnings]
    const facts: TokenUsageFact[] = []
    const toolFacts: ConversationTokenScan['toolNames'] = []
    const sourceRows: AnalyticsSourceCoverage[] = []
    let conversationsScanned = 0
    let conversationsReadable = 0
    let conversationsWithUsage = 0
    let conversationsPartiallyMissingUsage = 0
    let ledgerSnapshotsScanned = 0
    let ledgerFallbackConversations = 0
    let invalidLedgerRows = 0
    let ledgerReadErrors = 0
    let missingUsageConversations = 0
    let duplicateRuns = 0
    let componentMissing = 0
    let totalInconsistent = 0
    const governance: ConversationTokenScan['governance'] = []
    let invalidTimestampTurns = 0
    let workspaceErrors = 0

    for (const workspace of selected) {
      if (!workspace.summary) {
        workspaceErrors += 1
        warnings.push(warning('source_scan_incomplete', `Workspace ${workspace.workspaceId} could not be scanned.`, 'workspace_catalog', { workspaceId: workspace.workspaceId }))
        continue
      }
      const ledger = await readLatestLedgerSnapshots(workspace.rootPath)
      ledgerSnapshotsScanned += ledger.scanned
      invalidLedgerRows += ledger.invalid
      if (ledger.readError) ledgerReadErrors += 1
      if (ledger.readError) {
        warnings.push(warning('source_scan_incomplete', 'The learning-work ledger could not be read; ledger fallback is unavailable for this workspace.', 'learning_work_ledger', { workspaceId: workspace.workspaceId }))
      }
      if (ledger.invalid > 0) warnings.push(warning('ledger_rows_invalid', 'Some learning-work ledger rows were invalid and ignored.', 'learning_work_ledger', { workspaceId: workspace.workspaceId, invalidRows: ledger.invalid }))
      const seenConversations = new Set<string>()
      let workspaceConversationsScanned = 0
      let workspaceConversationFacts = 0
      let workspaceLedgerFacts = 0
      let workspacePartialUsage = false
      for (const summary of workspace.summary.conversations) {
        if (seenConversations.has(summary.id)) continue
        seenConversations.add(summary.id)
        conversationsScanned += 1
        workspaceConversationsScanned += 1
        let record: AgentConversationRecord | null = null
        try {
          record = await this.dependencies.readConversation(workspace.workspaceId, summary.id)
          conversationsReadable += 1
        } catch {
          warnings.push(warning('source_scan_incomplete', 'A conversation record could not be read; a ledger fallback was attempted.', 'agent_conversations', { workspaceId: workspace.workspaceId, conversationId: summary.id }))
        }
        const conversationScan = record ? collectConversationTokenFacts(record, workspace.workspaceId, workspace.workspaceName, query.calendarContext.timeZone) : null
        if (conversationScan?.facts.length) {
          conversationsWithUsage += 1
          workspaceConversationFacts += conversationScan.facts.length
          facts.push(...conversationScan.facts)
          toolFacts.push(...conversationScan.toolNames)
          duplicateRuns += conversationScan.duplicateRuns
          componentMissing += conversationScan.componentMissing
          totalInconsistent += conversationScan.totalInconsistent
          governance.push(...conversationScan.governance)
          invalidTimestampTurns += conversationScan.invalidTimestampTurns
          if (conversationScan.missingUsageTurns > 0) {
            conversationsPartiallyMissingUsage += 1
            workspacePartialUsage = true
            warnings.push(warning('conversation_usage_partially_missing', 'Some assistant turns have no usable run usage; ledger data was not added.', 'agent_conversations', { workspaceId: workspace.workspaceId, conversationId: summary.id, missingTurns: conversationScan.missingUsageTurns }))
          }
          continue
        }
        const snapshot = ledger.latestByConversation.get(summary.id)
        if (snapshot) {
          const fact = ledgerSnapshotToFact(snapshot, workspace, query.calendarContext.timeZone)
          facts.push(fact)
          workspaceLedgerFacts += 1
          ledgerFallbackConversations += 1
          if (!snapshot.componentsComplete) componentMissing += 1
          if (snapshot.totalInconsistent) totalInconsistent += 1
          warnings.push(warning('ledger_fallback_used', 'Learning-work ledger usage was used because the conversation had no usable usage facts.', 'learning_work_ledger', { workspaceId: workspace.workspaceId, conversationId: summary.id }))
        } else {
          missingUsageConversations += 1
          warnings.push(warning('conversation_usage_missing', 'A conversation has no usable token usage in either the conversation record or its latest ledger snapshot.', 'agent_conversations', { workspaceId: workspace.workspaceId, conversationId: summary.id }))
        }
      }
      const conversationMissing = workspace.summary.conversations.length - workspaceConversationsScanned
      sourceRows.push({ source: 'agent_conversations', state: conversationMissing > 0 || workspacePartialUsage ? 'partial' : 'complete', scanned: workspace.summary.conversations.length, included: workspaceConversationFacts, missing: Math.max(0, conversationMissing), rejected: 0 })
      sourceRows.push({ source: 'learning_work_ledger', state: ledger.readError ? 'error' : ledger.invalid > 0 ? 'partial' : 'complete', scanned: ledger.scanned, included: workspaceLedgerFacts, missing: ledger.readError ? Math.max(0, workspace.summary.conversations.length - workspaceConversationFacts) : 0, rejected: ledger.invalid })
    }
    if (componentMissing > 0) warnings.push(warning('token_components_missing', 'Some usage facts provide only total tokens; prompt and completion components remain unknown.', 'agent_conversations', { facts: componentMissing }))
    if (totalInconsistent > 0) warnings.push(warning('token_total_inconsistent', 'Some source totals differ from prompt plus completion; source totals were preserved.', 'agent_conversations', { facts: totalInconsistent }))
    if (duplicateRuns > 0) warnings.push(warning('custom', 'Duplicate conversation run identities were ignored.', 'agent_conversations', { duplicateRuns }))
    if (invalidTimestampTurns > 0) warnings.push(warning('source_scan_incomplete', 'Some usage-bearing assistant turns had invalid timestamps and were ignored.', 'agent_conversations', { turns: invalidTimestampTurns }))
    warnings.push(warning('source_timezone_inferred', 'Conversation and ledger timestamps were bucketed in the query time zone.', 'agent_conversations', { timeZone: query.calendarContext.timeZone }))
    const rangedFacts = facts.filter((fact) => isDateInRange(fact.localDate, query.range))
    const data = aggregateTokenFacts(rangedFacts, toolFacts, { conversationsScanned, conversationsReadable, conversationsWithUsage, conversationsPartiallyMissingUsage, ledgerSnapshotsScanned, ledgerFallbackConversations, invalidLedgerRows, governance })
    const complete = workspaceErrors === 0 && ledgerReadErrors === 0 && invalidLedgerRows === 0 && missingUsageConversations === 0 && conversationsPartiallyMissingUsage === 0 && invalidTimestampTurns === 0
    const sectionCoverage = coverage(query, true, sourceRows, facts.map((fact) => fact.localDate), complete)
    const isPartial = !complete || componentMissing > 0 || totalInconsistent > 0
    if (selected.length > 0 && workspaceErrors === selected.length) {
      return { section: errorSection(queryTemporal(query), sectionCoverage, 'workspace_scan_failed', 'No selected Teaching workspace could be scanned.', true, warnings) }
    }
    const state = facts.length === 0 && conversationsScanned === 0 && workspaceErrors === 0 ? 'empty' : isPartial ? 'partial' : rangedFacts.length === 0 ? 'empty' : 'available'
    const section = state === 'empty'
      ? emptySection(queryTemporal(query), sectionCoverage, data, conversationsScanned === 0 ? 'scope_has_no_items' : 'no_matching_records', warnings)
      : state === 'partial' ? partialSection(queryTemporal(query), sectionCoverage, data, warnings) : availableSection(queryTemporal(query), sectionCoverage, data, warnings)
    return { section }
  }

  private async scanReview(query: LearningAnalyticsQuery, generatedAt: string, selected: AnalyticsWorkspaceScanResult[], inheritedWarnings: AnalyticsWarning[]): Promise<AnalyticsSectionResult<ReviewAnalytics>> {
    if (query.scope.teaching.kind === 'none') return unavailableSection(asOfTemporal(generatedAt), coverage(query, false, [], [], true), 'not_applicable', [])
    if (query.scope.teaching.kind === 'workspace' && selected.length === 0) return unavailableSection(asOfTemporal(generatedAt), coverage(query, false, [], [], false), 'no_active_workspace', [])
    const warnings = [...inheritedWarnings, warning('review_history_missing', 'Review progress is cumulative; range accuracy is unavailable until timestamped review facts are recorded.', 'review_progress')]
    let totalAnswered = 0
    let correct = 0
    let cardCount = 0
    let failures = 0
    const byLesson = new Map<string, { title?: string; answered: number; correct: number; reviewCardCount: number }>()
    const sources: AnalyticsSourceCoverage[] = []
    for (const workspace of selected) {
      if (!workspace.summary) { failures += 1; continue }
      const [progressResult, cardsResult] = await Promise.allSettled([this.dependencies.getProgress(workspace.workspaceId), this.dependencies.listReviewCards(workspace.workspaceId)])
      if (progressResult.status === 'fulfilled') {
        totalAnswered += progressResult.value.progress.totalAnswered
        correct += progressResult.value.progress.correct
        for (const [lessonId, progress] of Object.entries(progressResult.value.progress.byLesson)) {
          const key = `${workspace.workspaceId}:${lessonId}`
          const current = byLesson.get(key) ?? { answered: 0, correct: 0, reviewCardCount: 0 }
          current.answered += progress.answered
          current.correct += progress.correct
          byLesson.set(key, current)
        }
      } else failures += 1
      if (cardsResult.status === 'fulfilled') {
        cardCount += cardsResult.value.cards.length
        for (const card of cardsResult.value.cards) {
          const key = `${workspace.workspaceId}:${card.lessonId}`
          const current = byLesson.get(key) ?? { answered: 0, correct: 0, reviewCardCount: 0 }
          current.title ||= card.lessonTitle
          current.reviewCardCount += 1
          byLesson.set(key, current)
        }
      } else failures += 1
      sources.push({ source: 'review_progress', state: progressResult.status === 'fulfilled' ? 'complete' : 'error', scanned: 1, included: progressResult.status === 'fulfilled' ? 1 : 0, missing: 0, rejected: progressResult.status === 'rejected' ? 1 : 0 })
      sources.push({ source: 'review_cards', state: cardsResult.status === 'fulfilled' ? 'complete' : 'error', scanned: 1, included: cardsResult.status === 'fulfilled' ? cardsResult.value.cards.length : 0, missing: 0, rejected: cardsResult.status === 'rejected' ? 1 : 0 })
    }
    const data: ReviewAnalytics = {
      cumulative: { totalAnswered, correct, accuracy: totalAnswered > 0 ? correct / totalAnswered : null, cardCount },
      range: { answered: null, correct: null, accuracy: null },
      byLesson: [...byLesson.entries()].map(([lessonId, item]) => ({ lessonId, ...(item.title ? { title: item.title } : {}), answered: item.answered, correct: item.correct, accuracy: item.answered > 0 ? item.correct / item.answered : null, reviewCardCount: item.reviewCardCount })).sort((a, b) => b.answered - a.answered || b.reviewCardCount - a.reviewCardCount)
    }
    const sectionCoverage = coverage(query, false, sources, [], failures === 0)
    if (failures > 0) warnings.push(warning('source_scan_incomplete', 'Some workspace review sources could not be read.', 'review_progress', { failures }))
    const temporal = mixedTemporal(query, generatedAt, [], ['cumulative', 'byLesson'])
    if (failures > 0 && totalAnswered === 0 && cardCount === 0) return errorSection(temporal, sectionCoverage, 'review_sources_failed', 'Review sources could not be read.', true, warnings)
    if (totalAnswered === 0 && cardCount === 0 && failures === 0) return emptySection(temporal, sectionCoverage, data, 'no_activity', warnings)
    if (failures > 0) return partialSection(temporal, sectionCoverage, data, warnings)
    return availableSection(temporal, sectionCoverage, data, warnings)
  }
  private async scanMemory(query: LearningAnalyticsQuery, generatedAt: string, selected: AnalyticsWorkspaceScanResult[], inheritedWarnings: AnalyticsWarning[]): Promise<AnalyticsSectionResult<MemoryAnalytics>> {
    if (query.scope.teaching.kind === 'none') return unavailableSection(asOfTemporal(generatedAt), coverage(query, false, [], [], true), 'not_applicable', [])
    if (query.scope.teaching.kind === 'workspace' && selected.length === 0) return unavailableSection(asOfTemporal(generatedAt), coverage(query, false, [], [], false), 'no_active_workspace', [])
    const warnings = [...inheritedWarnings]
    const roots = selected.filter((item) => item.summary).map((item) => item.rootPath)
    const memoryResults = await Promise.allSettled((roots.length ? roots : [undefined]).map((root) => this.dependencies.listMemory(root)))
    const diagnosticsResult = await Promise.allSettled([this.dependencies.getMemoryDiagnostics()])
    const records = new Map<string, TeachingMemoryRecord>()
    let failures = 0
    for (const result of memoryResults) {
      if (result.status === 'rejected') { failures += 1; continue }
      for (const record of result.value) records.set(record.id, record)
    }
    const diagnostics = diagnosticsResult[0].status === 'fulfilled' ? diagnosticsResult[0].value : null
    if (!diagnostics) failures += 1
    if (!diagnostics) {
      const sources: AnalyticsSourceCoverage[] = [{ source: 'memory_store', state: 'error', scanned: memoryResults.length, included: records.size, missing: 1, rejected: failures }]
      const sectionCoverage = coverage(query, false, sources, [...records.values()].map((record) => dateToLocalKey(new Date(record.updatedAt), query.calendarContext.timeZone)), false)
      warnings.push(warning('source_scan_incomplete', 'Memory diagnostics could not be read; memory tombstone coverage is unavailable.', 'memory_store'))
      return errorSection(asOfTemporal(generatedAt), sectionCoverage, 'memory_diagnostics_failed', 'Memory analytics could not be completed.', true, warnings)
    }
    const active = [...records.values()].filter((record) => !record.deletedAt && !record.disabledAt)
    const byScope = (['user', 'workspace', 'project'] as const).map((scope) => ({ scope, count: active.filter((record) => record.scope === scope).length }))
    const tags = new Map<string, number>()
    for (const record of active) for (const tag of record.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1)
    const buckets = [{ fromInclusive: 0, toInclusive: 0.25, count: 0 }, { fromInclusive: 0.25, toInclusive: 0.5, count: 0 }, { fromInclusive: 0.5, toInclusive: 0.75, count: 0 }, { fromInclusive: 0.75, toInclusive: 1, count: 0 }]
    for (const record of active) buckets[record.confidence >= 0.75 ? 3 : record.confidence >= 0.5 ? 2 : record.confidence >= 0.25 ? 1 : 0].count += 1
    const data: MemoryAnalytics = {
      activeCount: active.length,
      tombstoneCount: diagnostics?.tombstoneCount ?? 0,
      byScope,
      topTags: [...tags.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 20),
      confidenceBuckets: buckets,
      recentlyUpdated: active.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12).map((record) => ({ id: record.id, scope: record.scope, tags: record.tags, confidence: record.confidence, updatedAt: record.updatedAt }))
    }
    const sources: AnalyticsSourceCoverage[] = [{ source: 'memory_store', state: failures ? 'partial' : 'complete', scanned: memoryResults.length, included: active.length, missing: diagnostics ? 0 : 1, rejected: failures }]
    const sectionCoverage = coverage(query, false, sources, active.map((record) => dateToLocalKey(new Date(record.updatedAt), query.calendarContext.timeZone)), failures === 0)
    if (!diagnostics) warnings.push(warning('source_scan_incomplete', 'Memory diagnostics could not be read; tombstone coverage is incomplete.', 'memory_store'))
    if (query.scope.teaching.kind === 'workspace' && diagnostics) warnings.push(warning('custom', 'Memory tombstone count is application-wide because deleted records are not exposed by workspace scope.', 'memory_store'))
    if (failures > 0) return partialSection(asOfTemporal(generatedAt), sectionCoverage, data, warnings)
    if (data.activeCount === 0 && data.tombstoneCount === 0) return emptySection(asOfTemporal(generatedAt), sectionCoverage, data, 'no_activity', warnings)
    return availableSection(asOfTemporal(generatedAt), sectionCoverage, data, warnings)
  }

  private async scanPlatform(query: LearningAnalyticsQuery, generatedAt: string, header: ScanHeader): Promise<AnalyticsSectionResult<PlatformAnalytics>> {
    const warnings = [...header.warnings]
    const settings = header.settings
    const skills = header.skills
    let changes: TeachingWorkspaceChangeSummary[] = []
    let changeFailures = 0
    if (this.dependencies.listWorkspaceChanges) {
      const results = await Promise.allSettled(header.selected.filter((item) => item.summary).map((item) => this.dependencies.listWorkspaceChanges!(item.workspaceId)))
      for (const result of results) result.status === 'fulfilled' ? changes.push(...result.value) : changeFailures++
    } else warnings.push(warning('source_not_configured', 'Workspace change history is not connected to analytics.', 'workspace_change_history'))
    const rangedChanges = changes.filter((change) => isDateInRange(dateToLocalKey(new Date(change.timestamp), query.calendarContext.timeZone), query.range))
    const changesByDay = new Map<string, number>()
    for (const change of rangedChanges) { const date = dateToLocalKey(new Date(change.timestamp), query.calendarContext.timeZone); changesByDay.set(date, (changesByDay.get(date) ?? 0) + 1) }
    if (!settings || !skills) {
      const sources: AnalyticsSourceCoverage[] = [
        { source: 'settings', state: settings ? 'complete' : 'error', scanned: 1, included: settings ? 1 : 0, missing: settings ? 0 : 1, rejected: 0 },
        { source: 'skill_catalog', state: skills ? 'complete' : 'error', scanned: skills?.skills.length ?? 0, included: 0, missing: skills ? 0 : 1, rejected: 0 },
        { source: 'workspace_change_history', state: this.dependencies.listWorkspaceChanges ? (changeFailures ? 'partial' : 'complete') : 'unavailable', scanned: changes.length + changeFailures, included: rangedChanges.length, missing: changeFailures, rejected: 0 }
      ]
      const sectionCoverage = coverage(query, true, sources, changes.map((change) => dateToLocalKey(new Date(change.timestamp), query.calendarContext.timeZone)), false)
      return errorSection(mixedTemporal(query, generatedAt, ['workspaceChanges'], ['skills', 'pet', 'model', 'connectors']), sectionCoverage, 'platform_sources_failed', 'Platform analytics sources could not be read.', true, warnings)
    }
    const installedSkills = skills.skills.filter((skill) => skill.installed)
    const byCategory = new Map<string, number>()
    for (const skill of installedSkills) byCategory.set(skill.category, (byCategory.get(skill.category) ?? 0) + 1)
    const provider = settings.provider.providers.find((item) => item.id === settings.generator.providerId)
    const data: PlatformAnalytics = {
      skills: { installed: installedSkills.length, byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count), usedInRange: null },
      pet: { appearanceId: settings?.pet.appearance ?? 'unknown', plantStage: 'unknown' },
      model: { providerLabel: provider?.name ?? settings?.generator.providerId ?? 'unknown', modelLabel: settings?.generator.model ?? 'unknown', lessonRunsInRange: null, failedLessonRunsInRange: null },
      workspaceChanges: { changesInRange: this.dependencies.listWorkspaceChanges ? rangedChanges.length : null, byDay: [...changesByDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)) },
      connectors: (header.connectorStatuses?.connectors ?? []).map((connector) => ({ id: connector.id, configured: connector.state !== 'missing_config' && connector.state !== 'missing_dependency', usedInRange: null }))
    }
    const sources: AnalyticsSourceCoverage[] = [
      { source: 'settings', state: settings ? 'complete' : 'error', scanned: 1, included: settings ? 1 : 0, missing: settings ? 0 : 1, rejected: 0 },
      { source: 'skill_catalog', state: skills ? 'complete' : 'error', scanned: skills?.skills.length ?? 0, included: installedSkills.length, missing: skills ? 0 : 1, rejected: 0 },
      { source: 'workspace_change_history', state: this.dependencies.listWorkspaceChanges ? (changeFailures ? 'partial' : 'complete') : 'unavailable', scanned: changes.length + changeFailures, included: rangedChanges.length, missing: changeFailures, rejected: 0 }
    ]
    warnings.push(warning('source_not_configured', 'Skill usage, lesson-run history, connector usage, and plant growth history are not timestamped; their range metrics remain unavailable.', 'settings'))
    if (changeFailures) warnings.push(warning('source_scan_incomplete', 'Some workspace change histories could not be read.', 'workspace_change_history', { failures: changeFailures }))
    const complete = Boolean(settings && skills && this.dependencies.listWorkspaceChanges && changeFailures === 0)
    const sectionCoverage = coverage(query, true, sources, changes.map((change) => dateToLocalKey(new Date(change.timestamp), query.calendarContext.timeZone)), complete)
    const temporal = mixedTemporal(query, generatedAt, ['workspaceChanges'], ['skills', 'pet', 'model', 'connectors'])
    if (!complete) return partialSection(temporal, sectionCoverage, data, warnings)
    return availableSection(temporal, sectionCoverage, data, warnings)
  }

  private pruneCache(): void {
    if (this.cache.size <= CACHE_LIMIT) return
    const oldest = [...this.cache.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)
    for (const [key] of oldest.slice(0, this.cache.size - CACHE_LIMIT)) this.cache.delete(key)
  }
  private now(): Date { return this.dependencies.now?.() ?? new Date() }
  private localTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
}

export function collectConversationTokenFacts(
  record: AgentConversationRecord,
  workspaceId: string,
  workspaceName: string,
  timeZone: string
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
    const dedupeKey = `${workspaceId}:${record.id}:${turn.id}`
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
      conversationKey: `${workspaceId}:${record.id}`,
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
  let content = ''
  let readError = false
  try {
    content = await readFile(join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH), 'utf8')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined
    readError = code !== 'ENOENT'
  }
  const latestByConversation = new Map<string, LedgerSnapshot>(); let scanned = 0, invalid = 0
  for (const line of content.split(/\r?\n/)) { if (!line.trim()) continue; scanned++; const snapshot = parseLedgerSnapshot(line); if (!snapshot) { invalid++; continue }; const previous = latestByConversation.get(snapshot.conversationId); if (!previous || compareSnapshot(snapshot, previous) > 0) latestByConversation.set(snapshot.conversationId, snapshot) }
  return { latestByConversation, scanned, invalid, readError }
}

export function createSafeAnalyticsExport(bundle: LearningAnalyticsBundle, request: AnalyticsExportRequest): AnalyticsPreparedExport {
  const generatedAt = new Date().toISOString()
  const manifest: AnalyticsExportManifest = { contractVersion: CONTRACT_VERSION, generatedAt, format: request.format, detail: request.detail, includedSections: [...new Set(request.sectionIds)], excludedSensitiveFields: ['conversation_content', 'mission_content', 'memory_content', 'tool_arguments', 'tool_results', 'absolute_paths', 'api_keys', 'secret_endpoints'] }
  const sections = Object.fromEntries(manifest.includedSections.map((sectionId) => [sectionId, sanitizeExportValue(sectionForId(bundle, sectionId), request.detail)]))
  const safe = sanitizeExportValue({ contractVersion: bundle.contractVersion, generatedAt: bundle.generatedAt, query: bundle.query, manifest, sections }, request.detail)
  const stem = `studiumx-learning-analytics-${bundle.query.range.from}-${bundle.query.range.to}-${request.detail}`
  if (request.format === 'json') return { fileName: `${stem}.json`, content: `${JSON.stringify(safe, null, 2)}\n`, manifest }
  const rows = [['section', 'state', 'payload_json']]
  for (const sectionId of manifest.includedSections) { const section = (sections as Record<string, unknown>)[sectionId] as { state?: unknown } | undefined; rows.push([sectionId, typeof section?.state === 'string' ? section.state : '', JSON.stringify(section ?? null)]) }
  return { fileName: `${stem}.csv`, content: `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`, manifest }
}

export function validateLearningAnalyticsQuery(query: LearningAnalyticsQuery): void {
  if (!query || typeof query !== 'object') throw new Error('Learning analytics query is required.')
  if (!isLocalDate(query.calendarContext?.localToday) || !isValidTimeZone(query.calendarContext?.timeZone)) throw new Error('Analytics calendar context is invalid.')
  if (query.calendarContext.weekStartsOn !== 1 || query.range.weekStartsOn !== 1 || query.range.calendar !== 'local_gregorian' || query.range.fromInclusive !== true || query.range.toInclusive !== true) throw new Error('Analytics range semantics are invalid.')
  if (!isLocalDate(query.range.from) || !isLocalDate(query.range.to) || query.range.from > query.range.to || query.range.to > query.calendarContext.localToday) throw new Error('Analytics date range is invalid.')
  if (!['personal', 'none'].includes(query.scope.personalFocus?.kind)) throw new Error('Personal analytics scope is invalid.')
  if (query.scope.personalFocus.kind === 'personal' && !cleanString(query.scope.personalFocus.clientId)) throw new Error('Personal analytics scope is invalid.')
  if (!['none', 'workspace', 'all_workspaces'].includes(query.scope.teaching?.kind)) throw new Error('Teaching analytics scope is invalid.')
  if (query.scope.teaching.kind === 'workspace' && !cleanString(query.scope.teaching.workspaceId)) throw new Error('Teaching workspace scope is invalid.')
  if (query.scope.teaching.kind === 'all_workspaces' && !Array.isArray(query.scope.teaching.workspaceIds)) throw new Error('Teaching workspace scope is invalid.')
  if (!['none', 'live_space'].includes(query.scope.presence?.kind)) throw new Error('Presence analytics scope is invalid.')
  if (query.scope.presence.kind === 'live_space' && !cleanString(query.scope.presence.spaceCode)) throw new Error('Presence analytics scope is invalid.')
}
export function validateAnalyticsExportRequest(request: AnalyticsExportRequest): void { if (!request || !['json', 'csv'].includes(request.format) || !['summary', 'detailed'].includes(request.detail) || !Array.isArray(request.sectionIds)) throw new Error('Analytics export request is invalid.'); validateLearningAnalyticsQuery(request.query); const allowed = new Set<AnalyticsSectionId>(['hero', 'focus', 'tasks', 'tokens', 'workspace_assets', 'review', 'memory', 'platform', 'presence', 'insights']); if (request.sectionIds.some((id) => !allowed.has(id))) throw new Error('Analytics export contains an unknown section.') }
export function validateClearAnalyticsRequest(request: ClearAnalyticsRequest): void { if (!request || request.confirmed !== true || !Array.isArray(request.targets)) throw new Error('Analytics clear request must be confirmed.'); const allowed = new Set(['derived_cache', 'personal_activity_history', 'analytics_preferences']); if (request.targets.some((target) => !allowed.has(target))) throw new Error('Analytics clear target is invalid.') }

function buildWorkspaceAssetsSection(query: LearningAnalyticsQuery, generatedAt: string, selected: AnalyticsWorkspaceScanResult[], inheritedWarnings: AnalyticsWarning[]): AnalyticsSectionResult<WorkspaceAssetsAnalytics> {
  if (query.scope.teaching.kind === 'none') return unavailableSection(asOfTemporal(generatedAt), coverage(query, false, [], [], true), 'not_applicable', [])
  if (query.scope.teaching.kind === 'workspace' && selected.length === 0) return unavailableSection(asOfTemporal(generatedAt), coverage(query, false, [], [], false), 'no_active_workspace', [])
  const warnings = [...inheritedWarnings], workspaces = selected.flatMap((item) => item.summary ? [item.summary] : []), failed = selected.filter((item) => !item.summary)
  if (failed.length) warnings.push(warning('source_scan_incomplete', 'Some workspace asset catalogs could not be read.', 'workspace_catalog', { failures: failed.length }))
  const conversations = workspaces.flatMap((workspace) => workspace.conversations)
  const courses = workspaces.flatMap((workspace) => workspace.courses.map((course) => ({ workspaceId: workspace.id, courseId: course.id, name: course.name, sessionCount: course.sessionCount, lessonCount: course.lessonCount, conversationCount: course.conversations.length, pinned: Boolean(course.conversations.some((conversation) => conversation.pinned)), updatedAt: latestString(course.conversations.map((conversation) => conversation.updatedAt)) ?? latestString(course.sessions.map((session) => session.lesson.createdAt)) })))
  const data: WorkspaceAssetsAnalytics = { counts: { workspaces: workspaces.length, courses: sum(workspaces.map((workspace) => workspace.courses.length)), sessions: sum(workspaces.flatMap((workspace) => workspace.courses.map((course) => course.sessionCount))), lessons: sum(workspaces.map((workspace) => workspace.lessons.length)), resources: sum(workspaces.map((workspace) => workspace.resources.length)), learningRecords: sum(workspaces.map((workspace) => workspace.records.length)), references: sum(workspaces.map((workspace) => workspace.referenceCount)), conversations: new Set(conversations.map((conversation) => `${conversation.workspaceId ?? ''}:${conversation.id}`)).size }, courses, recentLessons: workspaces.flatMap((workspace) => workspace.lessons.map((lesson) => ({ workspaceId: workspace.id, lessonId: lesson.id, title: lesson.title, courseName: lesson.courseName, createdAt: lesson.createdAt, durationMinutes: lesson.durationMinutes }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20), missionHealth: workspaces.map((workspace) => ({ workspaceId: workspace.id, hasMission: Boolean(workspace.missionTitle && workspace.missionExcerpt && workspace.missionExcerpt !== '等待补充学习使命。'), title: workspace.missionTitle, excerptLength: workspace.missionExcerpt.length, updatedAt: workspace.updatedAt })) }
  const dates = workspaces.flatMap((workspace) => [workspace.createdAt, workspace.updatedAt, ...workspace.lessons.map((lesson) => lesson.createdAt)]).map((value) => dateToLocalKey(new Date(value), query.calendarContext.timeZone))
  const sources: AnalyticsSourceCoverage[] = [{ source: 'workspace_catalog', state: failed.length ? 'partial' : 'complete', scanned: selected.length, included: workspaces.length, missing: failed.length, rejected: 0 }]
  const sectionCoverage = coverage(query, false, sources, dates, failed.length === 0)
  if (workspaces.length === 0 && failed.length > 0) return errorSection(asOfTemporal(generatedAt), sectionCoverage, 'workspace_scan_failed', 'The selected Teaching workspace could not be scanned.', true, warnings)
  if (workspaces.length === 0) return emptySection(asOfTemporal(generatedAt), sectionCoverage, data, 'scope_has_no_items', warnings)
  return failed.length ? partialSection(asOfTemporal(generatedAt), sectionCoverage, data, warnings) : availableSection(asOfTemporal(generatedAt), sectionCoverage, data, warnings)
}
function buildInsightsSection(query: LearningAnalyticsQuery, generatedAt: string, tokens: AnalyticsSectionResult<TokenAnalytics>, assets: AnalyticsSectionResult<WorkspaceAssetsAnalytics>, review: AnalyticsSectionResult<ReviewAnalytics>, memory: AnalyticsSectionResult<MemoryAnalytics>, platform: AnalyticsSectionResult<PlatformAnalytics>): AnalyticsSectionResult<{ items: Array<{ id: string; kind: 'observation' | 'warning' | 'action'; text: string; explanation: string; evidenceSectionIds: AnalyticsSectionId[] }> }> {
  const items: Array<{ id: string; kind: 'observation' | 'warning' | 'action'; text: string; explanation: string; evidenceSectionIds: AnalyticsSectionId[] }> = []
  if ('data' in tokens && tokens.data.totals.totalTokens > 0) items.push({ id: 'token-usage-observed', kind: 'observation', text: 'Teaching conversations used model tokens in the selected range.', explanation: `${tokens.data.totals.totalTokens} total tokens were recorded from deduplicated conversation usage facts.`, evidenceSectionIds: ['tokens'] })
  if ('data' in review && review.data.cumulative.totalAnswered > 0 && review.data.cumulative.accuracy !== null) items.push({ id: 'review-current-accuracy', kind: 'observation', text: 'Current cumulative review accuracy is available.', explanation: 'This is a current cumulative snapshot because timestamped review facts are not yet recorded.', evidenceSectionIds: ['review'] })
  if ('data' in assets && assets.data.counts.workspaces > 0 && assets.data.counts.conversations === 0) items.push({ id: 'workspace-no-conversations', kind: 'action', text: 'No Teaching conversations are available for token analysis.', explanation: 'Start an Agent conversation in a Teaching workspace to populate token analytics.', evidenceSectionIds: ['workspace_assets', 'tokens'] })
  const sections = [tokens, assets, review, memory, platform]
  const warningCount = sections.reduce((total, section) => total + section.warnings.filter((item) => item.severity === 'warning').length, 0)
  if (warningCount > 0) items.push({ id: 'coverage-warnings', kind: 'warning', text: 'Some analytics sources are incomplete.', explanation: 'Review section coverage details before interpreting missing values as zero.', evidenceSectionIds: ['tokens', 'workspace_assets', 'review', 'memory', 'platform'] })
  const combinedWarnings = dedupeWarnings(sections.flatMap((section) => section.warnings))
  const combinedSources = sections.flatMap((section) => section.coverage.sources)
  const sectionCoverage = coverage(query, false, combinedSources, [], sections.every((section) => section.coverage.complete))
  const data = { items }
  return items.length ? (sectionCoverage.complete ? availableSection(asOfTemporal(generatedAt), sectionCoverage, data, combinedWarnings) : partialSection(asOfTemporal(generatedAt), sectionCoverage, data, combinedWarnings)) : emptySection(asOfTemporal(generatedAt), sectionCoverage, data, 'no_activity', combinedWarnings)
}

function selectWorkspaceScans(query: LearningAnalyticsQuery, workspaces: AnalyticsWorkspaceScanResult[]): AnalyticsWorkspaceScanResult[] {
  if (query.scope.teaching.kind === 'none') return []
  if (query.scope.teaching.kind === 'workspace') {
    const workspaceId = query.scope.teaching.workspaceId
    return workspaces.filter((workspace) => workspace.workspaceId === workspaceId)
  }
  const requested = new Set(query.scope.teaching.workspaceIds)
  return requested.size ? workspaces.filter((workspace) => requested.has(workspace.workspaceId)) : workspaces
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

function ledgerSnapshotToFact(snapshot: LedgerSnapshot, workspace: AnalyticsWorkspaceScanResult, timeZone: string): InternalTokenUsageFact {
  return { source: 'ledger_fallback', dedupeKey: `${workspace.workspaceId}:${snapshot.conversationId}:ledger:${snapshot.occurredAt}:${snapshot.ledgerCreatedAt}`, conversationKey: `${workspace.workspaceId}:${snapshot.conversationId}`, conversationId: snapshot.conversationId, conversationTitle: snapshot.title, workspaceId: workspace.workspaceId, workspaceName: workspace.workspaceName, ...(snapshot.courseRelativePath ? { courseRelativePath: snapshot.courseRelativePath } : {}), occurredAt: snapshot.occurredAt, localDate: dateToLocalKey(new Date(snapshot.occurredAt), timeZone), localDateSource: 'query_timezone', usage: snapshot.usage, componentsComplete: snapshot.componentsComplete, messageCount: snapshot.messageCount }
}

function normalizeUsage(raw: unknown): { usage: TokenUsageNumbers; componentsComplete: boolean; totalInconsistent: boolean } | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>, promptTokens = finiteNonNegative(value.promptTokens), completionTokens = finiteNonNegative(value.completionTokens), sourceTotal = finiteNonNegative(value.totalTokens), derivedTotal = promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null, totalTokens = sourceTotal ?? derivedTotal
  if (totalTokens === null) return null
  const stop = ['duration', 'provider_calls', 'tool_calls', 'total_tokens'].includes(String(value.budgetStopReason)) ? value.budgetStopReason as TokenUsageNumbers['budgetStopReason'] : undefined
  return { usage: { ...(promptTokens !== null ? { promptTokens } : {}), ...(completionTokens !== null ? { completionTokens } : {}), totalTokens, providerCalls: finiteNonNegative(value.providerCalls) ?? 0, toolCalls: finiteNonNegative(value.toolCalls) ?? 0, toolErrors: finiteNonNegative(value.toolErrors) ?? 0, iterations: finiteNonNegative(value.iterations) ?? 0, childRuns: finiteNonNegative(value.childRuns) ?? 0, durationMs: finiteNonNegative(value.durationMs) ?? 0, ...(stop ? { budgetStopReason: stop } : {}) }, componentsComplete: promptTokens !== null && completionTokens !== null, totalInconsistent: sourceTotal !== null && derivedTotal !== null && sourceTotal !== derivedTotal }
}

function coverage(query: LearningAnalyticsQuery, rangeApplied: boolean, sources: AnalyticsSourceCoverage[], dates: AnalyticsLocalDate[], complete: boolean): AnalyticsCoverage {
  const validDates = dates.filter(isLocalDate).sort(), cutoffDate = addLocalDays(query.calendarContext.localToday, -(RETENTION_DAYS - 1))
  return { rangeApplied, requestedRange: query.range, effectiveRange: rangeApplied ? query.range : null, trackingStartedOn: null, dataStartDate: validDates[0] ?? null, dataEndDate: validDates[validDates.length - 1] ?? null, retention: { policy: 'rolling_local_days', days: RETENTION_DAYS, includesToday: true, cutoffDate }, complete, sources }
}
function availableSection<T>(temporal: AnalyticsTemporalBasis, sectionCoverage: AnalyticsCoverage, data: T, warnings: AnalyticsWarning[]): AnalyticsSectionResult<T> { return { state: 'available', temporal, coverage: sectionCoverage, warnings: dedupeWarnings(warnings), data } }
function emptySection<T>(temporal: AnalyticsTemporalBasis, sectionCoverage: AnalyticsCoverage, data: T, reason: 'no_activity' | 'no_matching_records' | 'not_started' | 'scope_has_no_items', warnings: AnalyticsWarning[]): AnalyticsSectionResult<T> { return { state: 'empty', temporal, coverage: sectionCoverage, warnings: dedupeWarnings(warnings), data, reason } }
function partialSection<T>(temporal: AnalyticsTemporalBasis, sectionCoverage: AnalyticsCoverage, data: T, warnings: AnalyticsWarning[]): AnalyticsSectionResult<T> { return { state: 'partial', temporal, coverage: { ...sectionCoverage, complete: false }, warnings: dedupeWarnings(warnings), data } }
function unavailableSection<T>(temporal: AnalyticsTemporalBasis, sectionCoverage: AnalyticsCoverage, reason: 'not_applicable' | 'not_configured' | 'no_active_workspace' | 'permission_denied' | 'history_not_recorded' | 'source_missing' | 'unsupported', warnings: AnalyticsWarning[]): AnalyticsSectionResult<T> { return { state: 'unavailable', temporal, coverage: sectionCoverage, warnings: dedupeWarnings(warnings), reason } }
function errorSection<T>(temporal: AnalyticsTemporalBasis, sectionCoverage: AnalyticsCoverage, code: string, message: string, retryable: boolean, warnings: AnalyticsWarning[]): AnalyticsSectionResult<T> { return { state: 'error', temporal, coverage: { ...sectionCoverage, complete: false }, warnings: dedupeWarnings(warnings), error: { code, message, retryable } } }
function queryTemporal(query: LearningAnalyticsQuery): AnalyticsTemporalBasis { return { kind: 'range', range: query.range } }
function asOfTemporal(asOf: string): AnalyticsTemporalBasis { return { kind: 'as_of', asOf, rangeInvariant: true } }
function liveTemporal(capturedAt: string): AnalyticsTemporalBasis { return { kind: 'live_snapshot', capturedAt, rangeInvariant: true, staleAfterSeconds: 30 } }
function mixedTemporal(query: LearningAnalyticsQuery, asOf: string, rangeFields: string[], rangeInvariantFields: string[]): AnalyticsTemporalBasis { return { kind: 'mixed', range: query.range, asOf, rangeFields, rangeInvariantFields } }
function warning(code: AnalyticsWarning['code'], message: string, source?: AnalyticsWarning['source'], details?: AnalyticsWarning['details']): AnalyticsWarning { return { code, severity: code === 'source_timezone_inferred' || code === 'ledger_fallback_used' ? 'info' : 'warning', message, ...(source ? { source } : {}), ...(details ? { details } : {}) } }
function dedupeWarnings(warnings: AnalyticsWarning[]): AnalyticsWarning[] { const seen = new Set<string>(); return warnings.filter((item) => { const key = stableJson(item); if (seen.has(key)) return false; seen.add(key); return true }) }
function dateToLocalKey(date: Date, timeZone: string): AnalyticsLocalDate {
  if (Number.isNaN(date.getTime())) return '0001-01-01'
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value, month = parts.find((part) => part.type === 'month')?.value, day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : '0001-01-01'
}
function addLocalDays(date: string, days: number): string { const [year, month, day] = date.split('-').map(Number), value = new Date(Date.UTC(year, month - 1, day)); value.setUTCDate(value.getUTCDate() + days); return `${value.getUTCFullYear().toString().padStart(4, '0')}-${(value.getUTCMonth() + 1).toString().padStart(2, '0')}-${value.getUTCDate().toString().padStart(2, '0')}` }
function isDateInRange(date: string, range: AnalyticsDateRange): boolean { return date >= range.from && date <= range.to }
function isLocalDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) }
function isValidTimeZone(value: unknown): value is string { try { if (typeof value !== 'string' || !value) return false; new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }
function validInstant(value: unknown): string | null { if (typeof value !== 'string') return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString() }
function cleanString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function cleanLabel(value: unknown, fallback: string): string { return cleanString(value)?.slice(0, 160) ?? fallback }
function finiteNonNegative(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null }
function internalMessageCount(fact: TokenUsageFact): number { return finiteNonNegative((fact as Partial<InternalTokenUsageFact>).messageCount) ?? 0 }
function objectValue(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function coursePath(relativePath: string): string | undefined { const normalized = relativePath.replace(/\\/g, '/'), marker = '/conversations/', index = normalized.lastIndexOf(marker); return index > 0 ? normalized.slice(0, index) : undefined }
function compareSnapshot(left: LedgerSnapshot, right: LedgerSnapshot): number { return left.occurredAt.localeCompare(right.occurredAt) || left.ledgerCreatedAt.localeCompare(right.ledgerCreatedAt) }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0) }
function latestString(values: Array<string | undefined>): string | undefined { return values.filter((value): value is string => Boolean(value)).sort().at(-1) }
function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void { const current = map.get(key) ?? []; current.push(value); map.set(key, current) }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function stableJson(value: unknown): string { return JSON.stringify(sortJson(value)) }
function sortJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortJson); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortJson(nested)])) }
function normalizeLearningAnalyticsRequest(value: LearningAnalyticsRequest | LearningAnalyticsQuery): LearningAnalyticsRequest {
  if (value && typeof value === 'object' && 'query' in value && (value as { query?: unknown }).query) {
    const request = value as LearningAnalyticsRequest
    return { query: request.query, ...(request.personalStudy === undefined ? {} : { personalStudy: request.personalStudy }) }
  }
  return { query: value as LearningAnalyticsQuery }
}
function personalCacheFingerprint(validation: PersonalStudySnapshotValidation): unknown {
  if (validation.state !== 'valid') return { state: validation.state, identity: validation.cacheIdentity }
  const { snapshot } = validation
  return {
    state: validation.state,
    identity: validation.cacheIdentity,
    clientId: snapshot.clientId,
    trackingStartedOn: snapshot.trackingStartedOn,
    facts: snapshot.facts,
    current: snapshot.current,
    diagnostics: snapshot.diagnostics
  }
}
async function collectPathVersions(paths: string[]): Promise<Array<{ pathKey: string; version: string }>> { const results = await Promise.all(paths.map(async (path) => ({ pathKey: digest(path), version: await pathVersion(path) }))); return results.sort((a, b) => a.pathKey.localeCompare(b.pathKey)) }
async function pathVersion(path: string): Promise<string> { const info = await stat(path).catch(() => null); if (!info) return 'missing'; if (info.isFile()) return `${info.size}:${info.mtimeMs}`; if (!info.isDirectory()) return `other:${info.mtimeMs}`; const entries = await readdir(path, { withFileTypes: true }).catch(() => []); const nested = await Promise.all(entries.slice(0, 1000).map(async (entry) => { const childInfo = await stat(join(path, entry.name)).catch(() => null); return `${entry.name}:${childInfo?.size ?? -1}:${childInfo?.mtimeMs ?? -1}` })); return digest(nested.sort().join('|')) }
async function safeRemove(path: string): Promise<void> { await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }) }
function sectionForId(bundle: LearningAnalyticsBundle, id: AnalyticsSectionId): unknown { if (id === 'workspace_assets') return bundle.workspaceAssets; return bundle[id] }
function sanitizeExportValue(value: unknown, detail: 'summary' | 'detailed', key = ''): unknown {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, ''), forbidden = ['content', 'arguments', 'toolresults', 'toolresult', 'absolutepath', 'rootpath', 'missionexcerpt', 'apikey', 'proxyurl', 'endpoint', 'secret']
  if (forbidden.some((part) => normalizedKey.includes(part))) return undefined
  if (detail === 'summary' && ['title', 'name', 'workspacename', 'coursename', 'label', 'text', 'explanation'].includes(normalizedKey)) return undefined
  if (Array.isArray(value)) return value.map((item) => sanitizeExportValue(item, detail, key)).filter((item) => item !== undefined)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) => { const sanitized = sanitizeExportValue(child, detail, childKey); return sanitized === undefined ? [] : [[childKey, sanitized]] }))
}
function csvCell(value: string): string { return `"${value.replace(/"/g, '""')}"` }
