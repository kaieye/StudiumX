import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIsolatedTestRuntime, type IsolatedTestRuntime } from '../helpers/runtime-isolation'
import type {
  AgentConversationRecord,
  AgentConversationSummary,
  AnalyticsHourBuckets,
  LearningAnalyticsQuery,
  LearningAnalyticsRequest,
  PersonalStudyAnalyticsSnapshot,
  StudySessionFact,
  StudyTaskActivityFact,
  SkillCatalogResult,
  TeachingMemoryDiagnostics,
  TeachingSettingsV1,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'
import {
  LearningAnalyticsService,
  type AnalyticsWorkspaceScanResult
} from '../../src/main/teaching/services/learning-analytics'

const ledgerRelativePath = join('.studiumx', 'learning-work.jsonl')
const instant = '2026-07-11T00:00:00.000Z'
const analyticsNow = '2026-07-12T12:00:00.000Z'

function query(range: LearningAnalyticsQuery['range'] = {
  from: '2026-07-10',
  to: '2026-07-12',
  preset: 'custom',
  fromInclusive: true,
  toInclusive: true,
  calendar: 'local_gregorian',
  weekStartsOn: 1
}): LearningAnalyticsQuery {
  return {
    range,
    scope: {
      personalFocus: { kind: 'personal', clientId: 'isolated-client' },
      teaching: { kind: 'all_workspaces', workspaceIds: ['ws-good', 'ws-bad'] },
      presence: { kind: 'none' }
    },
    calendarContext: { localToday: '2026-07-12', timeZone: 'UTC', weekStartsOn: 1 }
  }
}

const hours = (...entries: Array<[number, number]>): AnalyticsHourBuckets => {
  const values = Array.from({ length: 24 }, () => 0)
  for (const [hour, seconds] of entries) values[hour] = seconds
  return values as unknown as AnalyticsHourBuckets
}

function personalSessionFact(overrides: Partial<StudySessionFact> = {}): StudySessionFact {
  return {
    factVersion: 1,
    factKind: 'study_session',
    id: 'personal-session-1',
    clientId: 'isolated-client',
    timerMode: 'focus',
    outcome: 'completed',
    startedAt: '2026-07-11T01:00:00.000Z',
    endedAt: '2026-07-11T01:25:00.000Z',
    recordedAt: '2026-07-11T01:25:00.000Z',
    plannedSeconds: 1500,
    activeSeconds: 1500,
    pausedSeconds: 0,
    completedFocusSessions: 1,
    xpEarned: 25,
    context: { modeId: 'deepwork', roomId: 'deep', signalId: 'writing' },
    taskAttribution: { kind: 'explicit', capturedAt: 'session_start', taskId: 'task-1', taskTitleSnapshot: 'Integration task' },
    daySegments: [{
      localDate: '2026-07-11',
      timezoneOffsetMinutes: 0,
      startedAt: '2026-07-11T01:00:00.000Z',
      endedAt: '2026-07-11T01:25:00.000Z',
      activeSeconds: 1500,
      pausedSeconds: 0,
      hourBuckets: hours([1, 1500])
    }],
    ...overrides
  }
}

function personalTaskCompletedFact(): StudyTaskActivityFact {
  const before = { taskId: 'task-1', title: 'Integration task', done: false }
  return {
    factVersion: 1,
    factKind: 'study_activity',
    id: 'personal-task-completed',
    clientId: 'isolated-client',
    occurredAt: '2026-07-11T01:25:00.000Z',
    recordedAt: '2026-07-11T01:25:00.000Z',
    localDate: '2026-07-11',
    timezoneOffsetMinutes: 0,
    activity: { kind: 'task_completed', before, after: { ...before, done: true } }
  }
}

function personalStudy(overrides: Partial<PersonalStudyAnalyticsSnapshot> = {}): PersonalStudyAnalyticsSnapshot {
  return {
    version: 1,
    identity: 'personal-snapshot-a',
    capturedAt: analyticsNow,
    clientId: 'isolated-client',
    trackingStartedOn: '2026-07-10',
    facts: [personalSessionFact(), personalTaskCompletedFact()],
    current: {
      xp: 375,
      streakDays: 4,
      tasks: [{ taskId: 'task-1', title: 'Integration task', done: true }]
    },
    ...overrides
  }
}

function request(personalStudySnapshot = personalStudy(), requestQuery = query()): LearningAnalyticsRequest {
  return { query: requestQuery, personalStudy: personalStudySnapshot }
}

function dataOf<T>(section: { state: string; data?: T }): T {
  if (section.state !== 'available' && section.state !== 'partial' && section.state !== 'empty' || section.data === undefined) {
    throw new Error(`Expected a data-bearing section, received ${section.state}`)
  }
  return section.data
}

function summary(runtime: IsolatedTestRuntime, id: string): TeachingWorkspaceSummary {
  return {
    id,
    name: id === 'ws-good' ? 'Good Workspace' : 'Bad Workspace',
    rootPath: runtime.workspaceDir,
    missionPath: join(runtime.workspaceDir, 'MISSION.md'),
    resourcesPath: join(runtime.workspaceDir, 'resources'),
    lessonsDir: join(runtime.workspaceDir, 'lessons'),
    recordsDir: join(runtime.workspaceDir, 'records'),
    referenceDir: join(runtime.workspaceDir, 'references'),
    reviewsDir: join(runtime.workspaceDir, 'reviews'),
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: instant,
    missionTitle: 'Mission',
    missionExcerpt: 'Safe fixture mission',
    courses: [],
    fileTree: [],
    conversations: [],
    resources: [],
    records: [],
    lessons: [],
    referenceCount: 0,
    assetsReady: true,
    git: null
  }
}

function conversationRecord(id: string, turns: AgentConversationRecord['turns'], runtime: IsolatedTestRuntime): AgentConversationRecord {
  return {
    id,
    title: `Secret ${id}`,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: instant,
    relativePath: `courses/demo/conversations/${id}.md`,
    absolutePath: join(runtime.workspaceDir, `courses-demo-${id}.md`),
    messageCount: turns.length,
    turns
  }
}

function usage(totalTokens: number, promptTokens?: number, completionTokens?: number) {
  return {
    totalTokens,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    providerCalls: 1,
    toolCalls: 1,
    toolErrors: 0,
    iterations: 1,
    childRuns: 0,
    durationMs: 5
  }
}

function workspaceScan(runtime: IsolatedTestRuntime, summaries: TeachingWorkspaceSummary[], error = false): AnalyticsWorkspaceScanResult[] {
  return summaries.map((item) => ({
    workspaceId: item.id,
    workspaceName: item.name,
    rootPath: item.rootPath,
    ...(error ? { error: 'workspace_scan_failed' } : { summary: item })
  }))
}

function settings(runtime: IsolatedTestRuntime): TeachingSettingsV1 {
  return {
    version: 1,
    locale: 'en-US',
    theme: 'system',
    uiFontScale: 1,
    density: 'comfortable',
    provider: { activeProviderId: 'provider-1', providers: [{ id: 'provider-1', name: 'Fixture Provider', apiKey: 'fixture-secret', endpoint: 'https://fixture.invalid', model: 'fixture-model' } as never], proxy: { enabled: false, url: '' } },
    generator: { providerId: 'provider-1', model: 'fixture-model', endpointFormat: 'openai_compatible', temperature: 0.2, maxOutputTokens: 100, lessonDurationMinutes: 30, includeRetrievalPractice: true, generateReference: true, structuredOutput: true, streaming: true, reasoningEffort: 'low', requestTimeoutMs: 1000 },
    workspace: { defaultRoot: runtime.workspaceDir, confirmBeforeGenerating: true, autoOpenGeneratedLesson: false, showAllCourseFiles: false, lessonStyleId: 'default' },
    worktree: { rootPath: runtime.workspaceDir },
    memory: { enabled: true, maxInjected: 10 },
    tools: { enabled: true, workspaceRead: true, workspaceWritePermission: 'ask', webSearch: false, webFetch: false, maxIterations: 3, runBudget: { maxDurationMs: 1000, maxProviderCalls: 2, maxToolCalls: 2, maxTotalTokens: 1000, warningThreshold: 0.8 } },
    webSearch: { backend: 'none', fallbackEnabled: false, maxResults: 0, searxngUrl: '', braveApiKey: '', firecrawlApiKey: '', firecrawlApiUrl: '', tavilyApiKey: '', exaApiKey: '', parallelApiKey: '', parallelSearchMode: 'off', xaiApiKey: '', xaiModel: '' },
    notifications: { enabled: false, lessonGenerated: false, workspaceImported: false, errors: false },
    pet: { enabled: true, displayName: 'Fixture Pet', showStatusBubble: true, appearance: 'default' },
    privacy: { maskApiKeys: true, allowExternalLinks: false },
    appBehavior: { openAtLogin: false, startMinimized: false, closeAction: 'quit', closeToTray: false },
    log: { enabled: false, retentionDays: 7 }
  }
}

function makeService(
  runtime: IsolatedTestRuntime,
  scans: AnalyticsWorkspaceScanResult[],
  records: Map<string, AgentConversationRecord>,
  readCount: { value: number },
  sourceReads?: { review: number; memory: number; platform?: number },
  temporary?: {
    list: () => Promise<AgentConversationSummary[]>
    read: (workspaceId: string | undefined, conversationId: string) => Promise<AgentConversationRecord>
  }
) {
  const skills: SkillCatalogResult = { rootPath: runtime.rootDir, skills: [] }
  const diagnostics: TeachingMemoryDiagnostics = { enabled: true, rootDir: runtime.rootDir, activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] }
  return new LearningAnalyticsService({
    appDataRoot: runtime.userDataDir,
    listWorkspaceSummaries: async () => scans,
    ...(temporary ? {
      listTemporaryConversationSummaries: temporary.list,
      readTemporaryConversation: temporary.read
    } : {}),
    readConversation: async (_workspaceId, conversationId) => {
      readCount.value += 1
      const record = records.get(conversationId)
      if (!record) throw new Error('missing fixture')
      return record
    },
    getProgress: async (workspaceId) => { if (sourceReads) sourceReads.review += 1; return { workspaceId, progress: { totalAnswered: 2, correct: 1, byLesson: {} } } },
    listReviewCards: async () => { if (sourceReads) sourceReads.review += 1; return { cards: [] } },
    listMemory: async () => { if (sourceReads) sourceReads.memory += 1; return [] },
    getMemoryDiagnostics: async () => diagnostics,
    listSkills: async () => { if (sourceReads) sourceReads.platform = (sourceReads.platform ?? 0) + 1; return skills },
    loadSettings: async () => { if (sourceReads) sourceReads.platform = (sourceReads.platform ?? 0) + 1; return settings(runtime) },
    listWorkspaceChanges: async () => [],
    now: () => new Date(analyticsNow)
  })
}

