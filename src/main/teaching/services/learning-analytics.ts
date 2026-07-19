import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalDataIndex, LocalDataIndexTokenEvidenceAdapters } from '../../local-data-index'
import {
  LearningAnalyticsSourcePlan,
  type LearningAnalyticsInvalidation,
  type SourcePlanReport
} from './analytics/source-plan'
import type {
  AgentConversationRecord,
  AgentConversationSummary,
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
  WorkspaceAssetsAnalytics
} from '../../../shared/teaching-types'
import { agentConversationJsonRelativePathForMarkdown } from '../../../shared/agent-conversation-catalog'
import { LEARNING_WORK_LEDGER_RELATIVE_PATH } from '../../learning-work-ledger'
import {
  aggregateTokenFacts,
  createDurableConversationEvidenceAdapter,
  createDurableTemporaryConversationEvidenceAdapter,
  createLearningWorkLedgerEvidenceAdapter,
  discoverTokenEvidence,
  type TokenEvidenceAdapters
} from './analytics/token-evidence'

export { aggregateTokenFacts, collectConversationTokenFacts, readLatestLedgerSnapshots } from './analytics/token-evidence'
import {
  buildPersonalStudyAnalytics,
  validatePersonalStudySnapshot,
  type PersonalStudySnapshotValidation
} from '../../../shared/learning-analytics/personal-study-source'

const CONTRACT_VERSION = 1 as const
const RETENTION_DAYS = 400 as const
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
  listTemporaryConversationSummaries?: () => Promise<AgentConversationSummary[]>
  readTemporaryConversation?: (workspaceId: string | undefined, conversationId: string) => Promise<AgentConversationRecord>
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
  /** Optional main-process-only SQLite projection. File scanning remains the fallback. */
  localDataIndex?: LocalDataIndex
}

type AnalyticsPlanContext = {
  query: LearningAnalyticsQuery
  personal: PersonalStudySnapshotValidation
  key: string
}
type ScanHeader = {
  selected: AnalyticsWorkspaceScanResult[]
  temporaryConversations: AgentConversationSummary[]
  temporaryWarnings: AnalyticsWarning[]
  warnings: AnalyticsWarning[]
}
type PlatformScanHeader = ScanHeader & {
  settings: TeachingSettingsV1 | null
  skills: SkillCatalogResult | null
  connectorStatuses: ConnectorStatusesResult | null
}
type TokenScanResult = { section: AnalyticsSectionResult<TokenAnalytics> }
export type AnalyticsPreparedExport = { fileName: string; content: string; manifest: AnalyticsExportManifest }

export class LearningAnalyticsService {
  private readonly sourcePlan: LearningAnalyticsSourcePlan<AnalyticsPlanContext>

  constructor(private readonly dependencies: LearningAnalyticsDependencies) {
    this.sourcePlan = this.createSourcePlan()
  }

  async getLearningAnalytics(request: LearningAnalyticsRequest | LearningAnalyticsQuery): Promise<LearningAnalyticsBundle> {
    const context = this.analyticsContext(request)
    const refreshSections = selectiveRefreshSections(request)
    if (refreshSections.length) {
      return this.sourcePlan.refresh({ key: context.key, context, sectionIds: refreshSections }, (input, previous, refreshedSections) => this.assembleBundle(context, input.values, previous, refreshedSections))
    }
    const requestedSections = selectiveRequestedSections(request)
    return this.sourcePlan.read({
      key: context.key,
      context,
      ...(requestedSections.length ? { sectionIds: requestedSections } : {})
    }, (input, previous, refreshedSections) => this.assembleBundle(context, input.values, previous, refreshedSections))
  }

