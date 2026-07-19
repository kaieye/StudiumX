import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../../src/shared/agent-conversation-catalog'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'
import { saveAgentConversationArchive } from '../../src/main/agent-conversation-archive'
import {
  forkAgentConversationBranchAtRoot,
  updateAgentConversationBranchStatusAtRoot
} from '../../src/main/agent-conversation-session-tree'
import { readRawAgentConversationRecord } from '../../src/main/teaching-agent-conversations'
import { LEARNING_WORK_LEDGER_RELATIVE_PATH } from '../../src/main/learning-work-ledger'

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-legacy-nonmutating-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('legacy conversation fork/status compatibility', () => {
  it('forks a legacy source without changing its JSON, Markdown, audit, or shared ledger bytes', async () => {
    const rootPath = await createRoot()
    const workspace = { id: 'workspace-legacy', name: 'Legacy workspace', rootPath }
    const secret = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const record: AgentConversationRecord = {
      id: 'legacy-root',
      workspaceId: workspace.id,
      title: `Legacy title ${secret}`,
      createdAt: '2026-07-14T10:00:00.000Z',
      updatedAt: '2026-07-14T10:01:00.000Z',
      relativePath: 'conversation/legacy-root.md',
      absolutePath: join(rootPath, 'conversation/legacy-root.md'),
      messageCount: 2,
      turns: [
        { id: 'legacy-user', role: 'user', content: `Legacy question with ${secret}`, createdAt: '2026-07-14T10:00:00.000Z' },
        { id: 'legacy-assistant', role: 'assistant', content: `Legacy answer repeats ${secret}`, createdAt: '2026-07-14T10:01:00.000Z' }
      ]
    }

    // Use the real archive once to establish all expected legacy artifact
    // locations, then replace only their bytes with a representative old raw
    // canonical source. No mocked writer participates in this regression.
    await saveAgentConversationArchive({ workspace, record })
    const jsonRelativePath = agentConversationJsonRelativePathForMarkdown(record.relativePath)
    const auditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(record.relativePath)
    const sourcePaths = [
      join(rootPath, jsonRelativePath),
      join(rootPath, record.relativePath),
      join(rootPath, auditRelativePath),
      join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH)
    ]
    await writeFile(sourcePaths[0]!, `${JSON.stringify({
      version: 1,
      workspaceId: record.workspaceId,
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      relativePath: record.relativePath,
      turns: record.turns
    }, null, 2)}\n`, 'utf8')
    await writeFile(sourcePaths[1]!, `# ${record.title}\n\n${record.turns.map((turn) => turn.content).join('\n')}\n`, 'utf8')
    await writeFile(sourcePaths[2]!, `${await readFile(sourcePaths[2]!, 'utf8')}legacy audit ${secret}\n`, 'utf8')
    await writeFile(sourcePaths[3]!, `${await readFile(sourcePaths[3]!, 'utf8')}legacy ledger ${secret}\n`, 'utf8')
    const before = await Promise.all(sourcePaths.map((path) => readFile(path)))

    const childTrace = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'
    const child = await forkAgentConversationBranchAtRoot(workspace, record.id, {
      sourceTurnId: 'legacy-assistant',
      expectedRevision: 0,
      createConversationId: async () => 'legacy-child',
      replayId: 'legacy-replay',
      traceId: childTrace,
      now: '2026-07-14T10:02:00.000Z'
    })

    expect(child).toMatchObject({
      traceId: childTrace.toLowerCase(),
      branch: { sessionId: record.id, parentBranchId: record.id, status: 'active' }
    })
    const afterFork = await Promise.all(sourcePaths.map((path) => readFile(path)))
    afterFork.forEach((bytes, index) => expect(bytes.equals(before[index]!)).toBe(true))

    // Same-state repair is a non-mutating no-op for legacy records. A real
    // status transition fails closed rather than silently upgrading artifacts.
    await expect(updateAgentConversationBranchStatusAtRoot(workspace, record.id, 'active', { expectedRevision: 0 }))
      .resolves.toMatchObject({ id: record.id, branch: undefined })
    await expect(updateAgentConversationBranchStatusAtRoot(workspace, record.id, 'archived', { expectedRevision: 0 }))
      .rejects.toThrow('Legacy conversation branches cannot change status')
    const afterStatus = await Promise.all(sourcePaths.map((path) => readFile(path)))
    afterStatus.forEach((bytes, index) => expect(bytes.equals(before[index]!)).toBe(true))

    const persistedChild = await readRawAgentConversationRecord(rootPath, child.id)
    expect(persistedChild.traceId).toBe(childTrace.toLowerCase())
    expect(JSON.stringify(persistedChild)).not.toContain(secret)
  })
})
