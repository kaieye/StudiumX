import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildLearningWorkLedgerEntry,
  LEARNING_WORK_LEDGER_RELATIVE_PATH,
  LearningWorkLedger,
  readLearningWorkLedgerLines
} from '../../src/main/learning-work-ledger'
import { durableJsonlSealedSegmentFileName } from '../../src/main/durable-jsonl'
import type {
  AgentChatProcessEvent,
  AgentChatTurn,
  AgentConversationRecord
} from '../../src/shared/teaching-types'

const createdAt = '2026-07-14T10:00:00.000Z'
const updatedAt = '2026-07-14T10:05:00.000Z'
const workspace = { id: 'teaching-physics', name: 'Physics Teaching Workspace' }
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTeachingWorkspace(): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-learning-work-ledger-'))
  roots.push(rootPath)
  await mkdir(join(rootPath, 'courses', 'physics', 'conversation'), { recursive: true })
  await writeFile(join(rootPath, 'MISSION.md'), '# Physics\n', 'utf8')
  return rootPath
}

function event(
  id: string,
  overrides: Partial<AgentChatProcessEvent> = {}
): AgentChatProcessEvent {
  return {
    id,
    kind: 'status',
    title: id,
    createdAt: updatedAt,
    ...overrides
  }
}

function turn(overrides: Partial<AgentChatTurn> = {}): AgentChatTurn {
  return {
    id: 'turn-1',
    role: 'assistant',
    content: 'Compact answer',
    createdAt: updatedAt,
    ...overrides
  }
}

function conversation(id: string, turns: AgentChatTurn[]): AgentConversationRecord {
  const relativePath = `courses/physics/conversation/${id}.md`
  return {
    id,
    workspaceId: workspace.id,
    title: `Conversation ${id}`,
    createdAt,
    updatedAt,
    relativePath,
    absolutePath: relativePath,
    messageCount: turns.length,
    turns
  }
}

