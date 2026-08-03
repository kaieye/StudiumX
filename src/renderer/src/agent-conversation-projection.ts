import {
  agentConversationAbsolutePath,
  courseRelativePathForAgentConversation,
  describeAgentConversationPath,
  isCourseAgentConversationPath,
  isTemporaryAgentConversationPath,
  pendingAgentConversationRelativePath
} from '../../shared/agent-conversation-catalog'
import type {
  AgentConversationRecord,
  AgentConversationSummary,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../shared/teaching-types'
import type {
  PendingAgentConversation,
  SidebarConversationSummary
} from './agent-conversation-state'

export type VisibleAgentConversationWorkspaces = {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  selectedCourseWorkspace: TeachingWorkspaceSummary | null
}

export function projectVisibleAgentConversationWorkspaces({
  workspaces,
  activeWorkspace,
  selectedCourseWorkspaceId,
  pendingAgentConversation
}: {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  selectedCourseWorkspaceId: string | null
  pendingAgentConversation: PendingAgentConversation | null
}): VisibleAgentConversationWorkspaces {
  const visibleWorkspaces = withPendingCourseConversation(workspaces, pendingAgentConversation)
  const activeVisibleWorkspace = activeWorkspace
    ? visibleWorkspaces.find((workspace) => workspace.id === activeWorkspace.id) ?? activeWorkspace
    : null
  const selectedCourseWorkspace = selectedCourseWorkspaceId
    ? visibleWorkspaces.find((workspace) => workspace.id === selectedCourseWorkspaceId) ?? activeVisibleWorkspace
    : activeVisibleWorkspace

  return {
    workspaces: visibleWorkspaces,
    activeWorkspace: activeVisibleWorkspace,
    selectedCourseWorkspace
  }
}

/**
 * Reconciles a host-persisted conversation into a possibly stale renderer catalog.
 * Terminal transcript reads can become visible before getState() has rebuilt the
 * workspace summary; without this projection, navigating away clears the only
 * in-memory reference and makes the completed session disappear from the sidebar.
 */
export function projectCompletedAgentConversationIntoAppState({
  appState,
  workspaceId,
  conversation
}: {
  appState: TeachingAppState
  workspaceId: string
  conversation: AgentConversationRecord
}): TeachingAppState {
  return projectCompletedConversationSummaryIntoAppState({
    appState,
    workspaceId,
    conversation: {
      id: conversation.id,
      workspaceId: conversation.workspaceId ?? workspaceId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      relativePath: conversation.relativePath,
      absolutePath: conversation.absolutePath,
      messageCount: conversation.messageCount,
      ...(conversation.branch ? { branch: conversation.branch } : {})
    }
  })
}

/**
 * Promotes the renderer's optimistic summary when the host has returned the
 * canonical id but the just-written transcript/catalog is not readable yet.
 * This remains a display-only bridge; the host is still the sole transcript writer.
 */
export function projectSettledPendingAgentConversationIntoAppState({
  appState,
  pendingAgentConversation,
  savedConversationId
}: {
  appState: TeachingAppState
  pendingAgentConversation: PendingAgentConversation
  savedConversationId: string
}): TeachingAppState {
  const workspaceId = pendingAgentConversation.workspaceId
  const sourceWorkspace = appState.workspaces.find((workspace) => workspace.id === workspaceId)
    ?? (appState.activeWorkspace?.id === workspaceId ? appState.activeWorkspace : null)
  const optimisticPath = describeAgentConversationPath(pendingAgentConversation.summary.relativePath)
  const relativePath = optimisticPath?.id === savedConversationId
    ? pendingAgentConversation.summary.relativePath
    : pendingAgentConversationRelativePath({
        id: savedConversationId,
        mode: pendingAgentConversation.mode,
        selectedCourseRelativePath: courseRelativePathForAgentConversation(
          pendingAgentConversation.summary.relativePath
        ),
        createdAt: pendingAgentConversation.summary.createdAt
      })
  const { pending: _pending, ...optimisticSummary } = pendingAgentConversation.summary

  return projectCompletedConversationSummaryIntoAppState({
    appState,
    workspaceId,
    conversation: {
      ...optimisticSummary,
      id: savedConversationId,
      workspaceId,
      relativePath,
      absolutePath: pendingAgentConversation.mode === 'temporary' || !sourceWorkspace
        ? optimisticSummary.absolutePath
        : agentConversationAbsolutePath(sourceWorkspace.rootPath, relativePath),
      messageCount: pendingAgentConversation.turns.length
    }
  })
}

function projectCompletedConversationSummaryIntoAppState({
  appState,
  workspaceId,
  conversation
}: {
  appState: TeachingAppState
  workspaceId: string
  conversation: AgentConversationSummary
}): TeachingAppState {
  const existing = findProjectedConversation(appState, workspaceId, conversation)
  const summary: AgentConversationSummary = {
    ...conversation,
    ...(existing?.pinned ? { pinned: true } : {}),
    ...(!conversation.branch && existing?.branch ? { branch: existing.branch } : {})
  }

  if (isTemporaryAgentConversationPath(summary.relativePath)) {
    return {
      ...appState,
      temporaryConversations: upsertConversationSummary(appState.temporaryConversations, summary)
    }
  }

  const sourceWorkspace = appState.workspaces.find((workspace) => workspace.id === workspaceId)
    ?? (appState.activeWorkspace?.id === workspaceId ? appState.activeWorkspace : null)
  if (!sourceWorkspace) return appState

  const nextWorkspace = upsertWorkspaceConversation(sourceWorkspace, summary)
  return {
    ...appState,
    workspaces: appState.workspaces.map((workspace) =>
      workspace.id === workspaceId ? nextWorkspace : workspace
    ),
    activeWorkspace: appState.activeWorkspace?.id === workspaceId
      ? nextWorkspace
      : appState.activeWorkspace
  }
}

export function projectVisibleSidebarConversations({
  workspace,
  conversations,
  pendingAgentConversation
}: {
  workspace: TeachingWorkspaceSummary | null
  conversations: AgentConversationSummary[]
  pendingAgentConversation: PendingAgentConversation | null
}): SidebarConversationSummary[] {
  if (
    !pendingAgentConversation ||
    pendingAgentConversation.workspaceId !== workspace?.id ||
    isCourseAgentConversationPath(pendingAgentConversation.summary.relativePath)
  ) {
    return conversations
  }

  return upsertConversationSummary(conversations, pendingAgentConversation.summary)
}

function upsertWorkspaceConversation(
  workspace: TeachingWorkspaceSummary,
  conversation: AgentConversationSummary
): TeachingWorkspaceSummary {
  const conversations = upsertConversationSummary(workspace.conversations, conversation)
  const courseRelativePath = courseRelativePathForAgentConversation(conversation.relativePath)
  const courses = courseRelativePath
    ? workspace.courses.map((course) => {
        if (!sameRelativePath(course.relativePath, courseRelativePath)) return course
        const courseConversations = upsertConversationSummary(course.conversations, conversation)
        return {
          ...course,
          conversations: courseConversations,
          sessionCount: course.sessions.length + courseConversations.length
        }
      })
    : workspace.courses

  return { ...workspace, conversations, courses }
}

function findProjectedConversation(
  appState: TeachingAppState,
  workspaceId: string,
  conversation: Pick<AgentConversationSummary, 'id' | 'relativePath'>
): AgentConversationSummary | undefined {
  const workspace = appState.workspaces.find((item) => item.id === workspaceId)
    ?? (appState.activeWorkspace?.id === workspaceId ? appState.activeWorkspace : null)
  const candidates = [
    ...appState.temporaryConversations,
    ...(workspace?.conversations ?? []),
    ...(workspace?.courses.flatMap((course) => course.conversations) ?? [])
  ]
  return candidates.find((item) =>
    item.id === conversation.id || sameRelativePath(item.relativePath, conversation.relativePath)
  )
}

function withPendingCourseConversation(
  workspaces: TeachingWorkspaceSummary[],
  pendingAgentConversation: PendingAgentConversation | null
): TeachingWorkspaceSummary[] {
  if (!pendingAgentConversation || !isCourseAgentConversationPath(pendingAgentConversation.summary.relativePath)) return workspaces
  const courseRelativePath = courseRelativePathForAgentConversation(pendingAgentConversation.summary.relativePath)
  if (!courseRelativePath) return workspaces

  let changed = false
  const nextWorkspaces = workspaces.map((workspace) => {
    if (workspace.id !== pendingAgentConversation.workspaceId) return workspace
    let workspaceChanged = false
    const conversations = upsertConversationSummary(workspace.conversations, pendingAgentConversation.summary)
    if (conversations !== workspace.conversations) workspaceChanged = true
    const courses = workspace.courses.map((course) => {
      if (!sameRelativePath(course.relativePath, courseRelativePath)) return course
      const courseConversations = upsertConversationSummary(course.conversations, pendingAgentConversation.summary)
      if (courseConversations === course.conversations) return course
      workspaceChanged = true
      return {
        ...course,
        conversations: courseConversations,
        sessionCount: course.sessions.length + courseConversations.length
      }
    })
    if (!workspaceChanged) return workspace
    changed = true
    return {
      ...workspace,
      conversations,
      courses
    }
  })

  return changed ? nextWorkspaces : workspaces
}

function upsertConversationSummary(
  conversations: AgentConversationSummary[],
  conversation: AgentConversationSummary
): SidebarConversationSummary[] {
  const withoutCurrent = conversations.filter((item) =>
    item.id !== conversation.id && !sameRelativePath(item.relativePath, conversation.relativePath)
  )
  if (withoutCurrent.length === conversations.length && conversations[0]?.id === conversation.id) return conversations
  return [conversation, ...withoutCurrent]
}

function sameRelativePath(left: string, right: string): boolean {
  return normalizeProjectionRelativePath(left) === normalizeProjectionRelativePath(right)
}

function normalizeProjectionRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}
