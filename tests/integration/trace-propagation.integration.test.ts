import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { agentConversationJsonRelativePathForMarkdown } from '../../src/shared/agent-conversation-catalog'
import { Logger, parseLoggerLine } from '../../src/main/logger'
import { buildLearningWorkLedgerEntry, readLearningWorkLedgerLines } from '../../src/main/learning-work-ledger'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
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

})