  /** Selectively rereads only the sources needed by the requested sections. */
  async refreshLearningAnalyticsSections(request: LearningAnalyticsRequest | LearningAnalyticsQuery, sectionIds: readonly AnalyticsSectionId[]): Promise<LearningAnalyticsBundle> {
    if (!sectionIds.length) return this.getLearningAnalytics(request)
    const context = this.analyticsContext(request)
    return this.sourcePlan.refresh({ key: context.key, context, sectionIds }, (input, previous, refreshedSections) => this.assembleBundle(context, input.values, previous, refreshedSections))
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
        this.sourcePlan.invalidate()
        await safeRemove(join(analyticsRoot, 'cache'))
        await safeRemove(join(analyticsRoot, 'daily-projections'))
      } else if (target === 'personal_activity_history') {
        await safeRemove(join(analyticsRoot, 'personal-activity'))
        await safeRemove(join(analyticsRoot, 'study-activity-v1.json'))
        await safeRemove(join(analyticsRoot, 'study-daily-projection-v1.json'))
        trackingRestartedOn = dateToLocalKey(this.now(), this.localTimeZone())
        await mkdir(analyticsRoot, { recursive: true })
        await writeFile(join(analyticsRoot, TRACKING_FILE), `${JSON.stringify({ trackingStartedOn: trackingRestartedOn })}\n`, { mode: 0o600 })
        this.sourcePlan.invalidate(['personal_activity'])
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

  /** Invalidates only sources affected by a Teaching-domain mutation. */
  invalidate(targets?: readonly LearningAnalyticsInvalidation[]): void {
    this.sourcePlan.invalidate(targets)
  }

  /** Dependency/cache diagnostics without exposing any evidence payloads. */
  reportSourcePlan(): SourcePlanReport {
    return this.sourcePlan.report()
  }

  private analyticsContext(request: LearningAnalyticsRequest | LearningAnalyticsQuery): AnalyticsPlanContext {
    const normalized = normalizeLearningAnalyticsRequest(request)
    validateLearningAnalyticsQuery(normalized.query)
    const personal = normalized.query.scope.personalFocus.kind === 'personal'
      ? validatePersonalStudySnapshot(normalized.personalStudy, {
          clientId: normalized.query.scope.personalFocus.clientId,
          localToday: normalized.query.calendarContext.localToday,
          now: this.now()
        })
      : ({ state: 'missing', cacheIdentity: 'missing', warnings: [] } as PersonalStudySnapshotValidation)
    return {
      query: normalized.query,
      personal,
      key: digest(stableJson({ query: normalized.query, personal: personalCacheFingerprint(personal) }))
    }
  }

  private createSourcePlan(): LearningAnalyticsSourcePlan<AnalyticsPlanContext> {
    return new LearningAnalyticsSourcePlan<AnalyticsPlanContext>([
      {
        id: 'workspace_catalog',
        fingerprint: async (context) => digest(stableJson({ query: context.query.scope.teaching })),
        read: async (context) => {
          const header = await this.loadScanHeader(context.query)
          return { value: header, warnings: header.warnings, partial: header.warnings.length > 0 }
        }
      },
      {
        id: 'token_evidence',
        dependsOn: ['workspace_catalog'],
        sections: ['tokens'],
        fingerprint: async (_context, dependencies) => this.fingerprintTokenEvidence(dependencies.get('workspace_catalog')!.value as ScanHeader),
        read: async (context, access) => {
          const header = access.value<ScanHeader>('workspace_catalog')
          const token = await this.scanTokens(context.query, header, [
            ...access.warningsFor('workspace_catalog'),
            ...header.temporaryWarnings
          ])
          return { value: token, warnings: token.section.warnings, partial: token.section.state === 'partial' || token.section.state === 'error' }
        }
      },
      {
        id: 'workspace_assets',
        dependsOn: ['workspace_catalog'],
        sections: ['workspace_assets'],
        fingerprint: async (_context, dependencies) => this.fingerprintWorkspaceAssets(dependencies.get('workspace_catalog')!.value as ScanHeader),
        read: async (context, access) => {
          const header = access.value<ScanHeader>('workspace_catalog')
          return sectionSource(buildWorkspaceAssetsSection(context.query, this.now().toISOString(), header.selected, access.warningsFor('workspace_catalog')))
        }
      },
      {
        id: 'review_sources',
        dependsOn: ['workspace_catalog'],
        sections: ['review'],
        fingerprint: async (_context, dependencies) => this.fingerprintReviewSources(dependencies.get('workspace_catalog')!.value as ScanHeader),
        read: async (context, access) => {
          const header = access.value<ScanHeader>('workspace_catalog')
          return sectionSource(await this.scanReview(context.query, this.now().toISOString(), header.selected, access.warningsFor('workspace_catalog')))
        }
      },
      {
        id: 'memory_store',
        dependsOn: ['workspace_catalog'],
        sections: ['memory'],
        fingerprint: async (_context, dependencies) => this.fingerprintMemoryStore(dependencies.get('workspace_catalog')!.value as ScanHeader),
        read: async (context, access) => {
          const header = access.value<ScanHeader>('workspace_catalog')
          return sectionSource(await this.scanMemory(context.query, this.now().toISOString(), header.selected, access.warningsFor('workspace_catalog')))
        }
      },
      {
        id: 'platform_sources',
        dependsOn: ['workspace_catalog'],
        sections: ['platform'],
        fingerprint: async (_context, dependencies) => this.fingerprintPlatformSources(dependencies.get('workspace_catalog')!.value as ScanHeader),
        read: async (context, access) => {
          const header = await this.loadPlatformHeader(access.value<ScanHeader>('workspace_catalog'))
          return sectionSource(await this.scanPlatform(context.query, this.now().toISOString(), header))
        }
      },
      {
        id: 'personal_study',
        dependsOn: ['token_evidence'],
        sections: ['hero', 'focus', 'tasks'],
        fingerprint: async (context, dependencies) => digest(stableJson({ personal: personalCacheFingerprint(context.personal), tokens: dependencies.get('token_evidence')!.fingerprint })),
        read: async (context, access) => ({
          value: buildPersonalStudyAnalytics({
            query: context.query,
            validation: context.personal,
            generatedAt: this.now().toISOString(),
            tokens: access.value<TokenScanResult>('token_evidence').section
          })
        })
      },
      {
        id: 'presence_snapshot',
        sections: ['presence'],
        fingerprint: async (context) => digest(stableJson(context.query.scope.presence)),
        read: async (context) => ({
          value: context.query.scope.presence.kind === 'none'
            ? unavailableSection<PresenceSnapshotAnalytics>(asOfTemporal(this.now().toISOString()), coverage(context.query, false, [], [], true), 'not_applicable', [])
            : unavailableSection<PresenceSnapshotAnalytics>(liveTemporal(this.now().toISOString()), coverage(context.query, false, [], [], false), 'source_missing', [warning('source_not_configured', 'Presence is a live renderer snapshot, not Teaching history.', 'presence')])
        })
      },
      {
        id: 'insight_derivation',
        dependsOn: ['token_evidence', 'workspace_assets', 'review_sources', 'memory_store', 'platform_sources'],
        sections: ['insights'],
        fingerprint: async (_context, dependencies) => digest(stableJson([...dependencies.entries()].map(([id, item]) => [id, item.fingerprint]))),
        read: async (context, access) => ({
          value: buildInsightsSection(
            context.query,
            this.now().toISOString(),
            access.value<TokenScanResult>('token_evidence').section,
            access.value<AnalyticsSectionResult<WorkspaceAssetsAnalytics>>('workspace_assets'),
            access.value<AnalyticsSectionResult<ReviewAnalytics>>('review_sources'),
            access.value<AnalyticsSectionResult<MemoryAnalytics>>('memory_store'),
            access.value<AnalyticsSectionResult<PlatformAnalytics>>('platform_sources')
          )
        })
      }
    ])
  }

  private assembleBundle(context: AnalyticsPlanContext, values: ReadonlyMap<string, unknown>, previous: LearningAnalyticsBundle | null, refreshedSections: readonly AnalyticsSectionId[]): LearningAnalyticsBundle {
    const generatedAt = this.now().toISOString()
    const bundle: LearningAnalyticsBundle = previous
      ? { ...previous, generatedAt, query: context.query }
      : createUnrequestedBundle(context.query, generatedAt)
    const refreshed = new Set(refreshedSections)
    const include = (section: AnalyticsSectionId): boolean => refreshed.has(section)
    if (include('tokens')) bundle.tokens = (values.get('token_evidence') as TokenScanResult).section
    if (include('workspace_assets')) bundle.workspaceAssets = values.get('workspace_assets') as AnalyticsSectionResult<WorkspaceAssetsAnalytics>
    if (include('review')) bundle.review = values.get('review_sources') as AnalyticsSectionResult<ReviewAnalytics>
    if (include('memory')) bundle.memory = values.get('memory_store') as AnalyticsSectionResult<MemoryAnalytics>
    if (include('platform')) bundle.platform = values.get('platform_sources') as AnalyticsSectionResult<PlatformAnalytics>
    if (include('presence')) bundle.presence = values.get('presence_snapshot') as AnalyticsSectionResult<PresenceSnapshotAnalytics>
    if (include('hero') || include('focus') || include('tasks')) {
      const personal = values.get('personal_study') as ReturnType<typeof buildPersonalStudyAnalytics>
      if (include('hero')) bundle.hero = personal.hero
      if (include('focus')) bundle.focus = personal.focus
      if (include('tasks')) bundle.tasks = personal.tasks
    }
    if (include('insights')) bundle.insights = values.get('insight_derivation') as LearningAnalyticsBundle['insights']
    return bundle
  }

  private async loadScanHeader(query: LearningAnalyticsQuery): Promise<ScanHeader> {
    const warnings: AnalyticsWarning[] = []
    const temporaryWarnings: AnalyticsWarning[] = []
    const [workspaceResult, temporaryResult] = await Promise.all([
      this.dependencies.listWorkspaceSummaries().catch(() => null),
      this.dependencies.listTemporaryConversationSummaries?.().catch(() => null) ?? Promise.resolve([])
    ])
    if (!workspaceResult) warnings.push(warning('source_scan_incomplete', 'Teaching workspace catalog could not be scanned.', 'workspace_catalog'))
    if (this.dependencies.listTemporaryConversationSummaries && !temporaryResult) {
      temporaryWarnings.push(warning('source_scan_incomplete', 'Temporary conversation catalog could not be scanned.', 'agent_conversations'))
    }
    return {
      selected: selectWorkspaceScans(query, workspaceResult ?? []),
      temporaryConversations: temporaryResult ?? [],
      temporaryWarnings,
      warnings
    }
  }

  private async loadPlatformHeader(header: ScanHeader): Promise<PlatformScanHeader> {
    const warnings = [...header.warnings]
    const [settingsResult, skillsResult, connectorsResult] = await Promise.allSettled([
      this.dependencies.loadSettings(),
      this.dependencies.listSkills(),
      this.dependencies.getConnectorStatuses?.() ?? Promise.resolve(null)
    ])
    const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null
    const skills = skillsResult.status === 'fulfilled' ? skillsResult.value : null
    const connectorStatuses = connectorsResult.status === 'fulfilled' ? connectorsResult.value : null
    if (!settings) warnings.push(warning('source_scan_incomplete', 'Settings could not be read for analytics.', 'settings'))
    if (!skills) warnings.push(warning('source_scan_incomplete', 'Skill catalog could not be read for analytics.', 'skill_catalog'))
    return { ...header, settings, skills, connectorStatuses, warnings }
  }

  private async fingerprintTokenEvidence(header: ScanHeader): Promise<string> {
    const paths = new Set<string>()
    for (const item of header.selected) {
      paths.add(join(item.rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH))
      for (const conversation of item.summary?.conversations ?? []) {
        paths.add(conversation.absolutePath)
        paths.add(join(item.rootPath, agentConversationJsonRelativePathForMarkdown(conversation.relativePath)))
      }
    }
    if (this.dependencies.listTemporaryConversationSummaries) {
      paths.add(join(this.dependencies.appDataRoot, 'conversations'))
      paths.add(join(this.dependencies.appDataRoot, 'conversations', '.index.json'))
    }
    for (const conversation of header.temporaryConversations) {
      paths.add(conversation.absolutePath)
      paths.add(conversation.absolutePath.replace(/\.md$/i, '.json'))
    }
    return digest(stableJson({
      selected: sourceHeaderIdentity(header),
      temporaryConversations: temporaryConversationIdentity(header),
      mtimes: await collectPathVersions([...paths])
    }))
  }

  private async fingerprintWorkspaceAssets(header: ScanHeader): Promise<string> {
    const paths = new Set<string>()
    for (const item of header.selected) {
      const summary = item.summary
      if (!summary) continue
      paths.add(summary.resourcesPath)
      paths.add(summary.recordsDir)
      paths.add(summary.referenceDir)
      for (const lesson of summary.lessons) paths.add(lesson.absolutePath)
      for (const record of summary.records) paths.add(record.absolutePath)
    }
    return digest(stableJson({ selected: sourceHeaderIdentity(header), mtimes: await collectPathVersions([...paths]) }))
  }

  private async fingerprintReviewSources(header: ScanHeader): Promise<string> {
    const paths = header.selected.flatMap((item) => [join(item.rootPath, '.studiumx', 'progress.json'), join(item.rootPath, '.studiumx', 'reviews'), join(item.rootPath, '.studiumx', 'review')])
    return digest(stableJson({ selected: sourceHeaderIdentity(header), mtimes: await collectPathVersions(paths) }))
  }

  private async fingerprintMemoryStore(header: ScanHeader): Promise<string> {
    return digest(stableJson({ selected: header.selected.map((item) => item.workspaceId), memory: await collectPathVersions([join(this.dependencies.appDataRoot, 'memory')]) }))
  }

  private async fingerprintPlatformSources(header: ScanHeader): Promise<string> {
    return digest(stableJson({ header: sourceHeaderIdentity(header), changes: await collectPathVersions([join(this.dependencies.appDataRoot, 'learning-changes', 'history.json')]) }))
  }

  private withCanonicalTokenEvidenceFallback(indexed: LocalDataIndexTokenEvidenceAdapters, durable: TokenEvidenceAdapters): TokenEvidenceAdapters {
    return {
      conversations: {
        read: async (workspaceId, conversationId) => {
          const result = await indexed.conversations.read(workspaceId, conversationId)
          return result.state === 'unavailable' ? durable.conversations.read(workspaceId, conversationId) : result
        }
      },
      ...(durable.temporaryConversations ? {
        temporaryConversations: {
          read: async (workspaceId: string | undefined, conversationId: string) => {
            const result = await indexed.temporaryConversations.read(workspaceId, conversationId)
            return result.state === 'unavailable'
              ? durable.temporaryConversations!.read(workspaceId, conversationId)
              : result
          }
        }
      } : {}),
      ledger: {
        read: async (workspace) => {
          const result = await indexed.ledger.read(workspace)
          if ('state' in result) return durable.ledger.read(workspace)
          return result
        }
      }
    }
  }

  private async scanTokens(query: LearningAnalyticsQuery, header: ScanHeader, inheritedWarnings: AnalyticsWarning[]): Promise<TokenScanResult> {
    const { selected, temporaryConversations } = header
    if (query.scope.teaching.kind === 'none' && temporaryConversations.length === 0) {
      return { section: unavailableSection(queryTemporal(query), coverage(query, true, [], [], true), 'not_applicable', inheritedWarnings) }
    }
    if (query.scope.teaching.kind === 'workspace' && selected.length === 0 && temporaryConversations.length === 0) {
      return { section: unavailableSection(queryTemporal(query), coverage(query, true, [], [], false), 'no_active_workspace', inheritedWarnings) }
    }

    // The SQLite projection is used only when it is complete and its source identity
    // still matches canonical files. The adapter boundary repeats that exact check
    // immediately before each SQLite statement; an unavailable index query falls
    // through to the canonical file adapters rather than looking like empty data.
    const durableAdapters: TokenEvidenceAdapters = {
      conversations: createDurableConversationEvidenceAdapter(this.dependencies.readConversation),
      ...(this.dependencies.readTemporaryConversation ? {
        temporaryConversations: createDurableTemporaryConversationEvidenceAdapter(this.dependencies.readTemporaryConversation)
      } : {}),
      ledger: createLearningWorkLedgerEvidenceAdapter()
    }
    const indexedAdapters = this.dependencies.localDataIndex && await this.dependencies.localDataIndex.isCompleteForCurrentSources()
      ? this.dependencies.localDataIndex.tokenEvidenceAdapters()
      : null
    const evidence = await discoverTokenEvidence({
      query,
      workspaces: selected,
      temporaryConversations,
      inheritedWarnings,
      adapters: indexedAdapters ? this.withCanonicalTokenEvidenceFallback(indexedAdapters, durableAdapters) : durableAdapters
    })
    const data = aggregateTokenFacts(evidence.rangedFacts, evidence.toolFacts, evidence.counters)
    const complete = evidence.complete && header.temporaryWarnings.length === 0
    const sectionCoverage = coverage(query, true, evidence.sources, evidence.facts.map((fact) => fact.localDate), complete)
    const isPartial = !complete || evidence.counters.componentMissing > 0 || evidence.counters.totalInconsistent > 0
    if (selected.length > 0 && evidence.counters.workspaceErrors === selected.length && temporaryConversations.length === 0) {
      return { section: errorSection(queryTemporal(query), sectionCoverage, 'workspace_scan_failed', 'No selected Teaching workspace could be scanned.', true, evidence.warnings) }
    }
    const state = evidence.facts.length === 0 && evidence.counters.conversationsScanned === 0 && evidence.counters.workspaceErrors === 0
      ? 'empty'
      : isPartial ? 'partial' : evidence.rangedFacts.length === 0 ? 'empty' : 'available'
    const section = state === 'empty'
      ? emptySection(queryTemporal(query), sectionCoverage, data, evidence.counters.conversationsScanned === 0 ? 'scope_has_no_items' : 'no_matching_records', evidence.warnings)
      : state === 'partial' ? partialSection(queryTemporal(query), sectionCoverage, data, evidence.warnings) : availableSection(queryTemporal(query), sectionCoverage, data, evidence.warnings)
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

  private async scanPlatform(query: LearningAnalyticsQuery, generatedAt: string, header: PlatformScanHeader): Promise<AnalyticsSectionResult<PlatformAnalytics>> {
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

  private now(): Date { return this.dependencies.now?.() ?? new Date() }
  private localTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
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

function createUnrequestedBundle(query: LearningAnalyticsQuery, generatedAt: string): LearningAnalyticsBundle {
  const omitted = <T>(): AnalyticsSectionResult<T> => unavailableSection(
    queryTemporal(query),
    coverage(query, true, [], [], false),
    'source_missing',
    []
  )
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt,
    query,
    hero: omitted(),
    focus: omitted(),
    tasks: omitted(),
    tokens: omitted(),
    workspaceAssets: omitted(),
    review: omitted(),
    memory: omitted(),
    platform: omitted(),
    presence: omitted(),
    insights: omitted()
  }
}

function sectionSource<T>(section: AnalyticsSectionResult<T>): { value: AnalyticsSectionResult<T>; warnings: AnalyticsWarning[]; partial: boolean } {
  return { value: section, warnings: section.warnings, partial: section.state === 'partial' || section.state === 'error' }
}
function sourceHeaderIdentity(header: ScanHeader): unknown {
  return {
    selected: header.selected.map((item) => ({
      id: item.workspaceId,
      name: item.workspaceName,
      error: Boolean(item.error),
      updatedAt: item.summary?.updatedAt,
      conversations: item.summary?.conversations.map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt, messageCount: entry.messageCount })),
      lessons: item.summary?.lessons.map((entry) => ({ id: entry.id, createdAt: entry.createdAt })),
      records: item.summary?.records.map((entry) => ({ relativePath: entry.relativePath, date: entry.date })),
      references: item.summary?.referenceCount
    }))
  }
}

