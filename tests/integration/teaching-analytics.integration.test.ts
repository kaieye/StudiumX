import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIsolatedTestRuntime, type IsolatedTestRuntime } from '../helpers/runtime-isolation'
import type {
  AgentConversationRecord,
  LearningAnalyticsQuery,
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
    generator: { providerId: 'provider-1', model: 'fixture-model', endpointFormat: 'openai_compatible', temperature: 0.2, maxOutputTokens: 100, lessonDurationMinutes: 30, includeRetrievalPractice: true, generateReference: true, generateLearningRecord: true, structuredOutput: true, streaming: true, reasoningEffort: 'low', requestTimeoutMs: 1000 },
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

function makeService(runtime: IsolatedTestRuntime, scans: AnalyticsWorkspaceScanResult[], records: Map<string, AgentConversationRecord>, readCount: { value: number }) {
  const skills: SkillCatalogResult = { rootPath: runtime.rootDir, skills: [] }
  const diagnostics: TeachingMemoryDiagnostics = { enabled: true, rootDir: runtime.rootDir, activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] }
  return new LearningAnalyticsService({
    appDataRoot: runtime.userDataDir,
    listWorkspaceSummaries: async () => scans,
    readConversation: async (_workspaceId, conversationId) => {
      readCount.value += 1
      const record = records.get(conversationId)
      if (!record) throw new Error('missing fixture')
      return record
    },
    getProgress: async (workspaceId) => ({ workspaceId, progress: { totalAnswered: 2, correct: 1, byLesson: {} } }),
    listReviewCards: async () => ({ cards: [] }),
    listMemory: async () => [],
    getMemoryDiagnostics: async () => diagnostics,
    listSkills: async () => skills,
    loadSettings: async () => settings(runtime),
    listWorkspaceChanges: async () => []
  })
}

let runtime: IsolatedTestRuntime
beforeEach(async () => { runtime = await createIsolatedTestRuntime('teaching-analytics') })
afterEach(async () => { await runtime.cleanup() })

describe('teaching analytics integration', () => {
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

