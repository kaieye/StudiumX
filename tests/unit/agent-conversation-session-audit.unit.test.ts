import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  appendAgentConversationSessionAuditLog,
  buildAgentConversationSessionAuditEntries,
  parseAgentConversationSessionAuditLines
} from '../../src/main/agent-conversation-session-audit'
import { agentConversationSessionAuditRelativePathForMarkdown } from '../../src/shared/agent-conversation-catalog'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'

const TRACE_A_UPPER = '11111111-1111-4111-8111-111111111111'.toUpperCase()
const TRACE_A = TRACE_A_UPPER.toLowerCase()
const TRACE_B = '22222222-2222-4222-8222-222222222222'
const createdRoots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-session-audit-'))
  createdRoots.push(root)
  return root
}

function createRecord(input: {
  traceId?: string
  turns?: AgentConversationRecord['turns']
  updatedAt?: string
} = {}): AgentConversationRecord {
  const turns = input.turns ?? [
    { id: 'turn-one', role: 'user', content: 'Initial question', createdAt: '2026-07-18T00:00:00.000Z' },
    { id: 'turn-two', role: 'assistant', content: 'Initial answer', createdAt: '2026-07-18T00:01:00.000Z' }
  ]
  return {
    id: 'chat-audit-trace',
    workspaceId: 'workspace-audit-trace',
    title: 'Audit trace test',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-07-18T00:01:00.000Z',
    relativePath: 'conversation/chat-audit-trace.md',
    absolutePath: '/unused/conversation/chat-audit-trace.md',
    messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
    traceId: input.traceId,
    turns
  }
}

async function readAudit(rootPath: string, record: AgentConversationRecord): Promise<string> {
  return readFile(join(rootPath, agentConversationSessionAuditRelativePathForMarkdown(record.relativePath)), 'utf8')
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('agent conversation session audit trace persistence', () => {
  it('writes a normalized initial trace once, preserves retry rows, and traces only continuation rows', async () => {
    const root = await createRoot()
    const initial = createRecord({ traceId: TRACE_A_UPPER })
    const initialWithoutTrace = createRecord()
    const expectedEntryIdentity = buildAgentConversationSessionAuditEntries(initialWithoutTrace)
      .map(({ type, id, parentId }) => ({ type, id, parentId }))

    await appendAgentConversationSessionAuditLog({ rootPath: root, record: initial })
    const initialRaw = await readAudit(root, initial)
    const initialLines = parseAgentConversationSessionAuditLines(initialRaw)
    const initialEntries = initialLines.filter((line) => line.type !== 'session')
    const header = initialLines.find((line) => line.type === 'session')

    expect(header).toMatchObject({ version: 1, traceId: TRACE_A })
    expect(initialEntries).toHaveLength(expectedEntryIdentity.length)
    expect(initialEntries.map(({ type, id, parentId }) => ({ type, id, parentId }))).toEqual(expectedEntryIdentity)
    expect(initialEntries.every((entry) => entry.traceId === TRACE_A)).toBe(true)

    await appendAgentConversationSessionAuditLog({
      rootPath: root,
      record: { ...initial, traceId: TRACE_B }
    })
    expect(await readAudit(root, initial)).toBe(initialRaw)

    const continuation = createRecord({
      traceId: TRACE_B,
      updatedAt: '2026-07-18T00:02:00.000Z',
      turns: [
        ...initial.turns,
        { id: 'turn-three', role: 'user', content: 'Follow-up question', createdAt: '2026-07-18T00:02:00.000Z' }
      ]
    })
    await appendAgentConversationSessionAuditLog({ rootPath: root, record: continuation })
    const continuedLines = parseAgentConversationSessionAuditLines(await readAudit(root, continuation))
    const continuedEntries = continuedLines.filter((line) => line.type !== 'session')
    const byId = new Map(continuedEntries.map((entry) => [entry.id, entry]))

    expect(continuedLines.filter((line) => line.type === 'session')).toHaveLength(1)
    expect(continuedLines.find((line) => line.type === 'session')?.traceId).toBe(TRACE_A)
    expect(continuedEntries).toHaveLength(initialEntries.length + 1)
    expect(new Set(continuedEntries.map((entry) => entry.id)).size).toBe(continuedEntries.length)
    expect(initialEntries.every((entry) => byId.get(entry.id)?.traceId === TRACE_A)).toBe(true)
    expect(byId.get('turn:turn-three')).toMatchObject({
      parentId: 'turn:turn-two',
      traceId: TRACE_B
    })
  })

  it('tolerates legacy trace-free and malformed rows without backfilling or rewriting them', async () => {
    const root = await createRoot()
    const initial = createRecord()
    const continued = createRecord({
      traceId: TRACE_B,
      updatedAt: '2026-07-18T00:02:00.000Z',
      turns: [
        initial.turns[0]!,
        { id: 'turn-three', role: 'assistant', content: 'New durable entry', createdAt: '2026-07-18T00:02:00.000Z' }
      ]
    })
    const auditPath = join(root, agentConversationSessionAuditRelativePathForMarkdown(initial.relativePath))
    const legacy = [
      JSON.stringify({
        type: 'session',
        version: 1,
        id: initial.id,
        title: initial.title,
        createdAt: initial.createdAt,
        conversationRelativePath: initial.relativePath
      }),
      JSON.stringify({
        type: 'turn',
        id: 'turn:turn-one',
        parentId: null,
        timestamp: initial.turns[0]!.createdAt,
        turnId: 'turn-one',
        role: 'user',
        contentPreview: 'Initial question',
        contentBytes: 16,
        toolCallCount: 0,
        processEventCount: 0,
        traceId: 'Bearer historical-audit-secret'
      })
    ].join('\n') + '\n'
    await mkdir(join(root, 'conversation', '.agent-sessions'), { recursive: true })
    await writeFile(auditPath, legacy, 'utf8')

    await appendAgentConversationSessionAuditLog({ rootPath: root, record: continued })
    const raw = await readAudit(root, continued)
    const lines = parseAgentConversationSessionAuditLines(raw)

    expect(raw.startsWith(legacy)).toBe(true)
    expect(lines.find((line) => line.type === 'session')?.traceId).toBeUndefined()
    expect(lines.find((line) => line.id === 'turn:turn-one')?.traceId).toBe('Bearer historical-audit-secret')
    expect(lines.find((line) => line.id === 'turn:turn-three')).toMatchObject({ traceId: TRACE_B })
  })

  it.each([
    'not-a-uuid',
    'Bearer audit-secret-value',
    'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
  ])('omits malformed or secret-like trace input from raw JSONL (%s)', async (traceId) => {
    const root = await createRoot()
    const record = createRecord({ traceId })

    await appendAgentConversationSessionAuditLog({ rootPath: root, record })
    const raw = await readAudit(root, record)
    const lines = parseAgentConversationSessionAuditLines(raw)

    expect(raw).not.toContain(traceId)
    expect(lines.every((line) => line.traceId === undefined)).toBe(true)
  })
})
