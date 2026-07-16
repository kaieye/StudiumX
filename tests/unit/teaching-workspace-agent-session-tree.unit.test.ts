import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

describe('TeachingWorkspaceService agent conversation branch lifecycle', () => {
  it('removes a single-branch conversation session from the workspace catalog', async () => {
    const runtime = await runtimeScope.create('delete-single-branch-session')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const workspace = (await service.createWorkspace({
      name: 'Delete session',
      prompt: 'Exercise whole-session deletion.'
    })).activeWorkspace!
    const saved = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'teaching',
      turns: [
        { id: 'turn-1', role: 'user', content: 'Question', createdAt: '2026-07-16T09:00:00.000Z' },
        { id: 'turn-2', role: 'assistant', content: 'Answer', createdAt: '2026-07-16T09:01:00.000Z' }
      ]
    })

    const state = await service.removeWorkspaceItem({
      workspaceId: workspace.id,
      relativePath: saved.conversation.relativePath,
      kind: 'conversation',
      mode: 'disk'
    })

    expect(state.activeWorkspace?.conversations).not.toContainEqual(
      expect.objectContaining({ id: saved.conversation.id })
    )
  })

  it('keeps a tombstone when removing one branch from a multi-branch session', async () => {
    const runtime = await runtimeScope.create('delete-open-root-branch')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const workspace = (await service.createWorkspace({
      name: 'Delete branch',
      prompt: 'Exercise the durable delete path.'
    })).activeWorkspace!
    const saved = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'teaching',
      turns: [
        { id: 'turn-1', role: 'user', content: 'Question', createdAt: '2026-07-16T10:00:00.000Z' },
        { id: 'turn-2', role: 'assistant', content: 'Answer', createdAt: '2026-07-16T10:01:00.000Z' }
      ]
    })
    const forked = await service.forkAgentConversationBranch({
      workspaceId: workspace.id,
      conversationId: saved.conversation.id,
      scope: 'workspace',
      sourceTurnId: 'turn-2',
      expectedRevision: 1
    })

    await service.removeWorkspaceItem({
      workspaceId: workspace.id,
      relativePath: saved.conversation.relativePath,
      kind: 'conversation',
      mode: 'disk'
    })

    const deleted = await service.readAgentConversation({
      workspaceId: workspace.id,
      conversationId: saved.conversation.id,
      scope: 'workspace'
    })
    const opened = await service.openAgentConversationBranch({
      workspaceId: workspace.id,
      conversationId: forked.conversation.id,
      scope: 'workspace'
    })
    expect(deleted.branch).toMatchObject({ status: 'deleted', revision: 2 })
    expect(opened.conversation.id).toBe(forked.conversation.id)
    expect(opened.tree.openBranchId).toBe(forked.conversation.branch?.branchId)
  })
})
