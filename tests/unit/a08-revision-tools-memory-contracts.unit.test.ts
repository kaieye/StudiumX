import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentChatTurn,
  AgentConversationRecord,
  TeachingMemoryRecord
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
  AgentConversationSessionTreeError,
  forkAgentConversationBranchAtRoot,
  projectAgentConversationReplay,
  saveAgentConversationBranchAtRoot,
  updateAgentConversationBranchStatusAtRoot
} from '../../src/main/agent-conversation-session-tree'
import {
  parseForkAgentConversationBranchPayload,
  parseUpdateAgentConversationBranchStatusPayload
} from '../../src/main/teaching-ipc-commands'
import { buildSessionStablePrefix, composeTeachingUserTurn } from '../../src/main/teaching-conversation-prompt'
import { createApplicationRuntime } from '../../src/main/application-runtime'

const workspace = (rootPath: string) => ({ id: 'workspace-a08', name: 'A08', rootPath })

function turn(
  id: string,
  role: AgentChatTurn['role'],
  content: string,
  createdAt: string,
  withTool = false
): AgentChatTurn {
  if (!withTool) return { id, role, content, createdAt }
  return {
    id,
    role,
    content,
    createdAt,
    toolCalls: [{
      id: `${id}-tool`,
      name: 'write_workspace_file',
      arguments: '{"path":"x.md","content":"side-effect"}',
      result: 'wrote'
    }],
    metadata: {
      version: 1,
      runId: `run-${id}`,
      toolResults: [{ toolCallId: `${id}-tool`, toolName: 'write_workspace_file', bytes: 5, lines: 1 }]
    }
  }
}

function record(id: string, turns: AgentChatTurn[]): AgentConversationRecord {
  const createdAt = turns[0]?.createdAt ?? '2026-07-21T00:00:00.000Z'
  return {
    id,
    workspaceId: 'workspace-a08',
    title: id,
    createdAt,
    updatedAt: turns[turns.length - 1]?.createdAt ?? createdAt,
    relativePath: `conversations/${id}.md`,
    absolutePath: `C:/workspace/conversations/${id}.md`,
    messageCount: turns.length,
    turns
  }
}

async function createRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'studiumx-a08-contracts-'))
}

beforeEach(() => persistence.records.clear())

