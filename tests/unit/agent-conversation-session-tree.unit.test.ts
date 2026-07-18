import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentChatTurn,
  AgentConversationBranchMetadata,
  AgentConversationRecord
} from '../../src/shared/teaching-types'

const persistence = vi.hoisted(() => ({
  records: new Map<string, AgentConversationRecord>()
}))

vi.mock('../../src/main/teaching-agent-conversations', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/teaching-agent-conversations')>(
    '../../src/main/teaching-agent-conversations'
  )
  return {
    ...actual,
    listPersistedAgentConversationRecords: vi.fn(async () => [...persistence.records.values()].map((record) => ({
      jsonRelativePath: record.relativePath.replace(/\.md$/i, '.json'),
      record: structuredClone(record)
    }))),
    readAgentConversationRecord: vi.fn(async (_rootPath: string, id: string) => {
      const record = persistence.records.get(id)
      if (!record) throw new Error('Conversation not found.')
      return structuredClone(record)
    }),
    readRawAgentConversationRecord: vi.fn(async (_rootPath: string, id: string) => {
      const record = persistence.records.get(id)
      if (!record) throw new Error('Conversation not found.')
      return structuredClone(record)
    }),
    writeAgentConversationRecord: vi.fn(async (
      _workspace: unknown,
      record: AgentConversationRecord,
      options?: { beforeCanonicalSave?: (canonicalRecord: AgentConversationRecord) => Promise<void> }
    ) => {
      await options?.beforeCanonicalSave?.(record)
      persistence.records.set(record.id, structuredClone(record))
    }),
    nextAgentConversationId: vi.fn(async () => 'allocated-branch')
  }
})

import {
  AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES,
  AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH,
  AgentConversationBranchRevisionConflictError,
  AgentConversationOpenStateError,
  AgentConversationSessionTreeError,
  digestAgentConversationReplaySource,
  forkAgentConversationBranchAtRoot,
  openAgentConversationBranchAtRoot,
  projectAgentConversationReplay,
  readAgentConversationOpenStateAtRoot,
  listAgentConversationSessionTreesAtRoot,
  readAgentConversationSessionTreeAtRoot,
  rebuildAgentConversationSessionTree,
  saveAgentConversationBranchAtRoot,
  updateAgentConversationBranchStatusAtRoot,
  writeAgentConversationOpenStateAtRoot
} from '../../src/main/agent-conversation-session-tree'

const workspace = (rootPath: string) => ({ id: 'workspace-phase-9', name: 'Phase 9', rootPath })

beforeEach(() => persistence.records.clear())

