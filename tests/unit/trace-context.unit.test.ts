import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { saveAgentConversationArchive } from '../../src/main/agent-conversation-archive'
import {
  LearningWorkLedger,
  readLearningWorkLedgerLines
} from '../../src/main/learning-work-ledger'
import { buildLearningWorkEvidenceSnapshot } from '../../src/main/learning-work-ledger/evidence-snapshot'
import { parseAgentConversationRecordSource } from '../../src/main/teaching-agent-conversations'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'

const traceId = '123e4567-e89b-42d3-a456-426614174000'
const secondTraceId = '123e4567-e89b-42d3-a456-426614174001'
const workspace = { id: 'trace-workspace', name: 'Trace workspace' }
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function conversation(overrides: Partial<AgentConversationRecord> = {}): AgentConversationRecord {
  return {
    id: 'trace-conversation',
    workspaceId: workspace.id,
    title: 'Trace a save',
    createdAt: '2026-07-18T01:00:00.000Z',
    updatedAt: '2026-07-18T01:05:00.000Z',
    relativePath: 'conversation/2026/07/trace-conversation.md',
    absolutePath: '/workspace/conversation/2026/07/trace-conversation.md',
    messageCount: 2,
    turns: [
      { id: 'turn-user', role: 'user', content: 'Question', createdAt: '2026-07-18T01:00:00.000Z' },
      { id: 'turn-assistant', role: 'assistant', content: 'Answer', createdAt: '2026-07-18T01:01:00.000Z' }
    ],
    ...overrides
  }
}

describe('C-5 trace context persistence', () => {
  it('adds trace metadata without changing learning-work idempotency identity', () => {
    const withoutTrace = buildLearningWorkEvidenceSnapshot(workspace, conversation())
    const withTrace = buildLearningWorkEvidenceSnapshot(workspace, conversation({ traceId }))

    expect(withTrace.traceId).toBe(traceId)
    expect(withTrace.entryId).toBe(withoutTrace.entryId)
  })

  it('omits malformed trace text at archive and ledger writer boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-invalid-trace-'))
    roots.push(root)
    const malformedTraceId = 'Authorization: Bearer sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345'
    const archiveWorkspace = { ...workspace, rootPath: root }
    const archived = conversation({ traceId: malformedTraceId })

    await saveAgentConversationArchive({ workspace: archiveWorkspace, record: archived })

    const canonical = JSON.parse(await readFile(join(root, 'conversation/2026/07/trace-conversation.json'), 'utf8')) as { traceId?: string }
    const [archiveLedgerLine] = await readLearningWorkLedgerLines(root)
    expect(canonical.traceId).toBeUndefined()
    expect((JSON.parse(archiveLedgerLine!) as { traceId?: string }).traceId).toBeUndefined()
    expect(await readFile(join(root, 'conversation/2026/07/trace-conversation.json'), 'utf8')).not.toContain(malformedTraceId)
    expect(archiveLedgerLine).not.toContain(malformedTraceId)

    const directLedgerConversation = conversation({
      id: 'trace-direct-ledger',
      relativePath: 'conversation/2026/07/trace-direct-ledger.md',
      absolutePath: join(root, 'conversation/2026/07/trace-direct-ledger.md'),
      traceId: malformedTraceId
    })
    await LearningWorkLedger.appendSnapshot({ rootPath: root, workspace, conversation: directLedgerConversation })

    const directLedgerLine = (await readLearningWorkLedgerLines(root)).find((line) => line.includes('trace-direct-ledger'))
    expect(directLedgerLine).toBeDefined()
    expect((JSON.parse(directLedgerLine!) as { traceId?: string }).traceId).toBeUndefined()
    expect(directLedgerLine).not.toContain(malformedTraceId)
  })

  it('rejects a same-identity ledger invocation with a different trace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-ledger-trace-collision-'))
    roots.push(root)
    const first = conversation({ traceId })
    const colliding = conversation({ traceId: secondTraceId })

    await LearningWorkLedger.appendSnapshot({ rootPath: root, workspace, conversation: first })
    await expect(LearningWorkLedger.appendSnapshot({ rootPath: root, workspace, conversation: colliding }))
      .rejects.toThrow('identity is already bound to a different trace')

    const ledger = (await readLearningWorkLedgerLines(root)).map((line) => JSON.parse(line) as { traceId?: string })
    expect(ledger).toEqual([expect.objectContaining({ traceId })])
  })

  it('rejects a same-identity archive invocation with a different trace before canonical overwrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-trace-collision-'))
    roots.push(root)
    const archiveWorkspace = { ...workspace, rootPath: root }
    const first = conversation({ traceId })
    const colliding = conversation({ traceId: secondTraceId })

    await saveAgentConversationArchive({ workspace: archiveWorkspace, record: first })
    await expect(saveAgentConversationArchive({ workspace: archiveWorkspace, record: colliding }))
      .rejects.toThrow('identity is already bound to a different trace')

    const canonical = JSON.parse(await readFile(join(root, 'conversation/2026/07/trace-conversation.json'), 'utf8')) as { traceId?: string }
    const ledger = (await readLearningWorkLedgerLines(root)).map((line) => JSON.parse(line) as { traceId?: string })
    expect(canonical.traceId).toBe(traceId)
    expect(ledger).toEqual([expect.objectContaining({ traceId })])
  })

  it('keeps legacy canonical conversation records readable with missing trace metadata', async () => {
    const parsed = await parseAgentConversationRecordSource(
      '/workspace',
      'conversation/2026/07/trace-conversation.json',
      JSON.stringify({
        version: 2,
        workspaceId: workspace.id,
        id: 'trace-conversation',
        title: 'Legacy conversation',
        createdAt: '2026-07-18T01:00:00.000Z',
        updatedAt: '2026-07-18T01:01:00.000Z',
        relativePath: 'conversation/2026/07/trace-conversation.md',
        turns: []
      })
    )

    expect(parsed.traceId).toBeUndefined()
  })

  it('reads legacy learning-work JSONL unchanged when trace metadata is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-legacy-trace-'))
    roots.push(root)
    await mkdir(join(root, '.studiumx'), { recursive: true })
    const legacyLine = JSON.stringify({
      version: 1,
      entryId: 'learning-work:legacy:stable',
      type: 'conversation_snapshot',
      createdAt: '2026-07-17T00:00:00.000Z',
      status: 'completed'
    })
    await writeFile(join(root, '.studiumx', 'learning-work.jsonl'), `${legacyLine}\n`)

    const [line] = await readLearningWorkLedgerLines(root)
    expect(JSON.parse(line!) as { traceId?: string }).toMatchObject({ entryId: 'learning-work:legacy:stable' })
    expect((JSON.parse(line!) as { traceId?: string }).traceId).toBeUndefined()
  })
})