let runtime: IsolatedTestRuntime
beforeEach(async () => { runtime = await createIsolatedTestRuntime('teaching-analytics') })
afterEach(async () => { await runtime.cleanup() })

describe('teaching analytics integration', () => {
  it('serves an initial token-only request without loading unrelated analytics providers', async () => {
    const good = summary(runtime, 'ws-good')
    good.conversations = []
    const sourceReads = { review: 0, memory: 0, platform: 0 }
    const service = makeService(runtime, workspaceScan(runtime, [good]), new Map(), { value: 0 }, sourceReads)

    const bundle = await service.getLearningAnalytics({ ...request(), sectionIds: ['tokens'] })

    expect(bundle.tokens.state).toBe('empty')
    expect(bundle.review.state).toBe('unavailable')
    expect(bundle.memory.state).toBe('unavailable')
    expect(bundle.platform.state).toBe('unavailable')
    expect(sourceReads).toEqual({ review: 0, memory: 0, platform: 0 })
    expect(service.reportSourcePlan().cachedSources.map((entry) => entry.id).sort()).toEqual([
      'token_evidence',
      'workspace_catalog'
    ])
  })

  it('uses conversation turns first, falls back to one latest ledger snapshot, and never adds ledger to partial turns', async () => {
    const good = summary(runtime, 'ws-good')
    const convSummary = {
      id: 'conv-turn', workspaceId: good.id, title: 'Secret conv-turn', createdAt: instant, updatedAt: instant,
      relativePath: 'courses/demo/conversations/conv-turn.md', absolutePath: join(runtime.workspaceDir, 'conv-turn.md'), messageCount: 3
    }
    const fallbackSummary = { ...convSummary, id: 'conv-fallback', title: 'Secret fallback', relativePath: 'courses/demo/conversations/conv-fallback.md', absolutePath: join(runtime.workspaceDir, 'conv-fallback.md') }
    good.conversations = [convSummary, fallbackSummary]
    const records = new Map<string, AgentConversationRecord>([
      ['conv-turn', conversationRecord('conv-turn', [
        { id: 'turn-1', role: 'assistant', content: 'secret answer', createdAt: '2026-07-11T12:00:00.000Z', metadata: { version: 1, runUsage: usage(10, 6, 4) } },
        { id: 'turn-missing', role: 'assistant', content: 'missing usage', createdAt: '2026-07-11T12:01:00.000Z' }
      ], runtime)],
      ['conv-fallback', conversationRecord('conv-fallback', [{ id: 'turn-no-usage', role: 'assistant', content: 'no usage', createdAt: '2026-07-11T12:00:00.000Z' }], runtime)]
    ])
    await mkdir(join(runtime.workspaceDir, '.studiumx'), { recursive: true })
    const ledgerRows = [
      { version: 1, entryId: 'old', type: 'conversation_snapshot', createdAt: '2026-07-12T00:00:00.000Z', status: 'completed', workspace: { id: good.id, name: good.name }, conversation: { id: 'conv-turn', title: 'Ledger should not be used', updatedAt: '2026-07-11T00:00:00.000Z', messageCount: 3, relativePath: convSummary.relativePath }, evidence: { runUsage: usage(999) } },
      { version: 1, entryId: 'fallback-old', type: 'conversation_snapshot', createdAt: '2026-07-11T01:00:00.000Z', status: 'completed', workspace: { id: good.id, name: good.name }, conversation: { id: 'conv-fallback', title: 'Fallback', updatedAt: '2026-07-11T00:00:00.000Z', messageCount: 1, relativePath: fallbackSummary.relativePath }, evidence: { runUsage: usage(20, 12, 8) } },
      { version: 1, entryId: 'fallback-new', type: 'conversation_snapshot', createdAt: '2026-07-11T02:00:00.000Z', status: 'completed', workspace: { id: good.id, name: good.name }, conversation: { id: 'conv-fallback', title: 'Fallback', updatedAt: '2026-07-11T00:00:00.000Z', messageCount: 1, relativePath: fallbackSummary.relativePath }, evidence: { runUsage: usage(30, 18, 12) } },
      { version: 1, entryId: 'fallback-late-append-old-conversation', type: 'conversation_snapshot', createdAt: '2026-07-13T02:00:00.000Z', status: 'completed', workspace: { id: good.id, name: good.name }, conversation: { id: 'conv-fallback', title: 'Fallback', updatedAt: '2026-07-10T23:00:00.000Z', messageCount: 1, relativePath: fallbackSummary.relativePath }, evidence: { runUsage: usage(999, 600, 399) } }
    ]
    await writeFile(join(runtime.workspaceDir, ledgerRelativePath), `${ledgerRows.map((row) => JSON.stringify(row)).join('\n')}\n`)

    const count = { value: 0 }
    const service = makeService(runtime, workspaceScan(runtime, [good]), records, count)
    const bundle = await service.getLearningAnalytics(query({ ...query().range, to: '2026-07-11' }))
    expect(bundle.tokens.state).toBe('partial')
    if (bundle.tokens.state === 'partial' || bundle.tokens.state === 'available' || bundle.tokens.state === 'empty') {
      expect(bundle.tokens.data.totals.totalTokens).toBe(40)
      expect(bundle.tokens.data.byConversation.find((item) => item.conversationId === 'conv-turn')?.totalTokens).toBe(10)
      expect(bundle.tokens.data.byConversation.find((item) => item.conversationId === 'conv-fallback')?.totalTokens).toBe(30)
      expect(bundle.tokens.data.sourceCoverage.ledgerFallbackConversations).toBe(1)
    }
  })

  it('isolates a bad workspace while preserving good workspace results', async () => {
    const good = summary(runtime, 'ws-good')
    good.conversations = []
    const bad = summary(runtime, 'ws-bad')
    const count = { value: 0 }
    const service = makeService(runtime, workspaceScan(runtime, [good, bad]).map((item) => item.workspaceId === 'ws-bad' ? { ...item, summary: undefined, error: 'workspace_scan_failed' } : item), new Map(), count)
    const bundle = await service.getLearningAnalytics(query())
    expect(bundle.workspaceAssets.state).toBe('partial')
    expect(bundle.tokens.state).toBe('partial')
    if (bundle.workspaceAssets.state === 'partial') expect(bundle.workspaceAssets.data.counts.workspaces).toBe(1)
  })

  it('keeps current inventory and review invariant while token range changes', async () => {
    const good = summary(runtime, 'ws-good')
    good.conversations = [{ id: 'conv-range', workspaceId: good.id, title: 'Range', createdAt: instant, updatedAt: instant, relativePath: 'courses/demo/conversations/conv-range.md', absolutePath: join(runtime.workspaceDir, 'conv-range.md'), messageCount: 1 }]
    const records = new Map([['conv-range', conversationRecord('conv-range', [{ id: 'turn-range', role: 'assistant', content: 'answer', createdAt: '2026-07-10T23:00:00.000Z', metadata: { version: 1, runUsage: usage(11, 7, 4) } }], runtime)]])
    const service = makeService(runtime, workspaceScan(runtime, [good]), records, { value: 0 })
    const narrow = await service.getLearningAnalytics(query({ ...query().range, from: '2026-07-11', to: '2026-07-11' }))
    const broad = await service.getLearningAnalytics(query())
    expect('data' in narrow.workspaceAssets && 'data' in broad.workspaceAssets && narrow.workspaceAssets.data.counts.conversations).toBe(broad.workspaceAssets.data.counts.conversations)
    expect('data' in narrow.review && 'data' in broad.review && narrow.review.data.cumulative.totalAnswered).toBe(broad.review.data.cumulative.totalAnswered)
    if ('data' in narrow.tokens && 'data' in broad.tokens) expect(narrow.tokens.data.totals.totalTokens).not.toBe(broad.tokens.data.totals.totalTokens)
  })

  it('selectively refreshes token evidence, rederives insights, and leaves review/memory scans cached', async () => {
    const good = summary(runtime, 'ws-good')
    const conversation = { id: 'retry-conversation', workspaceId: good.id, title: 'Retry conversation', createdAt: instant, updatedAt: instant, relativePath: 'courses/demo/conversations/retry.md', absolutePath: join(runtime.workspaceDir, 'retry.md'), messageCount: 1 }
    good.conversations = [conversation]
    const records = new Map<string, AgentConversationRecord>([['retry-conversation', conversationRecord('retry-conversation', [{ id: 'turn', role: 'assistant', content: 'usage', createdAt: instant, metadata: { version: 1, runUsage: usage(7) } }], runtime)]])
    const evidenceReads = { value: 0 }
    const sourceReads = { review: 0, memory: 0 }
    const service = makeService(runtime, workspaceScan(runtime, [good]), records, evidenceReads, sourceReads)

    const initial = await service.getLearningAnalytics(query())
    const initialScans = { ...sourceReads }
    const retried = await service.refreshLearningAnalyticsSections(query(), ['tokens'])

    expect(evidenceReads.value).toBe(2)
    expect(sourceReads).toEqual(initialScans)
    expect(retried.insights).not.toBe(initial.insights)
    expect(retried.contractVersion).toBe(1)
    expect(retried.query).toEqual(initial.query)
  })

  it('keeps a Teaching workspace evidence failure within the sections that depend on Teaching evidence', async () => {
    const good = summary(runtime, 'ws-good')
    const bad = summary(runtime, 'ws-bad')
    const service = makeService(runtime, [...workspaceScan(runtime, [good]), ...workspaceScan(runtime, [bad], true)], new Map(), { value: 0 })

    const result = await service.getLearningAnalytics(query())

    expect(result.tokens.state).toBe('partial')
    expect(result.workspaceAssets.state).toBe('partial')
    expect(result.presence).toMatchObject({ state: 'unavailable', reason: 'not_applicable' })
    expect(result.platform.state).not.toBe('error')
  })

  it('retains the complete LearningAnalyticsBundle contract across a full refresh', async () => {
    const service = makeService(runtime, workspaceScan(runtime, [summary(runtime, 'ws-good')]), new Map(), { value: 0 })
    const first = await service.getLearningAnalytics(query())
    service.invalidate(['workspace'])
    const refreshed = await service.getLearningAnalytics(query())

    expect(Object.keys(refreshed).sort()).toEqual(Object.keys(first).sort())
    expect(refreshed).toMatchObject({ contractVersion: 1, query: first.query })
    expect(refreshed).toHaveProperty('insights')
  })

  it('discovers a newly saved conversation after conversation cache invalidation', async () => {
    const good = summary(runtime, 'ws-good')
    const scans = workspaceScan(runtime, [good])
    const records = new Map<string, AgentConversationRecord>()
    const count = { value: 0 }
    const service = makeService(runtime, scans, records, count)

    const before = await service.getLearningAnalytics({ ...request(), sectionIds: ['tokens'] })
    expect(dataOf(before.tokens).totals.totalTokens).toBe(0)

    const saved = conversationRecord('conv-new', [{
      id: 'turn-new',
      role: 'assistant',
      content: 'new answer',
      createdAt: instant,
      metadata: { version: 1, runUsage: usage(25, 15, 10) }
    }], runtime)
    const updatedGood = {
      ...good,
      conversations: [{
        id: saved.id,
        workspaceId: good.id,
        title: saved.title,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        relativePath: saved.relativePath,
        absolutePath: saved.absolutePath,
        messageCount: saved.messageCount
      }]
    }
    scans[0] = workspaceScan(runtime, [updatedGood])[0]
    records.set(saved.id, saved)
    await writeFile(saved.absolutePath, 'saved conversation')

    service.invalidate(['conversation'])
    const after = await service.getLearningAnalytics({ ...request(), sectionIds: ['tokens'] })

    expect(dataOf(after.tokens).totals).toMatchObject({
      promptTokens: 15,
      completionTokens: 10,
      totalTokens: 25
    })
    expect(count.value).toBe(1)
  })

  it('includes newly saved temporary conversations in global token totals', async () => {
    const good = summary(runtime, 'ws-good')
    good.conversations = []
    let temporaryCatalog: AgentConversationSummary[] = []
    const temporaryRecords = new Map<string, AgentConversationRecord>()
    const count = { value: 0 }
    const service = makeService(
      runtime,
      workspaceScan(runtime, [good]),
      new Map(),
      count,
      undefined,
      {
        list: async () => temporaryCatalog.map((entry) => ({ ...entry })),
        read: async (_workspaceId, conversationId) => {
          count.value += 1
          const record = temporaryRecords.get(conversationId)
          if (!record) throw new Error('missing temporary fixture')
          return record
        }
      }
    )

    const before = await service.getLearningAnalytics({ ...request(), sectionIds: ['tokens'] })
    expect(dataOf(before.tokens).totals.totalTokens).toBe(0)

    const saved = {
      ...conversationRecord('temporary-global', [{
        id: 'temporary-assistant',
        role: 'assistant' as const,
        content: 'answer',
        createdAt: instant,
        metadata: { version: 1 as const, runUsage: usage(25, 15, 10) }
      }], runtime),
      workspaceId: good.id,
      relativePath: 'conversations/temporary-global.md',
      absolutePath: join(runtime.userDataDir, 'conversations', 'temporary-global.md')
    }
    await mkdir(join(runtime.userDataDir, 'conversations'), { recursive: true })
    await writeFile(saved.absolutePath, 'saved temporary conversation')
    temporaryRecords.set(saved.id, saved)
    temporaryCatalog = [{
      id: saved.id,
      workspaceId: saved.workspaceId,
      title: saved.title,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
      relativePath: saved.relativePath,
      absolutePath: saved.absolutePath,
      messageCount: saved.messageCount
    }]

    service.invalidate(['conversation'])
    const after = await service.getLearningAnalytics({ ...request(), sectionIds: ['tokens'] })

    expect(dataOf(after.tokens).totals).toMatchObject({
      promptTokens: 15,
      completionTokens: 10,
      totalTokens: 25
    })
    expect(count.value).toBe(1)

    const noTeachingScope = query()
    noTeachingScope.scope = { ...noTeachingScope.scope, teaching: { kind: 'none' } }
    const globalOnly = await service.getLearningAnalytics({
      ...request(personalStudy(), noTeachingScope),
      sectionIds: ['tokens']
    })
    expect(dataOf(globalOnly.tokens).totals.totalTokens).toBe(25)
    expect(count.value).toBe(2)
  })

  it('deduplicates concurrent requests and invalidates cache when a relevant file changes', async () => {
    const good = summary(runtime, 'ws-good')
    const conversationSummary = { id: 'conv-cache', workspaceId: good.id, title: 'Cache', createdAt: instant, updatedAt: instant, relativePath: 'courses/demo/conversations/conv-cache.md', absolutePath: join(runtime.workspaceDir, 'conv-cache.md'), messageCount: 1 }
    good.conversations = [conversationSummary]
    await writeFile(conversationSummary.absolutePath, 'v1')
    const records = new Map([['conv-cache', conversationRecord('conv-cache', [{ id: 'turn-cache', role: 'assistant', content: 'answer', createdAt: instant, metadata: { version: 1, runUsage: usage(5, 3, 2) } }], runtime)]])
    const count = { value: 0 }
    const service = makeService(runtime, workspaceScan(runtime, [good]), records, count)
    const first = await Promise.all([service.getLearningAnalytics(query()), service.getLearningAnalytics(query())])
    expect(first[0]).toBe(first[1])
    expect(count.value).toBe(1)
    await writeFile(conversationSummary.absolutePath, 'v2-with-different-size')
    await service.getLearningAnalytics(query())
    expect(count.value).toBe(2)
  })


  it('assembles complete personal focus, task, and hero sections in Main from the study snapshot', async () => {
    const service = makeService(runtime, workspaceScan(runtime, [summary(runtime, 'ws-good')]), new Map(), { value: 0 })
    const bundle = await service.getLearningAnalytics(request())

    expect(bundle.focus.state).toBe('available')
    expect(bundle.tasks.state).toBe('available')
    expect(bundle.hero.state).toBe('available')
    expect(dataOf(bundle.focus).sessionStructure).toMatchObject({ focusSeconds: 1500, completed: 1 })
    expect(dataOf(bundle.tasks)).toMatchObject({
      current: { total: 1, completed: 1, completionRate: 1 },
      flow: { completed: 1 },
      plan: { attributedFocusSeconds: 1500 }
    })
    expect(dataOf(bundle.hero)).toMatchObject({
      focusSeconds: 1500,
      completedFocusSessions: 1,
      currentXp: 375,
      currentStreakDays: 4,
      currentTaskCompletionRate: 1
    })
  })

  it('refreshes Main aggregation when personal snapshot identity or accepted content changes', async () => {
    const good = summary(runtime, 'ws-good')
    good.conversations = [{ id: 'conv-personal-cache', workspaceId: good.id, title: 'Cache', createdAt: instant, updatedAt: instant, relativePath: 'courses/demo/conversations/conv-personal-cache.md', absolutePath: join(runtime.workspaceDir, 'conv-personal-cache.md'), messageCount: 1 }]
    const records = new Map([['conv-personal-cache', conversationRecord('conv-personal-cache', [{ id: 'turn-cache', role: 'assistant', content: 'answer', createdAt: instant, metadata: { version: 1, runUsage: usage(5, 3, 2) } }], runtime)]])
    const count = { value: 0 }
    const service = makeService(runtime, workspaceScan(runtime, [good]), records, count)

    const firstRequest = request()
    const first = await service.getLearningAnalytics(firstRequest)
    const second = await service.getLearningAnalytics(firstRequest)
    expect(second).toBe(first)
    expect(count.value).toBe(1)

    await service.getLearningAnalytics(request(personalStudy({ identity: 'personal-snapshot-b' })))
    expect(count.value).toBe(2)

    const changedContent = personalStudy({
      facts: [personalSessionFact({ activeSeconds: 1200, plannedSeconds: 1200, id: 'changed-session', daySegments: [{
        localDate: '2026-07-11', timezoneOffsetMinutes: 0, startedAt: '2026-07-11T01:00:00.000Z', endedAt: '2026-07-11T01:20:00.000Z', activeSeconds: 1200, pausedSeconds: 0, hourBuckets: hours([1, 1200])
      }] }), personalTaskCompletedFact()]
    })
    const changed = await service.getLearningAnalytics(request(changedContent))
    expect(count.value).toBe(3)
    expect(dataOf(changed.focus).sessionStructure.focusSeconds).toBe(1200)
  })

  it('uses the same personal snapshot calculation for safe exports without exposing raw facts in the bundle query', async () => {
    const service = makeService(runtime, workspaceScan(runtime, [summary(runtime, 'ws-good')]), new Map(), { value: 0 })
    const personal = personalStudy()
    const direct = await service.getLearningAnalytics(request(personal))
    const prepared = await service.prepareExport({
      query: query(),
      personalStudy: personal,
      format: 'json',
      detail: 'summary',
      sectionIds: ['hero', 'focus', 'tasks']
    })
    const exported = JSON.parse(prepared.content) as { query: Record<string, unknown>; sections: { hero: { data: { focusSeconds: number } }; focus: { data: { sessionStructure: { focusSeconds: number } } }; tasks: { data: { current: { completed: number } } } } }

    expect(exported.sections.hero.data.focusSeconds).toBe(dataOf(direct.hero).focusSeconds)
    expect(exported.sections.focus.data.sessionStructure.focusSeconds).toBe(dataOf(direct.focus).sessionStructure.focusSeconds)
    expect(exported.sections.tasks.data.current.completed).toBe(dataOf(direct.tasks).current.completed)
    expect(JSON.stringify(exported.query)).not.toContain('facts')
  })

  it('redacts export content and clears only analytics-owned data', async () => {
    const good = summary(runtime, 'ws-good')
    const service = makeService(runtime, workspaceScan(runtime, [good]), new Map(), { value: 0 })
    const prepared = await service.prepareExport({ query: query(), format: 'json', detail: 'summary', sectionIds: ['workspace_assets', 'tokens'] })
    expect(prepared.content).not.toContain('Secret')
    expect(prepared.content).not.toContain('absolutePath')
    expect(prepared.content).not.toContain('fixture-secret')
    await mkdir(join(runtime.userDataDir, 'analytics', 'cache'), { recursive: true })
    const sourcePath = join(runtime.workspaceDir, ledgerRelativePath)
    await mkdir(join(runtime.workspaceDir, '.studiumx'), { recursive: true })
    await writeFile(sourcePath, 'source ledger fixture')
    await service.clearLearningAnalytics({ targets: ['derived_cache'], confirmed: true })
    await expect(stat(sourcePath)).resolves.toBeDefined()
    await expect(stat(join(runtime.userDataDir, 'analytics', 'cache'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