describe('agent conversation durable session tree', () => {
  it('projects a text-only replay prefix with fixed no-side-effect flags', () => {
    const source = record('root-branch', [
      turn('turn-1', 'user', 'Question', '2026-07-14T01:00:00.000Z', true),
      turn('turn-2', 'assistant', 'Answer', '2026-07-14T01:01:00.000Z', true),
      turn('turn-3', 'user', 'Later', '2026-07-14T01:02:00.000Z')
    ])

    const replay = projectAgentConversationReplay({
      source,
      sourceTurnId: 'turn-2',
      replayId: 'replay-safe-1',
      createdAt: '2026-07-14T02:00:00.000Z'
    })

    expect(replay.turns).toHaveLength(2)
    expect(replay.forkPoint.sourceDigest).toBe(digestAgentConversationReplaySource(source.turns.slice(0, 2)))
    expect(replay.replaySource).toMatchObject({
      sourceTurnCount: 2,
      toolsReplayed: false,
      archivedRetrievalPromoted: false,
      providerHistoryInjected: false,
      memoryWritten: false
    })
    expect(replay.turns.every((item) => item.toolCalls === undefined && item.processEvents === undefined)).toBe(true)
    expect(replay.turns.every((item) => item.metadata?.provenance?.kind === 'replayed')).toBe(true)
    expect(replay.turns.every((item) => item.metadata?.runId === undefined && item.metadata?.toolResults === undefined)).toBe(true)
  })

  it('forks any existing turn without changing the parent and rebuilds nested shared tree shape', async () => {
    const rootPath = await createRoot()
    const parent = record('root-branch', [
      turn('turn-1', 'user', 'Q1', '2026-07-14T03:00:00.000Z'),
      turn('turn-2', 'assistant', 'A1', '2026-07-14T03:01:00.000Z'),
      turn('turn-3', 'user', 'Q2', '2026-07-14T03:02:00.000Z')
    ])
    persistence.records.set(parent.id, structuredClone(parent))
    const before = structuredClone(parent)

    const child = await forkAgentConversationBranchAtRoot(workspace(rootPath), parent.id, {
      sourceTurnId: 'turn-2',
      expectedRevision: 0,
      createConversationId: async () => 'child-branch',
      replayId: 'replay-child',
      now: '2026-07-14T04:00:00.000Z'
    })
    const nested = await forkAgentConversationBranchAtRoot(workspace(rootPath), child.id, {
      sourceTurnId: child.turns[1].id,
      expectedRevision: 1,
      createConversationId: async () => 'nested-branch',
      replayId: 'replay-nested',
      now: '2026-07-14T05:00:00.000Z'
    })

    // Forking a legacy root is intentionally non-mutating: inferred branch
    // metadata exists only in memory while the source record remains byte-safe.
    expect(persistence.records.get(parent.id)).toEqual(before)
    expect(child.turns).toHaveLength(2)
    expect(child.branch).toMatchObject({ parentBranchId: parent.id, revision: 1, status: 'active' })
    expect(nested.branch).toMatchObject({ parentBranchId: child.id, sessionId: parent.id })

    const tree = await readAgentConversationSessionTreeAtRoot(rootPath, parent.id)
    expect(tree).toMatchObject({
      schemaVersion: 1,
      sessionId: parent.id,
      openBranchId: parent.id
    })
    expect(tree.branches.map((branch) => branch.branchId)).toEqual([parent.id, child.id, nested.id])
    expect(tree.branches.find((branch) => branch.branchId === child.id)).toMatchObject({
      sessionId: parent.id,
      parentBranchId: parent.id,
      head: { turnCount: 2 },
      isOpen: false
    })
  })

  it('keeps forks in the source UTC partition directory', async () => {
    const rootPath = await createRoot()
    const parent = {
      ...record('root-partitioned', [
        turn('turn-1', 'user', 'Question', '2026-07-14T03:00:00.000Z'),
        turn('turn-2', 'assistant', 'Answer', '2026-07-14T03:01:00.000Z')
      ]),
      relativePath: 'conversations/2026/07/root-partitioned.md',
      absolutePath: 'C:/workspace/conversations/2026/07/root-partitioned.md'
    }
    persistence.records.set(parent.id, structuredClone(parent))

    const child = await forkAgentConversationBranchAtRoot(workspace(rootPath), parent.id, {
      expectedRevision: 0,
      createConversationId: async () => 'child-partitioned',
      replayId: 'replay-partitioned',
      now: '2026-07-14T04:00:00.000Z'
    })

    expect(child.relativePath).toBe('conversations/2026/07/child-partitioned.md')
    expect(persistence.records.get(child.id)?.relativePath).toBe(child.relativePath)
  })

  it('rejects damaged parent references and source digests during rebuild', () => {
    const parent = record('root-branch', [turn('turn-1', 'user', 'Q', '2026-07-14T06:00:00.000Z')])
    const replay = projectAgentConversationReplay({
      source: parent,
      replayId: 'replay-damage',
      createdAt: '2026-07-14T06:01:00.000Z'
    })
    const child = record('child-branch', replay.turns, {
      schemaVersion: 1,
      sessionId: parent.id,
      branchId: 'child-branch',
      revision: 1,
      status: 'active',
      parentBranchId: parent.id,
      forkPoint: { ...replay.forkPoint, sourceDigest: '0'.repeat(64) },
      replaySource: { ...replay.replaySource, sourceDigest: '0'.repeat(64) }
    })

    expect(() => rebuildAgentConversationSessionTree(persisted(parent, child), parent.id)).toThrowError(
      expect.objectContaining<Partial<AgentConversationSessionTreeError>>({ code: 'source_digest_mismatch' })
    )
    child.branch = { ...child.branch!, parentBranchId: 'missing-parent' }
    expect(() => rebuildAgentConversationSessionTree(persisted(parent, child), parent.id)).toThrowError(
      expect.objectContaining<Partial<AgentConversationSessionTreeError>>({ code: 'missing_parent' })
    )
  })

  it('enforces revision checks and falls back when the stored open branch is archived', async () => {
    const rootPath = await createRoot()
    const parent = record('root-branch', [turn('turn-1', 'user', 'Q', '2026-07-14T07:00:00.000Z')])
    persistence.records.set(parent.id, parent)
    const child = await forkAgentConversationBranchAtRoot(workspace(rootPath), parent.id, {
      createConversationId: async () => 'child-branch',
      expectedRevision: 0,
      replayId: 'replay-open',
      now: '2026-07-14T07:01:00.000Z'
    })
    await openAgentConversationBranchAtRoot(rootPath, parent.id, {
      requestedBranchId: child.id,
      now: '2026-07-14T07:02:00.000Z'
    })

    await expect(updateAgentConversationBranchStatusAtRoot(
      workspace(rootPath), child.id, 'archived', { expectedRevision: 0 }
    )).rejects.toBeInstanceOf(AgentConversationBranchRevisionConflictError)

    const archived = await updateAgentConversationBranchStatusAtRoot(
      workspace(rootPath), child.id, 'archived', { expectedRevision: 1 }
    )
    expect(archived.branch).toMatchObject({ status: 'archived', revision: 2 })

    const opened = await openAgentConversationBranchAtRoot(rootPath, parent.id, {
      now: '2026-07-14T07:03:00.000Z'
    })
    expect(opened.node.branchId).toBe(parent.id)
    expect(opened.issues.some((issue) => issue.code === 'open_branch_unavailable')).toBe(true)
    expect(opened.tree.openBranchId).toBe(parent.id)
  })

  it('restores archived branches, tombstones deletes, and keeps an active fallback', async () => {
    const rootPath = await createRoot()
    const parent = record('root-branch', [turn('turn-1', 'user', 'Q', '2026-07-14T07:10:00.000Z')])
    persistence.records.set(parent.id, structuredClone(parent))

    await expect(updateAgentConversationBranchStatusAtRoot(
      workspace(rootPath), parent.id, 'archived', { expectedRevision: 0 }
    )).rejects.toThrow('Legacy conversation branches cannot change status')
    expect(persistence.records.get(parent.id)?.branch).toBeUndefined()

    const child = await forkAgentConversationBranchAtRoot(workspace(rootPath), parent.id, {
      createConversationId: async () => 'child-branch',
      expectedRevision: 0,
      replayId: 'replay-lifecycle',
      now: '2026-07-14T07:11:00.000Z'
    })
    const archived = await updateAgentConversationBranchStatusAtRoot(
      workspace(rootPath), child.id, 'archived', { expectedRevision: 1 }
    )
    expect(archived.branch).toMatchObject({ status: 'archived', revision: 2 })

    const restored = await updateAgentConversationBranchStatusAtRoot(
      workspace(rootPath), child.id, 'active', { expectedRevision: 2 }
    )
    expect(restored.branch).toMatchObject({ status: 'active', revision: 3 })

    const deleted = await updateAgentConversationBranchStatusAtRoot(
      workspace(rootPath), child.id, 'deleted', { expectedRevision: 3 }
    )
    expect(deleted.branch).toMatchObject({ status: 'deleted', revision: 4 })
    await expect(openAgentConversationBranchAtRoot(rootPath, parent.id, {
      requestedBranchId: child.id
    })).rejects.toThrow('Deleted conversation branches cannot be opened')
    await expect(forkAgentConversationBranchAtRoot(workspace(rootPath), child.id)).rejects.toThrow(
      'Deleted conversation branches cannot be forked'
    )
    await expect(updateAgentConversationBranchStatusAtRoot(
      workspace(rootPath), child.id, 'active', { expectedRevision: 4 }
    )).rejects.toThrow('cannot be restored')

    const tree = await readAgentConversationSessionTreeAtRoot(rootPath, parent.id)
    expect(tree.openBranchId).toBe(parent.id)
    expect(tree.branches.find((branch) => branch.branchId === child.id)?.status).toBe('deleted')
    expect(persistence.records.has(parent.id)).toBe(true)
  })

  it('rejects saves that mutate a fork source prefix or a child replay prefix', async () => {
    const rootPath = await createRoot()
    const parent = record('root-branch', [
      turn('turn-1', 'user', 'Question', '2026-07-14T07:20:00.000Z'),
      turn('turn-2', 'assistant', 'Answer', '2026-07-14T07:21:00.000Z')
    ])
    persistence.records.set(parent.id, structuredClone(parent))
    const child = await forkAgentConversationBranchAtRoot(workspace(rootPath), parent.id, {
      sourceTurnId: 'turn-2',
      expectedRevision: 0,
      createConversationId: async () => 'child-branch',
      replayId: 'replay-save-guard',
      now: '2026-07-14T07:22:00.000Z'
    })

    const persistedParent = structuredClone(persistence.records.get(parent.id)!)
    const changedParent = structuredClone(persistedParent)
    changedParent.turns[0].content = 'Mutated question'
    await expect(saveAgentConversationBranchAtRoot(
      workspace(rootPath), changedParent, { expectedRevision: 0 }
    )).rejects.toMatchObject({ code: 'source_digest_mismatch' })
    expect(persistence.records.get(parent.id)).toEqual(persistedParent)

    const changedChild = structuredClone(child)
    changedChild.turns[0].content = 'Mutated replay'
    await expect(saveAgentConversationBranchAtRoot(
      workspace(rootPath), changedChild, { expectedRevision: 1 }
    )).rejects.toMatchObject({ code: 'replay_projection_mismatch' })
    expect(persistence.records.get(child.id)).toEqual(child)
  })

  it('serializes competing saves and status changes under one root', async () => {
    const rootPath = await createRoot()
    const parent = record('root-branch', [turn('turn-1', 'user', 'Q', '2026-07-14T07:30:00.000Z')])
    persistence.records.set(parent.id, structuredClone(parent))
    const child = await forkAgentConversationBranchAtRoot(workspace(rootPath), parent.id, {
      expectedRevision: 0,
      createConversationId: async () => 'child-branch',
      replayId: 'replay-concurrency',
      now: '2026-07-14T07:31:00.000Z'
    })

    const currentParent = structuredClone(persistence.records.get(parent.id)!)
    const firstSave = structuredClone(currentParent)
    firstSave.turns.push(turn('turn-2a', 'assistant', 'A', '2026-07-14T07:32:00.000Z'))
    const secondSave = structuredClone(currentParent)
    secondSave.turns.push(turn('turn-2b', 'assistant', 'B', '2026-07-14T07:32:01.000Z'))
    const saves = await Promise.allSettled([
      saveAgentConversationBranchAtRoot(workspace(rootPath), firstSave, { expectedRevision: 0 }),
      saveAgentConversationBranchAtRoot(workspace(rootPath), secondSave, { expectedRevision: 0 })
    ])
    expect(saves.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(saves.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((persistence.records.get(parent.id)?.branch?.revision)).toBe(1)

    const statuses = await Promise.allSettled([
      updateAgentConversationBranchStatusAtRoot(workspace(rootPath), parent.id, 'archived', { expectedRevision: 1 }),
      updateAgentConversationBranchStatusAtRoot(workspace(rootPath), child.id, 'archived', { expectedRevision: 1 })
    ])
    expect(statuses.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(statuses.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect([...persistence.records.values()].filter((item) => item.branch?.status === 'active')).toHaveLength(1)
  })

  it('compacts durable open state to the 256 most recent sessions', async () => {
    const rootPath = await createRoot()
    const entries = Array.from({ length: 300 }, (_, index) => ({
      sessionId: `session-${String(index).padStart(3, '0')}`,
      branchId: `branch-${String(index).padStart(3, '0')}`,
      updatedAt: new Date(Date.parse('2026-07-14T08:00:00.000Z') + index * 1000).toISOString()
    }))

    await writeAgentConversationOpenStateAtRoot(rootPath, entries)
    const state = await readAgentConversationOpenStateAtRoot(rootPath)

    expect(state?.sessions).toHaveLength(256)
    expect(state?.sessions[0]?.sessionId).toBe('session-299')
    expect(state?.sessions.some((entry) => entry.sessionId === 'session-000')).toBe(false)
    expect(state?.sessions.some((entry) => entry.sessionId === 'session-044')).toBe(true)
  })

  it('rejects sidecar integrity/version/size corruption and repairs it audibly on open', async () => {
    const rootPath = await createRoot()
    const parent = record('root-branch', [turn('turn-1', 'user', 'Q', '2026-07-14T08:00:00.000Z')])
    persistence.records.set(parent.id, parent)
    await openAgentConversationBranchAtRoot(rootPath, parent.id, { now: '2026-07-14T08:01:00.000Z' })
    const sidecarPath = join(rootPath, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)
    const valid = JSON.parse(await readFile(sidecarPath, 'utf8')) as Record<string, unknown>

    const tampered = structuredClone(valid) as { sessions: Array<{ branchId: string }> }
    tampered.sessions[0].branchId = 'tampered-branch'
    await writeFile(sidecarPath, JSON.stringify(tampered), 'utf8')
    await expect(readAgentConversationOpenStateAtRoot(rootPath)).rejects.toMatchObject({ code: 'integrity_mismatch' })
    const repaired = await openAgentConversationBranchAtRoot(rootPath, parent.id, { now: '2026-07-14T08:02:00.000Z' })
    expect(repaired.issues.some((issue) => issue.code === 'open_state_invalid')).toBe(true)
    expect((await readAgentConversationOpenStateAtRoot(rootPath))?.sessions[0].branchId).toBe(parent.id)

    await writeFile(sidecarPath, JSON.stringify({ ...valid, schemaVersion: 2 }), 'utf8')
    await expect(readAgentConversationOpenStateAtRoot(rootPath)).rejects.toBeInstanceOf(AgentConversationOpenStateError)
    await writeFile(sidecarPath, 'x'.repeat(AGENT_CONVERSATION_OPEN_STATE_MAX_BYTES + 1), 'utf8')
    await expect(readAgentConversationOpenStateAtRoot(rootPath)).rejects.toMatchObject({ code: 'too_large' })
  })
})

function persisted(...records: AgentConversationRecord[]) {
  return records.map((item) => ({ jsonRelativePath: `conversations/${item.id}.json`, record: item }))
}

function record(
  id: string,
  turns: AgentChatTurn[],
  branch?: AgentConversationBranchMetadata
): AgentConversationRecord {
  return {
    id,
    workspaceId: 'workspace-phase-9',
    title: `Conversation ${id}`,
    createdAt: turns[0]?.createdAt ?? '2026-07-14T00:00:00.000Z',
    updatedAt: turns.at(-1)?.createdAt ?? '2026-07-14T00:00:00.000Z',
    relativePath: `conversations/${id}.md`,
    absolutePath: `C:/workspace/conversations/${id}.md`,
    messageCount: turns.length,
    branch,
    turns
  }
}

function turn(
  id: string,
  role: AgentChatTurn['role'],
  content: string,
  createdAt: string,
  unsafe = false
): AgentChatTurn {
  if (!unsafe) return { id, role, content, createdAt }
  return {
    id,
    role,
    content,
    createdAt,
    toolCalls: [{ id: `tool-${id}`, name: 'write_workspace_file', arguments: '{}', result: 'large result' }],
    processEvents: [{ id: `event-${id}`, kind: 'tool_result', title: 'Tool done', createdAt }],
    metadata: {
      version: 1,
      runId: `run-${id}`,
      toolResults: [{ toolCallId: `tool-${id}`, toolName: 'write_workspace_file', bytes: 12, lines: 1 }],
      childRuns: [{ childRunId: `child-${id}`, label: 'Child', profile: 'worker', status: 'completed' }]
    }
  }
}

async function createRoot(): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-session-tree-'))
  await mkdir(dirname(join(rootPath, AGENT_CONVERSATION_OPEN_STATE_RELATIVE_PATH)), { recursive: true })
  return rootPath
}
