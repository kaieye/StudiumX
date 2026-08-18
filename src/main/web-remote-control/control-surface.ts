/**
 * Maps TeachingWorkspaceService state → secret-free remote control DTOs (security boundary: SECURITY.md).
 */

import type { TeachingWorkspaceService } from '../teaching-workspace'
import type {
  WebRemoteControlTaskDto,
  WebRemoteControlWorkspaceDto
} from '../../shared/web-remote-control'

export type WebRemoteControlCatalog = {
  workspaces: WebRemoteControlWorkspaceDto[]
  tasks: WebRemoteControlTaskDto[]
}

function workspaceKey(id: string, rootPath: string): string {
  return id || rootPath
}

export async function loadWebRemoteControlCatalog(
  workspaceService: TeachingWorkspaceService
): Promise<WebRemoteControlCatalog> {
  const state = await workspaceService.getState()
  const workspaces: WebRemoteControlWorkspaceDto[] = state.workspaces.map((workspace) => ({
    workspaceKey: workspaceKey(workspace.id, workspace.rootPath),
    workspacePath: workspace.rootPath,
    workspaceId: workspace.id,
    label: workspace.name || workspace.rootPath.split(/[/\\]/).filter(Boolean).pop() || workspace.id,
    kind: 'local',
    connectionState: 'connected'
  }))

  const tasks: WebRemoteControlTaskDto[] = []

  for (const workspace of state.workspaces) {
    const key = workspaceKey(workspace.id, workspace.rootPath)
    const label = workspace.name || key
    for (const conversation of workspace.conversations ?? []) {
      if (conversation.branch?.status === 'deleted') continue
      const created = Date.parse(conversation.createdAt) || 0
      const updated = Date.parse(conversation.updatedAt) || created
      tasks.push({
        taskId: conversation.id,
        title: conversation.title || conversation.id,
        workspaceKey: key,
        workspacePath: workspace.rootPath,
        workspaceId: workspace.id,
        workspaceLabel: label,
        workspaceKind: 'local',
        createdAt: created,
        updatedAt: updated,
        displayStatus: conversation.branch?.status === 'archived' ? 'completed' : 'idle',
        pinned: conversation.pinned === true,
        archived: conversation.branch?.status === 'archived'
      })
    }
  }

  for (const conversation of state.temporaryConversations ?? []) {
    const workspaceId = conversation.workspaceId
    const workspace = workspaceId
      ? state.workspaces.find((item) => item.id === workspaceId)
      : state.activeWorkspace
    const key = workspace
      ? workspaceKey(workspace.id, workspace.rootPath)
      : `temporary:${conversation.id}`
    const path = workspace?.rootPath ?? ''
    const label = workspace?.name ?? '临时对话'
    const created = Date.parse(conversation.createdAt) || 0
    const updated = Date.parse(conversation.updatedAt) || created
    tasks.push({
      taskId: conversation.id,
      title: conversation.title || conversation.id,
      workspaceKey: key,
      workspacePath: path,
      workspaceId: workspace?.id,
      workspaceLabel: label,
      workspaceKind: 'local',
      createdAt: created,
      updatedAt: updated,
      displayStatus: 'idle',
      pinned: conversation.pinned === true
    })
  }

  tasks.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return b.createdAt - a.createdAt
  })

  return { workspaces, tasks }
}