async function readLedger(rootPath: string): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH), 'utf8')
  return content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('LearningWorkLedger', () => {
  it('projects each terminal and waiting Agent conversation status into the local Teaching ledger', async () => {
    const rootPath = await createTeachingWorkspace()
    const snapshots = [
      conversation('completed', [turn({ processEvents: [event('done', { status: 'done' })] })]),
      conversation('failed', [turn({ processEvents: [event('failed', { status: 'error', isError: true })] })]),
      conversation('canceled', [turn({ processEvents: [event('canceled', { status: 'canceled' })] })]),
      conversation('permission-waiting', [turn({ processEvents: [event('permission', { kind: 'permission_request' })] })]),
      conversation('learner-waiting', [turn({ processEvents: [event('learner', { kind: 'elicitation_request' })] })]),
      conversation('running', [turn({ processEvents: [event('thinking', { status: 'thinking' })] })])
    ]

    for (const item of snapshots) {
      await LearningWorkLedger.appendSnapshot({ rootPath, workspace, conversation: item })
    }

    const entries = await readLedger(rootPath)
    expect(entries).toHaveLength(6)
    expect(entries.map((entry) => entry.status).sort()).toEqual([
      'canceled',
      'completed',
      'failed',
      'running',
      'waiting_for_learner',
      'waiting_for_permission'
    ])
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'conversation_snapshot',
        workspace,
        conversation: expect.objectContaining({
          relativePath: 'courses/physics/conversation/completed.md',
          jsonRelativePath: 'courses/physics/conversation/completed.json',
          sessionAuditRelativePath: 'courses/physics/conversation/.agent-sessions/completed.jsonl',
          courseRelativePath: 'courses/physics'
        }),
        pointers: expect.objectContaining({
          markdown: 'courses/physics/conversation/completed.md'
        })
      })
    ]))
  })

  it('caps and de-duplicates compact evidence without placing conversation content in JSONL', async () => {
    const rootPath = await createTeachingWorkspace()
    const sources = Array.from({ length: 45 }, (_, index) => ({
      sourceId: `source-${index}`,
      url: `https://example.test/${index}`,
      title: `Source ${index}`,
      provider: 'test',
      toolName: 'web_search'
    }))
    sources.push({ ...sources[0]!, title: 'Duplicate source should be ignored' })
    const item = conversation('evidence', [turn({
      content: 'This full conversation text must never be written to the learning-work ledger.',
      metadata: {
        version: 1,
        sources,
        childRuns: [
          { childRunId: 'child-1', label: 'Research', profile: 'research', status: 'completed', summary: 'first' },
          { childRunId: 'child-1', label: 'Duplicate', profile: 'research', status: 'completed', summary: 'second' }
        ],
        compactions: [
          { sourceDigest: 'digest-1', reason: 'budget', mode: 'summary' },
          { sourceDigest: 'digest-1', reason: 'duplicate', mode: 'summary' }
        ],
        toolResults: [
          { toolCallId: 'archive-1', toolName: 'read_file', bytes: 4, lines: 1, archive: { kind: 'tool_result', relativePath: 'artifacts/result.txt', sha256: 'a', bytes: 4 } },
          { toolCallId: 'archive-2', toolName: 'read_file', bytes: 4, lines: 1, archive: { kind: 'tool_result', relativePath: 'artifacts/result.txt', sha256: 'b', bytes: 4 } }
        ],
        runUsage: { providerCalls: 1, toolCalls: 3, toolErrors: 0, iterations: 1, childRuns: 1, durationMs: 20 }
      },
      toolCalls: [
        { id: 'artifact-1', name: 'write_lesson', arguments: '{"secret":"not projected"}', result: '{"lessonPath":"lessons/one.html","title":"One"}' },
        { id: 'artifact-2', name: 'write_lesson', arguments: '{}', result: '{"lessonPath":"lessons/one.html","title":"One duplicate"}' },
        { id: 'permission-1', name: 'tool_permission', arguments: '{"toolName":"write_file","operation":"Write","targetPath":"notes/one.md"}', result: '{"decision":"allow"}' },
        { id: 'permission-1', name: 'tool_permission', arguments: '{"toolName":"write_file"}', result: '{"decision":"deny"}' }
      ]
    })])

    await LearningWorkLedger.appendSnapshot({ rootPath, workspace, conversation: item })

    const [entry] = await readLedger(rootPath)
    const evidence = entry.evidence as Record<string, unknown>
    expect(evidence.sources).toHaveLength(40)
    expect((evidence.sources as Array<{ sourceId: string }>).map((source) => source.sourceId)).toEqual(
      Array.from({ length: 40 }, (_, index) => `source-${index}`)
    )
    expect(evidence.childRuns).toHaveLength(1)
    expect(evidence.compactions).toHaveLength(1)
    expect(evidence.artifacts).toHaveLength(2)
    expect(evidence.permissionDecisions).toEqual([
      expect.objectContaining({ toolCallId: 'permission-1', decision: 'allow' })
    ])
    expect(JSON.stringify(entry)).not.toContain('This full conversation text')
    expect(JSON.stringify(entry)).not.toContain('secret')
  })

  it('de-duplicates an entry that already exists in a strict sealed ledger segment', async () => {
    const rootPath = await createTeachingWorkspace()
    const item = conversation('sealed-duplicate', [turn({ processEvents: [event('done', { status: 'done' })] })])
    const entry = buildLearningWorkLedgerEntry(workspace, item)
    const ledgerDirectory = join(rootPath, '.studiumx')
    await mkdir(ledgerDirectory, { recursive: true })
    await writeFile(
      join(ledgerDirectory, durableJsonlSealedSegmentFileName('learning-work.jsonl', '2026-06', 1)),
      `${JSON.stringify(entry)}\n`,
      'utf8'
    )

    await LearningWorkLedger.appendSnapshot({ rootPath, workspace, conversation: item })

    await expect(readLearningWorkLedgerLines(rootPath)).resolves.toEqual([JSON.stringify(entry)])
    await expect(readFile(join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('constructs a stable snapshot id and appends a repeated snapshot only once', async () => {
    const rootPath = await createTeachingWorkspace()
    const item = conversation('idempotent', [turn({ processEvents: [event('done', { status: 'done' })] })])

    const first = buildLearningWorkLedgerEntry(workspace, item)
    const second = buildLearningWorkLedgerEntry(workspace, item)
    expect(second.entryId).toBe(first.entryId)

    await Promise.all([
      LearningWorkLedger.appendSnapshot({ rootPath, workspace, conversation: item }),
      LearningWorkLedger.appendSnapshot({ rootPath, workspace, conversation: item })
    ])
    await LearningWorkLedger.appendSnapshot({ rootPath, workspace, conversation: item })

    const entries = await readLedger(rootPath)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entryId: first.entryId, status: 'completed' })
  })
})
