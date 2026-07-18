import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { agentConversationJsonRelativePathForMarkdown } from '../../src/shared/agent-conversation-catalog'
import { Logger, parseLoggerLine } from '../../src/main/logger'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { buildLearningWorkLedgerEntry, readLearningWorkLedgerLines } from '../../src/main/learning-work-ledger'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { readWorkspaceLifecycleEvents } from '../../src/main/teaching-workspace/lifecycle'
import { TeachingMemoryCatalog } from '../../src/main/teaching-memory-catalog'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'

const runtimeScope = createVitestRuntimeScope()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('C-5 archive trace propagation', () => {
  it('correlates concurrent saves across canonical JSON, learning-work JSONL, and safe tagged logs', async () => {
    const runtime = await runtimeScope.create('trace-propagation')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const logger = new Logger({ userDataPath: runtime.paths.userData, enabled: true, retentionDays: 7 })
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot),
      logger
    })
    const workspace = (await service.createWorkspace({ name: 'Trace workspace', prompt: 'Trace archive propagation.' })).activeWorkspace!

    const [first, second] = await Promise.all([
      service.saveAgentConversation({
        workspaceId: workspace.id,
        mode: 'teaching',
        turns: [
          { id: 'first-user', role: 'user', content: 'First question', createdAt: '2026-07-18T02:00:00.000Z' },
          { id: 'first-assistant', role: 'assistant', content: 'First answer', createdAt: '2026-07-18T02:01:00.000Z' }
        ]
      }),
      service.saveAgentConversation({
        workspaceId: workspace.id,
        mode: 'teaching',
        turns: [
          { id: 'second-user', role: 'user', content: 'Second question', createdAt: '2026-07-18T02:02:00.000Z' },
          { id: 'second-assistant', role: 'assistant', content: 'Second answer', createdAt: '2026-07-18T02:03:00.000Z' }
        ]
      })
    ])

    const persisted = await Promise.all([first, second].map(async ({ conversation }) => {
      const jsonPath = join(workspace.rootPath, agentConversationJsonRelativePathForMarkdown(conversation.relativePath))
      const canonical = JSON.parse(await readFile(jsonPath, 'utf8')) as Omit<AgentConversationRecord, 'absolutePath' | 'messageCount'>
      return {
        ...canonical,
        absolutePath: jsonPath,
        messageCount: canonical.turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length
      }
    }))
    const canonicalTraceByConversation = new Map(persisted.map((record) => [record.id, record.traceId]))
    const canonicalConversationsById = new Map(persisted.map((record) => [record.id, record]))
    const expectedConversationIds = [first.conversation.id, second.conversation.id].sort()
    expect([...canonicalTraceByConversation.keys()].sort()).toEqual(expectedConversationIds)
    expect([...canonicalTraceByConversation.values()].every((traceId) => typeof traceId === 'string' && UUID_RE.test(traceId))).toBe(true)
    expect(new Set(canonicalTraceByConversation.values()).size).toBe(2)

    // Ledger conversation ids remain privacy-filtered, so use the stable ledger
    // identity derived for each canonical conversation to compare correlations.
    const expectedLedgerTraceByEntryId = new Map([...canonicalTraceByConversation].map(([conversationId, canonicalTraceId]) => {
      const conversation = canonicalConversationsById.get(conversationId)!
      return [buildLearningWorkLedgerEntry(workspace, conversation).entryId, canonicalTraceId]
    }))
    const ledger = (await readLearningWorkLedgerLines(workspace.rootPath))
      .map((line) => JSON.parse(line) as { entryId: string; traceId?: string })
    const ledgerTraceByEntryId = new Map(ledger.map((entry) => [entry.entryId, entry.traceId]))
    expect(ledger).toHaveLength(2)
    expect([...ledgerTraceByEntryId.keys()].sort()).toEqual([...expectedLedgerTraceByEntryId.keys()].sort())
    expect(ledgerTraceByEntryId).toEqual(expectedLedgerTraceByEntryId)

    // Lifecycle rows are append-only and concurrent saves can race, so resolve
    // each row through its archived conversation paths rather than JSONL order.
    const conversationIdByArchivePath = new Map(persisted.flatMap((record) => [
      [record.relativePath, record.id] as const,
      [agentConversationJsonRelativePathForMarkdown(record.relativePath), record.id] as const
    ]))
    const lifecycleTraceByConversation = new Map<string, string | undefined>()
    const lifecycleEvents = (await readWorkspaceLifecycleEvents(workspace.rootPath))
      .filter((event) => event.kind === 'agent_conversation_recorded')
    expect(lifecycleEvents).toHaveLength(2)
    for (const event of lifecycleEvents) {
      const conversationId = event.paths
        ?.map((path) => conversationIdByArchivePath.get(path))
        .find((candidate): candidate is string => candidate !== undefined)
      expect(conversationId).toBeDefined()
      if (conversationId) lifecycleTraceByConversation.set(conversationId, event.traceId)
    }
    expect([...lifecycleTraceByConversation.keys()].sort()).toEqual(expectedConversationIds)
    expect(lifecycleTraceByConversation).toEqual(canonicalTraceByConversation)

    const archiveLogs = (await logger.readTail(20_000)).split('\n')
      .map(parseLoggerLine)
      .filter((line): line is NonNullable<typeof line> => line?.tag === 'agent-archive')
    const archiveLogTraces = archiveLogs.map((line) => line.traceId).sort()
    const expectedTraceIds = [...canonicalTraceByConversation.values()].sort()
    expect(archiveLogs).toHaveLength(2)
    expect(archiveLogTraces).toEqual(expectedTraceIds)
    expect(archiveLogs).toEqual(expect.arrayContaining(expectedTraceIds.map((traceId) => expect.objectContaining({
      component: 'main',
      tag: 'agent-archive',
      traceId,
      message: 'Conversation archive persisted.'
    }))))
    for (const [conversationId, canonicalTraceId] of canonicalTraceByConversation) {
      const conversation = canonicalConversationsById.get(conversationId)!
      const ledgerEntryId = buildLearningWorkLedgerEntry(workspace, conversation).entryId
      expect(lifecycleTraceByConversation.get(conversationId)).toBe(canonicalTraceId)
      expect(ledgerTraceByEntryId.get(ledgerEntryId)).toBe(canonicalTraceId)
      expect(archiveLogs).toContainEqual(expect.objectContaining({
        component: 'main',
        tag: 'agent-archive',
        traceId: canonicalTraceId,
        message: 'Conversation archive persisted.'
      }))
    }

    await logger.shutdown()
  })

  it('assigns distinct main-generated traces to concurrent Memory CRUD mutations and emits redacted tagged logs', async () => {
    const runtime = await runtimeScope.create('memory-trace-propagation')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const logger = new Logger({ userDataPath: runtime.paths.userData, enabled: true, retentionDays: 7 })
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot),
      logger
    })
    const memoryContent = 'Sensitive memory content must not be logged.'
    const [first, second] = await Promise.all([
      service.createMemory({ content: memoryContent, scope: 'user' }),
      service.createMemory({ content: 'A distinct concurrent memory.', scope: 'user' })
    ])
    const updated = await service.updateMemory(first.id, { content: 'Updated sensitive Memory content.' })
    await service.deleteMemory(second.id)

    const catalog = new TeachingMemoryCatalog(join(runtime.paths.appData, 'memory'))
    const records = await catalog.list({ includeDeleted: true })
    const byId = new Map(records.map((record) => [record.id, record]))
    expect(byId.get(first.id)).toMatchObject({ traceId: updated.traceId })
    expect(byId.get(first.id)?.deletedAt).toBeUndefined()
    expect(byId.get(second.id)).toMatchObject({ deletedAt: expect.any(String) })

    const memoryLogs = (await logger.readTail(20_000)).split('\n')
      .map(parseLoggerLine)
      .filter((line): line is NonNullable<typeof line> => line?.tag === 'memory-catalog')
    expect(memoryLogs).toHaveLength(4)
    expect(memoryLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: 'main', tag: 'memory-catalog', message: 'Memory created.' }),
      expect.objectContaining({ component: 'main', tag: 'memory-catalog', message: 'Memory updated.', traceId: updated.traceId }),
      expect.objectContaining({ component: 'main', tag: 'memory-catalog', message: 'Memory deleted.', traceId: byId.get(second.id)?.traceId })
    ]))
    const mutationTraceIds = memoryLogs.map((line) => line.traceId)
    expect(mutationTraceIds.every((traceId) => typeof traceId === 'string' && UUID_RE.test(traceId))).toBe(true)
    expect(new Set(mutationTraceIds).size).toBe(4)
    expect(byId.get(first.id)?.traceId).toBe(updated.traceId)
    expect(byId.get(second.id)?.traceId).toBe(memoryLogs.find((line) => line.message === 'Memory deleted.')?.traceId)
    expect((await logger.readTail(20_000))).not.toContain(memoryContent)

    await logger.shutdown()
  })


  it('correlates independent trusted preview events, preserves retry provenance, and emits redacted logs', async () => {
    const runtime = await runtimeScope.create('learning-session-trace-propagation')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const logger = new Logger({ userDataPath: runtime.paths.userData, enabled: true, retentionDays: 7 })
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot),
      logger
    })
    const workspace = (await service.createWorkspace({
      name: 'Learning session trace workspace',
      prompt: 'Persist trace-safe lesson evidence.'
    })).activeWorkspace!
    // Create the Session before binding either preview. This avoids setup work
    // invalidating an otherwise active preview authority.
    const lesson = (await service.generateLesson({
      workspaceId: workspace.id,
      prompt: 'Traceable lesson',
      messages: []
    })).lesson
    const firstPreview = await service.readLesson({ workspaceId: workspace.id, lessonPath: lesson.relativePath }, 701)
    const secondPreview = await service.readLesson({ workspaceId: workspace.id, lessonPath: lesson.relativePath }, 702)
    service.observePreviewLessonNavigation(701, {
      url: firstPreview.url,
      isMainFrame: false,
      isSameDocument: false,
      frameProcessId: 701,
      frameRoutingId: 1701
    })
    service.observePreviewLessonNavigation(702, {
      url: secondPreview.url,
      isMainFrame: false,
      isSameDocument: false,
      frameProcessId: 702,
      frameRoutingId: 1702
    })

    const [firstReceipt, secondReceipt] = await Promise.all([
      service.recordPreviewLessonInteraction(701, {
        eventId: 'trace-preview-first-001',
        kind: 'lesson_opened',
        itemId: lesson.id
      }),
      service.recordPreviewLessonInteraction(702, {
        eventId: 'trace-preview-second-001',
        kind: 'lesson_opened',
        itemId: lesson.id
      })
    ])
    expect(firstReceipt.duplicate).toBe(false)
    expect(secondReceipt.duplicate).toBe(false)

    const ledger = createLearningSessionLedger({ workspaceRoot: workspace.rootPath })
    const beforeRetry = await ledger.load(lesson.sessionId)
    const tracesByEventId = new Map((beforeRetry?.events ?? []).map((event) => [event.eventId, event.traceId]))
    const firstTrace = tracesByEventId.get(firstReceipt.eventId)
    const secondTrace = tracesByEventId.get(secondReceipt.eventId)
    expect(firstTrace).toMatch(UUID_RE)
    expect(secondTrace).toMatch(UUID_RE)
    expect(firstTrace).not.toBe(secondTrace)

    const retry = await service.recordPreviewLessonInteraction(701, {
      eventId: 'trace-preview-first-001',
      kind: 'lesson_opened',
      itemId: lesson.id
    })
    expect(retry).toEqual({ ...firstReceipt, duplicate: true })
    const afterRetry = await ledger.load(lesson.sessionId)
    expect(afterRetry?.events).toHaveLength(2)
    expect(afterRetry?.events.find((event) => event.eventId === firstReceipt.eventId)?.traceId).toBe(firstTrace)

    const sessionLogs = (await logger.readTail(20_000)).split('\n')
      .map(parseLoggerLine)
      .filter((line): line is NonNullable<typeof line> => line?.tag === 'learning-session-ledger')
    expect(sessionLogs).toHaveLength(2)
    expect(sessionLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        component: 'main',
        tag: 'learning-session-ledger',
        message: 'Learning Session event persisted.',
        traceId: firstTrace
      }),
      expect.objectContaining({
        component: 'main',
        tag: 'learning-session-ledger',
        message: 'Learning Session event persisted.',
        traceId: secondTrace
      })
    ]))
    expect(sessionLogs.map((line) => line.traceId).sort()).toEqual([firstTrace, secondTrace].sort())
    expect((await logger.readTail(20_000))).not.toContain('Traceable lesson')

    await logger.shutdown()
  })

})
