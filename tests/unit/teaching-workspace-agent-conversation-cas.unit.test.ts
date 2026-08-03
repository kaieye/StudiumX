import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentConversationBranchRevisionConflictError } from '../../src/main/agent-conversation-session-tree'
import { runTeachingConversationTurn } from '../../src/main/teaching-conversation-runtime'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

vi.mock('../../src/main/teaching-conversation-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/teaching-conversation-runtime')>()
  return { ...actual, runTeachingConversationTurn: vi.fn() }
})

const runtimeScope = createVitestRuntimeScope()
const runTeachingConversationTurnMock = vi.mocked(runTeachingConversationTurn)

async function createService(name: string): Promise<{
  service: TeachingWorkspaceService
  workspace: NonNullable<Awaited<ReturnType<TeachingWorkspaceService['createWorkspace']>>['activeWorkspace']>
}> {
  const runtime = await runtimeScope.create(name)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  const service = new TeachingWorkspaceService({
    registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot)
  })
  const workspace = (await service.createWorkspace({ name, prompt: 'Exercise host-owned conversation CAS.' })).activeWorkspace!
  return { service, workspace }
}

function initialTurns() {
  return [
    { id: 'turn-1', role: 'user' as const, content: 'Question', createdAt: '2026-08-03T09:00:00.000Z' },
    { id: 'turn-2', role: 'assistant' as const, content: 'Answer', createdAt: '2026-08-03T09:01:00.000Z' }
  ]
}

describe('TeachingWorkspaceService agent conversation CAS boundary', () => {
  beforeEach(() => {
    runTeachingConversationTurnMock.mockClear()
  })

  it('rejects a stale agentChatStream before starting the model runtime', async () => {
    const { service, workspace } = await createService('stale-agent-chat-stream')
    const saved = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'teaching',
      turns: initialTurns()
    })

    const rejected = service.agentChatStream({
      workspaceId: workspace.id,
      conversationId: saved.conversation.id,
      mode: 'teaching',
      expectedBranchRevision: saved.conversation.branch!.revision - 1,
      messages: [],
      userInput: 'Continue from stale state.'
    }, {
      streamId: 'stale-agent-chat-stream',
      onChunk: () => undefined,
      onStatus: () => undefined,
      onTool: () => undefined
    })

    await expect(rejected).rejects.toBeInstanceOf(AgentConversationBranchRevisionConflictError)
    await expect(rejected).rejects.toMatchObject({
      expectedRevision: 0,
      currentRevision: saved.conversation.branch!.revision
    })
    expect(runTeachingConversationTurnMock).not.toHaveBeenCalled()
  })

  it('rejects a stale save and preserves the newer canonical transcript', async () => {
    const { service, workspace } = await createService('stale-agent-conversation-save')
    const initial = initialTurns()
    const created = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'teaching',
      turns: initial
    })
    const currentTurns = [
      ...initial,
      { id: 'turn-3', role: 'user' as const, content: 'Newer canonical input', createdAt: '2026-08-03T09:02:00.000Z' }
    ]
    const current = await service.saveAgentConversation({
      workspaceId: workspace.id,
      conversationId: created.conversation.id,
      mode: 'teaching',
      expectedBranchRevision: created.conversation.branch!.revision,
      turns: currentTurns
    })

    const rejected = service.saveAgentConversation({
      workspaceId: workspace.id,
      conversationId: created.conversation.id,
      mode: 'teaching',
      expectedBranchRevision: created.conversation.branch!.revision,
      turns: [
        ...initial,
        { id: 'turn-stale', role: 'user', content: 'Stale input must not overwrite.', createdAt: '2026-08-03T09:03:00.000Z' }
      ]
    })

    await expect(rejected).rejects.toBeInstanceOf(AgentConversationBranchRevisionConflictError)
    await expect(rejected).rejects.toMatchObject({
      expectedRevision: created.conversation.branch!.revision,
      currentRevision: current.conversation.branch!.revision
    })

    const canonical = await service.readAgentConversation({
      workspaceId: workspace.id,
      conversationId: created.conversation.id,
      scope: 'workspace'
    })
    expect(canonical.branch).toMatchObject({ revision: current.conversation.branch!.revision })
    expect(canonical.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'turn-3', content: 'Newer canonical input' })
    ]))
    expect(canonical.turns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'turn-stale' })
    ]))
  })
})