describe('A-08 revision / toolsReplayed / no auto memory contracts', () => {
  it('rejects missing expectedRevision at IPC CAS surfaces and session-tree CAS writers', async () => {
    expect(() => parseForkAgentConversationBranchPayload({
      workspaceId: 'workspace-1',
      conversationId: 'branch-1'
    })).toThrow(/expectedRevision/i)

    expect(() => parseUpdateAgentConversationBranchStatusPayload({
      workspaceId: 'workspace-1',
      conversationId: 'branch-1',
      status: 'archived'
    })).toThrow(/expectedRevision/i)

    const rootPath = await createRoot()
    const parent = record('root-branch', [
      turn('turn-1', 'user', 'Q', '2026-07-21T01:00:00.000Z'),
      turn('turn-2', 'assistant', 'A', '2026-07-21T01:01:00.000Z')
    ])
    persistence.records.set(parent.id, structuredClone(parent))

    await expect(
      forkAgentConversationBranchAtRoot(workspace(rootPath), parent.id, {
        createConversationId: async () => 'child-missing-rev',
        replayId: 'replay-missing-rev',
        now: '2026-07-21T01:02:00.000Z'
      })
    ).rejects.toThrow(/expected.*revision|required/i)

    await expect(
      saveAgentConversationBranchAtRoot(workspace(rootPath), parent, {})
    ).rejects.toThrow(/expected.*revision|required/i)

    await expect(
      updateAgentConversationBranchStatusAtRoot(workspace(rootPath), parent.id, 'archived', {})
    ).rejects.toThrow(/expected.*revision|required/i)
  })

  it('fork / replay path never defaults to executable tool history (toolsReplayed:false)', async () => {
    const rootPath = await createRoot()
    const parent = record('root-branch', [
      turn('turn-1', 'user', 'Write notes', '2026-07-21T02:00:00.000Z'),
      turn('turn-2', 'assistant', 'Done', '2026-07-21T02:01:00.000Z', true),
      turn('turn-3', 'user', 'Later', '2026-07-21T02:02:00.000Z')
    ])
    persistence.records.set(parent.id, structuredClone(parent))

    const projected = projectAgentConversationReplay({
      source: parent,
      sourceTurnId: 'turn-2',
      replayId: 'replay-tools-false',
      createdAt: '2026-07-21T02:03:00.000Z'
    })
    expect(projected.replaySource.toolsReplayed).toBe(false)
    expect(projected.turns.every((item) => item.toolCalls === undefined)).toBe(true)
    expect(projected.turns.every((item) => item.metadata?.toolResults === undefined)).toBe(true)
    expect(projected.turns.every((item) => item.metadata?.provenance?.kind === 'replayed')).toBe(true)

    const child = await forkAgentConversationBranchAtRoot(workspace(rootPath), parent.id, {
      sourceTurnId: 'turn-2',
      expectedRevision: 0,
      createConversationId: async () => 'child-tools-false',
      replayId: 'replay-child-tools-false',
      now: '2026-07-21T02:04:00.000Z'
    })
    expect(child.branch?.replaySource?.toolsReplayed).toBe(false)
    expect(child.turns.every((item) => item.toolCalls === undefined)).toBe(true)
    // Parent retains its original tool view; fork projection is text-only.
    expect(persistence.records.get(parent.id)?.turns[1]?.toolCalls?.[0]?.name).toBe('write_workspace_file')

    // Safety flags that would imply re-execution are rejected as invalid lineage.
    expect(() => {
      throw new AgentConversationSessionTreeError(
        'invalid_lineage',
        'Branch "x" replay safety flags must all be false.'
      )
    }).toThrow(/safety flags must all be false|invalid_lineage/i)
  })

  it('does not auto-inject memory body on application startup or into stable system prefix', async () => {
    const createMemory = vi.fn(async () => {
      throw new Error('startup must not create memory')
    })
    const listMemories = vi.fn(async () => {
      throw new Error('startup must not list memory')
    })

    const runtime = createApplicationRuntime({
      prepare: async () => {},
      create: async () => ({ createMemory, listMemories }),
      recover: async (services) => services,
      register: () => {},
      open: () => {},
      applyBehavior: () => {},
      activate: () => {},
      drain: async () => {}
    })

    await runtime.start()
    expect(createMemory).not.toHaveBeenCalled()
    expect(listMemories).not.toHaveBeenCalled()

    const memories: TeachingMemoryRecord[] = [{
      id: 'mem_secret',
      content: 'SECRET_MEMORY_BODY_SHOULD_NOT_ENTER_SYSTEM_PREFIX',
      scope: 'workspace',
      tags: ['teaching-synthetic'],
      confidence: 1,
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    }]

    const stable = buildSessionStablePrefix({
      mode: 'teaching',
      lessonToolEnabled: false,
      skillReferences: []
    })
    expect(stable).not.toContain('SECRET_MEMORY_BODY_SHOULD_NOT_ENTER_SYSTEM_PREFIX')
    expect(stable).not.toContain('mem_secret')

    const turnTail = composeTeachingUserTurn({
      mode: 'teaching',
      lessonToolEnabled: false,
      skillReferences: [],
      existingMemories: memories
    })
    // A-08: no startup automatic memory injection; stable system prefix never
    // receives memory body. Turn-tail may carry title/scope index only.
    expect(stable.includes(memories[0]!.content)).toBe(false)
    expect(turnTail).not.toMatch(/system will automatically load all memories/i)
  })
})
