import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AgentConversationRecord } from '../../src/shared/teaching-types'

import { writeAgentConversationRecord } from '../../src/main/teaching-agent-conversations'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

describe('TeachingWorkspaceService agent conversation branch lifecycle', () => {
  it('renames a conversation title without changing its stable id or storage path', async () => {
    const runtime = await runtimeScope.create('rename-conversation-title')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const workspace = (await service.createWorkspace({ name: 'Rename session', prompt: 'Exercise title persistence.' })).activeWorkspace!
    const saved = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'teaching',
      turns: [
        { id: 'turn-1', role: 'user', content: 'Question', createdAt: '2026-07-17T09:00:00.000Z' },
        { id: 'turn-2', role: 'assistant', content: 'Answer', createdAt: '2026-07-17T09:01:00.000Z' }
      ]
    })

    const createdAt = new Date(saved.conversation.createdAt)
    const expectedDirectory = `conversation/${String(createdAt.getUTCFullYear()).padStart(4, '0')}/${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`
    expect(saved.conversation.relativePath).toBe(`${expectedDirectory}/${saved.conversation.id}.md`)

    const renamed = await service.renameAgentConversation({
      workspaceId: workspace.id,
      conversationId: saved.conversation.id,
      title: 'Renamed conversation',
      scope: 'workspace',
      expectedRevision: saved.conversation.branch!.revision
    })
    const persisted = await service.readAgentConversation({
      workspaceId: workspace.id,
      conversationId: saved.conversation.id,
      scope: 'workspace'
    })

    expect(renamed.conversation).toMatchObject({
      id: saved.conversation.id,
      title: 'Renamed conversation',
      relativePath: saved.conversation.relativePath,
      branch: { revision: saved.conversation.branch!.revision + 1 }
    })
    expect(persisted).toMatchObject({
      id: saved.conversation.id,
      title: 'Renamed conversation',
      relativePath: saved.conversation.relativePath
    })
    expect(renamed.state.activeWorkspace?.conversations).toContainEqual(
      expect.objectContaining({ id: saved.conversation.id, title: 'Renamed conversation' })
    )
  })

  it('writes new temporary conversations into their createdAt UTC partition', async () => {
    const runtime = await runtimeScope.create('create-temporary-partitioned-conversation')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const workspace = (await service.createWorkspace({ name: 'Temporary session', prompt: 'Create a temporary conversation.' })).activeWorkspace!
    const saved = await service.saveAgentConversation({
      workspaceId: workspace.id,
      mode: 'temporary',
      turns: [{ id: 'turn-1', role: 'user', content: 'Temporary', createdAt: '2026-07-14T00:00:00.000Z' }]
    })

    const createdAt = new Date(saved.conversation.createdAt)
    const expectedDirectory = `conversations/${String(createdAt.getUTCFullYear()).padStart(4, '0')}/${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`
    expect(saved.conversation.relativePath).toBe(`${expectedDirectory}/${saved.conversation.id}.md`)
  })

  it('updates a legacy flat record without moving it into a UTC partition', async () => {
    const runtime = await runtimeScope.create('update-legacy-flat-conversation')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const workspace = (await service.createWorkspace({ name: 'Legacy session', prompt: 'Keep the old path.' })).activeWorkspace!
    const legacy: AgentConversationRecord = {
      id: 'legacy-flat',
      workspaceId: workspace.id,
      title: 'Legacy flat',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
      relativePath: 'conversation/legacy-flat.md',
      absolutePath: join(workspace.rootPath, 'conversation/legacy-flat.md'),
      messageCount: 1,
      turns: [{ id: 'turn-1', role: 'user', content: 'Original', createdAt: '2026-07-14T00:00:00.000Z' }]
    }
    await writeAgentConversationRecord(workspace, legacy)

    const updated = await service.saveAgentConversation({
      workspaceId: workspace.id,
      conversationId: legacy.id,
      mode: 'teaching',
      expectedBranchRevision: 0,
      turns: [
        ...legacy.turns,
        { id: 'turn-2', role: 'assistant', content: 'Updated', createdAt: '2026-07-14T00:01:00.000Z' }
      ]
    })

    expect(updated.conversation.relativePath).toBe(legacy.relativePath)
    await expect(service.readAgentConversation({
      workspaceId: workspace.id,
      conversationId: legacy.id,
      scope: 'workspace'
    })).resolves.toMatchObject({ relativePath: legacy.relativePath })
  })

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
