import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { agentConversationJsonRelativePathForMarkdown } from '../../src/shared/agent-conversation-catalog'
import { Logger, parseLoggerLine } from '../../src/main/logger'
import { buildLearningWorkLedgerEntry, readLearningWorkLedgerLines } from '../../src/main/learning-work-ledger'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
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
})
