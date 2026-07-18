import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../../src/shared/agent-conversation-catalog'
import { Logger, parseLoggerLine } from '../../src/main/logger'
import { parseAgentConversationSessionAuditLines } from '../../src/main/agent-conversation-session-audit'
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
const LOWERCASE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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

  it('traces workspace creation and first import without mutating an existing import lifecycle row', async () => {
    const runtime = await runtimeScope.create('activation-lifecycle-trace-propagation')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })

    const created = (await service.createWorkspace({
      name: 'Activation trace workspace',
      prompt: 'Persist activation trace metadata.'
    })).activeWorkspace!
    const createEvents = (await readWorkspaceLifecycleEvents(created.rootPath))
      .filter((event) => event.kind === 'workspace_created' && event.workspaceId === created.id)
    expect(createEvents).toHaveLength(1)
    expect(createEvents[0]).toEqual(expect.objectContaining({
      kind: 'workspace_created',
      workspaceId: created.id,
      traceId: expect.stringMatching(LOWERCASE_UUID_RE)
    }))

    const importedRoot = join(runtime.paths.workspace, 'first-import')
    await mkdir(importedRoot, { recursive: true })
    const imported = (await service.importWorkspace(importedRoot)).activeWorkspace!
    const initialImportEvents = (await readWorkspaceLifecycleEvents(imported.rootPath))
      .filter((event) => event.kind === 'workspace_imported' && event.workspaceId === imported.id)
    expect(initialImportEvents).toHaveLength(1)
    const initialImportTrace = initialImportEvents[0]?.traceId
    expect(initialImportTrace).toMatch(LOWERCASE_UUID_RE)
    const sessionsPath = join(imported.rootPath, '.studiumx', 'sessions.jsonl')
    const sessionsBeforeReimport = await readFile(sessionsPath, 'utf8')

    const reimported = (await service.importWorkspace(importedRoot)).activeWorkspace!
    expect(reimported).toMatchObject({ id: imported.id, rootPath: importedRoot })
    const reimportEvents = (await readWorkspaceLifecycleEvents(reimported.rootPath))
      .filter((event) => event.kind === 'workspace_imported' && event.workspaceId === imported.id)
    expect(reimportEvents).toHaveLength(1)
    expect(reimportEvents[0]?.traceId).toBe(initialImportTrace)
    expect(await readFile(sessionsPath, 'utf8')).toBe(sessionsBeforeReimport)
  })

  it('correlates a normal managed fork child across canonical JSON, learning-work JSONL, and lifecycle events', async () => {
    const runtime = await runtimeScope.create('fork-child-trace-propagation')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const workspace = (await service.createWorkspace({
      name: 'Fork child trace workspace',
      prompt: 'Persist child fork correlations.'
    })).activeWorkspace!
    const parentSave = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'teaching',
      turns: [
        { id: 'fork-parent-user', role: 'user', content: 'Parent question', createdAt: '2026-07-18T05:00:00.000Z' },
        { id: 'fork-parent-assistant', role: 'assistant', content: 'Parent answer', createdAt: '2026-07-18T05:01:00.000Z' }
      ]
    })
    const parentJsonPath = join(
      workspace.rootPath,
      agentConversationJsonRelativePathForMarkdown(parentSave.conversation.relativePath)
    )
    const parentCanonical = JSON.parse(await readFile(parentJsonPath, 'utf8')) as Omit<AgentConversationRecord, 'absolutePath' | 'messageCount'>
    expect(parentCanonical.traceId).toMatch(UUID_RE)

    const fork = await service.forkAgentConversationBranch({
      workspaceId: workspace.id,
      conversationId: parentSave.conversation.id,
      sourceTurnId: 'fork-parent-assistant',
      expectedRevision: parentSave.conversation.branch!.revision
    })
    const childJsonPath = join(
      workspace.rootPath,
      agentConversationJsonRelativePathForMarkdown(fork.conversation.relativePath)
    )
    const childCanonical = JSON.parse(await readFile(childJsonPath, 'utf8')) as Omit<AgentConversationRecord, 'absolutePath' | 'messageCount'>
    expect(childCanonical.traceId).toMatch(UUID_RE)
    expect(childCanonical.traceId).not.toBe(parentCanonical.traceId)
    expect(childCanonical.branch).toMatchObject({
      parentBranchId: parentSave.conversation.id,
      branchId: fork.conversation.id
    })

    const canonicalByConversationId = new Map([
      [parentCanonical.id, { ...parentCanonical, absolutePath: parentJsonPath }],
      [childCanonical.id, { ...childCanonical, absolutePath: childJsonPath }]
    ].map(([conversationId, canonical]) => [conversationId, {
      ...canonical,
      messageCount: canonical.turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length
    }] as const))
    const expectedLedgerTraceByEntryId = new Map([...canonicalByConversationId.values()].map((canonical) => [
      buildLearningWorkLedgerEntry(workspace, canonical).entryId,
      canonical.traceId
    ]))
    const ledgerTraceByEntryId = new Map((await readLearningWorkLedgerLines(workspace.rootPath))
      .map((line) => JSON.parse(line) as { entryId: string; traceId?: string })
      .map((entry) => [entry.entryId, entry.traceId]))
    expect(ledgerTraceByEntryId).toEqual(expectedLedgerTraceByEntryId)

    // Lifecycle JSONL is append-only. Associate each event through its archive
    // paths rather than its line position or the order of the service calls.
    const conversationIdByArchivePath = new Map([...canonicalByConversationId.values()].flatMap((canonical) => [
      [canonical.relativePath, canonical.id] as const,
      [agentConversationJsonRelativePathForMarkdown(canonical.relativePath), canonical.id] as const
    ]))
    const lifecycleByConversationId = new Map<string, Array<string | undefined>>()
    for (const event of (await readWorkspaceLifecycleEvents(workspace.rootPath))
      .filter((event) => event.kind === 'agent_conversation_recorded')) {
      const conversationId = event.paths
        ?.map((path) => conversationIdByArchivePath.get(path))
        .find((candidate): candidate is string => candidate !== undefined)
      if (!conversationId) continue
      const traces = lifecycleByConversationId.get(conversationId) ?? []
      traces.push(event.traceId)
      lifecycleByConversationId.set(conversationId, traces)
    }
    expect(lifecycleByConversationId.get(parentCanonical.id)).toEqual([parentCanonical.traceId])
    expect(lifecycleByConversationId.get(childCanonical.id)).toEqual([childCanonical.traceId])
  })

  it('keeps audit header and durable rows trace-stable across an agent conversation continuation', async () => {
    const runtime = await runtimeScope.create('agent-conversation-audit-trace-continuation')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const workspace = (await service.createWorkspace({
      name: 'Audit trace continuation workspace',
      prompt: 'Persist audit trace continuity.'
    })).activeWorkspace!
    const initialTurns = [
      { id: 'audit-user-1', role: 'user' as const, content: 'Initial audit question', createdAt: '2026-07-18T04:00:00.000Z' },
      { id: 'audit-assistant-1', role: 'assistant' as const, content: 'Initial audit answer', createdAt: '2026-07-18T04:01:00.000Z' }
    ]
    const initialSave = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'teaching',
      turns: initialTurns
    })
    const jsonPath = join(
      workspace.rootPath,
      agentConversationJsonRelativePathForMarkdown(initialSave.conversation.relativePath)
    )
    const auditPath = join(
      workspace.rootPath,
      agentConversationSessionAuditRelativePathForMarkdown(initialSave.conversation.relativePath)
    )
    const initialCanonical = JSON.parse(await readFile(jsonPath, 'utf8')) as Omit<AgentConversationRecord, 'absolutePath' | 'messageCount'>
    const initialTrace = initialCanonical.traceId
    expect(initialTrace).toMatch(UUID_RE)
    const initialAudit = parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8'))
    const initialAuditEntries = initialAudit.filter((line) => line.type !== 'session')
    expect(initialAudit.find((line) => line.type === 'session')?.traceId).toBe(initialTrace)
    expect(initialAuditEntries.every((entry) => entry.traceId === initialTrace)).toBe(true)

    const continuationSave = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'teaching',
      conversationId: initialSave.conversation.id,
      expectedBranchRevision: initialSave.conversation.branch!.revision,
      turns: [
        ...initialTurns,
        { id: 'audit-user-2', role: 'user', content: 'Continuation audit question', createdAt: '2026-07-18T04:02:00.000Z' },
        { id: 'audit-assistant-2', role: 'assistant', content: 'Continuation audit answer', createdAt: '2026-07-18T04:03:00.000Z' }
      ]
    })
    const continuedCanonical = JSON.parse(await readFile(jsonPath, 'utf8')) as Omit<AgentConversationRecord, 'absolutePath' | 'messageCount'>
    const continuedTrace = continuedCanonical.traceId
    expect(continuedTrace).toMatch(UUID_RE)
    expect(continuedTrace).not.toBe(initialTrace)

    const continuedAudit = parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8'))
    const continuedAuditEntries = continuedAudit.filter((line) => line.type !== 'session')
    const continuedAuditById = new Map(continuedAuditEntries.map((entry) => [entry.id, entry]))
    expect(continuedAudit.find((line) => line.type === 'session')?.traceId).toBe(initialTrace)
    expect(initialAuditEntries.every((entry) => continuedAuditById.get(entry.id)?.traceId === initialTrace)).toBe(true)
    const newAuditEntries = continuedAuditEntries.filter((entry) => !initialAuditEntries.some((initialEntry) => initialEntry.id === entry.id))
    expect(newAuditEntries.map((entry) => entry.id).sort()).toEqual(['turn:audit-assistant-2', 'turn:audit-user-2'])
    expect(newAuditEntries.every((entry) => entry.traceId === continuedTrace)).toBe(true)

    const initialLedgerRecord: AgentConversationRecord = {
      ...initialCanonical,
      absolutePath: jsonPath,
      messageCount: initialCanonical.turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length
    }
    const continuedLedgerRecord: AgentConversationRecord = {
      ...continuedCanonical,
      absolutePath: jsonPath,
      messageCount: continuedCanonical.turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length
    }
    const expectedLedgerTraceByEntryId = new Map([
      [buildLearningWorkLedgerEntry(workspace, initialLedgerRecord).entryId, initialTrace],
      [buildLearningWorkLedgerEntry(workspace, continuedLedgerRecord).entryId, continuedTrace]
    ])
    const ledgerTraceByEntryId = new Map((await readLearningWorkLedgerLines(workspace.rootPath))
      .map((line) => JSON.parse(line) as { entryId: string; traceId?: string })
      .map((entry) => [entry.entryId, entry.traceId]))
    expect(ledgerTraceByEntryId).toEqual(expectedLedgerTraceByEntryId)

    const lifecycleTraces = (await readWorkspaceLifecycleEvents(workspace.rootPath))
      .filter((event) => event.kind === 'agent_conversation_recorded')
      .filter((event) => event.paths?.includes(initialSave.conversation.relativePath))
      .map((event) => event.traceId)
    expect(new Set(lifecycleTraces)).toEqual(new Set([initialTrace, continuedTrace]))
    expect(lifecycleTraces).toHaveLength(2)
    expect(continuationSave.conversation.id).toBe(initialSave.conversation.id)
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
