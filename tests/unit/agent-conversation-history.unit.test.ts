import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import {
  createAgentConversationCheckpoint,
  resolveAgentConversationCheckpoint
} from '../../src/main/agent-conversation-checkpoints'
import {
  AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH,
  queryAgentArchivedHistory,
  rebuildAgentConversationHistoryIndex
} from '../../src/main/agent-conversation-history'
import type {
  AgentArtifactRef,
  AgentChatTurn,
  AgentConversationRecord
} from '../../src/shared/teaching-types'

const createdRoots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-history-'))
  createdRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Agent conversation checkpoints', () => {
  it('resolves an immutable conversation prefix without replaying tools or hydrating artifacts', async () => {
    const rootPath = await createRoot()
    const artifact = await writeArtifact(rootPath, 'conversation-checkpoint', 'tool_result', 'durable tool output')
    const record = createRecord('conversation-checkpoint', [
      createTurn('turn-1', 'user', 'Inspect the workspace', '2026-07-14T01:00:00.000Z'),
      createTurn('turn-2', 'assistant', '[Tool result archived]', '2026-07-14T01:01:00.000Z', artifact),
      createTurn('turn-3', 'assistant', 'Finished', '2026-07-14T01:02:00.000Z')
    ])

    const checkpoint = await createAgentConversationCheckpoint({
      rootPath,
      record,
      checkpointId: 'before-follow-up',
      turnCount: 2,
      label: 'Before follow-up token=checkpoint-secret',
      reason: 'Resume without replaying password=not-for-disk',
      createdAt: '2026-07-14T01:03:00.000Z'
    })

    expect(checkpoint.schemaVersion).toBe(1)
    expect(checkpoint.label).not.toContain('checkpoint-secret')
    expect(checkpoint.reason).not.toContain('not-for-disk')
    expect(checkpoint.turnCount).toBe(2)
    expect(checkpoint.headTurnId).toBe('turn-2')
    expect(checkpoint.artifacts).toEqual([artifact])

    const hydratedRecord = structuredClone(record)
    hydratedRecord.turns[1]!.toolCalls![0]!.result = 'HYDRATED SIDE EFFECT OUTPUT'
    const resolved = await resolveAgentConversationCheckpoint({
      rootPath,
      record: hydratedRecord,
      checkpointId: checkpoint.checkpointId
    })

    expect(resolved.toolsReplayed).toBe(false)
    expect(resolved.artifactsHydrated).toBe(false)
    expect(resolved.turns.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2'])
    expect(resolved.turns.map((turn) => turn.content)).toEqual(record.turns.slice(0, 2).map((turn) => turn.content))
    expect(resolved.turns[1]?.toolCalls?.[0]?.result).toMatch(/^\[tool result archived\]/)
    expect(resolved.turns[1]?.toolCalls?.[0]?.result).not.toContain('HYDRATED SIDE EFFECT OUTPUT')
  })

  it('rejects recovery when the persisted prefix no longer matches the checkpoint digest', async () => {
    const rootPath = await createRoot()
    const record = createRecord('conversation-prefix', [
      createTurn('turn-1', 'user', 'Original question', '2026-07-14T02:00:00.000Z'),
      createTurn('turn-2', 'assistant', 'Original answer', '2026-07-14T02:01:00.000Z')
    ])
    await createAgentConversationCheckpoint({
      rootPath,
      record,
      checkpointId: 'stable-prefix',
      createdAt: '2026-07-14T02:02:00.000Z'
    })

    const mutated: AgentConversationRecord = {
      ...record,
      turns: [{ ...record.turns[0]!, content: 'Mutated question' }, record.turns[1]!]
    }

    await expect(resolveAgentConversationCheckpoint({
      rootPath,
      record: mutated,
      checkpointId: 'stable-prefix'
    })).rejects.toThrow(/prefix.*match|digest/i)
  })
})