function temporaryConversationIdentity(header: ScanHeader): unknown {
  return header.temporaryConversations.map((entry) => ({
    id: entry.id,
    workspaceId: entry.workspaceId,
    relativePath: entry.relativePath,
    updatedAt: entry.updatedAt,
    messageCount: entry.messageCount
  }))
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
function isValidTimeZone(value: unknown): value is string { try { if (typeof value !== 'string' || !value) return false; new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }function cleanString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0) }
function latestString(values: Array<string | undefined>): string | undefined { return values.filter((value): value is string => Boolean(value)).sort().at(-1) }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function stableJson(value: unknown): string { return JSON.stringify(sortJson(value)) }
function sortJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortJson); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortJson(nested)])) }
const ANALYTICS_SECTION_IDS = new Set<AnalyticsSectionId>(['hero', 'focus', 'tasks', 'tokens', 'workspace_assets', 'review', 'memory', 'platform', 'presence', 'insights'])
function selectiveRequestedSections(value: LearningAnalyticsRequest | LearningAnalyticsQuery): AnalyticsSectionId[] {
  return selectiveSections(value, 'sectionIds')
}
function selectiveRefreshSections(value: LearningAnalyticsRequest | LearningAnalyticsQuery): AnalyticsSectionId[] {
  return selectiveSections(value, 'refreshSectionIds')
}
function selectiveSections(value: LearningAnalyticsRequest | LearningAnalyticsQuery, key: 'sectionIds' | 'refreshSectionIds'): AnalyticsSectionId[] {
  if (!value || typeof value !== 'object' || !(key in value)) return []
  const candidates = (value as Record<string, unknown>)[key]
  return Array.isArray(candidates)
    ? [...new Set(candidates.filter((candidate): candidate is AnalyticsSectionId => typeof candidate === 'string' && ANALYTICS_SECTION_IDS.has(candidate as AnalyticsSectionId)))]
    : []
}

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
