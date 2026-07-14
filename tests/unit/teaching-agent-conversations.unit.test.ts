import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'
import {
  listAgentConversations,
  listPersistedAgentConversationRecords,
  readAgentConversationRecord,
  writeAgentConversationRecord
} from '../../src/main/teaching-agent-conversations'
import {
  projectAgentConversationReplay,
  rebuildAgentConversationSessionTree
} from '../../src/main/agent-conversation-session-tree'

const createdRoots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-conversations-'))
  createdRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Teaching Agent conversation catalog', () => {
  it('does not expose the temporary conversation metadata index as a phantom conversation', async () => {
    const root = await createRoot()
    await mkdir(join(root, 'conversations'), { recursive: true })
    await writeFile(
      join(root, 'conversations', '.index.json'),
      `${JSON.stringify({ pathMeta: {} }, null, 2)}\n`,
      'utf8'
    )

    const conversations = await listAgentConversations(root, {}, {
      includeRoot: true,
      includeRootConversation: false,
      includeLegacyRootConversations: true,
      includeLessons: false,
      includeCourses: false
    })

    expect(conversations).toEqual([])
    await expect(readAgentConversationRecord(root, 'index')).rejects.toThrow('Conversation not found.')
  })
  it('restores durable branch metadata and turn provenance without trusting invalid fields', async () => {
    const root = await createRoot()
    await mkdir(join(root, 'conversations'), { recursive: true })
    await writeFile(
      join(root, 'conversations', 'chat-root.json'),
      `${JSON.stringify({
        version: 2,
        id: 'chat-root',
        title: 'Root',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        relativePath: 'conversations/chat-root.md',
        branch: {
          schemaVersion: 1,
          sessionId: 'chat-root',
          branchId: 'chat-root',
          revision: 3,
          status: 'active'
        },
        turns: [{
          id: 'turn-1',
          role: 'assistant',
          content: 'Recovered',
          createdAt: '2026-01-01T00:01:00.000Z',
          metadata: {
            version: 1,
            provenance: { kind: 'recovery_notice', sourceConversationId: 'chat-root' }
          }
        }]
      }, null, 2)}\n`,
      'utf8'
    )

    const record = await readAgentConversationRecord(root, 'chat-root')

    expect(record.branch).toMatchObject({
      sessionId: 'chat-root',
      branchId: 'chat-root',
      revision: 3,
      status: 'active'
    })
    expect(record.turns[0]?.metadata?.provenance).toEqual({
      kind: 'recovery_notice',
      sourceConversationId: 'chat-root',
      sourceBranchId: undefined,
      sourceTurnId: undefined,
      replayId: undefined
    })
  })

  it('round-trips version 2 branch metadata and rebuilds an archived child from disk', async () => {
    const root = await createRoot()
    const workspace = { id: 'workspace-phase-9', name: 'Phase 9', rootPath: root }
    const rootRecord: AgentConversationRecord = {
      id: 'chat-root',
      workspaceId: workspace.id,
      title: 'Root',
      createdAt: '2026-07-14T01:00:00.000Z',
      updatedAt: '2026-07-14T01:00:00.000Z',
      relativePath: 'conversations/chat-root.md',
      absolutePath: join(root, 'conversations/chat-root.md'),
      messageCount: 1,
      branch: {
        schemaVersion: 1,
        sessionId: 'chat-root',
        branchId: 'chat-root',
        revision: 1,
        status: 'active'
      },
      turns: [{
        id: 'turn-root',
        role: 'user',
        content: 'Question',
        createdAt: '2026-07-14T01:00:00.000Z',
        metadata: { version: 1, provenance: { kind: 'original' } }
      }]
    }
    const replay = projectAgentConversationReplay({
      source: rootRecord,
      replayId: 'replay-disk-roundtrip',
      createdAt: '2026-07-14T01:01:00.000Z'
    })
    const childRecord: AgentConversationRecord = {
      id: 'chat-child',
      workspaceId: workspace.id,
      title: 'Child',
      createdAt: '2026-07-14T01:01:00.000Z',
      updatedAt: '2026-07-14T01:02:00.000Z',
      relativePath: 'conversations/chat-child.md',
      absolutePath: join(root, 'conversations/chat-child.md'),
      messageCount: replay.turns.length,
      branch: {
        schemaVersion: 1,
        sessionId: rootRecord.id,
        branchId: 'chat-child',
        revision: 2,
        status: 'archived',
        parentBranchId: rootRecord.id,
        forkPoint: replay.forkPoint,
        replaySource: replay.replaySource
      },
      turns: replay.turns
    }

    await writeAgentConversationRecord(workspace, rootRecord)
    await writeAgentConversationRecord(workspace, childRecord)

    const storedJson = JSON.parse(await readFile(join(root, 'conversations/chat-child.json'), 'utf8')) as {
      version: number
      branch?: { status?: string }
    }
    expect(storedJson).toMatchObject({ version: 2, branch: { status: 'archived' } })

    const persisted = await listPersistedAgentConversationRecords(root)
    const tree = rebuildAgentConversationSessionTree(persisted, rootRecord.id)
    expect(tree.nodes.map((node) => ({ id: node.branchId, status: node.status }))).toEqual([
      { id: rootRecord.id, status: 'active' },
      { id: childRecord.id, status: 'archived' }
    ])
  })

  it('rejects mismatched filenames, duplicate ids, and cross-id write placement', async () => {
    const root = await createRoot()
    await mkdir(join(root, 'conversations'), { recursive: true })
    await mkdir(join(root, 'conversation'), { recursive: true })

    await writeFile(join(root, 'conversations', 'chat-a.json'), `${JSON.stringify({
      version: 1,
      id: 'chat-b',
      title: 'Wrong id',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      relativePath: 'conversations/chat-b.md',
      turns: []
    })}
`, 'utf8')
    await expect(readAgentConversationRecord(root, 'chat-a')).rejects.toThrow('does not match its JSON basename')

    const duplicate = (relativePath: string) => `${JSON.stringify({
      version: 1,
      id: 'chat-dupe',
      title: 'Duplicate',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      relativePath,
      turns: []
    })}
`
    await Promise.all([
      writeFile(join(root, 'conversations', 'chat-dupe.json'), duplicate('conversations/chat-dupe.md'), 'utf8'),
      writeFile(join(root, 'conversation', 'chat-dupe.json'), duplicate('conversation/chat-dupe.md'), 'utf8')
    ])
    await expect(readAgentConversationRecord(root, 'chat-dupe')).rejects.toThrow('ambiguous')

    const sentinelPath = join(root, 'conversations', 'chat-b.json')
    await writeFile(sentinelPath, 'sentinel', 'utf8')
    const misplaced: AgentConversationRecord = {
      id: 'chat-a',
      workspaceId: 'workspace-1',
      title: 'Misplaced',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      relativePath: 'conversations/chat-b.md',
      absolutePath: join(root, 'conversations/chat-b.md'),
      messageCount: 0,
      turns: []
    }
    await expect(writeAgentConversationRecord(
      { id: 'workspace-1', name: 'Workspace', rootPath: root }, misplaced
    )).rejects.toThrow('bound to its conversation id')
    expect(await readFile(sentinelPath, 'utf8')).toBe('sentinel')
  })

  it('rejects branch metadata whose branch id does not match its conversation id', async () => {
    const root = await createRoot()
    await mkdir(join(root, 'conversations'), { recursive: true })
    await writeFile(
      join(root, 'conversations', 'chat-root.json'),
      `${JSON.stringify({
        version: 2,
        id: 'chat-root',
        title: 'Root',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        relativePath: 'conversations/chat-root.md',
        branch: {
          schemaVersion: 1,
          sessionId: 'chat-root',
          branchId: 'chat-other',
          revision: 1,
          status: 'active'
        },
        turns: [{ id: 'turn-1', role: 'user', content: 'Hello', createdAt: '2026-01-01T00:00:00.000Z' }]
      }, null, 2)}\n`,
      'utf8'
    )

    await expect(readAgentConversationRecord(root, 'chat-root')).rejects.toThrow('branch metadata is invalid')
  })

})