describe('Agent archived history index', () => {
  it('rebuilds without mutating original turns and reports missing and hash-mismatched artifacts', async () => {
    const rootPath = await createRoot()
    const mismatch = await writeArtifact(rootPath, 'conversation-integrity', 'tool_result', 'expected bytes')
    await writeFile(join(rootPath, mismatch.relativePath), 'tampered bytes', 'utf8')
    const missing = artifactRef(
      'child_transcript',
      'conversations/.agent-sessions/conversation-integrity/child-transcripts/missing.txt',
      'missing transcript'
    )
    const record = createRecord('conversation-integrity', [
      createTurn('turn-1', 'user', 'Question', '2026-07-14T03:00:00.000Z'),
      createTurn('turn-2', 'assistant', '[Tool result archived]', '2026-07-14T03:01:00.000Z', mismatch),
      createTurn('turn-3', 'assistant', 'Delegated work', '2026-07-14T03:02:00.000Z', missing)
    ])
    const originalTurns = structuredClone(record.turns)

    const rebuilt = await rebuildAgentConversationHistoryIndex({
      rootPath,
      records: [record],
      rebuiltAt: '2026-07-14T03:03:00.000Z'
    })

    expect(record.turns).toEqual(originalTurns)
    expect(rebuilt.index.items.filter((item) => item.type === 'conversation_turn')).toHaveLength(3)
    expect(rebuilt.index.items.find((item) => item.artifact?.relativePath === mismatch.relativePath)?.integrity)
      .toBe('hash_mismatch')
    expect(rebuilt.index.items.find((item) => item.artifact?.relativePath === missing.relativePath)?.integrity)
      .toBe('missing')
  })

  it('requires an explicit rebuild for malformed or integrity-damaged index files', async () => {
    const rootPath = await createRoot()
    const record = createRecord('conversation-corrupt-index', [
      createTurn('turn-1', 'user', 'Question', '2026-07-14T04:00:00.000Z')
    ])
    await rebuildAgentConversationHistoryIndex({ rootPath, records: [record] })
    const indexPath = join(rootPath, AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH)

    await writeFile(indexPath, '{broken json', 'utf8')
    await expect(queryAgentArchivedHistory({ rootPath })).rejects.toThrow(/rebuild/i)

    await rebuildAgentConversationHistoryIndex({ rootPath, records: [record] })
    await expect(queryAgentArchivedHistory({ rootPath })).resolves.toMatchObject({
      items: [{ turnId: 'turn-1' }]
    })

    const replacementRecord = createRecord('conversation-corrupt-index', [
      ...record.turns,
      createTurn('turn-2', 'assistant', 'Replacement index', '2026-07-14T04:01:00.000Z')
    ])
    await rebuildAgentConversationHistoryIndex({ rootPath, records: [replacementRecord] })
    await expect(queryAgentArchivedHistory({
      rootPath,
      conversationId: replacementRecord.id,
      types: ['conversation_turn']
    })).resolves.toMatchObject({ usage: { items: 2 } })

    const parsed = JSON.parse(await readFile(indexPath, 'utf8')) as { items: Array<{ summary: string }> }
    parsed.items[0]!.summary = 'tampered derived summary'
    await writeFile(indexPath, `${JSON.stringify(parsed)}\n`, 'utf8')
    await expect(queryAgentArchivedHistory({ rootPath })).rejects.toThrow(/integrity|rebuild/i)
  })

  it('applies conversation, time, type, and checkpoint filters without provider or memory injection', async () => {
    const rootPath = await createRoot()
    const first = createRecord('conversation-filter-a', [
      createTurn('a-1', 'user', 'First', '2026-07-14T05:00:00.000Z'),
      createTurn('a-2', 'assistant', 'Second', '2026-07-14T05:01:00.000Z'),
      createTurn('a-3', 'assistant', 'Third', '2026-07-14T05:02:00.000Z')
    ])
    const second = createRecord('conversation-filter-b', [
      createTurn('b-1', 'user', 'Other', '2026-07-14T05:03:00.000Z')
    ])
    const checkpoint = await createAgentConversationCheckpoint({
      rootPath,
      record: first,
      checkpointId: 'filter-checkpoint',
      turnCount: 2,
      createdAt: '2026-07-14T05:01:30.000Z'
    })
    await rebuildAgentConversationHistoryIndex({ rootPath, records: [first, second] })

    const result = await queryAgentArchivedHistory({
      rootPath,
      conversationId: first.id,
      from: '2026-07-14T05:00:30.000Z',
      to: '2026-07-14T05:02:00.000Z',
      types: ['conversation_turn'],
      checkpointId: checkpoint.checkpointId
    })

    expect(result.providerInjection).toBe('none')
    expect(result.memoryWrite).toBe('none')
    expect(result.items.map((item) => item.turnId)).toEqual(['a-2'])
    expect(result.items[0]?.checkpointIds).toContain(checkpoint.checkpointId)
  })

  it('enforces result and excerpt budgets and reports truncation', async () => {
    const rootPath = await createRoot()
    const record = createRecord('conversation-budget', Array.from({ length: 8 }, (_, index) =>
      createTurn(
        `turn-${index + 1}`,
        index % 2 === 0 ? 'user' : 'assistant',
        `History item ${index + 1}: ${'bounded content '.repeat(30)}`,
        `2026-07-14T06:0${index}:00.000Z`
      )))
    await rebuildAgentConversationHistoryIndex({ rootPath, records: [record] })

    const result = await queryAgentArchivedHistory({
      rootPath,
      conversationId: record.id,
      types: ['conversation_turn'],
      limit: 8,
      maxBytes: 900,
      maxExcerptBytes: 48
    })

    expect(result.truncated).toBe(true)
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.length).toBeLessThan(8)
    expect(result.usage.bytes).toBeLessThanOrEqual(900)
    expect(result.items.every((item) => Buffer.byteLength(item.summary, 'utf8') <= 48)).toBe(true)
  })

  it('surfaces malformed session sidecar lines instead of silently accepting them', async () => {
    const rootPath = await createRoot()
    const record = createRecord('conversation-sidecar', [
      createTurn('turn-1', 'user', 'Question', '2026-07-14T07:00:00.000Z')
    ])
    const sidecarPath = join(rootPath, 'conversations/.agent-sessions/conversation-sidecar.jsonl')
    await mkdir(dirname(sidecarPath), { recursive: true })
    await writeFile(sidecarPath, [
      JSON.stringify({ type: 'session', version: 1, id: record.id, timestamp: record.createdAt }),
      '{bad json',
      JSON.stringify({ type: 'turn', id: 'audit-turn-1', turnId: 'turn-1', timestamp: record.createdAt })
    ].join('\n'), 'utf8')

    const rebuilt = await rebuildAgentConversationHistoryIndex({ rootPath, records: [record] })

    expect(rebuilt.issues.some((issue) => issue.code === 'session_audit_invalid_json')).toBe(true)
    expect(rebuilt.index.items.filter((item) => item.type === 'session_sidecar')).toHaveLength(2)
  })

  it('projects a legacy raw record into a redacted index without rewriting canonical source bytes', async () => {
    const rootPath = await createRoot()
    const secret = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
    const record = createRecord('legacy-private', [
      createTurn('turn-1', 'user', `Review OAuth with OPENAI_API_KEY=${secret}`, '2026-07-14T08:00:00.000Z'),
      createTurn('turn-2', 'assistant', 'Use a short-lived authorization code.', '2026-07-14T08:01:00.000Z')
    ])
    record.title = `OPENAI_API_KEY=${secret}`
    const canonicalPath = join(rootPath, 'conversations', 'legacy-private.json')
    const legacyBytes = JSON.stringify({ title: record.title, turns: record.turns })
    await mkdir(dirname(canonicalPath), { recursive: true })
    await writeFile(canonicalPath, legacyBytes, 'utf8')

    await rebuildAgentConversationHistoryIndex({ rootPath, records: [record] })

    expect(await readFile(canonicalPath, 'utf8')).toBe(legacyBytes)
    const index = await readFile(join(rootPath, AGENT_CONVERSATION_HISTORY_INDEX_RELATIVE_PATH), 'utf8')
    expect(index).not.toContain(secret)
    expect(index).toContain('Review OAuth')
  })

})

