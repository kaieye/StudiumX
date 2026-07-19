import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { saveAgentConversationArchive } from '../../src/main/agent-conversation-archive'
import { durableJsonlSealedSegmentFileName } from '../../src/main/durable-jsonl'
import {
  buildLearningWorkLedgerEntry,
  LEARNING_WORK_LEDGER_RELATIVE_PATH
} from '../../src/main/learning-work-ledger'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Agent conversation archive learning-work verification', () => {
  it('accepts its expected learning-work snapshot from a strict sealed segment', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-archive-ledger-segment-'))
    roots.push(rootPath)
    const workspace = { id: 'workspace-1', name: 'Physics', rootPath }
    const record: AgentConversationRecord = {
      id: 'chat-sealed',
      workspaceId: workspace.id,
      title: 'Sealed ledger conversation',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:01:00.000Z',
      relativePath: 'conversation/chat-sealed.md',
      absolutePath: join(rootPath, 'conversation/chat-sealed.md'),
      messageCount: 1,
      turns: [{
        id: 'turn-1',
        role: 'assistant',
        content: 'Archived answer',
        createdAt: '2026-07-16T10:01:00.000Z',
        metadata: { version: 1 }
      }]
    }
    const entry = buildLearningWorkLedgerEntry(workspace, record)
    const ledgerDirectory = join(rootPath, '.studiumx')
    await mkdir(ledgerDirectory, { recursive: true })
    await writeFile(
      join(ledgerDirectory, durableJsonlSealedSegmentFileName('learning-work.jsonl', '2026-06', 1)),
      `${JSON.stringify(entry)}\n`,
      'utf8'
    )

    await expect(saveAgentConversationArchive({ workspace, record })).resolves.toBeUndefined()

    await expect(readFile(join(rootPath, 'conversation', 'chat-sealed.json'), 'utf8')).resolves.toContain('chat-sealed')
    await expect(readFile(join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