function createRecord(id: string, turns: AgentChatTurn[]): AgentConversationRecord {
  return {
    id,
    workspaceId: 'workspace-phase-8',
    title: `Conversation ${id}`,
    createdAt: turns[0]?.createdAt ?? '2026-07-14T00:00:00.000Z',
    updatedAt: turns.at(-1)?.createdAt ?? '2026-07-14T00:00:00.000Z',
    relativePath: `conversations/${id}.md`,
    absolutePath: `C:/workspace/conversations/${id}.md`,
    messageCount: turns.length,
    turns
  }
}

function createTurn(
  id: string,
  role: AgentChatTurn['role'],
  content: string,
  createdAt: string,
  artifact?: AgentArtifactRef
): AgentChatTurn {
  const base: AgentChatTurn = { id, role, content, createdAt }
  if (!artifact) return base
  if (artifact.kind === 'tool_result') {
    return {
      ...base,
      toolCalls: [{
        id: `tool-${id}`,
        name: 'write_workspace_file',
        arguments: '{"path":"notes.txt"}',
        result: content
      }],
      metadata: {
        version: 1,
        toolResults: [{
          toolCallId: `tool-${id}`,
          toolName: 'write_workspace_file',
          bytes: artifact.bytes,
          lines: artifact.lines ?? 1,
          archive: artifact
        }]
      }
    }
  }
  return {
    ...base,
    metadata: {
      version: 1,
      childRuns: [{
        childRunId: `child-${id}`,
        label: 'Research',
        profile: 'worker',
        status: 'completed',
        summary: 'Delegated work complete',
        archive: artifact
      }]
    }
  }
}

async function writeArtifact(
  rootPath: string,
  conversationId: string,
  kind: AgentArtifactRef['kind'],
  content: string
): Promise<AgentArtifactRef> {
  const digest = sha256(content)
  const folder = kind === 'tool_result' ? 'tool-results' : 'child-transcripts'
  const relativePath = `conversations/.agent-sessions/${conversationId}/${folder}/${digest}.txt`
  const targetPath = join(rootPath, relativePath)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
  return artifactRef(kind, relativePath, content)
}

function artifactRef(kind: AgentArtifactRef['kind'], relativePath: string, content: string): AgentArtifactRef {
  return {
    kind,
    relativePath,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    lines: content.split(/\r\n|\r|\n/).length,
    preview: content.slice(0, 80),
    archivedAt: '2026-07-14T00:00:00.000Z'
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
